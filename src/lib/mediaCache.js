// lib/mediaCache.js (DROP-IN with logs)
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";

const CACHE_DIR = `${FileSystem.cacheDirectory}alba_media_cache/`;

// ✅ LOGGING
const DBG = true;
const log = (...a) => DBG && console.log("[MediaCache]", ...a);

async function ensureDir(dir) {
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      log("mkdir", dir);
    }
  } catch (e) {
    log("ensureDir ERR", dir, e?.message || e);
  }
}

async function hashUrl(url) {
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      String(url)
    );
  } catch {
    return String(url).replace(/[^a-z0-9]/gi, "_").slice(0, 80);
  }
}

export async function cacheRemoteFile(url, { folder = "community_first" } = {}) {
  if (!url || typeof url !== "string") {
    log("skip (no url)", url);
    return url;
  }
  if (url.startsWith("file://")) {
    log("skip (already file)", url);
    return url;
  }
  if (!/^https?:\/\//i.test(url)) {
    log("skip (not http)", url);
    return url;
  }

  try {
    await ensureDir(CACHE_DIR);
    const subdir = `${CACHE_DIR}${folder}/`;
    await ensureDir(subdir);

    const key = await hashUrl(url);
    const localPath = `${subdir}${key}`;

    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists && info.size > 0) {
      log("hit", { url, localPath, size: info.size });
      return localPath;
    }

    log("download", { url, localPath });
    const res = await FileSystem.downloadAsync(url, localPath);
    log("download OK", { url, uri: res?.uri, status: res?.status });

    const info2 = await FileSystem.getInfoAsync(localPath);
    log("post-download info", { localPath, exists: info2.exists, size: info2.size });

    return res?.uri || localPath || url;
  } catch (e) {
    log("download ERR", { url, err: String(e?.message || e) });
    return url; // fail open
  }
}

export async function cacheRemoteFiles(urls, opts) {
  const arr = Array.isArray(urls) ? urls.filter(Boolean).map(String) : [];
  const out = [];
  for (const u of arr) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await cacheRemoteFile(u, opts));
  }
  log("cacheRemoteFiles DONE", {
    inCount: arr.length,
    outCount: out.length,
    outHasFile: out.map((x) => String(x || "").startsWith("file://")),
  });
  return out;
}
