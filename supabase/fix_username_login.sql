-- =====================================================================
-- Alba – Username → email lookup function for login
--
-- Run ONCE in the Supabase SQL Editor (Dashboard → SQL Editor).
--
-- Why SECURITY DEFINER:
--   The anon/authenticated role cannot read auth.users directly.
--   SECURITY DEFINER runs the function with the postgres owner's
--   privileges, which can JOIN across auth.users safely.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_email_for_username(uname text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.email
  FROM auth.users au
  JOIN public.profiles p ON p.id = au.id
  WHERE lower(p.username) = lower(uname)
  LIMIT 1;
$$;

-- Only anon and authenticated callers should be able to invoke this.
-- Revoke from PUBLIC first to be explicit, then re-grant to the roles
-- the Supabase client uses.
REVOKE ALL ON FUNCTION public.get_email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_for_username(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_email_for_username(text) TO authenticated;
