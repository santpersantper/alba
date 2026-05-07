import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function isSupportedImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

function pickImageUrl(post: Record<string, unknown>): string | null {
  const mediaArr = Array.isArray(post.postmediauri) ? post.postmediauri as unknown[] : [];
  const firstImage = mediaArr.find(
    (u) => typeof u === "string" && isSupportedImageUrl(u as string)
  ) as string | undefined;
  if (firstImage) return firstImage;
  if (typeof post.thumbnail_url === "string" && isSupportedImageUrl(post.thumbnail_url)) {
    return post.thumbnail_url;
  }
  return null;
}

async function captionImage(imageUrl: string): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a content classification assistant for a local event discovery app. Your job is to analyze an image or video thumbnail of an event and extract category tags that describe what the event is about — its topic, format, and vibe.
Rules:

Focus exclusively on the nature, topic, and format of the event (e.g. what people will do, learn, experience, or consume there).
Ignore completely: dates, times, prices, physical locations, venue names, event names, organizer names, and any branding.
Always output tags in English, even if the image or poster is in another language.
Output 8-15 concrete, specific tags. Be thorough — include the main category, subcategories, synonyms, and related activities. Good examples: live music, jazz, concert, musicians, performance, stage, band, improvisation, jam session, music event.
Avoid adjectives, vague nouns, and non-categories like community, social, fun, experience, people, gathering, event, culture, lifestyle, creative.
Output only a comma-separated list of tags and nothing else.`,
          },
          { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`Caption API error ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function embedText(text: string): Promise<number[] | null> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return json.data?.[0]?.embedding ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const batchSize = 10;

  const today = new Date().toISOString().slice(0, 10);
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, title, description, postmediauri, thumbnail_url, ai_caption, type, date, end_date, every_day, repeat_days")
    .is("caption_embedding", null)
    .or(`type.neq.Event,every_day.eq.true,date.gte.${today},end_date.gte.${today}`)
    .limit(batchSize);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stats = { processed: 0, captioned: 0, text_only: 0, skipped: 0, failed: 0 };

  for (const post of posts ?? []) {
    stats.processed++;
    try {
      // Reuse existing ai_caption if present — skip the expensive vision API call.
      let aiCaption: string = (post as Record<string, unknown>).ai_caption as string ?? "";

      if (!aiCaption) {
        const imageUrl = pickImageUrl(post as Record<string, unknown>);
        if (imageUrl) {
          try {
            aiCaption = await captionImage(imageUrl);
          } catch (e) {
            console.warn(`[backfill] caption failed for post ${post.id}, falling back to text-only:`, e);
          }
        }
      }

      const textToEmbed = [post.title, post.description, aiCaption]
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .join(" ");

      if (!textToEmbed.trim()) {
        stats.skipped++;
        continue;
      }

      const embedding = await embedText(textToEmbed);
      if (!embedding) {
        stats.failed++;
        continue;
      }

      const update: Record<string, unknown> = { caption_embedding: embedding };
      if (aiCaption && !(post as Record<string, unknown>).ai_caption) {
        update.ai_caption = aiCaption;
        stats.captioned++;
      } else {
        stats.text_only++;
      }

      await supabase.from("posts").update(update).eq("id", post.id);
    } catch (e) {
      console.error(`[backfill] post ${post.id} failed:`, e);
      stats.failed++;
    }
  }

  // Count remaining future/non-event posts without ai_caption
  const { count: remaining } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .is("caption_embedding", null)
    .or(`type.neq.Event,every_day.eq.true,date.gte.${today},end_date.gte.${today}`);

  return new Response(
    JSON.stringify({ ...stats, remaining: remaining ?? 0 }),
    { headers: { "Content-Type": "application/json" } },
  );
});
