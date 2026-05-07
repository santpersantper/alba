-- Fix: nearby_posts was filtering by the POSTER's profile location (pr.location),
-- so any organiser physically in Milan would show all their events to Milan users
-- regardless of the event venue. Switch to the post's own geom (po.geom).
--
-- The original function used radius_m integer; drop both overloads to avoid
-- PostgREST PGRST203 "cannot choose best candidate" ambiguity.

drop function if exists nearby_posts(uuid, integer);
drop function if exists nearby_posts(uuid, float8);
create or replace function nearby_posts(
  uid      uuid,
  radius_m float8 default 50000
)
returns setof posts
language plpgsql stable as $$
declare
  viewer_loc   geometry;
  blocked_uids text[];
begin
  select
    coalesce(p.blocked_users, '{}'),
    p.location
  into blocked_uids, viewer_loc
  from profiles p
  where p.id = uid;

  return query
  select po.*
  from posts po
  join profiles pr on pr.username = po."user"
  where
    not (pr.id::text = any(blocked_uids))
    and (
      po.type != 'Event'
      or po.every_day = true
      or (po.repeat_days is not null and array_length(po.repeat_days, 1) > 0)
      or po.date >= current_date
      or (po.end_date is not null and po.end_date >= current_date)
    )
    and (
      viewer_loc is null
      or po.geom is null
      or st_dwithin(
           po.geom::geography,
           viewer_loc::geography,
           radius_m
         )
    )
  order by po.date desc;
end;
$$;
