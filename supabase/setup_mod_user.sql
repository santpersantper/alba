-- =====================================================================
-- Alba – Content Moderation User Setup
--
-- Run in the Supabase SQL Editor.
--
-- STEP 1 (do this FIRST — before running this SQL):
--   Go to Supabase Dashboard → Authentication → Users → Add user
--   Email:    support@albaappofficial.com
--   Password: (choose a strong password)
--   Tick "Auto Confirm User"
--   Copy the UUID that Supabase assigns — replace MOD_USER_UUID below.
--
-- STEP 2: replace the placeholder UUID, then run this entire file.
-- =====================================================================

-- ── Replace this with the UUID from the Supabase Auth dashboard ──────
DO $$
DECLARE
  mod_id uuid := '00000000-0000-0000-0000-000000000000'; -- ← REPLACE THIS
BEGIN

  -- ── 0. Show existing RLS policies on profiles & posts ──────────────
  RAISE NOTICE '=== RLS policies on profiles ===';
  PERFORM pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
  FROM pg_policy pol
  JOIN pg_class cls ON cls.oid = pol.polrelid
  WHERE cls.relname = 'profiles' AND cls.relnamespace = 'public'::regnamespace;

  RAISE NOTICE '=== RLS policies on posts ===';
  PERFORM pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
  FROM pg_policy pol
  JOIN pg_class cls ON cls.oid = pol.polrelid
  WHERE cls.relname = 'posts' AND cls.relnamespace = 'public'::regnamespace;

  -- ── 1. Create alba_mod profile ──────────────────────────────────────
  -- Uses ON CONFLICT so it's safe to re-run.
  INSERT INTO public.profiles (id, username, name, email)
  VALUES (
    mod_id,
    'alba_mod',
    'Content Moderation',
    'support@albaappofficial.com'
  )
  ON CONFLICT (id) DO UPDATE SET
    username = 'alba_mod',
    name     = 'Content Moderation';

  RAISE NOTICE 'alba_mod profile created/updated with id=%', mod_id;

END $$;


-- ── 2. RLS policy: alba_mod can delete any post ─────────────────────
-- Drops first so re-running is safe.
DROP POLICY IF EXISTS "moderator_delete_any_post" ON public.posts;

CREATE POLICY "moderator_delete_any_post"
  ON public.posts
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.username = 'alba_mod'
    )
  );


-- ── 3. Verify ────────────────────────────────────────────────────────
SELECT
  pol.polname      AS policy_name,
  cls.relname      AS table_name,
  pol.polcmd       AS command  -- 'd' = DELETE, 'r' = SELECT, 'w' = INSERT, 'u' = UPDATE
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
WHERE cls.relnamespace = 'public'::regnamespace
  AND cls.relname IN ('profiles', 'posts')
ORDER BY cls.relname, pol.polname;
