// components/ShareMenu.js — DROP-IN (menu packs left-to-right, no "space-between" gaps)
// Change: the 6-slot menu always fills in chronological order:
// top-left, top-middle, top-right, bottom-left, bottom-middle, bottom-right.
// If only 2 chats -> they appear left + middle (not spread to edges).
//
// Everything else from prior version kept.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useFonts } from "expo-font";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";

const prettifyUsername = (u) =>
  (u || "").replace(/[_\-]+/g, " ").replace(/\b\w/g, (c) => c) || "User";

export default function ShareMenu({
  visible,
  onClose,
  postId,
  thumbnailUrl,   // set by Post.js when sharing a feed video
  isVideo,        // true when the post contains video — forces __feed_video__ content even if no thumbnail
  inviteGroup,
  onSent,
  defaultMessage,
  t,
}) {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const { theme, isDark } = useAlbaTheme();

  const tx = useCallback(
    (key, fallback) => {
      try {
        const v = typeof t === "function" ? t(key) : "";
        return v || fallback;
      } catch {
        return fallback;
      }
    },
    [t]
  );

  const [meId, setMeId] = useState(null);
  const [meUsername, setMeUsername] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [accounts, setAccounts] = useState([]); // menu items (<=6) in recency order
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [message, setMessage] = useState("");

  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);

  const [rowH, setRowH] = useState(0);

  const recentRankRef = useRef({});
  const pinnedRef = useRef(new Set());

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selectedIds.has(a.id)),
    [accounts, selectedIds]
  );
  const isSearching = q.trim().length > 0;

  const shareLink = useMemo(() => {
    if (inviteGroup?.id) {
      return `https://albaappofficial.com/join/group/${inviteGroup.id}`;
    }
    if (postId != null) {
      return isVideo || thumbnailUrl
        ? `https://albaappofficial.com/video/${postId}`
        : `https://albaappofficial.com/post/${postId}`;
    }
    return null;
  }, [inviteGroup, postId, isVideo, thumbnailUrl]);

  const handleCopyLink = useCallback(async () => {
    if (!shareLink) return;
    await Clipboard.setStringAsync(shareLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [shareLink]);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  const safeAddToMenuAndSelect = useCallback((newItem) => {
    if (!newItem?.id) return;

    pinnedRef.current.add(newItem.id);

    setAccounts((prev) => {
      const exists = prev.find((x) => x.id === newItem.id);
      let next = exists
        ? prev.map((x) => (x.id === newItem.id ? { ...x, ...newItem } : x))
        : [newItem, ...prev];

      while (next.length > 6) {
        let worstIdx = -1;
        let worstScore = -1;

        for (let i = 0; i < next.length; i++) {
          const id = next[i]?.id;
          if (!id) continue;

          const isPinned = pinnedRef.current.has(id);
          const rankMap = recentRankRef.current || {};
          const rank = typeof rankMap[id] === "number" ? rankMap[id] : 999999;
          const score = isPinned ? -1 : rank;

          if (score > worstScore) {
            worstScore = score;
            worstIdx = i;
          }
        }

        if (worstIdx === -1 || worstScore === -1) worstIdx = next.length - 1;

        const evicted = next[worstIdx];
        next = next.filter((_, i) => i !== worstIdx);

        if (evicted?.id) {
          setSelectedIds((prevSel) => {
            const ns = new Set(prevSel);
            ns.delete(evicted.id);
            return ns;
          });
          pinnedRef.current.delete(evicted.id);
        }
      }

      return next;
    });

    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(newItem.id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (visible) {
      setMessage(defaultMessage || "");
      setQ("");
      setSearchResults([]);
      setSearchLoading(false);
      pinnedRef.current = new Set();
      setSelectedIds(new Set());
    }
  }, [visible, defaultMessage]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user) return;
        const uid = data.user.id;
        if (!alive) return;
        setMeId(uid);

        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", uid)
          .maybeSingle();

        if (alive) setMeUsername(prof?.username || null);
      } catch (e) {
        console.warn("ShareMenu getUser error", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // recent chats from chat_threads (ordered by last_sent_at)
  // Also includes recently joined groups that have no messages yet
  useEffect(() => {
    let alive = true;
    if (!visible || !meId || !meUsername) return;

    (async () => {
      try {
        setLoadingGrid(true);

        const [{ data: threads, error: tErr }, { data: memberGroups, error: gErr }] =
          await Promise.all([
            supabase
              .from("chat_threads")
              .select("chat_id, is_group, peer_profile_id, last_sent_at")
              .eq("owner_id", meId)
              .order("last_sent_at", { ascending: false, nullsLast: true })
              .limit(6),
            supabase
              .from("groups")
              .select("id, groupname, group_pic_link, updated_at")
              .filter("members", "cs", `{${meUsername}}`)
              .order("updated_at", { ascending: false })
              .limit(12),
          ]);

        if (tErr) throw tErr;
        if (gErr) console.warn("ShareMenu member groups error", gErr);

        console.log("[ShareMenu] meUsername:", meUsername, "threads:", threads?.length, "memberGroups:", memberGroups?.length, memberGroups?.map(g => g.groupname));

        // IDs of groups already represented in threads
        const threadGroupIds = new Set(
          (threads || []).filter((t) => t.is_group).map((t) => String(t.chat_id))
        );

        // Build thread-based items
        const groupChatIds = (threads || []).filter((t) => t.is_group).map((t) => t.chat_id);
        const dmPeerIds    = (threads || []).filter((t) => !t.is_group && t.peer_profile_id).map((t) => t.peer_profile_id);

        const [{ data: groups }, { data: profs }] = await Promise.all([
          groupChatIds.length
            ? supabase.from("groups").select("id, groupname, group_pic_link").in("id", groupChatIds)
            : Promise.resolve({ data: [] }),
          dmPeerIds.length
            ? supabase.from("profiles").select("id, username, name, avatar_url").in("id", dmPeerIds)
            : Promise.resolve({ data: [] }),
        ]);

        const groupsById = {};
        (groups || []).forEach((g) => (groupsById[g.id] = g));
        const profilesById = {};
        (profs || []).forEach((p) => (profilesById[p.id] = p));

        // Items with a sortable timestamp
        const withTs = (threads || [])
          .map((t) => {
            let item;
            if (t.is_group) {
              const g = groupsById[t.chat_id];
              if (!g) return null;
              item = {
                id: String(t.chat_id),
                chatId: t.chat_id,
                isGroup: true,
                handle: g.groupname || tx("group_label", "Group"),
                uri: g.group_pic_link || "https://placehold.co/96x96",
              };
            } else {
              const p = t.peer_profile_id ? profilesById[t.peer_profile_id] : null;
              if (!p) return null;
              const username = p.username || "";
              const displayName = p.name || prettifyUsername(username);
              item = {
                id: String(t.chat_id),
                chatId: t.chat_id,
                isGroup: false,
                username,
                name: displayName,
                handle: username ? `@${username}` : displayName,
                uri: p.avatar_url || "https://placehold.co/96x96",
              };
            }
            return { item, ts: t.last_sent_at ? new Date(t.last_sent_at).getTime() : 0 };
          })
          .filter(Boolean);

        // Member groups with no thread yet
        const extraGroups = (memberGroups || [])
          .filter((g) => !threadGroupIds.has(String(g.id)))
          .map((g) => ({
            item: {
              id: String(g.id),
              chatId: g.id,
              isGroup: true,
              handle: g.groupname || tx("group_label", "Group"),
              uri: g.group_pic_link || "https://placehold.co/96x96",
            },
            ts: g.updated_at ? new Date(g.updated_at).getTime() : 0,
          }));

        console.log("[ShareMenu] extraGroups (no-thread member groups):", extraGroups.length, extraGroups.map(e => e.item.handle));

        // Merge, sort descending by recency, take top 6
        const all = [...withTs, ...extraGroups].sort((a, b) => b.ts - a.ts).slice(0, 6);

        const rankMap = {};
        all.forEach(({ item }, idx) => (rankMap[item.id] = idx));
        recentRankRef.current = rankMap;

        if (alive) setAccounts(all.map(({ item }) => item));
      } catch (e) {
        console.error("ShareMenu load recent chats error", e);
        if (alive) setAccounts([]);
      } finally {
        if (alive) setLoadingGrid(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [visible, meId, meUsername, tx]);

  const handleSearchChange = useCallback(
    async (text) => {
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
          if (meId) profiles = profiles.filter((p) => p.id !== meId);
          profiles = profiles.filter((p) => p.username);
          setSearchResults(profiles);
          return;
        }

        const { data, error } = await supabase.rpc("nearby_profiles", {
          dist: 50000,
          lat: loc.lat,
          long: loc.lng,
          search_term: safeTerm,
        });

        if (error) return setSearchResults([]);

        let profiles = Array.isArray(data) ? data : [];
        if (meId) profiles = profiles.filter((p) => p.id !== meId);
        profiles = profiles.filter((p) => p.username);
        setSearchResults(profiles);
      } finally {
        setSearchLoading(false);
      }
    },
    [ensureLocation, meId]
  );

  const onToggleFromSearch = useCallback(
    (profile) => {
      if (!profile?.id) return;
      const id = profile.id;

      if (selectedIds.has(id)) {
        toggleSelected(id);
        return;
      }

      const username = profile.username || "";
      const displayName = profile.name || prettifyUsername(username);
      const menuItem = {
        id,
        chatId: id,
        isGroup: false,
        username,
        name: displayName,
        handle: username ? `@${username}` : displayName,
        uri: profile.avatar_url || "https://placehold.co/96x96",
      };

      const inMenu = accounts.some((a) => a.id === id);
      if (inMenu) {
        pinnedRef.current.add(id);
        toggleSelected(id);
      } else {
        safeAddToMenuAndSelect(menuItem);
      }
    },
    [accounts, safeAddToMenuAndSelect, selectedIds, toggleSelected]
  );

  const handleSend = useCallback(async () => {
    const targets = selectedAccounts;
    if (!targets.length) return;

    const typed = (message || "").trim();
    const fallback = (defaultMessage || "").trim();
    const finalText = typed || fallback;

    if (!inviteGroup && !postId && !finalText) return;

    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user?.id)
        throw userErr || new Error("Not authenticated");

      const sender_id = userData.user.id;

      const now = new Date();
      const sent_date = now.toISOString().slice(0, 10);
      const sent_time = now.toTimeString().slice(0, 8);

      const rows = [];
      for (const target of targets) {
        const base = {
          chat_id: target.chatId,
          is_group: !!target.isGroup,
          sender_id,
          sender_username: meUsername || "me",
          sent_date,
          sent_time,
        };

        if (inviteGroup) {
          rows.push({
            ...base,
            content: "",
            media_reference: null,
            post_reference: null,
            post_id: null,
            group_id: inviteGroup.id,
          });
        }

        if (postId != null && !inviteGroup) {
          const videoContent = (isVideo || thumbnailUrl)
            ? `__feed_video__:${JSON.stringify({ thumbnailUrl: thumbnailUrl || null })}`
            : "";
          rows.push({
            ...base,
            content: videoContent,
            media_reference: null,
            post_reference: null,
            post_id: postId,
            group_id: null,
          });
        }
        if (finalText) {
          rows.push({
            ...base,
            content: finalText,
            media_reference: null,
            post_reference: null,
            post_id: null,
            group_id: null,
          });
        }
      }

      if (!rows.length) return;

      const { error } = await supabase.from("messages").insert(rows);
      if (error) throw error;

      setMessage("");
      setSelectedIds(new Set());
      pinnedRef.current = new Set();
      onSent?.(rows);
      onClose?.();
    } catch (e) {
      console.warn("ShareMenu send failed:", e?.message || e);
    }
  }, [
    defaultMessage,
    inviteGroup,
    meUsername,
    message,
    onClose,
    onSent,
    postId,
    selectedAccounts,
  ]);

  const handleCancel = useCallback(() => {
    setSelectedIds(new Set());
    setMessage(defaultMessage || "");
    setQ("");
    setSearchResults([]);
    setSearchLoading(false);
    pinnedRef.current = new Set();
    onClose?.();
  }, [defaultMessage, onClose]);

  const inputWrapStyle = useMemo(() => {
    return {
      backgroundColor: isDark ? "#121212" : "#F4F6F9",
      borderColor: isDark ? "#444" : "transparent",
      borderWidth: isDark ? 1 : 0,
    };
  }, [isDark]);

  const inputPlaceholderColor = useMemo(() => {
    return isDark ? "#A0A4AE" : "#9CA3AF";
  }, [isDark]);

  if (!fontsLoaded) return null;

  const dropdownHeight =
    isSearching && rowH > 0
      ? Math.min(6, Math.max(1, searchResults.length || 1)) * rowH
      : undefined;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardWrap}
      >
        <View style={[styles.card, { backgroundColor: theme.gray }]}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* SEARCH */}
            <View style={[styles.searchWrap, inputWrapStyle]}>
              <Feather
                name="search"
                size={18}
                color={isDark ? "#A0A4AE" : "#B8B8B8"}
              />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder={tx("share_search_users_placeholder", "Search users")}
                placeholderTextColor={inputPlaceholderColor}
                value={q}
                onChangeText={handleSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!q && (
                <TouchableOpacity
                  onPress={() => {
                    setQ("");
                    setSearchResults([]);
                    setSearchLoading(false);
                  }}
                  hitSlop={8}
                >
                  <Feather
                    name="x"
                    size={18}
                    color={isDark ? "#A0A4AE" : "#B8B8B8"}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* SEARCH DROPDOWN */}
            {isSearching && (
              <View
                style={[
                  styles.membersList,
                  {
                    borderColor: isDark ? "#444" : theme.border,
                    backgroundColor: theme.card,
                  },
                ]}
              >
                {searchLoading ? (
                  <View style={{ paddingVertical: 12, paddingHorizontal: 8 }}>
                    <Text
                      style={{
                        fontFamily: "Poppins",
                        fontSize: 14,
                        textAlign: "center",
                        color: theme.subtleText || theme.text,
                      }}
                    >
                      {tx("loading_text", "Loading...")}
                    </Text>
                  </View>
                ) : searchResults.length > 0 ? (
                  <ScrollView
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    style={dropdownHeight ? { height: dropdownHeight } : null}
                    contentContainerStyle={{ paddingBottom: 0 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {searchResults.map((item, idx) => {
                      const displayName =
                        item.name || item.username || tx("user_label", "User");
                      const username = item.username || "";
                      const key = item.id?.toString() || username;
                      const checked = selectedIds.has(item.id);
                      const isLast = idx === searchResults.length - 1;

                      return (
                        <TouchableOpacity
                          key={key}
                          style={[
                            styles.memberRow,
                            {
                              borderBottomColor: isLast
                                ? "transparent"
                                : isDark
                                ? "#2D2D2D"
                                : theme.border,
                              borderBottomWidth: isLast
                                ? 0
                                : StyleSheet.hairlineWidth,
                            },
                          ]}
                          activeOpacity={0.85}
                          onPress={() => onToggleFromSearch(item)}
                          onLayout={(e) => {
                            if (!rowH) setRowH(e.nativeEvent.layout.height);
                          }}
                        >
                          {item.avatar_url ? (
                            <Image
                              source={{ uri: item.avatar_url }}
                              style={styles.memberAvatar}
                            />
                          ) : (
                            <View
                              style={[
                                styles.memberAvatar,
                                {
                                  backgroundColor: theme.card,
                                  alignItems: "center",
                                  justifyContent: "center",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.memberInitials,
                                  { color: theme.text },
                                ]}
                              >
                                {displayName[0]?.toUpperCase() || "?"}
                              </Text>
                            </View>
                          )}

                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.memberName,
                                { color: theme.text },
                              ]}
                            >
                              {displayName}
                            </Text>
                            {!!username && (
                              <Text
                                style={[
                                  styles.memberUsername,
                                  { color: theme.subtleText || theme.text },
                                ]}
                              >
                                @{username}
                              </Text>
                            )}
                          </View>

                          <View
                            style={[
                              styles.checkbox,
                              {
                                borderColor: checked
                                  ? "#4EBCFF"
                                  : isDark
                                  ? "#6B7280"
                                  : "#C7D1DD",
                                backgroundColor: checked
                                  ? "#4EBCFF"
                                  : "transparent",
                              },
                            ]}
                          >
                            {checked ? (
                              <Feather name="check" size={16} color="#fff" />
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <View style={{ paddingVertical: 12, paddingHorizontal: 8 }}>
                    <Text
                      style={{
                        fontFamily: "Poppins",
                        fontSize: 14,
                        textAlign: "center",
                        color: theme.subtleText || theme.text,
                      }}
                    >
                      {tx("share_no_matching_users", "No matching users.")}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* COPY LINK */}
            {!!shareLink && (
              <TouchableOpacity
                style={[styles.copyLinkRow, { backgroundColor: isDark ? "#1a1a1a" : "#F4F6F9" }]}
                onPress={handleCopyLink}
                activeOpacity={0.75}
              >
                <Feather name="link" size={18} color="#4EBCFF" style={{ marginRight: 10 }} />
                <Text style={[styles.copyLinkText, { color: theme.text }]}>
                  {copiedLink ? "Copied!" : "Copy link"}
                </Text>
              </TouchableOpacity>
            )}

            {/* MENU GRID (packed left-to-right) */}
            <View style={[styles.grid, { marginTop: shareLink || isSearching ? 12 : 2 }]}>
              {loadingGrid ? (
                <View
                  style={{
                    width: "100%",
                    alignItems: "center",
                    paddingVertical: 12,
                  }}
                >
                  <ActivityIndicator />
                </View>
              ) : accounts.length === 0 ? (
                <Text
                  style={{
                    color: isDark ? "#9CA3AF" : "#7A8594",
                    fontFamily: "Poppins",
                  }}
                >
                  {tx("share_no_recent_chats", "No recent chats.")}
                </Text>
              ) : (
                accounts.map((a) => {
                  const isSel = selectedIds.has(a.id);
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={styles.cell}
                      onPress={() => toggleSelected(a.id)}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: a.uri }} style={styles.avatar} />
                      <Text
                        style={[styles.handle, { color: theme.text }]}
                        numberOfLines={1}
                      >
                        {a.handle}
                      </Text>
                      <View
                        style={[styles.underline, { opacity: isSel ? 1 : 0 }]}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            {/* MESSAGE (styled like search) */}
            <View style={[styles.msgBox, inputWrapStyle]}>
              <TextInput
                style={[styles.msgInput, { color: theme.text }]}
                placeholder={tx("share_message_placeholder", "Message")}
                placeholderTextColor={inputPlaceholderColor}
                value={message}
                onChangeText={setMessage}
                multiline
              />
            </View>
          </ScrollView>

          {/* ACTIONS ALWAYS VISIBLE */}
          <View style={styles.bottomRow}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.sendBtn,
                { opacity: selectedAccounts.length ? 1 : 0.6 },
              ]}
              onPress={handleSend}
              disabled={!selectedAccounts.length}
            >
              <Text style={[styles.actionText, { color: "#fff" }]}>
                {tx("send_button", "Send")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={handleCancel}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: isDark ? "#9CA3AF" : "#8A96A3" },
                ]}
              >
                {tx("cancel_button", "Cancel")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: "78%",
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins", includeFontPadding: false, textAlignVertical: "center", paddingVertical: 0 },

  membersList: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  memberInitials: { fontFamily: "PoppinsBold", fontSize: 16 },
  memberName: { fontFamily: "Poppins", fontSize: 15 },
  memberUsername: { fontFamily: "Poppins", fontSize: 13, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },

  // KEY CHANGE: pack items left-to-right; fixed 3 columns; no "space-between"
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    columnGap: 0,
    rowGap: 18,
  },
  cell: {
    width: "33.3333%",
    alignItems: "center",
  },

  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 6,
    backgroundColor: "#E5ECF4",
  },
  handle: { fontFamily: "PoppinsBold" },
  underline: {
    width: 56,
    height: 3,
    backgroundColor: "#4EBCFF",
    borderRadius: 2,
    marginTop: 6,
  },

  copyLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 4,
  },
  copyLinkText: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
  },

  msgBox: {
    marginTop: 14,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  msgInput: {
    fontSize: 14,
    fontFamily: "Poppins",
    paddingTop: 10,
    paddingBottom: 10,
  },

  bottomRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  actionBtn: {
    height: 42,
    minWidth: 110,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  sendBtn: {
    backgroundColor: "#4EBCFF",
    borderColor: "#4EBCFF",
  },
  cancelBtn: {
    backgroundColor: "#fff",
    borderColor: "#E3E8EE",
  },
  actionText: { fontFamily: "PoppinsBold" },
});
