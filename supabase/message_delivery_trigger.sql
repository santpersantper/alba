-- =====================================================================
-- Alba – Message Delivery Trigger
-- Run ONCE in Supabase Dashboard → SQL Editor
--
-- What it does:
--   When a user inserts their own copy of a message (sender_is_me = true),
--   this trigger:
--     1. Mirrors the message for every recipient (owner_id = recipient,
--        chat = sender's UUID, sender_is_me = false, is_read = false)
--     2. Upserts chat_threads for the SENDER  (unread stays 0)
--     3. Upserts chat_threads for every RECIPIENT (unread increments)
--
-- Works for both DMs (is_group = false) and group chats (is_group = true).
-- SECURITY DEFINER lets it write across user boundaries despite RLS.
-- =====================================================================


-- ── 0. Unique constraint on chat_threads so upsert works ─────────────
-- Safe to run even if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_threads_owner_chat_unique'
  ) THEN
    ALTER TABLE chat_threads
      ADD CONSTRAINT chat_threads_owner_chat_unique
      UNIQUE (owner_id, chat_id);
  END IF;
END $$;


-- ── 1. Delivery function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deliver_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_peer_id   UUID;
  v_sent_at   TIMESTAMPTZ;
  v_member    TEXT;
  v_member_id UUID;
  v_members   TEXT[];
BEGIN
  -- Only process the SENDER's original row (sender_is_me = true).
  -- Mirror rows inserted by this function have sender_is_me = false → skip them.
  IF NOT COALESCE(NEW.sender_is_me, false) THEN
    RETURN NEW;
  END IF;

  -- Normalise a single timestamp for ordering
  v_sent_at := COALESCE(
    NEW.sent_at,
    (NEW.sent_date || 'T' || COALESCE(NEW.sent_time, '00:00:00'))::timestamptz
  );

  -- ── DM ─────────────────────────────────────────────────────────────
  IF NOT COALESCE(NEW.is_group, false) THEN

    v_peer_id := NEW.chat;   -- for DMs, chat column = peer profile UUID

    -- Mirror message → recipient's inbox
    INSERT INTO messages (
      owner_id, chat, is_group,
      sender_username, sender_is_me,
      content, media_reference, post_id, group_id,
      is_read, sent_date, sent_time, sent_at
    ) VALUES (
      v_peer_id,       -- recipient owns this copy
      NEW.owner_id,    -- from their perspective chat = sender UUID
      false,
      NEW.sender_username, false,
      NEW.content, NEW.media_reference, NEW.post_id, NEW.group_id,
      false, NEW.sent_date, NEW.sent_time, v_sent_at
    );

    -- Sender thread (unread = 0, they sent it)
    INSERT INTO chat_threads (
      owner_id, chat_id, is_group,
      last_sent_at, last_sender_is_me, last_sender_username,
      last_content, last_media_reference, last_post_id, unread_count
    ) VALUES (
      NEW.owner_id, v_peer_id, false,
      v_sent_at, true, NEW.sender_username,
      NEW.content, NEW.media_reference, NEW.post_id, 0
    )
    ON CONFLICT (owner_id, chat_id) DO UPDATE SET
      last_sent_at         = EXCLUDED.last_sent_at,
      last_sender_is_me    = true,
      last_sender_username = EXCLUDED.last_sender_username,
      last_content         = EXCLUDED.last_content,
      last_media_reference = EXCLUDED.last_media_reference,
      last_post_id         = EXCLUDED.last_post_id;

    -- Recipient thread (unread increments)
    INSERT INTO chat_threads (
      owner_id, chat_id, is_group,
      last_sent_at, last_sender_is_me, last_sender_username,
      last_content, last_media_reference, last_post_id, unread_count
    ) VALUES (
      v_peer_id, NEW.owner_id, false,
      v_sent_at, false, NEW.sender_username,
      NEW.content, NEW.media_reference, NEW.post_id, 1
    )
    ON CONFLICT (owner_id, chat_id) DO UPDATE SET
      last_sent_at         = EXCLUDED.last_sent_at,
      last_sender_is_me    = false,
      last_sender_username = EXCLUDED.last_sender_username,
      last_content         = EXCLUDED.last_content,
      last_media_reference = EXCLUDED.last_media_reference,
      last_post_id         = EXCLUDED.last_post_id,
      unread_count         = chat_threads.unread_count + 1;

  -- ── Group ───────────────────────────────────────────────────────────
  ELSIF COALESCE(NEW.is_group, false) THEN

    SELECT members INTO v_members
    FROM groups
    WHERE id = NEW.chat;

    IF v_members IS NULL OR array_length(v_members, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    FOREACH v_member IN ARRAY v_members LOOP

      SELECT id INTO v_member_id
      FROM profiles
      WHERE username = v_member
      LIMIT 1;

      IF v_member_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Sender: just upsert their thread, they already have the message row
      IF v_member_id = NEW.owner_id THEN
        INSERT INTO chat_threads (
          owner_id, chat_id, is_group,
          last_sent_at, last_sender_is_me, last_sender_username,
          last_content, last_media_reference, last_post_id, unread_count
        ) VALUES (
          v_member_id, NEW.chat, true,
          v_sent_at, true, NEW.sender_username,
          NEW.content, NEW.media_reference, NEW.post_id, 0
        )
        ON CONFLICT (owner_id, chat_id) DO UPDATE SET
          last_sent_at         = EXCLUDED.last_sent_at,
          last_sender_is_me    = true,
          last_sender_username = EXCLUDED.last_sender_username,
          last_content         = EXCLUDED.last_content,
          last_media_reference = EXCLUDED.last_media_reference,
          last_post_id         = EXCLUDED.last_post_id;

        CONTINUE;
      END IF;

      -- Mirror message → group member's inbox
      INSERT INTO messages (
        owner_id, chat, is_group,
        sender_username, sender_is_me,
        content, media_reference, post_id, group_id,
        is_read, sent_date, sent_time, sent_at
      ) VALUES (
        v_member_id, NEW.chat, true,
        NEW.sender_username, false,
        NEW.content, NEW.media_reference, NEW.post_id, NEW.group_id,
        false, NEW.sent_date, NEW.sent_time, v_sent_at
      );

      -- Member thread (unread increments)
      INSERT INTO chat_threads (
        owner_id, chat_id, is_group,
        last_sent_at, last_sender_is_me, last_sender_username,
        last_content, last_media_reference, last_post_id, unread_count
      ) VALUES (
        v_member_id, NEW.chat, true,
        v_sent_at, false, NEW.sender_username,
        NEW.content, NEW.media_reference, NEW.post_id, 1
      )
      ON CONFLICT (owner_id, chat_id) DO UPDATE SET
        last_sent_at         = EXCLUDED.last_sent_at,
        last_sender_is_me    = false,
        last_sender_username = EXCLUDED.last_sender_username,
        last_content         = EXCLUDED.last_content,
        last_media_reference = EXCLUDED.last_media_reference,
        last_post_id         = EXCLUDED.last_post_id,
        unread_count         = chat_threads.unread_count + 1;

    END LOOP;

  END IF;

  RETURN NEW;
END;
$$;


-- ── 2. Attach trigger ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_message_insert ON messages;

CREATE TRIGGER on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION deliver_message();
