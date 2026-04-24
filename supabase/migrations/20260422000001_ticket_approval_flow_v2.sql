-- Migration: ticket_approval_flow_v2
-- Phase 2: authorize-and-capture flow + full ticket data stored in pending request.
--
-- submit_ticket_request: now accepts all ticket data so it can be issued on approval.
-- approve_ticket_request: removes from pending (no longer adds to approved_ticket_buyers),
--   returns full request JSONB so the edge function can capture payment + issue ticket.
-- reject_ticket_request: returns payment_intent_id so the edge function can cancel it.

-- Drop old overloads/signatures so CREATE OR REPLACE can proceed cleanly.
-- reject_ticket_request changed return type void→jsonb, must drop first.
-- submit_ticket_request has two old overloads (3-param and 4-param) that would
-- otherwise survive as orphan overloads alongside the new 10-param version.
DROP FUNCTION IF EXISTS public.reject_ticket_request(uuid, text);
DROP FUNCTION IF EXISTS public.submit_ticket_request(uuid, text, text);
DROP FUNCTION IF EXISTS public.submit_ticket_request(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_ticket_request(
  p_post_id                 uuid,
  p_username                text,
  p_info                    text,
  p_photo_url               text     DEFAULT NULL,
  p_payment_intent_id       text     DEFAULT NULL,
  p_buyer_uid               uuid     DEFAULT NULL,
  p_event_id                uuid     DEFAULT NULL,
  p_tickets_to_insert       jsonb    DEFAULT NULL,
  p_ticket_holders_to_add   text[]   DEFAULT NULL,
  p_attendees_to_add        jsonb    DEFAULT NULL
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
      'username',               p_username,
      'info',                   p_info,
      'photo_url',              p_photo_url,
      'payment_intent_id',      p_payment_intent_id,
      'buyer_uid',              p_buyer_uid::text,
      'event_id',               p_event_id::text,
      'tickets_to_insert',      p_tickets_to_insert,
      'ticket_holders_to_add',  to_jsonb(p_ticket_holders_to_add),
      'attendees_to_add',       p_attendees_to_add,
      'requested_at',           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  WHERE id = p_post_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- approve_ticket_request v2
-- Removes the entry from pending_ticket_requests.
-- Does NOT add to approved_ticket_buyers (column preserved but unused).
-- Returns { title, request } so the edge function can capture payment + issue ticket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_ticket_request(
  p_post_id  uuid,
  p_username text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title   text;
  v_request jsonb;
BEGIN
  -- Capture the request data before removing it
  SELECT elem
  INTO v_request
  FROM (
    SELECT unnest(pending_ticket_requests) AS elem
    FROM public.posts
    WHERE id = p_post_id
  ) sub
  WHERE sub.elem->>'username' = p_username
  LIMIT 1;

  -- Remove from pending (do NOT add to approved_ticket_buyers)
  UPDATE public.posts
  SET pending_ticket_requests = ARRAY(
    SELECT elem
    FROM unnest(pending_ticket_requests) elem
    WHERE elem->>'username' != p_username
  )
  WHERE id = p_post_id
  RETURNING title INTO v_title;

  RETURN jsonb_build_object(
    'title',   COALESCE(v_title, ''),
    'request', COALESCE(v_request, '{}'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- reject_ticket_request v2
-- Removes the entry from pending_ticket_requests.
-- Returns { payment_intent_id } so the edge function can cancel the Stripe PI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_ticket_request(
  p_post_id  uuid,
  p_username text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_intent_id text;
BEGIN
  SELECT elem->>'payment_intent_id'
  INTO v_payment_intent_id
  FROM (
    SELECT unnest(pending_ticket_requests) AS elem
    FROM public.posts
    WHERE id = p_post_id
  ) sub
  WHERE sub.elem->>'username' = p_username
  LIMIT 1;

  UPDATE public.posts
  SET pending_ticket_requests = ARRAY(
    SELECT elem
    FROM unnest(pending_ticket_requests) elem
    WHERE elem->>'username' != p_username
  )
  WHERE id = p_post_id;

  RETURN jsonb_build_object('payment_intent_id', v_payment_intent_id);
END;
$$;
