import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @deno-types="https://esm.sh/v135/stripe@14.21.0/types/index.d.ts"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno&no-check";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  // @ts-ignore
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Fixed amounts (in euro cents) for premium subscription types
const FIXED_AMOUNTS: Record<string, number> = {
  "premium-ad-free": 500,      // €5.00/month
  "premium-traveler": 499,     // €4.99/month
  "diffusion-message": 100,    // €1.00 per message
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { amount, currency = "eur", type, userId, eventId } = body;

    let amountCents: number;
    if (type && FIXED_AMOUNTS[type] !== undefined) {
      amountCents = FIXED_AMOUNTS[type];
    } else if (typeof amount === "number" && Number.isInteger(amount) && amount > 0) {
      amountCents = amount;
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid amount or unrecognised type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metadata: Record<string, string> = { userId: userId ?? "" };
    if (eventId) metadata.eventId = String(eventId);
    if (type) metadata.type = type;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      metadata,
      automatic_payment_methods: { enabled: true },
    });

    return new Response(
      JSON.stringify({ clientSecret: paymentIntent.client_secret }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-payment-intent error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
