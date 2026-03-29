// supabase/functions/send-contact-email/index.ts
// Receives contact form submissions from the website and forwards them via Resend
// to support@albaappofficial.com.
//
// Body shape:
//   { type: "organizer" | "business" | "waitlist" | "feedback", ...fields }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(body: unknown, status = 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function row(label: string, value: string | undefined) {
  if (!value) return "";
  return `<tr>
    <td style="padding:6px 12px 6px 0;font-weight:600;color:#475569;white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:6px 0;color:#0f172a">${value.replace(/\n/g, "<br>")}</td>
  </tr>`;
}

function buildEmail(
  subject: string,
  title: string,
  fields: Record<string, string>
): { subject: string; html: string } {
  const rows = Object.entries(fields)
    .map(([label, value]) => row(label, value))
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px 24px;background:#f8fafc">
      <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <div style="margin-bottom:24px">
          <span style="color:#0ea5e9;font-size:22px;font-weight:700">alba</span>
        </div>
        <h2 style="margin:0 0 20px;font-size:18px;color:#0f172a">${title}</h2>
        <table style="border-collapse:collapse;width:100%">${rows}</table>
      </div>
      <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px">
        sent from albaappofficial.com
      </p>
    </div>
  `;

  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type } = body;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM") ?? "Alba <noreply@albaappofficial.com>";

    if (!resendKey) {
      console.error("[send-contact-email] RESEND_API_KEY not set");
      return err({ error: "email_not_configured" }, 500);
    }

    let emailContent: { subject: string; html: string };
    let replyTo: string | undefined;

    if (type === "organizer") {
      const { name, org, email, message } = body;
      if (!name || !org || !email || !message) return err({ error: "missing_fields" });
      replyTo = email;
      emailContent = buildEmail(
        `New Organizer Inquiry — ${name}`,
        "New Organizer Inquiry",
        { Name: name, Organization: org, Email: email, "About their events": message }
      );
    } else if (type === "business") {
      const { name, org, email, message } = body;
      if (!name || !org || !email || !message) return err({ error: "missing_fields" });
      replyTo = email;
      emailContent = buildEmail(
        `New Business Inquiry — ${name}`,
        "New Business Inquiry",
        { Name: name, Business: org, Email: email, "What they want to advertise": message }
      );
    } else if (type === "waitlist") {
      const { email } = body;
      if (!email) return err({ error: "missing_fields" });
      emailContent = buildEmail(
        `New Waitlist Signup — ${email}`,
        "New Waitlist Signup",
        { Email: email }
      );
    } else if (type === "feedback") {
      const { name, email, category, message } = body;
      if (!name || !email || !message) return err({ error: "missing_fields" });
      replyTo = email;
      emailContent = buildEmail(
        `New App Feedback — ${name}`,
        "New App Feedback",
        { Name: name, Email: email, ...(category ? { Category: category } : {}), Feedback: message }
      );
    } else {
      return err({ error: "unknown_type" });
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: "support@albaappofficial.com",
        reply_to: replyTo,
        subject: emailContent.subject,
        html: emailContent.html,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[send-contact-email] Resend error:", resp.status, text);
      return err({ error: "email_failed" }, 500);
    }

    return ok();
  } catch (e) {
    console.error("[send-contact-email] error:", e);
    return err({ error: "internal_error" }, 500);
  }
});
