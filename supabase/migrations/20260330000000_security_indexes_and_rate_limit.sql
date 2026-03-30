-- ── Security: indexes + server-side post rate limit ──────────────────────────
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to run multiple times — all statements are idempotent.

-- ── 1. Add created_at to posts (server-set, tamper-proof) ───────────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Back-fill rows that existed before this migration (use current time as best effort)
UPDATE public.posts SET created_at = now() WHERE created_at IS NULL;

-- ── 2. Performance indexes ───────────────────────────────────────────────────

-- Feed queries: most-recent posts by a user
CREATE INDEX IF NOT EXISTS idx_posts_author_created
  ON public.posts (author_id, created_at DESC);

-- Rate-limit + duplicate title check in CreatePostScreen
CREATE INDEX IF NOT EXISTS idx_posts_user_created
  ON public.posts ("user", created_at DESC);

-- Chat message loading: fetch latest messages for a conversation
CREATE INDEX IF NOT EXISTS idx_messages_chat_sent
  ON public.messages (chat, sent_at DESC);

-- Unread count queries
CREATE INDEX IF NOT EXISTS idx_messages_owner_read
  ON public.messages (owner_id, is_read)
  WHERE is_read = false;

-- ── 3. Server-side post rate-limit (10 min, enforced in DB) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_check_post_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.posts
    WHERE author_id = NEW.author_id
      AND created_at > NOW() - INTERVAL '10 minutes'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'rate_limit: You can only post once every 10 minutes.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_rate_limit ON public.posts;
CREATE TRIGGER trg_post_rate_limit
  BEFORE INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_post_rate_limit();
