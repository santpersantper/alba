// lib/communityFirstPostCache.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { preloadProfileData } from "./profileCache";

const DBG = true;
const log = (...a) => DBG && console.log(...a);

const CACHE_KEY = "alba_firstpost_override_v3"; // bump to invalidate older extensionless files
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

const DIR = FileSystem.cacheDirectory + "alba_media_cache/community_first/";

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    }
  } catch {}
}

const isExpired = (ts) => !ts || Date.now() - ts > MAX_AGE_MS;

const stripQuery = (u = "") => String(u).split("?")[0];

// ✅ get extension from url (.mov/.mp4/...)
function extFromUrl(url) {
  const s = stripQuery(url);
  const m = s.match(/\.([a-z0-9]+)$/i);
  if (!m) return "";
  return "." + m[1].toLowerCase();
}

async function sha(url) {
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      String(url)
    );
  } catch {
    return String(url).replace(/[^a-z0-9]/gi, "_").slice(0, 80);
  }
}

async function cacheRemoteFile(url) {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("file://")) return url;

  await ensureDir();

  const key = await sha(url);
  const ext = extFromUrl(url); // ✅ preserve extension
  const localPath = `${DIR}${key}${ext || ""}`;

  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists && info.size > 0) {
            return localPath;
    }

    const res = await FileSystem.downloadAsync(url, localPath);
    const finfo = await FileSystem.getInfoAsync(res?.uri || localPath);
    return finfo?.exists && finfo?.size > 0 ? (res?.uri || localPath) : null;
  } catch (e) {
    log("LOG  [MediaCache] download ERR", url, e?.message || e);
    return null;
  }
}

async function cacheRemoteFiles(urls) {
  const arr = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const out = [];
  for (const u of arr) {
    // eslint-disable-next-line no-await-in-loop
    const p = await cacheRemoteFile(u);
    out.push(p);
  }

  return out.filter(Boolean);
}

export async function readCachedFirstPostOverride() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.cachedAt || !parsed?.postId) return null;
    if (isExpired(parsed.cachedAt)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

async function writeOverride(payload) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
  }
}

export async function warmCommunityFirstPost(postRow) {
  try {
    const p = postRow || {};
    const authorId = p.author_id || p.authorId || null;
    const username = p.user || p.username || null;
    const userpicuri = p.userpicuri || p.userPicUri || null;

    // post media can be array/json/string
    let mediaRaw = p.postmediauri ?? p.postMediaUri ?? [];
    if (typeof mediaRaw === "string") {
      const trimmed = mediaRaw.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          mediaRaw = Array.isArray(parsed) ? parsed : [trimmed];
        } catch {
          mediaRaw = [trimmed];
        }
      } else mediaRaw = [trimmed];
    }
    const mediaArr = Array.isArray(mediaRaw) ? mediaRaw.filter(Boolean) : [];

    const payloadBase = {
      postId: String(p.id ?? p.postId ?? ""),
      authorId: authorId || null,
      username: username || null,
    };

    log(" ", {
      ...payloadBase,
      userpicuri,
      mediaArr,
      mediaRawType: Array.isArray(mediaRaw) ? "array" : typeof mediaRaw,
    });

    // best-effort: warm profile cache
    if (authorId) {
      preloadProfileData({ userId: authorId }).catch(() => {});
    }
    if (username) {
      preloadProfileData({ username }).catch(() => {});
    }

    const cachedAvatar = userpicuri ? await cacheRemoteFile(userpicuri) : null;

    const cachedMedia = mediaArr.length ? await cacheRemoteFiles(mediaArr) : [];

    const payload = {
      ...payloadBase,
      cachedAt: Date.now(),
      cachedAvatar: cachedAvatar || null,
      cachedMedia: cachedMedia || [],
    };

    await writeOverride(payload);
    return payload;
  } catch (e) {
    return null;
  }
}
