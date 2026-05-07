// Backfills ai_caption + caption_embedding for all posts that have media.
// Run with: node scripts/backfill-captions.mjs
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// --- load .env ---
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1`;
const AUTH = { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

function isVideoUrl(url) {
  return /\.(mp4|mov|webm|avi|mkv)(\?|$)/i.test(url);
}

function pickImageUrl(post) {
  const mediaArr = Array.isArray(post.postmediauri) ? post.postmediauri : [];
  const firstImage = mediaArr.find((u) => typeof u === "string" && u.length > 0 && !isVideoUrl(u));
  if (firstImage) return firstImage;
  if (typeof post.thumbnail_url === "string" && post.thumbnail_url.length > 0) return post.thumbnail_url;
  return null;
}

async function captionImage(imageUrl) {
  const res = await fetch(`${FUNCTION_BASE}/caption-image`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) return "";
  const json = await res.json();
  return json.caption || "";
}

async function embedText(text) {
  const res = await fetch(`${FUNCTION_BASE}/embed-text`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.embedding || null;
}

async function processPost(post, idx, total) {
  try {
    const imageUrl = pickImageUrl(post);
    const aiCaption = imageUrl ? await captionImage(imageUrl) : "";
    const textToEmbed = [post.title, post.description, aiCaption].filter(Boolean).join(" ");
    if (!textToEmbed.trim()) return "skipped";

    const embedding = await embedText(textToEmbed);
    if (!embedding) return "failed";

    const update = { caption_embedding: embedding };
    if (aiCaption) update.ai_caption = aiCaption;
    await supabase.from("posts").update(update).eq("id", post.id);

    const label = aiCaption ? "captioned" : "text-only";
    console.log(`  [${idx}/${total}] ${label} — ${post.title || post.id}`);
    return label;
  } catch (e) {
    console.error(`  [${idx}/${total}] FAILED — ${post.id}: ${e.message}`);
    return "failed";
  }
}

// Run up to `concurrency` posts in parallel
async function runWithConcurrency(posts, concurrency) {
  const stats = { captioned: 0, "text-only": 0, skipped: 0, failed: 0 };
  let idx = 0;
  const total = posts.length;

  async function worker() {
    while (idx < posts.length) {
      const post = posts[idx++];
      const result = await processPost(post, idx, total);
      stats[result] = (stats[result] || 0) + 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return stats;
}

// Fetch all posts
console.log("Fetching all posts...");
const { data: posts, error } = await supabase
  .from("posts")
  .select("id, title, description, postmediauri, thumbnail_url");

if (error) {
  console.error("Failed to fetch posts:", error.message);
  process.exit(1);
}

console.log(`Found ${posts.length} posts. Processing with concurrency 5...\n`);
const stats = await runWithConcurrency(posts, 5);
console.log("\nDone.", stats);
