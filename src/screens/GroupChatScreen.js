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
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabase";
import { uploadChatImage } from "../lib/uploadImage";
import { markChatReadInCache } from "../lib/chatListCache";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import { Image as ExpoImage } from "expo-image";

import TextMessage from "../components/chat/TextMessage";
import MediaMessage from "../components/chat/MediaMessage";
import PostMessage from "../components/chat/PostMessage";
import InviteMessage from "../components/chat/InviteMessage";

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
    .subscribe();
  return () => supabase.removeChannel(channel);
};

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

  const [text, setText] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [items, setItems] = useState([]);
  const listRef = useRef(null);
  const optimisticIds = useRef(new Set());

  const onPressBack = () => navigation?.goBack?.();

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
        await getUserId();

        // 1) instant cache render
        const cachedItems = await getCachedGroupMessages(chatId);
        if (mounted && Array.isArray(cachedItems) && cachedItems.length) {
          const filtered = cachedItems.filter((it) => !isJoinBannerItem(it));
          setItems(filtered);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 0);
        }

        // 2) refresh (enriched) and persist
        const fresh = await fetchGroupMessagesEnriched(chatId, 200);
        const filteredFresh = (fresh || []).filter((it) => !isJoinBannerItem(it));

        if (mounted) {
          setItems(filteredFresh);
          setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 0);
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
      else if ((!row.content || !row.content.trim()) && !row.media_reference && row.post_id)
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
        const mediaUrl = await uploadChatImage({ uri, chatId });
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

  const onPickGallery = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Alba needs access to your photos.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setPendingImage({ uri: asset.uri });
  }, []);

  const onPickCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Alba needs camera access.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: 0.85,
    });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setPendingImage({ uri: asset.uri });
  }, []);

  const renderItem = ({ item, index }) => {
    const prev = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;

    const isNewMinuteBlock = !prev || prev.minuteKey !== item.minuteKey;
    const senderChanged = !prev || prev.senderUsername !== item.senderUsername;
    const needsTopMargin = isNewMinuteBlock || senderChanged;
    // Show time only for the last message in a same-minute same-sender run
    const isSameMinuteGroup = !!next && next.minuteKey === item.minuteKey && next.senderUsername === item.senderUsername;
    const displayTime = isSameMinuteGroup ? null : item.time;

    const senderDisplayName = !item.isMe && senderChanged
      ? (profilesMap[item.senderUsername]?.firstName || undefined)
      : undefined;

    let body = null;
    switch (item.type) {
      case "text":
        body = <TextMessage {...item} time={displayTime} onDeleted={handleDeleted} senderName={senderDisplayName} />;
        break;
      case "media":
        body = <MediaMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "post":
        body = <PostMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
        break;
      case "invite":
        body = <InviteMessage {...item} time={displayTime} onDeleted={handleDeleted} />;
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
          onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
          keyboardShouldPersistTaps="handled"
        />

        <Composer
          value={text}
          onChangeText={setText}
          onSend={onSend}
          onAttachLocation={() => {}}
          onPickGallery={onPickGallery}
          onPickCamera={onPickCamera}
          pendingImage={pendingImage}
          onClearPending={() => setPendingImage(null)}
          sendingMedia={sendingMedia}
          theme={theme}
          isDark={isDark}
        />
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

      <TouchableOpacity style={styles.menuBtn} hitSlop={8}>
        <Feather name="more-vertical" size={22} color={theme.text} />
      </TouchableOpacity>
    </View>
  );
}

/* ------------------------- Composer ------------------------ */
function Composer({ value, onChangeText, onSend, onAttachLocation, onPickGallery, onPickCamera, pendingImage, onClearPending, sendingMedia, theme, isDark }) {
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
        <TouchableOpacity onPress={onPickCamera} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="camera-outline" size={22} color={iconColor} />
        </TouchableOpacity>
      </View>

      {pendingImage ? (
        <View style={styles.pendingWrap}>
          <Image source={{ uri: pendingImage.uri }} style={styles.pendingThumb} resizeMode="cover" />
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
