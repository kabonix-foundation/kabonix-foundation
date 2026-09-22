-- 0010_phone_and_service_banner.sql
--
-- 1. Add `phone` to users, collected at registration and editable on profile.
-- 2. Add a `service_banner_message` config row. When non-empty, the value is
--    shown as a banner across the top of both the public website and the
--    staff portal. Clear the value to hide the banner.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

INSERT INTO system_config (key, value, type, label, description) VALUES
  ('service_banner_message', '', 'text', 'Service status banner',
   'Shown at the top of the public website and staff portal. Clear this to hide the banner.')
ON CONFLICT (key) DO NOTHING;
