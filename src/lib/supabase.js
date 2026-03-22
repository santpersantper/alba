// lib/supabase.js
import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Prefer build-time Expo public env vars; fall back to app.json extra.expoPublic
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  Constants?.expoConfig?.extra?.expoPublic?.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  Constants?.expoConfig?.extra?.expoPublic?.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Check app.json/app.config and EAS/Expo env. Requests will fail.'
  );
}

// expo-secure-store has a 2 KB per-key limit. Supabase stores the session as a
// single JSON string that can exceed this. We chunk it into 1800-byte slices so
// each slice fits comfortably within the limit.
const CHUNK_SIZE = 1800;

const SecureStoreAdapter = {
  getItem: async (key) => {
    const countStr = await SecureStore.getItemAsync(`${key}_count`);
    if (!countStr) return SecureStore.getItemAsync(key); // legacy single-key fallback
    const count = parseInt(countStr, 10);
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}_${i}`))
    );
    return chunks.join('');
  },
  setItem: async (key, value) => {
    const chunks = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}_${i}`, chunk)));
    await SecureStore.setItemAsync(`${key}_count`, String(chunks.length));
  },
  removeItem: async (key) => {
    const countStr = await SecureStore.getItemAsync(`${key}_count`);
    if (countStr) {
      const count = parseInt(countStr, 10);
      await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}_${i}`))
      );
      await SecureStore.deleteItemAsync(`${key}_count`);
    } else {
      await SecureStore.deleteItemAsync(key); // legacy single-key fallback
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
