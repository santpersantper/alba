-- =====================================================================
-- Alba – Fix DELETE RLS policies for messages and chat_threads
--
-- Run ONCE in Supabase SQL Editor.
--
-- Without these policies, client-side DELETE calls are silently blocked
-- by RLS, so deleted chats reappear on the next DB fetch.
-- =====================================================================

-- ── messages: allow users to delete their own rows ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'messages'
      AND policyname = 'Users can delete own messages'
  ) THEN
    CREATE POLICY "Users can delete own messages"
      ON messages
      FOR DELETE
      USING (owner_id = auth.uid());
  END IF;
END $$;

-- ── chat_threads: allow users to delete their own rows ────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'chat_threads'
      AND policyname = 'Users can delete own chat_threads'
  ) THEN
    CREATE POLICY "Users can delete own chat_threads"
      ON chat_threads
      FOR DELETE
      USING (owner_id = auth.uid());
  END IF;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('messages', 'chat_threads')
  AND cmd = 'DELETE'
ORDER BY tablename;
-- Should show 2 rows after running this script.
