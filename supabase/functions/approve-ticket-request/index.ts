import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@13.11.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(
  Deno.env.get("STRIPE_TEST_SECRET_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY") ?? "",
  { apiVersion: "2023-10-16" }
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { post_id, request_id, username } = await req.json();
    if (!post_id || (!request_id && !username)) return json({ error: "post_id and request_id are required" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Approve the request — removes from pending, returns full request data
    const { data: result, error: rpcError } = await supabaseAdmin.rpc("approve_ticket_request", {
      p_post_id: post_id,
      p_request_id: request_id ?? null,
      p_username: username ?? null,
    });
    if (rpcError) throw rpcError;

    const reqData = result?.request ?? {};
    const eventTitle: string = result?.title ?? "";
    const paymentIntentId: string | null = reqData.payment_intent_id ?? null;
    const eventId: string | null = reqData.event_id ?? null;
    const ticketsToInsert = reqData.tickets_to_insert ?? null;
    const ticketHoldersToAdd: string[] = Array.isArray(reqData.ticket_holders_to_add)
      ? reqData.ticket_holders_to_add
      : [];
    const attendeesToAdd = Array.isArray(reqData.attendees_to_add)
      ? reqData.attendees_to_add
      : [];

    // 2. Capture Stripe payment if this was a paid authorize-and-capture request
    if (paymentIntentId) {
      await stripe.paymentIntents.capture(paymentIntentId);
    }

    // 3. Issue ticket (add to event + insert ticket rows)
    if (eventId) {
      const { data: evData } = await supabaseAdmin
        .from("events")
        .select("ticket_holders, attendees_info")
        .eq("id", eventId)
        .maybeSingle();

      const currentHolders: string[] = Array.isArray(evData?.ticket_holders)
        ? evData.ticket_holders
        : [];
      const currentAttendees: unknown[] = Array.isArray(evData?.attendees_info)
        ? evData.attendees_info
        : [];

      // Merge ticket_holders (dedup)
      const seen = new Set(currentHolders.map((h) => String(h).toLowerCase()));
      const nextHolders = [...currentHolders];
      for (const h of ticketHoldersToAdd) {
        const k = String(h).toLowerCase();
        if (!seen.has(k)) { seen.add(k); nextHolders.push(h); }
      }

      const nextAttendees = [...currentAttendees, ...attendeesToAdd];

      const { error: eventErr } = await supabaseAdmin.rpc("add_event_attendee", {
        p_event_id: eventId,
        p_ticket_holders: nextHolders,
        p_attendees_info: nextAttendees,
      });
      if (eventErr) throw eventErr;

      if (ticketsToInsert && Array.isArray(ticketsToInsert) && ticketsToInsert.length > 0) {
        const { error: ticketErr } = await supabaseAdmin.from("tickets").insert(ticketsToInsert);
        if (ticketErr) throw ticketErr;
      }
    }

    // 4. Send push notification to the buyer
    supabaseAdmin.functions.invoke("send-push", {
      body: {
        type: "ticket_approved",
        recipient_username: username,
        event_title: eventTitle,
        post_id: post_id,
      },
    }).catch(() => {});

    return json({ success: true, title: eventTitle });
  } catch (err) {
    console.error("approve-ticket-request error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
