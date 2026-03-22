-- ============================================================
-- Migration: link review for group messages
-- Run this in the Supabase SQL editor (Dashboard → SQL editor)
-- ============================================================

-- 1. Add pending_review column to messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pending_review boolean NOT NULL DEFAULT false;

-- 2. RPC: approve a pending message (admin only)
CREATE OR REPLACE FUNCTION approve_pending_message(p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_chat_id uuid;
  v_caller_username text;
BEGIN
  SELECT chat_id INTO v_chat_id FROM messages WHERE id = p_message_id;
  SELECT username INTO v_caller_username FROM profiles WHERE id = auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM groups WHERE id = v_chat_id AND v_caller_username = ANY(group_admin)
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not a group admin';
  END IF;

  UPDATE messages SET pending_review = false WHERE id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_pending_message(uuid) TO authenticated;

-- 3. RPC: deny (delete) a pending message (admin only)
CREATE OR REPLACE FUNCTION deny_pending_message(p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_chat_id uuid;
  v_caller_username text;
BEGIN
  SELECT chat_id INTO v_chat_id FROM messages WHERE id = p_message_id;
  SELECT username INTO v_caller_username FROM profiles WHERE id = auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM groups WHERE id = v_chat_id AND v_caller_username = ANY(group_admin)
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not a group admin';
  END IF;

  DELETE FROM messages WHERE id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION deny_pending_message(uuid) TO authenticated;
