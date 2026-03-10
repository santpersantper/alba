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
    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.error("[embed-text] OPENAI_API_KEY not configured.");
      return new Response(JSON.stringify({ error: "Not configured" }), {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.trim().slice(0, 8000), // stay within token limits
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("[embed-text] OpenAI error:", resp.status, err);
      return new Response(JSON.stringify({ error: "Embedding failed" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const embedding: number[] = json.data?.[0]?.embedding;

    if (!embedding) {
      return new Response(JSON.stringify({ error: "No embedding returned" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ embedding }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[embed-text] error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
