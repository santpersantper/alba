-- Migration: ticket_controls
-- Adds fixed-ticket-count and manual-approval features to the posts table.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_ticket_number_fixed    boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS manually_approve_attendees boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_number             integer,
  ADD COLUMN IF NOT EXISTS pending_ticket_requests   jsonb[]  DEFAULT '{}'::jsonb[],
  ADD COLUMN IF NOT EXISTS ticket_approval_info      text,
  ADD COLUMN IF NOT EXISTS approved_ticket_buyers    text[]   DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- RPC: submit_ticket_request
-- Called by a buyer to submit a pending approval request.
-- Appends {username, info, requested_at} to posts.pending_ticket_requests.
-- Idempotent: if the username already has a pending request it does nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_ticket_request(
  p_post_id uuid,
  p_username text,
  p_info     text
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
      'requested_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  WHERE id = p_post_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: approve_ticket_request
-- Called by the event organizer to approve a pending buyer.
-- Removes the entry from pending_ticket_requests and returns the post title
-- (so the caller can build the push notification body).
-- Adding to ticket_holders / attendees_info happens via the existing
-- add_event_attendee RPC after payment completes normally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_ticket_request(
  p_post_id uuid,
  p_username text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  UPDATE public.posts
  SET
    pending_ticket_requests = ARRAY(
      SELECT elem
      FROM unnest(pending_ticket_requests) elem
      WHERE elem->>'username' != p_username
    ),
    approved_ticket_buyers = array_append(
      COALESCE(approved_ticket_buyers, '{}'::text[]),
      p_username
    )
  WHERE id = p_post_id
  RETURNING title INTO v_title;

  RETURN jsonb_build_object('title', COALESCE(v_title, ''));
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: reject_ticket_request
-- Called by the event organizer to reject a pending buyer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_ticket_request(
  p_post_id uuid,
  p_username text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts
  SET pending_ticket_requests = ARRAY(
    SELECT elem
    FROM unnest(pending_ticket_requests) elem
    WHERE elem->>'username' != p_username
  )
  WHERE id = p_post_id;
END;
$$;
