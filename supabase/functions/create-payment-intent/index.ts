import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @deno-types="https://esm.sh/v135/stripe@14.21.0/types/index.d.ts"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno&no-check";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use test key when STRIPE_SECRET_TEST_KEY is set (for sandbox testing).
// Remove that secret to switch back to the live key.
const stripe = new Stripe(
  Deno.env.get("STRIPE_SECRET_TEST_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY") ?? "",
  {
    // @ts-ignore
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  }
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

// ── Subscription price IDs (set these as Supabase secrets) ───────────────────
// STRIPE_ADFREE_PRICE_ID  — recurring monthly Price for Ad-Free (€5.00/month)
// STRIPE_TRAVELER_PRICE_ID — recurring weekly Price for Traveler Mode (€5.00/week)
const SUBSCRIPTION_TYPES = new Set(["premium-ad-free", "premium-traveler"]);

// ── One-time payment amounts (euro cents) ────────────────────────────────────
const ONE_TIME_AMOUNTS: Record<string, number> = {
  "diffusion-message": 100, // €1.00 per message
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { amount, currency = "eur", type, userId, eventId } = body;

    // ── Subscription flow (Ad-Free / Traveler Mode) ───────────────────────────
    if (type && SUBSCRIPTION_TYPES.has(type)) {
      if (!userId) return json({ error: "userId is required for subscriptions." }, 400);

      const priceEnvKey = type === "premium-ad-free"
        ? "STRIPE_ADFREE_PRICE_ID"
        : "STRIPE_TRAVELER_PRICE_ID";
      const priceId = Deno.env.get(priceEnvKey);
      if (!priceId) {
        return json({
          error: `Subscription price not configured. Set ${priceEnvKey} as a Supabase secret.`,
        }, 503);
      }

      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      // Find or create Stripe Customer for this user
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();

      let customerId: string = profile?.stripe_customer_id ?? "";

      if (!customerId) {
        // Look up the user's email from auth
        const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
        const customer = await stripe.customers.create({
          email: authUser?.email,
          metadata: { userId },
        });
        customerId = customer.id;
        // Persist so we reuse the same customer on future purchases
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", userId);
      }

      // Create the subscription (starts in 'incomplete' until payment confirmed)
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
      });

      // @ts-ignore — expand resolves the nested object
      const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret;
      if (!clientSecret) throw new Error("Could not get PaymentIntent from subscription.");

      return json({ clientSecret });
    }

    // ── One-time payment flow (diffusion messages, tickets, products) ─────────
    let amountCents: number;
    if (type && ONE_TIME_AMOUNTS[type] !== undefined) {
      amountCents = ONE_TIME_AMOUNTS[type];
    } else if (typeof amount === "number" && Number.isInteger(amount) && amount > 0) {
      amountCents = amount;
    } else {
      return json({ error: "Invalid amount or unrecognised type." }, 400);
    }

    const metadata: Record<string, string> = { userId: userId ?? "" };
    if (eventId) metadata.eventId = String(eventId);
    if (type) metadata.type = type;

    // Resolve connected Stripe account for ticket/product payments
    let connectedAccountId: string | null = null;

    if (eventId && !type) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("stripe_account_id, stripe_onboarding_complete, author_id")
        .eq("id", eventId)
        .maybeSingle();

      let stripeAccountId: string | null = post?.stripe_account_id ?? null;
      let stripeComplete: boolean = !!post?.stripe_onboarding_complete;

      if ((!stripeAccountId || !stripeComplete) && post?.author_id) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("stripe_account_id, stripe_onboarding_complete")
          .eq("id", post.author_id as string)
          .maybeSingle();
        stripeAccountId = profile?.stripe_account_id ?? null;
        stripeComplete = !!profile?.stripe_onboarding_complete;
      }

      if (stripeComplete && stripeAccountId) {
        try {
          const acct = await stripe.accounts.retrieve(stripeAccountId);
          if (acct.charges_enabled) connectedAccountId = stripeAccountId;
          else console.warn("Stripe account not charges_enabled:", stripeAccountId);
        } catch (e) {
          console.warn("Failed to retrieve Stripe account:", e);
        }
      }
    }

    const intentParams: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency,
      metadata,
      automatic_payment_methods: { enabled: true },
    };

    if (connectedAccountId) {
      intentParams.transfer_data = { destination: connectedAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);
    return json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error("create-payment-intent error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
