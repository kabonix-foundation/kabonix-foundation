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
// ALLOWED_ORIGINS: comma-separated list of frontend URLs allowed to call this API.
// Set this on Render to your exact website + staff-portal URLs (no trailing slash).
// Falls back to * in dev so local testing works without config.
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? new Set(ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()))
  : null; // null = allow *

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

// ── Main handler ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const send = makeSend(req);
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url   = new URL(req.url, 'http://x');  // base is a dummy — only used to parse pathname/searchParams
  const parts = url.pathname.split('/').filter(Boolean);

  try {

    // ── 1. Health ─────────────────────────────────────────────────────────────
    if (parts[0] === 'health') {
      return send(res, 200, { ok: true, service: 'kabonix-api', db: 'postgres+postgis', time: new Date().toISOString() });
    }

    if (parts[0] !== 'api') return send(res, 404, { error: 'Not found' });

    // ── 2. PUBLIC AUTH ROUTES ─────────────────────────────────────────────────
    //    No access token required for any of these.

    // POST /api/auth/login  — step 1: password
    if (parts[1] === 'auth' && parts[2] === 'login' && req.method === 'POST') {
      const { email = '', password = '' } = await readBody(req);

      if (!validateEmail(email)) {
        return send(res, 400, { error: 'Please enter a valid email address' });
      }

      const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      const user = rows[0];

      // Always use the same error to prevent user enumeration
      const badCreds = { error: 'Invalid email or password' };

      if (!user || !user.is_active) {
        await logAction({ userId: null, userEmail: email, action: 'login_failed', entity: 'user', detail: 'no account or inactive' });
        return send(res, 401, badCreds);
      }

      if (!verifyPassword(password, user.password_salt, user.password_hash)) {
        await logAction({ userId: user.id, userEmail: email, action: 'login_failed', entity: 'user', entityId: user.id, detail: 'wrong password' });
        return send(res, 401, badCreds);
      }

      // MFA enrolled — issue a short-lived challenge token instead of session tokens
      if (user.mfa_enabled) {
        const challengeToken = generateOpaqueToken();
        await pool.query(
          'INSERT INTO mfa_challenges (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
          [user.id, hashOpaqueToken(challengeToken), newExpiry(MFA_CHALLENGE_TTL_MS)]
        );
        await logAction({ userId: user.id, userEmail: user.email, action: 'mfa_challenge_issued', entity: 'user', entityId: user.id });
        return send(res, 200, { mfaRequired: true, challengeToken });
      }

      const { accessToken, refreshToken } = await issueTokenPair(user, randomFamilyId());
      await logAction({ userId: user.id, userEmail: user.email, action: 'login', entity: 'user', entityId: user.id, detail: 'success' });
      return send(res, 200, {
        accessToken, refreshToken,
        user: publicUser(user),
        roles:       await loadRoles(user.id),
        permissions: await loadPermissions(user.id),
      });
    }

    // POST /api/auth/mfa/challenge  — step 2: TOTP code
    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'challenge' && req.method === 'POST') {
      const { challengeToken = '', code = '' } = await readBody(req);
      const { rows } = await pool.query(
        'SELECT * FROM mfa_challenges WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [hashOpaqueToken(challengeToken)]
      );
      const challenge = rows[0];
      if (!challenge) {
        return send(res, 401, { error: 'Challenge expired or invalid. Please sign in again.' });
      }

      const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id = $1', [challenge.user_id]);
      const user = uRows[0];

      if (!user || !user.mfa_enabled || !verifyTotp(user.mfa_secret, String(code).trim())) {
        await logAction({ userId: user?.id, userEmail: user?.email, action: 'mfa_failed', entity: 'user', entityId: user?.id, detail: 'invalid code' });
        return send(res, 401, { error: 'Invalid authentication code. Try again.' });
      }

      await pool.query('UPDATE mfa_challenges SET used_at = now() WHERE id = $1', [challenge.id]);
      const { accessToken, refreshToken } = await issueTokenPair(user, randomFamilyId());
      await logAction({ userId: user.id, userEmail: user.email, action: 'login', entity: 'user', entityId: user.id, detail: 'success (mfa)' });
      return send(res, 200, {
        accessToken, refreshToken,
        user: publicUser(user),
        roles:       await loadRoles(user.id),
        permissions: await loadPermissions(user.id),
      });
    }

    // POST /api/auth/refresh  — rotate refresh token
    if (parts[1] === 'auth' && parts[2] === 'refresh' && req.method === 'POST') {
      const { refreshToken = '' } = await readBody(req);
      const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hashOpaqueToken(refreshToken)]);
      const stored = rows[0];

      if (!stored || stored.expires_at < new Date()) {
        return send(res, 401, { error: 'Session expired. Please sign in again.' });
      }
      if (stored.revoked_at) {
        // Revoke the entire family — possible token theft
        await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [stored.family_id]);
        await logAction({ userId: stored.user_id, action: 'token_reuse_detected', entity: 'refresh_token', entityId: stored.id, detail: 'family revoked' });
        return send(res, 401, { error: 'Session invalidated for security. Please sign in again.' });
      }

      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [stored.id]);
      const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id = $1', [stored.user_id]);
      const user = uRows[0];
      if (!user || !user.is_active) return send(res, 401, { error: 'Account is no longer active' });

      const { accessToken, refreshToken: newRT } = await issueTokenPair(user, stored.family_id);
      await logAction({ userId: user.id, userEmail: user.email, action: 'token_refreshed', entity: 'refresh_token', entityId: stored.id });
      return send(res, 200, { accessToken, refreshToken: newRT });
    }

    // POST /api/auth/logout
    if (parts[1] === 'auth' && parts[2] === 'logout' && req.method === 'POST') {
      const { refreshToken = '' } = await readBody(req);
      const { rows } = await pool.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id, id',
        [hashOpaqueToken(refreshToken)]
      );
      if (rows[0]) {
        const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [rows[0].user_id]);
        await logAction({ userId: rows[0].user_id, userEmail: u[0]?.email, action: 'logout', entity: 'refresh_token', entityId: rows[0].id });
      }
      return send(res, 200, { ok: true });
    }

    // POST /api/auth/password/forgot  — request reset link (never reveals whether email exists)
    if (parts[1] === 'auth' && parts[2] === 'password' && parts[3] === 'forgot' && req.method === 'POST') {
      const { email = '' } = await readBody(req);
      const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE', [email]);
      const user = rows[0];
      if (user) {
        const token = generateOpaqueToken();
        await pool.query(
          'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
          [user.id, hashOpaqueToken(token), newExpiry(RESET_TOKEN_TTL_MS)]
        );
        const devLink = `${WEB_ORIGIN}/?resetToken=${token}`;
        await sendMail({
          to:       user.email,
          subject:  'Reset your Kabonix password',
          bodyText: `Hello ${user.name},\n\nSomeone (hopefully you) requested a password reset for this account.\nUse the link below within 1 hour. If you did not request this, ignore this email.\n`,
          devLink,
        });
        await logAction({ userId: user.id, userEmail: user.email, action: 'password_reset_requested', entity: 'user', entityId: user.id });
      }
      // Always return the same response to prevent user enumeration
      return send(res, 200, { ok: true, message: 'If that email exists in our system, a reset link has been sent.' });
    }

    // POST /api/auth/password/reset  — set new password using token
    if (parts[1] === 'auth' && parts[2] === 'password' && parts[3] === 'reset' && req.method === 'POST') {
      const { token = '', newPassword = '' } = await readBody(req);

      const pwErr = validatePassword(newPassword);
      if (pwErr) return send(res, 400, { error: pwErr });

      const { rows } = await pool.query(
        'SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [hashOpaqueToken(token)]
      );
      const reset = rows[0];
      if (!reset) return send(res, 400, { error: 'This reset link is invalid or has expired. Please request a new one.' });

      const { hash, salt } = hashPassword(newPassword);
      await pool.query('UPDATE users SET password_hash = $1, password_salt = $2 WHERE id = $3', [hash, salt, reset.user_id]);
      await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [reset.id]);
      // Revoke all active sessions — forces re-login everywhere
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [reset.user_id]);
      const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [reset.user_id]);
      await logAction({ userId: reset.user_id, userEmail: u[0]?.email, action: 'password_reset_completed', entity: 'user', entityId: reset.user_id, detail: 'all sessions revoked' });
      return send(res, 200, { ok: true });
    }

    // POST /api/auth/email/verify  — confirm email address using token from link
    if (parts[1] === 'auth' && parts[2] === 'email' && parts[3] === 'verify' && req.method === 'POST') {
      const { token = '' } = await readBody(req);
      const { rows } = await pool.query(
        'SELECT * FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [hashOpaqueToken(token)]
      );
      const v = rows[0];
      if (!v) return send(res, 400, { error: 'This verification link is invalid or has expired. Please request a new one.' });
      await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [v.user_id]);
      await pool.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [v.id]);
      const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [v.user_id]);
      await logAction({ userId: v.user_id, userEmail: u[0]?.email, action: 'email_verified', entity: 'user', entityId: v.user_id });
      return send(res, 200, { ok: true });
    }

    // ── 3. PUBLIC WEBSITE CONTENT (no auth required) ──────────────────────────
    const lang = url.searchParams.get('lang') === 'sw' ? 'sw' : 'en';

    if (parts[1] === 'website') {
      // GET /api/website/posts
      if (parts[2] === 'posts' && !parts[3] && req.method === 'GET') {
        const type = url.searchParams.get('type');
        const { rows } = await pool.query(
          `SELECT id,type,slug,
                  title_${lang}   AS title,
                  summary_${lang} AS summary,
                  event_date, event_venue, doc_url, published_at
           FROM posts WHERE published = TRUE ${type ? 'AND type = $1' : ''} ORDER BY published_at DESC`,
          type ? [type] : []
        );
        return send(res, 200, rows);
      }

      // GET /api/website/posts/:slug
      if (parts[2] === 'posts' && parts[3] && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id,type,slug,
                  title_${lang}   AS title,
                  summary_${lang} AS summary,
                  body_${lang}    AS body,
                  event_date, event_venue, doc_url, published_at
           FROM posts WHERE slug = $1 AND published = TRUE`,
          [parts[3]]
        );
        if (!rows[0]) return send(res, 404, { error: 'Not found' });
        return send(res, 200, rows[0]);
      }

      // GET /api/website/impact-stories
      if (parts[2] === 'impact-stories' && !parts[3] && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id, slug, title_${lang} AS title, body_${lang} AS body,
                  programme, location, metric_label, metric_value
           FROM impact_stories WHERE published = TRUE ORDER BY id DESC`
        );
        return send(res, 200, rows);
      }

      // GET /api/website/partners
      if (parts[2] === 'partners' && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id, name, type, logo_url, website_url,
                  description_${lang} AS description, display_order
           FROM partners WHERE is_active = TRUE ORDER BY display_order`
        );
        return send(res, 200, rows);
      }

      // POST /api/website/contact
      if (parts[2] === 'contact' && req.method === 'POST') {
        const { full_name = '', email = '', organisation = '', subject = '', message = '', lang: msgLang = 'en' } = await readBody(req);
        if (!full_name || !email || !subject || !message) {
          return send(res, 400, { error: 'full_name, email, subject and message are required' });
        }
        if (!validateEmail(email)) {
          return send(res, 400, { error: 'Please provide a valid email address' });
        }
        if (message.length > 4000) {
          return send(res, 400, { error: 'Message is too long (max 4000 characters)' });
        }
        const { rows } = await pool.query(
          'INSERT INTO contact_messages (full_name,email,organisation,subject,message,lang) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [full_name, email, organisation || null, subject, message, msgLang]
        );
        await logAction({ userId: null, userEmail: email, action: 'create', entity: 'contact_message', entityId: rows[0].id, detail: subject });
        await sendMail({ to: 'info@kabonix.org', subject: `Website enquiry: ${subject}`,
          bodyText: `From: ${full_name} <${email}>${organisation ? ` (${organisation})` : ''}\n\n${message}` });
        return send(res, 201, { ok: true, message: 'Thank you — we will be in touch shortly.' });
      }

      return send(res, 404, { error: 'Not found' });
    }

    // ── 4. AUTH WALL — everything below requires a valid access token ─────────
    const user = await getAuthUser(req);
    if (!user) return send(res, 401, { error: 'Not authenticated. Please sign in.' });

    // ── 5. AUTHENTICATED AUTH ROUTES ──────────────────────────────────────────

    // GET /api/auth/me
    if (parts[1] === 'auth' && parts[2] === 'me' && req.method === 'GET') {
      return send(res, 200, {
        user:        publicUser(user),
        roles:       await loadRoles(user.id),
        permissions: await loadPermissions(user.id),
      });
    }

    // POST /api/auth/email/resend  — resend verification email
    if (parts[1] === 'auth' && parts[2] === 'email' && parts[3] === 'resend' && req.method === 'POST') {
      if (user.email_verified_at) {
        return send(res, 400, { error: 'Your email address is already verified.' });
      }
      const token = generateOpaqueToken();
      await pool.query(
        'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
        [user.id, hashOpaqueToken(token), newExpiry(VERIFY_TOKEN_TTL_MS)]
      );
      await sendMail({ to: user.email, subject: 'Verify your Kabonix email address',
        bodyText: `Hello ${user.name},\n\nPlease confirm your email address using the link below.\nThis link expires in 24 hours.`,
        devLink: `${WEB_ORIGIN}/?verifyToken=${token}` });
      return send(res, 200, { ok: true });
    }

    // POST /api/auth/mfa/setup  — generate TOTP secret & QR URI
    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'setup' && req.method === 'POST') {
      const secret = generateBase32Secret();
      await pool.query('UPDATE users SET mfa_pending_secret = $1 WHERE id = $2', [secret, user.id]);
      return send(res, 200, { secret, otpauthUri: otpauthUri({ secret, accountEmail: user.email }) });
    }

    // POST /api/auth/mfa/enable  — confirm TOTP code to activate MFA
    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'enable' && req.method === 'POST') {
      const { code = '' } = await readBody(req);
      // Re-fetch to get mfa_pending_secret (currentUser caches old row)
      const { rows: fresh } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      const u = fresh[0];
      if (!u.mfa_pending_secret) return send(res, 400, { error: 'Please call /api/auth/mfa/setup first' });
      if (!verifyTotp(u.mfa_pending_secret, String(code).trim())) {
        return send(res, 400, { error: 'Invalid code — check your authenticator app and try again' });
      }
      await pool.query(
        'UPDATE users SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled = TRUE WHERE id = $1',
        [user.id]
      );
      await logAction({ userId: user.id, userEmail: user.email, action: 'mfa_enabled', entity: 'user', entityId: user.id });
      return send(res, 200, { ok: true });
    }

    // POST /api/auth/mfa/disable  — disable MFA (requires valid current TOTP code)
    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'disable' && req.method === 'POST') {
      const { code = '' } = await readBody(req);
      const { rows: fresh } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      const u = fresh[0];
      if (!u.mfa_enabled) return send(res, 400, { error: 'MFA is not enabled on your account' });
      if (!verifyTotp(u.mfa_secret, String(code).trim())) {
        return send(res, 400, { error: 'Invalid authentication code' });
      }
      await pool.query('UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_pending_secret = NULL WHERE id = $1', [user.id]);
      await logAction({ userId: user.id, userEmail: user.email, action: 'mfa_disabled', entity: 'user', entityId: user.id });
      return send(res, 200, { ok: true });
    }

    // ── 6. ADMIN & GOVERNANCE ─────────────────────────────────────────────────
    if (parts[1] === 'admin') {
      const body = (req.method !== 'GET') ? await readBody(req) : {};
      const result = await handleAdminRoute({ parts, method: req.method, body, user, url, res, send, checkPermission: checkPerm, can });
      if (result !== null) return;
      return send(res, 404, { error: 'Not found' });
    }

    // ── 7. LEGACY admin routes (kept for backward compat with admin UI) ────────
    if (parts[1] === 'users' && req.method === 'GET' && !parts[2]) {
      const denied = await checkPerm(user, 'admin', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const { rows: users } = await pool.query('SELECT id,name,email,is_active,email_verified_at,mfa_enabled,created_at FROM users');
      const { rows: roleRows } = await pool.query('SELECT ur.user_id, r.key, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id');
      return send(res, 200, users.map(u => ({ ...u, roles: roleRows.filter(r => r.user_id === u.id).map(r => ({ key: r.key, name: r.name })) })));
    }

    if (parts[1] === 'users' && parts[2] === 'roles' && req.method === 'POST') {
      const denied = await checkPerm(user, 'admin', 'edit');
      if (denied) return send(res, denied.status, denied.body);
      const { userId, roleKey } = await readBody(req);
      const { rows } = await pool.query('SELECT id FROM roles WHERE key = $1', [roleKey]);
      if (!rows[0]) return send(res, 400, { error: 'Unknown role' });
      await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, rows[0].id]);
      await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user_role', entityId: userId, detail: `assigned ${roleKey}` });
      return send(res, 200, { ok: true });
    }

    if (parts[1] === 'users' && parts[3] === 'deactivate' && req.method === 'POST') {
      const denied = await checkPerm(user, 'admin', 'edit');
      if (denied) return send(res, denied.status, denied.body);
      const tid = Number(parts[2]);
      await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [tid]);
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [tid]);
      await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user', entityId: tid, detail: 'deactivated' });
      return send(res, 200, { ok: true });
    }

    if (parts[1] === 'roles' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT id,key,name,description FROM roles');
      return send(res, 200, rows);
    }

    // ── 8. M&E FORMS & SUBMISSIONS ────────────────────────────────────────────

    if (parts[1] === 'forms' && req.method === 'GET') {
      const denied = await checkPerm(user, 'data_collection', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const { rows } = await pool.query('SELECT * FROM me_forms ORDER BY id');
      return send(res, 200, rows.map(f => ({ ...f, schema: f.schema_json })));
    }

    if (parts[1] === 'submissions' && req.method === 'GET' && !parts[2]) {
      const denied = await checkPerm(user, 'data_collection', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const { rows } = await pool.query(`
        SELECT s.*, u.email AS submitted_by_email, f.title AS form_title
        FROM me_submissions s
        JOIN users u ON u.id = s.submitted_by
        JOIN me_forms f ON f.id = s.form_id
        ORDER BY s.id DESC
      `);
      return send(res, 200, rows.map(r => ({ ...r, answers: r.answers_json })));
    }

    if (parts[1] === 'submissions' && parts[2] && req.method === 'GET') {
      const denied = await checkPerm(user, 'data_collection', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const { rows } = await pool.query('SELECT * FROM me_submissions WHERE id = $1', [Number(parts[2])]);
      if (!rows[0]) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { ...rows[0], answers: rows[0].answers_json });
    }

    if (parts[1] === 'submissions' && req.method === 'POST') {
      const denied = await checkPerm(user, 'data_collection', 'create');
      if (denied) return send(res, denied.status, denied.body);
      const { formKey, answers } = await readBody(req);
      const { rows: fRows } = await pool.query('SELECT * FROM me_forms WHERE key = $1', [formKey]);
      const form = fRows[0];
      if (!form) return send(res, 400, { error: 'Unknown form key' });

      for (const field of form.schema_json) {
        if (field.required && (answers[field.id] === undefined || answers[field.id] === '')) {
          return send(res, 400, { error: `Missing required field: ${field.label}` });
        }
      }

      let beneficiaryId = null;
      if (answers.beneficiary_name) {
        const hasGps = answers.gps_lat !== undefined && answers.gps_lng !== undefined &&
                       answers.gps_lat !== ''        && answers.gps_lng !== '';
        const { rows: bRows } = await pool.query(
          hasGps
            ? 'INSERT INTO beneficiaries (full_name, village, programme, created_by, location) VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography) RETURNING id'
            : 'INSERT INTO beneficiaries (full_name, village, programme, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
          hasGps
            ? [answers.beneficiary_name, answers.village || null, answers.programme_area || null, user.id, Number(answers.gps_lng), Number(answers.gps_lat)]
            : [answers.beneficiary_name, answers.village || null, answers.programme_area || null, user.id]
        );
        beneficiaryId = bRows[0].id;
      }

      const { rows: sRows } = await pool.query(
        'INSERT INTO me_submissions (form_id, beneficiary_id, submitted_by, answers_json) VALUES ($1,$2,$3,$4) RETURNING id',
        [form.id, beneficiaryId, user.id, JSON.stringify(answers)]
      );
      await logAction({ userId: user.id, userEmail: user.email, action: 'create', entity: 'me_submission', entityId: sRows[0].id, detail: `form: ${form.key}` });
      return send(res, 201, { id: sRows[0].id, ok: true });
    }

    // ── 9. AUDIT LOG ──────────────────────────────────────────────────────────

    if (parts[1] === 'audit-log' && req.method === 'GET') {
      const isAdmin = await can(user.id, 'admin', 'view');
      const isMeal  = await can(user.id, 'data_collection', 'approve');
      if (!isAdmin && !isMeal) {
        await logAction({ userId: user.id, userEmail: user.email, action: 'permission_denied', entity: 'audit_log', detail: "attempted 'view'" });
        return send(res, 403, { error: 'Forbidden' });
      }
      const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
      return send(res, 200, rows);
    }

    return send(res, 404, { error: 'Not found' });

  } catch (err) {
    console.error('[ERROR]', err.message, err.stack?.split('\n')[1]);
    return send(res, 500, { error: 'Internal server error', detail: err.message });
  }
});

async function start() {
  console.log('[startup] running migrations…');
  await runMigrations(pool);
  console.log('[startup] migrations complete');
  await seedIfEmpty({ hashPassword });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nKabonix API ready → http://localhost:${PORT}`);
    console.log(`Health check     → http://localhost:${PORT}/health\n`);
  });
}

start().catch(err => {
  console.error('[startup] FAILED:', err.message);
  console.error('Check DATABASE_URL and that Postgres is running.');
  process.exit(1);
});
