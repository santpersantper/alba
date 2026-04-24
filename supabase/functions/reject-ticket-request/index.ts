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
    const { post_id, username } = await req.json();
    if (!post_id || !username) return json({ error: "post_id and username are required" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Reject the request — removes from pending, returns payment_intent_id if any
    const { data: result, error: rpcError } = await supabaseAdmin.rpc("reject_ticket_request", {
      p_post_id: post_id,
      p_username: username,
    });
    if (rpcError) throw rpcError;

    const paymentIntentId: string | null = result?.payment_intent_id ?? null;

    // 2. Cancel Stripe PaymentIntent if this was a paid authorize-and-capture request
    if (paymentIntentId) {
      await stripe.paymentIntents.cancel(paymentIntentId);
    }

    return json({ success: true });
  } catch (err) {
    console.error("reject-ticket-request error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
