// screens/PastEventsScreen.js — DROP-IN
// - Uses events.timestamp (lists ONLY events with timestamp < now)
// - Expands ONLY the *unconfirmed* list (inline, like your screenshots)
// - User rows: Name, then @username (black) OR localized "not on Alba yet" (dark grey)
// - Checkbox sits right before the 3-dot button
// - Selection bar (light blue): ONLY "Select all" + "Invite"
// - Invite opens DMUsersModal and sends an InviteMessage (via DMUsersModal messageType="invite")

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";

import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { supabase } from "../lib/supabase";
import DMUsersModal from "../components/DMUsersModal";

/* ------------------- schema ------------------- */
const EVENTS_TABLE = "events";
const EVENTS_COLS =
  "id, title, post_id, group_id, unconfirmed, organizers, attendees_info, timestamp";

const POSTS_TABLE = "posts";
const POSTS_COLS = "id, user";
/* ---------------------------------------------- */

function safeObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}
function safeArr(x) {
  return Array.isArray(x) ? x : [];
}
function fmtTs(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const dd = d.toISOString().slice(0, 10);
    const tt = d.toTimeString().slice(0, 5);
    return `${dd} ${tt}`;
  } catch {
    return String(ts);
  }
}

export default function PastEventsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const targetEventId = route.params?.eventId || null; // current event
  const targetPostId = route.params?.postId || null; // current post
  const targetGroupId = route.params?.groupId || null; // current group chat

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const NOT_ON_ALBA = t("not_on_alba_yet") || "Not on Alba yet";

  const [myUsername, setMyUsername] = useState(null);
  const [events, setEvents] = useState([]);

  // expanded event
  const [openEventId, setOpenEventId] = useState(null);
  const [openEventRow, setOpenEventRow] = useState(null);

  // unconfirmed list (enriched)
  const [unconfirmedUsers, setUnconfirmedUsers] = useState([]);
  const [selected, setSelected] = useState(new Set()); // Set(user.key)

  // 3-dot menu
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuUser, setMenuUser] = useState(null);

  // Invite modal
  const [dmVisible, setDmVisible] = useState(false);
  const [dmUsers, setDmUsers] = useState([]);

  /* ---------------- auth ---------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        const user = data?.user;
        if (error || !user?.id) return;

        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        if (!alive) return;
        setMyUsername(prof?.username || user.user_metadata?.username || user.email || null);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* -------- profiles helper -------- */
  const loadProfilesByUsernames = useCallback(async (usernames) => {
    const list = safeArr(usernames)
      .map((u) => (u == null ? null : String(u).trim()))
      .filter(Boolean);

    if (!list.length) return [];

    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, username, avatar_url")
      .in("username", list);

    if (error) return [];

    const rows = Array.isArray(data) ? data : [];
    const byU = {};
    rows.forEach((r) => {
      byU[String(r.username || "").toLowerCase()] = {
        id: r.id,
        name: r.name || r.username,
        username: r.username,
        avatar_url: r.avatar_url || null,
        isExternal: false,
        key: `u:${r.username}`,
      };
    });

    // usernames missing in profiles => still treat as external-ish, but keep username identifier
    // (we will still show @username)
    list.forEach((u) => {
      const k = String(u).toLowerCase();
      if (!byU[k]) {
        byU[k] = {
          id: `missing:${u}`,
          name: u,
          username: u,
          avatar_url: null,
          isExternal: true,
          key: `missing:${u}`,
        };
      }
    });

    return list.map((u) => byU[String(u).toLowerCase()]).filter(Boolean);
  }, []);

  const buildUsersFromUnconfirmed = useCallback(
    async (eventRow) => {
      const raw = safeArr(eventRow?.unconfirmed);

      const usernames = raw.filter((x) => x != null).map((x) => String(x).trim());
      const profs = await loadProfilesByUsernames(usernames);

      const ai = safeObj(eventRow?.attendees_info);
      const nullNamePool = Object.keys(ai).filter((k) => ai?.[k]?.username == null);
      let nullIdx = 0;

      const nullEntries = raw
        .filter((x) => x == null)
        .map(() => {
          const displayName = nullNamePool[nullIdx] || NOT_ON_ALBA;
          nullIdx += 1;
          const n = nullIdx;
          return {
            id: `ext:${displayName}:${n}`,
            name: displayName,
            username: null,
            avatar_url: null,
            isExternal: true,
            key: `ext:${displayName}:${n}`,
          };
        });

      return [...profs, ...nullEntries];
    },
    [loadProfilesByUsernames, NOT_ON_ALBA]
  );

  /* ---------------- load past events ---------------- */
  const loadPastEvents = useCallback(async () => {
    if (!myUsername) return;

    try {
      const nowIso = new Date().toISOString();

      // A) events where organizers contains me
      const { data: evA } = await supabase
        .from(EVENTS_TABLE)
        .select(EVENTS_COLS)
        .contains("organizers", [myUsername])
        .lt("timestamp", nowIso)
        .order("timestamp", { ascending: false })
        .limit(200);

      // B) fallback by my posts
      const { data: myPosts } = await supabase
        .from(POSTS_TABLE)
        .select(POSTS_COLS)
        .eq("user", myUsername)
        .limit(500);

      const myPostIds = (myPosts || []).map((p) => p.id).filter(Boolean);

      let evB = [];
      if (myPostIds.length) {
        const { data: evRows } = await supabase
          .from(EVENTS_TABLE)
          .select(EVENTS_COLS)
          .in("post_id", myPostIds)
          .lt("timestamp", nowIso)
          .order("timestamp", { ascending: false })
          .limit(200);
        evB = evRows || [];
      }

      const merged = [...(evA || []), ...(evB || [])];
      const seen = new Set();
      const unique = merged.filter((e) => {
        if (!e?.id) return false;
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });

      unique.sort((a, b) => {
        const at = new Date(a.timestamp || 0).getTime() || 0;
        const bt = new Date(b.timestamp || 0).getTime() || 0;
        return bt - at;
      });

      setEvents(unique);

      // if expanded event disappeared, close it
      if (openEventId && !unique.some((e) => e.id === openEventId)) {
        setOpenEventId(null);
        setOpenEventRow(null);
        setUnconfirmedUsers([]);
        setSelected(new Set());
      }
    } catch {}
  }, [myUsername, openEventId]);

  useFocusEffect(
    useCallback(() => {
      loadPastEvents();
    }, [loadPastEvents])
  );

  /* ---------------- expand/collapse ---------------- */
  const toggleOpenEvent = useCallback(
    async (eventRow) => {
      const id = eventRow?.id;
      if (!id) return;

      if (openEventId === id) {
        setOpenEventId(null);
        setOpenEventRow(null);
        setUnconfirmedUsers([]);
        setSelected(new Set());
        return;
      }

      setOpenEventId(id);
      setOpenEventRow(eventRow);
      setSelected(new Set());
      setUnconfirmedUsers([]);

      const users = await buildUsersFromUnconfirmed(eventRow);
      setUnconfirmedUsers(users);
    },
    [openEventId, buildUsersFromUnconfirmed]
  );

  /* ---------------- selection ---------------- */
  const selectedCount = selected.size;

  const toggleSelect = (key) => {
    const k = String(key || "").trim();
    if (!k) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(unconfirmedUsers.map((u) => u.key).filter(Boolean)));
  };

  const openInvite = () => {
    const chosen = unconfirmedUsers.filter((u) => selected.has(u.key));
    // Invite only Alba users (must have username; ignore null-username externals)
    const onlyAlba = chosen.filter((u) => !!u?.username);
    setDmUsers(onlyAlba);
    setDmVisible(true);
  };

  /* ---------------- render row ---------------- */
  const renderUserRow = (user) => {
    const displayName = user?.name || "User";
    const username = user?.username ?? null;
    const isExternal = !username; // null-username external
    const checked = selected.has(user.key);

    // per your request:
    // - if displaying username => black (light mode), theme.text in dark mode
    // - if displaying "not on Alba yet" => dark grey
    const secondaryColor = isExternal
      ? "#6b7280"
      : isDark
      ? theme.text
      : "#000";

    return (
      <View key={user.key} style={[styles.memberRow, { borderBottomColor: theme.border }]}>
        {user.avatar_url && !user.isExternal ? (
          <Image source={{ uri: user.avatar_url }} style={styles.memberAvatar} />
        ) : (
          <View
            style={[
              styles.memberAvatar,
              { backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
            ]}
          >
            <Text style={[styles.memberInitials, { color: theme.text }]}>
              {(displayName || "?")[0]?.toUpperCase() || "?"}
            </Text>
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={[styles.memberName, { color: theme.text }]}>{displayName}</Text>

          {isExternal ? (
            <Text style={[styles.memberUsername, { color: secondaryColor }]}>{NOT_ON_ALBA}</Text>
          ) : (
            <Text style={[styles.memberUsername, { color: secondaryColor }]}>@{username}</Text>
          )}
        </View>

        {/* checkbox (right before 3-dot) */}
        <TouchableOpacity
          onPress={() => toggleSelect(user.key)}
          style={styles.checkboxBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: checked ? "#59A7FF" : theme.card,
                borderColor: checked ? "#59A7FF" : "#C9D4E2",
              },
            ]}
          >
            {checked && <Feather name="check" size={14} color="#fff" />}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.memberMenuButton}
          onPress={() => {
            setMenuUser(user);
            setMenuVisible(true);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Feather name="more-vertical" size={18} color={theme.subtleText || theme.text} />
        </TouchableOpacity>
      </View>
    );
  };

  const SelectionBar = () => {
    if (!selectedCount) return null;
    return (
      <View style={styles.selectionBar}>
        <Text style={styles.selectionText}>{selectedCount} selected</Text>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity style={styles.selectionBtn} onPress={selectAll}>
            <Text style={styles.selectionBtnText}>{t("select_all") || "Select all"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.selectionBtn, styles.selectionPrimary]}
            onPress={openInvite}
          >
            <Text style={[styles.selectionBtnText, { color: "#fff" }]}>
              {t("invite") || "Invite"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (!fontsLoaded) return null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t("past_events") || "Past events"}
          </Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          {events.map((e) => {
            const isOpen = openEventId === e.id;
            return (
              <View
                key={e.id}
                style={[styles.eventCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              >
                <View style={styles.eventLeft}>
                  <View style={styles.iconBox}>
                    <Feather name="clock" size={18} color="#fff" />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.eventTitle, { color: theme.text }]} numberOfLines={1}>
                      {e.title || "Event"}
                    </Text>
                    <Text style={[styles.eventSub, { color: theme.subtleText || theme.text }]}>
                      {fmtTs(e.timestamp)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.seeBtn} onPress={() => toggleOpenEvent(e)}>
                  <Feather name="menu" size={16} color="#fff" />
                  <Text style={styles.seeBtnText}>
                    {isOpen
                      ? t("close_attendees_list") || "Close attendees list"
                      : t("open_attendees_list") || "Open members list"}
                  </Text>
                </TouchableOpacity>

                {/* Inline unconfirmed list ONLY */}
                {isOpen && (
                  <View style={{ marginTop: 10 }}>
                    <SelectionBar />

                    <View
                      style={[
                        styles.membersListInline,
                        { borderColor: theme.border, backgroundColor: theme.card },
                      ]}
                    >
                      <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingBottom: 4 }}>
                        {unconfirmedUsers.map(renderUserRow)}
                      </ScrollView>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {/* 3-dot menu (kept minimal; you can add actions later) */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
        <View style={[styles.menuCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.menuTitle, { color: theme.text }]} numberOfLines={1}>
            {menuUser?.name || ""}
          </Text>

          <TouchableOpacity style={styles.menuItem} onPress={() => setMenuVisible(false)}>
            <Text style={[styles.menuText, { color: theme.text }]}>
              {t("close") || "Close"}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Invite => DMUsersModal sends InviteMessage */}
      <DMUsersModal
        visible={dmVisible}
        onClose={() => setDmVisible(false)}
        users={dmUsers}
        title={t("invite") || "Invite"}
        defaultMessage=""
        inviteGroup={{ id: targetGroupId }}   // ✅ THIS is the InviteMessage row
        allowEmpty={true}                     // ✅ allow invite even with empty note
      />

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: 16 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 4 },
  backButton: { paddingRight: 8, paddingVertical: 4 },
  headerTitle: { flex: 1, fontFamily: "PoppinsBold", fontSize: 18, textAlign: "center" },

  eventCard: { borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 12 },
  eventLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#FF7A7A",
    alignItems: "center",
    justifyContent: "center",
  },
  eventTitle: { fontFamily: "PoppinsBold", fontSize: 14 },
  eventSub: { fontFamily: "Poppins", fontSize: 12, marginTop: 2 },

  seeBtn: {
    alignSelf: "flex-start",
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#59A7FF",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  seeBtnText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#fff" },

  selectionBar: {
    backgroundColor: "#D9EEFF",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectionText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#2F6CA8" },
  selectionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#fff" },
  selectionPrimary: { backgroundColor: "#59A7FF" },
  selectionBtnText: { fontFamily: "PoppinsBold", fontSize: 12, color: "#2F6CA8" },

  membersListInline: {
    borderWidth: 1,
    borderRadius: 14,
    maxHeight: 220,
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

  checkboxBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#C9D4E2",
    alignItems: "center",
    justifyContent: "center",
  },
  memberMenuButton: { paddingHorizontal: 4, paddingVertical: 4 },

  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  menuCard: { position: "absolute", left: 24, right: 24, bottom: 120, borderWidth: 1, borderRadius: 14, padding: 14 },
  menuTitle: { fontFamily: "PoppinsBold", fontSize: 15, marginBottom: 6 },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },
});
