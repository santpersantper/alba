-- Migration: google_forms_integration
-- Adds Google Forms integration columns to the events table.
-- google_integration  : stores form_id, form_name, access_token, refresh_token as JSONB
-- google_forms_respondent_ids : tracks imported Google Forms response IDs for disconnect/undo

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS google_integration          jsonb    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_forms_respondent_ids text[]   DEFAULT '{}';
