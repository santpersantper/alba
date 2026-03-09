-- ============================================================
-- Alba — Feed Personalization (Option A + C)
-- Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Enable pgvector (needed for semantic embeddings)
create extension if not exists vector;

-- 2. Add columns to feed_videos
alter table feed_videos
  add column if not exists tags text[] default '{}',
  add column if not exists caption_embedding vector(1536);

-- 3. Add personalization columns to profiles
alter table profiles
  add column if not exists feed_tags text[] default '{}',
  add column if not exists feed_preference_prompt text,
  add column if not exists feed_preference_embedding vector(1536),
  add column if not exists feed_radius_km int;

-- 4. Personalized feed RPC
--    Handles all cases: embedding search, tag filter, radius filter, or any combo.
--    Pass null / empty array for params you don't want applied.
drop function if exists get_personalized_feed(uuid,vector,text[],double precision,double precision,double precision,integer);
create or replace function get_personalized_feed(
  uid              uuid,
  query_embedding  vector(1536) default null,
  preferred_tags   text[]       default '{}',
  user_lat         float8       default null,
  user_lng         float8       default null,
  radius_km        float8       default null,
  match_count      int          default 30
)
returns table (
  id                  uuid,
  user_id             text,
  username            text,
  caption             text,
  video_storage_path  text,
  created_at          timestamptz,
  tags                text[]
)
language plpgsql stable as $$
declare
  -- text[] matches the actual column type of profiles.blocked_users.
  -- Using uuid[] here caused "operator does not exist: text = uuid" at runtime.
  blocked_uids text[];
begin
  -- pull blocked list for this user
  select coalesce(p.blocked_users, '{}')
  into   blocked_uids
  from   profiles p
  where  p.id = uid;

  return query
  select
    v.id,
    v.user_id,
    v.username,
    v.caption,
    v.video_storage_path,
    v.created_at,
    v.tags
  from feed_videos v
  where
    -- exclude blocked users (cast user_id to text to match blocked_users column type)
    not (v.user_id::text = any(blocked_uids))

    -- tag filter — skip when preferred_tags is empty
    and (
      array_length(preferred_tags, 1) is null
      or preferred_tags = '{}'
      or v.tags && preferred_tags
    )

    -- radius filter — skip when location params are null
    and (
      user_lat  is null
      or user_lng  is null
      or radius_km is null
      or (
        v.geo_lat is not null
        and v.geo_lon is not null
        and (
          6371 * acos(
            greatest(-1.0, least(1.0,
              cos(radians(user_lat))  * cos(radians(v.geo_lat))
              * cos(radians(v.geo_lon) - radians(user_lng))
              + sin(radians(user_lat)) * sin(radians(v.geo_lat))
            ))
          )
        ) <= radius_km
      )
    )

  order by
    -- semantic ranking when embedding provided; unembedded videos go last
    case
      when query_embedding is not null and v.caption_embedding is not null
        then v.caption_embedding <=> query_embedding
      else 1.0
    end asc,
    v.created_at desc

  limit match_count;
end;
$$;

-- 5. Vector similarity index (run after you have ≥ a few hundred videos with embeddings)
--    If you have very few videos now, comment this out and run it later.
create index if not exists feed_videos_embedding_idx
  on feed_videos
  using ivfflat (caption_embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- Community Posts — Semantic Search
-- ============================================================

-- 6. Add embedding column to community posts table
alter table posts
  add column if not exists caption_embedding vector(1536);

-- 7. Semantic search RPC: returns (id, similarity) pairs for reranking.
--    Filters by the viewer's stored profile location (same radius as nearby_posts).
--    Client calls this after the initial nearby_posts load when a search/label is active.
drop function if exists search_community_posts(uuid,vector(1536),double precision,integer);
drop function if exists search_community_posts(uuid,vector,double precision,integer);
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
  -- text[] matches profiles.blocked_users column type (same fix as get_personalized_feed)
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
      viewer_loc is null
      or pr.location is null
      or st_dwithin(
           pr.location::geography,
           viewer_loc::geography,
           radius_m
         )
    )
  order by po.caption_embedding <=> query_embedding asc
  limit match_count;
end;
$$;

-- 8. Vector index for community posts (run after you have ≥ a few hundred embedded posts)
create index if not exists posts_embedding_idx
  on posts
  using ivfflat (caption_embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- After running this SQL, deploy the two new Edge Functions:
--   supabase functions deploy embed-text
--   supabase functions deploy send-report     (if not done yet)
--
-- Set the new secret:
--   supabase secrets set OPENAI_API_KEY=sk-...
-- ============================================================
