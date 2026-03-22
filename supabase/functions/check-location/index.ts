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

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1) Auth
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
    const { latitude, longitude } = await req.json();
    if (latitude == null || longitude == null) {
      return json({ error: "latitude and longitude required." }, 400);
    }

    // 3) Impossible location jump check (server-side, most reliable)
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("location_updated_at, location")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.location && profile?.location_updated_at) {
        const match = String(profile.location).match(/POINT\(([^ ]+) ([^ )]+)\)/);
        if (match) {
          const prevLon = parseFloat(match[1]);
          const prevLat = parseFloat(match[2]);
          const elapsedHours = (Date.now() - new Date(profile.location_updated_at).getTime()) / 3_600_000;

          if (elapsedHours > 0) {
            const distKm = distanceKm(prevLat, prevLon, latitude, longitude);
            const speedKmh = distKm / elapsedHours;
            console.log("Jump check:", { distKm: distKm.toFixed(1), elapsedHours: elapsedHours.toFixed(3), speedKmh: speedKmh.toFixed(0) });

            // Over 1000 km/h across more than 100 km — physically impossible without flying
            if (speedKmh > 1000 && distKm > 100) {
              return json({ spoofed: true, reason: "impossible_jump" });
            }
          }
        }
      }
    } catch (e) {
      console.warn("Jump check failed:", e?.message);
    }

    // 4) IP vs GPS country check
    // Note: this will also flag VPN users. If false-positive rate is too high, remove this check.
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;

    if (clientIp && clientIp !== "127.0.0.1" && !clientIp.startsWith("::1") && !clientIp.startsWith("::ffff:127")) {
      try {
        const [ipRes, gpsRes] = await Promise.all([
          fetch(`http://ip-api.com/json/${clientIp}?fields=status,countryCode`, {
            signal: AbortSignal.timeout(4000),
          }),
          fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            {
              headers: { "User-Agent": "AlbaApp/1.0 location-check" },
              signal: AbortSignal.timeout(4000),
            }
          ),
        ]);

        if (ipRes.ok && gpsRes.ok) {
          const ipData = await ipRes.json();
          const gpsData = await gpsRes.json();
          const ipCountry = ipData.status === "success" ? (ipData.countryCode as string) : null;
          const gpsCountry = (gpsData?.address?.country_code as string)?.toUpperCase() ?? null;

          console.log("Country check:", { ip: clientIp, ipCountry, gpsCountry });

          if (ipCountry && gpsCountry && ipCountry !== gpsCountry) {
            return json({ spoofed: true, reason: "country_mismatch" });
          }
        }
      } catch (e) {
        console.warn("IP/GPS country check failed:", e?.message);
        // Don't block on API failure — fail open
      }
    }

    return json({ spoofed: false });
  } catch (err) {
    console.error("check-location error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
