// lib/authFast.js
import { supabase } from "./supabase";

let cached = {
  userId: null,
  sessionFetchedAt: 0,

  profile: null, // { username, name, is_verified }
  profileFetchedAt: 0,
};

const SESSION_TTL_MS = 30 * 1000;  // session can change; keep short
const PROFILE_TTL_MS = 2 * 60 * 1000;

export async function getUserIdFast() {
  const now = Date.now();
  if (cached.userId && now - cached.sessionFetchedAt < SESSION_TTL_MS) {
    return cached.userId;
  }

  const { data, error } = await supabase.auth.getSession(); // local/instant
  if (error) return null;

  const uid = data?.session?.user?.id || null;
  cached.userId = uid;
  cached.sessionFetchedAt = now;
  return uid;
}

export async function getMyProfileCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached.profile && now - cached.profileFetchedAt < PROFILE_TTL_MS) {
    return cached.profile;
  }

  const userId = await getUserIdFast();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("username, name, is_verified")
    .eq("id", userId)
    .maybeSingle();

  if (error) return cached.profile || null;

  cached.profile = data || null;
  cached.profileFetchedAt = now;
  return cached.profile;
}

export async function getIsVerifiedCached() {
  const prof = await getMyProfileCached();
  return !!prof?.is_verified;
}

export async function warmAuthCache() {
  // don't block UI; best-effort warm
  try {
    await getUserIdFast();
    await getMyProfileCached();
  } catch (e) {
    console.warn("[authFast] warmAuthCache error:", e?.message || e);
  }
}

// keep cache coherent if user logs in/out
supabase.auth.onAuthStateChange((_event, session) => {
  cached.userId = session?.user?.id || null;
  cached.sessionFetchedAt = Date.now();
  cached.profile = null;
  cached.profileFetchedAt = 0;
});
