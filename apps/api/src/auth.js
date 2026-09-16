// auth.js — Authentication core (Sprint 01 Step 3, hardened in Sprint 02)
//
// - Passwords: scrypt (Node built-in crypto), per-user random salt.
// - Access tokens: real 3-part JWTs (header.payload.signature, HS256),
//   hand-rolled with crypto so no external JWT library is required, but
//   the wire format is standard and readable by any JWT decoder. Short-
//   lived (15 min) — meant to be silently refreshed.
// - Refresh tokens: opaque random tokens, only their SHA-256 hash is
//   stored server-side (in the `refresh_tokens` table via db.js), with
//   rotation on every use and reuse detection (Section 6, Identity & Access).

import crypto from 'node:crypto';

const JWT_SECRET = process.env.KABONIX_JWT_SECRET || 'dev-only-secret-change-in-production';
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;        // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;            // 1 hour
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;      // 24 hours
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;           // 5 minutes

// ---------------- Passwords ----------------

export function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash);
  const b = Buffer.from(expectedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------- Access tokens (JWT, HS256) ----------------

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function createAccessToken(user) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Date.now();
  const payload = {
    sub: user.id,
    email: user.email,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ACCESS_TOKEN_TTL_MS) / 1000),
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

export function verifyAccessToken(token) {
  if (!token || token.split('.').length !== 3) return null;
  const [headerB64, payloadB64, signature] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------- Opaque tokens (refresh / reset / verify / MFA challenge) ----------------
// Same pattern for all four: generate a random token, return it to the
// caller once, and only ever store its SHA-256 hash. Losing the DB doesn't
// leak usable tokens.

export function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newExpiry(ttlMs) {
  return new Date(Date.now() + ttlMs);
}
