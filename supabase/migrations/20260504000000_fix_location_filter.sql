-- Fix: filter community posts by the post's own location (po.geom),
-- not the poster's profile location (pr.location).
-- A Milan-based organiser posting a Rome event should only be visible to Rome users.

-- Fix search_community_posts (text embedding, 1536 dims)
drop function if exists search_community_posts(uuid, vector(1536), float8, int);
create or replace function search_community_posts(
  uid              uuid,
  query_embedding  vector(1536),
  radius_m         float8  default 50000,
  match_count      int     default 60
)
returns table (
  id          uuid,
  similarity  float8
)
language plpgsql stable as $$
declare
  blocked_uids text[];
  viewer_loc   geometry;
begin
  select
    coalesce(p.blocked_users, '{}'),
    p.location
  into blocked_uids, viewer_loc
  from profiles p
  where p.id = uid;

  return query
  select
    po.id,
    1.0 - (po.caption_embedding <=> query_embedding) as similarity
  from posts po
  join profiles pr on pr.username = po."user"
  where
    po.caption_embedding is not null
    and not (pr.id::text = any(blocked_uids))
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
  order by po.caption_embedding <=> query_embedding asc
  limit match_count;
end;
$$;

-- Fix search_community_posts_mm (multimodal embedding, 1408 dims)
drop function if exists search_community_posts_mm(uuid, vector(1408), float8, int);
create or replace function search_community_posts_mm(
  uid              uuid,
  query_embedding  vector(1408),
  radius_m         float8  default 50000,
  match_count      int     default 60
)
returns table (
  id          uuid,
  similarity  float8
)
language plpgsql stable as $$
declare
  blocked_uids text[];
  viewer_loc   geometry;
begin
  select
    coalesce(p.blocked_users, '{}'),
    p.location
  into blocked_uids, viewer_loc
  from profiles p
  where p.id = uid;

  return query
  select
    po.id,
    1.0 - (po.multimodal_embedding <=> query_embedding) as similarity
  from posts po
  join profiles pr on pr.username = po."user"
  where
    po.multimodal_embedding is not null
    and not (pr.id::text = any(blocked_uids))
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
  order by po.multimodal_embedding <=> query_embedding asc
  limit match_count;
end;
$$;
