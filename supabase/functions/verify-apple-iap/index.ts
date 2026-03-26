import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const APPLE_PRODUCTION_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

async function verifyWithApple(
  receiptData: string,
  password: string,
  sandbox = false
) {
  const url = sandbox ? APPLE_SANDBOX_URL : APPLE_PRODUCTION_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "receipt-data": receiptData,
      password,
      "exclude-old-transactions": true,
    }),
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { transactionReceipt, productId, userId } = await req.json();

    if (!transactionReceipt || !userId) {
      return json({ error: "transactionReceipt and userId are required." }, 400);
    }

    const sharedSecret = Deno.env.get("APPLE_IAP_SHARED_SECRET");
    if (!sharedSecret) {
      return json({ error: "APPLE_IAP_SHARED_SECRET is not configured." }, 503);
    }

    // Try production first; Apple returns status 21007 if it's a sandbox receipt
    let appleRes = await verifyWithApple(transactionReceipt, sharedSecret, false);
    if (appleRes.status === 21007) {
      appleRes = await verifyWithApple(transactionReceipt, sharedSecret, true);
    }

    if (appleRes.status !== 0) {
      console.error("Apple receipt validation failed, status:", appleRes.status);
      return json(
        { error: `Apple receipt validation failed (status ${appleRes.status}).` },
        400
      );
    }

    // Subscriptions: check latest_receipt_info for an active (non-expired) entry.
    // Consumables: check receipt.in_app — they have no expires_date_ms.
    const latestInfo: Record<string, string>[] = appleRes.latest_receipt_info ?? [];
    const inAppInfo: Record<string, string>[] = appleRes.receipt?.in_app ?? [];

    const activeSubscription = latestInfo.find(
      (info) =>
        info.product_id === productId &&
        Number(info.expires_date_ms) > Date.now()
    );

    const consumablePurchase = inAppInfo.find(
      (info) => info.product_id === productId
    );

    if (!activeSubscription && !consumablePurchase) {
      return json({ error: "No valid purchase found for this receipt." }, 400);
    }

    const expiresAt = activeSubscription
      ? new Date(Number(activeSubscription.expires_date_ms)).toISOString()
      : null;

    // Update the user's premium record in Supabase (best-effort — client has
    // already finished the transaction and unlocked locally via onSuccess()).
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const updatePayload: Record<string, unknown> = {
      last_iap_product_id: productId,
      last_iap_verified_at: new Date().toISOString(),
    };
    if (productId.includes("adfree")) {
      updatePayload.is_premium_ad_free = true;
      if (expiresAt) updatePayload.premium_expires_at = expiresAt;
    } else if (productId.includes("traveler")) {
      updatePayload.is_premium_traveler = true;
      if (expiresAt) updatePayload.traveler_expires_at = expiresAt;
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to update profile:", updateError.message);
      // Don't fail the request — client already unlocked the feature
    }

    return json({ ok: true, expiresAt });
  } catch (err) {
    console.error("verify-apple-iap error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
