-- Convert posts.end_date from text to date.
-- Raise maintenance_work_mem for this session so the table rewrite has enough memory.
SET LOCAL maintenance_work_mem = '128MB';

-- Step 1: blank strings → NULL (cannot cast "" to date)
UPDATE public.posts SET end_date = NULL WHERE end_date = '';

-- Step 2: change the column type; USING casts any remaining text values
ALTER TABLE public.posts
  ALTER COLUMN end_date TYPE date USING end_date::date;
