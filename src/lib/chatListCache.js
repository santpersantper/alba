// lib/chatListCache.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { trackRequest } from "./requestTracker";

const mem = {
  uid: null,
  data: null,
  ts: 0,
};

// Client-side guard: IDs of chats the user has deleted.
// Filters threads from ALL cache reads and DB fetches so a deleted chat
// never reappears, even if the DB DELETE was blocked by RLS or a realtime
// subscription triggers a re-fetch before the delete commits.
const deletedIds = new Set();

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 min

const keyFor = (uid) => `chatlist_cache_v${CACHE_VERSION}_${uid}`;

async function fetchThreads(ownerId, limit = 80) {
  const done = trackRequest(`chatList.fetchThreads limit=${limit}`);
  try {
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
  } finally {
    done();
  }
}

async function fetchProfilesByIds(ids) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return {};
  const done = trackRequest(`chatList.fetchProfilesByIds count=${uniq.length}`);
  try {
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
  } finally {
    done();
  }
}

async function fetchGroupsByIds(ids) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return {};
  const done = trackRequest(`chatList.fetchGroupsByIds count=${uniq.length}`);
  try {
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
  } finally {
    done();
  }
}

async function fetchMyGroupsByUsername(myUsername) {
  if (!myUsername) return [];
  const done = trackRequest(`chatList.fetchMyGroupsByUsername user=${myUsername}`);
  try {
    const { data, error } = await supabase
      .from("groups")
      .select("id, groupname, group_pic_link, members")
      .contains("members", [myUsername])
      .order("updated_at", { ascending: false, nullsFirst: true })
      .limit(50);

    if (error) throw error;
    return data || [];
  } finally {
    done();
  }
}

async function fetchSenderProfilesByUsernames(usernames) {
  const uniq = Array.from(new Set((usernames || []).filter(Boolean)));
  if (!uniq.length) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("username, name")
    .in("username", uniq);
  if (error || !data) return {};
  const map = {};
  for (const r of data) {
    const full = r.name || r.username || "";
    map[r.username] = { firstName: full.split(" ")[0] || full };
  }
  return map;
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

    // Filter out locally-deleted chats/groups before returning
    if (deletedIds.size > 0) {
      if (parsed?.threads) {
        parsed.threads = parsed.threads.filter((t) => !deletedIds.has(String(t.chat_id)));
      }
      if (parsed?.groupMap) {
        for (const id of deletedIds) delete parsed.groupMap[id];
      }
    }

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

  let threads = await fetchThreads(uid, limit);
  // Strip out locally-deleted chats regardless of DB state
  if (deletedIds.size > 0) {
    threads = threads.filter((t) => !deletedIds.has(String(t.chat_id)));
  }

  // in your model: chat_id == peer profile id (DM) OR group id (group)
  const dmIds = threads.filter((x) => !x.is_group).map((x) => x.chat_id).filter(Boolean);
  const groupIds = threads.filter((x) => !!x.is_group).map((x) => x.chat_id).filter(Boolean);

  const senderUsernames = threads
    .filter((x) => x.is_group && !x.last_sender_is_me && x.last_sender_username)
    .map((x) => x.last_sender_username);

  const [dmMap, groupMap, myGroups, senderProfilesMap] = await Promise.all([
    fetchProfilesByIds(dmIds),
    fetchGroupsByIds(groupIds),
    me.username ? fetchMyGroupsByUsername(me.username).catch(() => []) : Promise.resolve([]),
    fetchSenderProfilesByUsernames(senderUsernames),
  ]);

  const mergedGroupMap = { ...groupMap };
  for (const g of myGroups) {
    if (!g?.id) continue;
    if (deletedIds.has(String(g.id))) continue; // skip locally-deleted groups
    if (!mergedGroupMap[g.id]) {
      mergedGroupMap[g.id] = {
        name: g.groupname || "Group",
        avatarUrl: g.group_pic_link || null,
        members: Array.isArray(g.members) ? g.members : [],
      };
    }
  }
  // Strip deleted group IDs from the merged map
  if (deletedIds.size > 0) {
    for (const id of deletedIds) delete mergedGroupMap[id];
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
    senderProfilesMap: senderProfilesMap || {},
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

/** Call this when unread state changes (e.g. opening a chat) so ChatListScreen re-fetches on next focus. */
export function invalidateChatListCache() {
  mem.ts = 0;
}

/**
 * Remove a single chat thread from the in-memory cache immediately (e.g. after user deletes a chat).
 * Also invalidates AsyncStorage so the next focus re-fetches from DB.
 */
export function removeChatFromCache(chatId, uid) {
  if (!chatId) return;
  // Add to client-side blocklist — prevents any future cache read or DB fetch
  // from ever surfacing this thread again (even if RLS blocks the DB DELETE)
  deletedIds.add(String(chatId));
  if (mem.data?.threads) {
    mem.data = {
      ...mem.data,
      threads: mem.data.threads.filter((t) => !deletedIds.has(String(t.chat_id))),
    };
    // Persist the patched data to AsyncStorage so it survives navigation
    if (uid || mem.uid) {
      try {
        AsyncStorage.setItem(keyFor(uid || mem.uid), JSON.stringify(mem.data));
      } catch {}
    }
  }
  mem.ts = 0; // force re-fetch on next focus
}

/**
 * Immediately zero the unread count for a chat in the in-memory cache so the
 * dot clears the moment the user returns to ChatListScreen, without waiting for
 * a DB round-trip. Also forces a stale-cache flag so a real refresh follows.
 */
export function markChatReadInCache(chatId) {
  if (!chatId || !mem.data?.threads) return;
  mem.data = {
    ...mem.data,
    threads: mem.data.threads.map((t) =>
      t.chat_id === chatId
        ? { ...t, unread_count: 0, last_is_read: true }
        : t
    ),
  };
  // Do NOT reset mem.ts here — that would trigger refreshInBackground which
  // races against the RPC and overwrites the patched value with stale DB data.
  // The chat_threads Realtime subscription will refresh once the RPC commits.
}
