// audit.js — Audit log for form submissions & writes (Sprint 01, Step 7)
// Postgres version.

import { pool } from './db.js';

export async function logAction({ userId, userEmail, action, entity, entityId, detail }) {
  await pool.query(
    `INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId ?? null, userEmail ?? null, action, entity, entityId ?? null, detail ?? null]
  );
}

export async function listAuditLog({ limit = 100 } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM audit_log ORDER BY id DESC LIMIT $1',
    [limit]
  );
  return rows;
}
