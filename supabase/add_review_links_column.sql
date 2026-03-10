-- Alba – Add review_links column to groups table
-- Run in Supabase SQL Editor

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS review_links boolean DEFAULT false;
