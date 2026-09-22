-- 0009_profile_and_verification.sql
--
-- 1. users.pending_email — a new email address awaiting verification.
--    Set when the user requests an email change; promoted to `email` only
--    after they click the verification link sent to the new address.
--
-- 2. email_verification_tokens.purpose — distinguishes between a first-time
--    signup verification and an email-change verification, so the same
--    /auth/email/verify endpoint can handle both.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_email TEXT;

ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'signup';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_verification_tokens_purpose_chk'
  ) THEN
    ALTER TABLE email_verification_tokens
      ADD CONSTRAINT email_verification_tokens_purpose_chk
      CHECK (purpose IN ('signup','email_change'));
  END IF;
END $$;