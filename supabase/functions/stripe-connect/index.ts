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

const APP_URL = "https://alba.app";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Authentication required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, userId, groupId } = body;

    // ─── onboard-profile ──────────────────────────────────────────────────────
    if (action === "onboard-profile") {
      if (!userId || userId !== user.id) {
        return new Response(
          JSON.stringify({ error: "userId does not match authenticated session." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: profileRow, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("id, stripe_account_id, stripe_onboarding_complete")
        .eq("id", user.id)
        .maybeSingle();

      if (profErr || !profileRow) {
        return new Response(
          JSON.stringify({ error: "Profile not found." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let accountId = profileRow.stripe_account_id;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "IT",
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { userId: String(user.id) },
        });
        accountId = account.id;
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_account_id: accountId })
          .eq("id", user.id);
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${APP_URL}/connect/refresh?userId=${user.id}`,
        return_url: `${APP_URL}/connect/return?userId=${user.id}`,
        type: "account_onboarding",
      });

      return new Response(
        JSON.stringify({ url: accountLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── status-profile ───────────────────────────────────────────────────────
    if (action === "status-profile") {
      const { data: profileRow } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, stripe_onboarding_complete")
        .eq("id", user.id)
        .maybeSingle();

      if (!profileRow?.stripe_account_id) {
        return new Response(
          JSON.stringify({ status: "not_started" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const account = await stripe.accounts.retrieve(profileRow.stripe_account_id);
      const complete =
        account.details_submitted &&
        !(account.requirements?.currently_due?.length);

      if (complete && !profileRow.stripe_onboarding_complete) {
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_onboarding_complete: true })
          .eq("id", user.id);
      }

      return new Response(
        JSON.stringify({
          status: complete ? "complete" : "pending",
          accountId: profileRow.stripe_account_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── onboard-group ────────────────────────────────────────────────────────
    if (action === "onboard-group") {
      if (!groupId) {
        return new Response(
          JSON.stringify({ error: "groupId is required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!userId || userId !== user.id) {
        return new Response(
          JSON.stringify({ error: "userId does not match authenticated session." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: groupRow, error: groupErr } = await supabaseAdmin
        .from("groups")
        .select("id, stripe_account_id, stripe_onboarding_complete")
        .eq("id", groupId)
        .maybeSingle();

      if (groupErr || !groupRow) {
        return new Response(
          JSON.stringify({ error: "Group not found." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the caller authored at least one post in this group
      const { data: postCheck } = await supabaseAdmin
        .from("posts")
        .select("id")
        .eq("group_id", groupId)
        .eq("author_id", user.id)
        .limit(1)
        .maybeSingle();

      if (!postCheck) {
        return new Response(
          JSON.stringify({ error: "Only the group organiser can set up payouts." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let accountId = groupRow.stripe_account_id;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "IT",
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { groupId: String(groupId) },
        });
        accountId = account.id;
        await supabaseAdmin
          .from("groups")
          .update({ stripe_account_id: accountId })
          .eq("id", groupId);
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${APP_URL}/connect/refresh?groupId=${groupId}`,
        return_url: `${APP_URL}/connect/return?groupId=${groupId}`,
        type: "account_onboarding",
      });

      return new Response(
        JSON.stringify({ url: accountLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── status-group ─────────────────────────────────────────────────────────
    if (action === "status-group") {
      if (!groupId) {
        return new Response(
          JSON.stringify({ error: "groupId is required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: groupRow } = await supabaseAdmin
        .from("groups")
        .select("stripe_account_id, stripe_onboarding_complete")
        .eq("id", groupId)
        .maybeSingle();

      if (!groupRow?.stripe_account_id) {
        return new Response(
          JSON.stringify({ status: "not_started" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const account = await stripe.accounts.retrieve(groupRow.stripe_account_id);
      const complete =
        account.details_submitted &&
        !(account.requirements?.currently_due?.length);

      if (complete && !groupRow.stripe_onboarding_complete) {
        await supabaseAdmin
          .from("groups")
          .update({ stripe_onboarding_complete: true })
          .eq("id", groupId);
      }

      return new Response(
        JSON.stringify({
          status: complete ? "complete" : "pending",
          accountId: groupRow.stripe_account_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("stripe-connect error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
