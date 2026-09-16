-- 0001_identity_rbac_website.sql
-- Sprint 01–02: auth, RBAC, audit log, website module.
-- These tables were created by db.js's initSchema(); this migration makes
-- them officially migration-managed so 0002+ can ALTER them safely.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Identity ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  password_salt      TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at  TIMESTAMPTZ,
  mfa_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret         TEXT,
  mfa_pending_secret TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RBAC ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- levels: view | create | edit | approve | export
CREATE TABLE IF NOT EXISTS permissions (
  id      SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module  TEXT NOT NULL,
  level   TEXT NOT NULL,
  UNIQUE (role_id, module, level)
);

-- ── Audit log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  user_email TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── M&E forms (Sprint 01) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS me_forms (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  schema_json JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS me_submissions (
  id             SERIAL PRIMARY KEY,
  form_id        INTEGER NOT NULL REFERENCES me_forms(id),
  beneficiary_id INTEGER,           -- FK added in 0002 after beneficiaries table exists
  submitted_by   INTEGER NOT NULL REFERENCES users(id),
  answers_json   JSONB NOT NULL,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Website module (Sprint 02) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS posts (
  id           SERIAL PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('news','event','publication')),
  slug         TEXT NOT NULL UNIQUE,
  title_en     TEXT NOT NULL,
  title_sw     TEXT NOT NULL,
  summary_en   TEXT NOT NULL,
  summary_sw   TEXT NOT NULL,
  body_en      TEXT NOT NULL DEFAULT '',
  body_sw      TEXT NOT NULL DEFAULT '',
  event_date   DATE,
  event_venue  TEXT,
  doc_url      TEXT,
  published    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS impact_stories (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title_en     TEXT NOT NULL,
  title_sw     TEXT NOT NULL,
  body_en      TEXT NOT NULL,
  body_sw      TEXT NOT NULL,
  programme    TEXT,
  location     TEXT,
  metric_label TEXT,
  metric_value TEXT,
  published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partners (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('partner','donor','government')),
  logo_url        TEXT,
  website_url     TEXT,
  description_en  TEXT,
  description_sw  TEXT,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id           SERIAL PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  organisation TEXT,
  subject      TEXT NOT NULL,
  message      TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'en',
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','archived')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── System configuration (Step 3) ────────────────────────────────────────
-- Single-row key/value store for platform-wide settings managed through
-- the Admin & Governance module. Typed so the UI can render the right
-- control (toggle, select, text) for each key.

CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text'
                CHECK (type IN ('text','boolean','select','number')),
  label       TEXT NOT NULL,
  description TEXT,
  options     TEXT,       -- comma-separated list of allowed values for type=select
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_config (key, value, type, label, description, options) VALUES
  ('default_language',      'en',    'select',  'Default platform language',        'Language shown to users before they choose their own preference.',      'en,sw'),
  ('sms_notifications',     'true',  'boolean', 'SMS notifications enabled',        'Send automated SMS reminders and alerts via the connected gateway.',    NULL),
  ('email_notifications',   'true',  'boolean', 'Email notifications enabled',      'Send automated emails for approvals, reminders and reports.',           NULL),
  ('whatsapp_notifications','false', 'boolean', 'WhatsApp notifications enabled',   'Send automated WhatsApp messages (requires API key configuration).',    NULL),
  ('require_mfa',           'false', 'boolean', 'Require MFA for all staff',        'When enabled, users must enrol in MFA before they can log in.',         NULL),
  ('session_timeout_hours', '8',     'number',  'Session timeout (hours)',           'Access tokens expire after this many hours of inactivity.',             NULL),
  ('org_name',              'Kabonix Foundation', 'text', 'Organisation name',      'Displayed in emails, reports and PDF headers.',                         NULL),
  ('org_country',           'Tanzania',           'text', 'Country of operation',   'Used for compliance and reporting defaults.',                            NULL),
  ('data_retention_days',   '2555',  'number',  'Data retention (days)',            'Records older than this are archived, not deleted (7 years = 2555).',   NULL),
  ('carbon_registry_id',    '',      'text',    'Tanzania Carbon Registry ID',      'Organisation registry identifier for MRV submission headers.',           NULL)
ON CONFLICT (key) DO NOTHING;
