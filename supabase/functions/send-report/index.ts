import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const rawAllowed = Deno.env.get("ALLOWED_ORIGINS") ?? "alba://";
const allowedOrigins = new Set(rawAllowed.split(",").map((o: string) => o.trim()));

function corsHeaders(origin: string | null) {
  const allowed = !origin || allowedOrigins.has(origin) ? (origin ?? "*") : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nowParts(): { sent_date: string; sent_time: string } {
  const now = new Date();
  return {
    sent_date: now.toISOString().slice(0, 10),
    sent_time: now.toTimeString().slice(0, 8),
  };
}

async function getOrCreateDmChatId(
  supabaseAdmin: ReturnType<typeof createClient>,
  userAId: string,
  userBId: string
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("chat_threads")
    .select("chat_id")
    .eq("owner_id", userAId)
    .eq("peer_profile_id", userBId)
    .eq("is_group", false)
    .maybeSingle();
  if (existing) return existing.chat_id;
  const chatId = crypto.randomUUID();
  const rows = userAId === userBId
    ? [{ owner_id: userAId, chat_id: chatId, peer_profile_id: userBId, is_group: false }]
    : [
        { owner_id: userAId, chat_id: chatId, peer_profile_id: userBId, is_group: false },
        { owner_id: userBId, chat_id: chatId, peer_profile_id: userAId, is_group: false },
      ];
  await supabaseAdmin.from("chat_threads").insert(rows);
  return chatId;
}

async function sendResendEmail(
  resendKey: string,
  from: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error("[send-report] Resend error:", resp.status, body);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const body = await req.json();
    const {
      type,                  // "community_post" | "feed_video" | "group_chat" | "profile"
      reported_by_id,
      reported_by_username,
      reason,
      poster_user_id,        // UUID of the post/video author (community_post + feed_video)
      post_id,               // UUID of the reported community post
      context,               // { video_id, video_caption, video_poster_username, group_name, chat_id/group_id, ... }
    } = body;

    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    const resendKey  = Deno.env.get("RESEND_API_KEY");
    const emailFrom  = Deno.env.get("EMAIL_FROM") ?? "Alba <noreply@yourdomain.com>";

    let conversationTranscript = "";

    // Supabase admin client — bypasses RLS so we can read profiles/auth
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Resolve alba_mod ─────────────────────────────────────────────────────
    const { data: modProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", "alba_mod")
      .maybeSingle();

    const modId: string | null = modProfile?.id ?? null;
    if (!modId) {
      console.warn("[send-report] alba_mod profile not found — skipping DM delivery");
    }

    const reporter = reported_by_username
      ? `@${reported_by_username}`
      : (reported_by_id ?? "unknown user");

    // ── Per-type logic ───────────────────────────────────────────────────────

    if (type === "community_post" || type === "feed_video") {
      // ── 1. Resolve poster profile ──────────────────────────────────────────
      let posterProfileId: string | null = null;
      let posterUsername: string | null  = null;
      let posterEmail: string | null     = null;

      if (poster_user_id) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("id, username")
          .eq("id", poster_user_id)
          .maybeSingle();
        posterProfileId = prof?.id ?? null;
        posterUsername  = prof?.username ?? null;

        // Email from auth
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(poster_user_id);
        posterEmail = authUser?.user?.email ?? null;
      }

      console.log(`[send-report] ${type} — poster: @${posterUsername} (${posterProfileId}), modId: ${modId}`);

      // ── 2. Send DM from alba_mod to poster ─────────────────────────────────
      if (modId && posterProfileId) {
        const { sent_date, sent_time } = nowParts();
        const dmChatId = await getOrCreateDmChatId(supabaseAdmin, modId, posterProfileId);

        const reasonText = (reason || "").trim();
        const noticeText =
          `Your recent post was reported by an anonymous user, with the following message. ` +
          `We will review it and evaluate if it goes against our terms of use.\n\n` +
          (reasonText || "(no reason provided)");

        // Message 1: text notice
        const { error: e1 } = await supabaseAdmin.from("messages").insert({
          sender_id:       modId,
          chat_id:         dmChatId,
          is_group:        false,
          sender_username: "alba_mod",
          content:         noticeText,
          media_reference: null,
          post_id:         null,
          group_id:        null,
          sent_date,
          sent_time,
        });
        if (e1) console.error("[send-report] DM text insert error:", e1.message);

        // Message 2: post/video reference
        const videoId   = context?.video_id ?? null;
        const targetId  = type === "feed_video" ? videoId : (post_id ?? null);

        if (targetId) {
          const isFeedVideo = type === "feed_video";
          const videoContent = isFeedVideo
            ? `__feed_video__:${JSON.stringify({ thumbnailUrl: null })}`
            : "";

          const { error: e2 } = await supabaseAdmin.from("messages").insert({
            sender_id:       modId,
            chat_id:         dmChatId,
            is_group:        false,
            sender_username: "alba_mod",
            content:         videoContent,
            media_reference: null,
            post_id:         targetId,
            group_id:        null,
            sent_date,
            sent_time,
          });
          if (e2) console.error("[send-report] DM post/video insert error:", e2.message);
        }
      }

      // ── 3. Email to poster ─────────────────────────────────────────────────
      if (resendKey && posterEmail) {
        const subject = "Important notice about your Alba post";
        const html = `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;">
            <h2 style="margin-bottom:8px;">Your post was reported</h2>
            <p style="color:#444;">
              A user reported one of your posts on Alba. We will review it and evaluate
              whether it goes against our
              <a href="https://albaappofficial.com/terms" style="color:#2F91FF;">terms of use</a>.
            </p>
            <p style="color:#444;">The report message was:</p>
            <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#666;margin:12px 0;">
              ${(reason || "").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<em>No message provided</em>"}
            </blockquote>
            <p style="color:#444;">
              If your content does not violate our guidelines, no further action will be taken.
              If you have questions, reply to this email.
            </p>
            <p style="color:#aaa;font-size:12px;margin-top:32px;">— The Alba Team</p>
          </div>`;
        await sendResendEmail(resendKey, emailFrom, posterEmail, subject, html);
        console.log("[send-report] poster email sent to", posterEmail);
      }

    } else if (type === "group") {
      // ── Report the group itself — notify alba_mod via DM + admin email ──────
      const groupId   = context?.group_id ?? null;
      const groupName = context?.group_name ?? "unknown group";

      if (modId) {
        const { sent_date, sent_time } = nowParts();
        const reporterTag = reported_by_username ? `@${reported_by_username}` : "A user";
        const noticeText =
          `${reporterTag} reported the group "${groupName}".` +
          ((reason || "").trim() ? `\n\nReason: ${reason.trim()}` : "");

        const selfChatId = await getOrCreateDmChatId(supabaseAdmin, modId, modId);
        const { error: eDm } = await supabaseAdmin.from("messages").insert({
          sender_id:       modId,
          chat_id:         selfChatId,
          is_group:        false,
          sender_username: "alba_mod",
          content:         noticeText,
          media_reference: null,
          post_id:         null,
          group_id:        groupId,
          sent_date,
          sent_time,
        });
        if (eDm) console.error("[send-report] group DM insert error:", eDm.message);
      }

    } else if (type === "group_chat") {
      // ── Notify group admins ────────────────────────────────────────────────
      const groupId   = context?.group_id ?? context?.chat_id ?? null;
      const groupName = context?.group_name ?? "the group";

      if (modId && groupId) {
        // Fetch admins (array of usernames)
        const { data: groupRow } = await supabaseAdmin
          .from("groups")
          .select("group_admin")
          .eq("id", groupId)
          .maybeSingle();

        const adminUsernames: string[] = Array.isArray(groupRow?.group_admin)
          ? groupRow.group_admin
          : [];

        if (adminUsernames.length) {
          const { data: adminProfiles } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .in("username", adminUsernames);

          const { sent_date, sent_time } = nowParts();
          const reporterTag = reported_by_username ? `@${reported_by_username}` : "a user";
          const noticeText =
            `This message on ${groupName} by ${reporterTag} was reported by an anonymous user.` +
            ((reason || "").trim() ? `\n\nReport: ${reason.trim()}` : "");

          for (const adminProf of adminProfiles ?? []) {
            const adminChatId = await getOrCreateDmChatId(supabaseAdmin, modId, adminProf.id);
            const { error: eA } = await supabaseAdmin.from("messages").insert({
              sender_id:       modId,
              chat_id:         adminChatId,
              is_group:        false,
              sender_username: "alba_mod",
              content:         noticeText,
              media_reference: null,
              post_id:         null,
              group_id:        null,
              sent_date,
              sent_time,
            });
            if (eA) console.error("[send-report] admin DM insert error:", eA.message);
          }
          console.log(`[send-report] group admins notified: ${adminUsernames.join(", ")}`);
        }
      }
    } else if (type === "dm_message") {
      // Email-only report — sender is kept anonymous, no DM sent
      // Email is handled in the admin section below

    } else if (type === "group_message") {
      // ── Notify group admins with message details ───────────────────────────
      const groupId      = context?.group_id ?? null;
      const groupNameCtx = context?.group_name ?? "the group";
      const msgContent   = context?.message_content ?? "—";
      const msgSender    = context?.message_sender_username ?? "unknown";

      if (modId && groupId) {
        const { data: groupRow2 } = await supabaseAdmin
          .from("groups")
          .select("group_admin")
          .eq("id", groupId)
          .maybeSingle();

        const adminUsernames2: string[] = Array.isArray(groupRow2?.group_admin)
          ? groupRow2.group_admin
          : [];

        if (adminUsernames2.length) {
          const { data: adminProfiles2 } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .in("username", adminUsernames2);

          const { sent_date, sent_time } = nowParts();
          const noticeText2 =
            `A message in "${groupNameCtx}" was reported.\n\n` +
            `Sender: @${msgSender}\n` +
            `Content: ${msgContent}\n\n` +
            ((reason || "").trim() ? `Report reason: ${reason.trim()}` : "(no reason provided)");

          for (const adminProf of adminProfiles2 ?? []) {
            const adminChatId = await getOrCreateDmChatId(supabaseAdmin, modId, adminProf.id);
            const { error: eGM } = await supabaseAdmin.from("messages").insert({
              sender_id:       modId,
              chat_id:         adminChatId,
              is_group:        false,
              sender_username: "alba_mod",
              content:         noticeText2,
              media_reference: null,
              post_id:         null,
              group_id:        null,
              sent_date,
              sent_time,
            });
            if (eGM) console.error("[send-report] group_message DM error:", eGM.message);
          }
          console.log(`[send-report] group_message admins notified: ${adminUsernames2.join(", ")}`);
        }
      }

    } else if (type === "conversation") {
      // ── Report a DM or group conversation from the chat list ────────────────
      // Fetch last 5 messages (newest first, then reversed for reading order)
      const chatId = context?.chat_id ?? null;
      if (chatId) {
        const { data: msgs } = await supabaseAdmin
          .from("messages")
          .select("sender_username, content, media_reference, post_id, sent_date, sent_time")
          .eq("chat_id", chatId)
          .order("sent_date", { ascending: false })
          .order("sent_time", { ascending: false })
          .limit(5);

        const reversed = (msgs || []).reverse();
        conversationTranscript = reversed.map((m: Record<string, unknown>) => {
          let content = (m.content as string) || null;
          if (!content) {
            if (m.post_id) content = "[shared post]";
            else if (m.media_reference) content = "[media]";
            else content = "[message]";
          }
          return `- @${m.sender_username || "unknown"}: ${content}`;
        }).join("\n") || "(no messages found)";
      }

    // ── Admin email (all types) ──────────────────────────────────────────────
    if (adminEmail && resendKey) {
      let subject  = "New report on Alba";
      let bodyHtml = "";

      if (type === "community_post") {
        subject  = `Community post reported by ${reporter}`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Community Post Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Post ID</td><td style="font-size:12px;color:#888;">${post_id ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>`;
      } else if (type === "feed_video") {
        subject  = `Feed video reported by ${reporter}`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Feed Video Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Video poster</td><td><strong>@${context?.video_poster_username ?? "—"}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Caption</td><td>${context?.video_caption ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Video ID</td><td style="font-size:12px;color:#888;">${context?.video_id ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>`;
      } else if (type === "profile") {
        subject  = `Profile reported: @${context?.reported_username ?? "unknown"}`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Profile Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reported profile</td><td><strong>@${context?.reported_username ?? "—"}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>`;
      } else if (type === "group") {
        subject  = `Group reported: ${context?.group_name ?? "unknown"}`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Group Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Group</td><td><strong>${context?.group_name ?? "—"}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Group ID</td><td style="font-size:12px;color:#888;">${context?.group_id ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>`;
      } else if (type === "group_chat") {
        subject  = `Group chat reported: ${context?.group_name ?? "unknown"}`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Group Chat Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Group</td><td><strong>${context?.group_name ?? "—"}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Chat ID</td><td style="font-size:12px;color:#888;">${context?.chat_id ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>`;
      } else if (type === "dm_message") {
        const msgContent   = context?.message_content ?? "—";
        const msgTime      = context?.message_sent_at ?? "—";
        const receiverUser = context?.receiver_username ?? "—";
        subject  = `[Alba Report] Direct message reported`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Direct Message Report</h2>
          <p style="color:#888;font-size:12px;margin-bottom:12px;">Sender identity is withheld from this notification.</p>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:160px;">Receiver</td><td><strong>@${receiverUser}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Date / Time</td><td>${msgTime}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Message content</td><td>${msgContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Report reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>
          <h3 style="margin-top:24px;margin-bottom:8px;">Find sender (Supabase SQL editor):</h3>
          <pre style="background:#f0f4ff;padding:16px;border-radius:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;line-height:1.6;">-- Find the sender of this message
SELECT m.sender_id, m.sender_username, m.content, m.sent_at
FROM messages m
JOIN chat_threads ct ON ct.chat_id = m.chat_id
WHERE ct.owner_id = (SELECT id FROM profiles WHERE username = '${receiverUser.replace(/'/g, "''")}')
  AND m.content ILIKE '%${msgContent.slice(0, 40).replace(/'/g, "''").replace(/</g, "").replace(/>/g, "")}%'
ORDER BY m.sent_at DESC LIMIT 5;

-- Terminate (replace USER_ID after identifying sender above):
UPDATE profiles SET account_terminated = true, ban_reason = 'Violation of Terms of Service' WHERE id = 'USER_ID';
UPDATE auth.users SET banned_until = 'infinity' WHERE id = 'USER_ID';
INSERT INTO banned_devices (device_id) SELECT device_id FROM profiles WHERE id = 'USER_ID' AND device_id IS NOT NULL ON CONFLICT DO NOTHING;</pre>`;

      } else if (type === "group_message") {
        subject  = `[Alba Report] Group message: ${context?.group_name ?? "unknown"}`;
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Group Message Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:160px;">Group</td><td><strong>${context?.group_name ?? "—"}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Message sender</td><td><strong>@${context?.message_sender_username ?? "—"}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Message content</td><td>${(context?.message_content ?? "—").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>
          <h3 style="margin-top:24px;margin-bottom:8px;">Terminate sender (Supabase SQL editor):</h3>
          <pre style="background:#f0f4ff;padding:16px;border-radius:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;line-height:1.6;">-- Confirm sender profile
SELECT id FROM profiles WHERE username = '${(context?.message_sender_username ?? "").replace(/'/g, "''")}';

-- Terminate (replace USER_ID):
UPDATE profiles SET account_terminated = true, ban_reason = 'Violation of Terms of Service' WHERE id = 'USER_ID';
UPDATE auth.users SET banned_until = 'infinity' WHERE id = 'USER_ID';
INSERT INTO banned_devices (device_id) SELECT device_id FROM profiles WHERE id = 'USER_ID' AND device_id IS NOT NULL ON CONFLICT DO NOTHING;</pre>`;

      } else if (type === "conversation") {
        const chatId = context?.chat_id ?? "—";
        const convLabel = context?.conversation_label ?? chatId;
        subject  = `[Alba Report] Conversation reported: ${convLabel}`;
        bodyHtml = `
          <h2 style="color:#d23b3b;margin-bottom:6px;">Conversation Reported</h2>
          <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">
            <tr><td style="padding:6px 0;color:#666;width:160px;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reporter ID</td><td style="font-size:12px;color:#888;">${reported_by_id ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Conversation</td><td><strong>${convLabel}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Chat ID</td><td style="font-size:12px;color:#888;">${chatId}</td></tr>
          </table>
          <h3 style="margin-bottom:8px;">Last 5 messages:</h3>
          <pre style="background:#f8f8f8;padding:16px;border-radius:8px;font-family:monospace;font-size:13px;white-space:pre-wrap;line-height:1.6;">${conversationTranscript}</pre>
          <h3 style="margin-top:24px;margin-bottom:8px;">Admin sanctions (paste into Supabase SQL editor):</h3>
          <pre style="background:#f0f4ff;padding:16px;border-radius:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;line-height:1.6;">-- Step 1: find all participants in this chat
SELECT DISTINCT sender_id, sender_username
FROM messages WHERE chat_id = '${chatId}';

-- Step 2a: 8-hour ban (replace USER_ID)
UPDATE profiles
SET banned_until = NOW() + INTERVAL '8 hours',
    ban_reason   = 'Violation of Terms of Service'
WHERE id = 'USER_ID';

-- Step 2b: 1-week ban (replace USER_ID)
UPDATE profiles
SET banned_until = NOW() + INTERVAL '1 week',
    ban_reason   = 'Violation of Terms of Service'
WHERE id = 'USER_ID';

-- Step 2c: Permanent account termination (replace USER_ID)
UPDATE profiles
SET account_terminated = TRUE,
    ban_reason         = 'Account terminated for repeated or severe violation of Terms of Service'
WHERE id = 'USER_ID';
-- Also ban in Supabase Auth (prevents re-login):
UPDATE auth.users SET banned_until = 'infinity' WHERE id = 'USER_ID';

-- Lift a ban early (replace USER_ID)
UPDATE profiles SET banned_until = NULL, ban_reason = NULL WHERE id = 'USER_ID';</pre>`;
      } else {
        bodyHtml = `
          <h2 style="margin-bottom:6px;">Report</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Type</td><td>${type ?? "unknown"}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reported by</td><td><strong>${reporter}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#666;">Reason</td><td>${reason || "<em>No reason provided</em>"}</td></tr>
          </table>`;
      }

      const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
          ${bodyHtml}
          <hr style="margin:28px 0;border:none;border-top:1px solid #e5e7eb;" />
          <p style="color:#aaa;font-size:11px;margin:0;">
            Submitted via Alba app. Review flagged content in your Supabase dashboard → Table Editor → reports.
          </p>
        </div>`;

      await sendResendEmail(resendKey, emailFrom, adminEmail, subject, html);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-report] error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
