// screens/GroupChatScreen.js
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
  Image,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import { uploadChatMedia } from "../lib/uploadImage";
import { markChatReadInCache } from "../lib/chatListCache";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import { Image as ExpoImage } from "expo-image";

import AsyncStorage from "@react-native-async-storage/async-storage";
import TextMessage from "../components/chat/TextMessage";
import MediaMessage from "../components/chat/MediaMessage";
import PostMessage from "../components/chat/PostMessage";
import FeedVideoMessage from "../components/chat/FeedVideoMessage";
import InviteMessage from "../components/chat/InviteMessage";
import LocationMessage from "../components/chat/LocationMessage";

// ✅ your cache helpers (exact names from the file you pasted)
import {
  getCachedGroupMessages,
  setCachedGroupMessages,
  getCachedGroupProfiles,
  setCachedGroupProfiles,
  fetchGroupMessagesEnriched,
  fetchProfilesByUsernames,
} from "../lib/groupChatCache";

/* ---------------- helpers ---------------- */
const getUserId = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Not authenticated");
  return data.user.id;
};

const makeMinuteKeyFromDate = (date) => {
  const sent_date = date.toISOString().slice(0, 10);
  const sent_time = date.toTimeString().slice(0, 5);
  return `${sent_date}_${sent_time}`;
};

// ✅ hide “You joined …” banners in this screen (even if cache maps them)
const isJoinBannerItem = (it) => it?.type === "join_banner";

