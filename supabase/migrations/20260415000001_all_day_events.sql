-- All-day events flag
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS all_day boolean DEFAULT false;
