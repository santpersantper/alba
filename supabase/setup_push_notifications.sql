-- =====================================================================
-- Alba – Push Notifications Setup
-- Run in Supabase SQL Editor.
--
-- Step 1: Run this SQL to add columns to profiles.
-- Step 2: Deploy the send-push edge function:
--     npx supabase functions deploy send-push
-- Step 3: Set up a Database Webhook in Supabase Dashboard:
--     Dashboard → Database → Webhooks → Create webhook
--       Name:    notify_new_message
--       Table:   messages
--       Events:  INSERT
--       URL:     https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push
--       Headers: Authorization: Bearer YOUR_SERVICE_ROLE_KEY
--                Content-Type: application/json
-- Step 4: Also set up a webhook for diffusion_message_receipts (optional):
--       Name:    notify_diffusion
--       Table:   diffusion_message_receipts
--       Events:  INSERT
--       URL:     (same as above)
-- =====================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS push_token text,
  ADD COLUMN IF NOT EXISTS notif_prefs jsonb
    DEFAULT '{"chat":true,"groups":true,"diffusion":true,"followed_posts":true}'::jsonb;
