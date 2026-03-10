-- =====================================================================
-- Alba – DM Delivery Fix
-- Run in Supabase SQL Editor (all at once is fine).
--
-- 1. Re-installs the deliver_message() trigger with an exception handler
--    so trigger errors never block message sends.
-- 2. Backfills mirror messages for all existing janniksinner→arevaloana
--    DMs that arevaloana is currently missing.
-- 3. Creates/updates the chat_threads entries for both sides.
-- =====================================================================

-- janniksinner = 188064e3-a6e0-496c-bb10-b4bc4308dfaa
-- arevaloana   = ac241e0b-2a77-4ce6-80e6-040058af5f4c


-- ── STEP 1: Unique constraint (safe if already exists) ───────────────
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


-- ── STEP 2: Improved deliver_message() trigger ───────────────────────
-- Key improvement: EXCEPTION WHEN OTHERS block ensures a trigger bug
-- can never roll back the sender's original INSERT.
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
  -- Only process the sender's own row (sender_is_me = true).
  -- Mirror rows have sender_is_me = false → skip to avoid recursion.
  IF NOT COALESCE(NEW.sender_is_me, false) THEN
    RETURN NEW;
  END IF;

  v_sent_at := COALESCE(
    NEW.sent_at,
    (NEW.sent_date || 'T' || COALESCE(NEW.sent_time, '00:00:00'))::timestamptz
  );

  IF NOT COALESCE(NEW.is_group, false) THEN
    -- ── DM ────────────────────────────────────────────────────────────
    v_peer_id := NEW.chat::uuid;

    -- Mirror for recipient
    INSERT INTO messages (
      owner_id, chat, is_group,
      sender_username, sender_is_me,
      content, media_reference, post_id, group_id,
      is_read, sent_date, sent_time, sent_at
    ) VALUES (
      v_peer_id,
      NEW.owner_id,
      false,
      NEW.sender_username, false,
      NEW.content, NEW.media_reference, NEW.post_id, NEW.group_id,
      false, NEW.sent_date, NEW.sent_time, v_sent_at
    );

    -- Sender thread
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

    -- Recipient thread
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

  ELSIF COALESCE(NEW.is_group, false) THEN
    -- ── Group ─────────────────────────────────────────────────────────
    SELECT members INTO v_members
    FROM groups WHERE id = NEW.chat::uuid;

    IF v_members IS NULL OR array_length(v_members, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    FOREACH v_member IN ARRAY v_members LOOP
      SELECT id INTO v_member_id
      FROM profiles WHERE username = v_member LIMIT 1;

      IF v_member_id IS NULL THEN CONTINUE; END IF;

      IF v_member_id = NEW.owner_id THEN
        -- Sender: just update their thread
        INSERT INTO chat_threads (
          owner_id, chat_id, is_group,
          last_sent_at, last_sender_is_me, last_sender_username,
          last_content, last_media_reference, last_post_id, unread_count
        ) VALUES (
          v_member_id, NEW.chat::uuid, true,
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

      -- Mirror for group member
      INSERT INTO messages (
        owner_id, chat, is_group,
        sender_username, sender_is_me,
        content, media_reference, post_id, group_id,
        is_read, sent_date, sent_time, sent_at
      ) VALUES (
        v_member_id, NEW.chat::uuid, true,
        NEW.sender_username, false,
        NEW.content, NEW.media_reference, NEW.post_id, NEW.group_id,
        false, NEW.sent_date, NEW.sent_time, v_sent_at
      );

      -- Member thread
      INSERT INTO chat_threads (
        owner_id, chat_id, is_group,
        last_sent_at, last_sender_is_me, last_sender_username,
        last_content, last_media_reference, last_post_id, unread_count
      ) VALUES (
        v_member_id, NEW.chat::uuid, true,
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

EXCEPTION WHEN OTHERS THEN
  -- Log the error but never block the sender's INSERT
  RAISE WARNING 'deliver_message() error for message %: % %',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS on_message_insert ON messages;
CREATE TRIGGER on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION deliver_message();


-- ── STEP 3: Backfill arevaloana's mirror messages from janniksinner ──
-- Inserts mirrors for every janniksinner→arevaloana DM that doesn't
-- already have a corresponding mirror in arevaloana's inbox.
INSERT INTO messages (
  owner_id, chat, is_group,
  sender_username, sender_is_me,
  content, media_reference, post_id, group_id,
  is_read, sent_date, sent_time, sent_at
)
SELECT
  'ac241e0b-2a77-4ce6-80e6-040058af5f4c'::uuid,  -- arevaloana owns this copy
  '188064e3-a6e0-496c-bb10-b4bc4308dfaa'::uuid,  -- chat = janniksinner (sender)
  false,
  m.sender_username,
  false,   -- sender_is_me = false for recipient
  m.content,
  m.media_reference,
  m.post_id,
  m.group_id,
  false,   -- unread
  m.sent_date,
  m.sent_time,
  COALESCE(m.sent_at,
    (m.sent_date || 'T' || COALESCE(m.sent_time, '00:00:00'))::timestamptz)
FROM messages m
WHERE m.owner_id = '188064e3-a6e0-496c-bb10-b4bc4308dfaa'  -- janniksinner
  AND m.chat    = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'   -- to arevaloana
  AND m.sender_is_me = true
  AND COALESCE(m.is_group, false) = false
  -- Skip if a mirror with same timestamp+content already exists
  AND NOT EXISTS (
    SELECT 1 FROM messages m2
    WHERE m2.owner_id   = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
      AND m2.chat       = '188064e3-a6e0-496c-bb10-b4bc4308dfaa'
      AND m2.sent_date  = m.sent_date
      AND m2.sent_time  = m.sent_time
      AND m2.sender_is_me = false
  );


-- ── STEP 4: Upsert chat_threads for both sides ───────────────────────

-- arevaloana's thread entry for janniksinner
INSERT INTO chat_threads (
  owner_id, chat_id, is_group,
  last_sent_at, last_sender_is_me, last_sender_username,
  last_content, last_media_reference, last_post_id, unread_count
)
SELECT
  'ac241e0b-2a77-4ce6-80e6-040058af5f4c'::uuid,
  '188064e3-a6e0-496c-bb10-b4bc4308dfaa'::uuid,
  false,
  COALESCE(sent_at, (sent_date || 'T' || COALESCE(sent_time, '00:00:00'))::timestamptz),
  false,
  sender_username,
  content,
  media_reference,
  post_id,
  (SELECT COUNT(*) FROM messages
   WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
     AND chat     = '188064e3-a6e0-496c-bb10-b4bc4308dfaa'
     AND sender_is_me = false
     AND COALESCE(is_read, false) = false)
FROM messages
WHERE owner_id = '188064e3-a6e0-496c-bb10-b4bc4308dfaa'
  AND chat     = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND sender_is_me = true
  AND COALESCE(is_group, false) = false
ORDER BY sent_date DESC, sent_time DESC
LIMIT 1
ON CONFLICT (owner_id, chat_id) DO UPDATE SET
  last_sent_at         = EXCLUDED.last_sent_at,
  last_sender_is_me    = false,
  last_sender_username = EXCLUDED.last_sender_username,
  last_content         = EXCLUDED.last_content,
  last_media_reference = EXCLUDED.last_media_reference,
  last_post_id         = EXCLUDED.last_post_id,
  unread_count         = EXCLUDED.unread_count;

-- janniksinner's thread entry for arevaloana (update last_sent_at if stale)
INSERT INTO chat_threads (
  owner_id, chat_id, is_group,
  last_sent_at, last_sender_is_me, last_sender_username,
  last_content, last_media_reference, last_post_id, unread_count
)
SELECT
  '188064e3-a6e0-496c-bb10-b4bc4308dfaa'::uuid,
  'ac241e0b-2a77-4ce6-80e6-040058af5f4c'::uuid,
  false,
  COALESCE(sent_at, (sent_date || 'T' || COALESCE(sent_time, '00:00:00'))::timestamptz),
  true,
  sender_username,
  content,
  media_reference,
  post_id,
  0
FROM messages
WHERE owner_id = '188064e3-a6e0-496c-bb10-b4bc4308dfaa'
  AND chat     = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND sender_is_me = true
  AND COALESCE(is_group, false) = false
ORDER BY sent_date DESC, sent_time DESC
LIMIT 1
ON CONFLICT (owner_id, chat_id) DO UPDATE SET
  last_sent_at         = EXCLUDED.last_sent_at,
  last_sender_is_me    = true,
  last_sender_username = EXCLUDED.last_sender_username,
  last_content         = EXCLUDED.last_content,
  last_media_reference = EXCLUDED.last_media_reference,
  last_post_id         = EXCLUDED.last_post_id;


-- ── DONE ─────────────────────────────────────────────────────────────
-- Verify the backfill worked:
SELECT 'arevaloana mirror messages' AS check_name, COUNT(*) AS count
FROM messages
WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND chat     = '188064e3-a6e0-496c-bb10-b4bc4308dfaa'
  AND sender_is_me = false
UNION ALL
SELECT 'arevaloana chat_threads entry', COUNT(*)
FROM chat_threads
WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND chat_id  = '188064e3-a6e0-496c-bb10-b4bc4308dfaa';
-- Both counts should be > 0 after running this script.
