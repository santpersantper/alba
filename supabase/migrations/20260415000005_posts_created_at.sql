-- Add created_at timestamp to posts (used by share_post rate-limit check and general audit)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Backfill existing rows so the column is never null
UPDATE public.posts SET created_at = now() WHERE created_at IS NULL;

-- Re-create share_post with the now-valid created_at reference
CREATE OR REPLACE FUNCTION public.share_post(
  p_original_post_id uuid,
  p_comment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_username text;
  v_post_type text;
  v_community_id text;
  v_new_post_id uuid;
  v_last_share timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Rate limit: check for a share of this post by this user in the last 10 minutes
  SELECT created_at INTO v_last_share
  FROM public.posts
  WHERE author_id = v_user_id
    AND shared_post_id = p_original_post_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_share IS NOT NULL AND v_last_share > (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id = v_user_id;
  SELECT type, community_id INTO v_post_type, v_community_id
  FROM public.posts WHERE id = p_original_post_id;

  IF v_post_type IS NULL THEN
    RAISE EXCEPTION 'original_not_found';
  END IF;

  INSERT INTO public.posts (
    author_id,
    username,
    community_id,
    type,
    comment,
    shared_post_id,
    created_at
  )
  VALUES (
    v_user_id,
    v_username,
    v_community_id,
    v_post_type,
    p_comment,
    p_original_post_id,
    now()
  )
  RETURNING id INTO v_new_post_id;

  UPDATE public.posts
  SET shares = array_append(COALESCE(shares, '{}'::uuid[]), v_user_id)
  WHERE id = p_original_post_id;

  RETURN v_new_post_id;
END;
$$;
