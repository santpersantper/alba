-- =====================================================================
-- Alba – Ad tracking infrastructure
--
-- Run ONCE in the Supabase SQL Editor.
--
-- Creates:
--   1. ad_stats table            — per-post counters (views, purchases, contacts)
--   2. increment_ad_stat()       — RPC called by the app to safely +1 a counter
--   3. trg_create_ad_stats       — auto-inserts a row when an Ad post is created
--
-- Called from:
--   Post.js        → increment_ad_stat(post_id, 'views')     on render (once/session)
--   Post.js        → increment_ad_stat(post_id, 'contacts')  on "Message seller" tap
--   BuyModal.js    → increment_ad_stat(post_id, 'purchases') on completed purchase
--   CreatePostScreen.js → INSERT INTO ad_stats (belt-and-suspenders alongside trigger)
-- =====================================================================


-- ── 1. ad_stats table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ad_stats (
  post_id  TEXT    PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  views    INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  contacts  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups (already covered by PK but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_ad_stats_post_id ON public.ad_stats(post_id);

-- RLS
ALTER TABLE public.ad_stats ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read stats
-- (AdPublisherScreen reads its own ads' stats; no other user's data is fetched client-side)
DROP POLICY IF EXISTS "ad_stats: authenticated read"  ON public.ad_stats;
CREATE POLICY "ad_stats: authenticated read"
  ON public.ad_stats FOR SELECT TO authenticated USING (true);

-- Authenticated users can INSERT (used by CreatePostScreen fire-and-forget)
DROP POLICY IF EXISTS "ad_stats: authenticated insert" ON public.ad_stats;
CREATE POLICY "ad_stats: authenticated insert"
  ON public.ad_stats FOR INSERT TO authenticated WITH CHECK (true);

-- Authenticated users can UPDATE (increment_ad_stat uses SECURITY DEFINER so this is
-- also covered by the function's elevated permissions, but the policy keeps it clear)
DROP POLICY IF EXISTS "ad_stats: authenticated update" ON public.ad_stats;
CREATE POLICY "ad_stats: authenticated update"
  ON public.ad_stats FOR UPDATE TO authenticated USING (true);


-- ── 2. increment_ad_stat RPC ─────────────────────────────────────────
--
-- Safe upsert + increment. SECURITY DEFINER bypasses RLS for the update
-- so it can never be blocked by a stale policy.
-- p_field is whitelisted to 'views' | 'purchases' | 'contacts' — no SQL injection risk.

CREATE OR REPLACE FUNCTION public.increment_ad_stat(
  p_post_id TEXT,
  p_field   TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whitelist: ignore any unknown field names
  IF p_field NOT IN ('views', 'purchases', 'contacts') THEN
    RETURN;
  END IF;

  -- Ensure a row exists (belt-and-suspenders alongside the trigger)
  INSERT INTO public.ad_stats (post_id, views, purchases, contacts)
  VALUES (p_post_id, 0, 0, 0)
  ON CONFLICT (post_id) DO NOTHING;

  -- Atomic increment
  IF p_field = 'views' THEN
    UPDATE public.ad_stats
      SET views = views + 1, updated_at = now()
      WHERE post_id = p_post_id;
  ELSIF p_field = 'purchases' THEN
    UPDATE public.ad_stats
      SET purchases = purchases + 1, updated_at = now()
      WHERE post_id = p_post_id;
  ELSIF p_field = 'contacts' THEN
    UPDATE public.ad_stats
      SET contacts = contacts + 1, updated_at = now()
      WHERE post_id = p_post_id;
  END IF;
END;
$$;

-- Allow any authenticated user to call it
REVOKE ALL ON FUNCTION public.increment_ad_stat(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_ad_stat(TEXT, TEXT) TO authenticated;


-- ── 3. Auto-create ad_stats row on Ad post insert ───────────────────
--
-- When a post with type = 'Ad' is inserted, immediately create the
-- corresponding ad_stats row so the dashboard can read it from day 1.

CREATE OR REPLACE FUNCTION public.fn_create_ad_stats_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'Ad' THEN
    INSERT INTO public.ad_stats (post_id, views, purchases, contacts)
    VALUES (NEW.id, 0, 0, 0)
    ON CONFLICT (post_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_ad_stats ON public.posts;
CREATE TRIGGER trg_create_ad_stats
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_create_ad_stats_row();


-- ── 4. Backfill existing Ad posts ───────────────────────────────────
--
-- For Ad posts that already exist, create their ad_stats row if missing.

INSERT INTO public.ad_stats (post_id, views, purchases, contacts)
SELECT id, 0, 0, 0
FROM public.posts
WHERE type = 'Ad'
ON CONFLICT (post_id) DO NOTHING;


-- ── 5. Verify ────────────────────────────────────────────────────────

SELECT
  p.id,
  p.title,
  a.views,
  a.purchases,
  a.contacts
FROM public.posts p
LEFT JOIN public.ad_stats a ON a.post_id = p.id
WHERE p.type = 'Ad'
ORDER BY p.date DESC
LIMIT 10;
