-- Migration: ticket_request_photo
-- Adds optional photo_url field to submit_ticket_request RPC.
-- Existing callers that omit p_photo_url continue to work unchanged (DEFAULT NULL).

CREATE OR REPLACE FUNCTION public.submit_ticket_request(
  p_post_id   uuid,
  p_username  text,
  p_info      text,
  p_photo_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  already_pending boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM unnest(pending_ticket_requests) elem
    WHERE elem->>'username' = p_username
  )
  INTO already_pending
  FROM public.posts
  WHERE id = p_post_id;

  IF already_pending THEN
    RETURN;
  END IF;

  UPDATE public.posts
  SET pending_ticket_requests = array_append(
    COALESCE(pending_ticket_requests, '{}'::jsonb[]),
    jsonb_build_object(
      'username',     p_username,
      'info',         p_info,
      'photo_url',    p_photo_url,
      'requested_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  WHERE id = p_post_id;
END;
$$;
