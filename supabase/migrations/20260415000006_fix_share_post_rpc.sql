-- Drop created_at (added by mistake in previous migration) and fix share_post column names
ALTER TABLE public.posts DROP COLUMN IF EXISTS created_at;

-- Re-create share_post with correct column names (user, group_id) and no created_at references
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
  v_user_id    uuid;
  v_username   text;
  v_userpicuri text;
  v_post_type  text;
  v_post_title text;
  v_group_id   uuid;
  v_date       text;
  v_time       time;
  v_location   text;
  v_end_time   time;
  v_end_date   date;
  v_all_day    boolean;
  v_every_day  boolean;
  v_lat        double precision;
  v_lon        double precision;
  v_geom       geometry;
  v_new_post_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get username and avatar of the sharer
  SELECT username, avatar_url INTO v_username, v_userpicuri
  FROM public.profiles WHERE id = v_user_id;

  -- Get all relevant fields from the original post
  SELECT type, title, group_id, date, time, location, end_time, end_date,
         all_day, every_day, lat, lon, geom
  INTO v_post_type, v_post_title, v_group_id, v_date, v_time, v_location, v_end_time, v_end_date,
       v_all_day, v_every_day, v_lat, v_lon, v_geom
  FROM public.posts WHERE id = p_original_post_id;

  IF v_post_type IS NULL THEN
    RAISE EXCEPTION 'original_not_found';
  END IF;

  -- Insert the share post, copying event/location fields from the original
  INSERT INTO public.posts (
    author_id, "user", userpicuri, group_id, type, title,
    date, time, location, end_time, end_date, all_day, every_day, lat, lon, geom,
    comment, shared_post_id
  )
  VALUES (
    v_user_id, v_username, v_userpicuri, v_group_id, v_post_type, v_post_title,
    v_date, v_time, v_location, v_end_time, v_end_date, v_all_day, v_every_day, v_lat, v_lon, v_geom,
    p_comment, p_original_post_id
  )
  RETURNING id INTO v_new_post_id;

  -- Append sharer's user_id to the original post's shares array
  UPDATE public.posts
  SET shares = array_append(COALESCE(shares, '{}'::uuid[]), v_user_id)
  WHERE id = p_original_post_id;

  RETURN v_new_post_id;
END;
$$;
