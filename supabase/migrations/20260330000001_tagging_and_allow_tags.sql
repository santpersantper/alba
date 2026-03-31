-- Add tagged_usernames array to posts so we can store @mentions
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS tagged_usernames text[] DEFAULT '{}';

-- Add allow_tags to profiles: users can opt out of being tagged (default true)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS allow_tags boolean DEFAULT true;
