// rbac.js — RBAC skeleton (Sprint 01, Step 4), Postgres version
//
// Cross-cutting rule from the build-order doc: "Every API endpoint checks
// permissions server-side, not just in the UI." This module is that check.
// Module/level combinations mirror Section 8.1 of the architecture doc
// (View / Create / Edit / Approve / Export per module).

import { pool } from './db.js';

export async function loadPermissions(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.module, p.level
     FROM permissions p
     JOIN user_roles ur ON ur.role_id = p.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  return rows;
}

export async function loadRoles(userId) {
  const { rows } = await pool.query(
    `SELECT r.key, r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [userId]
  );
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
