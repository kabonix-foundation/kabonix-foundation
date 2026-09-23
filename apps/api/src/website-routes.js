// website-routes.js — Admin CMS for the public website.
//
// Handles /api/admin/website/* — create, edit and delete the News & Events
// posts, Impact Stories and Partners that appear on the public site.
//
// All routes require the `website` module in the RBAC matrix:
//   website:view     read the full list, including unpublished items
//   website:create   create a new item
//   website:edit     modify an existing item
//   website:approve  publish / unpublish, or delete

import { pool } from './db.js';
import { logAction } from './audit.js';

const VALID_POST_TYPES    = ['news', 'event', 'publication'];
const VALID_PARTNER_TYPES = ['partner', 'donor', 'government'];

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

export async function handleWebsiteAdmin({ parts, method, body, user, res, send, checkPermission }) {
  // parts: ['api','admin','website', resource, id?, action?]
  if (parts[2] !== 'website') return null;

  const resource = parts[3];             // posts | impact-stories | partners
  const id       = parts[4] ? Number(parts[4]) : null;

  // ── Posts: news / events / publications ────────────────────────────────
  if (resource === 'posts') {
    if (!id && method === 'GET') {
      const f = await checkPermission(user, 'website', 'view');
      if (f) return send(res, f.status, f.body);
      const { rows } = await pool.query(`SELECT * FROM posts ORDER BY id DESC`);
      return send(res, 200, { posts: rows });
    }

    if (!id && method === 'POST') {
      const f = await checkPermission(user, 'website', 'create');
      if (f) return send(res, f.status, f.body);

      const {
        type, title_en, title_sw, summary_en, summary_sw,
        body_en = '', body_sw = '',
        image_url = null, event_date = null, event_venue = null,
        doc_url = null, published = false,
      } = body;

      if (!VALID_POST_TYPES.includes(type)) {
        return send(res, 400, { error: `type must be one of: ${VALID_POST_TYPES.join(', ')}` });
      }
      if (!title_en || !title_sw || !summary_en || !summary_sw) {
        return send(res, 400, { error: 'title_en, title_sw, summary_en, summary_sw are required' });
      }

      const slug = `${slugify(title_en)}-${Date.now().toString(36)}`;

      const { rows } = await pool.query(
        `INSERT INTO posts
           (type, slug, title_en, title_sw, summary_en, summary_sw,
            body_en, body_sw, image_url, event_date, event_venue, doc_url,
            published, published_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 CASE WHEN $13 THEN now() ELSE NULL END, $14)
         RETURNING *`,
        [type, slug, title_en, title_sw, summary_en, summary_sw,
         body_en, body_sw, image_url, event_date || null, event_venue || null,
         doc_url || null, !!published, user.id]
      );

      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'create', entity: 'website_post', entityId: rows[0].id,
        detail: `${type}: ${title_en}`,
      });
      return send(res, 201, rows[0]);
    }

    if (id && method === 'PUT') {
      const f = await checkPermission(user, 'website', 'edit');
      if (f) return send(res, f.status, f.body);

      const {
        type, title_en, title_sw, summary_en, summary_sw,
        body_en, body_sw, image_url,
        event_date, event_venue, doc_url, published,
      } = body;

      const { rows: existing } = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
      if (!existing[0]) return send(res, 404, { error: 'Post not found' });
      const p = existing[0];

      const newPublished = published === undefined ? p.published : !!published;
      const publishedAt  = newPublished && !p.published ? new Date() : p.published_at;

      const { rows } = await pool.query(
        `UPDATE posts SET
           type=$1, title_en=$2, title_sw=$3, summary_en=$4, summary_sw=$5,
           body_en=$6, body_sw=$7, image_url=$8,
           event_date=$9, event_venue=$10, doc_url=$11,
           published=$12, published_at=$13
         WHERE id=$14 RETURNING *`,
        [
          type || p.type, title_en || p.title_en, title_sw || p.title_sw,
          summary_en || p.summary_en, summary_sw || p.summary_sw,
          body_en ?? p.body_en, body_sw ?? p.body_sw,
          image_url !== undefined ? image_url : p.image_url,
          event_date !== undefined ? event_date : p.event_date,
          event_venue !== undefined ? event_venue : p.event_venue,
          doc_url !== undefined ? doc_url : p.doc_url,
          newPublished, publishedAt, id,
        ]
      );
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'edit', entity: 'website_post', entityId: id,
        detail: title_en || p.title_en,
      });
      return send(res, 200, rows[0]);
    }

    if (id && method === 'DELETE') {
      const f = await checkPermission(user, 'website', 'approve');
      if (f) return send(res, f.status, f.body);
      const { rows } = await pool.query('SELECT title_en FROM posts WHERE id = $1', [id]);
      if (!rows[0]) return send(res, 404, { error: 'Post not found' });
      await pool.query('DELETE FROM posts WHERE id = $1', [id]);
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'delete', entity: 'website_post', entityId: id,
        detail: rows[0].title_en,
      });
      return send(res, 200, { ok: true });
    }
  }

  // ── Impact stories ─────────────────────────────────────────────────────
  if (resource === 'impact-stories') {
    if (!id && method === 'GET') {
      const f = await checkPermission(user, 'website', 'view');
      if (f) return send(res, f.status, f.body);
      const { rows } = await pool.query(`SELECT * FROM impact_stories ORDER BY id DESC`);
      return send(res, 200, { stories: rows });
    }

    if (!id && method === 'POST') {
      const f = await checkPermission(user, 'website', 'create');
      if (f) return send(res, f.status, f.body);

      const {
        title_en, title_sw, body_en, body_sw,
        programme = null, location = null,
        metric_label = null, metric_value = null,
        image_url = null, published = false,
      } = body;

      if (!title_en || !title_sw || !body_en || !body_sw) {
        return send(res, 400, { error: 'title_en, title_sw, body_en, body_sw are required' });
      }

      const slug = `${slugify(title_en)}-${Date.now().toString(36)}`;

      const { rows } = await pool.query(
        `INSERT INTO impact_stories
           (slug, title_en, title_sw, body_en, body_sw,
            programme, location, metric_label, metric_value,
            image_url, published, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [slug, title_en, title_sw, body_en, body_sw,
         programme, location, metric_label, metric_value,
         image_url, !!published, user.id]
      );
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'create', entity: 'impact_story', entityId: rows[0].id,
        detail: title_en,
      });
      return send(res, 201, rows[0]);
    }

    if (id && method === 'PUT') {
      const f = await checkPermission(user, 'website', 'edit');
      if (f) return send(res, f.status, f.body);

      const {
        title_en, title_sw, body_en, body_sw,
        programme, location, metric_label, metric_value,
        image_url, published,
      } = body;

      const { rows: existing } = await pool.query('SELECT * FROM impact_stories WHERE id = $1', [id]);
      if (!existing[0]) return send(res, 404, { error: 'Story not found' });
      const s = existing[0];

      const { rows } = await pool.query(
        `UPDATE impact_stories SET
           title_en=$1, title_sw=$2, body_en=$3, body_sw=$4,
           programme=$5, location=$6, metric_label=$7, metric_value=$8,
           image_url=$9, published=$10
         WHERE id=$11 RETURNING *`,
        [
          title_en || s.title_en, title_sw || s.title_sw,
          body_en ?? s.body_en, body_sw ?? s.body_sw,
          programme    !== undefined ? programme    : s.programme,
          location     !== undefined ? location     : s.location,
          metric_label !== undefined ? metric_label : s.metric_label,
          metric_value !== undefined ? metric_value : s.metric_value,
          image_url    !== undefined ? image_url    : s.image_url,
          published    === undefined ? s.published  : !!published,
          id,
        ]
      );
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'edit', entity: 'impact_story', entityId: id,
        detail: title_en || s.title_en,
      });
      return send(res, 200, rows[0]);
    }

    if (id && method === 'DELETE') {
      const f = await checkPermission(user, 'website', 'approve');
      if (f) return send(res, f.status, f.body);
      const { rows } = await pool.query('SELECT title_en FROM impact_stories WHERE id = $1', [id]);
      if (!rows[0]) return send(res, 404, { error: 'Story not found' });
      await pool.query('DELETE FROM impact_stories WHERE id = $1', [id]);
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'delete', entity: 'impact_story', entityId: id,
        detail: rows[0].title_en,
      });
      return send(res, 200, { ok: true });
    }
  }

  // ── Partners ───────────────────────────────────────────────────────────
  if (resource === 'partners') {
    if (!id && method === 'GET') {
      const f = await checkPermission(user, 'website', 'view');
      if (f) return send(res, f.status, f.body);
      const { rows } = await pool.query(`SELECT * FROM partners ORDER BY display_order, id`);
      return send(res, 200, { partners: rows });
    }

    if (!id && method === 'POST') {
      const f = await checkPermission(user, 'website', 'create');
      if (f) return send(res, f.status, f.body);

      const {
        name, type, logo_url = null, website_url = null,
        description_en = null, description_sw = null,
        display_order = 0, is_active = true,
      } = body;

      if (!name) return send(res, 400, { error: 'name is required' });
      if (!VALID_PARTNER_TYPES.includes(type)) {
        return send(res, 400, { error: `type must be one of: ${VALID_PARTNER_TYPES.join(', ')}` });
      }

      const { rows } = await pool.query(
        `INSERT INTO partners
           (name, type, logo_url, website_url, description_en, description_sw,
            display_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [name, type, logo_url, website_url, description_en, description_sw,
         Number(display_order) || 0, !!is_active]
      );
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'create', entity: 'partner', entityId: rows[0].id,
        detail: name,
      });
      return send(res, 201, rows[0]);
    }

    if (id && method === 'PUT') {
      const f = await checkPermission(user, 'website', 'edit');
      if (f) return send(res, f.status, f.body);
      const {
        name, type, logo_url, website_url,
        description_en, description_sw, display_order, is_active,
      } = body;
      const { rows: existing } = await pool.query('SELECT * FROM partners WHERE id = $1', [id]);
      if (!existing[0]) return send(res, 404, { error: 'Partner not found' });
      const p = existing[0];
      const { rows } = await pool.query(
        `UPDATE partners SET
           name=$1, type=$2, logo_url=$3, website_url=$4,
           description_en=$5, description_sw=$6,
           display_order=$7, is_active=$8
         WHERE id=$9 RETURNING *`,
        [
          name || p.name, type || p.type,
          logo_url       !== undefined ? logo_url       : p.logo_url,
          website_url    !== undefined ? website_url    : p.website_url,
          description_en !== undefined ? description_en : p.description_en,
          description_sw !== undefined ? description_sw : p.description_sw,
          display_order  !== undefined ? Number(display_order) : p.display_order,
          is_active      === undefined ? p.is_active    : !!is_active,
          id,
        ]
      );
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'edit', entity: 'partner', entityId: id,
        detail: name || p.name,
      });
      return send(res, 200, rows[0]);
    }

    if (id && method === 'DELETE') {
      const f = await checkPermission(user, 'website', 'approve');
      if (f) return send(res, f.status, f.body);
      const { rows } = await pool.query('SELECT name FROM partners WHERE id = $1', [id]);
      if (!rows[0]) return send(res, 404, { error: 'Partner not found' });
      await pool.query('DELETE FROM partners WHERE id = $1', [id]);
      await logAction({
        userId: user.id, userEmail: user.email,
        action: 'delete', entity: 'partner', entityId: id,
        detail: rows[0].name,
      });
      return send(res, 200, { ok: true });
    }
  }

  return null;
}
