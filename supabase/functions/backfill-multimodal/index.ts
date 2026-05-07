/**
 * Backfill multimodal_embedding for existing posts that don't have one yet.
 *
 * Call with POST (no body required). Processes up to `batchSize` posts per
 * invocation. Re-invoke until the response reports { remaining: 0 }.
 *
 * Requires the service role key in the Authorization header:
 *   curl -X POST <url> -H "Authorization: Bearer <service-role-key>"
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify the caller provided the service role key
  if (!authHeader.replace("Bearer ", "").trim()) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const today = new Date().toISOString().slice(0, 10);

  // Fetch posts that need multimodal embeddings — future events only (past events aren't shown)
  const { data: posts, error: fetchErr } = await supabase
    .from("posts")
    .select("id, title, description, ai_caption, postmediauri, thumbnail_url")
    .is("multimodal_embedding", null)
    .or(`type.neq.Event,every_day.eq.true,date.gte.${today},end_date.gte.${today}`)
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[backfill-multimodal] fetch error:", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
  }

  if (!posts || posts.length === 0) {
    return new Response(JSON.stringify({ processed: 0, remaining: 0 }), { status: 200 });
  }

  const embedUrl = `${supabaseUrl}/functions/v1/embed-multimodal`;

  let processed = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const textParts = [post.title, post.description, post.ai_caption].filter(Boolean);
      const text = textParts.join(" ").trim().slice(0, 500) || null;

      // Use first image from postmediauri, fall back to thumbnail
      let imageUrl: string | null = null;
      const mediaUris = Array.isArray(post.postmediauri)
        ? post.postmediauri
        : (typeof post.postmediauri === "string"
          ? JSON.parse(post.postmediauri || "[]")
          : []);
      const isImageUrl = (u: string) => /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(u);
      imageUrl = (mediaUris as string[]).find(isImageUrl)
        ?? (post.thumbnail_url && isImageUrl(post.thumbnail_url) ? post.thumbnail_url : null)
        ?? null;

      if (!text && !imageUrl) {
        // Nothing to embed — mark as skipped by setting a zero vector would be wasteful;
        // just leave null and skip so it won't be re-attempted unless content is added
        processed++;
        continue;
      }

      const body: Record<string, string> = {};
      if (text) body.text = text;
      if (imageUrl) body.imageUrl = imageUrl;

      await new Promise((r) => setTimeout(r, 300));

      const resp = await fetch(embedUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        console.error(`[backfill-multimodal] embed failed for post ${post.id}:`, await resp.text());
        failed++;
        continue;
      }

      const { embedding } = await resp.json();
      if (!Array.isArray(embedding) || !embedding.length) {
        failed++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("posts")
        .update({ multimodal_embedding: embedding })
        .eq("id", post.id);

      if (updateErr) {
        console.error(`[backfill-multimodal] update failed for post ${post.id}:`, updateErr);
        failed++;
      } else {
        processed++;
      }
    } catch (e) {
      console.error(`[backfill-multimodal] error on post ${post.id}:`, e);
      failed++;
    }
  }

  // Count remaining future/non-event posts without multimodal embeddings
  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .is("multimodal_embedding", null)
    .or(`type.neq.Event,every_day.eq.true,date.gte.${today},end_date.gte.${today}`);

  return new Response(
    JSON.stringify({ processed, failed, remaining: count ?? 0 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
