// lib/feedFirstVideoCache.js (SDK 54-safe: uses legacy FS API explicitly)
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DBG = true;
const log = (...a) => DBG && console.log("[FirstFeedCache]", ...a);

const KEY = "alba_feed_first_v1";

// ✅ cacheDirectory can be undefined in some environments; fall back safely
const BASE_DIR =
  FileSystem.cacheDirectory ||
  FileSystem.documentDirectory ||
  `${FileSystem.bundleDirectory || ""}`; // last resort (should rarely happen)

const DIR = `${BASE_DIR}alba_media_cache/feed_first/`;

const nowMs = () => global?.performance?.now?.() ?? Date.now();

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    }
  } catch (e) {
    // ignore
  }
}

async function fileExists(uri) {
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info.exists;
  } catch {
    return false;
  }
}

function safeHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return String(h);
}

export async function readCachedFirstFeedVideoOverride() {
  const t0 = nowMs();
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      log("read: MISS (no meta)", `(${Math.round(nowMs() - t0)}ms)`);
      return null;
    }
    const meta = JSON.parse(raw);

    if (!(await fileExists(meta?.cachedVideo))) {
      log("read: MISS (file missing)", meta?.cachedVideo);
      return null;
    }

    log(
      "read: HIT",
      {
        id: meta?.id,
        userId: meta?.userId,
        cachedAt: meta?.cachedAt,
        cachedVideo: meta?.cachedVideo,
      },
      `(${Math.round(nowMs() - t0)}ms)`
    );

    return meta;
  } catch (e) {
    log("read: ERR", e?.message || e, `(${Math.round(nowMs() - t0)}ms)`);
    return null;
  }
}

export async function writeCachedFirstFeedVideoOverride({
  id,
  userId,
  username,
  caption,
  remoteVideoUrl,
}) {
  const t0 = nowMs();
  if (!id || !remoteVideoUrl) return null;

  try {
    await ensureDir();

    // quick skip if already cached for same id+url and file exists
    const existing = await readCachedFirstFeedVideoOverride();
    if (
      existing &&
      existing.id === String(id) &&
      existing.remoteVideoUrl === remoteVideoUrl &&
      (await fileExists(existing.cachedVideo))
    ) {
      log("write: SKIP (already cached)", { id }, `(${Math.round(nowMs() - t0)}ms)`);
      return existing;
    }

    // Check file size before downloading — skip videos larger than 20 MB.
    // Large videos should be streamed on demand; pre-downloading them was the
    // primary driver of Supabase cached-egress overages.
    const MAX_PRELOAD_BYTES = 20 * 1024 * 1024; // 20 MB
    try {
      const headRes = await fetch(remoteVideoUrl, { method: "HEAD" });
      const contentLength = parseInt(headRes.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_PRELOAD_BYTES) {
        log("write: SKIP (video too large for preload, will stream)", {
          id: String(id),
          sizeMB: (contentLength / 1024 / 1024).toFixed(1),
        });
        return null;
      }
    } catch {
      // HEAD request failed — fall through and attempt download anyway
    }

    const fname = `first_${String(id)}_${safeHash(remoteVideoUrl)}.mp4`;
    const dest = `${DIR}${fname}`;

    try {
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {}

    log("write: downloading", { id: String(id), dest });

    const res = await FileSystem.downloadAsync(remoteVideoUrl, dest);

    const meta = {
      v: 1,
      id: String(id),
      userId: userId || null,
      username: username || null,
      caption: caption || "",
      remoteVideoUrl,
      cachedVideo: res?.uri || dest,
      cachedAt: Date.now(),
    };

    await AsyncStorage.setItem(KEY, JSON.stringify(meta));

    log("write: OK", { id: meta.id, cachedVideo: meta.cachedVideo }, `(${Math.round(nowMs() - t0)}ms)`);
    return meta;
  } catch (e) {
    log("write: ERR", e?.message || e, `(${Math.round(nowMs() - t0)}ms)`);
    return null;
  }
}

export async function cacheFirstFeedVideoFromList(firstItemLike) {
  if (!firstItemLike) return;

  const id = firstItemLike.id;
  const userId = firstItemLike.userId ?? null;
  const username = firstItemLike.username ?? null;
  const caption = firstItemLike.caption ?? "";
  const remoteVideoUrl = firstItemLike.videoUrl ?? null;

  if (!id || !remoteVideoUrl) return;

  await writeCachedFirstFeedVideoOverride({
    id,
    userId,
    username,
    caption,
    remoteVideoUrl,
  });
}
