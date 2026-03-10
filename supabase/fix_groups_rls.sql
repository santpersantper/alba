-- =====================================================================
-- Alba – Fix insecure RLS policies on public.groups
--        and suppress the spatial_ref_sys advisor warning
--
-- Run ONCE in the Supabase SQL Editor.
--
-- Problems fixed:
--   1. group_admins_can_update / group_admins_can_delete referenced
--      auth.jwt() -> user_metadata, which users can freely overwrite via
--      supabase.auth.updateUser(). Replaced with a profiles-join that is
--      anchored to auth.uid() (server-controlled, not user-editable).
--   2. The groups: admin update / groups: admin delete policies in
--      rls_policies.sql used auth.uid()::text = ANY(group_admin), but
--      group_admin stores usernames (text[]), not UUIDs — those policies
--      never actually matched. Dropping and recreating them correctly.
--   3. spatial_ref_sys (PostGIS system table) was exposed to PostgREST
--      without RLS. Enabling RLS with no SELECT policy blocks direct
--      client access (no app code queries this table).
-- =====================================================================


-- ── 1. Fix: spatial_ref_sys ──────────────────────────────────────────
--
-- PostGIS owns this table so we cannot ALTER it. Instead, revoke SELECT
-- from the PostgREST roles so the table is invisible to the API client.
-- This is the Supabase-recommended approach for extension-owned tables.

REVOKE SELECT ON public.spatial_ref_sys FROM anon, authenticated;


-- ── 2. Fix: groups admin policies ────────────────────────────────────
--
-- Drop ALL existing update/delete policies on groups so we start clean.
-- The old insecure ones (group_admins_can_update / group_admins_can_delete)
-- used user_metadata. The ones from rls_policies.sql compared UUIDs to
-- usernames and never matched. We drop both sets and replace with one
-- correct pair.

DO $$
DECLARE
  pol TEXT;
  old_policies TEXT[] := ARRAY[
    'group_admins_can_update',
    'group_admins_can_delete',
    'groups: admin update',
    'groups: admin delete'
  ];
BEGIN
  FOREACH pol IN ARRAY old_policies LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'groups' AND policyname = pol
    ) THEN
      EXECUTE format('DROP POLICY %I ON public.groups', pol);
      RAISE NOTICE 'Dropped policy: %', pol;
    END IF;
  END LOOP;
END $$;


-- Only group admins can update the group.
--
-- Security model:
--   - group_admin stores an array of usernames (text[]).
--   - We look up the current user's username from public.profiles using
--     auth.uid() as the key. auth.uid() is server-issued and cannot be
--     spoofed by the client. profiles.username is the user's own row and
--     is protected by "profiles: owner update" (auth.uid() = id), so a
--     user cannot set their username to match another existing user's
--     username without that username being vacated first (DB-level unique
--     constraint enforces this).
--   - This is strictly safer than user_metadata, which has no uniqueness
--     guarantee and is freely writable by any authenticated user.

CREATE POLICY "groups: admin update"
  ON public.groups
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.username = ANY(groups.group_admin)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.username = ANY(groups.group_admin)
    )
  );


-- Only group admins can delete the group.

CREATE POLICY "groups: admin delete"
  ON public.groups
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.username = ANY(groups.group_admin)
    )
  );


-- ── 3. Verify ────────────────────────────────────────────────────────

SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'groups'
ORDER BY cmd;

-- Expected output (4 rows):
--   groups | groups: admin delete          | DELETE | EXISTS (SELECT 1 FROM profiles …)
--   groups | groups: authenticated insert  | INSERT | …
--   groups | groups: authenticated read    | SELECT | …
--   groups | groups: admin update          | UPDATE | EXISTS (SELECT 1 FROM profiles …)
