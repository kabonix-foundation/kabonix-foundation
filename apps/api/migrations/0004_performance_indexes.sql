-- Performance indexes for filtered, ordered collection endpoints.
-- Partial indexes keep inactive/unpublished rows out of the hot paths.

CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS posts_published_order_idx
  ON posts (published_at DESC, id DESC)
  WHERE published = TRUE;

CREATE INDEX IF NOT EXISTS impact_stories_published_order_idx
  ON impact_stories (id DESC)
  WHERE published = TRUE;

CREATE INDEX IF NOT EXISTS partners_active_order_idx
  ON partners (display_order, id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS contact_messages_status_order_idx
  ON contact_messages (status, id DESC);

CREATE INDEX IF NOT EXISTS audit_log_created_id_idx
  ON audit_log (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS audit_log_action_id_idx
  ON audit_log (action, id DESC);

CREATE INDEX IF NOT EXISTS audit_log_entity_id_idx
  ON audit_log (entity, id DESC);

CREATE INDEX IF NOT EXISTS audit_log_user_id_idx
  ON audit_log (user_id, id DESC);

CREATE INDEX IF NOT EXISTS me_submissions_submitted_id_idx
  ON me_submissions (submitted_at DESC, id DESC);
