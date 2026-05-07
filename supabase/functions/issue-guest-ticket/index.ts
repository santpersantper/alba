import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://albaappofficial.com",
  "https://www.albaappofficial.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null) {
  const allowed = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part()}-${part()}-${part()}-${part()}`;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { post_id, event_id, product_type } = await req.json();

    if (!post_id || !event_id) {
      return new Response(JSON.stringify({ error: "post_id and event_id required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate post exists and allow_guests is true
    const { data: post, error: postErr } = await admin
      .from("posts")
      .select("id, allow_guests, product_prices, product_types")
      .eq("id", post_id)
      .maybeSingle();

    if (postErr || !post) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (!post.allow_guests) {
      return new Response(JSON.stringify({ error: "Guest tickets not allowed for this event" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Block if the specific requested ticket type is paid
    const prices: number[] = Array.isArray(post.product_prices) ? post.product_prices : [];
    const types: string[] = Array.isArray(post.product_types) ? post.product_types : [];
    const typeIdx = product_type ? types.findIndex((t) => t === product_type) : -1;
    const isRequestedTypePaid = typeIdx >= 0 ? Number(prices[typeIdx] ?? 0) > 0 : false;
    if (isRequestedTypePaid) {
      return new Response(JSON.stringify({ error: "paid_event" }), {
        status: 402,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Validate event exists and is in the future
    const { data: ev, error: evErr } = await admin
      .from("events")
      .select("id, post_id, ticket_holders")
      .eq("id", event_id)
      .maybeSingle();

    if (evErr || !ev) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Generate pre-assigned owner UUID and ticket code
    const owner_id = generateUUID();
    const code = generateCode();

    // Insert into guest_ticket_codes
    const { error: codeErr } = await admin.from("guest_ticket_codes").insert({
      code,
      owner_id,
      post_id: String(post_id),
      event_id,
      product_type: product_type || null,
    });
    if (codeErr) throw codeErr;

    // Add owner_id placeholder to ticket_holders for sold-out tracking
    const currentHolders: string[] = Array.isArray(ev.ticket_holders) ? ev.ticket_holders : [];
    await admin
      .from("events")
      .update({ ticket_holders: [...currentHolders, owner_id] })
      .eq("id", event_id);

    return new Response(JSON.stringify({ ok: true, code }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[issue-guest-ticket]", err);
    const msg = (err instanceof Error) ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Internal error", detail: msg }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
