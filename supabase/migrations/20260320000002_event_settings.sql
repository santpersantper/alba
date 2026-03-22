-- ============================================================
-- Migration: event settings — end date/time + purchases_active
-- Run this in the Supabase SQL editor (Dashboard → SQL editor)
-- ============================================================

-- 1. End date/time on posts table
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS end_date text,
  ADD COLUMN IF NOT EXISTS end_time text;

-- 2. Purchases active flag on events table (default true = purchases enabled)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS purchases_active boolean NOT NULL DEFAULT true;
