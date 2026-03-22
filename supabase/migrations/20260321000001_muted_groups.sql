ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS muted_groups text[] NOT NULL DEFAULT '{}';
