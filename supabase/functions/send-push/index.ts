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

    // ── Path E: Ticket approval notification (direct invocation from client) ──
    } else if (body.type === "ticket_approved" && body.recipient_username && body.event_title && body.post_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("push_token")
        .eq("username", body.recipient_username as string)
        .maybeSingle();

      if (profile?.push_token) {
        toSend.push({
          to: profile.push_token,
          title: "Ticket approved",
          body: `You can now buy a ticket for ${body.event_title as string}`,
          data: { type: "ticket_approved", post_id: body.post_id as string },
        });
      }

    // ── Path F: Collaborator tagged notification ──────────────────────────────
    } else if (body.type === "collab_tagged" && body.collaborator_username && body.poster_username && body.post_id) {
      const { data: collabProfile } = await supabaseAdmin
        .from("profiles")
        .select("push_token")
        .eq("username", body.collaborator_username as string)
        .maybeSingle();

      if (collabProfile?.push_token) {
        toSend.push({
          to: collabProfile.push_token,
          title: `@${body.poster_username as string} tagged you`,
          body: `@${body.poster_username as string} tagged you as a collaborator on their new post. Click to review the post.`,
          data: { type: "collab_tagged", post_id: body.post_id as string },
        });
      }

    // ── Path G: New post from collaborator — notify their followers ───────────
    } else if (body.type === "new_collab_post" && body.collaborator_username && body.post_id) {
      // Look up collaborator's UUID
      const { data: collabRow } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("username", body.collaborator_username as string)
        .maybeSingle();

      if (collabRow?.id) {
        // Find everyone who follows this collaborator
        const { data: followers } = await supabaseAdmin
          .from("profiles")
          .select("push_token, notif_prefs")
          .contains("followed_users", [collabRow.id]);

        for (const f of followers ?? []) {
          if (!f.push_token) continue;
          const prefs = (f.notif_prefs || {}) as Record<string, boolean>;
          if (prefs.followed_posts === false) continue;
          toSend.push({
            to: f.push_token,
            title: "New post",
            body: `New post from @${body.collaborator_username as string}`,
            data: { type: "new_collab_post", post_id: body.post_id as string },
          });
        }
      }

    // ── Path H: Collaborator removed — DM from alba_mod to poster ────────────
    } else if (body.type === "collab_removed" && body.collaborator_username && body.poster_username) {
      const { data: modProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("username", "alba_mod")
        .maybeSingle();

      const { data: posterProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, push_token")
        .eq("username", body.poster_username as string)
        .maybeSingle();

      if (modProfile?.id && posterProfile?.id) {
        const sorted = ["alba_mod", body.poster_username as string].sort();
        const chatId = `dm_${sorted[0]}_${sorted[1]}`;

        // Ensure chat_threads rows exist for both participants
        const { data: existingThread } = await supabaseAdmin
          .from("chat_threads")
          .select("chat_id")
          .eq("chat_id", chatId)
          .eq("owner_id", modProfile.id)
          .maybeSingle();

        if (!existingThread) {
          await supabaseAdmin.from("chat_threads").insert([
            { chat_id: chatId, owner_id: modProfile.id, is_group: false },
            { chat_id: chatId, owner_id: posterProfile.id, is_group: false },
          ]);
        }

        const now = new Date();
        await supabaseAdmin.from("messages").insert({
          sender_id: modProfile.id,
          sender_username: "alba_mod",
          chat_id: chatId,
          is_group: false,
          content: `@${body.collaborator_username as string} removed his collaboration from your post. Do not include people as collaborators without their consent.`,
          sent_date: now.toISOString().slice(0, 10),
          sent_time: now.toTimeString().slice(0, 8),
        });

        if (posterProfile.push_token) {
          toSend.push({
            to: posterProfile.push_token,
            title: "alba_mod",
            body: `@${body.collaborator_username as string} removed his collaboration from your post.`,
            data: { type: "dm", chat: chatId, sender_username: "alba_mod" },
          });
        }
      }

    // ── Path I: Post shared — notify original poster + sharer's followers ───────
    } else if (body.type === "post_shared" && body.original_post_id && body.share_post_id) {
      // Fetch the share post to get sharer's identity
      const { data: sharePost } = await supabaseAdmin
        .from("posts")
        .select("author_id, username, comment")
        .eq("id", body.share_post_id as string)
        .maybeSingle();

      if (sharePost?.author_id) {
        const sharerUsername: string = sharePost.username ?? "";
        const shareComment: string = (body.comment as string) || (sharePost.comment as string) || "";

        // Fetch original post author to notify them
        const { data: originalPost } = await supabaseAdmin
          .from("posts")
          .select("author_id")
          .eq("id", body.original_post_id as string)
          .maybeSingle();

        if (originalPost?.author_id && originalPost.author_id !== sharePost.author_id) {
          const { data: origAuthorProfile } = await supabaseAdmin
            .from("profiles")
            .select("push_token, notif_prefs")
            .eq("id", originalPost.author_id)
            .maybeSingle();

          const origToken = origAuthorProfile?.push_token as string | null;
          if (origToken) {
            toSend.push({
              to: origToken,
              title: `@${sharerUsername} shared your post`,
              body: shareComment ? truncate(shareComment) : `@${sharerUsername} shared your post.`,
              data: { type: "post_shared", post_id: body.share_post_id as string },
            });
          }
        }

        // Notify followers of the sharer who have followed_posts notifications enabled
        const { data: sharerProfile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("id", sharePost.author_id)
          .maybeSingle();

        if (sharerProfile?.id) {
          const { data: followers } = await supabaseAdmin
            .from("profiles")
            .select("push_token, notif_prefs")
            .contains("followed_users", [sharePost.author_id]);

          for (const follower of (followers || [])) {
            const prefs = follower.notif_prefs as Record<string, unknown> | null;
            const wantsFollowedPosts = prefs?.followed_posts !== false;
            const token = follower.push_token as string | null;
            if (!token || !wantsFollowedPosts) continue;
            toSend.push({
              to: token,
              title: `@${sharerUsername} shared a post`,
              body: shareComment ? truncate(shareComment) : `@${sharerUsername} shared a post.`,
              data: { type: "post_shared", post_id: body.share_post_id as string },
            });
          }
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
