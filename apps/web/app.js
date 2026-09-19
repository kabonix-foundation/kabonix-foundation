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

    // DELETE /api/submissions/:id  — requires data_collection:approve
    if (parts[1] === 'submissions' && parts[2] && req.method === 'DELETE') {
      const denied = await checkPerm(user, 'data_collection', 'approve');
      if (denied) return send(res, denied.status, denied.body);
      const id = Number(parts[2]);
      const { rows } = await pool.query('SELECT id, form_id, beneficiary_id FROM me_submissions WHERE id = $1', [id]);
      if (!rows[0]) return send(res, 404, { error: 'Submission not found' });
      await pool.query('DELETE FROM me_submissions WHERE id = $1', [id]);
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'delete', entity: 'me_submission', entityId: id,
        detail: `deleted submission #${id}`,
      });
      return send(res, 200, { ok: true });
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
});// app.js — Kabonix Foundation Staff Portal (Sprint 01–03)
// Wrapped in a guard so an accidental double-include does not throw
// "redeclaration of const" and blank the page.
(() => {
  if (window.__kabonixAppLoaded) {
    console.warn('[app] already loaded — skipping duplicate');
    return;
  }
  window.__kabonixAppLoaded = true;

  console.log('[app] booting…');

  const WEBSITE_URL = document.querySelector('meta[name="website-url"]')?.content || 'http://localhost:3001';

  // Never let an uncaught error leave a blank page.
  window.addEventListener('error', e => {
    const r = document.getElementById('root');
    if (r && !r.innerHTML.trim()) {
      r.innerHTML = '<pre style="padding:24px;font:13px/1.5 Menlo,Consolas,monospace;color:#a4372c;white-space:pre-wrap">'
        + (e.error?.stack || e.message || 'Unknown error') + '</pre>';
    }
  });
  window.addEventListener('unhandledrejection', e => {
    const r = document.getElementById('root');
    if (r && !r.innerHTML.trim()) {
      r.innerHTML = '<pre style="padding:24px;font:13px/1.5 Menlo,Consolas,monospace;color:#a4372c;white-space:pre-wrap">'
        + (e.reason?.stack || String(e.reason) || 'Unhandled rejection') + '</pre>';
    }
  });

  const API = (document.querySelector('meta[name="api-url"]')?.content || 'http://localhost:4000') + '/api';

  const state = {
    token: lsGet('kabonix_token'),
    user: null, roles: [], permissions: [],
    route: 'dashboard', routeParam: null,
  };

  // Top-level `const` inside the IIFE does NOT become a window property, so
  // expose everything the templates need explicitly.
  window.state = state;

  function lsGet(k)    { try { return localStorage.getItem(k); } catch { return (window.__m||{})[k]||null; } }
  function lsSet(k,v)  { try { localStorage.setItem(k,v); } catch { window.__m=window.__m||{}; window.__m[k]=v; } }
  function lsDel(k)    { try { localStorage.removeItem(k); } catch { if(window.__m) delete window.__m[k]; } }

  const root = document.getElementById('root');

  async function api(path, opts={}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type':'application/json', ...(state.token?{Authorization:`Bearer ${state.token}`}:{}), ...(opts.headers||{}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  window.api = api;

  function can(module, level) { return state.permissions.some(p=>p.module===module&&p.level===level); }

  // Toasts stack instead of overlapping at the same fixed position.
  function toast(msg, isErr) {
    let stack = document.getElementById('toast-stack');
    if (!stack) {
      stack = Object.assign(document.createElement('div'), { id: 'toast-stack' });
      document.body.appendChild(stack);
    }
    const el = Object.assign(document.createElement('div'), { className:'toast'+(isErr?' error':''), textContent:msg });
    stack.appendChild(el);
    setTimeout(()=>el.remove(), 3400);
  }

  function esc(s) {
    if (s==null) return '';
    return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function ago(ts) {
    if (!ts) return '—';
    const s = Math.round((Date.now()-new Date(ts))/1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  }

  // Normalise list-shaped API payloads ({ users:[…] } vs […]) so the UI never
  // crashes on a shape change.
  function asArray(value, key) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value[key])) return value[key];
    return [];
  }

  // ── Session ────────────────────────────────────────────────────────────────
  async function tryRestoreSession() {
    if (!state.token) return render();

    // Something must be on screen while we verify the stored token.
    root.innerHTML = `
      <div style="display:grid;place-items:center;min-height:100vh;font:14px -apple-system,'Segoe UI',sans-serif;color:#5f6d5c">
        Loading…
      </div>`;

    try {
      const d = await Promise.race([
        api('/auth/me'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timed out')), 5000)),
      ]);
      state.user = d.user; state.roles = d.roles; state.permissions = d.permissions;
    } catch {
      state.token = null; lsDel('kabonix_token');
    }
    render();
  }

  async function login(email, password) {
    const d = await api('/auth/login',{method:'POST',body:{email,password}});
    if (d.mfaRequired) return d;
    state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
    lsSet('kabonix_token', d.accessToken);
    state.route='dashboard'; render();
  }

  async function submitMfa(challengeToken, code) {
    const d = await api('/auth/mfa/challenge',{method:'POST',body:{challengeToken,code}});
    state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
    lsSet('kabonix_token', d.accessToken);
    state.route='dashboard'; render();
  }

  function logout() {
    state.token=null; state.user=null; state.roles=[]; state.permissions=[];
    lsDel('kabonix_token'); render();
  }

  // ── Router ─────────────────────────────────────────────────────────────────
  function nav(route, param) { state.route=route; state.routeParam=param||null; render(); }
  window.nav = nav; // inline onclick handlers in the dashboard need this

  function render() {
    if (!state.token||!state.user) return renderLogin();
    const views = {
      dashboard: renderDashboard,
      users:     renderUsers,
      roles:     renderRoles,
      config:    renderConfig,
      audit:     renderAudit,
      forms:     renderForms,
      messages:  renderMessages,
      profile:   renderProfile,
    };
    (views[state.route]||renderDashboard)();
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  function renderLogin(mfaChallenge) {
    root.innerHTML = `
<div class="login-screen">
  <div class="login-visual">
    <div class="mark">KABONIX FOUNDATION</div>
    <h1>Digital Ecosystem Platform</h1>
    <p>Staff & field officer portal. Collect, manage and act on programme data.</p>
    <div class="login-pills">
      <span>🌊 Blue Economy</span><span>🌱 Carbon</span><span>⚡ Renewable Energy</span><span>👩‍💼 Youth & Women</span>
    </div>
  </div>
  <div class="login-form-side">
    <div class="login-card">
      ${mfaChallenge ? `
        <h2>Two-factor authentication</h2>
        <p class="sub">Enter the 6-digit code from your authenticator app.</p>
        <div class="field"><label>Authentication code</label><input id="l-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></div>
        <button class="btn-primary" id="mfa-btn">Verify</button>
        <p class="hint"><a href="#" id="back-link">← Back to sign in</a></p>
      ` : `
        <h2>Sign in</h2>
        <p class="sub">Foundation staff and field officers only.</p>
        <div class="field"><label>Email</label><input id="l-email" type="email" value="admin@kabonix.org"></div>
        <div class="field"><label>Password</label><input id="l-pw" type="password" value="ChangeMe123!"></div>
        <button class="btn-primary" id="login-btn">Sign in</button>
        <p class="hint">Seeded accounts: <strong>admin@kabonix.org</strong> (Super Admin) · <strong>amina@kabonix.org</strong> (Field Officer) — password: <strong>ChangeMe123!</strong></p>
      `}
      <div id="l-err" class="err-msg"></div>
    </div>
  </div>
</div>`;
    if (mfaChallenge) {
      const code = document.getElementById('l-code');
      code.focus();
      document.getElementById('mfa-btn').onclick = async () => {
        try { await submitMfa(mfaChallenge, code.value.trim()); }
        catch(e) { document.getElementById('l-err').textContent = e.message; }
      };
      document.getElementById('back-link').onclick = e => { e.preventDefault(); render(); };
    } else {
      document.getElementById('login-btn').onclick = doLogin;
      document.getElementById('l-pw').onkeydown = e => { if(e.key==='Enter') doLogin(); };
    }
  }

  async function doLogin() {
    const email = document.getElementById('l-email').value.trim();
    const pw    = document.getElementById('l-pw').value;
    const err   = document.getElementById('l-err');
    err.textContent = '';
    try {
      const d = await login(email, pw);
      if (d?.mfaRequired) renderLogin(d.challengeToken);
    } catch(e) { err.textContent = e.message; }
  }

  // ── Shell ───────────────────────────────────────────────────────────────────
  function shell(contentHtml, activeRoute) {
    const items = [
      { key:'dashboard', icon:'◉', label:'Dashboard' },
      can('data_collection','view') && { key:'forms', icon:'📋', label:'M&E Collection' },
      can('admin','view') && { key:'users', icon:'👥', label:'Staff & Users' },
      can('admin','view') && { key:'roles', icon:'🔐', label:'Roles & Permissions' },
      can('admin','view') && { key:'config', icon:'⚙️', label:'System Config' },
      can('admin','view') && { key:'messages', icon:'✉️', label:'Contact Messages' },
      (can('admin','view')||can('data_collection','approve')) && { key:'audit', icon:'📜', label:'Audit Log' },
    ].filter(Boolean);

    root.innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="sb-brand">
      <button id="sb-toggle" aria-label="Toggle menu">☰</button>
      <a class="sb-brand-link" href="${WEBSITE_URL}" target="_blank" rel="noopener">
        <div class="sb-logo"><img src="/assets/logo.png" class="sb-logo-img" onerror="this.style.display='none'" alt="Kabonix logo"></div>
      </a>
      <div><div class="sb-name">KABONIX</div><div class="sb-sub">FOUNDATION</div></div>
    </div>
    <nav class="sb-nav">
        ${items.map(i=>`<a class="nav-item${state.route===i.key?' active':''}" data-route="${i.key}">
          <span class="nav-icon">${i.icon}</span><span class="nav-label">${esc(i.label)}</span></a>`).join('')}
    </nav>
    <div class="sb-foot">
      <a class="nav-item" data-route="profile"><span class="nav-icon">👤</span>${esc(state.user.name.split(' ')[0])}</a>
      <button class="sb-logout" id="logout-btn">Sign out</button>
    </div>
  </aside>
  <main class="main-area" id="main">${contentHtml}</main>
</div>`;
    root.querySelectorAll('.nav-item[data-route]').forEach(el => el.onclick = e => { e.preventDefault(); nav(el.dataset.route); });
    document.getElementById('logout-btn').onclick = logout;

    // Mobile drawer only — the desktop sidebar is always visible.
    const sbToggle = document.getElementById('sb-toggle');
    const appShell = document.querySelector('.app-shell');
    if (sbToggle && appShell) {
      sbToggle.onclick = () => appShell.classList.toggle('sidebar-open');
    }
    if (appShell) {
      appShell.addEventListener('click', e => {
        if (!appShell.classList.contains('sidebar-open')) return;
        if (e.target.closest('.sidebar') || e.target.closest('#sb-toggle')) return;
        appShell.classList.remove('sidebar-open');
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') appShell.classList.remove('sidebar-open');
      });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 800) appShell.classList.remove('sidebar-open');
      });
    }
  }

  function pageHead(title, sub='') {
    return `<div class="page-head"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
  }

  function card(content, cls='') { return `<div class="card ${cls}">${content}</div>`; }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async function renderDashboard() {
    shell(`${pageHead('Dashboard','Loading…')}`, 'dashboard');
    let stats = {};
    try { stats = await api('/admin/stats'); } catch {}

    const me = state.user;
    const roleNames = state.roles.map(r=>r.name).join(', ')||'No roles assigned';

    shell(`
      ${pageHead('Dashboard', `Welcome back, ${me.name.split(' ')[0]}. ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}.`)}
      <div class="stat-row">
        ${statCard('Active staff',     stats.activeUsers       ?? '—', '👥')}
        ${statCard('Submissions',      stats.submissions        ?? '—', '📋')}
        ${statCard('Audit events (24h)',stats.auditEventsToday ?? '—', '📜')}
        ${statCard('New enquiries',    stats.newContactMessages ?? '—', '✉️')}
      </div>
      <div class="two-col">
        ${card(`<h3>Your access</h3>
          <p class="meta">${esc(roleNames)}</p>
          <table class="mini-table"><tbody>
            ${Object.entries(groupPerms(state.permissions)).map(([m,ls])=>`<tr><td>${esc(m)}</td><td>${ls.map(l=>`<span class="badge">${l}</span>`).join('')}</td></tr>`).join('')}
          </tbody></table>`, 'card-inner')}
        ${card(`<h3>Quick actions</h3>
          <div class="quick-actions">
            ${can('data_collection','create') ? `<button class="qa-btn" onclick="nav('forms')">📋 Submit M&E form</button>` : ''}
            ${can('admin','create')           ? `<button class="qa-btn" onclick="nav('users')">➕ Invite staff member</button>` : ''}
            ${can('admin','view')             ? `<button class="qa-btn" onclick="nav('messages')">✉️ View contact messages</button>` : ''}
            ${can('admin','view')||can('data_collection','approve') ? `<button class="qa-btn" onclick="nav('audit')">📜 View audit log</button>` : ''}
          </div>`, 'card-inner')}
      </div>
      <div style="margin-top:8px" class="meta">Platform: Postgres + PostGIS · Migrations applied: ${stats.migrationsApplied ?? '—'} · <a href="${WEBSITE_URL}" target="_blank">Public website ↗</a></div>
    `, 'dashboard');
  }

  function statCard(label, value, icon) {
    return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${esc(String(value))}</div><div class="stat-label">${esc(label)}</div></div>`;
  }

  function groupPerms(perms) {
    const out={};
    for(const p of perms) (out[p.module]??=[]).push(p.level);
    return out;
  }

  // ── Staff & Users ───────────────────────────────────────────────────────────
  async function renderUsers() {
    shell(pageHead('Staff & Users','Manage team members, roles and account status.'), 'users');
    if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

    let users=[], roles=[];
    try {
      const [usersRes, rolesRes] = await Promise.all([api('/admin/users'), api('/admin/roles')]);
      users = asArray(usersRes, 'users');
      roles = asArray(rolesRes, 'roles');
    }
    catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

    document.getElementById('main').innerHTML = `
      ${pageHead('Staff & Users', `${users.length} accounts · ${users.filter(u=>u.is_active).length} active`)}
      ${can('admin','create') ? `
      <div class="card card-inner" style="margin-bottom:18px">
        <h3>Invite new staff member</h3>
        <div class="form-row">
          <div class="field"><label>Full name</label><input id="inv-name" placeholder="Jane Doe"></div>
          <div class="field"><label>Email</label><input id="inv-email" type="email" placeholder="jane@kabonix.org"></div>
          <div class="field"><label>Initial role</label>
            <select id="inv-role">
              <option value="">No role yet</option>
              ${roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}
            </select></div>
          <div class="field" style="align-self:flex-end">
            <button class="btn-primary" id="invite-btn">Send invite</button>
          </div>
        </div>
      </div>` : ''}
      <div class="card card-table">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>MFA</th><th>Last active</th><th>Actions</th></tr></thead>
          <tbody id="users-tbody">
            ${users.map(u => {
              const userRoles = u.roles || [];
              return `<tr data-uid="${u.id}">
              <td><strong>${esc(u.name)}</strong></td>
              <td class="meta">${esc(u.email)}</td>
              <td>${userRoles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'<span class="meta">none</span>'}</td>
              <td><span class="status-dot ${u.is_active?'active':'inactive'}"></span>${u.is_active?'Active':'Inactive'}</td>
              <td>${u.mfa_enabled?'✅ On':'⬜ Off'}</td>
              <td class="meta">${ago(u.last_active)}</td>
              <td class="action-cell">
                ${can('admin','edit') ? `
                <select class="inline-select" data-uid="${u.id}" id="role-sel-${u.id}">
                  ${roles.map(r=>`<option value="${esc(r.key)}" ${userRoles.some(ur=>ur.key===r.key)?'selected':''}>${esc(r.name)}</option>`).join('')}
                </select>
                <button class="btn-sm" data-assign="${u.id}">Assign</button>
                ${u.is_active && u.id!==state.user.id ? `<button class="btn-sm btn-danger" data-deactivate="${u.id}">Deactivate</button>` : ''}
                ${!u.is_active ? `<button class="btn-sm btn-ok" data-reactivate="${u.id}">Reactivate</button>` : ''}
                ` : ''}
              </td>
            </tr>`; }).join('')}
          </tbody>
        </table>
      </div>`;

    if (can('admin','create')) {
      document.getElementById('invite-btn').onclick = async () => {
        const name  = document.getElementById('inv-name').value.trim();
        const email = document.getElementById('inv-email').value.trim();
        const role  = document.getElementById('inv-role').value;
        try {
          await api('/admin/users/invite',{method:'POST',body:{name,email,roleKey:role||undefined}});
          toast('Invitation sent — check the API console for the dev email link.');
          renderUsers();
        } catch(e) { toast(e.message, true); }
      };
    }

    document.querySelectorAll('[data-assign]').forEach(btn => btn.onclick = async () => {
      const uid = Number(btn.dataset.assign);
      const roleKey = document.getElementById(`role-sel-${uid}`).value;
      try { await api(`/admin/users/${uid}/roles`,{method:'PUT',body:{roleKeys:[roleKey]}}); toast('Role updated.'); renderUsers(); }
      catch(e) { toast(e.message, true); }
    });
    document.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Deactivate this user? Their active sessions will be revoked.')) return;
      try { await api(`/admin/users/${btn.dataset.deactivate}/deactivate`,{method:'POST',body:{}}); toast('User deactivated.'); renderUsers(); }
      catch(e) { toast(e.message, true); }
    });
    document.querySelectorAll('[data-reactivate]').forEach(btn => btn.onclick = async () => {
      try { await api(`/admin/users/${btn.dataset.reactivate}/reactivate`,{method:'POST',body:{}}); toast('User reactivated.'); renderUsers(); }
      catch(e) { toast(e.message, true); }
    });
  }

  // ── Roles & Permissions ────────────────────────────────────────────────────
  async function renderRoles() {
    shell(pageHead('Roles & Permissions', 'Loading…'), 'roles');
    if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

    let data = { roles:[], modules:[], levels:[] };
    try { data = await api('/admin/roles'); }
    catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

    const roles   = asArray(data, 'roles');
    const modules = Array.isArray(data?.modules) ? data.modules : [];
    const levels  = Array.isArray(data?.levels)  ? data.levels  : [];

    document.getElementById('main').innerHTML = `
      ${pageHead('Roles & Permissions', `${roles.length} roles · tick cells to grant a permission · click Save to apply`)}
      ${can('admin','create') ? `
      <div class="card card-inner" style="margin-bottom:18px">
        <h3>Create new role</h3>
        <div class="form-row">
          <div class="field"><label>Key (lowercase, underscores)</label><input id="r-key" placeholder="e.g. data_analyst"></div>
          <div class="field"><label>Display name</label><input id="r-name" placeholder="Data Analyst"></div>
          <div class="field"><label>Description</label><input id="r-desc" placeholder="Optional"></div>
          <div class="field" style="align-self:flex-end"><button class="btn-primary" id="create-role-btn">Create role</button></div>
        </div>
      </div>` : ''}
      ${roles.map(role => {
        const permSet = new Set((role.permissions||[]).map(p=>`${p.module}:${p.level}`));
        return `<div class="card card-table" style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:22px 24px 0">
            <div><strong>${esc(role.name)}</strong> <span class="meta">${esc(role.key)}</span></div>
            ${can('admin','approve') ? `<button class="btn-primary btn-sm" data-save-role="${role.id}">Save permissions</button>` : ''}
          </div>
          <table class="perm-table">
            <thead><tr><th>Module</th>${levels.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead>
            <tbody>
              ${modules.map(mod=>`<tr>
                <td class="mod-name">${esc(mod)}</td>
                ${levels.map(lev=>`<td class="perm-cell">
                  <input type="checkbox" data-role="${role.id}" data-mod="${mod}" data-lev="${lev}"
                    ${permSet.has(`${mod}:${lev}`) ? 'checked' : ''}
                    ${can('admin','approve') ? '' : 'disabled'}>
                </td>`).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }).join('')}`;

    if (can('admin','create')) {
      document.getElementById('create-role-btn').onclick = async () => {
        try {
          await api('/admin/roles',{method:'POST',body:{
            key: document.getElementById('r-key').value.trim(),
            name: document.getElementById('r-name').value.trim(),
            description: document.getElementById('r-desc').value.trim()||undefined,
          }});
          toast('Role created.'); renderRoles();
        } catch(e) { toast(e.message, true); }
      };
    }

    document.querySelectorAll('[data-save-role]').forEach(btn => btn.onclick = async () => {
      const roleId = Number(btn.dataset.saveRole);
      const perms = [...document.querySelectorAll(`input[data-role="${roleId}"]:checked`)]
        .map(cb=>({ module: cb.dataset.mod, level: cb.dataset.lev }));
      try {
        await api(`/admin/roles/${roleId}/permissions`,{method:'PUT',body:{permissions:perms}});
        toast(`Permissions saved (${perms.length} granted).`);
      } catch(e) { toast(e.message, true); }
    });
  }

  // ── System Config ──────────────────────────────────────────────────────────
  async function renderConfig() {
    shell(pageHead('System Configuration', 'Loading…'), 'config');
    if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

    let cfg=[], prefs={};
    try {
      cfg = asArray(await api('/admin/config'), 'config');
      prefs = await api('/admin/notifications/preferences').catch(()=>({}));
    } catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

    document.getElementById('main').innerHTML = `
      ${pageHead('System Configuration', 'Platform-wide settings managed by Foundation admin — no developer required.')}
      <div class="two-col">
        <div>
          <div class="card card-inner">
            <h3>Platform settings</h3>
            ${cfg.map(c => `<div class="cfg-row" data-key="${esc(c.key)}">
              <div class="cfg-label">
                <strong>${esc(c.label)}</strong>
                ${c.description ? `<span class="meta">${esc(c.description)}</span>` : ''}
              </div>
              <div class="cfg-control">
                ${cfgControl(c)}
                ${can('admin','edit') ? `<button class="btn-sm" data-cfg="${esc(c.key)}">Save</button>` : ''}
              </div>
            </div>`).join('')}
          </div>
        </div>
        <div>
          <div class="card card-inner">
            <h3>My notification preferences</h3>
            <p class="meta" style="margin-bottom:14px">These apply to your account only.</p>
            ${[
              ['email',    '✉️', 'Email notifications'],
              ['sms',      '📱', 'SMS notifications'],
              ['whatsapp', '💬', 'WhatsApp notifications'],
              ['in_app',   '🔔', 'In-app notifications'],
            ].map(([k,icon,label])=>`
              <div class="cfg-row">
                <div class="cfg-label"><strong>${icon} ${label}</strong></div>
                <div class="cfg-control">
                  <label class="toggle-wrap">
                    <input type="checkbox" class="pref-toggle" data-pref="${k}" ${prefs[k]?'checked':''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>`).join('')}
            <div style="margin-top:16px">
              <button class="btn-primary" id="save-prefs-btn">Save preferences</button>
            </div>
          </div>
          <div class="card card-inner" style="margin-top:16px">
            <h3>Migration status</h3>
            <p class="meta">Applied SQL migrations tracked in <code>schema_migrations</code>.</p>
            <div id="migration-list" style="margin-top:10px">Loading…</div>
          </div>
        </div>
      </div>`;

    pool_migrations_display();

    if (can('admin','edit')) {
      document.querySelectorAll('[data-cfg]').forEach(btn => btn.onclick = async () => {
        const key = btn.dataset.cfg;
        const row = document.querySelector(`.cfg-row[data-key="${key}"]`);
        const ctrl = row.querySelector('.cfg-value');
        const value = ctrl.type === 'checkbox' ? String(ctrl.checked) : ctrl.value;
        try {
          await api(`/admin/config/${key}`,{method:'PATCH',body:{value}});
          toast(`${key} saved.`);
        } catch(e) { toast(e.message, true); }
      });
    }

    document.getElementById('save-prefs-btn').onclick = async () => {
      const nextPrefs = {
        email:    document.querySelector('[data-pref="email"]').checked,
        sms:      document.querySelector('[data-pref="sms"]').checked,
        whatsapp: document.querySelector('[data-pref="whatsapp"]').checked,
        in_app:   document.querySelector('[data-pref="in_app"]').checked,
        subscriptions: ['approval_required','submission_flagged','project_milestone_due','system_alert'],
      };
      try { await api('/admin/notifications/preferences',{method:'PUT',body:nextPrefs}); toast('Notification preferences saved.'); }
      catch(e) { toast(e.message, true); }
    };
  }

  async function pool_migrations_display() {
    const el = document.getElementById('migration-list');
    if (!el) return;
    try {
      const stats = await api('/admin/stats');
      el.innerHTML = `<span class="badge badge-ok">✓ ${stats.migrationsApplied} migrations applied</span>`;
    } catch { el.textContent = 'Could not load.'; }
  }

  function cfgControl(c) {
    if (c.type === 'boolean') return `<label class="toggle-wrap"><input type="checkbox" class="cfg-value" ${c.value==='true'?'checked':''}><span class="toggle-slider"></span></label>`;
    if (c.type === 'select')  return `<select class="cfg-value">${(c.options||'').split(',').map(o=>`<option value="${esc(o.trim())}" ${c.value===o.trim()?'selected':''}>${esc(o.trim())}</option>`).join('')}</select>`;
    return `<input type="${c.type==='number'?'number':'text'}" class="cfg-value" value="${esc(c.value)}">`;
  }

  // ── Audit Log ───────────────────────────────────────────────────────────────
  async function renderAudit() {
    shell(pageHead('Audit Log','Full record of who changed what, and when.'), 'audit');
    if (!can('admin','view') && !can('data_collection','approve'))
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

    let data = { rows:[], total:0 };
    const filters = { action:'', entity:'', userId:'', from:'', to:'' };
    async function load() {
      const qs = new URLSearchParams({ limit:200, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) });
      data = await api(`/admin/audit?${qs}`).catch(()=>({ rows:[], total:0 }));
      renderTable();
    }

    function renderTable() {
      const tbody = document.getElementById('audit-tbody');
      if (!tbody) return;
      if (!data.rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="meta" style="text-align:center;padding:24px">No records match the current filters.</td></tr>`; return; }
      tbody.innerHTML = data.rows.map(r=>`<tr>
        <td class="meta">${new Date(r.created_at).toLocaleString('en-GB')}</td>
        <td>${esc(r.user_email||'—')}</td>
        <td><span class="badge badge-action">${esc(r.action)}</span></td>
        <td>${esc(r.entity)}${r.entity_id?` <span class="meta">#${r.entity_id}</span>`:''}</td>
        <td class="meta">${esc(r.detail||'—')}</td>
      </tr>`).join('');
      document.getElementById('audit-count').textContent = `${data.rows.length} of ${data.total} events`;
    }

    document.getElementById('main').innerHTML = `
      ${pageHead('Audit Log', 'Every create, edit, delete, login and permission-denied event is recorded here.')}
      <div class="card card-inner" style="margin-bottom:16px">
        <div class="form-row">
          <div class="field"><label>Action</label>
            <select id="f-action">
              <option value="">All actions</option>
              ${['login','login_failed','logout','create','edit','delete','approve','export','permission_denied','mfa_enabled','mfa_disabled','token_reuse_detected','password_reset_requested','email_verified']
                .map(a=>`<option value="${a}">${a}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Entity type</label>
            <input id="f-entity" placeholder="e.g. user, me_submission">
          </div>
          <div class="field"><label>From</label><input type="date" id="f-from"></div>
          <div class="field"><label>To</label><input type="date" id="f-to"></div>
          <div class="field" style="align-self:flex-end">
            <button class="btn-primary" id="filter-btn">Apply filters</button>
          </div>
        </div>
      </div>
      <div class="card card-table">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding:22px 24px 0">
          <span class="meta" id="audit-count">Loading…</span>
          <button class="btn-sm" id="refresh-btn">↻ Refresh</button>
        </div>
        <table>
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
          <tbody id="audit-tbody"><tr><td colspan="6" class="meta" style="text-align:center;padding:24px">Loading…</td></tr></tbody>
        </table>
      </div>`;

    document.getElementById('filter-btn').onclick = () => {
      filters.action = document.getElementById('f-action').value;
      filters.entity = document.getElementById('f-entity').value.trim();
      filters.from   = document.getElementById('f-from').value;
      filters.to     = document.getElementById('f-to').value;
      load();
    };
    document.getElementById('refresh-btn').onclick = load;
    load();
  }

  // ── M&E Forms ───────────────────────────────────────────────────────────────
  async function renderForms() {
    shell(pageHead('M&E Data Collection','Household Baseline Survey and field data submission.'), 'forms');
    let forms=[], submissions=[];
    try {
      forms       = asArray(await api('/forms'), 'forms');
      submissions = asArray(await api('/submissions'), 'submissions');
    }
    catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

    const form = forms[0];
    const canCreate = can('data_collection','create');

    document.getElementById('main').innerHTML = `
      ${pageHead('M&E Data Collection', form ? form.description : 'No forms available.')}
      ${form && canCreate ? `
      <div class="card card-inner" style="margin-bottom:18px">
        <h3>${esc(form.title)}</h3>
        <form id="me-form">
          <div class="form-grid">${(form.schema||[]).map(fieldHtml).join('')}</div>
          <button class="btn-primary" type="submit">Submit survey</button>
        </form>
      </div>` : form ? `<div class="card card-inner" style="margin-bottom:18px"><p class="meta">Your role can view submissions but not create new ones.</p></div>` : ''}
      <div class="card card-table">
        <h3 style="padding:22px 24px 0">Recent submissions (${submissions.length})</h3>
        ${!submissions.length ? `<p class="meta" style="padding:12px 24px 22px">No submissions yet.</p>` : `
        <table>
          <thead><tr><th>Beneficiary</th><th>Village</th><th>Programme</th><th>Submitted by</th><th>When</th></tr></thead>
          <tbody>${submissions.map(s=>`<tr>
            <td>${esc(s.answers?.beneficiary_name||'—')}</td>
            <td>${esc(s.answers?.village||'—')}</td>
            <td>${esc(s.answers?.programme_area||'—')}</td>
            <td class="meta">${esc(s.submitted_by_email)}</td>
            <td class="meta">${ago(s.submitted_at)}</td>
          </tr>`).join('')}</tbody>
        </table>`}
      </div>`;

    if (form && canCreate) {
      document.getElementById('me-form').onsubmit = async e => {
        e.preventDefault();
        const answers = {};
        for (const f of form.schema||[]) {
          const el = document.getElementById('f_'+f.id);
          if (el) answers[f.id] = f.type==='number' ? (el.value?Number(el.value):undefined) : el.value;
        }
        try {
          await api('/submissions',{method:'POST',body:{formKey:form.key,answers}});
          toast('Submission recorded.'); renderForms();
        } catch(e) { toast(e.message, true); }
      };
    }
  }

  function fieldHtml(f) {
    const req = f.required ? 'required' : '';
    if (f.type==='select') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
      <select id="f_${f.id}" ${req}><option value="">Select…</option>
      ${(f.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
    if (f.type==='textarea') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
      <textarea id="f_${f.id}" ${req}></textarea></div>`;
    return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
      <input id="f_${f.id}" type="${f.type==='number'?'number':'text'}" ${req}></div>`;
  }

  // ── Contact Messages ────────────────────────────────────────────────────────
  async function renderMessages() {
    shell(pageHead('Contact Messages','Website enquiry inbox.'), 'messages');
    if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

    let msgs=[];
    try { msgs = asArray(await api('/admin/contact-messages'), 'messages'); }
    catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

    const statusColor = { new:'badge-new', read:'badge-role', replied:'badge-ok', archived:'meta' };

    document.getElementById('main').innerHTML = `
      ${pageHead('Contact Messages', `${msgs.filter(m=>m.status==='new').length} new · ${msgs.length} total`)}
      <div class="card card-table">
        <table>
          <thead><tr><th>From</th><th>Organisation</th><th>Subject</th><th>Status</th><th>Received</th><th>Actions</th></tr></thead>
          <tbody>
            ${msgs.map(m=>`<tr>
              <td><strong>${esc(m.full_name)}</strong><br><span class="meta">${esc(m.email)}</span></td>
              <td class="meta">${esc(m.organisation||'—')}</td>
              <td>${esc(m.subject)}<br><span class="meta">${esc((m.message||'').slice(0,80))}${(m.message||'').length>80?'…':''}</span></td>
              <td><span class="badge ${statusColor[m.status]||''}">${m.status}</span></td>
              <td class="meta">${ago(m.created_at)}</td>
              <td class="action-cell">
                ${['read','replied','archived'].map(s=>
                  s!==m.status ? `<button class="btn-sm" data-msg="${m.id}" data-status="${s}">${s}</button>` : ''
                ).join('')}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    document.querySelectorAll('[data-msg]').forEach(btn => btn.onclick = async () => {
      try {
        await api(`/admin/contact-messages/${btn.dataset.msg}/status`,{method:'PATCH',body:{status:btn.dataset.status}});
        toast(`Marked as ${btn.dataset.status}.`); renderMessages();
      } catch(e) { toast(e.message, true); }
    });
  }

  // ── Profile / MFA setup ─────────────────────────────────────────────────────
  async function renderProfile() {
    shell(pageHead('My Profile','Account settings and two-factor authentication.'), 'profile');
    const u = state.user;

    document.getElementById('main').innerHTML = `
      ${pageHead('My Profile')}
      <div class="two-col">
        <div class="card card-inner">
          <h3>Account details</h3>
          <dl class="detail-list">
            <dt>Name</dt><dd>${esc(u.name)}</dd>
            <dt>Email</dt><dd>${esc(u.email)}</dd>
            <dt>Email verified</dt><dd>${u.emailVerified?'✅ Yes':'⚠️ Not verified'}</dd>
            <dt>MFA</dt><dd>${u.mfaEnabled?'✅ Enabled':'⬜ Disabled'}</dd>
            <dt>Roles</dt><dd>${state.roles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'None'}</dd>
          </dl>
        </div>
        <div class="card card-inner">
          <h3>Two-factor authentication</h3>
          ${u.mfaEnabled ? `
            <p class="meta" style="margin-bottom:14px">MFA is active. Enter your current code to disable it.</p>
            <div class="field"><label>Current authentication code</label><input id="mfa-dis-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
            <button class="btn-primary btn-danger" id="dis-mfa-btn">Disable MFA</button>
          ` : `
            <p class="meta" style="margin-bottom:14px">Scan the QR code (or copy the key) into your authenticator app, then enter the 6-digit code to confirm.</p>
            <button class="btn-primary" id="setup-mfa-btn">Set up MFA</button>
            <div id="mfa-setup-area"></div>
          `}
          <div id="mfa-msg" style="margin-top:10px"></div>
        </div>
      </div>`;

    if (u.mfaEnabled) {
      document.getElementById('dis-mfa-btn').onclick = async () => {
        const code = document.getElementById('mfa-dis-code').value.trim();
        try {
          await api('/auth/mfa/disable',{method:'POST',body:{code}});
          toast('MFA disabled.'); const d = await api('/auth/me'); state.user=d.user; renderProfile();
        } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
      };
    } else {
      document.getElementById('setup-mfa-btn').onclick = async () => {
        try {
          const d = await api('/auth/mfa/setup',{method:'POST',body:{}});
          document.getElementById('mfa-setup-area').innerHTML = `
            <div style="margin-top:16px">
              <p class="meta">Scan with your authenticator app, or enter the key manually:</p>
              <code style="font-size:13px;background:#f3f5f1;padding:6px 10px;border-radius:4px;display:block;margin:10px 0;word-break:break-all">${esc(d.secret)}</code>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(d.otpauthUri)}" alt="QR code" style="border:1px solid var(--line);border-radius:6px;display:block;margin:10px 0">
              <div class="field"><label>Enter the 6-digit code to confirm</label><input id="mfa-confirm-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
              <button class="btn-primary" id="confirm-mfa-btn">Enable MFA</button>
            </div>`;
          document.getElementById('confirm-mfa-btn').onclick = async () => {
            const code = document.getElementById('mfa-confirm-code').value.trim();
            try {
              await api('/auth/mfa/enable',{method:'POST',body:{code}});
              toast('MFA enabled!'); const d2 = await api('/auth/me'); state.user=d2.user; renderProfile();
            } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
          };
        } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
      };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function forbidden() { return `<div class="card card-inner meta">You don't have permission to view this section. Contact your Foundation Admin to request access.</div>`; }
  function errBox(msg) { return `<div class="card card-inner" style="color:var(--danger)">${esc(msg)}</div>`; }

  // ── Boot ────────────────────────────────────────────────────────────────────
  tryRestoreSession().catch(e => {
    console.error('[app] boot failed:', e);
    if (root) root.innerHTML = '<pre style="padding:24px;font:13px/1.5 Menlo,Consolas,monospace;color:#a4372c;white-space:pre-wrap">Boot failed: '
      + (e?.stack || e?.message || String(e)) + '</pre>';
  });
})();