const sendTextRow = async ({ chatId, text, owner_id, senderUsername }) => {
  const now = new Date();
  const sent_date = now.toISOString().slice(0, 10);
  const sent_time = now.toTimeString().slice(0, 8);
  const { data, error } = await supabase
    .from("messages")
    .insert([
      {
        owner_id,
        chat: chatId,
        is_group: true,
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
      is_group: true,
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
      is_group: true,
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
  const channel = supabase
    .channel(`messages-${chatId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `chat=eq.${chatId}`,
      },
      (payload) => onInsert?.(payload.new)
    )
    .subscribe((status, err) => {
      if (err) console.warn("[GroupChat realtime] error:", err.message);
    });
  return () => supabase.removeChannel(channel);
};

/* Shows first frame of a local or remote video as a static thumbnail */
function PendingVideoThumb({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => { p.muted = true; });
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

/* ---------------- Main screen ---------------- */
export default function GroupChatScreen({ navigation, route }) {
  const { theme, isDark } = useAlbaTheme();

  const {
    groupName: routeGroupName = "Group",
    members = [],
    myUsername = "me",
    groupAvatarLetter = "L",
    groupAvatarColor = "#FF6B6B",
    groupAvatarUri = null,
    groupId: initialGroupId,
    chatId: legacyChatId,
  } = route?.params ?? {};

  const [groupName, setGroupName] = useState(routeGroupName);
  const [chatId, setChatId] = useState(initialGroupId || legacyChatId || null);

  const [profilesMap, setProfilesMap] = useState({});
  const [membersLine, setMembersLine] = useState("");
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const isAdminRef = useRef(false);
  const [reviewLinks, setReviewLinks] = useState(false);
  const [kickedModal, setKickedModal] = useState(false);
  const [deletedModal, setDeletedModal] = useState(false);
  const [promotedModal, setPromotedModal] = useState(false);

  const [text, setText] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [items, setItems] = useState([]);
  const listRef = useRef(null);
  const optimisticIds = useRef(new Set());

  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [locationSearchText, setLocationSearchText] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const locationSearchTimeout = useRef(null);

  const onPressBack = () => navigation?.goBack?.();

  const handleKick = useCallback(async (username) => {
    if (!chatId || !username) return;
    try {
      const { data: groupRow } = await supabase
        .from("groups")
        .select("members")
        .eq("id", chatId)
        .maybeSingle();
      const newMembers = (groupRow?.members || []).filter((m) => m !== username);
      await supabase.from("groups").update({ members: newMembers }).eq("id", chatId);
    } catch (e) {
      Alert.alert("Error", "Could not remove member. Please try again.");
    }
  }, [chatId]);

  const handleOpenGroupInfo = useCallback(() => {
    navigation.navigate("GroupInfo", { groupId: chatId, groupName });
  }, [navigation, groupName, chatId]);

  const handleDeleted = (deletedId) => {
    const wasLast =
      items.length > 0 && String(items[items.length - 1].id) === String(deletedId);
    setItems((prev) => prev.filter((m) => String(m.id) !== String(deletedId)));

    // If the deleted message was the snippet shown in ChatList, repair chat_threads
    if (wasLast && chatId) {
      (async () => {
        try {
          const { data: auth } = await supabase.auth.getUser();
          const uid = auth?.user?.id;
          if (!uid) return;
          const { data: last } = await supabase
            .from("messages")
            .select("content, media_reference, post_id, sent_date, sent_time, sender_is_me, sender_username")
            .eq("chat", chatId)
            .eq("is_group", true)
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
          console.warn("[GroupChat] thread repair failed", e?.message);
        }
      })();
    }
  };

  // Resolve groupId from groupName if not provided
  useEffect(() => {
    if (chatId || !groupName) return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("groups")
          .select("id, groupname")
          .eq("groupname", groupName)
          .maybeSingle();

        if (cancelled) return;
        if (error || !data?.id) return;

        setChatId(data.id);
        if (data.groupname && data.groupname !== groupName) setGroupName(data.groupname);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, groupName]);

  // ✅ Load profiles from cache first; else fetch + cache
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!chatId) return;

      // 1) cache
      const cached = await getCachedGroupProfiles(chatId);
      if (!cancelled && cached) {
        setMembersLine(cached.membersLine || "");
        setProfilesMap(cached.profilesMap || {});
      }

      // 2) always fetch fresh profiles from DB (cache gave instant render above)
      if (!members?.length) return;

      try {
        const rows = await fetchProfilesByUsernames(members);

        if (cancelled) return;

        const map = {};
        const firstNames = [];

        rows.forEach((r) => {
          if (r?.avatar_url) {
            try {
              Image.prefetch(r.avatar_url);
              ExpoImage.prefetch?.(r.avatar_url);
            } catch {}
          }
        });

        for (const r of rows || []) {
          const full = r.name || r.username || "";
          const first = (full || "").split(" ")[0] || full;
          firstNames.push(first);
          map[r.username] = {
            id: r.id,
            username: r.username,
            firstName: first,
            avatarUrl: r.avatar_url || null,
            visibleToAll: !!r.visible_to_all,
          };
        }

        const line = firstNames.join(", ");
        setMembersLine(line);
        setProfilesMap(map);
        await setCachedGroupProfiles(chatId, line, map);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, members]);

  // ✅ KEY: load messages from cache instantly, then refresh + update cache
  useEffect(() => {
    if (!chatId) return;

    let mounted = true;

    (async () => {
      try {
        const uid = await getUserId();

        // Check if current user is a group admin + load review_links
        const { data: groupRow } = await supabase
          .from("groups")
          .select("group_admin, review_links")
          .eq("id", chatId)
          .maybeSingle();
        if (mounted && groupRow) {
          if (groupRow.group_admin) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("username")
              .eq("id", uid)
              .maybeSingle();
            const uname = profile?.username || myUsername;
            setIsAdmin(Array.isArray(groupRow.group_admin) && groupRow.group_admin.includes(uname));
          }
          setReviewLinks(!!groupRow.review_links);
        }

        // 1) instant cache render
        const cachedItems = await getCachedGroupMessages(chatId);
        if (mounted && Array.isArray(cachedItems) && cachedItems.length) {
          const filtered = cachedItems.filter((it) => !isJoinBannerItem(it));
          setItems(filtered);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 150);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 700);
        }

        // 2) refresh (enriched) and persist
        const fresh = await fetchGroupMessagesEnriched(chatId, 200);
        const filteredFresh = (fresh || []).filter((it) => !isJoinBannerItem(it));

        if (mounted) {
          setItems(filteredFresh);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 150);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 700);
        }

        await setCachedGroupMessages(chatId, filteredFresh);
      } catch (e) {
        if (mounted) Alert.alert("Login required", "Please sign in to view messages.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [chatId]);

  // Realtime inserts (also keep cache hot)
  useEffect(() => {
    if (!chatId) return () => {};

    const un = subscribeChatInserts(chatId, async (row) => {
      // ignore join banners (your mapper makes join_banner items, but INSERT row is still a row)
      const content = (row?.content || "").trim();
      const isJoinLike =
        (!row?.media_reference && !row?.post_id && !row?.group_id && /^you joined\s+/i.test(content)) ||
        (!row?.media_reference && !row?.post_id && !row?.group_id && / joined\s+.+\.\s*$/i.test(content));
      if (isJoinLike) return;

      const key = `${row.sent_date}T${row.sent_time}-${row.media_reference || row.post_id || row.content}-ins`;
      if (optimisticIds.current.has(key)) {
        optimisticIds.current.delete(key);
        return;
      }

      // we want enriched shape for post/invite previews, but INSERT won’t have them.
      // So: append a simple mapped item, then background refresh cache.
      const mapped = {
        id: row.id,
        isMe: !!row.sender_is_me,
        senderUsername: row.sender_username || null,
        minuteKey: `${(row.sent_date || "").trim()}_${(row.sent_time || "").slice(0, 5)}`,
      };

      let item = null;
      if (row.group_id) item = { ...mapped, type: "invite", groupId: row.group_id };
      else if (!row.media_reference && row.post_id && String(row.content || "").startsWith("__feed_video__:")) {
        try {
          const meta = JSON.parse(String(row.content).slice("__feed_video__:".length));
          item = { ...mapped, type: "feed_video", postId: row.post_id, thumbnailUrl: meta.thumbnailUrl || null };
        } catch { item = { ...mapped, type: "post", postId: row.post_id }; }
      } else if ((!row.content || !row.content.trim()) && !row.media_reference && row.post_id)
        item = { ...mapped, type: "post", postId: row.post_id };
      else if (row.media_reference)
        item = { ...mapped, type: "media", uris: [row.media_reference], caption: row.content || "" };
      else item = { ...mapped, type: "text", text: row.content || "" };

      setItems((prev) => {
        const next = [...prev, item].filter((it) => !isJoinBannerItem(it));
        // keep cache warm (best effort)
        setCachedGroupMessages(chatId, next).catch(() => {});
        return next;
      });

      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);

      // background: refresh enriched + cache (so previews appear)
      fetchGroupMessagesEnriched(chatId, 200)
        .then((fresh) => setCachedGroupMessages(chatId, (fresh || []).filter((it) => !isJoinBannerItem(it))))
        .catch(() => {});
    });

    return un;
  }, [chatId]);

  // Keep isAdminRef in sync so the subscription callback avoids stale closure
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);

  // Realtime group membership / admin changes
  useEffect(() => {
    if (!chatId || !myUsername) return () => {};

    const channel = supabase
      .channel(`group-meta-${chatId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "groups", filter: `id=eq.${chatId}` }, (payload) => {
        const newRow = payload.new;
        const newMembers = Array.isArray(newRow?.members) ? newRow.members : [];
        const newAdmins = Array.isArray(newRow?.group_admin) ? newRow.group_admin : [];

        // Kicked out?
        if (!newMembers.includes(myUsername)) {
          setKickedModal(true);
          return;
        }
        // Promoted to admin?
        if (!isAdminRef.current && newAdmins.includes(myUsername)) {
          setIsAdmin(true);
          setPromotedModal(true);
        }
        // Demoted from admin?
        if (isAdminRef.current && !newAdmins.includes(myUsername)) {
          setIsAdmin(false);
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "groups", filter: `id=eq.${chatId}` }, () => {
        setDeletedModal(true);
      })
      .subscribe((status, err) => {
        if (err) console.warn("[GroupChat group-updates realtime] error:", err.message);
      });

    return () => supabase.removeChannel(channel);
  }, [chatId, myUsername]);

  // Mark read on focus
  useFocusEffect(
    useCallback(() => {
      if (!chatId) return undefined;
      // Patch cache immediately (sync) so dot clears the moment user goes back
      markChatReadInCache(chatId);
      // RPC marks messages read + recalculates unread_count server-side in one call
      (async () => { try { await supabase.rpc("mark_chat_read", { p_chat_id: chatId }); } catch {} })();
      return undefined;
    }, [chatId])
  );

  // Send
  const onSend = useCallback(async () => {
    if (!chatId) return;

    // ── media send ──────────────────────────────────────────────────────────
    if (pendingImage) {
      const uri = pendingImage.uri;
      const caption = text.trim();
      setPendingImage(null);
      setText("");
      setSendingMedia(true);

      const now = new Date();
      const optimisticId = `opt-media-${now.getTime()}`;
      const minuteKey = makeMinuteKeyFromDate(now);
      const optimistic = {
        id: optimisticId,
        type: "media",
        isMe: true,
        senderUsername: myUsername,
        uris: [uri],
        caption,
        minuteKey,
        time: now.toTimeString().slice(0, 5),
      };

      setItems((prev) => {
        const next = [...prev, optimistic];
        setCachedGroupMessages(chatId, next).catch(() => {});
        return next;
      });
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);

      try {
        const owner_id = await getUserId();
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
          minuteKey: `${(row.sent_date || "").trim()}_${(row.sent_time || "").slice(0, 5)}`,
          time: (row.sent_time || "").slice(0, 5),
        };
        setItems((prev) => {
          const next = prev.map((m) => (m.id === optimisticId ? realItem : m));
          setCachedGroupMessages(chatId, next).catch(() => {});
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
    const msg = text.trim();
    if (!msg) return;

    // Feature 5: warn if message contains a link and review_links is active
    const hasLink = /https?:\/\/|www\./i.test(msg);
    if (hasLink && reviewLinks) {
      Alert.alert(
        "Link Review Active",
        "This group requires admin review for messages containing links. Your message will still be sent.",
        [{ text: "OK" }]
      );
    }

    // Feature 3: cross-group duplicate check (same message to 2 groups within 1 hour)
    try {
      const DEDUP_KEY = "alba_group_msg_dedup";
      const raw = await AsyncStorage.getItem(DEDUP_KEY);
      const dedupMap = raw ? JSON.parse(raw) : {};
      const now1h = Date.now() - 60 * 60 * 1000;
      const msgEntry = dedupMap[msg];
      if (msgEntry) {
        // Clean stale entries older than 1 hour
        const recentSends = msgEntry.filter((e) => e.sentAt > now1h);
        const sentToOtherGroup = recentSends.find((e) => e.groupId !== chatId);
        if (sentToOtherGroup) {
          Alert.alert(
            "Duplicate Message",
            "You already sent this exact message to another group in the last hour.",
            [{ text: "OK" }]
          );
          return;
        }
        // Add this group to the list
        dedupMap[msg] = [...recentSends, { groupId: chatId, sentAt: Date.now() }];
      } else {
        dedupMap[msg] = [{ groupId: chatId, sentAt: Date.now() }];
      }
      // Prune map to avoid unbounded growth (keep only keys with recent sends)
      for (const key of Object.keys(dedupMap)) {
        if (!dedupMap[key].some((e) => e.sentAt > now1h)) delete dedupMap[key];
      }
      await AsyncStorage.setItem(DEDUP_KEY, JSON.stringify(dedupMap));
    } catch {}

    const now = new Date();
    const minuteKey = makeMinuteKeyFromDate(now);
    const optimistic = {
      id: `opt-${now.getTime()}`,
      type: "text",
      isMe: true,
      text: msg,
      minuteKey,
      senderUsername: myUsername,
    };

    setItems((p) => {
      const next = [...p, optimistic];
      setCachedGroupMessages(chatId, next).catch(() => {});
      return next;
    });

    setText("");
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);

    const key = `${now.toISOString().slice(0, 10)}T${now.toTimeString().slice(0, 8)}-${msg}-ins`;
    if (optimisticIds.current.size > 500) optimisticIds.current.clear();
    optimisticIds.current.add(key);

    try {
      const owner_id = await getUserId();
      await sendTextRow({ chatId, text: msg, owner_id, senderUsername: myUsername });
    } catch (e) {
      setItems((p) => p.filter((m) => m.id !== optimistic.id));
      Alert.alert("Message not sent", e?.message || "Please try again.");
    }
  }, [chatId, text, pendingImage, myUsername]);

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
      minuteKey: `${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 5)}`,
      time: now.toTimeString().slice(0, 5),
    };
    setItems((prev) => [...prev, optimistic]);
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 0);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const owner_id = auth?.user?.id;
      if (!owner_id) throw new Error("Not authenticated");
      const row = await sendLocationRow({ chatId, locationData, senderUsername: myUsername, owner_id });
      const realItem = {
        id: row.id,
        type: "location",
        isMe: true,
        senderUsername: row.sender_username || myUsername,
        locationData,
        minuteKey: `${row.sent_date}_${(row.sent_time || "").slice(0, 5)}`,
        time: (row.sent_time || "").slice(0, 5),
      };
      setItems((prev) => prev.map((m) => (m.id === optimisticId ? realItem : m)));
    } catch {
      setItems((p) => p.filter((m) => m.id !== optimisticId));
    }
  }, [chatId, myUsername]);

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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Alba needs access to your photos."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.85 });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setPendingImage({ uri: asset.uri, type: "image" });
  }, []);

  const onPickVideo = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Alba needs access to your photos."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setPendingImage({ uri: asset.uri, type: "video" });
  }, []);

  const onPickCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Alba needs camera access."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 15 });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    const ext = asset.uri.split("?")[0].split(".").pop()?.toLowerCase() || "";
    const isVid = asset.type === "video" || ["mp4","mov","m4v","webm","avi"].includes(ext);
    setPendingImage({ uri: asset.uri, type: isVid ? "video" : "image" });
  }, []);

  const renderItem = ({ item, index }) => {
    const prev = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;

    const isNewMinuteBlock = !prev || prev.minuteKey !== item.minuteKey;
    const senderChanged = !prev || prev.senderUsername !== item.senderUsername;
    const needsTopMargin = isNewMinuteBlock || senderChanged;
    const displayTime = item.time;

    const senderDisplayName = !item.isMe && senderChanged
      ? (profilesMap[item.senderUsername]?.firstName || undefined)
      : undefined;

    let body = null;
    switch (item.type) {
      case "text":
        body = <TextMessage {...item} time={displayTime} onDeleted={handleDeleted} senderName={senderDisplayName} isAdmin={isAdmin} groupId={chatId} onKick={handleKick} />;
        break;
      case "media":
        body = <MediaMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "feed_video":
        body = <FeedVideoMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "post":
        body = <PostMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "invite":
        body = <InviteMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "location":
        body = <LocationMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      // join_banner intentionally hidden
      default:
        return null;
    }
    if (item.isMe) return <View style={{ marginTop: needsTopMargin ? 1 : 0 }}>{body}</View>;

    const profile = item.senderUsername ? profilesMap[item.senderUsername] : null;
    const showAvatarColumn = !!profile;

    const onPressAvatar = () => {
      if (!profile || !profile.visibleToAll || !profile.username) return;
      navigation.navigate("Profile", { username: profile.username });
    };

    return (
      <View style={{ marginTop: needsTopMargin ? 1 : 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {showAvatarColumn ? (
            <TouchableOpacity
              activeOpacity={profile.visibleToAll ? 0.8 : 1}
              onPress={onPressAvatar}
              style={{ width: 32, marginRight: 10 }}
            >
              {profile.avatarUrl ? (
                <ExpoImage
                  source={{ uri: profile.avatarUrl }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: "#E5ECF4",
                  }}
                  contentFit="cover"
                  cachePolicy="disk"
                  transition={0}
                />
              ) : (
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: "#E5ECF4",
                  }}
                />
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 32, marginRight: 10 }} />
          )}

          <View style={{ flex: 1 }}>{body}</View>
        </View>
      </View>
    );
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      "Leave group",
      `Are you sure you want to leave ${groupName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase.rpc("remove_member_from_group", {
                gid: chatId,
                uname: myUsername,
              });
              if (error) {
                // Fallback: manual array removal
                const { data: gr } = await supabase
                  .from("groups")
                  .select("members")
                  .eq("id", chatId)
                  .maybeSingle();
                const next = (Array.isArray(gr?.members) ? gr.members : []).filter(
                  (m) => String(m).toLowerCase() !== String(myUsername).toLowerCase()
                );
                await supabase.from("groups").update({ members: next }).eq("id", chatId);
              }
              navigation.goBack();
            } catch (e) {
              Alert.alert("Error", "Could not leave group. Try again.");
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.select({ ios: 0, android: 0 })}
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.gray }]}>
        <Header
          title={groupName}
          subtitle={membersLine}
          avatarLetter={groupAvatarLetter}
          avatarColor={groupAvatarColor}
          avatarUri={groupAvatarUri}
          onBack={onPressBack}
          onPressTitle={handleOpenGroupInfo}
          onPressMenu={() => setGroupMenuOpen(true)}
          theme={theme}
          isDark={isDark}
        />

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: 8 }]}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />

        <Composer
          value={text}
          onChangeText={setText}
          onSend={onSend}
          onAttachLocation={() => setLocationModalVisible(true)}
          onPickGallery={onPickGallery}
          onPickVideo={onPickVideo}
          onPickCamera={onPickCamera}
          pendingImage={pendingImage}
          onClearPending={() => setPendingImage(null)}
          sendingMedia={sendingMedia}
          theme={theme}
          isDark={isDark}
        />

        <Modal
          visible={groupMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setGroupMenuOpen(false)}
        >
          <TouchableOpacity
            style={styles.groupMenuOverlay}
            activeOpacity={1}
            onPress={() => setGroupMenuOpen(false)}
          >
            <View style={[styles.groupMenuCard, { backgroundColor: isDark ? "#2a2a2a" : "#fff" }]}>
              <Text style={[styles.groupMenuTitle, { color: isDark ? "#fff" : "#111" }]} numberOfLines={1}>
                {groupName}
              </Text>

              {/* Mute */}
              <TouchableOpacity
                style={styles.groupMenuItem}
                onPress={() => {
                  setGroupMenuOpen(false);
                  Alert.alert("Muted", "You will no longer receive notifications from this group.");
                }}
              >
                <Feather name="bell-off" size={18} color={isDark ? "#fff" : "#333"} style={{ marginRight: 12 }} />
                <Text style={[styles.groupMenuText, { color: isDark ? "#fff" : "#111" }]}>Mute</Text>
              </TouchableOpacity>

              {/* Report */}
              <TouchableOpacity
                style={styles.groupMenuItem}
                onPress={async () => {
                  setGroupMenuOpen(false);
                  const { data: auth } = await supabase.auth.getUser();
                  const reporterId = auth?.user?.id || null;
                  try {
                    await supabase.from("reports").insert({
                      reported_by: reporterId,
                      reason: `Group: ${groupName}`,
                      chat_id: chatId || null,
                    });
                  } catch {}
                  try {
                    const { data: myProfile } = await supabase
                      .from("profiles")
                      .select("username")
                      .eq("id", reporterId)
                      .maybeSingle();
                    await supabase.functions.invoke("send-report", {
                      body: {
                        type: "group_chat",
                        reported_by_id: reporterId,
                        reported_by_username: myProfile?.username || null,
                        reason: `Group reported: ${groupName}`,
                        context: {
                          group_name: groupName,
                          chat_id: chatId || null,
                          group_id: chatId || null,
                        },
                      },
                    });
                  } catch {}
                  Alert.alert("Reported", "Thanks, we'll review this group.");
                }}
              >
                <Feather name="alert-triangle" size={18} color={isDark ? "#fff" : "#333"} style={{ marginRight: 12 }} />
                <Text style={[styles.groupMenuText, { color: isDark ? "#fff" : "#111" }]}>Report</Text>
              </TouchableOpacity>

              <View style={[styles.groupMenuDivider, { backgroundColor: isDark ? "#444" : "#eee" }]} />

              {/* Leave group */}
              <TouchableOpacity
                style={styles.groupMenuItem}
                onPress={() => {
                  setGroupMenuOpen(false);
                  handleLeaveGroup();
                }}
              >
                <Feather name="log-out" size={18} color="#d23b3b" style={{ marginRight: 12 }} />
                <Text style={[styles.groupMenuText, { color: "#d23b3b" }]}>Leave group</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Location picker modal */}
        <Modal
          visible={locationModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); }}
        >
          <TouchableOpacity
            style={styles.locOverlay}
            activeOpacity={1}
            onPress={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); }}
          />
          <View style={[styles.locSheet, { backgroundColor: isDark ? "#1A2330" : "#FFFFFF" }]}>
            <Text style={[styles.locSheetTitle, { color: theme.text }]}>Share Location</Text>

            <TouchableOpacity
              style={[styles.locOptionBtn, { borderColor: isDark ? "#333" : "#E0E6EF" }]}
              onPress={onSendCurrentLocation}
            >
              <Ionicons name="locate" size={20} color="#4EBCFF" style={{ marginRight: 10 }} />
              <Text style={[styles.locOptionText, { color: theme.text }]}>Send current location</Text>
            </TouchableOpacity>

            <Text style={[styles.locOrLabel, { color: isDark ? "#9CA3AF" : "#888" }]}>or search for a place</Text>

            <View style={[styles.locSearchWrap, { backgroundColor: isDark ? "#2B2B2B" : "#F4F6F9", borderColor: isDark ? "#444" : "#D9E0EA" }]}>
              <Ionicons name="search" size={16} color={isDark ? "#9CA3AF" : "#888"} style={{ marginRight: 6 }} />
              <TextInput
                style={[styles.locSearchInput, { color: theme.text }]}
                placeholder="Via Valtellina 5 or Alcatraz…"
                placeholderTextColor={isDark ? "#666" : "#AAA"}
                value={locationSearchText}
                onChangeText={onLocationSearch}
                autoCorrect={false}
              />
              {locationSearching && <ActivityIndicator size="small" color="#4EBCFF" />}
            </View>

            {locationSuggestions.length > 0 && (
              <View style={[styles.locSuggestionsBox, { backgroundColor: isDark ? "#1E2933" : "#FAFCFF", borderColor: isDark ? "#333" : "#D9E0EA" }]}>
                {locationSuggestions.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.locSuggestionRow, i < locationSuggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? "#333" : "#E5E9F0" }]}
                    onPress={() => onSendLocation(s)}
                  >
                    <Ionicons name="location-outline" size={14} color="#4EBCFF" style={{ marginRight: 8 }} />
                    <Text style={[styles.locSuggestionText, { color: theme.text }]} numberOfLines={2}>{s.address}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.locCancelBtn}
              onPress={() => { setLocationModalVisible(false); setLocationSearchText(""); setLocationSuggestions([]); }}
            >
              <Text style={[styles.locCancelText, { color: isDark ? "#9CA3AF" : "#888" }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>
        {/* Kicked out modal */}
        <Modal visible={kickedModal} transparent animationType="fade" onRequestClose={() => {}}>
          <View style={styles.metaModalOverlay}>
            <View style={[styles.metaModalCard, { backgroundColor: isDark ? "#1e2530" : "#fff" }]}>
              <Text style={[styles.metaModalTitle, { color: theme.text }]}>Removed from group</Text>
              <Text style={[styles.metaModalBody, { color: isDark ? "#aaa" : "#555" }]}>
                You are no longer a member of this group.
              </Text>
              <TouchableOpacity
                style={styles.metaModalBtn}
                onPress={() => { setKickedModal(false); navigation.goBack(); }}
              >
                <Text style={styles.metaModalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Group deleted modal */}
        <Modal visible={deletedModal} transparent animationType="fade" onRequestClose={() => {}}>
          <View style={styles.metaModalOverlay}>
            <View style={[styles.metaModalCard, { backgroundColor: isDark ? "#1e2530" : "#fff" }]}>
              <Text style={[styles.metaModalTitle, { color: theme.text }]}>Group deleted</Text>
              <Text style={[styles.metaModalBody, { color: isDark ? "#aaa" : "#555" }]}>
                The group was deleted by the admin.
              </Text>
              <TouchableOpacity
                style={styles.metaModalBtn}
                onPress={() => { setDeletedModal(false); navigation.goBack(); }}
              >
                <Text style={styles.metaModalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Promoted to admin modal */}
        <Modal visible={promotedModal} transparent animationType="fade" onRequestClose={() => setPromotedModal(false)}>
          <View style={styles.metaModalOverlay}>
            <View style={[styles.metaModalCard, { backgroundColor: isDark ? "#1e2530" : "#fff" }]}>
              <Text style={[styles.metaModalTitle, { color: theme.text }]}>You're now an admin</Text>
              <Text style={[styles.metaModalBody, { color: isDark ? "#aaa" : "#555" }]}>
                You have been made an admin of this group.
              </Text>
              <TouchableOpacity
                style={styles.metaModalBtn}
                onPress={() => setPromotedModal(false)}
              >
                <Text style={styles.metaModalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/* ------------------------- Header ------------------------- */
function Header({
  title,
  subtitle,
  avatarLetter,
  avatarColor,
  avatarUri,
  onBack,
  onPressTitle,
  onPressMenu,
  theme,
  isDark,
}) {
  return (
    <View style={[styles.headerWrap, { backgroundColor: theme.gray,            borderBottomColor: theme.border,
            borderBottomWidth: StyleSheet.hairlineWidth, }]}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={8}>
        <Feather name="chevron-left" size={26} color={theme.text} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.headerCenter} activeOpacity={0.8} onPress={onPressTitle}>
        {avatarUri ? (
          <ExpoImage
            source={{ uri: avatarUri }}
            style={styles.headerAvatarImage}
            contentFit="cover"
            cachePolicy="disk"
            transition={0}
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{avatarLetter}</Text>
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text
              style={[styles.subtitle, { color: isDark ? "#9CA3AF" : "#9EA3A7" }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} hitSlop={8} onPress={onPressMenu}>
        <Feather name="more-vertical" size={22} color={theme.text} />
      </TouchableOpacity>
    </View>
  );
}

/* ------------------------- Composer ------------------------ */
function Composer({ value, onChangeText, onSend, onAttachLocation, onPickGallery, onPickVideo, onPickCamera, pendingImage, onClearPending, sendingMedia, theme, isDark }) {
  const iconColor = isDark ? "#E5E7EB" : "#444";
  return (
    <View
      style={[
        styles.composerWrap,
        {
          borderTopColor: isDark ? "#1F2933" : "#EFF2F5",
          backgroundColor: theme.gray,
        },
      ]}
    >
      <View style={styles.composerLeft}>
        <TouchableOpacity onPress={onAttachLocation} style={styles.iconBtn} hitSlop={8}>
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
            <Image source={{ uri: pendingImage.uri }} style={styles.pendingThumb} resizeMode="cover" />
          )}
          <TouchableOpacity style={styles.pendingRemove} onPress={onClearPending} hitSlop={8}>
            <Feather name="x" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={[
            styles.inputWrap,
            { backgroundColor: isDark ? "#1F2933" : "#F5F7FA" },
            platformShadow(1),
          ]}
        >
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: theme.gray,
              borderColor: theme.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: 999 }]}
            placeholder="Aa"
            placeholderTextColor={isDark ? "#6B7280" : "#B8B8B8"}
            value={value}
            onChangeText={onChangeText}
            multiline
          />
        </View>
      )}

      <TouchableOpacity onPress={onSend} style={styles.sendBtn} disabled={sendingMedia} hitSlop={8}>
        {sendingMedia ? (
          <ActivityIndicator size="small" color="#0BC6D8" />
        ) : (
          <Feather name="send" size={20} color="#0BC6D8" />
        )}
      </TouchableOpacity>
    </View>
  );
}

/* --------------------------- Styles ------------------------ */
const styles = StyleSheet.create({
  safe: { flex: 1 },
  metaModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  metaModalCard: { width: "100%", borderRadius: 16, padding: 24, alignItems: "center" },
  metaModalTitle: { fontFamily: "PoppinsBold", fontSize: 17, marginBottom: 10, textAlign: "center" },
  metaModalBody: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", marginBottom: 20, lineHeight: 20 },
  metaModalBtn: { backgroundColor: "#3D8BFF", borderRadius: 10, paddingVertical: 11, paddingHorizontal: 40 },
  metaModalBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
  groupMenuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  groupMenuCard: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingBottom: 28, paddingHorizontal: 16 },
  groupMenuTitle: { fontFamily: "PoppinsBold", fontSize: 15, textAlign: "center", paddingVertical: 10, marginBottom: 4 },
  groupMenuItem: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  groupMenuText: { fontFamily: "Poppins", fontSize: 15 },
  groupMenuDivider: { height: 1, marginVertical: 4 },
  headerWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  backBtn: { paddingRight: 4, paddingVertical: 4 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  menuBtn: { paddingLeft: 8, paddingVertical: 4 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  headerAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: "#E5ECF4",
  },
  avatarText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    fontFamily: "Poppins",
  },
  title: { fontSize: 15.5, fontWeight: "700", fontFamily: "Poppins" },
  subtitle: { fontSize: 12, marginTop: 2, fontFamily: "Poppins" },
  listContent: { paddingHorizontal: 16 },
  composerWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 10,
  },
  composerLeft: { flexDirection: "row", gap: 10 },
  iconBtn: { padding: 6, borderRadius: 12 },
  inputWrap: { flex: 1, borderRadius: 16 },
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14.5,
    maxHeight: 110,
    fontFamily: "Poppins",
  },
  sendBtn: { padding: 8, borderRadius: 12 },

  // Location modal
  locOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  locSheet: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32,
  },
  locSheetTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Poppins", marginBottom: 16, textAlign: "center" },
  locOptionBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  locOptionText: { fontFamily: "Poppins", fontSize: 14, fontWeight: "600" },
  locOrLabel: { fontSize: 12, fontFamily: "Poppins", marginBottom: 8 },
  locSearchWrap: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  locSearchInput: { flex: 1, fontFamily: "Poppins", fontSize: 13 },
  locSuggestionsBox: { borderRadius: 10, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  locSuggestionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12 },
  locSuggestionText: { flex: 1, fontFamily: "Poppins", fontSize: 13 },
  locCancelBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  locCancelText: { fontFamily: "Poppins", fontSize: 14 },
});

function platformShadow(elev = 2) {
  if (Platform.OS === "ios") {
    return {
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    };
  }
  return { elevation: elev };
}
