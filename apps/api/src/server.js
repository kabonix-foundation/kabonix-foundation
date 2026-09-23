// server.js — Kabonix Foundation API
// PostgreSQL + PostGIS. Plain node:http — no framework.

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
import { sendMail, mailerStatus } from './mailer.js';
import { can, loadPermissions, loadRoles, requirePermission } from './rbac.js';
import { logAction }     from './audit.js';
import { handleAdminRoute } from './admin-routes.js';
import { isConfigured as s3Configured, createUploadUrl, s3Status } from './s3.js';

const PORT        = process.env.PORT        || 4000;
const WEB_ORIGIN  = process.env.WEB_ORIGIN  || 'http://localhost:3001';
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? new Set(ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()))
  : null;

const CONTACT_INBOX = process.env.CONTACT_INBOX || 'kabonixfoundation@gmail.com';

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
    id: u.id, name: u.name, email: u.email, phone: u.phone || null,
    emailVerified: !!u.email_verified_at,
    mfaEnabled:    !!u.mfa_enabled,
    pendingEmail:  u.pending_email || null,
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
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password is too long';
  return null;
}

function validatePhone(phone) {
  const s = String(phone || '').trim();
  if (s.length < 6 || s.length > 32) return 'Please enter a valid phone number.';
  if (!/^[+\d][\d\s\-()]+$/.test(s)) return 'Please enter a valid phone number.';
  return null;
}

async function sendVerificationEmail(userId, toEmail, name, purpose) {
  const token = generateOpaqueToken();
  await pool.query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, purpose) VALUES ($1,$2,$3,$4)',
    [userId, hashOpaqueToken(token), newExpiry(VERIFY_TOKEN_TTL_MS), purpose]
  );
  const devLink = `${WEB_ORIGIN}/?verifyToken=${token}`;
  const subject = purpose === 'email_change'
    ? 'Confirm your new Kabonix email address'
    : 'Verify your Kabonix email address';
  const bodyText = purpose === 'email_change'
    ? `Hello ${name},\n\nYou asked to change your Kabonix email address to this one.\nClick the link below to confirm the change.\nIf you did not request this, ignore this email — your address will not be changed.\n\nThis link expires in 24 hours.`
    : `Hello ${name},\n\nThank you for registering with the Kabonix Foundation Digital Platform.\nPlease confirm your email address using the link below. After verifying, an administrator will review your account.\n\nThis link expires in 24 hours.`;
  await sendMail({ to: toEmail, subject, bodyText, devLink });
  return token;
}

// ── Data-quality helpers ──────────────────────────────────────────────────────

