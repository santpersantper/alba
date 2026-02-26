// lib/chatListCache.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const mem = {
  uid: null,
  data: null,
  ts: 0,
};

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 min

const keyFor = (uid) => `chatlist_cache_v${CACHE_VERSION}_${uid}`;

async function fetchThreads(ownerId, limit = 80) {
  const { data, error } = await supabase
    .from("chat_threads")
    .select(
      "owner_id,chat_id,is_group,last_sent_at,last_sender_is_me,last_sender_username,last_content,last_media_reference,last_post_id,last_post_reference,unread_count"
    )
    .eq("owner_id", ownerId)
    .order("last_sent_at", { ascending: false, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function fetchProfilesByIds(ids) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, avatar_url")
    .in("id", uniq);

  if (error || !data) return {};
  const map = {};
  for (const row of data) {
    map[row.id] = {
      username: row.username,
      name: row.name || null,
      avatarUrl: row.avatar_url || null,
    };
  }
  return map;
}

async function fetchGroupsByIds(ids) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return {};
  const { data, error } = await supabase
    .from("groups")
    .select("id, groupname, group_pic_link, members")
    .in("id", uniq);

  if (error || !data) return {};
  const map = {};
  for (const g of data) {
    map[g.id] = {
      name: g.groupname || "Group",
      avatarUrl: g.group_pic_link || null,
      members: Array.isArray(g.members) ? g.members : [],
    };
  }
  return map;
}

async function fetchMyGroupsByUsername(myUsername) {
  if (!myUsername) return [];
  const { data, error } = await supabase
    .from("groups")
    .select("id, groupname, group_pic_link, members")
    .contains("members", [myUsername])
    .order("updated_at", { ascending: false, nullsFirst: true });

  if (error) throw error;
  return data || [];
}

async function fetchMe(uid) {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, blocked_users, event_distance_m")
    .eq("id", uid)
    .maybeSingle();

  if (error || !data) return { username: null, blocked_users: [], event_distance_m: null };
  return {
    username: data.username || null,
    blocked_users: Array.isArray(data.blocked_users) ? data.blocked_users : [],
    event_distance_m: typeof data.event_distance_m === "number" ? data.event_distance_m : null,
  };
}

/**
 * Returns cached data immediately if present (memory -> disk).
 * { threads, dmMap, groupMap, blockedUsers, maxDistanceKm, myUsername, ts }
 */
export async function getCachedChatListData(uid) {
  if (!uid) return null;

  if (mem.uid === uid && mem.data) return mem.data;

  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // stale is still ok to *render instantly*; refresh will fix
    mem.uid = uid;
    mem.data = parsed;
    mem.ts = parsed?.ts || 0;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Preloads and persists everything needed to render ChatList instantly.
 * IMPORTANT: does NOT block UI if you don't await it.
 */
export async function preloadChatListData(uid, { limit = 80 } = {}) {
  if (!uid) return null;

  const me = await fetchMe(uid);

  const threads = await fetchThreads(uid, limit);

  // in your model: chat_id == peer profile id (DM) OR group id (group)
  const dmIds = threads.filter((x) => !x.is_group).map((x) => x.chat_id).filter(Boolean);
  const groupIds = threads.filter((x) => !!x.is_group).map((x) => x.chat_id).filter(Boolean);

  const [dmMap, groupMap, myGroups] = await Promise.all([
    fetchProfilesByIds(dmIds),
    fetchGroupsByIds(groupIds),
    me.username ? fetchMyGroupsByUsername(me.username).catch(() => []) : Promise.resolve([]),
  ]);

  const mergedGroupMap = { ...groupMap };
  for (const g of myGroups) {
    if (!g?.id) continue;
    if (!mergedGroupMap[g.id]) {
      mergedGroupMap[g.id] = {
        name: g.groupname || "Group",
        avatarUrl: g.group_pic_link || null,
        members: Array.isArray(g.members) ? g.members : [],
      };
    }
  }

  const maxDistanceKm =
    typeof me.event_distance_m === "number"
      ? Math.max(0.5, me.event_distance_m / 1000)
      : 50;

  const payload = {
    ts: Date.now(),
    threads,
    dmMap,
    groupMap: mergedGroupMap,
    blockedUsers: me.blocked_users || [],
    maxDistanceKm,
    myUsername: me.username || null,
  };

  mem.uid = uid;
  mem.data = payload;
  mem.ts = payload.ts;

  try {
    await AsyncStorage.setItem(keyFor(uid), JSON.stringify(payload));
  } catch {}

  return payload;
}

export function isCacheFresh(uid) {
  if (mem.uid !== uid || !mem.data) return false;
  return Date.now() - (mem.ts || 0) <= CACHE_TTL_MS;
}
