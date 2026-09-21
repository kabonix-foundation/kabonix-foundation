// admin-routes.js — Admin & Governance module API (Step 3)
//
// Registers all /api/admin/* routes onto the existing request handler.
// Called from server.js with: import { handleAdminRoute } from './admin-routes.js'

import { pool } from './db.js';
import { hashPassword, generateOpaqueToken, hashOpaqueToken, newExpiry, VERIFY_TOKEN_TTL_MS } from './auth.js';
import { logAction } from './audit.js';
import { loadRoles, loadPermissions, invalidateUserPermissions, invalidateAllPermissions } from './rbac.js';
import { sendMail } from './mailer.js';

const MODULES = ['admin','data_collection','programme_mgmt','community','blue_economy','carbon','ai_intelligence','website'];
const LEVELS  = ['view','create','edit','approve','export'];

export async function handleAdminRoute({ parts, method, body, user, url, res, send, checkPermission, can }) {
  // parts[0]='api' parts[1]='admin' parts[2]=resource parts[3]=id parts[4]=action

  // ── Dashboard stats ──────────────────────────────────────────────────────
  if (parts[2] === 'stats' && method === 'GET') {
    const f = await checkPermission(user, 'admin', 'view');
    if (f) return send(res, f.status, f.body);

    const [users, roles, auditToday, submissions, contacts, migrations, pending] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE is_active=TRUE`),
      pool.query(`SELECT COUNT(*)::int AS c FROM roles`),
      pool.query(`SELECT COUNT(*)::int AS c FROM audit_log WHERE created_at > now() - INTERVAL '24 hours'`),
      pool.query(`SELECT COUNT(*)::int AS c FROM me_submissions`),
      pool.query(`SELECT COUNT(*)::int AS c FROM contact_messages WHERE status='new'`),
      pool.query(`SELECT COUNT(*)::int AS c FROM schema_migrations`),
      pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE approval_status='pending'`),
    ]);
    return send(res, 200, {
      activeUsers:        users.rows[0].c,
      roles:              roles.rows[0].c,
      auditEventsToday:   auditToday.rows[0].c,
      submissions:        submissions.rows[0].c,
      newContactMessages: contacts.rows[0].c,
      migrationsApplied:  migrations.rows[0].c,
      pendingApprovals:   pending.rows[0].c,
    });
  }

  // ── System configuration ─────────────────────────────────────────────────
  if (parts[2] === 'config' && !parts[3] && method === 'GET') {
    const f = await checkPermission(user, 'admin', 'view');
    if (f) return send(res, f.status, f.body);
    const { rows } = await pool.query('SELECT * FROM system_config ORDER BY key');
    return send(res, 200, rows);
  }

  if (parts[2] === 'config' && parts[3] && method === 'PATCH') {
    const f = await checkPermission(user, 'admin', 'edit');
    if (f) return send(res, f.status, f.body);
    const key = parts[3];
    const { value } = body;
    if (value === undefined) return send(res, 400, { error: 'value is required' });
    const { rows } = await pool.query(
      `UPDATE system_config SET value=$1, updated_by=$2, updated_at=now() WHERE key=$3 RETURNING *`,
      [String(value), user.id, key]
    );
    if (!rows[0]) return send(res, 404, { error: 'Config key not found' });
    await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'system_config', detail: `${key} = ${value}` });
    return send(res, 200, rows[0]);
  }

  // ── Roles & permission matrix ────────────────────────────────────────────
  if (parts[2] === 'roles' && !parts[3] && method === 'GET') {
    const f = await checkPermission(user, 'admin', 'view');
    if (f) return send(res, f.status, f.body);
    const { rows: roles } = await pool.query('SELECT * FROM roles ORDER BY id');
    const { rows: perms } = await pool.query('SELECT * FROM permissions ORDER BY role_id, module, level');
    const withMatrix = roles.map(r => ({
      ...r,
      permissions: perms.filter(p => p.role_id === r.id).map(p => ({ module: p.module, level: p.level })),
    }));
    return send(res, 200, { roles: withMatrix, modules: MODULES, levels: LEVELS });
  }

  if (parts[2] === 'roles' && !parts[3] && method === 'POST') {
    const f = await checkPermission(user, 'admin', 'create');
    if (f) return send(res, f.status, f.body);
    const { key, name, description } = body;
    if (!key || !name) return send(res, 400, { error: 'key and name are required' });
    if (!/^[a-z_]+$/.test(key)) return send(res, 400, { error: 'key must be lowercase letters and underscores only' });
    const { rows } = await pool.query(
      'INSERT INTO roles (key, name, description) VALUES ($1,$2,$3) RETURNING *',
      [key, name, description || null]
    );
    await logAction({ userId: user.id, userEmail: user.email, action: 'create', entity: 'role', entityId: rows[0].id, detail: key });
    return send(res, 201, rows[0]);
  }

  if (parts[2] === 'roles' && parts[3] && parts[4] === 'permissions' && method === 'PUT') {
    const f = await checkPermission(user, 'admin', 'approve');
    if (f) return send(res, f.status, f.body);
    const roleId = Number(parts[3]);
    const incoming = (body.permissions || []).filter(
      p => MODULES.includes(p.module) && LEVELS.includes(p.level)
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM permissions WHERE role_id=$1', [roleId]);
      for (const p of incoming) {
        await client.query(
          'INSERT INTO permissions (role_id, module, level) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [roleId, p.module, p.level]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    invalidateAllPermissions();

    await logAction({ userId: user.id, userEmail: user.email, action: 'approve', entity: 'role_permissions', entityId: roleId, detail: `set ${incoming.length} permissions` });
    return send(res, 200, { ok: true, count: incoming.length });
  }

  // ── Staff management ─────────────────────────────────────────────────────
  if (parts[2] === 'users' && !parts[3] && method === 'GET') {
    const f = await checkPermission(user, 'admin', 'view');
    if (f) return send(res, f.status, f.body);
    const { rows: users } = await pool.query(`
      SELECT u.id, u.name, u.email, u.is_active, u.email_verified_at,
             u.mfa_enabled, u.created_at, u.approval_status,
             (SELECT created_at FROM audit_log WHERE user_id=u.id ORDER BY id DESC LIMIT 1) AS last_active
      FROM users u ORDER BY u.id
    `);
    const { rows: roleRows } = await pool.query(`
      SELECT ur.user_id, r.id, r.key, r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    `);
    return send(res, 200, users.map(u => ({
      ...u,
      roles: roleRows.filter(r => r.user_id === u.id).map(r => ({ id: r.id, key: r.key, name: r.name })),
    })));
  }

  if (parts[2] === 'users' && parts[3] === 'invite' && method === 'POST') {
    const f = await checkPermission(user, 'admin', 'create');
    if (f) return send(res, f.status, f.body);
    const { name, email, roleKey } = body;
    if (!name || !email) return send(res, 400, { error: 'name and email are required' });
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows[0]) return send(res, 409, { error: 'A user with that email already exists' });

    const tempPassword = generateOpaqueToken().slice(0, 12);
    const { hash, salt } = hashPassword(tempPassword);
    // Admin-invited users skip the approval gate — the invite itself is the approval.
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, password_salt, is_active, approval_status)
       VALUES ($1,$2,$3,$4, TRUE, 'approved') RETURNING id`,
      [name, email, hash, salt]
    );
    const newId = rows[0].id;

    if (roleKey) {
      const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE key=$1', [roleKey]);
      if (roleRows[0]) {
        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [newId, roleRows[0].id]);
      }
    }

    const verifyToken = generateOpaqueToken();
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [newId, hashOpaqueToken(verifyToken), newExpiry(VERIFY_TOKEN_TTL_MS)]
    );

    await sendMail({
      to: email,
      subject: 'You have been invited to Kabonix Foundation Digital Platform',
      bodyText: `Hello ${name},\n\nYou have been added to the Kabonix Foundation Digital Platform by ${user.name}.\n\nTemporary password: ${tempPassword}\n\nPlease sign in, verify your email and set a new password.`,
      devLink: `http://localhost:3000/?verifyToken=${verifyToken}`,
    });

    await pool.query(
      'INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [newId]
    );

    await logAction({ userId: user.id, userEmail: user.email, action: 'create', entity: 'user', entityId: newId, detail: `invited ${email}${roleKey ? ` as ${roleKey}` : ''}` });
    return send(res, 201, { id: newId, tempPassword, message: 'Invitation sent. Temp password shown here only — dev build.' });
  }

  // ── Pending registrations ────────────────────────────────────────────────
  // List accounts waiting for approval. Returned separately so the portal
  // can show a dedicated card without scanning the full user list.
  if (parts[2] === 'users' && parts[3] === 'pending' && !parts[4] && method === 'GET') {
    const f = await checkPermission(user, 'admin', 'view');
    if (f) return send(res, f.status, f.body);
    const { rows } = await pool.query(`
      SELECT id, name, email, created_at
      FROM users
      WHERE approval_status = 'pending'
      ORDER BY created_at ASC
    `);
    return send(res, 200, { users: rows });
  }

  // Approve a self-registered account. Assigns roles in the same transaction
  // so the user is never left active-but-roleless.
  if (parts[2] === 'users' && parts[4] === 'approve' && method === 'POST') {
    const f = await checkPermission(user, 'admin', 'approve');
    if (f) return send(res, f.status, f.body);
    const targetId = Number(parts[3]);
    const { roleKeys = [] } = body;

    const { rows: existing } = await pool.query(
      'SELECT id, name, email, approval_status FROM users WHERE id = $1',
      [targetId]
    );
    if (!existing[0]) return send(res, 404, { error: 'User not found' });
    if (existing[0].approval_status !== 'pending') {
      return send(res, 400, { error: 'This account is not awaiting approval.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET is_active = TRUE, approval_status = 'approved' WHERE id = $1`,
        [targetId]
      );
      if (Array.isArray(roleKeys) && roleKeys.length) {
        const { rows: roleRows } = await client.query(
          'SELECT id FROM roles WHERE key = ANY($1)',
          [roleKeys]
        );
        for (const r of roleRows) {
          await client.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [targetId, r.id]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    invalidateUserPermissions(targetId);

    await logAction({
      userId: user.id, userEmail: user.email,
      action: 'approve', entity: 'user', entityId: targetId,
      detail: `approved registration for ${existing[0].email}${roleKeys.length ? ` as ${roleKeys.join(', ')}` : ''}`,
    });

    // Best-effort notification. sendMail never throws, so an SMTP hiccup
    // won't fail the approval itself.
    await sendMail({
      to: existing[0].email,
      subject: 'Your Kabonix Foundation account has been approved',
      bodyText: `Hello ${existing[0].name},\n\nYour registration on the Kabonix Foundation Digital Platform has been approved.\n\nYou can now sign in with the email address and password you chose at registration.`,
    });

    return send(res, 200, { ok: true });
  }

  // Reject a self-registered account. Soft reject — the row is kept for
  // audit, is_active stays FALSE, and the user cannot sign in. Admins can
  // still hard-delete the row later via DELETE /admin/users/:id.
  if (parts[2] === 'users' && parts[4] === 'reject' && method === 'POST') {
    const f = await checkPermission(user, 'admin', 'approve');
    if (f) return send(res, f.status, f.body);
    const targetId = Number(parts[3]);

    const { rows: existing } = await pool.query(
      'SELECT id, name, email, approval_status FROM users WHERE id = $1',
      [targetId]
    );
    if (!existing[0]) return send(res, 404, { error: 'User not found' });
    if (existing[0].approval_status !== 'pending') {
      return send(res, 400, { error: 'This account is not awaiting approval.' });
    }

    await pool.query(
      `UPDATE users SET is_active = FALSE, approval_status = 'rejected' WHERE id = $1`,
      [targetId]
    );
    invalidateUserPermissions(targetId);

    await logAction({
      userId: user.id, userEmail: user.email,
      action: 'approve', entity: 'user', entityId: targetId,
      detail: `rejected registration for ${existing[0].email}`,
    });

    return send(res, 200, { ok: true });
  }

  if (parts[2] === 'users' && parts[4] === 'deactivate' && method === 'POST') {
    const f = await checkPermission(user, 'admin', 'edit');
    if (f) return send(res, f.status, f.body);
    const targetId = Number(parts[3]);
    if (targetId === user.id) return send(res, 400, { error: 'You cannot deactivate your own account' });
    await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [targetId]);
    await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [targetId]);
    invalidateUserPermissions(targetId);
    await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user', entityId: targetId, detail: 'deactivated' });
    return send(res, 200, { ok: true });
  }

  if (parts[2] === 'users' && parts[4] === 'reactivate' && method === 'POST') {
    const f = await checkPermission(user, 'admin', 'edit');
    if (f) return send(res, f.status, f.body);
    const targetId = Number(parts[3]);
    await pool.query('UPDATE users SET is_active=TRUE WHERE id=$1', [targetId]);
    invalidateUserPermissions(targetId);
    await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user', entityId: targetId, detail: 'reactivated' });
    return send(res, 200, { ok: true });
  }

  // ── Hard delete user ─────────────────────────────────────────────────────
  if (parts[2] === 'users' && parts[3] && !parts[4] && method === 'DELETE') {
    const f = await checkPermission(user, 'admin', 'approve');
    if (f) return send(res, f.status, f.body);
    const targetId = Number(parts[3]);
    if (targetId === user.id) return send(res, 400, { error: 'You cannot delete your own account' });

    const { rows: existing } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [targetId]);
    if (!existing[0]) return send(res, 404, { error: 'User not found' });

    const { rows: subs } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM me_submissions WHERE submitted_by = $1',
      [targetId]
    );
    if (subs[0].c > 0) {
      return send(res, 409, {
        error: `This user has ${subs[0].c} M&E submission(s). Deactivate the account instead — deleting it would orphan the data.`,
      });
    }

    const { rows: bens } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM beneficiaries WHERE created_by = $1',
      [targetId]
    );
    if (bens[0].c > 0) {
      return send(res, 409, {
        error: `This user created ${bens[0].c} beneficiary record(s). Deactivate the account instead.`,
      });
    }

    const { rows: targetRoles } = await pool.query(
      'SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1',
      [targetId]
    );
    if (targetRoles.some(r => r.key === 'super_admin')) {
      const { rows: otherAdmins } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         WHERE r.key = 'super_admin' AND u.is_active = TRUE AND u.id != $1`,
        [targetId]
      );
      if (otherAdmins[0].c === 0) {
        return send(res, 400, { error: 'Cannot delete the last active Super Admin. Promote another user first.' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE audit_log SET user_id = NULL WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM user_roles                WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM refresh_tokens            WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM mfa_challenges            WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM password_reset_tokens     WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM notification_preferences  WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM users                     WHERE id      = $1', [targetId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    invalidateUserPermissions(targetId);
    await logAction({
      userId: user.id, userEmail: user.email,
      action: 'delete', entity: 'user', entityId: targetId,
      detail: `deleted ${existing[0].email}`,
    });
    return send(res, 200, { ok: true });
  }

  if (parts[2] === 'users' && parts[4] === 'roles' && method === 'PUT') {
    const f = await checkPermission(user, 'admin', 'edit');
    if (f) return send(res, f.status, f.body);
    const targetId = Number(parts[3]);
    const { roleKeys } = body;
    if (!Array.isArray(roleKeys)) return send(res, 400, { error: 'roleKeys must be an array' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: roleRows } = await client.query('SELECT id, key FROM roles WHERE key = ANY($1)', [roleKeys]);
      await client.query('DELETE FROM user_roles WHERE user_id=$1', [targetId]);
      for (const r of roleRows) {
        await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [targetId, r.id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    invalidateUserPermissions(targetId);

    await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'user_roles', entityId: targetId, detail: `set roles: ${roleKeys.join(', ')}` });
    return send(res, 200, { ok: true });
  }

  // ── Audit log (filtered) ─────────────────────────────────────────────────
  if (parts[2] === 'audit' && method === 'GET') {
    const isAdminViewer  = await can(user.id, 'admin', 'view');
    const isMealApprover = await can(user.id, 'data_collection', 'approve');
    if (!isAdminViewer && !isMealApprover) {
      await logAction({ userId: user.id, userEmail: user.email, action: 'permission_denied', entity: 'audit_log', detail: "attempted 'view'" });
      return send(res, 403, { error: 'Forbidden' });
    }
    const action   = url.searchParams.get('action') || '';
    const entity   = url.searchParams.get('entity') || '';
    const userId   = url.searchParams.get('userId') || '';
    const from     = url.searchParams.get('from') || '';
    const to       = url.searchParams.get('to') || '';
    const limit    = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
    const offset   = Number(url.searchParams.get('offset') || 0);

    const conditions = ['TRUE'];
    const filterParams = [];
    if (action)  { filterParams.push(action);  conditions.push(`action = $${filterParams.length}`); }
    if (entity)  { filterParams.push(entity);  conditions.push(`entity = $${filterParams.length}`); }
    if (userId)  { filterParams.push(Number(userId)); conditions.push(`user_id = $${filterParams.length}`); }
    if (from)    { filterParams.push(from);    conditions.push(`created_at >= $${filterParams.length}::timestamptz`); }
    if (to)      { filterParams.push(to);      conditions.push(`created_at < ($${filterParams.length}::date + INTERVAL '1 day')`); }

    const whereClause = conditions.join(' AND ');

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE ${whereClause} ORDER BY id DESC LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
      [...filterParams, limit, offset]
    );
    const { rows: total } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM audit_log WHERE ${whereClause}`,
      filterParams
    );
    return send(res, 200, { rows, total: total[0]?.c ?? 0, limit, offset });
  }

  // ── Notification preferences ─────────────────────────────────────────────
  if (parts[2] === 'notifications' && parts[3] === 'preferences' && method === 'GET') {
    const { rows } = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id=$1',
      [user.id]
    );
    if (!rows[0]) {
      await pool.query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      const { rows: r2 } = await pool.query('SELECT * FROM notification_preferences WHERE user_id=$1', [user.id]);
      return send(res, 200, r2[0]);
    }
    return send(res, 200, rows[0]);
  }

  if (parts[2] === 'notifications' && parts[3] === 'preferences' && method === 'PUT') {
    const { email, sms, whatsapp, in_app, subscriptions } = body;
    await pool.query(
      `INSERT INTO notification_preferences (user_id, email, sms, whatsapp, in_app, subscriptions, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (user_id) DO UPDATE
         SET email=$2, sms=$3, whatsapp=$4, in_app=$5, subscriptions=$6, updated_at=now()`,
      [user.id, !!email, !!sms, !!whatsapp, !!in_app, JSON.stringify(subscriptions || [])]
    );
    return send(res, 200, { ok: true });
  }

  // ── Contact messages inbox ───────────────────────────────────────────────
  if (parts[2] === 'contact-messages' && !parts[3] && method === 'GET') {
    const f = await checkPermission(user, 'admin', 'view');
    if (f) return send(res, f.status, f.body);
    const status = url.searchParams.get('status') || '';
    const { rows } = await pool.query(
      status
        ? 'SELECT * FROM contact_messages WHERE status=$1 ORDER BY id DESC LIMIT 100'
        : 'SELECT * FROM contact_messages ORDER BY id DESC LIMIT 100',
      status ? [status] : []
    );
    return send(res, 200, rows);
  }

  if (parts[2] === 'contact-messages' && parts[3] && parts[4] === 'status' && method === 'PATCH') {
    const f = await checkPermission(user, 'admin', 'edit');
    if (f) return send(res, f.status, f.body);
    const { status } = body;
    const allowed = ['new','read','replied','archived'];
    if (!allowed.includes(status)) return send(res, 400, { error: `status must be one of: ${allowed.join(', ')}` });
    await pool.query('UPDATE contact_messages SET status=$1 WHERE id=$2', [status, Number(parts[3])]);
    await logAction({ userId: user.id, userEmail: user.email, action: 'edit', entity: 'contact_message', entityId: Number(parts[3]), detail: `status → ${status}` });
    return send(res, 200, { ok: true });
  }

  return null; // not matched — fall through to 404 in server.js
}
