-- =====================================================================
-- Alba – Onboarding overlay seen-state table
--
-- Run ONCE in the Supabase SQL Editor.
--
-- Purpose:
--   Tracks which onboarding overlays each user has already dismissed,
--   so the first-time intro only appears on genuinely new visits.
--
-- screen_key values: 'community' | 'settings' | 'feed' | 'usetime'
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_seen (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  screen_key  text        NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, screen_key)
);

-- Row-level security: users can only read/write their own rows
ALTER TABLE public.onboarding_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "onboarding_seen_self" ON public.onboarding_seen;

CREATE POLICY "onboarding_seen_self"
  ON public.onboarding_seen
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'onboarding_seen'
ORDER BY ordinal_position;
