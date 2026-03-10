import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ── helpers ──────────────────────────────────────────────────────────────────

async function sendExpoPush(
  messages: Array<{ to: string; title: string; body: string; data?: object }>
): Promise<void> {
  if (messages.length === 0) return;
  // Expo Push API allows up to 100 messages per request
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(chunk),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[send-push] Expo push error:", resp.status, body);
    }
  }
}

function truncate(s: string, n = 100): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ── main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const toSend: Array<{ to: string; title: string; body: string; data?: object }> = [];

    // ── Path A: Database Webhook payload (messages INSERT) ────────────────────
    if (body.record) {
      const record = body.record;

      // Only notify for recipient copies (sender_is_me = false)
      if (record.sender_is_me !== false) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const recipientId: string = record.owner_id;
      const senderName: string = record.sender_username || "Someone";
      const isGroup: boolean = !!record.is_group;
      const notifKey = isGroup ? "groups" : "chat";

      // Determine readable content
      let msgBody = record.content as string || "";
      if (msgBody.startsWith("__location__")) msgBody = "📍 Shared a location";
      else if (msgBody.startsWith("__feed_video__")) msgBody = "🎥 Shared a video";
      else if (!msgBody && record.media_reference) msgBody = "📷 Sent a photo";
      else if (!msgBody && record.post_id) msgBody = "📌 Shared a post";
      else msgBody = truncate(msgBody);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("push_token, notif_prefs")
        .eq("id", recipientId)
        .maybeSingle();

      if (profile?.push_token) {
        const prefs = (profile.notif_prefs || {}) as Record<string, boolean>;
        if (prefs[notifKey] !== false) {
          toSend.push({
            to: profile.push_token,
            title: `@${senderName}`,
            body: msgBody,
            data: { type: isGroup ? "group_message" : "dm", chat: record.chat },
          });
        }
      }

    // ── Path B: Database Webhook payload (diffusion_message_receipts INSERT) ──
    } else if (body.record === null && body.table === "diffusion_message_receipts") {
      // Handled below via Path C shape if called differently

    // ── Path C: Direct invocation for diffusion messages ─────────────────────
    } else if (Array.isArray(body.recipient_ids) && body.title) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, push_token, notif_prefs")
        .in("id", body.recipient_ids);

      for (const p of profiles ?? []) {
        if (!p.push_token) continue;
        const prefs = (p.notif_prefs || {}) as Record<string, boolean>;
        if (prefs.diffusion !== false) {
          toSend.push({
            to: p.push_token,
            title: body.title as string,
            body: body.body as string,
            data: (body.data as object) || {},
          });
        }
      }

    // ── Path D: diffusion_message_receipts Database Webhook ──────────────────
    } else if (body.record?.recipient_id && body.table === "diffusion_message_receipts") {
      const recipientId = body.record.recipient_id;
      const messageId = body.record.message_id;

      // Look up the diffusion message
      const { data: dm } = await supabaseAdmin
        .from("diffusion_messages")
        .select("sender_name, text")
        .eq("id", messageId)
        .maybeSingle();

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("push_token, notif_prefs")
        .eq("id", recipientId)
        .maybeSingle();

      if (profile?.push_token && dm) {
        const prefs = (profile.notif_prefs || {}) as Record<string, boolean>;
        if (prefs.diffusion !== false) {
          toSend.push({
            to: profile.push_token,
            title: `📢 ${dm.sender_name || "Someone"} sent you a message`,
            body: truncate(dm.text || "You have a new broadcast message"),
            data: { type: "diffusion", message_id: messageId },
          });
        }
      }
    }

    await sendExpoPush(toSend);

    return new Response(
      JSON.stringify({ ok: true, sent: toSend.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[send-push] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
