-- =====================================================================
-- DM Diagnostic — UUIDs already filled in from your message data
-- janniksinner = 188064e3-a6e0-496c-bb10-b4bc4308dfaa
-- arevaloana   = ac241e0b-2a77-4ce6-80e6-040058af5f4c
-- Run each block separately in Supabase SQL Editor
-- =====================================================================


-- ── QUERY A: Does the delivery trigger exist? ─────────────────────────
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'messages'::regclass
  AND tgname = 'on_message_insert';
-- If 0 rows → trigger was never installed. Re-run message_delivery_trigger.sql first.


-- ── QUERY B: arevaloana's chat_threads — does a janniksinner entry exist? ──
SELECT owner_id, chat_id, is_group, last_content, last_sent_at, unread_count
FROM chat_threads
WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c';
-- If no row with chat_id = '188064e3-a6e0-496c-bb10-b4bc4308dfaa' → trigger not upserting thread


-- ── QUERY C: arevaloana's DM messages — are any mirrors there? ─────────
SELECT id, chat, sender_username, sender_is_me, content, sent_date, sent_time
FROM messages
WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND is_group = false
ORDER BY sent_date DESC, sent_time DESC
LIMIT 20;
-- If no rows with sender_is_me=false → trigger not creating mirror messages for DMs


-- ── QUERY D: type of messages.chat column ────────────────────────────
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'messages' AND column_name = 'chat';
-- Shows whether chat is 'uuid' or 'text' — affects trigger behaviour


-- ── QUERY E: manual trigger test (ONLY if A shows trigger exists) ────
-- Directly insert a test message as janniksinner → arevaloana
-- and check if the mirror appears. Uncomment and run only when ready.
/*
INSERT INTO messages (
  owner_id, chat, is_group, sender_username, sender_is_me,
  content, sent_date, sent_time, is_read
) VALUES (
  '188064e3-a6e0-496c-bb10-b4bc4308dfaa',   -- janniksinner
  'ac241e0b-2a77-4ce6-80e6-040058af5f4c',   -- arevaloana
  false,
  'janniksinner',
  true,
  'TRIGGER_TEST_DELETE_ME',
  CURRENT_DATE::text,
  '10:00:00',
  true
);

-- Immediately check if arevaloana got a mirror:
SELECT id, chat, sender_username, sender_is_me, content
FROM messages
WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND content = 'TRIGGER_TEST_DELETE_ME';

-- Check arevaloana's thread:
SELECT * FROM chat_threads
WHERE owner_id = 'ac241e0b-2a77-4ce6-80e6-040058af5f4c'
  AND chat_id  = '188064e3-a6e0-496c-bb10-b4bc4308dfaa';

-- Clean up:
DELETE FROM messages WHERE content = 'TRIGGER_TEST_DELETE_ME';
*/
