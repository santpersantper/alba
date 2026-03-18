// lib/chatLastVisited.js
// Tracks the last time the user opened each chat, stored locally in AsyncStorage.
// Used by ChatListScreen to decide whether the last message is "unread".
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "alba_chat_last_visited_v1";
let _cache = null;

async function _load() {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

/** Call when the user opens a chat (useFocusEffect). */
export async function setLastVisited(chatId) {
  if (!chatId) return;
  const map = await _load();
  map[String(chatId)] = Date.now();
  _cache = map;
  try { await AsyncStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

/** Returns { [chatId]: timestampMs }. Used by ChatListScreen. */
export async function getLastVisitedMap() {
  return _load();
}
