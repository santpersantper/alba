const rawAllowed = Deno.env.get("ALLOWED_ORIGINS") ?? "alba://";
const allowedOrigins = new Set(rawAllowed.split(",").map((o: string) => o.trim()));

function corsHeaders(origin: string | null) {
  const allowed = !origin || allowedOrigins.has(origin) ? (origin ?? "*") : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const { label } = await req.json();
    if (!label || typeof label !== "string" || !label.trim()) {
      return new Response(JSON.stringify({ error: "label required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "Not configured" }), {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 80,
        temperature: 0,
        messages: [{
          role: "user",
          content: `You are a search query expander for a local event discovery app. Given a category label, output 10-15 specific related keywords and short phrases that describe events of that type — the activity, format, topic, or vibe.\nIMPORTANT: Do NOT include broader parent categories. For example, for "pizza" do not include food, dining, cuisine, restaurant — only pizza-specific terms like pizza, pepperoni, mozzarella, pizzeria, calzone, dough, slice. For "jazz" do not include music, concert, performance — only jazz-specific terms. Stay narrow and specific to the label itself.\nOutput only a space-separated list of terms, nothing else. No punctuation, no explanations.\n\nLabel: ${label.trim()}`,
        }],
      }),
    });

    if (!resp.ok) {
      console.error("[expand-label] OpenAI error:", resp.status, await resp.text());
      return new Response(JSON.stringify({ expansion: "" }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const expansion = json.choices?.[0]?.message?.content?.trim() ?? "";

    return new Response(JSON.stringify({ expansion }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[expand-label] error:", err);
    return new Response(JSON.stringify({ expansion: "" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
