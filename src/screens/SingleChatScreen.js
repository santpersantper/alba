// screens/SingleChatScreen.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Modal,
  Image,
  ActivityIndicator,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useFonts } from "expo-font";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import { uploadChatMedia } from "../lib/uploadImage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { Image as ExpoImage } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setLastVisited } from "../lib/chatLastVisited";
import Constants from "expo-constants";

import TextMessage from "../components/chat/TextMessage";
import MediaMessage from "../components/chat/MediaMessage";
import PostMessage from "../components/chat/PostMessage";
import FeedVideoMessage from "../components/chat/FeedVideoMessage";
import InviteMessage from "../components/chat/InviteMessage";
import LocationMessage from "../components/chat/LocationMessage";

/* ---------------- helpers ---------------- */
const asAt = (s) => String(s || "").replace(/^@+/, "");

const makeMinuteKey = (sent_date, sent_time) => {
  const d = String(sent_date || "").trim();
  const t = String(sent_time || "").slice(0, 5);
  return `${d}_${t}`;
};

const prefetchUri = (uri) => {
  if (!uri) return;
  try {
    Image.prefetch(uri);
    ExpoImage.prefetch?.(uri);
  } catch {}
};

const prefetchForItems = (items) => {
  try {
    const uris = [];
    for (const it of items || []) {
      if (it?.type === "media" && Array.isArray(it.uris)) it.uris.forEach((u) => u && uris.push(u));
      if (it?.groupPreview?.pic) uris.push(it.groupPreview.pic);
      if (it?.postPreview?.media) uris.push(it.postPreview.media);
      if (it?.senderProfile?.avatarUrl) uris.push(it.senderProfile.avatarUrl);
    }
    Array.from(new Set(uris)).slice(0, 10).forEach(prefetchUri);
  } catch {}
};

const safeErr = (e) => ({
  name: e?.name || null,
  msg: e?.message || String(e),
});

/* ---------------- local cache (fast paint) ---------------- */
const cacheKeyFor = ({ chatId, peerUsername }) => `single_chat_cache_v1:${chatId || "none"}:${peerUsername || "none"}`;

async function getCachedSingleMessagesLocal({ chatId, peerUsername }) {
  const key = cacheKeyFor({ chatId, peerUsername });
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  // Trim to last 50 to prevent old 200-item caches from flooding memory on render
  return items.length > 50 ? items.slice(-50) : items;
}

async function setCachedSingleMessagesLocal({ chatId, peerUsername, items }) {
  const key = cacheKeyFor({ chatId, peerUsername });
  const payload = { items: Array.isArray(items) ? items : [], cachedAt: Date.now() };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

/* ---------------- supabase ops ---------------- */

const sendTextRow = async ({ chatId, text, senderUsername, sender_id }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);

  const payload = { sender_id, chat_id: chatId, is_group: false, sender_username: senderUsername || "me", content: text, sent_date, sent_time };
  console.log("[SingleChat][SEND] sendTextRow payload:", JSON.stringify(payload));

  const { data, error } = await supabase
    .from("messages")
    .insert([payload])
    .select("*")
    .single();

  console.log("[SingleChat][SEND] sendTextRow result — data:", data?.id, "error:", error?.message, "code:", error?.code, "details:", error?.details);
  if (error) throw error;
  return data;
};

const sendMediaRow = async ({ chatId, mediaUrl, caption = "", senderUsername, sender_id }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);
  const { data, error } = await supabase
    .from("messages")
    .insert([{
      sender_id,
      chat_id: chatId,
      is_group: false,
      sender_username: senderUsername || "me",
      content: caption,
      media_reference: mediaUrl,
      sent_date,
      sent_time,
    }])
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

const sendLocationRow = async ({ chatId, locationData, senderUsername, sender_id }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);
  const { data, error } = await supabase
    .from("messages")
    .insert([{
      sender_id,
      chat_id: chatId,
      is_group: false,
      sender_username: senderUsername || "me",
      content: `__location__:${JSON.stringify(locationData)}`,
      sent_date,
      sent_time,
    }])
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

