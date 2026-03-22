import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(body: unknown, status = 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Disposable email blocklist ────────────────────────────────────────────────

let disposableDomainsCache: Set<string> | null = null;

const DISPOSABLE_FALLBACK = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamailblock.com", "grr.la",
  "guerrillamail.info", "guerrillamail.biz", "guerrillamail.de", "guerrillamail.net",
  "guerrillamail.org", "10minutemail.com", "10minutemail.net", "tempmail.com",
  "throwam.com", "yopmail.com", "sharklasers.com", "trashmail.com", "trashmail.me",
  "trashmail.net", "dispostable.com", "spam4.me", "maildrop.cc", "mailnull.com",
  "spamgourmet.com", "discard.email", "fakeinbox.com", "mailnesia.com",
  "mt2015.com", "mailnull.com", "getairmail.com", "mailforspam.com",
  "spamfree24.org", "spammotel.com", "spaml.com", "trashdevil.com",
  "wegwerfmail.de", "armyspy.com", "cuvox.de", "dayrep.com", "einrot.com",
  "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com",
  "teleworm.us", "tinyurl24.com", "tempinbox.com",
]);

async function getDisposableDomains(): Promise<Set<string>> {
  if (disposableDomainsCache) return disposableDomainsCache;
  try {
    const resp = await fetch(
      "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) throw new Error("fetch failed");
    const text = await resp.text();
    disposableDomainsCache = new Set(
      text.split("\n").map((l: string) => l.trim().toLowerCase()).filter(Boolean)
    );
  } catch {
    disposableDomainsCache = DISPOSABLE_FALLBACK;
  }
  return disposableDomainsCache;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getClientIp(req: Request): string | null {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

async function findUserIdByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim();
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const users = data?.users ?? [];
    const found = users.find((u: { email?: string; id: string }) =>
      u.email?.toLowerCase() === normalizedEmail
    );
    if (found) return found.id;
    if (users.length < 1000) return null;
    page++;
  }
}

async function sendOtpEmail(
  email: string,
  code: string,
  subject: string,
  headline: string
): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM") ?? "Alba <noreply@yourdomain.com>";
  if (!resendKey) {
    console.warn("[send-verification-code] RESEND_API_KEY not set — code not delivered.");
    return;
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom,
      to: email.trim(),
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;">
          <h2 style="margin-bottom:8px;">${headline}</h2>
          <p>Your Alba verification code is:</p>
          <p style="font-size:40px;font-weight:700;letter-spacing:10px;
                     background:#f4f6fb;padding:16px 24px;border-radius:8px;
                     display:inline-block;margin:8px 0;">${code}</p>
          <p style="margin-top:16px;color:#555;">
            This code expires in 10 minutes. Do not share it with anyone.
          </p>
          <p style="color:#888;font-size:12px;margin-top:32px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error("[send-verification-code] Resend error:", resp.status, body);
    throw new Error("Email delivery failed");
  }
}

