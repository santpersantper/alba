-- =====================================================================
-- Alba DM Diagnostic — run each block separately in Supabase SQL Editor
-- Replace 'janniksinner' and 'arevaloana' with the actual usernames.
-- =====================================================================

-- ── 1. Check the trigger exists and is enabled ────────────────────────
SELECT tgname, tgenabled, tgtype
FROM pg_trigger
WHERE tgrelid = 'messages'::regclass
  AND tgname = 'on_message_insert';
-- Expected: 1 row, tgenabled = 'O' (origin)
-- If 0 rows → trigger was never created. Re-run message_delivery_trigger.sql.


-- ── 2. Look up both user UUIDs ────────────────────────────────────────
SELECT id, username FROM profiles
WHERE username IN ('janniksinner', 'arevaloana');


-- ── 3. Check chat_threads for arevaloana ─────────────────────────────
-- Replace <AREVALOANA_UUID> with the id from step 2
SELECT owner_id, chat_id, is_group, last_content, last_sent_at, unread_count
FROM chat_threads
WHERE owner_id = '<AREVALOANA_UUID>'
ORDER BY last_sent_at DESC;
-- If no row with chat_id = janniksinner's UUID → thread was never created
-- (trigger didn't run or failed)


-- ── 4. Check mirror messages for arevaloana ──────────────────────────
-- Replace <AREVALOANA_UUID> and <JANNIKSINNER_UUID>
SELECT id, owner_id, chat, sender_username, sender_is_me, content, sent_date, sent_time
FROM messages
WHERE owner_id = '<AREVALOANA_UUID>'
  AND is_group = false
ORDER BY sent_date DESC, sent_time DESC
LIMIT 20;
-- If no rows with sender_is_me=false from janniksinner → trigger not creating mirrors


-- ── 5. Check janniksinner's sent messages ────────────────────────────
SELECT id, owner_id, chat, sender_username, sender_is_me, content, sent_date, sent_time
FROM messages
WHERE owner_id = '<JANNIKSINNER_UUID>'
  AND is_group = false
ORDER BY sent_date DESC, sent_time DESC
LIMIT 10;
-- These should exist. The chat column should = arevaloana's UUID.


-- ── 6. Quick trigger self-test ───────────────────────────────────────
-- After running steps 1-5, try inserting a test message directly and see
-- if the mirror is created. ONLY do this if you want to test.
-- (Replace UUIDs below with real values from step 2)
/*
INSERT INTO messages (owner_id, chat, is_group, sender_username, sender_is_me,
                      content, sent_date, sent_time, is_read)
VALUES (
  '<JANNIKSINNER_UUID>',
  '<AREVALOANA_UUID>',
  false,
  'janniksinner',
  true,
  'trigger test message',
  CURRENT_DATE::text,
  '12:00:00',
  true
);

-- Then check if arevaloana got a mirror:
SELECT * FROM messages WHERE owner_id = '<AREVALOANA_UUID>' AND content = 'trigger test message';
-- And check chat_threads:
SELECT * FROM chat_threads WHERE owner_id = '<AREVALOANA_UUID>' AND chat_id = '<JANNIKSINNER_UUID>';
*/
