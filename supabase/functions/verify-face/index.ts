import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const { userId } = body;

    if (!userId || userId !== user.id) {
      return new Response(
        JSON.stringify({ error: "userId does not match authenticated session." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, is_verified")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) throw profileErr;
    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (profile.is_verified) {
      return new Response(
        JSON.stringify({ ok: true, alreadyVerified: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_verified: true, verified_at: new Date().toISOString() })
      .eq("id", user.id);

    if (updateErr) throw updateErr;

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("verify-face error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
