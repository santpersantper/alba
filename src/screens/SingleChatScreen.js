// screens/SingleChatScreen.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { Image as ExpoImage } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
    Array.from(new Set(uris)).forEach(prefetchUri);
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
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

async function setCachedSingleMessagesLocal({ chatId, peerUsername, items }) {
  const key = cacheKeyFor({ chatId, peerUsername });
  const payload = { items: Array.isArray(items) ? items : [], cachedAt: Date.now() };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

/* ---------------- supabase ops ---------------- */
const markChatRead = async (chatId) => {
  if (!chatId) return;
  const { error } = await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("chat", chatId)
    .eq("sender_is_me", false)
    .eq("is_read", false);
  if (error) throw error;
};

const sendTextRow = async ({ chatId, text, senderUsername, owner_id }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);

  const { data, error } = await supabase
    .from("messages")
    .insert([
      {
        owner_id,
        chat: chatId,
        is_group: false,
        sender_username: senderUsername || "me",
        sender_is_me: true,
        content: text,
        is_read: true,
        sent_date,
        sent_time,
      },
    ])
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

const sendMediaRow = async ({ chatId, mediaUrl, caption = "", senderUsername, owner_id }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);
  const { data, error } = await supabase
    .from("messages")
    .insert([{
      owner_id,
      chat: chatId,
      is_group: false,
      sender_username: senderUsername || "me",
      sender_is_me: true,
      content: caption,
      media_reference: mediaUrl,
      is_read: true,
      sent_date,
      sent_time,
    }])
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

const sendLocationRow = async ({ chatId, locationData, senderUsername, owner_id }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);
  const { data, error } = await supabase
    .from("messages")
    .insert([{
      owner_id,
      chat: chatId,
      is_group: false,
      sender_username: senderUsername || "me",
      sender_is_me: true,
      content: `__location__:${JSON.stringify(locationData)}`,
      is_read: true,
      sent_date,
      sent_time,
    }])
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

const subscribeChatInserts = (chatId, onInsert) => {
  if (!chatId) return () => {};
  const channel = supabase
    .channel(`messages-${chatId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `chat=eq.${chatId}` },
      (payload) => onInsert?.(payload.new)
    )
    .subscribe((status, err) => {
      if (err) console.warn("[SingleChat realtime] error:", err.message);
    });
  return () => supabase.removeChannel(channel);
};

/* ---------------- mapping ---------------- */
function mapRowToItem(row) {
  if (!row?.id) return null;

  const base = {
    id: row.id,
    isMe: !!row.sender_is_me,
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
async function fetchSingleMessagesDirect(chatId, limit = 200) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, chat, is_group, sender_username, sender_is_me, content, media_reference, post_id, group_id, sent_date, sent_time, is_read"
    )
    .eq("chat", chatId)
    .eq("is_group", false)
    .order("sent_date", { ascending: true })
    .order("sent_time", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const items = (data || []).map(mapRowToItem).filter(Boolean);
  return items;
}

/* Shows first frame of a local or remote video as a static thumbnail */
function PendingVideoThumb({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => { p.muted = true; });
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

  const [chatId, setChatId] = useState(
    isGroup ? route?.params?.chatId || route?.params?.groupId || route?.params?.chat || null : null
  );

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const [input, setInput] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);
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
    const wasLast =
      items.length > 0 && String(items[items.length - 1].id) === String(deletedId);
    setItems((prev) => prev.filter((m) => String(m.id) !== String(deletedId)));

    // If the deleted message was the snippet shown in ChatList, repair chat_threads
    if (wasLast && chatId) {
      (async () => {
        try {
          const uid = await getSessionUid();
          if (!uid) return;
          const { data: last } = await supabase
            .from("messages")
            .select("content, media_reference, post_id, sent_date, sent_time, sender_is_me, sender_username")
            .eq("chat", chatId)
            .eq("is_group", false)
            .order("sent_date", { ascending: false })
            .order("sent_time", { ascending: false })
            .limit(1)
            .maybeSingle();
          await supabase
            .from("chat_threads")
            .update(
              last
                ? {
                    last_content: last.content || null,
                    last_media_reference: last.media_reference || null,
                    last_post_id: last.post_id || null,
                    last_sender_is_me: !!last.sender_is_me,
                    last_sender_username: last.sender_username || null,
                    last_sent_at: `${last.sent_date}T${last.sent_time}`,
                  }
                : {
                    last_content: null,
                    last_media_reference: null,
                    last_post_id: null,
                    last_sender_is_me: null,
                    last_sender_username: null,
                    last_sent_at: null,
                  }
            )
            .eq("chat_id", chatId)
            .eq("owner_id", uid);
        } catch (e) {
          console.warn("[SingleChat] thread repair failed", e?.message);
        }
      })();
    }
  };

  // ✅ Resolve DM chatId = profiles.id (uuid)
  useEffect(() => {
    if (isGroup) return;
    if (!peerUsername) return;
    let alive = true;

    console.log("[SingleChat][RESOLVE] start", { peerUsername });

    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", peerUsername)
          .maybeSingle();

        if (!alive) return;

        if (error || !data?.id) {
          console.log("[SingleChat][RESOLVE] fail", { err: error?.message || null, hasId: !!data?.id });
          Alert.alert("Chat unavailable", "User not found.");
          navigation.goBack();
          return;
        }

        console.log("[SingleChat][RESOLVE] ok", { peerUsername, chatId: data.id });
        setChatId(data.id);
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
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 0);
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
                const fresh = await fetchSingleMessagesDirect(chatId, 200);
 
        if (!mounted) return;

        setItems(fresh);
        prefetchForItems(fresh);
        setBooting(false);

        setCachedSingleMessagesLocal({ chatId, peerUsername, items: fresh }).catch(() => {});
        setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 0);
      } catch (e) {
                if (mounted) setBooting(false);
      }

      if (mounted) setLoadingMsgs(false);
    })();

    return () => {
      mounted = false;
    };
  }, [isGroup, chatId, peerUsername, getSessionUid, loadBlockedUsers]);

  // realtime inserts
  useEffect(() => {
    if (!chatId) return () => {};
    const un = subscribeChatInserts(chatId, async (row) => {
      const fp = `${row.sent_date || ""}T${row.sent_time || ""}-${row.media_reference || row.post_id || row.content || ""}-ins`;
      if (optimisticIds.current.has(fp)) {
        optimisticIds.current.delete(fp);
        return;
      }

      const mapped = mapRowToItem(row);
      if (!mapped) return;

      setItems((prev) => {
        const next = [...prev, mapped];
        setCachedSingleMessagesLocal({ chatId, peerUsername, items: next }).catch(() => {});
        return next;
      });

      prefetchForItems([mapped]);
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);

      // background refresh to stay consistent
      fetchSingleMessagesDirect(chatId, 200)
        .then((fresh) => setCachedSingleMessagesLocal({ chatId, peerUsername, items: fresh }))
        .catch(() => {});
    });

    return un;
  }, [chatId, peerUsername]);

  // focus: mark read + refresh blocked + refresh peer display name
  useFocusEffect(
    useCallback(() => {
      console.log("[SingleChat][FOCUS] focus", { chatId, peerUsername });

      (async () => {
        const uid = await getSessionUid();
        if (!uid) return;

        try {
          if (chatId) await markChatRead(chatId);
        } catch (e) {
          console.log("[SingleChat][FOCUS] markRead error", safeErr(e));
        }

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
      })();

      return undefined;
    }, [chatId, peerUsername, getSessionUid, loadBlockedUsers, isGroup, peerName])
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
      const fresh = await fetchSingleMessagesDirect(chatId, 200);
      setItems(fresh);
      prefetchForItems(fresh);
      await setCachedSingleMessagesLocal({ chatId, peerUsername, items: fresh });
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 0);
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
        const owner_id = await getSessionUid();
        if (!owner_id) throw new Error("Not authenticated");
        const mediaUrl = await uploadChatMedia({ uri, chatId });
        const row = await sendMediaRow({ chatId, mediaUrl, caption, senderUsername: myUsername, owner_id });

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
      const owner_id = await getSessionUid();
      if (!owner_id) throw new Error("Not authenticated");
      await sendTextRow({ chatId, text, senderUsername: myUsername, owner_id });
    } catch (e) {
      setItems((p) => p.filter((m) => m.id !== optimistic.id));
      Alert.alert("Message not sent", e?.message || "Please try again.");
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
      const owner_id = await getSessionUid();
      if (!owner_id) throw new Error("Not authenticated");
      const row = await sendLocationRow({ chatId, locationData, senderUsername: myUsername, owner_id });
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
      setItems((p) => p.filter((m) => m.id !== optimisticId));
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
        const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.features?.[0]?.place_name) address = json.features[0].place_name;
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
        const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
        const q = encodeURIComponent(text.trim());
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${token}&limit=5`;
        const res = await fetch(url);
        const json = await res.json();
        setLocationSuggestions(
          (json.features || []).map((f) => ({
            address: f.place_name,
            lat: f.center[1],
            lng: f.center[0],
          }))
        );
      } catch {
        setLocationSuggestions([]);
      } finally {
        setLocationSearching(false);
      }
    }, 400);
  }, []);

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

  const renderItem = ({ item, index }) => {
    const prev = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;
    const isNewMinuteBlock = !prev || prev.minuteKey !== item.minuteKey;
    const senderChanged = !prev || prev.isMe !== item.isMe;
    const needsTopMargin = isNewMinuteBlock || senderChanged;
    // Show time only for the last message in a same-minute same-sender run
    const isSameMinuteGroup = !!next && next.minuteKey === item.minuteKey && next.isMe === item.isMe;
    const displayTime = isSameMinuteGroup ? null : item.time;

    let body = null;
    switch (item.type) {
      case "text":
        body = <TextMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
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
        body = <LocationMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      default:
        return null;
    }

    return <View style={{ marginTop: needsTopMargin ? 10 : 0 }}>{body}</View>;
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
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.select({ ios: 0, android: 0 })}
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => navigation.navigate("Profile", { username: peerUsername })}
            hitSlop={8}
          >
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
              {peerDisplayName}
            </Text>
          </TouchableOpacity>

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
                    paddingBottom: 8,
                    backgroundColor: theme.background,
                  }}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
                  keyboardShouldPersistTaps="handled"
                />

                <View
                  style={[
                    styles.composer,
                    {
                      backgroundColor: theme.background,
                      borderTopColor: isDark ? "#333" : "#EFF2F5",
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
                    <View style={[styles.inputWrap, { backgroundColor: isDark ? "#2B2B2B" : "#F4F6F9" }]}>
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
          onRequestClose={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); }}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); }}
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
                    onPress={() => onSendLocation(s)}
                  >
                    <Ionicons name="location-outline" size={14} color="#4EBCFF" style={{ marginRight: 8 }} />
                    <Text style={[styles.suggestionText, { color: theme.text }]} numberOfLines={2}>{s.address}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.locationCancelBtn}
              onPress={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); }}
            >
              <Text style={[styles.locationCancelText, { color: isDark ? "#9CA3AF" : "#888" }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
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
    fontWeight: "700",
    color: "#111",
    fontFamily: "Poppins",
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
    borderTopWidth: 1,
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
    fontFamily: "Poppins",
    fontWeight: "600",
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
    fontFamily: "Poppins",
    fontWeight: "700",
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
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  locationSheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Poppins",
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
  locationOptionText: { fontFamily: "Poppins", fontSize: 14, fontWeight: "600" },
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
  suggestionText: { flex: 1, fontFamily: "Poppins", fontSize: 13 },
  locationCancelBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  locationCancelText: { fontFamily: "Poppins", fontSize: 14 },
});
