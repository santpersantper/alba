import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @deno-types="https://esm.sh/v135/stripe@14.21.0/types/index.d.ts"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno&no-check";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Resolve connected Stripe account for ticket payments (eventId present, no type).
    // Premium/diffusion payments go to the platform account (no transfer_data).
    let connectedAccountId: string | null = null;

    if (eventId && !type) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      // Look up the post to find group_id and author_id (organiser UUID)
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("group_id, author_id")
        .eq("id", eventId)
        .maybeSingle();

      if (post?.group_id) {
        // Event belongs to a group — use group's connected account
        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("stripe_account_id, stripe_onboarding_complete")
          .eq("id", post.group_id)
          .maybeSingle();

        if (group?.stripe_onboarding_complete && group?.stripe_account_id) {
          // Verify the account is actually charges_enabled in Stripe
          try {
            const acct = await stripe.accounts.retrieve(group.stripe_account_id);
            if (acct.charges_enabled) connectedAccountId = group.stripe_account_id;
            else console.warn("Group Stripe account not charges_enabled:", group.stripe_account_id);
          } catch (e) {
            console.warn("Failed to retrieve group Stripe account:", e);
          }
        }
      } else if (post?.author_id) {
        // Personal event — use the organiser's connected account
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("stripe_account_id, stripe_onboarding_complete")
          .eq("id", post.author_id as string)
          .maybeSingle();

        if (profile?.stripe_onboarding_complete && profile?.stripe_account_id) {
          // Verify the account is actually charges_enabled in Stripe
          try {
            const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
            if (acct.charges_enabled) connectedAccountId = profile.stripe_account_id;
            else console.warn("Profile Stripe account not charges_enabled:", profile.stripe_account_id);
          } catch (e) {
            console.warn("Failed to retrieve profile Stripe account:", e);
          }
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
