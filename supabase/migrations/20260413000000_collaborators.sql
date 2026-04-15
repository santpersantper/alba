-- Migration: collaborators
-- Adds per-user opt-in for collaborator tagging and collaborators array to posts.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allows_collab boolean DEFAULT true;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS collaborators text[] DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- RPC: remove_collaborator
-- Called by a collaborator to remove themselves from a post.
-- SECURITY DEFINER so they can update a post they don't own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_collaborator(
  p_post_id  uuid,
  p_username text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts
  SET collaborators = ARRAY(
    SELECT u FROM unnest(COALESCE(collaborators, '{}'::text[])) u
    WHERE u != p_username
  )
  WHERE id = p_post_id;
END;
$$;
