-- =====================================================================
-- Alba – GDPR cascade-delete setup
--
-- Run ONCE in the Supabase SQL Editor.
--
-- Purpose:
--   Ensures that when a user is deleted from auth.users (via the
--   /delete-account server endpoint), ALL their personal data is
--   automatically removed from every table that references them.
--
-- Chain:
--   auth.users (deleted) →
--     profiles (ON DELETE CASCADE) →
--       posts, messages, chat_threads, groups (admin arrays cleaned by trigger)
--     diffusion_messages (ON DELETE CASCADE)
--     diffusion_message_receipts (ON DELETE CASCADE)
--     ad_stats (already cascades from posts)
-- =====================================================================


-- ── 1. profiles → auth.users ─────────────────────────────────────────
-- profiles.id is a UUID that mirrors auth.users.id.
-- Drop any existing FK and re-add with ON DELETE CASCADE.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ── 2. posts → profiles ──────────────────────────────────────────────
-- When a profile is deleted, remove all their posts.
-- (ad_stats already cascades from posts via setup_ad_tracking.sql.)

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_user_id_fkey,
  DROP CONSTRAINT IF EXISTS posts_author_id_fkey;

-- Re-add whichever column name your posts table uses for the author.
-- If your column is named user_id:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'author_id'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_author_id_fkey
        FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── 3. messages → profiles ───────────────────────────────────────────
-- Remove messages sent by a deleted user.

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_sender_id_fkey,
  DROP CONSTRAINT IF EXISTS messages_user_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'sender_id'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_id_fkey
        FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── 4. chat_threads → profiles ───────────────────────────────────────

ALTER TABLE public.chat_threads
  DROP CONSTRAINT IF EXISTS chat_threads_owner_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_threads' AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE public.chat_threads
      ADD CONSTRAINT chat_threads_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── 5. diffusion_messages → auth.users ──────────────────────────────

ALTER TABLE public.diffusion_messages
  DROP CONSTRAINT IF EXISTS diffusion_messages_sender_id_fkey;

ALTER TABLE public.diffusion_messages
  ADD CONSTRAINT diffusion_messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ── 6. diffusion_message_receipts → auth.users ──────────────────────

ALTER TABLE public.diffusion_message_receipts
  DROP CONSTRAINT IF EXISTS diffusion_message_receipts_recipient_id_fkey;

ALTER TABLE public.diffusion_message_receipts
  ADD CONSTRAINT diffusion_message_receipts_recipient_id_fkey
    FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ── 7. Verify ────────────────────────────────────────────────────────
-- After running, check that the constraints exist:

SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name  AS foreign_table,
  ccu.column_name AS foreign_column,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage  AS kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND rc.delete_rule = 'CASCADE'
ORDER BY tc.table_name;
