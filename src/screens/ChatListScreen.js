// screens/ChatListScreen.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFonts } from "expo-font";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import ChatTab from "../components/chat/ChatTab";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import {
  getCachedChatListData,
  preloadChatListData,
  isCacheFresh,
} from "../lib/chatListCache";


const prettifyUsername = (u) =>
  (u || "").replace(/[_\-]+/g, " ").replace(/\b\w/g, (c) => c) || "User";

const isVideoUrl = (u = "") =>
  /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(String(u).split("?")[0] || "");

function Header({ title, onBack, theme }) {
  return (
    <View
      style={[
        styles.headerWrap,
        {
          backgroundColor: theme.gray,
          borderBottomColor: theme.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={8}>
        <Feather name="chevron-left" size={26} color={theme.text} />
      </TouchableOpacity>

      <View style={styles.headerCenter}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.menuBtn} hitSlop={8}>
        <Feather name="more-vertical" size={22} color={theme.text} />
      </TouchableOpacity>
    </View>
  );
}

export default function ChatListScreen({ navigation }) {
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState([]);
  const [dmMap, setDmMap] = useState({});
  const [groupMap, setGroupMap] = useState({});
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [maxDistanceKm, setMaxDistanceKm] = useState(50);
  const [myUsername, setMyUsername] = useState(null);

  const [currentUserId, setCurrentUserId] = useState(null);
  const channelRef = useRef(null);

  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);

  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });
  if (!fontsLoaded) return null;

  const ensureLocation = useCallback(async () => {
    if (currentLocation) return currentLocation;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return null;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const res = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setCurrentLocation(res);
      return res;
    } catch {
      return null;
    }
  }, [currentLocation]);

  const hydrateFromCacheFast = useCallback(async (uid) => {
    const cached = await getCachedChatListData(uid);
    if (!cached) return false;

    setThreads(cached.threads || []);
    setDmMap(cached.dmMap || {});
    setGroupMap(cached.groupMap || {});
    setBlockedUsers(cached.blockedUsers || []);
    setMaxDistanceKm(typeof cached.maxDistanceKm === "number" ? cached.maxDistanceKm : 50);
    setMyUsername(cached.myUsername || null);
    return true;
  }, []);

  const refreshInBackground = useCallback(async (uid) => {
    try {
      const fresh = await preloadChatListData(uid, { limit: 120 });
      if (!fresh) return;

      setThreads(fresh.threads || []);
      setDmMap(fresh.dmMap || {});
      setGroupMap(fresh.groupMap || {});
      setBlockedUsers(fresh.blockedUsers || []);
      setMaxDistanceKm(typeof fresh.maxDistanceKm === "number" ? fresh.maxDistanceKm : 50);
      setMyUsername(fresh.myUsername || null);
    } catch {}
  }, []);

  const init = useCallback(async () => {
    setReady(false);

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    setCurrentUserId(uid || null);

    if (!uid) {
      setThreads([]);
      setDmMap({});
      setGroupMap({});
      setBlockedUsers([]);
      setReady(true);
      return;
    }

    // 1) Instant render from cache (no network needed)
    await hydrateFromCacheFast(uid);
    setReady(true);

    // 2) Refresh if stale (background, no blocking)
    if (!isCacheFresh(uid)) {
      refreshInBackground(uid);
    }

    // 3) Live updates: listen to chat_threads (cheap)
    channelRef.current = supabase
      .channel("chat_threads-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_threads" },
        (payload) => {
          const row = payload.new;
          if (!row || row.owner_id !== uid) return;
          // refresh in background
          refreshInBackground(uid);
        }
      )
      .subscribe();
  }, [hydrateFromCacheFast, refreshInBackground]);

  useEffect(() => {
    init();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [init]);

  useFocusEffect(
    useCallback(() => {
      init();
      return undefined;
    }, [init])
  );

  const grouped = useMemo(() => {
    const items = [];

    for (const th of threads || []) {
      const chatId = th.chat_id;
      const isGroup = !!th.is_group;

      const dmMeta = !isGroup ? dmMap[chatId] || {} : {};
      const groupMeta = isGroup ? groupMap[chatId] || {} : {};

      const username = !isGroup ? dmMeta.username || "" : null;
      const displayName = isGroup
        ? groupMeta.name || "Group"
        : dmMeta.name || prettifyUsername(username);

      const avatarUri = isGroup ? groupMeta.avatarUrl || null : dmMeta.avatarUrl || null;
      const members = isGroup ? groupMeta.members || [] : [];

      const unreadCount = Number(th.unread_count || 0);
      const isBlocked = !isGroup && username && blockedUsers.includes(username);

      const actorBase = th?.last_sender_is_me
        ? "You"
        : isGroup
        ? displayName
        : username
        ? `@${username}`
        : "User";

      let lastMessage = "";
      const text = (th?.last_content || "").trim();

      if (isBlocked) {
        lastMessage = t("chat_user_blocked_snippet");
      } else if (text) {
        lastMessage = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      } else if (th?.last_post_id || th?.last_post_reference) {
        lastMessage = `${actorBase} shared a post.`;
      } else if (th?.last_media_reference) {
        lastMessage = `${actorBase} ${
          isVideoUrl(th.last_media_reference) ? "shared a video." : "shared a photo."
        }`;
      } else {
        lastMessage = th?.last_sent_at
          ? th?.last_sender_is_me
            ? "You sent a message."
            : `${actorBase} sent a message.`
          : "";
      }

      const sentAt = th?.last_sent_at ? new Date(th.last_sent_at) : null;
      let displayTime = "";
      let lastDate = "";
      let lastTime = "";

      if (sentAt && !Number.isNaN(sentAt.getTime())) {
        const today = new Date();
        const isToday = sentAt.toDateString() === today.toDateString();
        displayTime = isToday
          ? sentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : sentAt.toLocaleDateString([], { month: "short", day: "numeric" });

        lastDate = sentAt.toISOString().slice(0, 10);
        lastTime = sentAt.toTimeString().slice(0, 8);
      }

      const initials = displayName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

      items.push({
        id: String(chatId),
        chatId,
        type: isGroup ? "group" : "single",
        name: displayName,
        username,
        initials,
        avatarUri,
        members,
        lastMessage,
        lastSender: th?.last_sender_is_me ? "me" : "other",
        lastDate,
        lastTime,
        displayTime,
        unreadCount,
        isBlocked,
      });
    }

    // groups with zero messages (from cached groupMap)
    const already = new Set(items.map((x) => String(x.chatId)));
    for (const [gid, meta] of Object.entries(groupMap || {})) {
      if (!gid) continue;
      if (already.has(String(gid))) continue;

      const name = meta?.name || "Group";
      const initials = name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

      items.push({
        id: String(gid),
        chatId: gid,
        type: "group",
        name,
        username: null,
        initials,
        avatarUri: meta?.avatarUrl || null,
        members: meta?.members || [],
        lastMessage: `You joined ${name}.`,
        lastSender: "me",
        lastDate: "",
        lastTime: "",
        displayTime: "",
        unreadCount: 0,
        isBlocked: false,
      });
    }

    items.sort((a, b) => {
      const aKey = `${a.lastDate || "0000-00-00"}T${a.lastTime || "00:00:00"}`;
      const bKey = `${b.lastDate || "0000-00-00"}T${b.lastTime || "00:00:00"}`;
      if (aKey === bKey) return String(a.name || "").localeCompare(String(b.name || ""));
      return aKey < bKey ? 1 : -1;
    });

    return items;
  }, [threads, dmMap, groupMap, blockedUsers, t]);

  // ---------------- search ----------------

  const handleSearchChange = async (text) => {
    setQ(text);
    const term = text.trim();
    if (!term) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    try {
      const safeTerm = term.replace(/%/g, "");
      const radiusMeters = Math.max(1, Math.round(maxDistanceKm * 1000));
      const loc = await ensureLocation();

      if (!loc) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, name, avatar_url")
          .or(`username.ilike.%${safeTerm}%,name.ilike.%${safeTerm}%`)
          .not("username", "is", null)
          .limit(25);

        if (error) return setSearchResults([]);

        let profiles = Array.isArray(data) ? data : [];
        if (currentUserId) profiles = profiles.filter((p) => p.id !== currentUserId);
        profiles = profiles.filter((p) => p.username && !blockedUsers.includes(p.username));
        setSearchResults(profiles);
        return;
      }

      const { data, error } = await supabase.rpc("nearby_profiles", {
        dist: radiusMeters,
        lat: loc.lat,
        long: loc.lng,
        search_term: safeTerm,
      });

      if (error) return setSearchResults([]);

      let profiles = Array.isArray(data) ? data : [];
      if (currentUserId) profiles = profiles.filter((p) => p.id !== currentUserId);
      profiles = profiles.filter((p) => p.username && !blockedUsers.includes(p.username));
      setSearchResults(profiles);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleMessageUser = (profile) => {
    const username = profile.username;
    if (!username) return;
    const displayName = profile.name || prettifyUsername(profile.username || "");
    navigation.navigate("SingleChat", { isGroup: false, peerName: displayName, username });
  };

  const openChat = (item) => {
    if (item.type === "group") {
      navigation.navigate("GroupChat", {
        groupId: item.chatId,
        groupName: item.name,
        members: item.members || [],
        groupAvatarLetter: (item.initials || item.name[0]).slice(0, 1),
        groupAvatarColor: "#FF6B6B",
        groupAvatarUri: item.avatarUri || null,
        myUsername: myUsername || "me",
      });
    } else {
      navigation.navigate("SingleChat", {
        isGroup: false,
        peerName: item.name,
        username: item.username,
      });
    }
  };

  const handleRefresh = useCallback(async () => {
    if (!currentUserId) return;
    setRefreshing(true);
    try {
      await refreshInBackground(currentUserId);
    } catch {}
    setRefreshing(false);
  }, [currentUserId, refreshInBackground]);

  const onPressBack = () => navigation?.goBack?.();
  const isSearching = q.trim().length > 0;
  const noMatchText = t("chat_search_no_matching_users") || "No matching users nearby";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.gray }]}>
      <Header title="Chats" onBack={onPressBack} theme={theme} />

      <View
        style={[
          styles.searchWrap,
          {
            backgroundColor: isDark ? "#1f1f1f" : "#F4F6F9",
            borderColor: isDark ? "#444" : "transparent",
          },
        ]}
      >
        <Feather name="search" size={18} color={isDark ? "#A0A4AE" : "#B8B8B8"} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search"
          placeholderTextColor={isDark ? "#A0A4AE" : "#B8B8B8"}
          value={q}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isSearching && (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <View style={styles.membersHeaderRow}>
            <Text style={[styles.membersTitle, { color: theme.text }]}>
              {t("chat_search_people_title") || "People near you"}
            </Text>
            <Text style={[styles.membersCount, { color: theme.subtleText || theme.text }]}>
              {searchLoading ? "…" : searchResults.length}
            </Text>
          </View>

          <View
            style={[
              styles.membersList,
              { borderColor: theme.border, backgroundColor: theme.card },
            ]}
          >
            {searchLoading ? (
              <View style={{ paddingVertical: 12, paddingHorizontal: 8 }}>
                <Text style={{ fontFamily: "Poppins", fontSize: 14, textAlign: "center", color: theme.subtleText || theme.text }}>
                  {t("loading_text") || "Loading..."}
                </Text>
              </View>
            ) : searchResults.length > 0 ? (
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 4 }}>
                {searchResults.map((item) => {
                  const displayName = item.name || item.username || "User";
                  const username = item.username || "";
                  const key = item.id?.toString() || username;

                  return (
                    <View key={key} style={[styles.memberRow, { borderBottomColor: theme.border }]}>
                      {item.avatar_url ? (
                        <Image source={{ uri: item.avatar_url }} style={styles.memberAvatar} />
                      ) : (
                        <View style={[styles.memberAvatar, { backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }]}>
                          <Text style={[styles.memberInitials, { color: theme.text }]}>
                            {displayName[0]?.toUpperCase() || "?"}
                          </Text>
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text style={[styles.memberName, { color: theme.text }]}>{displayName}</Text>
                        {!!username && (
                          <Text style={[styles.memberUsername, { color: theme.subtleText || theme.text }]}>@{username}</Text>
                        )}
                      </View>

                      <TouchableOpacity style={styles.subgroupButton} onPress={() => handleMessageUser(item)}>
                        <Text style={styles.subgroupButtonText}>{t("chat_search_message_button") || "Message"}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ paddingVertical: 12, paddingHorizontal: 8 }}>
                <Text style={{ fontFamily: "Poppins", fontSize: 14, textAlign: "center", color: theme.subtleText || theme.text }}>
                  {noMatchText}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, textAlign: "center", color: theme.secondaryText, fontFamily: "Poppins" }}>
            {t("loading_text") || "Loading..."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(i) => i.id}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews
          renderItem={({ item }) => (
            <ChatTab
              type={item.type}
              name={item.name}
              avatarUri={item.avatarUri}
              initials={item.initials}
              lastMessage={item.lastMessage}
              lastSender={item.lastSender}
              lastDate={item.lastDate}
              lastTime={item.lastTime}
              lastOpenedAt={"1970-01-01T00:00"}
              displayTime={item.displayTime}
              onPress={() => openChat(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.border }]} />}
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: { paddingRight: 4, paddingVertical: 4 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  menuBtn: { paddingLeft: 8, paddingVertical: 4 },

  title: { fontSize: 15.5, fontWeight: "700", fontFamily: "Poppins", alignItems: "center" },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins" },
  sep: { height: 1, marginLeft: 72 },

  membersHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginTop: 4,
    marginBottom: 4,
  },
  membersTitle: { fontFamily: "PoppinsBold", fontSize: 15 },
  membersCount: { fontFamily: "Poppins", fontSize: 14 },
  membersList: {
    marginTop: 0,
    borderWidth: 1,
    borderRadius: 14,
    maxHeight: 170,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  memberInitials: { fontFamily: "PoppinsBold", fontSize: 16 },
  memberName: { fontFamily: "Poppins", fontSize: 15 },
  memberUsername: { fontFamily: "Poppins", fontSize: 13, marginTop: 2 },
  subgroupButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 5,
    backgroundColor: "#59A7FF",
    justifyContent: "center",
    alignItems: "center",
  },
  subgroupButtonText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#ffffff" },
});
