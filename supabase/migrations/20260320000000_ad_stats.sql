-- ============================================================
-- Migration: ad_stats, ad_purchases, ad_contacts tables
-- + increment_ad_stat RPC used by Post.js and BuyModal.js
-- Run this in the Supabase SQL editor (Dashboard → SQL editor)
-- ============================================================

-- ── Tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ad_stats (
  post_id   uuid PRIMARY KEY,
  views     int NOT NULL DEFAULT 0,
  purchases int NOT NULL DEFAULT 0,
  contacts  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ad_purchases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        uuid NOT NULL,
  buyer_id       uuid REFERENCES auth.users(id),
  buyer_username text,
  product_name   text,
  required_info  jsonb,
  purchased_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            uuid NOT NULL,
  contacter_id       uuid REFERENCES auth.users(id),
  contacter_username text,
  contacter_avatar   text,
  contacted_at       timestamptz DEFAULT now(),
  UNIQUE(post_id, contacter_id)
);

-- ── RPC: increment a single stat column atomically ────────
-- Called by Post.js  : increment_ad_stat(post_id, 'views')
-- Called by Post.js  : increment_ad_stat(post_id, 'contacts')
-- Called by BuyModal : increment_ad_stat(post_id, 'purchases')

DROP FUNCTION IF EXISTS increment_ad_stat(uuid, text);
DROP FUNCTION IF EXISTS increment_ad_stat(text, text);

CREATE OR REPLACE FUNCTION increment_ad_stat(p_post_id uuid, p_field text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_field NOT IN ('views', 'purchases', 'contacts') THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;
  -- Ensure a row exists first
  INSERT INTO ad_stats (post_id, views, purchases, contacts)
    VALUES (p_post_id, 0, 0, 0)
  ON CONFLICT (post_id) DO NOTHING;
  -- Increment the requested column
  EXECUTE format(
    'UPDATE ad_stats SET %I = %I + 1 WHERE post_id = $1',
    p_field, p_field
  ) USING p_post_id;
END;
$$;

-- ── RLS ───────────────────────────────────────────────────

ALTER TABLE ad_stats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_contacts  ENABLE ROW LEVEL SECURITY;

-- Ad publisher can read stats for their own posts
DROP POLICY IF EXISTS "ad_stats_read_own"     ON ad_stats;
DROP POLICY IF EXISTS "ad_purchases_read_own" ON ad_purchases;
DROP POLICY IF EXISTS "ad_contacts_read_own"  ON ad_contacts;
DROP POLICY IF EXISTS "ad_purchases_insert"   ON ad_purchases;
DROP POLICY IF EXISTS "ad_contacts_insert"    ON ad_contacts;

CREATE POLICY "ad_stats_read_own" ON ad_stats
  FOR SELECT USING (
    post_id IN (
      SELECT id FROM posts WHERE "user" = (
        SELECT username FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "ad_purchases_read_own" ON ad_purchases
  FOR SELECT USING (
    post_id IN (
      SELECT id FROM posts WHERE "user" = (
        SELECT username FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "ad_contacts_read_own" ON ad_contacts
  FOR SELECT USING (
    post_id IN (
      SELECT id FROM posts WHERE "user" = (
        SELECT username FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- Any authenticated user can insert (viewer, buyer, contacter)
CREATE POLICY "ad_purchases_insert" ON ad_purchases
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ad_contacts_insert" ON ad_contacts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Upsert (ON CONFLICT DO UPDATE) also needs an UPDATE policy
DROP POLICY IF EXISTS "ad_contacts_update_self" ON ad_contacts;
CREATE POLICY "ad_contacts_update_self" ON ad_contacts
  FOR UPDATE USING (contacter_id = auth.uid());

DROP POLICY IF EXISTS "ad_purchases_update_self" ON ad_purchases;
CREATE POLICY "ad_purchases_update_self" ON ad_purchases
  FOR UPDATE USING (buyer_id = auth.uid());

GRANT EXECUTE ON FUNCTION increment_ad_stat(uuid, text) TO authenticated, anon;

-- ── View dedup table ──────────────────────────────────────
-- One row per (post, viewer) — INSERT fails on duplicate so we only increment once per user
CREATE TABLE IF NOT EXISTS ad_views (
  post_id   uuid NOT NULL,
  viewer_id uuid REFERENCES auth.users(id),
  viewed_at timestamptz DEFAULT now(),
  UNIQUE(post_id, viewer_id)
);

ALTER TABLE ad_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_views_insert" ON ad_views;
CREATE POLICY "ad_views_insert" ON ad_views
  FOR INSERT WITH CHECK (viewer_id = auth.uid());

GRANT INSERT ON TABLE ad_views TO authenticated;