function normaliseName(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function beneficiaryDeDupHash(name, village) {
  return crypto.createHash('md5')
    .update(`${normaliseName(name)}|${normaliseName(village)}`)
    .digest('hex');
}

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
    // ── Health ────────────────────────────────────────────────────────────────
    if (parts[0] === 'health') {
      return send(res, 200, {
        ok: true, service: 'kabonix-api', db: 'postgres+postgis',
        time: new Date().toISOString(),
        s3: s3Status(),
      });
    }

    // ── GET /api/status — public, service banner ──────────────────────────────
    if (parts[1] === 'status' && req.method === 'GET') {
      try {
        const { rows } = await pool.query(
          "SELECT value, updated_at FROM system_config WHERE key = 'service_banner_message'"
        );
        const msg = (rows[0]?.value || '').trim();
        return send(res, 200, {
          banner: msg ? { message: msg, updatedAt: rows[0].updated_at } : null,
        });
      } catch {
        return send(res, 200, { banner: null });
      }
    }

    // ── SMTP diagnostic (temporary — remove before production) ────────────────
    if (parts[1] === '_mailtest' && req.method === 'GET') {
      const status = mailerStatus();
      const to = url.searchParams.get('to');
      if (url.searchParams.get('send') !== '1' || !to) {
        return send(res, 200, { status, hint: 'Add ?send=1&to=your@email.com to attempt a real send.' });
      }
      const result = await sendMail({
        to,
        subject: 'Kabonix SMTP test',
        bodyText: `Sent at ${new Date().toISOString()}.\nIf you see this, SMTP is working end to end.`,
      });
      return send(res, 200, { status, sendResult: result });
    }

    // ── S3 diagnostic (temporary — remove before production) ──────────────────
    if (parts[1] === '_s3test' && req.method === 'GET') {
      const status = s3Status();
      const type = url.searchParams.get('type') || 'image/jpeg';
      if (url.searchParams.get('upload') !== '1') {
        return send(res, 200, { status, hint: 'Add ?upload=1&type=image/jpeg to get a real pre-signed URL.' });
      }
      try {
        const result = await createUploadUrl({ fileType: type });
        return send(res, 200, { status, result });
      } catch (err) {
        return send(res, 500, { status, error: err.message });
      }
    }

    if (parts[0] !== 'api') return send(res, 404, { error: 'Not found' });

    // ═══ PUBLIC ROUTES ════════════════════════════════════════════════════════

    // ── POST /api/auth/register ───────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'register' && req.method === 'POST') {
      const { name = '', email = '', password = '', phone = '' } = await readBody(req);

      const cleanName = String(name).trim();
      if (!cleanName || cleanName.length > 120) {
        return send(res, 400, { error: 'Please enter your full name.' });
      }
      if (!validateEmail(email)) {
        return send(res, 400, { error: 'Please enter a valid email address.' });
      }
      const phoneErr = validatePhone(phone);
      if (phoneErr) return send(res, 400, { error: phoneErr });
      const pwErr = validatePassword(password);
      if (pwErr) return send(res, 400, { error: pwErr });

      const cleanPhone = String(phone).trim();

      const existing = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      if (existing.rows[0]) {
        return send(res, 409, { error: 'An account with that email already exists. Try signing in or resetting your password.' });
      }

      const { hash, salt } = hashPassword(password);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, password_salt, phone, is_active, approval_status)
         VALUES ($1, $2, $3, $4, $5, FALSE, 'pending') RETURNING id`,
        [cleanName, email.toLowerCase(), hash, salt, cleanPhone]
      );
      const newId = rows[0].id;

      await pool.query(
        'INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [newId]
      );

      await sendVerificationEmail(newId, email.toLowerCase(), cleanName, 'signup');

      await sendMail({
        to: CONTACT_INBOX,
        subject: `New registration awaiting approval: ${cleanName}`,
        bodyText: `${cleanName} <${email}> — ${cleanPhone}\n\nhas registered on the Kabonix staff portal.\n\nThey have been sent a verification link. Once they verify their email, their account will appear in Staff & Users awaiting your approval.`,
      });

      await logAction({
        userId: newId, userEmail: email, action: 'register',
        entity: 'user', entityId: newId,
        detail: 'self-registration pending approval + email verification',
      });

      return send(res, 201, {
        ok: true,
        message: 'Registration submitted. Check your email for a verification link, then wait for administrator approval.',
      });
    }

    // ── POST /api/auth/login ──────────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'login' && req.method === 'POST') {
      const { email = '', password = '' } = await readBody(req);

      if (!validateEmail(email)) {
        return send(res, 400, { error: 'Please enter a valid email address' });
      }

      const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      const user = rows[0];

      const badCreds = { error: 'Invalid email or password' };

      if (!user) {
        await logAction({ userId: null, userEmail: email, action: 'login_failed', entity: 'user', detail: 'no account' });
        return send(res, 401, badCreds);
      }

      if (!verifyPassword(password, user.password_salt, user.password_hash)) {
        await logAction({ userId: user.id, userEmail: email, action: 'login_failed', entity: 'user', entityId: user.id, detail: 'wrong password' });
        return send(res, 401, badCreds);
      }

      if (!user.email_verified_at) {
        await logAction({ userId: user.id, userEmail: user.email, action: 'login_blocked', entity: 'user', entityId: user.id, detail: 'email not verified' });
        return send(res, 403, {
          error: 'Please verify your email address. Check your inbox for the verification link.',
          code: 'email_not_verified',
        });
      }

      if (user.approval_status === 'pending') {
        await logAction({ userId: user.id, userEmail: user.email, action: 'login_blocked', entity: 'user', entityId: user.id, detail: 'awaiting approval' });
        return send(res, 403, {
          error: 'Your account is awaiting administrator approval. You will be able to sign in once it has been reviewed.',
          code: 'pending_approval',
        });
      }
      if (user.approval_status === 'rejected') {
        await logAction({ userId: user.id, userEmail: user.email, action: 'login_blocked', entity: 'user', entityId: user.id, detail: 'registration rejected' });
        return send(res, 403, {
          error: 'Your registration was not approved. Contact a Foundation administrator for more information.',
          code: 'rejected',
        });
      }

      if (!user.is_active) {
        await logAction({ userId: user.id, userEmail: user.email, action: 'login_failed', entity: 'user', entityId: user.id, detail: 'account inactive' });
        return send(res, 401, { error: 'Your account has been deactivated. Contact a Foundation administrator.' });
      }

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

    // ── POST /api/auth/mfa/challenge ──────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'challenge' && req.method === 'POST') {
      const { challengeToken = '', code = '' } = await readBody(req);
      const { rows } = await pool.query(
        'SELECT * FROM mfa_challenges WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [hashOpaqueToken(challengeToken)]
      );
      const challenge = rows[0];
      if (!challenge) return send(res, 401, { error: 'Challenge expired or invalid. Please sign in again.' });

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

    // ── POST /api/auth/refresh ────────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'refresh' && req.method === 'POST') {
      const { refreshToken = '' } = await readBody(req);
      const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hashOpaqueToken(refreshToken)]);
      const stored = rows[0];

      if (!stored || stored.expires_at < new Date()) {
        return send(res, 401, { error: 'Session expired. Please sign in again.' });
      }
      if (stored.revoked_at) {
        await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [stored.family_id]);
        await logAction({ userId: stored.user_id, action: 'token_reuse_detected', entity: 'refresh_token', entityId: stored.id, detail: 'family revoked' });
        return send(res, 401, { error: 'Session invalidated for security. Please sign in again.' });
      }

      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [stored.id]);
      const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id = $1', [stored.user_id]);
      const user = uRows[0];
      if (!user || !user.is_active || user.approval_status !== 'approved' || !user.email_verified_at) {
        return send(res, 401, { error: 'Account is no longer active' });
      }

      const { accessToken, refreshToken: newRT } = await issueTokenPair(user, stored.family_id);
      await logAction({ userId: user.id, userEmail: user.email, action: 'token_refreshed', entity: 'refresh_token', entityId: stored.id });
      return send(res, 200, { accessToken, refreshToken: newRT });
    }

    // ── POST /api/auth/logout ─────────────────────────────────────────────────
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

    // ── POST /api/auth/password/forgot ────────────────────────────────────────
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
      return send(res, 200, { ok: true, message: 'If that email exists in our system, a reset link has been sent.' });
    }

    // ── POST /api/auth/password/reset ─────────────────────────────────────────
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
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [reset.user_id]);
      const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [reset.user_id]);
      await logAction({ userId: reset.user_id, userEmail: u[0]?.email, action: 'password_reset_completed', entity: 'user', entityId: reset.user_id, detail: 'all sessions revoked' });
      return send(res, 200, { ok: true });
    }

    // ── POST /api/auth/email/verify ───────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'email' && parts[3] === 'verify' && req.method === 'POST') {
      const { token = '' } = await readBody(req);
      const { rows } = await pool.query(
        'SELECT * FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [hashOpaqueToken(token)]
      );
      const v = rows[0];
      if (!v) return send(res, 400, { error: 'This verification link is invalid or has expired. Please request a new one.' });

      const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id = $1', [v.user_id]);
      const target = uRows[0];
      if (!target) return send(res, 400, { error: 'The account for this link no longer exists.' });

      if (v.purpose === 'email_change') {
        if (!target.pending_email) {
          return send(res, 400, { error: 'This change request is no longer valid. Please start the email change again.' });
        }
        const taken = await pool.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
          [target.pending_email, target.id]
        );
        if (taken.rows[0]) {
          return send(res, 409, { error: 'That email address is now in use by another account. Please choose a different address.' });
        }
        await pool.query(
          'UPDATE users SET email = $1, pending_email = NULL, email_verified_at = now() WHERE id = $2',
          [target.pending_email, target.id]
        );
        await pool.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [v.id]);
        await logAction({ userId: target.id, userEmail: target.pending_email, action: 'email_changed', entity: 'user', entityId: target.id, detail: `from ${target.email}` });
        return send(res, 200, { ok: true, message: 'Your email address has been updated.' });
      }

      await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [target.id]);
      await pool.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [v.id]);
      await logAction({ userId: target.id, userEmail: target.email, action: 'email_verified', entity: 'user', entityId: target.id });
      return send(res, 200, { ok: true, message: 'Your email has been verified.' });
    }

    // ── POST /api/auth/email/resend ───────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'email' && parts[3] === 'resend' && req.method === 'POST') {
      const { email = '' } = await readBody(req);
      if (!validateEmail(email)) {
        return send(res, 400, { error: 'Please provide a valid email address.' });
      }
      const { rows } = await pool.query(
        'SELECT id, name, email, email_verified_at FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      const target = rows[0];
      if (target && !target.email_verified_at) {
        await sendVerificationEmail(target.id, target.email, target.name, 'signup');
      }
      return send(res, 200, {
        ok: true,
        message: 'If an unverified account exists for that address, a new link has been sent.',
      });
    }

    // ═══ PUBLIC WEBSITE CONTENT ═══════════════════════════════════════════════
    const lang = url.searchParams.get('lang') === 'sw' ? 'sw' : 'en';

    if (parts[1] === 'website') {
      if (parts[2] === 'posts' && !parts[3] && req.method === 'GET') {
        const type = url.searchParams.get('type');
        const { rows } = await pool.query(
          `SELECT id, type, slug,
                  title_${lang}   AS title,
                  summary_${lang} AS summary,
                  image_url,
                  event_date, event_venue, doc_url, published_at
           FROM posts WHERE published = TRUE ${type ? 'AND type = $1' : ''} ORDER BY published_at DESC`,
          type ? [type] : []
        );
        return send(res, 200, rows);
      }

      if (parts[2] === 'posts' && parts[3] && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id, type, slug,
                  title_${lang}   AS title,
                  summary_${lang} AS summary,
                  body_${lang}    AS body,
                  image_url,
                  event_date, event_venue, doc_url, published_at
           FROM posts WHERE slug = $1 AND published = TRUE`,
          [parts[3]]
        );
        if (!rows[0]) return send(res, 404, { error: 'Not found' });
        return send(res, 200, rows[0]);
      }

      if (parts[2] === 'impact-stories' && !parts[3] && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id, slug, title_${lang} AS title, body_${lang} AS body,
                  programme, location, metric_label, metric_value, image_url
           FROM impact_stories WHERE published = TRUE ORDER BY id DESC`
        );
        return send(res, 200, rows);
      }

      if (parts[2] === 'partners' && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id, name, type, logo_url, website_url,
                  description_${lang} AS description, display_order
           FROM partners WHERE is_active = TRUE ORDER BY display_order`
        );
        return send(res, 200, rows);
      }

      if (parts[2] === 'contact' && req.method === 'POST') {
        const { full_name = '', email = '', organisation = '', subject = '', message = '', lang: msgLang = 'en' } = await readBody(req);
        if (!full_name || !email || !subject || !message) {
          return send(res, 400, { error: 'full_name, email, subject and message are required' });
        }
        if (!validateEmail(email)) return send(res, 400, { error: 'Please provide a valid email address' });
        if (message.length > 4000) return send(res, 400, { error: 'Message is too long (max 4000 characters)' });

        const { rows } = await pool.query(
          'INSERT INTO contact_messages (full_name,email,organisation,subject,message,lang) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [full_name, email, organisation || null, subject, message, msgLang]
        );
        await logAction({ userId: null, userEmail: email, action: 'create', entity: 'contact_message', entityId: rows[0].id, detail: subject });
        await sendMail({
          to:       CONTACT_INBOX,
          replyTo:  email,
          subject:  `Website enquiry: ${subject}`,
          bodyText: `From: ${full_name} <${email}>${organisation ? ` (${organisation})` : ''}\n\n${message}`,
        });
        return send(res, 201, { ok: true, message: 'Thank you — we will be in touch shortly.' });
      }

      return send(res, 404, { error: 'Not found' });
    }

    // ═══ AUTH WALL ════════════════════════════════════════════════════════════
    const user = await getAuthUser(req);
    if (!user) return send(res, 401, { error: 'Not authenticated. Please sign in.' });

    // ── GET /api/auth/me ──────────────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'me' && req.method === 'GET') {
      return send(res, 200, {
        user:        publicUser(user),
        roles:       await loadRoles(user.id),
        permissions: await loadPermissions(user.id),
      });
    }

    // ── PUT /api/auth/profile ─────────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'profile' && req.method === 'PUT') {
      const { name = '' } = await readBody(req);
      const cleanName = String(name).trim();
      if (!cleanName || cleanName.length > 120) {
        return send(res, 400, { error: 'Please enter a name between 1 and 120 characters.' });
      }
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [cleanName, user.id]);
      await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user', entityId: user.id, detail: 'profile name updated' });
      const { rows: fresh } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      return send(res, 200, { user: publicUser(fresh[0]) });
    }

    // ── PUT /api/auth/password ────────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'password' && req.method === 'PUT') {
      const { currentPassword = '', newPassword = '' } = await readBody(req);
      const pwErr = validatePassword(newPassword);
      if (pwErr) return send(res, 400, { error: pwErr });

      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      const fresh = rows[0];
      if (!verifyPassword(currentPassword, fresh.password_salt, fresh.password_hash)) {
        await logAction({ userId: user.id, userEmail: user.email, action: 'password_change_failed', entity: 'user', entityId: user.id, detail: 'wrong current password' });
        return send(res, 400, { error: 'Current password is incorrect.' });
      }

      const { hash, salt } = hashPassword(newPassword);
      await pool.query('UPDATE users SET password_hash = $1, password_salt = $2 WHERE id = $3', [hash, salt, user.id]);
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
      await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user', entityId: user.id, detail: 'password changed' });
      return send(res, 200, { ok: true, message: 'Password updated. Other sessions have been signed out.' });
    }

    // ── POST /api/auth/email/change ───────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'email' && parts[3] === 'change' && req.method === 'POST') {
      const { newEmail = '', currentPassword = '' } = await readBody(req);
      if (!validateEmail(newEmail)) return send(res, 400, { error: 'Please enter a valid email address.' });

      const target = newEmail.toLowerCase();
      if (target === user.email.toLowerCase()) {
        return send(res, 400, { error: 'That is already your current email address.' });
      }

      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      if (!verifyPassword(currentPassword, rows[0].password_salt, rows[0].password_hash)) {
        return send(res, 400, { error: 'Current password is incorrect.' });
      }

      const taken = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
        [target, user.id]
      );
      if (taken.rows[0]) return send(res, 409, { error: 'That email address is already in use by another account.' });

      await pool.query('UPDATE users SET pending_email = $1 WHERE id = $2', [target, user.id]);
      await sendVerificationEmail(user.id, target, user.name, 'email_change');
      await logAction({ userId: user.id, userEmail: user.email, action: 'email_change_requested', entity: 'user', entityId: user.id, detail: `→ ${target}` });

      return send(res, 200, {
        ok: true,
        message: `Verification link sent to ${target}. Click it to complete the change. Your current email stays active until then.`,
      });
    }

    // ── POST /api/auth/mfa/setup ──────────────────────────────────────────────
    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'setup' && req.method === 'POST') {
      const secret = generateBase32Secret();
      await pool.query('UPDATE users SET mfa_pending_secret = $1 WHERE id = $2', [secret, user.id]);
      const uri = otpauthUri({ secret, accountEmail: user.email });

      let qrDataUrl = null;
      try {
        const QRCode = (await import('qrcode')).default;
        qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
      } catch (err) {
        console.warn('[mfa] qrcode package unavailable — serving text-only setup:', err.message);
      }

      return send(res, 200, { secret, otpauthUri: uri, qrDataUrl });
    }

    if (parts[1] === 'auth' && parts[2] === 'mfa' && parts[3] === 'enable' && req.method === 'POST') {
      const { code = '' } = await readBody(req);
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

    // ── POST /api/admin/upload-url ────────────────────────────────────────────
    if (parts[1] === 'admin' && parts[2] === 'upload-url' && req.method === 'POST') {
      const denied = await checkPerm(user, 'website', 'create');
      if (denied) return send(res, denied.status, denied.body);

      if (!s3Configured()) {
        return send(res, 503, {
          error: 'Image uploads are not configured on this server. Paste an image URL instead.',
          s3: s3Status(),
        });
      }

      const { fileType } = await readBody(req);
      if (!fileType) return send(res, 400, { error: 'fileType is required (e.g. image/jpeg)' });

      try {
        const result = await createUploadUrl({ fileType });
        return send(res, 200, result);
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }

    // ═══ ADMIN & GOVERNANCE ═══════════════════════════════════════════════════
    if (parts[1] === 'admin') {
      const body = (req.method !== 'GET') ? await readBody(req) : {};
      const result = await handleAdminRoute({ parts, method: req.method, body, user, url, res, send, checkPermission: checkPerm, can });
      if (result !== null) return;
      return send(res, 404, { error: 'Not found' });
    }

    // ── Legacy admin routes ───────────────────────────────────────────────────
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

    // ═══ M&E FORMS & SUBMISSIONS ══════════════════════════════════════════════
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

    if (parts[1] === 'submissions' && parts[2] && req.method === 'GET' && parts[3] !== 'revisions') {
      const denied = await checkPerm(user, 'data_collection', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const { rows } = await pool.query('SELECT * FROM me_submissions WHERE id = $1', [Number(parts[2])]);
      if (!rows[0]) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { ...rows[0], answers: rows[0].answers_json });
    }

    if (parts[1] === 'submissions' && parts[2] && parts[3] === 'revisions' && req.method === 'GET') {
      const denied = await checkPerm(user, 'data_collection', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const id = Number(parts[2]);
      const { rows: subRows } = await pool.query('SELECT id FROM me_submissions WHERE id = $1', [id]);
      if (!subRows[0]) return send(res, 404, { error: 'Submission not found' });
      const { rows } = await pool.query(
        `SELECT r.id, r.revision_no, r.answers_json, r.change_summary, r.changed_at,
                u.name AS changed_by_name, u.email AS changed_by_email
           FROM me_submission_revisions r
           LEFT JOIN users u ON u.id = r.changed_by
          WHERE r.submission_id = $1
          ORDER BY r.revision_no ASC`,
        [id]
      );
      return send(res, 200, { submissionId: id, revisions: rows });
    }

    if (parts[1] === 'submissions' && req.method === 'POST') {
      const denied = await checkPerm(user, 'data_collection', 'create');
      if (denied) return send(res, denied.status, denied.body);
      const { formKey, answers = {}, forceNew = false, changeSummary } = await readBody(req);

      const { rows: fRows } = await pool.query('SELECT * FROM me_forms WHERE key = $1', [formKey]);
      const form = fRows[0];
      if (!form) return send(res, 400, { error: 'Unknown form key' });

      for (const field of form.schema_json) {
        if (field.type === 'map') {
          const problem = validateMapField(field, answers);
          if (problem) return send(res, 400, { error: problem, field: field.id });
          continue;
        }
        const problem = validateFieldValue(field, answers[field.id]);
        if (problem) return send(res, 400, { error: problem, field: field.id });
      }

      let beneficiaryId = null;
      let beneficiaryCreated = false;
      if (answers.beneficiary_name) {
        const dupHash = beneficiaryDeDupHash(answers.beneficiary_name, answers.village);

        if (!forceNew) {
          const { rows: dupes } = await pool.query(
            `SELECT id, full_name, village, programme, created_at
               FROM beneficiaries WHERE de_dup_hash = $1 ORDER BY id DESC LIMIT 1`,
            [dupHash]
          );
          if (dupes[0]) {
            return send(res, 409, {
              error: 'Possible duplicate beneficiary',
              duplicate: dupes[0],
              hint: 'Resubmit with forceNew: true if this is a genuinely distinct person.',
            });
          }
        }

        const hasGps = answers.gps_lat !== undefined && answers.gps_lng !== undefined &&
                       answers.gps_lat !== ''        && answers.gps_lng !== '';

        const { rows: bRows } = await pool.query(
          hasGps
            ? `INSERT INTO beneficiaries
                 (full_name, name_normalised, de_dup_hash, village, programme, created_by, location)
               VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_MakePoint($7,$8),4326)::geography)
               RETURNING id`
            : `INSERT INTO beneficiaries
                 (full_name, name_normalised, de_dup_hash, village, programme, created_by)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          hasGps
            ? [answers.beneficiary_name, normaliseName(answers.beneficiary_name), dupHash,
               answers.village || null, answers.programme_area || null, user.id,
               Number(answers.gps_lng), Number(answers.gps_lat)]
            : [answers.beneficiary_name, normaliseName(answers.beneficiary_name), dupHash,
               answers.village || null, answers.programme_area || null, user.id]
        );
        beneficiaryId = bRows[0].id;
        beneficiaryCreated = true;
      }

      if (answers.village) {
        await pool.query(
          `INSERT INTO sites (name, name_normalised, type, created_by)
           VALUES ($1, $2, 'village', $3) ON CONFLICT DO NOTHING`,
          [answers.village, normaliseName(answers.village), user.id]
        );
      }

      const client = await pool.connect();
      let submissionId;
      try {
        await client.query('BEGIN');
        const { rows: sRows } = await client.query(
          'INSERT INTO me_submissions (form_id, beneficiary_id, submitted_by, answers_json) VALUES ($1,$2,$3,$4) RETURNING id',
          [form.id, beneficiaryId, user.id, JSON.stringify(answers)]
        );
        submissionId = sRows[0].id;
        await client.query(
          `INSERT INTO me_submission_revisions
             (submission_id, revision_no, answers_json, changed_by, change_summary)
           VALUES ($1, 1, $2, $3, $4)`,
          [submissionId, JSON.stringify(answers), user.id, changeSummary || 'initial submission']
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'create', entity: 'me_submission', entityId: submissionId,
        detail: `form: ${form.key}${beneficiaryCreated ? ' (new beneficiary)' : ''}`,
      });

      return send(res, 201, { id: submissionId, revisionNo: 1, beneficiaryCreated, ok: true });
    }

    if (parts[1] === 'submissions' && parts[2] && req.method === 'PATCH') {
      const denied = await checkPerm(user, 'data_collection', 'edit');
      if (denied) return send(res, denied.status, denied.body);
      const id = Number(parts[2]);
      const { answers, changeSummary } = await readBody(req);
      if (!answers || typeof answers !== 'object') {
        return send(res, 400, { error: 'answers object is required' });
      }

      const { rows: subRows } = await pool.query(
        'SELECT s.*, f.schema_json FROM me_submissions s JOIN me_forms f ON f.id = s.form_id WHERE s.id = $1',
        [id]
      );
      const sub = subRows[0];
      if (!sub) return send(res, 404, { error: 'Submission not found' });

      for (const field of sub.schema_json) {
        if (field.type === 'map') {
          const problem = validateMapField(field, answers);
          if (problem) return send(res, 400, { error: problem, field: field.id });
          continue;
        }
        const problem = validateFieldValue(field, answers[field.id]);
        if (problem) return send(res, 400, { error: problem, field: field.id });
      }

      const client = await pool.connect();
      let revisionNo;
      try {
        await client.query('BEGIN');
        const { rows: maxRows } = await client.query(
          'SELECT COALESCE(MAX(revision_no), 0) + 1 AS next FROM me_submission_revisions WHERE submission_id = $1',
          [id]
        );
        revisionNo = maxRows[0].next;
        await client.query(
          `INSERT INTO me_submission_revisions
             (submission_id, revision_no, answers_json, changed_by, change_summary)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, revisionNo, JSON.stringify(answers), user.id, changeSummary || `revision ${revisionNo}`]
        );
        await client.query(
          'UPDATE me_submissions SET answers_json = $1 WHERE id = $2',
          [JSON.stringify(answers), id]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'edit', entity: 'me_submission', entityId: id,
        detail: `revision ${revisionNo}`,
      });
      return send(res, 200, { id, revisionNo, ok: true });
    }

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

    if (parts[1] === 'indicators' && req.method === 'GET') {
      const denied = await checkPerm(user, 'data_collection', 'view');
      if (denied) return send(res, denied.status, denied.body);
      const { rows } = await pool.query('SELECT * FROM indicators WHERE is_active = TRUE ORDER BY code');
      return send(res, 200, rows);
    }

    // ═══ AUDIT LOG ════════════════════════════════════════════════════════════
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
    console.log(`Contact / registration notifications: ${CONTACT_INBOX}`);
    console.log(`S3 uploads: ${s3Configured() ? 'enabled' : 'disabled'}\n`);
  });
}

start().catch(err => {
  console.error('[startup] FAILED:', err.message);
  console.error('Check DATABASE_URL and that Postgres is running.');
  process.exit(1);
});
