-- Share on profile feature
-- Adds shared_post_id (reference to original post), comment (share caption), shares (array of user IDs who shared)

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS shared_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comment text,
  ADD COLUMN IF NOT EXISTS shares uuid[] DEFAULT '{}';

-- Index for efficient lookup of shares by original post
CREATE INDEX IF NOT EXISTS posts_shared_post_id_idx ON public.posts(shared_post_id) WHERE shared_post_id IS NOT NULL;

-- Index for shares array containment queries
CREATE INDEX IF NOT EXISTS posts_shares_gin_idx ON public.posts USING GIN(shares) WHERE shares IS NOT NULL AND array_length(shares, 1) > 0;

-- RPC: share_post
-- Creates a share post and appends sharer's user_id to the original post's shares array
-- Rate-limited: once per 10 minutes per user per post
-- SECURITY DEFINER so it can update the original post's shares array regardless of RLS
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
  -- Get current user
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

  -- Get username and original post type/community for the share post
  SELECT username INTO v_username FROM public.profiles WHERE id = v_user_id;
  SELECT type, community_id INTO v_post_type, v_community_id
  FROM public.posts WHERE id = p_original_post_id;

  IF v_post_type IS NULL THEN
    RAISE EXCEPTION 'original_not_found';
  END IF;

  -- Insert the share post
  INSERT INTO public.posts (
    author_id,
    username,
    community_id,
    type,
    comment,
    shared_post_id
  )
  VALUES (
    v_user_id,
    v_username,
    v_community_id,
    v_post_type,
    p_comment,
    p_original_post_id
  )
  RETURNING id INTO v_new_post_id;

  -- Append sharer's user_id to the original post's shares array
  UPDATE public.posts
  SET shares = array_append(COALESCE(shares, '{}'::uuid[]), v_user_id)
  WHERE id = p_original_post_id;

  RETURN v_new_post_id;
END;
$$;

-- RPC: delete_share
-- Removes a share post and removes the sharer's user_id from the original post's shares array
-- SECURITY DEFINER so it can update the original post regardless of RLS
CREATE OR REPLACE FUNCTION public.delete_share(
  p_share_post_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_original_post_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get the original post id, verifying ownership
  SELECT shared_post_id INTO v_original_post_id
  FROM public.posts
  WHERE id = p_share_post_id AND author_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_not_owner';
  END IF;

  -- Delete the share post
  DELETE FROM public.posts WHERE id = p_share_post_id AND author_id = v_user_id;

  -- Remove user_id from the original post's shares array
  IF v_original_post_id IS NOT NULL THEN
    UPDATE public.posts
    SET shares = ARRAY(
      SELECT u FROM unnest(COALESCE(shares, '{}'::uuid[])) u WHERE u != v_user_id
    )
    WHERE id = v_original_post_id;
  END IF;
END;
$$;
