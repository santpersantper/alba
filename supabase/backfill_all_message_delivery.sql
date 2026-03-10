-- =====================================================================
-- Alba – General Message Delivery Backfill
-- Fixes ALL existing conversations, not just janniksinner↔arevaloana.
--
-- Run ONCE in Supabase SQL Editor.
-- Safe to re-run — all inserts are deduplicated / use ON CONFLICT.
--
-- What it does:
--   Part 1 – DMs:  for every DM a user sent, create the recipient's
--                  mirror message if it doesn't already exist.
--   Part 2 – DMs:  upsert chat_threads for both sides of every DM pair.
--   Part 3 – Groups: for every group message, create mirror messages
--                    for every group member who doesn't have one yet.
--   Part 4 – Groups: upsert chat_threads for every group member.
-- =====================================================================


-- ── PART 1: DM mirror messages ───────────────────────────────────────
-- For every outgoing DM (sender_is_me=true, is_group=false), insert a
-- mirror in the recipient's inbox if one doesn't already exist.

INSERT INTO messages (
  owner_id, chat, is_group,
  sender_username, sender_is_me,
  content, media_reference, post_id, group_id,
  is_read, sent_date, sent_time, sent_at
)
SELECT
  m.chat::uuid    AS owner_id,   -- recipient owns this copy
  m.owner_id      AS chat,       -- from recipient's view, chat = sender UUID
  false,
  m.sender_username,
  false,                          -- sender_is_me = false for recipient
  m.content, m.media_reference, m.post_id, m.group_id,
  false,                          -- unread
  m.sent_date, m.sent_time,
  COALESCE(m.sent_at,
    (m.sent_date || 'T' || COALESCE(m.sent_time, '00:00:00'))::timestamptz)
FROM messages m
WHERE COALESCE(m.sender_is_me, false) = true
  AND COALESCE(m.is_group, false)     = false
  AND NOT EXISTS (
    SELECT 1 FROM messages m2
    WHERE m2.owner_id      = m.chat::uuid
      AND m2.chat          = m.owner_id
      AND m2.sent_date     = m.sent_date
      AND m2.sent_time     = m.sent_time
      AND m2.sender_is_me  = false
  );


-- ── PART 2: DM chat_threads ──────────────────────────────────────────
-- Upsert one chat_threads row per (user, peer) pair, using the most
-- recent message as the snippet.

WITH dm_latest AS (
  SELECT DISTINCT ON (owner_id, chat)
    owner_id,
    chat::uuid AS peer_id,
    sender_username,
    sender_is_me,
    content,
    media_reference,
    post_id,
    COALESCE(sent_at,
      (sent_date || 'T' || COALESCE(sent_time, '00:00:00'))::timestamptz) AS ts
  FROM messages
  WHERE COALESCE(is_group, false) = false
  ORDER BY owner_id, chat, sent_date DESC, sent_time DESC
)
INSERT INTO chat_threads (
  owner_id, chat_id, is_group,
  last_sent_at, last_sender_is_me, last_sender_username,
  last_content, last_media_reference, last_post_id, unread_count
)
SELECT
  owner_id,
  peer_id,
  false,
  ts,
  sender_is_me,
  sender_username,
  content,
  media_reference,
  post_id,
  CASE WHEN sender_is_me = false THEN 1 ELSE 0 END
FROM dm_latest
ON CONFLICT (owner_id, chat_id) DO UPDATE SET
  last_sent_at         = GREATEST(EXCLUDED.last_sent_at, chat_threads.last_sent_at),
  last_sender_is_me    = EXCLUDED.last_sender_is_me,
  last_sender_username = EXCLUDED.last_sender_username,
  last_content         = EXCLUDED.last_content,
  last_media_reference = EXCLUDED.last_media_reference,
  last_post_id         = EXCLUDED.last_post_id;


-- ── PART 3: Group mirror messages ────────────────────────────────────
-- For every group message, create mirrors for group members who don't
-- have one yet. Requires looping through groups.members (text[]).

DO $$
DECLARE
  msg          RECORD;
  member_uname TEXT;
  member_id    UUID;
