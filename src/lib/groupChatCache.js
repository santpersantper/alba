// lib/groupChatCache.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

/* ---------------- cache keys ---------------- */
const CACHE_VER = 2;
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7d

const msgKey = (chatId) => `alba_groupchat_msgs_v${CACHE_VER}:${chatId}`;
const profKey = (chatId) => `alba_groupchat_profiles_v${CACHE_VER}:${chatId}`;

/* ---------------- helpers ---------------- */
const isBlank = (s) => !s || String(s).trim() === "";
const timeKey = (d, t) => `${d || "0000-00-00"}T${t || "00:00:00"}`;
const makeMinuteKey = (sent_date, sent_time) => {
  const d = sent_date || "";
  const t = (sent_time || "").slice(0, 5);
  return `${d}_${t}`;
};

const parseJoinSystemText = (txtRaw) => {
  const txt = String(txtRaw || "").trim();
  if (!/^you joined\s+/i.test(txt) && !/ joined\s+.+\.\s*$/i.test(txt)) return null;
  if (/^you joined\b/i.test(txt)) return { who: "You" };
  const m = txt.match(/^(.+?)\s+joined\b/i);
  if (!m) return null;
  return { who: m[1].trim() };
};

/* ---------------- public: cache IO ---------------- */
export async function getCachedGroupMessages(chatId) {
  if (!chatId) return null;
  try {
    const raw = await AsyncStorage.getItem(msgKey(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.items)) return null;
    if (Date.now() - parsed.ts > CACHE_MAX_AGE_MS) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

export async function setCachedGroupMessages(chatId, items) {
  if (!chatId) return;
  try {
    await AsyncStorage.setItem(
      msgKey(chatId),
      JSON.stringify({ ts: Date.now(), items: items || [] })
    );
  } catch {}
}

export async function getCachedGroupProfiles(chatId) {
  if (!chatId) return null;
  try {
    const raw = await AsyncStorage.getItem(profKey(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts) return null;
    if (Date.now() - parsed.ts > CACHE_MAX_AGE_MS) return null;
    return { membersLine: parsed.membersLine || "", profilesMap: parsed.profilesMap || {} };
  } catch {
    return null;
  }
}

export async function setCachedGroupProfiles(chatId, membersLine, profilesMap) {
  if (!chatId) return;
  try {
    await AsyncStorage.setItem(
      profKey(chatId),
      JSON.stringify({
        ts: Date.now(),
        membersLine: membersLine || "",
        profilesMap: profilesMap || {},
      })
    );
  } catch {}
}

/* ---------------- public: db fetch ---------------- */
export async function fetchProfilesByUsernames(usernames) {
  const list = Array.from(new Set((usernames || []).filter(Boolean)));
  if (!list.length) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, avatar_url, visible_to_all")
    .in("username", list);
  if (error) throw error;
  return data || [];
}

export async function fetchGroupMessagesRows(chatId, limit = 200) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, chat, is_group, owner_id, sender_username, sender_is_me, content, media_reference, post_reference, sent_date, sent_time, is_read, post_id, group_id, sent_at")
    .eq("chat", chatId)
    .order("sent_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/* ---------------- mapping: row -> item ---------------- */
export function mapMessageRowToItem(row) {
  if (!row) return null;

  // join banner
  const joinParsed = parseJoinSystemText(row.content);
  if (joinParsed && !row.media_reference && !row.post_id && !row.group_id) {
    return {
      id: `join-${row.id}`,
      type: "join_banner",
      minuteKey: makeMinuteKey(row.sent_date, row.sent_time),
      atKey: timeKey(row.sent_date, row.sent_time),
      who: joinParsed.who,
      sent_date: row.sent_date,
      sent_time: row.sent_time,
    };
  }

  const base = {
    id: row.id,
    isMe: !!row.sender_is_me,
    senderUsername: row.sender_username || null,
    minuteKey: makeMinuteKey(row.sent_date, row.sent_time),
  };

  if (row.group_id) return { ...base, type: "invite", groupId: row.group_id };

  if (isBlank(row.content) && !row.media_reference && row.post_id) {
    return { ...base, type: "post", postId: row.post_id };
  }

  if (row.media_reference) {
    return { ...base, type: "media", uris: [row.media_reference], caption: row.content || "" };
  }

  return { ...base, type: "text", text: row.content || "" };
}

/* ---------------- enrichment: attach previews ---------------- */
async function fetchPostsPreview(postIds) {
  const ids = Array.from(new Set((postIds || []).filter(Boolean)));
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from("posts")
    .select("id, user, userpicuri, title, description, postmediauri")
    .in("id", ids);

  if (error) throw error;

  const map = {};
  for (const p of data || []) {
    const firstImg =
      Array.isArray(p.postmediauri) && p.postmediauri.length ? p.postmediauri[0] : null;

    map[p.id] = {
      id: p.id,
      username: p.user || "user",
      avatarUrl: p.userpicuri || null,
      title: (p.title || "Shared post").trim(),
      description: (p.description || "View post").trim(),
      media: firstImg,
    };
  }
  return map;
}

async function fetchGroupsPreview(groupIds) {
  const ids = Array.from(new Set((groupIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const { data: groups, error: gErr } = await supabase
    .from("groups")
    .select("id, groupname, group_pic_link, members")
    .in("id", ids);

  if (gErr) throw gErr;

  const allUsernames = Array.from(
    new Set(
      (groups || [])
        .flatMap((g) => (Array.isArray(g.members) ? g.members : []))
        .filter(Boolean)
    )
  );

  let profs = [];
  if (allUsernames.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("username, name")
      .in("username", allUsernames);
    if (!error && data) profs = data;
  }

  const nameMap = {};
  for (const p of profs || []) {
    nameMap[p.username] = p.name || p.username;
  }

  const map = {};
  for (const g of groups || []) {
    const members = Array.isArray(g.members) ? g.members : [];
    const memberLine = members.map((u) => nameMap[u] || u).filter(Boolean).join(", ");

    map[g.id] = {
      id: g.id,
      name: g.groupname || "Group",
      pic: g.group_pic_link || null,
      members,
      memberLine,
    };
  }
  return map;
}

/**
 * Fetch + map + enrich (postPreview/groupPreview embedded into items)
 * Use small limits for prewarm (e.g. 5) and bigger for real screen (e.g. 200).
 */
export async function fetchGroupMessagesEnriched(chatId, limit = 200) {
  const rows = await fetchGroupMessagesRows(chatId, limit);
  const items = (rows || []).map(mapMessageRowToItem).filter(Boolean);

  const postIds = [];
  const groupIds = [];

  for (const it of items) {
    if (it.type === "post" && it.postId) postIds.push(it.postId);
    if (it.type === "invite" && it.groupId) groupIds.push(it.groupId);
  }

  const [postMap, groupMap] = await Promise.all([
    fetchPostsPreview(postIds).catch(() => ({})),
    fetchGroupsPreview(groupIds).catch(() => ({})),
  ]);

  const enriched = items.map((it) => {
    if (it.type === "post") {
      const prev = it.postId ? postMap[it.postId] : null;
      return prev ? { ...it, postPreview: prev } : it;
    }
    if (it.type === "invite") {
      const prev = it.groupId ? groupMap[it.groupId] : null;
      return prev ? { ...it, groupPreview: prev } : it;
    }
    return it;
  });

  return enriched;
}
