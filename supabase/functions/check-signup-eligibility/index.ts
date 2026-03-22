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

const MAX_ACCOUNTS_PER_DEVICE = 2;
const MAX_ACCOUNTS_PER_IP = 2;

// ── Disposable email blocklist (cached in-memory per function instance) ───────
const BLOCKLIST_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf";

let disposableDomainsCache: Set<string> | null = null;

async function getDisposableDomains(): Promise<Set<string>> {
  if (disposableDomainsCache) return disposableDomainsCache;
  const res = await fetch(BLOCKLIST_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Failed to fetch blocklist: ${res.status}`);
  const text = await res.text();
  disposableDomainsCache = new Set(
    text.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean)
  );
  return disposableDomainsCache;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { device_id, email_domain } = await req.json();

    // ── Disposable email check ────────────────────────────────────────────────
    if (email_domain) {
      const domain = email_domain.trim().toLowerCase();
      try {
        const blocked = await getDisposableDomains();
        if (blocked.has(domain)) {
          return json({ allowed: false, reason: "disposable" });
        }
      } catch (e) {
        console.error("[check-signup-eligibility] blocklist fetch failed:", e);
        // Fail open — don't block if we can't fetch the list
      }
      return json({ allowed: true, reason: null });
    }

    // Detect client IP from headers
    const xForwardedFor = req.headers.get("x-forwarded-for");
    const xRealIp = req.headers.get("x-real-ip");
    const clientIp = xForwardedFor?.split(",")[0].trim() ?? xRealIp ?? null;

    console.log("[check-signup-eligibility] device_id:", device_id);
    console.log("[check-signup-eligibility] x-forwarded-for:", xForwardedFor);
    console.log("[check-signup-eligibility] x-real-ip:", xRealIp);
    console.log("[check-signup-eligibility] clientIp resolved:", clientIp);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Device ID check ──────────────────────────────────────────────────────
    if (device_id) {
      const { count: deviceCount, error: deviceErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("device_id", device_id);

      if (deviceErr) {
        console.error("[check-signup-eligibility] device check error:", deviceErr);
      } else {
        console.log("[check-signup-eligibility] deviceCount:", deviceCount);
        if ((deviceCount ?? 0) >= MAX_ACCOUNTS_PER_DEVICE) {
          return json({ allowed: false, reason: "device_limit" });
        }
      }
    }

    // ── IP check ─────────────────────────────────────────────────────────────
    if (clientIp) {
      const { count: ipCount, error: ipErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("signup_ip", clientIp);

      if (ipErr) {
        console.error("[check-signup-eligibility] ip check error:", ipErr);
      } else {
        console.log("[check-signup-eligibility] ipCount:", ipCount);
        if ((ipCount ?? 0) >= MAX_ACCOUNTS_PER_IP) {
          return json({ allowed: false, reason: "ip_limit" });
        }
      }
    } else {
      console.warn("[check-signup-eligibility] clientIp is null — IP check skipped");
    }

    return json({ allowed: true, reason: null });
  } catch (err) {
    console.error("check-signup-eligibility error:", err);
    // Fail open — don't block sign-up if the check itself errors
    return json({ allowed: true, reason: null });
  }
});
