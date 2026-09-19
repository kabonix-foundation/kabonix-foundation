// rbac.js — RBAC helpers with short-lived per-process caching.
// Permission changes are reflected after CACHE_TTL_MS or explicit invalidation.

import { pool } from './db.js';

const CACHE_TTL_MS = 30_000;
const permissionCache = new Map();
const roleCache = new Map();

function cached(cache, key) {
  const entry = cache.get(key);
  return entry && entry.expiresAt > Date.now() ? entry.value : null;
}

export function invalidateUserPermissions(userId) {
  permissionCache.delete(userId);
  roleCache.delete(userId);
}

export function invalidateAllPermissions() {
  permissionCache.clear();
  roleCache.clear();
}

export async function loadPermissions(userId) {
  const hit = cached(permissionCache, userId);
  if (hit) return hit;

  const { rows } = await pool.query(
    `SELECT DISTINCT p.module, p.level
     FROM permissions p
     JOIN user_roles ur ON ur.role_id = p.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  permissionCache.set(userId, { value: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

export async function loadRoles(userId) {
  const hit = cached(roleCache, userId);
  if (hit) return hit;

  const { rows } = await pool.query(
    `SELECT r.key, r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [userId]
  );
  roleCache.set(userId, { value: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

export async function can(userId, module, level) {
  const perms = await loadPermissions(userId);
  return perms.some((p) => p.module === module && p.level === level);
}

/** Returns null if authorized, or an { status, body } error to send back. */
export async function requirePermission(userId, module, level) {
  if (!(await can(userId, module, level))) {
    return {
      status: 403,
      body: { error: `Forbidden: requires '${level}' on module '${module}'` },
    };
  }
  return null;
}
