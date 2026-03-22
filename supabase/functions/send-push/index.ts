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
    const respBody = await resp.text();
    console.log("[send-push] Expo response:", resp.status, respBody);
    if (!resp.ok) {
      console.error("[send-push] Expo push error:", resp.status, respBody);
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
    if (body.record && body.table === "messages") {
      const record = body.record;
      const isGroup: boolean = !!record.is_group;

      // Ignore rows without a sender_id (system rows, etc.)
      if (!record.sender_id) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const senderUsername: string = record.sender_username || "Someone";

      // Look up sender's display name for human-friendly notifications
      const { data: senderProfile } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", record.sender_id)
        .maybeSingle();
      const senderFirstName: string =
        (senderProfile?.name as string | null)?.split(" ")[0]?.trim() || senderUsername;

      let msgBody = record.content as string || "";
      if (msgBody.startsWith("__location__")) msgBody = `${senderFirstName} shared a location.`;
      else if (msgBody.startsWith("__feed_video__")) msgBody = `${senderFirstName} sent a Feed video.`;
      else if (!msgBody && record.media_reference) {
        // Detect video vs photo by file extension
        const ref: string = record.media_reference || "";
        msgBody = /\.(mp4|mov|m4v|webm)$/i.test(ref)
          ? `${senderFirstName} sent a video.`
          : `${senderFirstName} sent a picture.`;
      }
      else if (record.group_id) msgBody = `${senderFirstName} invited you to join a group.`;
      else if (!msgBody && record.post_id) msgBody = `${senderFirstName} sent a post.`;
      else msgBody = truncate(msgBody);

      if (!isGroup) {
        // DM: look up the recipient from chat_threads
        // chat_threads has one row per participant; find the row that belongs to
        // the other person (profile_id != sender_id) for this chat_id.
        const { data: thread } = await supabaseAdmin
          .from("chat_threads")
          .select("owner_id")
          .eq("chat_id", record.chat_id)
          .neq("owner_id", record.sender_id)
          .maybeSingle();

        const recipientId: string | null = thread?.owner_id ?? null;
        console.log("[send-push] DM chat_id:", record.chat_id, "sender:", record.sender_id, "recipientId:", recipientId);
        if (!recipientId) {
          console.log("[send-push] no recipient found in chat_threads, returning early");
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("push_token, notif_prefs")
          .eq("id", recipientId)
          .maybeSingle();

        console.log("[send-push] recipient push_token:", profile?.push_token, "notif_prefs:", JSON.stringify(profile?.notif_prefs));
        if (profile?.push_token) {
          const prefs = (profile.notif_prefs || {}) as Record<string, boolean>;
          if (prefs.chat !== false) {
            toSend.push({
              to: profile.push_token,
              title: senderFirstName,
              body: msgBody,
              data: { type: "dm", chat: record.chat_id, sender_username: senderUsername },
            });
          }
        }
      } else {
        // Group: notify all members except the sender
        const groupId: string = record.chat_id;

        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("members")
          .eq("id", groupId)
          .maybeSingle();

        const memberUsernames: string[] = (group?.members || []).filter(
          (u: string) => u !== senderUsername
        );

        if (memberUsernames.length > 0) {
          const { data: profiles } = await supabaseAdmin
            .from("profiles")
            .select("push_token, notif_prefs, muted_groups")
            .in("username", memberUsernames);

          for (const p of profiles ?? []) {
            if (!p.push_token) continue;
            const prefs = (p.notif_prefs || {}) as Record<string, boolean>;
            if (prefs.groups === false) continue;
            const mutedGroups: string[] = p.muted_groups ?? [];
            if (mutedGroups.includes(groupId)) continue;
            toSend.push({
              to: p.push_token,
              title: senderFirstName,
              body: msgBody,
              data: { type: "group_message", chat: record.chat_id },
            });
          }
        }
      }

    // ── Path B: Follow notification (direct invocation from client) ───────────
    } else if (body.type === "follow" && body.followed_user_id && body.follower_username) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("push_token, notif_prefs")
        .eq("id", body.followed_user_id)
        .maybeSingle();

      if (profile?.push_token) {
        const prefs = (profile.notif_prefs || {}) as Record<string, boolean>;
        if (prefs.follows !== false) {
          toSend.push({
            to: profile.push_token,
            title: "New follower",
            body: `@${body.follower_username} is now following you.`,
            data: { type: "follow", username: body.follower_username },
          });
        }
      }

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
