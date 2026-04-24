-- Migration: collaborators_organizers_trigger
-- When posts.collaborators is updated, automatically sync newly added usernames
-- into events.organizers so collaborators have organizer-level access in EventSettingsScreen.

CREATE OR REPLACE FUNCTION public.sync_collaborators_to_organizers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_collabs text[];
  new_collabs text[];
BEGIN
  old_collabs := COALESCE(OLD.collaborators, '{}'::text[]);
  new_collabs := COALESCE(NEW.collaborators, '{}'::text[]);

  -- Only touch the events row if collaborators actually changed
  IF new_collabs IS NOT DISTINCT FROM old_collabs THEN
    RETURN NEW;
  END IF;

  -- Merge existing organizers with all current collaborators (deduped)
  UPDATE public.events
  SET organizers = ARRAY(
    SELECT DISTINCT u
    FROM (
      SELECT unnest(COALESCE(organizers, '{}'::text[])) AS u
      UNION
      SELECT unnest(new_collabs) AS u
    ) sub
    WHERE u IS NOT NULL AND u <> ''
  )
  WHERE post_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_collaborators_to_organizers_trigger ON public.posts;

CREATE TRIGGER sync_collaborators_to_organizers_trigger
  AFTER UPDATE OF collaborators ON public.posts
  FOR EACH ROW
  WHEN (NEW.collaborators IS DISTINCT FROM OLD.collaborators)
  EXECUTE FUNCTION public.sync_collaborators_to_organizers();
