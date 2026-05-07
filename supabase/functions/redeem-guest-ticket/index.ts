import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "code required" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const normalizedCode = code.trim().toUpperCase();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up the code
    const { data: guestCode, error: codeErr } = await admin
      .from("guest_ticket_codes")
      .select("id, code, owner_id, post_id, event_id, product_type, redeemed")
      .eq("code", normalizedCode)
      .maybeSingle();

    if (codeErr || !guestCode) {
      return new Response(JSON.stringify({ error: "invalid_code" }), {
        status: 404, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (guestCode.redeemed) {
      return new Response(JSON.stringify({ error: "already_redeemed" }), {
        status: 409, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Validate the event is still in the future
    if (guestCode.event_id) {
      const { data: ev } = await admin
        .from("events")
        .select("id, post_id")
        .eq("id", guestCode.event_id)
        .maybeSingle();

      if (ev?.post_id) {
        const { data: post } = await admin
          .from("posts")
          .select("date")
          .eq("id", ev.post_id)
          .maybeSingle();

        if (post?.date) {
          const eventDate = new Date(post.date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (eventDate < today) {
            return new Response(JSON.stringify({ error: "event_expired" }), {
              status: 410, headers: { ...headers, "Content-Type": "application/json" },
            });
          }
        }
      }
    }

    // Check if auth user with this owner_id already exists (re-entry case)
    const { data: existingUser } = await admin.auth.admin.getUserById(guestCode.owner_id);

    let email: string;
    let password: string;

    if (existingUser?.user?.id) {
      // User already exists — just sign them back in by resetting password
      email = existingUser.user.email!;
      password = generatePassword();
      await admin.auth.admin.updateUserById(guestCode.owner_id, { password });

      // Ensure username is in ticket_holders (may be missing if redeemed before this fix)
      if (guestCode.event_id) {
        const { data: prof } = await admin
          .from("profiles")
          .select("username")
          .eq("id", guestCode.owner_id)
          .maybeSingle();
        if (prof?.username) {
          const { data: evData } = await admin
            .from("events")
            .select("ticket_holders")
            .eq("id", guestCode.event_id)
            .maybeSingle();
          if (evData) {
            const holders: string[] = Array.isArray(evData.ticket_holders) ? evData.ticket_holders : [];
            const alreadyIn = holders.some(h => String(h).toLowerCase() === prof.username.toLowerCase());
            if (!alreadyIn) {
              // Replace UUID placeholder if present, otherwise append
              const idx = holders.indexOf(guestCode.owner_id);
              if (idx >= 0) holders[idx] = prof.username;
              else holders.push(prof.username);
              await admin.from("events").update({ ticket_holders: holders }).eq("id", guestCode.event_id);
            }
          }
        }
      }
    } else {
      // First redemption — create the auth user with the pre-assigned UUID
      const suffix = randomDigits(8);
      email = `guest_${guestCode.owner_id.replace(/-/g, "")}@guest.alba`;
      password = generatePassword();

      const { error: createErr } = await admin.auth.admin.createUser({
        id: guestCode.owner_id,
        email,
        password,
        email_confirm: true,
        user_metadata: { is_guest: true },
      });
      if (createErr) throw createErr;

      // Create profile
      const username = `guest_${suffix}`;
      const { error: profErr } = await admin.from("profiles").insert({
        id: guestCode.owner_id,
        name: "Guest",
        username,
        is_guest: true,
        is_verified: false,
      });
      if (profErr) {
        // Profile may already exist if trigger ran
        await admin
          .from("profiles")
          .update({ name: "Guest", username, is_guest: true })
          .eq("id", guestCode.owner_id);
      }

      // Insert the ticket now that the owner user exists
      const ticket_id = crypto.randomUUID();
      const { error: ticketErr } = await admin.from("tickets").insert({
        id: ticket_id,
        event_id: guestCode.event_id,
        post_id: String(guestCode.post_id),
        owner_id: guestCode.owner_id,
        holder_display: "",
        product_type: guestCode.product_type || null,
        qr_payload: ticket_id,
      });
      if (ticketErr) throw ticketErr;

      // Replace owner_id placeholder in ticket_holders with the guest username
      if (guestCode.event_id) {
        const { data: evData } = await admin
          .from("events")
          .select("ticket_holders")
          .eq("id", guestCode.event_id)
          .maybeSingle();
        if (evData) {
          const holders: string[] = Array.isArray(evData.ticket_holders) ? evData.ticket_holders : [];
          const idx = holders.indexOf(guestCode.owner_id);
          if (idx >= 0) holders[idx] = username;
          else holders.push(username);
          await admin.from("events").update({ ticket_holders: holders }).eq("id", guestCode.event_id);
        }
      }

      // Mark code redeemed
      await admin
        .from("guest_ticket_codes")
        .update({ redeemed: true })
        .eq("id", guestCode.id);
    }

    // Sign in with the new credentials to get a session
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signInData?.session) throw signInErr ?? new Error("sign in failed");

    return new Response(
      JSON.stringify({
        ok: true,
        session: {
          access_token: signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
          expires_in: signInData.session.expires_in,
          token_type: signInData.session.token_type,
          user: signInData.session.user,
        },
      }),
      { headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[redeem-guest-ticket]", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
