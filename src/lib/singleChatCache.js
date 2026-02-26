// lib/profileCache.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const mem = { uid: null, data: null, ts: 0 };

const CACHE_VERSION = 3;
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 min

const keyFor = (uid) => `my_profile_cache_v${CACHE_VERSION}_${uid}`;
const LAST_KEY = `my_profile_cache_v${CACHE_VERSION}_LAST`; // ✅ allows paint before auth resolves

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const mergeProfile = (prev, patch) => ({ ...(isObj(prev) ? prev : {}), ...(isObj(patch) ? patch : {}) });

async function fetchMyProfile(uid) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,name,city,location,email,avatar_url,cover_url,bio,blocked_users")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** ✅ Fastest possible: memory -> LAST -> uid key */
export async function getCachedMyProfileFast(uidMaybe) {
  if (uidMaybe && mem.uid === uidMaybe && mem.data) return mem.data;
  if (!uidMaybe && mem.data) return mem.data;

  // 1) LAST key (works before auth resolves)
  try {
    const rawLast = await AsyncStorage.getItem(LAST_KEY);
    if (rawLast) {
      const parsedLast = JSON.parse(rawLast);
      const lastUid = parsedLast?.uid || null;
      const lastData = parsedLast?.data || null;
      const lastTs = parsedLast?.ts || 0;

      if (lastData && (!uidMaybe || uidMaybe === lastUid)) {
        mem.uid = lastUid;
        mem.data = lastData;
        mem.ts = lastTs;
        return lastData;
      }
    }
  } catch {}

  // 2) uid-specific key
  if (uidMaybe) {
    try {
      const raw = await AsyncStorage.getItem(keyFor(uidMaybe));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const data = parsed?.data || null;
      const ts = parsed?.ts || 0;
      if (data) {
        mem.uid = uidMaybe;
        mem.data = data;
        mem.ts = ts;
        return data;
      }
    } catch {}
  }

  return null;
}

/** ✅ Background refresh + persist */
export async function preloadMyProfile(uidMaybe) {
  let uid = uidMaybe || null;

  if (!uid) {
    const { data: auth } = await supabase.auth.getUser();
    uid = auth?.user?.id || null;
  }
  if (!uid) return null;

  const fresh = await fetchMyProfile(uid).catch(() => null);
  if (!fresh) return mem.uid === uid ? mem.data : null;

  const payload = { uid, data: fresh, ts: Date.now() };

  mem.uid = uid;
  mem.data = fresh;
  mem.ts = payload.ts;

  try {
    await AsyncStorage.setItem(keyFor(uid), JSON.stringify({ data: fresh, ts: payload.ts }));
  } catch {}
  try {
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify(payload));
  } catch {}

  return fresh;
}

export async function setCachedMyProfile(patch, uidOverride = null) {
  let uid = uidOverride || mem.uid || null;

  if (!uid) {
    try {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id || null;
    } catch {}
  }

  const next = mergeProfile(mem.data, patch);

  mem.uid = uid || mem.uid || null;
  mem.data = next;
  mem.ts = Date.now();

  const payload = { uid: mem.uid, data: next, ts: mem.ts };

  // persist best-effort
  try {
    if (mem.uid) await AsyncStorage.setItem(keyFor(mem.uid), JSON.stringify({ data: next, ts: mem.ts }));
  } catch {}
  try {
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify(payload));
  } catch {}
}

export function isMyProfileCacheFresh(uid) {
  if (!uid) return false;
  if (mem.uid !== uid || !mem.data) return false;
  return Date.now() - (mem.ts || 0) <= CACHE_TTL_MS;
}
