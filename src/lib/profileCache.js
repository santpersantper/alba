import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";

/* ---------------- cache keys ---------------- */
const CACHE_VER = 2; // ✅ bump version
const CACHE_MAX_AGE_MS = 1000 * 60 * 5; // 5 min — keeps profile text (name, username) fresh

const meKey = () => `alba_profile_me_v${CACHE_VER}`;
const idKey = (userId) => `alba_profile_id_v${CACHE_VER}:${userId || "unknown"}`;
const unameKey = (username) =>
  `alba_profile_uname_v${CACHE_VER}:${String(username || "unknown")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()}`;

/* ---------------- helpers ---------------- */
const asAt = (s) => (s ? String(s).trim().replace(/^@+/, "") : "");
const isExpired = (ts) => !ts || Date.now() - ts > CACHE_MAX_AGE_MS;

const normalizeProfile = (row) => {
  if (!row) return null;
  return {
    id: row.id ?? null,
    username: row.username ?? null,
    name: row.name ?? null,
    city: row.city ?? null,
    bio: row.bio ?? null,

    // remote urls
    avatar_url: row.avatar_url ?? null,
    cover_url: row.cover_url ?? null,

    // ✅ local cached file paths (may be null)
    avatar_local: row.avatar_local ?? null,
    cover_local: row.cover_local ?? null,
  };
};

async function readKey(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !parsed?.profile) return null;
    if (isExpired(parsed.ts)) return null;
    return parsed.profile;
  } catch {
    return null;
  }
}

async function writeKey(key, profile) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), profile }));
  } catch {}
}

/* ---------------- image disk cache ---------------- */
const IMG_CACHE_DIR = FileSystem.cacheDirectory + "alba_profile_img_cache/";

async function ensureImgDir() {
  try {
    const info = await FileSystem.getInfoAsync(IMG_CACHE_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(IMG_CACHE_DIR, { intermediates: true });
  } catch {}
}

async function hashUrl(url) {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, String(url));
  } catch {
    return String(url).replace(/[^a-z0-9]/gi, "_").slice(0, 80);
  }
}

export async function cacheImageToDisk(url) {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("file://")) return url;

  await ensureImgDir();
  const key = await hashUrl(url);
  const localPath = `${IMG_CACHE_DIR}${key}`;

  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists && info.size > 0) return localPath;

    await FileSystem.downloadAsync(url, localPath);
    return localPath;
  } catch {
    return null;
  }
}

/* ---------------- public: cache IO ---------------- */
export async function getCachedProfile({ userId, username, isMe } = {}) {
  const keys = [];
  if (isMe) keys.push(meKey());
  if (userId) keys.push(idKey(userId));
  if (username) keys.push(unameKey(username));

  for (const k of keys) {
    // eslint-disable-next-line no-await-in-loop
    const p = await readKey(k);
    if (p) return p;
  }
  return null;
}

export async function setCachedProfile({ userId, username, isMe } = {}, profile) {
  const p = normalizeProfile(profile);
  if (!p) return;

  const writes = [];
  if (isMe) writes.push(writeKey(meKey(), p));
  if (userId || p.id) writes.push(writeKey(idKey(userId || p.id), p));
  if (username || p.username) writes.push(writeKey(unameKey(username || p.username), p));

  await Promise.all(writes).catch(() => {});
}

/* ---------------- public: db fetch ---------------- */
export async function fetchProfileRowById(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, city, avatar_url, cover_url, bio")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeProfile(data);
}

export async function fetchProfileRowByUsername(username) {
  const uname = asAt(username);
  if (!uname) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, city, avatar_url, cover_url, bio")
    .eq("username", uname)
    .maybeSingle();
  if (error) throw error;
  return normalizeProfile(data);
}

/* ---------------- public: preload ---------------- */
export async function preloadProfileData({ userId, username, isMe } = {}) {
  try {
    let row = null;
    if (userId) row = await fetchProfileRowById(userId);
    else if (username) row = await fetchProfileRowByUsername(username);

    if (!row) return null;

    // Only pre-cache the avatar — cover images are large and loaded on demand.
    // Pre-caching covers was the primary driver of Supabase cached-egress overages.
    const avatarLocal = row.avatar_url ? await cacheImageToDisk(row.avatar_url) : null;
    const coverLocal = null;

    const rowWithLocal = {
      ...row,
      avatar_local: avatarLocal || row.avatar_local || null,
      cover_local: coverLocal || row.cover_local || null,
    };

    await setCachedProfile(
      { userId: userId || rowWithLocal.id, username: username || rowWithLocal.username, isMe: !!isMe },
      rowWithLocal
    );

    return rowWithLocal;
  } catch {
    return null;
  }
}
