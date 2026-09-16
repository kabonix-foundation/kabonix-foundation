-- 0003_system_config_notif_prefs.sql
-- Safe catch-up migration: creates system_config and notification_preferences
-- if they were not created by 0001 (e.g. on databases where 0001 ran before
-- those tables were added to that migration file).

CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text'
                CHECK (type IN ('text','boolean','select','number')),
  label       TEXT NOT NULL,
  description TEXT,
  options     TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_config (key, value, type, label, description, options) VALUES
  ('default_language',      'en',    'select',  'Default platform language',       'Language shown before a user chooses their own preference.',              'en,sw'),
  ('sms_notifications',     'true',  'boolean', 'SMS notifications enabled',       'Send automated SMS reminders and alerts via the connected gateway.',       NULL),
  ('email_notifications',   'true',  'boolean', 'Email notifications enabled',     'Send automated emails for approvals, reminders and reports.',              NULL),
  ('whatsapp_notifications','false', 'boolean', 'WhatsApp notifications enabled',  'Send automated WhatsApp messages (requires API key configuration).',       NULL),
  ('require_mfa',           'false', 'boolean', 'Require MFA for all staff',       'When enabled, users must enrol in MFA before they can log in.',            NULL),
  ('session_timeout_hours', '8',     'number',  'Session timeout (hours)',          'Access tokens expire after this many hours of inactivity.',                NULL),
  ('org_name',              'Kabonix Foundation', 'text', 'Organisation name',     'Displayed in emails, reports and PDF headers.',                            NULL),
  ('org_country',           'Tanzania',           'text', 'Country of operation',  'Used for compliance and reporting defaults.',                               NULL),
  ('data_retention_days',   '2555',  'number',  'Data retention (days)',            'Records older than this are archived, not deleted (7 years = 2555).',      NULL),
  ('carbon_registry_id',    '',      'text',    'Tanzania Carbon Registry ID',     'Organisation registry identifier for MRV submission headers.',              NULL)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_preferences (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email         BOOLEAN NOT NULL DEFAULT TRUE,
  sms           BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp      BOOLEAN NOT NULL DEFAULT FALSE,
  in_app        BOOLEAN NOT NULL DEFAULT TRUE,
  subscriptions JSONB NOT NULL DEFAULT '["approval_required","submission_flagged","project_milestone_due","system_alert"]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
