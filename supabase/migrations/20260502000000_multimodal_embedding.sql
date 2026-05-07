-- Multimodal embedding column (1408 dimensions, Google Vertex AI multimodalembedding@001).
-- Used for label-based semantic filtering on CommunityScreen, where visual content
-- of post images matters as much as the text description.
alter table posts
  add column if not exists multimodal_embedding vector(1408);

-- HNSW index for fast approximate nearest-neighbour search.
-- IVFFlat requires ~a few hundred rows before it's useful; HNSW works from day one.
create index if not exists posts_multimodal_embedding_idx
  on posts
  using hnsw (multimodal_embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Semantic search RPC using multimodal embeddings.
-- Mirrors search_community_posts but uses the multimodal_embedding column.
-- Called from CommunityScreen when a label chip is active.
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
    -- Exclude expired events (same logic as the client-side date filter)
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

-- After running this migration, deploy the new edge function:
--   supabase functions deploy embed-multimodal
-- Then set the required secrets:
--   supabase secrets set VERTEX_SA_JSON='<service-account-json>'
--   supabase secrets set VERTEX_PROJECT_ID='<gcp-project-id>'
-- Finally, backfill existing posts:
--   supabase functions deploy backfill-multimodal
--   curl -X POST <function-url> -H "Authorization: Bearer <service-role-key>"
