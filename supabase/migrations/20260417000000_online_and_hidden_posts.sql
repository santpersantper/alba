-- Migration: add online and hidden columns to posts table
-- online: marks an event as taking place online (no physical location)
-- hidden: allows post authors to hide their post from Profile and Community feeds

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS online  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden  BOOLEAN NOT NULL DEFAULT FALSE;

-- Index to efficiently fetch hidden posts for a given author
CREATE INDEX IF NOT EXISTS idx_posts_author_hidden ON posts (author_id, hidden) WHERE hidden = TRUE;
