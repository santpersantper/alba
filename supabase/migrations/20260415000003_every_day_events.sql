-- Every-day events flag
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS every_day boolean DEFAULT false;
