// server.js — Kabonix Foundation API
// PostgreSQL + PostGIS. Plain node:http — no framework.
//
// Route order matters:
//   1. CORS preflight
//   2. Health check
//   3. Public auth routes (login, register-check, forgot-password, reset, verify-email, refresh, logout)
//   4. Public website content routes (no auth needed)
//   5. Auth wall — every route below requires a valid access token
//   6. Authenticated auth routes (me, MFA setup, resend-verify)
//   7. Admin & governance (admin-routes.js)
//   8. M&E forms & submissions
//   9. Audit log

import http      from 'node:http';
import crypto    from 'node:crypto';
import { URL }   from 'node:url';
import { pool, seedIfEmpty } from './db.js';
import { runMigrations }     from './migrate.js';
import {
  hashPassword, verifyPassword,
  createAccessToken, verifyAccessToken,
  generateOpaqueToken, hashOpaqueToken, newExpiry,
  REFRESH_TOKEN_TTL_MS, RESET_TOKEN_TTL_MS, VERIFY_TOKEN_TTL_MS, MFA_CHALLENGE_TTL_MS,
} from './auth.js';
import { generateBase32Secret, verifyTotp, otpauthUri } from './mfa.js';
import { sendMail }      from './mailer.js';
import { can, loadPermissions, loadRoles, requirePermission } from './rbac.js';
import { logAction }     from './audit.js';
import { handleAdminRoute } from './admin-routes.js';

const PORT        = process.env.PORT        || 4000;
const WEB_ORIGIN  = process.env.WEB_ORIGIN  || 'http://localhost:3001';
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? new Set(ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()))
  : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSend(req) {
  const origin = req.headers['origin'] || '';
  let allowOrigin = '*';
  if (ALLOWED_ORIGINS) {
    allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] || '';
  }
  const corsHeaders = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Vary':                        'Origin',
  };
  return function send(res, status, body) {
    res.writeHead(status, corsHeaders);
    res.end(JSON.stringify(body, null, 2));
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end',  ()    => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active) return null;
  return user;
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email,
    emailVerified: !!u.email_verified_at,
    mfaEnabled:    !!u.mfa_enabled,
  };
}

async function issueTokenPair(user, familyId) {
  const accessToken  = createAccessToken(user);
  const refreshToken = generateOpaqueToken();
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at) VALUES ($1,$2,$3,$4)',
    [user.id, hashOpaqueToken(refreshToken), familyId, newExpiry(REFRESH_TOKEN_TTL_MS)]
  );
  return { accessToken, refreshToken };
}

function randomFamilyId() { return generateOpaqueToken(); }

async function checkPerm(user, module, level) {
  const denied = await requirePermission(user.id, module, level);
  if (denied) {
    await logAction({ userId: user.id, userEmail: user.email,
      action: 'permission_denied', entity: module, detail: `attempted '${level}'` });
  }
  return denied;
}

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8)
    return 'Password must be at least 8 characters';
  if (pw.length > 128)
    return 'Password is too long';
  return null;
}

// ── Data-quality helpers (Section 4.2) ────────────────────────────────────────

function normaliseName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function beneficiaryDeDupHash(name, village) {
  return crypto.createHash('md5')
    .update(`${normaliseName(name)}|${normaliseName(village)}`)
    .digest('hex');
}

/** Returns an error string, or null if the value passes. */
function validateFieldValue(field, value) {
  const required = !!field.required;
  const isEmpty  = value === undefined || value === null || value === '';

  if (required && isEmpty) return `Missing required field: ${field.label}`;
  if (isEmpty) return null;

  if (field.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n))                          return `${field.label} must be a number`;
    if (field.integer && !Number.isInteger(n))        return `${field.label} must be a whole number`;
    if (field.min != null && n < field.min)           return `${field.label} must be at least ${field.min}`;
    if (field.max != null && n > field.max)           return `${field.label} must be at most ${field.max}`;
  } else {
    const s = String(value);
    if (field.minLength != null && s.length < field.minLength)
      return `${field.label} must be at least ${field.minLength} characters`;
    if (field.maxLength != null && s.length > field.maxLength)
      return `${field.label} must be at most ${field.maxLength} characters`;
    if (field.pattern && !new RegExp(field.pattern).test(s))
      return `${field.label} is not in the expected format`;
    if (field.type === 'select' && Array.isArray(field.options) && !field.options.includes(s))
      return `${field.label} must be one of: ${field.options.join(', ')}`;
  }
  return null;
}

/**
 * Map fields are stored as gps_lat/gps_lng on the answers object (the picker
 * writes them that way in app.js). This validates the pair as a unit.
 * Returns an error string or null.
 */
function validateMapField(field, answers) {
  const lat = answers.gps_lat;
  const lng = answers.gps_lng;
  const missing = lat == null || lng == null;

  if (field.required && missing) return `${field.label} is required`;
  if (missing) return null;

  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return `${field.label} must be valid coordinates`;
  if (nLat < -90  || nLat > 90)  return `${field.label}: latitude must be between -90 and 90`;
  if (nLng < -180 || nLng > 180) return `${field.label}: longitude must be between -180 and 180`;
  return null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const send = makeSend(req);
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url   = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  try {

    // ── 1. Health ─────────────────────────────────────────────────────────────
    if (parts[0] === 'health') {
      return send(res, 200, { ok: true, service: 'kabonix-api', db: 'postgres+postgis', time: new Date().toISOString() });
    }

    if (parts[0] !== 'api') return send(res, 404, { error: 'Not found' });

    // ── 2. PUBLIC AUTH ROUTES ─────────────────────────────────────────────────

    if (parts[1] === 'auth' && parts[2] === 'login' && req.method === 'POST') {
      const { email = '', password = '' } = await readBody(req);

      if (!validateEmail(email)) {
        return send(res, 400, { error: 'Please enter a valid email address' });
      }

      const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      const user = rows[0];

      const badCreds = { error: 'Invalid email or password' };

      if (!user || !user.is_active) {
        await logAction({ userId: null, userEmail: email, action: 'login_failed', entity: 'user', detail: 'no account or inactive' });
        return send(res, 401, badCreds);
      }

      if (!verifyPassword(password, user.password_salt, user.password_hash)) {
        await logAction({ userId: user.id, userEmail: email, action: 'login_failed', entity: 'user
