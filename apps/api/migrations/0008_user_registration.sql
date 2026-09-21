-- 0008_user_registration.sql
--
-- Adds a self-registration flow where new accounts start inactive and must
-- be approved by an administrator before they can sign in.
--
-- approval_status meanings:
--   'approved' — the default. Covers seeded users, invited users, and anyone
--                an admin has already approved. No change in behaviour.
--   'pending'  — self-registered, waiting for review. is_active is FALSE.
--   'rejected' — admin declined the request. is_active stays FALSE and the
--                row is kept for audit purposes; admins can delete it later.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_approval_status_chk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_approval_status_chk
      CHECK (approval_status IN ('pending','approved','rejected'));
  END IF;
END $$;

-- Partial index for the admin's pending-approvals card. Only covers pending
-- rows, so it stays tiny and the planner can use it directly.
CREATE INDEX IF NOT EXISTS users_pending_approval_idx
  ON users (created_at ASC)
  WHERE approval_status = 'pending';