async function upsertAndSendOtp(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
  subject: string,
  headline: string,
  extraFields: Record<string, unknown> = {}
): Promise<{ rateLimit?: number }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit: 1 code per email per 60 seconds
  const { data: existing } = await supabaseAdmin
    .from("email_verifications")
    .select("created_at")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existing?.created_at) {
    const elapsed = Date.now() - new Date(existing.created_at).getTime();
    const cooldown = 60_000;
    if (elapsed < cooldown) {
      return { rateLimit: Math.ceil((cooldown - elapsed) / 1000) };
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: upsertErr } = await supabaseAdmin
    .from("email_verifications")
    .upsert(
      { email: normalizedEmail, code, expires_at: expiresAt, verified: false, ...extraFields },
      { onConflict: "email" }
    );
  if (upsertErr) throw upsertErr;

  await sendOtpEmail(email, code, subject, headline);
  return {};
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const clientIp = getClientIp(req);

    // ════════════════════════════════════════════════════════════════════════
    // SIGN-UP FLOW
    // ════════════════════════════════════════════════════════════════════════

    // ── SEND: pre-signup OTP ─────────────────────────────────────────────────
    if (body.action === "send") {
      const email: string | undefined = body.email;
      const deviceId: string | undefined = body.device_id;

      if (!email || typeof email !== "string") return err({ error: "email_required" });

      const normalizedEmail = email.toLowerCase().trim();
      const domain = normalizedEmail.split("@")[1] ?? "";

      // 1. Disposable email check
      const blocked = await getDisposableDomains();
      if (blocked.has(domain)) {
        return err({ error: "disposable_email" }, 403);
      }

      // 2. Device ban check
      if (deviceId) {
        const { data: ban } = await supabaseAdmin
          .from("banned_devices")
          .select("id")
          .eq("device_id", deviceId)
          .maybeSingle();
        if (ban) return err({ error: "device_banned" }, 403);
      }

      // 3. Max 2 accounts per device
      if (deviceId) {
        const { count } = await supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("device_id", deviceId);
        if ((count ?? 0) >= 2) return err({ error: "device_limit" }, 403);
      }

      // 4. Max 2 accounts per IP
      if (clientIp) {
        const { count } = await supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("signup_ip", clientIp);
        if ((count ?? 0) >= 2) return err({ error: "ip_limit" }, 403);
      }

      // 5. Send OTP (with rate limit check), store IP for later
      const result = await upsertAndSendOtp(
        supabaseAdmin,
        email,
        "Your Alba verification code",
        "Verify your email",
        { signup_ip: clientIp }
      );
      if (result.rateLimit !== undefined) {
        return err({ error: "rate_limit", wait: result.rateLimit }, 429);
      }

      return ok();

    // ── VERIFY: check signup OTP ─────────────────────────────────────────────
    } else if (body.action === "verify") {
      const email: string | undefined = body.email;
      const code: string | undefined = body.code;

      if (!email || !code) return err({ error: "email_and_code_required" });

      const normalizedEmail = email.toLowerCase().trim();

      const { data: row, error: fetchErr } = await supabaseAdmin
        .from("email_verifications")
        .select("code, expires_at, verified, signup_ip")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!row) return ok({ ok: false, reason: "no_code" });
      if (row.verified) return ok({ ok: false, reason: "already_used" });
      if (new Date(row.expires_at) < new Date()) return ok({ ok: false, reason: "expired" });
      if (row.code !== code.trim()) return ok({ ok: false, reason: "wrong_code" });

      await supabaseAdmin
        .from("email_verifications")
        .update({ verified: true })
        .eq("email", normalizedEmail);

      // Return stored IP so client can persist it in the profile upsert
      return ok({ ok: true, signup_ip: row.signup_ip ?? null });

    // ════════════════════════════════════════════════════════════════════════
    // LOGIN DEVICE FLOW
    // ════════════════════════════════════════════════════════════════════════

    // ── CHECK_LOGIN_DEVICE: is this device known for this user? ──────────────
    } else if (body.action === "check_login_device") {
      const email: string | undefined = body.email;
      const deviceId: string | undefined = body.device_id;

      if (!email || !deviceId) return err({ error: "email_and_device_id_required" });

      const userId = await findUserIdByEmail(supabaseAdmin, email);
      if (!userId) {
        // Don't reveal that the email doesn't exist — return "known" so the
        // normal login attempt proceeds and Supabase auth returns the error.
        return ok({ status: "known" });
      }

      const { data: devices } = await supabaseAdmin
        .from("user_devices")
        .select("device_id")
        .eq("user_id", userId);

      const knownDevices = devices ?? [];

      if (knownDevices.length === 0) {
        // No devices registered yet: first login after this feature shipped.
        return ok({ status: "first_device", user_id: userId });
      }

      const isKnown = knownDevices.some((d: { device_id: string }) => d.device_id === deviceId);
      return ok({ status: isKnown ? "known" : "new_device", user_id: userId });

    // ── SEND_LOGIN_OTP: send OTP for new-device login ────────────────────────
    } else if (body.action === "send_login_otp") {
      const email: string | undefined = body.email;
      if (!email) return err({ error: "email_required" });

      const result = await upsertAndSendOtp(
        supabaseAdmin,
        email,
        "New device login — Alba verification code",
        "New device detected"
      );
      if (result.rateLimit !== undefined) {
        return err({ error: "rate_limit", wait: result.rateLimit }, 429);
      }
      return ok();

    // ── VERIFY_LOGIN_OTP: verify code + register device ──────────────────────
    } else if (body.action === "verify_login_otp") {
      const email: string | undefined = body.email;
      const code: string | undefined = body.code;
      const deviceId: string | undefined = body.device_id;
      const userId: string | undefined = body.user_id;

      if (!email || !code || !deviceId) return err({ error: "email_code_device_required" });

      const normalizedEmail = email.toLowerCase().trim();

      const { data: row, error: fetchErr } = await supabaseAdmin
        .from("email_verifications")
        .select("code, expires_at, verified")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!row) return ok({ ok: false, reason: "no_code" });
      if (row.verified) return ok({ ok: false, reason: "already_used" });
      if (new Date(row.expires_at) < new Date()) return ok({ ok: false, reason: "expired" });
      if (row.code !== code.trim()) return ok({ ok: false, reason: "wrong_code" });

      // Mark OTP used
      await supabaseAdmin
        .from("email_verifications")
        .update({ verified: true })
        .eq("email", normalizedEmail);

      // Register device
      const resolvedUserId = userId ?? (await findUserIdByEmail(supabaseAdmin, email));
      if (resolvedUserId) {
        await supabaseAdmin
          .from("user_devices")
          .upsert(
            { user_id: resolvedUserId, device_id: deviceId, last_seen: new Date().toISOString() },
            { onConflict: "user_id,device_id" }
          );
      }

      return ok({ ok: true });

    // ── REGISTER_DEVICE: record first/known device after login ───────────────
    } else if (body.action === "register_device") {
      // Requires a valid user JWT in the Authorization header
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return err({ error: "unauthorized" }, 401);

      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) return err({ error: "unauthorized" }, 401);

      const deviceId: string | undefined = body.device_id;
      if (!deviceId) return err({ error: "device_id_required" });

      await supabaseAdmin
        .from("user_devices")
        .upsert(
          { user_id: user.id, device_id: deviceId, last_seen: new Date().toISOString() },
          { onConflict: "user_id,device_id" }
        );

      return ok();

    } else {
      return err({ error: "unknown_action" });
    }
  } catch (e) {
    console.error("[send-verification-code] error:", e);
    return err({ error: "internal_error" }, 500);
  }
});
