-- ============================================================
-- Migration: user ban / suspension fields on profiles
-- Run this in the Supabase SQL editor (Dashboard → SQL editor)
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS banned_until      TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_reason        TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS account_terminated BOOLEAN     NOT NULL DEFAULT FALSE;

-- Index so the app can query ban status cheaply on login
CREATE INDEX IF NOT EXISTS idx_profiles_banned_until
  ON profiles (banned_until)
  WHERE banned_until IS NOT NULL;

-- ============================================================
-- ADMIN SANCTION QUERIES
-- (run these in the SQL editor when you need to sanction a user)
-- ============================================================

-- Find a user by username
-- SELECT id, username, banned_until, account_terminated, ban_reason
-- FROM profiles WHERE username = 'the_username';

-- Find a user by email
-- SELECT p.id, p.username, au.email, p.banned_until, p.account_terminated, p.ban_reason
-- FROM profiles p
-- JOIN auth.users au ON au.id = p.id
-- WHERE au.email = 'user@example.com';

-- List all currently active bans
-- SELECT p.id, p.username, au.email, p.banned_until, p.ban_reason, p.account_terminated
-- FROM profiles p
-- JOIN auth.users au ON au.id = p.id
-- WHERE p.banned_until > NOW() OR p.account_terminated = TRUE
-- ORDER BY p.banned_until DESC NULLS LAST;

-- Apply an 8-hour ban (replace USER_ID)
-- UPDATE profiles
-- SET banned_until = NOW() + INTERVAL '8 hours',
--     ban_reason   = 'Violation of Terms of Service'
-- WHERE id = 'USER_ID';

-- Apply a 1-week ban (replace USER_ID)
-- UPDATE profiles
-- SET banned_until = NOW() + INTERVAL '1 week',
--     ban_reason   = 'Violation of Terms of Service'
-- WHERE id = 'USER_ID';

-- Terminate an account permanently (replace USER_ID)
-- UPDATE profiles
-- SET account_terminated = TRUE,
--     ban_reason         = 'Account terminated for repeated or severe violation of Terms of Service'
-- WHERE id = 'USER_ID';
-- Also block re-login at the auth level:
-- UPDATE auth.users SET banned_until = 'infinity' WHERE id = 'USER_ID';

-- Lift a temporary ban early (replace USER_ID)
-- UPDATE profiles SET banned_until = NULL, ban_reason = NULL WHERE id = 'USER_ID';

-- Reverse an account termination (replace USER_ID)
-- UPDATE profiles SET account_terminated = FALSE, ban_reason = NULL WHERE id = 'USER_ID';
-- UPDATE auth.users SET banned_until = NULL WHERE id = 'USER_ID';
