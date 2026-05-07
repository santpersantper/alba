const rawAllowed = Deno.env.get("ALLOWED_ORIGINS") ?? "alba://";
const allowedOrigins = new Set(rawAllowed.split(",").map((o: string) => o.trim()));

function corsHeaders(origin: string | null) {
  const allowed = !origin || allowedOrigins.has(origin) ? (origin ?? "*") : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const { imageUrl } = await req.json();

    if (!imageUrl || typeof imageUrl !== "string") {
      return new Response(JSON.stringify({ error: "imageUrl required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.error("[caption-image] OPENAI_API_KEY not configured.");
      return new Response(JSON.stringify({ error: "Not configured" }), {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image in 1-2 sentences. Focus on the main activity, theme, setting, and atmosphere. Be specific (e.g. 'outdoor music festival with a live band on stage and people dancing in a crowd' rather than 'people having fun').",
              },
              {
                type: "image_url",
                image_url: { url: imageUrl, detail: "low" },
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("[caption-image] OpenAI error:", resp.status, err);
      return new Response(JSON.stringify({ error: "Caption failed" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const caption: string = json.choices?.[0]?.message?.content?.trim() ?? "";

    return new Response(JSON.stringify({ caption }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[caption-image] error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
