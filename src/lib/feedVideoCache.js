/**
 * feedVideoCache.js
 *
 * Multi-video disk cache for the feed. Keeps up to MAX_VIDEOS videos on device
 * storage so already-seen videos don't re-download from the CDN.
 *
 * Key behaviours:
 *  - getCachedVideoUrl(id, remoteUrl)   → returns local file:// path or null
 *  - cacheVideosInBackground(items)     → fire-and-forget; downloads in order
 *  - clearExpiredCache()                → evicts entries over size/count limits
 *
 * Limits (safe for most phones):
 *  - MAX_VIDEOS : 10 files kept on disk
 *  - MAX_BYTES  : 150 MB total cache
 *  - MAX_VIDEO_BYTES : 30 MB per video (larger ones are always streamed)
 *
 * Storage: FileSystem.cacheDirectory — OS is free to purge this under storage
 * pressure, which is fine; we just fall back to streaming when a file is gone.
 */
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DBG = false;
const log = (...a) => DBG && console.log("[FeedVideoCache]", ...a);

const CACHE_KEY = "alba_feed_video_cache_v2";
const MAX_VIDEOS = 10;
const MAX_BYTES = 150 * 1024 * 1024;    // 150 MB total
const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30 MB per video

const BASE_DIR = `${
  FileSystem.cacheDirectory || FileSystem.documentDirectory
}alba_media_cache/feed/`;

// ── helpers ───────────────────────────────────────────────────────────────────

function safeHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return String(h);
}

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(BASE_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(BASE_DIR, { intermediates: true });
  } catch {}
}

async function readIndex() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeIndex(index) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(index));
  } catch {}
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Returns the local file:// URI for a video if it is already on disk,
 * or null if it needs to be streamed.
 */
export async function getCachedVideoUrl(id, _remoteUrl) {
  if (!id) return null;
  const index = await readIndex();
  const entry = index[String(id)];
  if (!entry) return null;

  try {
    const info = await FileSystem.getInfoAsync(entry.path);
    if (info.exists) {
      log("HIT", id);
      return entry.path;
    }
    // File was purged by OS — clean up index entry
    const { [String(id)]: _removed, ...rest } = index;
    await writeIndex(rest);
    return null;
  } catch {
    return null;
  }
}

/**
 * Downloads videos from `items` (array of { id, videoUrl }) to the device cache.
 * Call fire-and-forget; errors are swallowed so they never affect the UI.
 *
 * Items are processed sequentially to avoid saturating the network.
 * Already-cached or too-large videos are skipped automatically.
 */
export async function cacheVideosInBackground(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  for (const { id, videoUrl } of items) {
    if (!id || !videoUrl || String(videoUrl).startsWith("file://")) continue;

    try {
      const index = await readIndex();

      // Already cached?
      const existing = index[String(id)];
      if (existing) {
        const info = await FileSystem.getInfoAsync(existing.path).catch(() => ({ exists: false }));
        if (info.exists) {
          log("SKIP already cached", id);
          continue;
        }
      }

      // Check file size — skip oversized videos
      let contentLength = 0;
      try {
        const head = await fetch(videoUrl, { method: "HEAD" });
        contentLength = parseInt(head.headers.get("content-length") || "0", 10);
      } catch {}

      if (contentLength > MAX_VIDEO_BYTES) {
        log("SKIP too large", id, (contentLength / 1024 / 1024).toFixed(1) + "MB");
        continue;
      }

      await ensureDir();
      const fname = `v_${String(id)}_${safeHash(videoUrl)}.mp4`;
      const dest = `${BASE_DIR}${fname}`;

      log("downloading", id);
      const result = await FileSystem.downloadAsync(videoUrl, dest);
      const savedPath = result?.uri || dest;

      // Re-read index (may have changed during await)
      const freshIndex = await readIndex();
      freshIndex[String(id)] = {
        path: savedPath,
        size: contentLength,
        cachedAt: Date.now(),
      };

      // Enforce count + size limits — evict oldest entries first
      const entries = Object.entries(freshIndex).sort((a, b) => a[1].cachedAt - b[1].cachedAt);
      let totalBytes = entries.reduce((sum, [, e]) => sum + (e.size || 0), 0);

      while ((entries.length > MAX_VIDEOS || totalBytes > MAX_BYTES) && entries.length > 0) {
        const [oldId, oldEntry] = entries.shift();
        delete freshIndex[oldId];
        totalBytes -= oldEntry.size || 0;
        FileSystem.deleteAsync(oldEntry.path, { idempotent: true }).catch(() => {});
        log("evicted", oldId);
      }

      await writeIndex(freshIndex);
      log("cached OK", id, savedPath);
    } catch (e) {
      log("ERR", id, e?.message);
    }
  }
}
