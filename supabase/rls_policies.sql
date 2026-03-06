-- ============================================================
-- Alba – Row Level Security Policies
-- Run this in the Supabase SQL editor (or as a migration).
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read any profile (needed for displaying other users)
CREATE POLICY "profiles: public read"
  ON profiles FOR SELECT
  USING (true);

-- Users can only update their own profile
CREATE POLICY "profiles: owner update"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can only insert their own profile row
CREATE POLICY "profiles: owner insert"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can only delete their own profile
CREATE POLICY "profiles: owner delete"
  ON profiles FOR DELETE
  USING (auth.uid() = id);


-- ── posts ────────────────────────────────────────────────────
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read posts
CREATE POLICY "posts: authenticated read"
  ON posts FOR SELECT
  TO authenticated
  USING (true);

-- Only the author can insert their own posts
CREATE POLICY "posts: owner insert"
  ON posts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);

-- Only the author can update their own posts
CREATE POLICY "posts: owner update"
  ON posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Only the author can delete their own posts
CREATE POLICY "posts: owner delete"
  ON posts FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);


-- ── messages ─────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can only read messages in chats they own (owner_id tracks the inbox side)
CREATE POLICY "messages: participant read"
  ON messages FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

-- Users can only send messages as themselves
CREATE POLICY "messages: owner insert"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- Users can only update their own messages (e.g. is_read flag)
CREATE POLICY "messages: owner update"
  ON messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Users can only delete their own messages
CREATE POLICY "messages: owner delete"
  ON messages FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);


-- ── chat_threads ──────────────────────────────────────────────
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;

-- Users can only see their own thread list entries
CREATE POLICY "chat_threads: owner read"
  ON chat_threads FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "chat_threads: owner insert"
  ON chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "chat_threads: owner update"
  ON chat_threads FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "chat_threads: owner delete"
  ON chat_threads FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);


-- ── groups ───────────────────────────────────────────────────
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read groups (needed for group chat discovery)
CREATE POLICY "groups: authenticated read"
  ON groups FOR SELECT
  TO authenticated
  USING (true);

-- Any authenticated user can create a group
CREATE POLICY "groups: authenticated insert"
  ON groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only group admins can update the group
-- group_admin is stored as a text[] of UUIDs
CREATE POLICY "groups: admin update"
  ON groups FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = ANY(group_admin))
  WITH CHECK (auth.uid()::text = ANY(group_admin));

-- Only group admins can delete the group
CREATE POLICY "groups: admin delete"
  ON groups FOR DELETE
  TO authenticated
  USING (auth.uid()::text = ANY(group_admin));


-- ── events ───────────────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read events
CREATE POLICY "events: authenticated read"
  ON events FOR SELECT
  TO authenticated
  USING (true);

-- Any authenticated user can create an event
CREATE POLICY "events: authenticated insert"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only organizers can update the event
-- organizers is stored as a text[] of UUIDs
CREATE POLICY "events: organizer update"
  ON events FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = ANY(organizers))
  WITH CHECK (auth.uid()::text = ANY(organizers));

-- Only organizers can delete the event
CREATE POLICY "events: organizer delete"
  ON events FOR DELETE
  TO authenticated
  USING (auth.uid()::text = ANY(organizers));


-- ── tickets ──────────────────────────────────────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Ticket holders can read their own tickets
CREATE POLICY "tickets: owner read"
  ON tickets FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

-- The payment server inserts tickets via service-role key (bypasses RLS),
-- so no INSERT policy needed for the anon/authenticated role.

-- Ticket owners cannot update/delete their own tickets (immutable once issued)
-- Service-role key is used for any admin updates (e.g. scanned status).


-- ── feed_videos ──────────────────────────────────────────────
ALTER TABLE feed_videos ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read public videos
CREATE POLICY "feed_videos: authenticated read"
  ON feed_videos FOR SELECT
  TO authenticated
  USING (visibility = 'public' OR auth.uid()::text = user_id);

-- Users can only upload videos as themselves
CREATE POLICY "feed_videos: owner insert"
  ON feed_videos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

-- Users can only update their own videos
CREATE POLICY "feed_videos: owner update"
  ON feed_videos FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Users can only delete their own videos
CREATE POLICY "feed_videos: owner delete"
  ON feed_videos FOR DELETE
  TO authenticated
  USING (auth.uid()::text = user_id);


-- ── diffusion_messages ────────────────────────────────────────
ALTER TABLE diffusion_messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages that were delivered to them (via receipts)
-- or that they sent
CREATE POLICY "diffusion_messages: sender read"
  ON diffusion_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id);

-- Only the sender can insert (payment validated server-side before insert)
CREATE POLICY "diffusion_messages: sender insert"
  ON diffusion_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

-- No update/delete by users — messages are immutable once sent


-- ── diffusion_message_receipts ────────────────────────────────
ALTER TABLE diffusion_message_receipts ENABLE ROW LEVEL SECURITY;

-- Recipients can read and update their own receipts (mark opened/replied)
CREATE POLICY "receipts: recipient read"
  ON diffusion_message_receipts FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_id);

CREATE POLICY "receipts: recipient update"
  ON diffusion_message_receipts FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- Inserts are done via service-role key when a diffusion message is delivered
-- No INSERT policy needed for authenticated role.


-- ── reports ──────────────────────────────────────────────────
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Users can only read their own reports
CREATE POLICY "reports: owner read"
  ON reports FOR SELECT
  TO authenticated
  USING (auth.uid() = reported_by);

-- Any authenticated user can submit a report
CREATE POLICY "reports: authenticated insert"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reported_by);

-- Reports are immutable once filed (no update/delete)


-- ── ad_stats ─────────────────────────────────────────────────
ALTER TABLE ad_stats ENABLE ROW LEVEL SECURITY;

-- Community admins write ad stats via service-role (bypasses RLS).
-- Regular users should not read or write ad_stats directly.
-- No policies = table is locked to authenticated role; only service-role can access.
