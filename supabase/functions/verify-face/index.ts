import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    // 1) Validate JWT
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Authentication required." }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session." }, 401);

    // 2) Parse body
    const { selfieBase64, selfie2Base64, profileBase64, detectOnly } = await req.json();
    if (!selfieBase64) return json({ error: "selfieBase64 is required." }, 400);
    if (!detectOnly && !profileBase64) return json({ error: "profileBase64 is required." }, 400);

    // 3) Call Lambda — URL stored as Supabase secret, never in the client bundle
    const lambdaUrl = Deno.env.get("LAMBDA_VERIFY_URL");
    if (!lambdaUrl) return json({ error: "Verification service not configured." }, 503);

    const lambdaRes = await fetch(lambdaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // detectOnly: pass same image as both sides — we only need faceDetected
      body: JSON.stringify({
        userId: user.id,
        selfieBase64,
        selfie2Base64: detectOnly ? undefined : (selfie2Base64 ?? undefined),
        profileBase64: detectOnly ? selfieBase64 : profileBase64,
      }),
      signal: AbortSignal.timeout(65000),
    });

    if (!lambdaRes.ok) {
      console.error("Lambda error:", lambdaRes.status, await lambdaRes.text());
      return json({ error: "Verification service error." }, 502);
    }

    const lambdaData = await lambdaRes.json();

    // 4) detectOnly — just return whether a face was found
    if (detectOnly) return json({ faceDetected: !!lambdaData.faceDetected });

    if (!lambdaData.faceDetected) return json({ faceDetected: false, match: false, reason: lambdaData.reason ?? null });
    if (!lambdaData.match) return json({ faceDetected: true, match: false, reason: lambdaData.reason ?? null });

    // 5) Face matched — set is_verified server-side
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_verified: true, verified_at: new Date().toISOString() })
      .eq("id", user.id);

    if (updateErr) throw updateErr;

    return json({ ok: true, faceDetected: true, match: true });
  } catch (err) {
    console.error("verify-face error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
