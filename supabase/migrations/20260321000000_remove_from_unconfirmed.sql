-- RPC: remove one or more usernames from events.unconfirmed (case-insensitive)
-- Called after a ticket purchase to promote users from unconfirmed → ticket_holders.
-- SECURITY DEFINER bypasses RLS so non-owners can trigger this on purchase.

CREATE OR REPLACE FUNCTION remove_from_unconfirmed(
  p_post_id uuid,
  p_usernames text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE events
  SET unconfirmed = ARRAY(
    SELECT u FROM unnest(unconfirmed) u
    WHERE lower(u) != ALL(SELECT lower(n) FROM unnest(p_usernames) n)
  )
  WHERE post_id = p_post_id;
$$;
