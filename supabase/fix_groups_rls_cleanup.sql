-- =====================================================================
-- Alba – Clean up duplicate and dangerous RLS policies on public.groups
--
-- Run ONCE in the Supabase SQL Editor.
--
-- The verify query after fix_groups_rls.sql revealed several leftover
-- policies from earlier iterations. The dangerous one is groups_update_auth
-- (qual: true) which lets ANY authenticated user update ANY group, silently
-- overriding the admin-only policies (Postgres RLS ORs permissive policies).
-- =====================================================================

DO $$
DECLARE
  pol TEXT;
  to_drop TEXT[] := ARRAY[
    -- Dangerous: allows any authenticated user to update any group
    'groups_update_auth',

    -- Too broad: allows any group member (not just admins) to update
    'groups_update_if_member_or_admin',

    -- Superseded by "groups: admin update" (same logic, duplicate)
    'allow updates for group admins',

    -- Duplicate INSERT policies
    'allow inserts for authenticated',

    -- Duplicate SELECT policies
    'allow select to authenticated',
    'Enable read for authenticated',
    'groups_select_auth'
  ];
BEGIN
  FOREACH pol IN ARRAY to_drop LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'groups' AND policyname = pol
    ) THEN
      EXECUTE format('DROP POLICY %I ON public.groups', pol);
      RAISE NOTICE 'Dropped: %', pol;
    ELSE
      RAISE NOTICE 'Not found (already gone): %', pol;
    END IF;
  END LOOP;
END $$;


-- ── Verify: should show exactly 4 rows ───────────────────────────────

SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'groups'
ORDER BY cmd, policyname;

-- Expected (4 rows):
--   groups: admin delete         | DELETE | EXISTS (SELECT 1 FROM profiles …)
--   groups: authenticated insert | INSERT | (null / with check only)
--   groups: authenticated read   | SELECT | true
--   groups: admin update         | UPDATE | EXISTS (SELECT 1 FROM profiles …)
