// One-time backfill: generates caption_embedding for all posts that don't have one yet.
// Run from project root: node scripts/backfill-embeddings.js
//
// Requires SUPABASE_SERVICE_ROLE_KEY in environment (or paste it below temporarily).
// The service role key can be found in Supabase Dashboard → Project Settings → API.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://phoepkacbrtolqmlwkvw.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY env var before running.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function embed(text) {
  const { data, error } = await supabase.functions.invoke("embed-text", {
    body: { text },
  });
  if (error || !data?.embedding) {
    throw new Error(`embed-text failed: ${error?.message || "no embedding"}`);
  }
  return data.embedding;
}

async function run() {
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, title, description")
    .is("caption_embedding", null);

  if (error) {
    console.error("Failed to fetch posts:", error.message);
    process.exit(1);
  }

  console.log(`Found ${posts.length} posts without embeddings.`);

  for (const post of posts) {
    const text = [post.title, post.description].filter(Boolean).join(" ").trim();
    if (!text) {
      console.log(`  [skip] ${post.id} — empty caption`);
      continue;
    }
    try {
      const embedding = await embed(text);
      const { error: updateError } = await supabase
        .from("posts")
        .update({ caption_embedding: embedding })
        .eq("id", post.id);
      if (updateError) throw updateError;
      console.log(`  [ok]   ${post.id} — "${text.slice(0, 50)}"`);
    } catch (e) {
      console.error(`  [err]  ${post.id} — ${e.message}`);
    }
    // Small delay to avoid hammering the Edge Function
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("Done.");
}

run();
