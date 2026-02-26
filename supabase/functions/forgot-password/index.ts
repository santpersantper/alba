import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WORDS = [
  "apple","beach","cloud","delta","eagle","flame","grove","hotel",
  "ivory","jewel","knife","lemon","maple","night","ocean","pearl",
  "queen","river","stone","tiger","ultra","valor","water","yacht","zebra",
];

function randomPassword(): string {
  const rand = (n: number) => Math.floor(Math.random() * n);
  const digits = String(rand(9000) + 1000); // 4-digit number
  return `${WORDS[rand(WORDS.length)]}${WORDS[rand(WORDS.length)]}${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find user by email — page through results in case of large user base
    let targetUser: { id: string; email?: string } | null = null;
    let page = 1;
    while (!targetUser) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw error;
      const users = data?.users ?? [];
      targetUser =
        users.find(
          (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
        ) ?? null;
      if (!targetUser && users.length < 1000) break; // no more pages
      page++;
    }

    // Always return ok — never reveal whether the email exists
    if (!targetUser) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newPassword = randomPassword();

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      targetUser.id,
      { password: newPassword }
    );
    if (updateErr) throw updateErr;

    // Send email via Resend (https://resend.com — free tier: 3000 emails/month)
    // Set RESEND_API_KEY and EMAIL_FROM in your Supabase project secrets:
    //   supabase secrets set RESEND_API_KEY=re_...
    //   supabase secrets set EMAIL_FROM="Alba <noreply@yourdomain.com>"
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom =
      Deno.env.get("EMAIL_FROM") ?? "Alba <noreply@yourdomain.com>";

    if (resendKey) {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: email.trim(),
          subject: "Your new Alba password",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;">
              <h2 style="margin-bottom:8px;">Password reset</h2>
              <p>Your temporary Alba password is:</p>
              <p style="font-size:22px;font-weight:700;letter-spacing:2px;
                         background:#f4f6fb;padding:12px 20px;border-radius:8px;
                         display:inline-block;">${newPassword}</p>
              <p style="margin-top:20px;">
                Log in with this password, then go to
                <strong>Community → Settings → General</strong>
                to set a new one.
              </p>
              <p style="color:#888;font-size:12px;margin-top:32px;">
                If you didn't request this, contact us immediately.
              </p>
            </div>
          `,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        console.error("[forgot-password] Resend error:", resp.status, body);
      }
    } else {
      // Fallback: log password to edge function logs (development only — remove in production)
      console.warn(
        "[forgot-password] RESEND_API_KEY not set — generated password:",
        newPassword
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[forgot-password] error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
