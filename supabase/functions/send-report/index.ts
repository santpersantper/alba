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

        const reasonText = (reason || "").trim();
        const noticeText =
          `Your recent post was reported by an anonymous user, with the following message. ` +
          `We will review it and evaluate if it goes against our terms of use.\n\n` +
          (reasonText || "(no reason provided)");

        // Message 1: text notice
        const { error: e1 } = await supabaseAdmin.from("messages").insert({
          owner_id:        modId,
          chat:            posterProfileId,
          is_group:        false,
          sender_username: "alba_mod",
          sender_is_me:    true,
          content:         noticeText,
          media_reference: null,
          post_id:         null,
          group_id:        null,
          is_read:         true,
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
            owner_id:        modId,
            chat:            posterProfileId,
            is_group:        false,
            sender_username: "alba_mod",
            sender_is_me:    true,
            content:         videoContent,
            media_reference: null,
            post_id:         targetId,
            group_id:        null,
            is_read:         true,
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

        const { error: eDm } = await supabaseAdmin.from("messages").insert({
          owner_id:        modId,
          chat:            modId,
          is_group:        false,
          sender_username: "alba_mod",
          sender_is_me:    true,
          content:         noticeText,
          media_reference: null,
          post_id:         null,
          group_id:        groupId,
          is_read:         false,
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
            const { error: eA } = await supabaseAdmin.from("messages").insert({
              owner_id:        modId,
              chat:            adminProf.id,
              is_group:        false,
              sender_username: "alba_mod",
              sender_is_me:    true,
              content:         noticeText,
              media_reference: null,
              post_id:         null,
              group_id:        null,
              is_read:         true,
              sent_date,
              sent_time,
            });
            if (eA) console.error("[send-report] admin DM insert error:", eA.message);
          }
          console.log(`[send-report] group admins notified: ${adminUsernames.join(", ")}`);
        }
      }
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