BEGIN
  FOR msg IN
    SELECT
      m.id,
      m.owner_id,
      m.chat,
      m.sender_username,
      m.content,
      m.media_reference,
      m.post_id,
      m.group_id,
      m.sent_date,
      m.sent_time,
      COALESCE(m.sent_at,
        (m.sent_date || 'T' || COALESCE(m.sent_time, '00:00:00'))::timestamptz) AS ts
    FROM messages m
    WHERE COALESCE(m.sender_is_me, false) = true
      AND COALESCE(m.is_group, false)     = true
  LOOP
    -- Get group members
    FOR member_uname IN
      SELECT unnest(members) FROM groups WHERE id = msg.chat::uuid
    LOOP
      -- Resolve username → UUID
      SELECT id INTO member_id FROM profiles WHERE username = member_uname LIMIT 1;
      IF member_id IS NULL THEN CONTINUE; END IF;
      -- Skip the sender (they already have the row)
      IF member_id = msg.owner_id THEN CONTINUE; END IF;

      -- Insert mirror only if not already present
      IF NOT EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.owner_id     = member_id
          AND m2.chat         = msg.chat::uuid
          AND m2.sent_date    = msg.sent_date
          AND m2.sent_time    = msg.sent_time
          AND m2.sender_is_me = false
      ) THEN
        INSERT INTO messages (
          owner_id, chat, is_group,
          sender_username, sender_is_me,
          content, media_reference, post_id, group_id,
          is_read, sent_date, sent_time, sent_at
        ) VALUES (
          member_id, msg.chat::uuid, true,
          msg.sender_username, false,
          msg.content, msg.media_reference, msg.post_id, msg.group_id,
          false, msg.sent_date, msg.sent_time, msg.ts
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;


-- ── PART 4: Group chat_threads ───────────────────────────────────────
-- Upsert one chat_threads row per group member per group, using the
-- most recent message as the snippet.

DO $$
DECLARE
  grp          RECORD;
  member_uname TEXT;
  member_id    UUID;
  latest       RECORD;
BEGIN
  -- For each group that has at least one message
  FOR grp IN
    SELECT DISTINCT chat::uuid AS group_id FROM messages
    WHERE COALESCE(is_group, false) = true
  LOOP
    -- Get the latest message in this group
    SELECT
      sender_username,
      sender_is_me,
      content,
      media_reference,
      post_id,
      COALESCE(sent_at,
        (sent_date || 'T' || COALESCE(sent_time, '00:00:00'))::timestamptz) AS ts
    INTO latest
    FROM messages
    WHERE chat::uuid = grp.group_id
      AND COALESCE(is_group, false) = true
    ORDER BY sent_date DESC, sent_time DESC
    LIMIT 1;

    IF latest IS NULL THEN CONTINUE; END IF;

    -- Upsert a thread entry for every group member
    FOR member_uname IN
      SELECT unnest(members) FROM groups WHERE id = grp.group_id
    LOOP
      SELECT id INTO member_id FROM profiles WHERE username = member_uname LIMIT 1;
      IF member_id IS NULL THEN CONTINUE; END IF;

      INSERT INTO chat_threads (
        owner_id, chat_id, is_group,
        last_sent_at, last_sender_is_me, last_sender_username,
        last_content, last_media_reference, last_post_id, unread_count
      ) VALUES (
        member_id,
        grp.group_id,
        true,
        latest.ts,
        latest.sender_is_me,
        latest.sender_username,
        latest.content,
        latest.media_reference,
        latest.post_id,
        0   -- unread count reset; trigger keeps it accurate going forward
      )
      ON CONFLICT (owner_id, chat_id) DO UPDATE SET
        last_sent_at         = GREATEST(EXCLUDED.last_sent_at, chat_threads.last_sent_at),
        last_sender_is_me    = EXCLUDED.last_sender_is_me,
        last_sender_username = EXCLUDED.last_sender_username,
        last_content         = EXCLUDED.last_content,
        last_media_reference = EXCLUDED.last_media_reference,
        last_post_id         = EXCLUDED.last_post_id;
    END LOOP;
  END LOOP;
END $$;


-- ── Verification ─────────────────────────────────────────────────────
SELECT
  'total DM mirror messages (sender_is_me=false)' AS metric,
  COUNT(*) AS count
FROM messages
WHERE COALESCE(is_group, false) = false AND sender_is_me = false
UNION ALL
SELECT 'total DM chat_threads entries', COUNT(*)
FROM chat_threads WHERE is_group = false
UNION ALL
SELECT 'total group mirror messages (sender_is_me=false)', COUNT(*)
FROM messages WHERE COALESCE(is_group, false) = true AND sender_is_me = false
UNION ALL
SELECT 'total group chat_threads entries', COUNT(*)
FROM chat_threads WHERE is_group = true;