const subscribeChatChanges = (chatId, onInsert, onDelete) => {
  if (!chatId) return () => {};
  console.log("[SingleChat][RT] subscribeChatChanges — channel:", `messages-${chatId}`);
  const channel = supabase
    .channel(`messages-${chatId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      (payload) => {
        console.log("[SingleChat][RT] messages INSERT received, chat_id:", payload.new?.chat_id, "sender:", payload.new?.sender_username);
        onInsert?.(payload.new);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      (payload) => {
        console.log("[SingleChat][RT] messages DELETE received — full payload:", JSON.stringify(payload));
        onDelete?.(payload.old?.id);
      }
    )
    .subscribe((status, err) => {
      console.log("[SingleChat][RT] messages subscribe status:", status, err ? err.message : "");
      if (err) console.warn("[SingleChat realtime] error:", err.message);
    });
  return () => supabase.removeChannel(channel);
};

/* ---------------- mapping ---------------- */
function mapRowToItem(row, myUserId = null) {
  if (!row?.id) return null;

  const base = {
    id: row.id,
    isMe: myUserId ? row.sender_id === myUserId : !!row.sender_is_me,
    senderUsername: row.sender_username || null,
    minuteKey: makeMinuteKey(row.sent_date, row.sent_time),
    time: (row.sent_time || "").slice(0, 5),
  };

  // invite
  if (row.group_id) {
    return { ...base, type: "invite", groupId: row.group_id, groupPreview: null };
  }

  // feed video share — thumbnail encoded in content as __feed_video__:{thumbnailUrl}
  if (row.post_id && !row.media_reference && String(row.content || "").startsWith("__feed_video__:")) {
    try {
      const meta = JSON.parse(String(row.content).slice("__feed_video__:".length));
      return { ...base, type: "feed_video", postId: row.post_id, thumbnailUrl: meta.thumbnailUrl || null };
    } catch {}
  }
  // regular post share (event cards, image posts, legacy shares with empty content)
  if (row.post_id && !row.media_reference && (!row.content || !String(row.content).trim())) {
    return { ...base, type: "post", postId: row.post_id, postPreview: null };
  }

  // location
  if (row.content && String(row.content).startsWith("__location__:")) {
    try {
      const loc = JSON.parse(String(row.content).slice("__location__:".length));
      return { ...base, type: "location", locationData: loc };
    } catch {}
  }

  // media
  if (row.media_reference) {
    return {
      ...base,
      type: "media",
      uris: [row.media_reference],
      caption: row.content || "",
    };
  }

  // text
  return { ...base, type: "text", text: row.content || "" };
}

/* ---------------- fetch messages (no cache lib dependency) ---------------- */
async function fetchSingleMessagesDirect(chatId, limit = 200, myUserId = null) {
  const { trackRequest } = require("../lib/requestTracker");
  const done = trackRequest(`SingleChat.fetchMessages chat=${chatId} limit=${limit}`);
  try {
    const { data, error } = await supabase
      .from("messages")
      .select(
        "id, chat_id, is_group, sender_id, sender_username, content, media_reference, post_id, group_id, sent_date, sent_time"
      )
      .eq("chat_id", chatId)
      .order("sent_date", { ascending: true })
      .order("sent_time", { ascending: true })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row) => mapRowToItem(row, myUserId)).filter(Boolean);
  } finally {
    done();
  }
}

/* Shows first frame of a local or remote video as a static thumbnail */
function PendingVideoThumb({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.bufferOptions = { preferredForwardBufferDuration: 3, minBufferForPlayback: 1, maxBufferBytes: 5 * 1024 * 1024 };
  });
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

/* ---------------- component ---------------- */
export default function SingleChatScreen({ navigation, route }) {
  const isGroup = !!route?.params?.isGroup;

  const rawPeer = route?.params?.username || route?.params?.chat || "@ulises";
  const peerUsername = asAt(rawPeer);
  const peerName = route?.params?.peerName || `@${peerUsername}`;
  const myUsername = route?.params?.myUsername || route?.params?.meUsername || "me";

  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();
  const insets = useSafeAreaInsets();

  const [chatId, setChatId] = useState(
    isGroup ? route?.params?.chatId || route?.params?.groupId || route?.params?.chat || null : null
  );
  const [myUserId, setMyUserId] = useState(null);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const [input, setInput] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);
  const [reportingMsg, setReportingMsg] = useState(null);
  const [reportText, setReportText] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSuccessOpen, setReportSuccessOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [items, setItems] = useState([]);
  const [booting, setBooting] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const listRef = useRef(null);
  const optimisticIds = useRef(new Set());
  const runRef = useRef(0);

  const [peerDisplayName, setPeerDisplayName] = useState(peerName);

  const [blockedUsers, setBlockedUsers] = useState([]);
  const [unblockModalVisible, setUnblockModalVisible] = useState(false);
  const isBlocked = !isGroup && blockedUsers.includes(peerUsername);

  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [locationSearchText, setLocationSearchText] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const locationSearchTimeout = useRef(null);
  const locationSessionToken = useRef(null);

  const getSessionUid = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id || null;
        return uid;
  }, []);

  const loadBlockedUsers = useCallback(async (uid) => {
    try {
      if (!uid) return [];
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("blocked_users")
        .eq("id", uid)
        .maybeSingle();
      if (profErr) {
        console.log("[SingleChat][BLOCKED] profiles error", profErr.message);
        return [];
      }
      const arr = Array.isArray(prof?.blocked_users) ? prof.blocked_users : [];
      setBlockedUsers(arr);
      return arr;
    } catch (e) {
      console.log("[SingleChat][BLOCKED] exception", safeErr(e));
      return [];
    }
  }, []);

  const handleDeleted = (deletedId) => {
    setItems((prev) => prev.filter((m) => String(m.id) !== String(deletedId)));

    // Always update ALL chat_threads rows for this chat so every participant's
    // realtime subscription fires and they reconcile the deleted message.
    if (chatId) {
      (async () => {
        try {
          const { data: last } = await supabase
            .from("messages")
            .select("content, media_reference, post_id, sent_date, sent_time, sender_username")
            .eq("chat_id", chatId)
            .eq("is_group", false)
            .order("sent_date", { ascending: false })
            .order("sent_time", { ascending: false })
            .limit(1)
            .maybeSingle();
          const myUid = await getSessionUid();
          await supabase
            .from("chat_threads")
            .update(
              last
                ? {
                    last_content: last.content || null,
                    last_media_reference: last.media_reference || null,
                    last_post_id: last.post_id || null,
                    last_sender_username: last.sender_username || null,
                    last_sent_at: `${last.sent_date}T${last.sent_time}`,
                  }
                : {
                    last_content: null,
                    last_media_reference: null,
                    last_post_id: null,
                    last_sender_username: null,
                    last_sent_at: null,
                  }
            )
            .eq("chat_id", chatId);
          // Fix last_sender_is_me per-row (can't do it in a single update since it differs per user)
          if (last && myUid) {
            await supabase.from("chat_threads")
              .update({ last_sender_is_me: last.sender_username === myUsername })
              .eq("chat_id", chatId).eq("owner_id", myUid);
          }
        } catch (e) {
          console.warn("[SingleChat] thread repair failed", e?.message);
        }
      })();
    }
  };

  // Resolve DM chatId via get_or_create_dm_chat RPC
  // Returns the existing UUID for this DM pair, or creates one if this is the first message ever.
  useEffect(() => {
    if (isGroup) return;
    if (!peerUsername) return;
    let alive = true;

    console.log("[SingleChat][RESOLVE] start", { peerUsername });

    (async () => {
      try {
        const { data: chatIdResult, error } = await supabase.rpc("get_or_create_dm_chat", {
          p_peer_username: peerUsername,
        });

        if (!alive) return;

        if (error || !chatIdResult) {
          console.log("[SingleChat][RESOLVE] fail", { err: error?.message || null });
          Alert.alert("Chat unavailable", "User not found.");
          navigation.goBack();
          return;
        }

        console.log("[SingleChat][RESOLVE] ok", { peerUsername, chatId: chatIdResult });
        setChatId(chatIdResult);
      } catch (e) {
        if (!alive) return;
        console.log("[SingleChat][RESOLVE] exception", safeErr(e));
        Alert.alert("Chat unavailable", "Could not open this conversation.");
        navigation.goBack();
      }
    })();

    return () => {
      alive = false;
    };
  }, [isGroup, peerUsername, navigation]);

  // BOOT: cache -> refresh
  useEffect(() => {
    let mounted = true;
    const runId = ++runRef.current;

    (async () => {
      if (mounted) setLoadingMsgs(true);

      // 1) cache paint
      try {
                const cached = await getCachedSingleMessagesLocal({ chatId, peerUsername });

        if (mounted && Array.isArray(cached) && cached.length) {
          setItems(cached);
          prefetchForItems(cached);
          setBooting(false);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 150);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 700);
        }
      } catch (e) {
        console.log("", { runId, ...safeErr(e) });
      }

      // 2) auth
      const uid = await getSessionUid();
      if (!uid) {
        console.log("", { runId });
        if (mounted) {
          setBooting(false);
          setLoadingMsgs(false);
        }
        Alert.alert("Login required", "Please sign in to view messages.");
        return;
      }
      if (mounted) setMyUserId(uid);

      // 3) blocked users
      const blockedNow = await loadBlockedUsers(uid);
      if (!mounted) return;

      if (!isGroup && blockedNow.includes(peerUsername)) {
        setBooting(false);
        if (mounted) setLoadingMsgs(false);
        return;
      }

      // 4) fetch messages direct
      try {
        const fresh = await fetchSingleMessagesDirect(chatId, 50, uid);

        if (!mounted) return;

        setItems(fresh);
        prefetchForItems(fresh);
        setBooting(false);

        setCachedSingleMessagesLocal({ chatId, peerUsername, items: fresh }).catch(() => {});
        setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 150);
        setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 700);
      } catch (e) {
                if (mounted) setBooting(false);
      }

      if (mounted) setLoadingMsgs(false);
    })();

    return () => {
      mounted = false;
    };
  }, [isGroup, chatId, peerUsername, getSessionUid, loadBlockedUsers]);

  // Realtime inserts — with new schema all messages share one chat_id, single subscription.
  useEffect(() => {
    if (!chatId) return () => {};

    const handleRow = (row) => {
      const fp = `${row.sent_date || ""}T${row.sent_time || ""}-${row.media_reference || row.post_id || row.content || ""}-ins`;
      if (optimisticIds.current.has(fp)) {
        optimisticIds.current.delete(fp);
        return;
      }

      const mapped = mapRowToItem(row, myUserId);
      if (!mapped) return;

      setItems((prev) => {
        if (prev.some((m) => String(m.id) === String(mapped.id))) return prev;
        const next = [...prev, mapped];
        setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
        return next;
      });

      prefetchForItems([mapped]);
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);
    };

    const handleRemoteDelete = (deletedId) => {
      if (!deletedId) return;
      setItems((prev) => prev.filter((m) => String(m.id) !== String(deletedId)));
    };

    const un = subscribeChatChanges(chatId, handleRow, handleRemoteDelete);
    return un;
  }, [chatId, myUserId, peerUsername]);

  // chat_threads supplement — same mechanism as ChatListScreen; catches new messages
  // on both iOS and Android even when the messages-table subscription misses them.
  useEffect(() => {
    if (!chatId || !myUserId) return () => {};
    console.log("[SingleChat][RT] chat_threads supplement setup — chatId:", chatId, "myUserId:", myUserId);

    const channel = supabase
      .channel(`chat-threads-dm-${chatId}-${myUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_threads" },
        async (payload) => {
          const row = payload.new;
          console.log("[SingleChat][RT] chat_threads event received — event:", payload.eventType, "owner_id:", row?.owner_id, "chat_id:", row?.chat_id, "myUserId:", myUserId, "chatId:", chatId);
          if (!row || row.owner_id !== myUserId || row.chat_id !== chatId) {
            console.log("[SingleChat][RT] chat_threads filtered out");
            return;
          }
          console.log("[SingleChat][RT] chat_threads match — fetching fresh messages");
          const fresh = await fetchSingleMessagesDirect(chatId, 50, myUserId);
          console.log("[SingleChat][RT] chat_threads fetch returned", fresh?.length, "items");
          setItems((prev) => {
            const freshIds = new Set(fresh.map((m) => String(m.id)));
            const existingIds = new Set(prev.map((m) => String(m.id)));
            const newItems = fresh.filter((m) => !existingIds.has(String(m.id)));
            const removedCount = prev.filter((m) => !freshIds.has(String(m.id))).length;
            if (newItems.length === 0 && removedCount === 0) {
              console.log("[SingleChat][RT] chat_threads — no changes");
              return prev;
            }
            console.log("[SingleChat][RT] chat_threads — adding", newItems.length, "new, removing", removedCount);
            const reconciled = [...prev.filter((m) => freshIds.has(String(m.id))), ...newItems].sort((a, b) =>
              (a.minuteKey || "") < (b.minuteKey || "") ? -1 : 1
            );
            setCachedSingleMessagesLocal({ chatId, peerUsername, items: reconciled }).catch(() => {});
            return reconciled;
          });
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 100);
        }
      )
      .subscribe((status, err) => {
        console.log("[SingleChat][RT] chat_threads subscribe status:", status, err ? err.message : "");
      });

    return () => supabase.removeChannel(channel);
  }, [chatId, myUserId, peerUsername, myUsername]);

  // focus: mark read + refresh blocked + refresh peer display name + refetch messages
  useFocusEffect(
    useCallback(() => {
      console.log("[SingleChat][FOCUS] focus", { chatId, peerUsername });

      (async () => {
        const uid = await getSessionUid();
        if (!uid) return;

        if (chatId) setLastVisited(chatId);

        try {
          await loadBlockedUsers(uid);
        } catch (e) {
          console.log("[SingleChat][FOCUS] blocked error", safeErr(e));
        }

        // Refresh peer display name so header reflects any name/username changes
        if (!isGroup && peerUsername) {
          try {
            const { data: peerProfile } = await supabase
              .from("profiles")
              .select("name, username")
              .eq("username", peerUsername)
              .maybeSingle();
            if (peerProfile) {
              const fresh = peerProfile.name || `@${peerProfile.username}` || peerName;
              setPeerDisplayName(fresh);
            }
          } catch {}
        }

        // Refetch messages so deleted/new messages are always current on focus
        if (chatId && uid) {
          try {
            const fresh = await fetchSingleMessagesDirect(chatId, 50, uid);
            setItems(fresh);
            setCachedSingleMessagesLocal({ chatId, peerUsername, items: fresh }).catch(() => {});
          } catch (e) {
            console.log("[SingleChat][FOCUS] refetch error", safeErr(e));
          }
        }
      })();

      return undefined;
    }, [chatId, peerUsername, getSessionUid, loadBlockedUsers, isGroup, peerName, myUsername])
  );

  const persistBlockedUsers = async (next) => {
    setBlockedUsers(next);
    try {
      const uid = await getSessionUid();
      if (!uid) return;
      await supabase.from("profiles").update({ blocked_users: next }).eq("id", uid);
    } catch {}
  };

  const confirmUnblock = async () => {
    const next = blockedUsers.filter((u) => u !== peerUsername);
    await persistBlockedUsers(next);
    setUnblockModalVisible(false);

    if (!chatId) return;

    setLoadingMsgs(true);
    try {
      const fresh = await fetchSingleMessagesDirect(chatId, 200, myUserId);
      setItems(fresh);
      prefetchForItems(fresh);
      await setCachedSingleMessagesLocal({ chatId, peerUsername, items: fresh });
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 150);
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 700);
    } catch (e) {
      console.log("[SingleChat][UNBLOCK] refresh error", safeErr(e));
    }
    setLoadingMsgs(false);
  };

  const onSend = useCallback(async () => {
    if (!chatId) return;
    if (isBlocked) { setUnblockModalVisible(true); return; }

    // ── media send ──────────────────────────────────────────────────────────
    if (pendingImage) {
      const uri = pendingImage.uri;
      const caption = input.trim();
      setPendingImage(null);
      setInput("");
      setSendingMedia(true);

      const now = new Date();
      const optimisticId = `opt-media-${now.getTime()}`;
      const optimistic = {
        id: optimisticId,
        type: "media",
        isMe: true,
        senderUsername: myUsername,
        uris: [uri],
        caption,
        minuteKey: makeMinuteKey(now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5)),
        time: now.toTimeString().slice(0, 5),
      };

      setItems((prev) => {
        const next = [...prev, optimistic];
        setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
        return next;
      });
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);

      try {
        const sender_id = await getSessionUid();
        if (!sender_id) throw new Error("Not authenticated");
        const mediaUrl = await uploadChatMedia({ uri, chatId });
        const row = await sendMediaRow({ chatId, mediaUrl, caption, senderUsername: myUsername, sender_id });

        const fp = `${row.sent_date}T${row.sent_time}-${row.media_reference}-ins`;
        if (optimisticIds.current.size > 500) optimisticIds.current.clear();
        optimisticIds.current.add(fp);

        const realItem = {
          id: row.id,
          type: "media",
          isMe: true,
          senderUsername: row.sender_username || myUsername,
          uris: [row.media_reference],
          caption: row.content || "",
          minuteKey: makeMinuteKey(row.sent_date, row.sent_time),
          time: (row.sent_time || "").slice(0, 5),
        };
        setItems((prev) => {
          const next = prev.map((m) => (m.id === optimisticId ? realItem : m));
          setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
          return next;
        });
      } catch (e) {
        setItems((p) => p.filter((m) => m.id !== optimisticId));
        Alert.alert("Image not sent", e?.message || "Please try again.");
      } finally {
        setSendingMedia(false);
      }
      return;
    }

    // ── text send ────────────────────────────────────────────────────────────
    const text = input.trim();
    if (!text) return;

    const now = new Date();
    const optimistic = {
      id: `opt-${now.getTime()}`,
      type: "text",
      isMe: true,
      senderUsername: myUsername,
      text,
      minuteKey: makeMinuteKey(now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5)),
    };

    setItems((prev) => {
      const next = [...prev, optimistic];
      setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
      return next;
    });

    setInput("");
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);

    const fp = `${now.toISOString().slice(0, 10)}T${now.toTimeString().slice(0, 8)}-${text}-ins`;
    if (optimisticIds.current.size > 500) optimisticIds.current.clear();
    optimisticIds.current.add(fp);

    try {
      const sender_id = await getSessionUid();
      console.log("[SingleChat][SEND] text — chatId:", chatId, "sender_id:", sender_id, "myUsername:", myUsername);
      if (!sender_id) throw new Error("Not authenticated");
      await sendTextRow({ chatId, text, senderUsername: myUsername, sender_id });
    } catch (e) {
      console.error("[SingleChat][SEND] text FAILED:", e?.message, e?.code, e?.details, e?.hint);
      setItems((p) => p.map((m) => m.id === optimistic.id ? { ...m, failed: true } : m));
    }
  }, [chatId, input, pendingImage, myUsername, isBlocked, getSessionUid, peerUsername]);

  const onSendLocation = useCallback(async (locationData) => {
    if (!chatId) return;
    setLocationModalVisible(false);
    setLocationSearchText("");
    setLocationSuggestions([]);
    const now = new Date();
    const optimisticId = `opt-loc-${now.getTime()}`;
    const optimistic = {
      id: optimisticId,
      type: "location",
      isMe: true,
      senderUsername: myUsername,
      locationData,
      minuteKey: makeMinuteKey(now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5)),
      time: now.toTimeString().slice(0, 5),
    };
    setItems((prev) => {
      const next = [...prev, optimistic];
      setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
      return next;
    });
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);
    try {
      const sender_id = await getSessionUid();
      if (!sender_id) throw new Error("Not authenticated");
      const row = await sendLocationRow({ chatId, locationData, senderUsername: myUsername, sender_id });
      const realItem = {
        id: row.id,
        type: "location",
        isMe: true,
        senderUsername: row.sender_username || myUsername,
        locationData,
        minuteKey: makeMinuteKey(row.sent_date, row.sent_time),
        time: (row.sent_time || "").slice(0, 5),
      };
      setItems((prev) => {
        const next = prev.map((m) => (m.id === optimisticId ? realItem : m));
        setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
        return next;
      });
    } catch {
      setItems((p) => p.map((m) => m.id === optimisticId ? { ...m, failed: true } : m));
    }
  }, [chatId, myUsername, peerUsername, getSessionUid]);

  const onSendCurrentLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Alba needs location access to share your location.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = loc.coords;
      let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      try {
        const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? Constants.expoConfig?.extra?.expoPublic?.MAPBOX_PUBLIC_TOKEN ?? "";
        if (token) {
          const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&limit=1&access_token=${token}`;
          const res = await fetch(url);
          const json = await res.json();
          const feat = json.features?.[0];
          if (feat) address = feat.properties?.place_formatted ?? feat.properties?.name ?? address;
        }
      } catch {}
      onSendLocation({ lat, lng, address });
    } catch {
      Alert.alert("Error", "Could not get your current location.");
    }
  }, [onSendLocation]);

  const onLocationSearch = useCallback((text) => {
    setLocationSearchText(text);
    clearTimeout(locationSearchTimeout.current);
    if (!text.trim()) { setLocationSuggestions([]); return; }
    locationSearchTimeout.current = setTimeout(async () => {
      try {
        setLocationSearching(true);
        const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? Constants.expoConfig?.extra?.expoPublic?.MAPBOX_PUBLIC_TOKEN ?? "";
        if (!token) return;
        if (!locationSessionToken.current) {
          locationSessionToken.current = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
        }
        const q = encodeURIComponent(text.trim());
        let proximityParam = "";
        try {
          const pos = await Location.getLastKnownPositionAsync({});
          if (pos) proximityParam = `&proximity=${pos.coords.longitude},${pos.coords.latitude}`;
        } catch {}
        const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${q}&session_token=${locationSessionToken.current}&types=poi,street,address,place,locality,neighborhood&limit=8${proximityParam}&access_token=${token}`;
        const res = await fetch(url);
        const json = await res.json();
        setLocationSuggestions(
          (json.suggestions || []).map((s) => ({
            mapbox_id: s.mapbox_id,
            name: s.name ?? "",
            subtitle: s.place_formatted ?? "",
          }))
        );
      } catch {
        setLocationSuggestions([]);
      } finally {
        setLocationSearching(false);
      }
    }, 400);
  }, []);

  const onSelectSuggestion = useCallback(async (suggestion) => {
    try {
      const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? Constants.expoConfig?.extra?.expoPublic?.MAPBOX_PUBLIC_TOKEN ?? "";
      const sessionToken = locationSessionToken.current;
      locationSessionToken.current = null;
      const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}?session_token=${sessionToken}&access_token=${token}`);
      const json = await res.json();
      const feat = json.features?.[0];
      if (!feat) return;
      const [lng, lat] = feat.geometry.coordinates;
      const address = feat.properties.full_address ?? feat.properties.place_formatted ?? feat.properties.name ?? suggestion.name;
      onSendLocation({ lat, lng, address });
    } catch {
      onSendLocation({ lat: 0, lng: 0, address: suggestion.name + (suggestion.subtitle ? `, ${suggestion.subtitle}` : "") });
    }
  }, [onSendLocation]);

  const onPickGallery = useCallback(async () => {
    if (isBlocked) { setUnblockModalVisible(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Alba needs access to your photos."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.85 });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setPendingImage({ uri: asset.uri, type: "image" });
  }, [isBlocked]);

  const onPickVideo = useCallback(async () => {
    if (isBlocked) { setUnblockModalVisible(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Alba needs access to your photos."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setPendingImage({ uri: asset.uri, type: "video" });
  }, [isBlocked]);

  const onPickCamera = useCallback(async () => {
    if (isBlocked) { setUnblockModalVisible(true); return; }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Alba needs camera access."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 15 });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    const ext = asset.uri.split("?")[0].split(".").pop()?.toLowerCase() || "";
    const isVid = asset.type === "video" || ["mp4","mov","m4v","webm","avi"].includes(ext);
    setPendingImage({ uri: asset.uri, type: isVid ? "video" : "image" });
  }, [isBlocked]);

  const retrySend = useCallback(async (failedItem) => {
    setItems((p) => p.map((m) => m.id === failedItem.id ? { ...m, failed: false } : m));
    try {
      const sender_id = await getSessionUid();
      if (!sender_id) throw new Error("Not authenticated");
      if (failedItem.type === "text") {
        await sendTextRow({ chatId, text: failedItem.text, senderUsername: myUsername, sender_id });
      } else if (failedItem.type === "location") {
        await sendLocationRow({ chatId, locationData: failedItem.locationData, senderUsername: myUsername, sender_id });
      }
      setItems((p) => p.filter((m) => m.id !== failedItem.id));
    } catch {
      setItems((p) => p.map((m) => m.id === failedItem.id ? { ...m, failed: true } : m));
    }
  }, [chatId, myUsername, getSessionUid]);

  const renderItem = ({ item, index }) => {
    const prev = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;
    const isNewMinuteBlock = !prev || prev.minuteKey !== item.minuteKey;
    const senderChanged = !prev || prev.isMe !== item.isMe;
    const needsTopMargin = isNewMinuteBlock || senderChanged;
    const displayTime = item.time;

    let body = null;
    switch (item.type) {
      case "text":
        body = <TextMessage {...item} time={displayTime} onDeleted={handleDeleted} onRetry={item.failed ? () => retrySend(item) : undefined} />;
        break;
      case "media":
        body = <MediaMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "feed_video":
        body = <FeedVideoMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "post":
        body = <PostMessage {...item} time={displayTime} postPreview={item.postPreview || null} onDeleted={handleDeleted} />;
        break;
      case "invite":
        body = <InviteMessage {...item} time={displayTime} groupPreview={item.groupPreview || null} onDeleted={handleDeleted} />;
        break;
      case "location":
        body = <LocationMessage {...item} time={displayTime} onDeleted={handleDeleted} onRetry={item.failed ? () => retrySend(item) : undefined} />;
        break;
      default:
        return null;
    }

    return (
      <Pressable onLongPress={() => setReportingMsg(item)} style={{ marginTop: needsTopMargin ? 10 : 0 }}>
        {body}
      </Pressable>
    );
  };

  if (!fontsLoaded) return null;

  const iconColor = isDark ? "#C5CEDA" : "#6E7A86";

  const blockedView = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
      <Text style={[styles.blockedText, { color: theme.text }]}>{t("chat_single_blocked_body")}</Text>
      <TouchableOpacity
        style={[
          styles.unblockBtn,
          {
            borderColor: isDark ? "#444" : theme.gray,
            backgroundColor: isDark ? "#2B2B2B" : "#F4F6F9",
          },
        ]}
        onPress={() => setUnblockModalVisible(true)}
      >
        <Text style={[styles.unblockBtnText, { color: theme.text }]}>{t("chat_single_unblock_cta")}</Text>
      </TouchableOpacity>
    </View>
  );

  const bootView = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.gray }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.select({ ios: 0, android: 0 })}
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.gray }]} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>

          <View style={{ flex: 1, alignItems: "center" }}>
            <TouchableOpacity onPress={() => navigation.navigate("Profile", { username: peerUsername })} hitSlop={8}>
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                {peerDisplayName}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ width: 26 }} />
        </View>

        {isBlocked ? (
          blockedView
        ) : (
          <>
            {booting && items.length === 0 ? (
              bootView
            ) : (
              <>
                <FlatList
                  ref={listRef}
                  data={items}
                  keyExtractor={(m) => String(m.id)}
                  renderItem={renderItem}
                  style={{ flex: 1 }}
                  contentContainerStyle={{
                    padding: 16,
                    paddingTop: 24,
                    paddingBottom: 8,
                    backgroundColor: theme.gray,
                  }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={15}
                  maxToRenderPerBatch={8}
                  windowSize={5}
                  removeClippedSubviews
                />

                <View
                  style={[
                    styles.composer,
                    {
                      backgroundColor: theme.gray,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: isDark ? "#2D3748" : "#E0E4EA",
                      paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
                    },
                  ]}
                >
                  <View style={styles.composerLeft}>
                    <TouchableOpacity onPress={() => setLocationModalVisible(true)} style={styles.iconBtn} hitSlop={8}>
                      <Ionicons name="location-outline" size={22} color={iconColor} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onPickGallery} style={styles.iconBtn} hitSlop={8}>
                      <Ionicons name="image-outline" size={22} color={iconColor} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onPickVideo} style={styles.iconBtn} hitSlop={8}>
                      <Ionicons name="videocam-outline" size={22} color={iconColor} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onPickCamera} style={styles.iconBtn} hitSlop={8}>
                      <Ionicons name="camera-outline" size={22} color={iconColor} />
                    </TouchableOpacity>
                  </View>

                  {pendingImage ? (
                    <View style={styles.pendingWrap}>
                      {pendingImage.type === "video" ? (
                        <PendingVideoThumb uri={pendingImage.uri} style={styles.pendingThumb} />
                      ) : (
                        <Image
                          source={{ uri: pendingImage.uri }}
                          style={styles.pendingThumb}
                          resizeMode="cover"
                        />
                      )}
                      <TouchableOpacity
                        style={styles.pendingRemove}
                        onPress={() => setPendingImage(null)}
                        hitSlop={8}
                      >
                        <Feather name="x" size={14} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.inputWrap}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            color: theme.text,
                            backgroundColor: theme.gray,
                            borderColor: theme.border,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderRadius: 999,
                          },
                        ]}
                        placeholder="Aa"
                        placeholderTextColor={isDark ? "#9097A3" : "#B8B8B8"}
                        multiline
                        value={input}
                        onChangeText={setInput}
                        onSubmitEditing={onSend}
                      />
                    </View>
                  )}

                  <TouchableOpacity onPress={onSend} disabled={sendingMedia} hitSlop={8}>
                    {sendingMedia ? (
                      <ActivityIndicator size="small" color="#0BC6D8" />
                    ) : (
                      <Feather name="send" size={18} color="#0BC6D8" />
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}

        {/* Location picker modal */}
        <Modal
          visible={locationModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); locationSessionToken.current = null; }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
              activeOpacity={1}
              onPress={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); locationSessionToken.current = null; }}
            />
          <View style={[styles.locationSheet, { backgroundColor: isDark ? "#1A2330" : "#FFFFFF" }]}>
            <Text style={[styles.locationSheetTitle, { color: theme.text }]}>Share Location</Text>

            <TouchableOpacity
              style={[styles.locationOptionBtn, { borderColor: isDark ? "#333" : "#E0E6EF" }]}
              onPress={onSendCurrentLocation}
            >
              <Ionicons name="locate" size={20} color="#4EBCFF" style={{ marginRight: 10 }} />
              <Text style={[styles.locationOptionText, { color: theme.text }]}>Send current location</Text>
            </TouchableOpacity>

            <Text style={[styles.locationOrLabel, { color: isDark ? "#9CA3AF" : "#888" }]}>or search for a place</Text>

            <View style={[styles.locationSearchWrap, { backgroundColor: isDark ? "#2B2B2B" : "#F4F6F9", borderColor: isDark ? "#444" : "#D9E0EA" }]}>
              <Ionicons name="search" size={16} color={isDark ? "#9CA3AF" : "#888"} style={{ marginRight: 6 }} />
              <TextInput
                style={[styles.locationSearchInput, { color: theme.text }]}
                placeholder="Via Valtellina 5 or Alcatraz…"
                placeholderTextColor={isDark ? "#666" : "#AAA"}
                value={locationSearchText}
                onChangeText={onLocationSearch}
                autoCorrect={false}
              />
              {locationSearching && <ActivityIndicator size="small" color="#4EBCFF" />}
            </View>

            {locationSuggestions.length > 0 && (
              <View style={[styles.suggestionsBox, { backgroundColor: isDark ? "#1E2933" : "#FAFCFF", borderColor: isDark ? "#333" : "#D9E0EA" }]}>
                {locationSuggestions.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.suggestionRow, i < locationSuggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? "#333" : "#E5E9F0" }]}
                    onPress={() => onSelectSuggestion(s)}
                  >
                    <Ionicons name="location-outline" size={14} color="#4EBCFF" style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestionText, { color: theme.text }]} numberOfLines={1}>{s.name}</Text>
                      {!!s.subtitle && <Text style={[styles.suggestionText, { color: isDark ? "#9CA3AF" : "#888", fontSize: 12 }]} numberOfLines={1}>{s.subtitle}</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.locationCancelBtn}
              onPress={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); locationSessionToken.current = null; }}
            >
              <Text style={[styles.locationCancelText, { color: isDark ? "#9CA3AF" : "#888" }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={unblockModalVisible} transparent animationType="fade" onRequestClose={() => setUnblockModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.unblockModalContent, { backgroundColor: isDark ? "#1E2933" : "#FFFFFF" }]}>
              <Text style={[styles.unblockTitle, { color: theme.text }]}>{t("chat_single_unblock_confirm_title")}</Text>
              <View style={styles.unblockButtonsRow}>
                <TouchableOpacity
                  style={[styles.unblockBtnSmall, styles.unblockNoBtn]}
                  onPress={() => setUnblockModalVisible(false)}
                >
                  <Text style={[styles.unblockBtnSmallText, { color: theme.text }]}>{t("chat_single_unblock_confirm_no")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.unblockBtnSmall, styles.unblockYesBtn]} onPress={confirmUnblock}>
                  <Text style={[styles.unblockBtnSmallText, { color: "#fff" }]}>{t("chat_single_unblock_confirm_yes")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>

      {/* Message report modal */}
      <Modal visible={!!reportingMsg} transparent animationType="fade" onRequestClose={() => setReportingMsg(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 }}>
          <View style={{ width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" }}>
            <Text style={{ fontFamily: "PoppinsBold", fontSize: 16, marginBottom: 10, textAlign: "center" }}>Report message</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, minHeight: 80, paddingHorizontal: 10, paddingVertical: 8, fontFamily: "Poppins", fontSize: 14, textAlignVertical: "top", marginBottom: 12 }}
              placeholder="Tell us briefly what is wrong"
              placeholderTextColor="#9CA3AF"
              value={reportText}
              onChangeText={setReportText}
              multiline
              maxLength={300}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: "#b0b6c0" }}
                onPress={() => { setReportingMsg(null); setReportText(""); }}
              >
                <Text style={{ color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: "#3D8BFF", opacity: reportText.trim() && !reportSending ? 1 : 0.6 }}
                disabled={!reportText.trim() || reportSending}
                onPress={async () => {
                  const msg = reportingMsg;
                  setReportSending(true);
                  try {
                    const { data: authData } = await supabase.auth.getUser();
                    const reporterId = authData?.user?.id || null;
                    await supabase.functions.invoke("send-report", {
                      body: {
                        type: "dm_message",
                        reported_by_id: reporterId,
                        reason: reportText.trim(),
                        context: {
                          message_content: msg?.content || "",
                          message_sent_at: msg?.time || "",
                          receiver_username: peerUsername,
                        },
                      },
                    }).catch(() => {});
                  } catch {}
                  setReportSending(false);
                  setReportingMsg(null);
                  setReportText("");
                  setReportSuccessOpen(true);
                }}
              >
                {reportSending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 }}>OK</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report success modal */}
      <Modal visible={reportSuccessOpen} transparent animationType="fade" onRequestClose={() => setReportSuccessOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 }}>
          <View style={{ width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" }}>
            <Text style={{ fontFamily: "PoppinsBold", fontSize: 16, marginBottom: 6, textAlign: "center" }}>Thanks for your report.</Text>
            <Text style={{ fontFamily: "Poppins", fontSize: 13, color: "#6B7280", marginBottom: 16, textAlign: "center" }}>We'll review it and take action if it goes against our guidelines.</Text>
            <TouchableOpacity
              style={{ paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: "#3D8BFF" }}
              onPress={() => setReportSuccessOpen(false)}
            >
              <Text style={{ color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: "#E5E7EB",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
  },
  headerTitle: {
    textAlign: "center",
    fontSize: 16,
    color: "#111",
    fontFamily: "PoppinsBold",
  },
  loadingBar: {
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  composerLeft: { flexDirection: "row", gap: 10 },
  iconBtn: { padding: 6, borderRadius: 12 },
  inputWrap: { flex: 1, borderRadius: 14 },
  pendingWrap: {
    flex: 1,
    height: 72,
    borderRadius: 14,
  },
  pendingThumb: {
    flex: 1,
    borderRadius: 14,
  },
  pendingRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 10,
    padding: 3,
    zIndex: 1,
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: "Poppins",
  },
  blockedText: {
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Poppins",
    marginBottom: 14,
  },
  unblockBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  unblockBtnText: {
    fontSize: 14,
    fontFamily: "PoppinsBold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  unblockModalContent: {
    width: "80%",
    borderRadius: 18,
    padding: 18,
    elevation: 4,
  },
  unblockTitle: {
    fontSize: 15,
    fontFamily: "PoppinsBold",
    marginBottom: 14,
  },
  unblockButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  unblockBtnSmall: {
    minWidth: 70,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  unblockNoBtn: {
    borderWidth: 0.5,
    borderColor: "#6F7D95",
  },
  unblockYesBtn: {
    backgroundColor: "#12A7E0",
  },
  unblockBtnSmallText: {
    fontSize: 14,
    fontFamily: "Poppins",
  },

  // Location modal
  locationSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  locationSheetTitle: {
    fontSize: 17,
    fontFamily: "PoppinsBold",
    marginBottom: 16,
    textAlign: "center",
  },
  locationOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  locationOptionText: { fontFamily: "PoppinsBold", fontSize: 14 },
  locationOrLabel: { fontSize: 12, fontFamily: "Poppins", marginBottom: 8 },
  locationSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  locationSearchInput: { flex: 1, fontFamily: "Poppins", fontSize: 13 },
  suggestionsBox: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestionText: { fontFamily: "Poppins", fontSize: 13 },
  locationCancelBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  locationCancelText: { fontFamily: "Poppins", fontSize: 14 },
});
