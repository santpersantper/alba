-- Allow dots in usernames (in addition to letters, numbers, underscores)
-- Constraint: only [a-zA-Z0-9._], no leading/trailing/consecutive dots
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_chars;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_chars
    CHECK (
      username ~ '^[a-zA-Z0-9._]+$'
      AND username !~ '^\.'
      AND username !~ '\.$'
      AND username !~ '\.\.'
    );
