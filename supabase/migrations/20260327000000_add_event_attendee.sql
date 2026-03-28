-- Recreate add_event_attendee with a clean implementation that only touches
-- the known columns (ticket_holders, attendees_info). The old version may have
-- referenced stripe columns that were dropped in the 3ef6a1b refactor.
CREATE OR REPLACE FUNCTION add_event_attendee(
  p_event_id   uuid,
  p_ticket_holders text[],
  p_attendees_info jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE events
  SET
    ticket_holders  = p_ticket_holders,
    attendees_info  = p_attendees_info
  WHERE id = p_event_id;
$$;
