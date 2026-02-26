// screens/EventSettingsScreen.js — DROP-IN
// Adds: "Scan ticket QR" button (admin only) + camera scanner modal
// Flow: scan QR -> fetch tickets by id/qr_payload -> validate event -> mark as used by adding username to events.scanned
// Notes:
// - events.scanned is text[] (usernames). If the scanned ticket holder has no username, we store holder_display as fallback.
// - tickets table is assumed: public.tickets (id uuid, event_id uuid, post_id uuid, owner_id uuid, holder_display text, qr_payload text)

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { CameraView, useCameraPermissions } from "expo-camera";

import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { supabase } from "../lib/supabase";
import DMUsersModal from "../components/DMUsersModal";
import ShareMenu from "../components/ShareMenu";

/* ------------------- schema ------------------- */
const POSTS_TABLE = "posts";
const POSTS_COLS = "id, title, description, date, time, location, author_id, group_id";

const EVENTS_TABLE = "events";
const EVENTS_COLS =
  "id, title, post_id, unconfirmed, ticket_holders, organizers, attendees_info, scanned";

const GROUPS_TABLE = "groups";
const GROUPS_COLS = "id, members, group_admin, groupname, group_desc";

const TICKETS_TABLE = "tickets";
/* ---------------------------------------------- */

function safeObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}
function safeArr(x) {
  return Array.isArray(x) ? x : [];
}
const stripAt = (s) => String(s || "").trim().replace(/^@+/, "");
const uniqCI = (arr) => {
  const out = [];
  const seen = new Set();
  safeArr(arr).forEach((v) => {
    const s = String(v || "").trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
};

// usernames in ticket_holders/unconfirmed -> fetch profiles -> build rows
async function buildUsersFromUsernames(usernames) {
  const list = safeArr(usernames)
    .map((u) => stripAt(u))
    .filter(Boolean);

  if (!list.length) return [];

  const { data: profs, error } = await supabase
    .from("profiles")
    .select("id, username, name, avatar_url")
    .in("username", list);

  if (error) {
    console.warn("[EventSettings] profiles fetch error", error);
    return list.map((u) => ({
      id: `u:${u}`,
      name: u,
      username: u,
      avatar_url: null,
      isExternal: false,
    }));
  }

  const byUsername = new Map(
    (profs || []).map((p) => [String(p.username || "").toLowerCase(), p])
  );

  return list.map((u) => {
    const p = byUsername.get(u.toLowerCase()) || null;
    const fullName = String(p?.name || "").trim();
    return {
      id: p?.id || `u:${u}`,
      name: fullName || u,
      username: p?.username || null,
      avatar_url: p?.avatar_url || null,
      isExternal: !p?.username,
    };
  });
}

export default function EventSettingsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const routeEventId = route.params?.eventId || null;
  const routePostId = route.params?.postId || route.params?.id || null;

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [meId, setMeId] = useState(null);
  const [myUsername, setMyUsername] = useState(null);

  const [model, setModel] = useState(null);
  const eventRow = model?.event || null;
  const postRow = model?.post || null;

  // drafts (for Save)
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const [draftLocation, setDraftLocation] = useState("");

  const [saving, setSaving] = useState(false);

  // lists
  const [ticketUsers, setTicketUsers] = useState([]);
  const [unconfirmedUsers, setUnconfirmedUsers] = useState([]);

  const [selectedTicket, setSelectedTicket] = useState(new Set()); // Set(displayName)
  const [selectedUnconf, setSelectedUnconf] = useState(new Set()); // Set(displayName)

  // 3-dot menu
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuCtx, setMenuCtx] = useState(null); // { listKey, user }

  // DM modal
  const [dmVisible, setDmVisible] = useState(false);
  const [dmUsers, setDmUsers] = useState([]);
  const [dmTitle, setDmTitle] = useState("Message");

  // remove confirm
  const [removeVisible, setRemoveVisible] = useState(false);
  const [removeCtx, setRemoveCtx] = useState(null); // { users:[...] }

  // delete confirm modal
  const [deleteVisible, setDeleteVisible] = useState(false);

  // ShareMenu (Invite users)
  const [shareVisible, setShareVisible] = useState(false);

  // ✅ Scanner
  const [scanVisible, setScanVisible] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastScanValue, setLastScanValue] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);

  const isAdmin = useMemo(() => {
    const orgs = Array.isArray(eventRow?.organizers) ? eventRow.organizers : [];
    if (myUsername && orgs.includes(myUsername)) return true;
    if (meId && postRow?.author_id && postRow.author_id === meId) return true;
    return false;
  }, [eventRow?.organizers, myUsername, postRow?.author_id, meId]);

  const notOnAlbaLabel = t("not_on_alba_yet") || "Not on Alba yet";

  /* ---------------- auth ---------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        const user = data?.user;
        if (error || !user) return;
        if (!alive) return;
        setMeId(user.id);

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

  /* ---------------- load: event + post ---------------- */
  const loadEventModel = useCallback(async () => {
    try {
      console.log("[EventSettings][ROUTE]", { routeEventId, routePostId });

      let ev = null;

      if (routeEventId) {
        const { data, error } = await supabase
          .from(EVENTS_TABLE)
          .select(EVENTS_COLS)
          .eq("id", routeEventId)
          .maybeSingle();
        if (error) console.warn("[EventSettings] load event error", error);
        ev = data || null;
      } else if (routePostId) {
        const { data, error } = await supabase
          .from(EVENTS_TABLE)
          .select(EVENTS_COLS)
          .eq("post_id", routePostId)
          .maybeSingle();
        if (error) console.warn("[EventSettings] load event(by post_id) error", error);
        ev = data || null;
      }

      console.log("[EventSettings][EVENT]", {
        found: !!ev,
        eventId: ev?.id || null,
        post_id: ev?.post_id || null,
        ticket_holders_len: Array.isArray(ev?.ticket_holders) ? ev.ticket_holders.length : null,
        unconfirmed_len: Array.isArray(ev?.unconfirmed) ? ev.unconfirmed.length : null,
        scanned_len: Array.isArray(ev?.scanned) ? ev.scanned.length : null,
        attendees_info_keys: ev?.attendees_info ? Object.keys(ev.attendees_info).slice(0, 6) : null,
      });

      if (!ev?.post_id && !routePostId) {
        setModel(null);
        return;
      }

      const postId = ev?.post_id || routePostId;

      const { data: post, error: pErr } = await supabase
        .from(POSTS_TABLE)
        .select(POSTS_COLS)
        .eq("id", postId)
        .maybeSingle();

      if (pErr) {
        console.warn("[EventSettings] load post error", pErr);
        return;
      }
      if (!post) {
        setModel(null);
        return;
      }

      setModel({ event: ev, post, group: null });
    } catch (e) {
      console.warn("[EventSettings] load unexpected", e);
    }
  }, [routeEventId, routePostId]);

  useFocusEffect(
    useCallback(() => {
      loadEventModel();
    }, [loadEventModel])
  );

  /* ---------------- init drafts when post changes ---------------- */
  const resetDraftsToPost = useCallback(() => {
    setDraftTitle(postRow?.title || "");
    setDraftDesc(postRow?.description || "");
    setDraftDate(postRow?.date || "");
    setDraftTime((postRow?.time || "").toString().slice(0, 5) || "");
    setDraftLocation(postRow?.location || "");
  }, [postRow?.title, postRow?.description, postRow?.date, postRow?.time, postRow?.location]);

  useEffect(() => {
    resetDraftsToPost();
  }, [postRow?.id, resetDraftsToPost]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const ticketHolders = safeArr(eventRow?.ticket_holders); // usernames
      const unconfirmed = safeArr(eventRow?.unconfirmed); // usernames

      const tickets = await buildUsersFromUsernames(ticketHolders);
      const unconf = await buildUsersFromUsernames(unconfirmed);

      if (!alive) return;
      setTicketUsers(tickets);
      setUnconfirmedUsers(unconf);
      setSelectedTicket(new Set());
      setSelectedUnconf(new Set());
    })();

    return () => {
      alive = false;
    };
  }, [eventRow?.id, eventRow?.ticket_holders, eventRow?.unconfirmed]);

  /* ---------------- selection ---------------- */
  const toggleSelect = (listKey, displayName) => {
    const key = String(displayName || "").trim();
    if (!key) return;
    if (listKey === "ticket") {
      setSelectedTicket((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
    } else {
      setSelectedUnconf((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
    }
  };

  const selectAll = (listKey) => {
    if (listKey === "ticket") {
      setSelectedTicket(new Set(ticketUsers.map((u) => u.name).filter(Boolean)));
    } else {
      setSelectedUnconf(new Set(unconfirmedUsers.map((u) => u.name).filter(Boolean)));
    }
  };

  /* ---------------- DM (only Alba users) ---------------- */
  const openDM = (users, title) => {
    const onlyAlba = (users || []).filter((u) => !!u?.username);
    setDmUsers(onlyAlba);
    setDmTitle(title || "Message");
    setDmVisible(true);
  };

  /* ---------------- 3-dot menu ---------------- */
  const openMenu = (listKey, user) => {
    if (!isAdmin) return;
    setMenuCtx({ listKey, user });
    setMenuVisible(true);
  };

  /* ---------------- remove ---------------- */
  const confirmRemove = (users) => {
    if (!isAdmin) return;
    setRemoveCtx({ users: users || [] });
    setRemoveVisible(true);
  };

  const removeUsers = async (users) => {
    const list = Array.isArray(users) ? users : [];
    if (!list.length || !eventRow?.id) return;

    const removeNames = list.map((u) => u?.name).filter(Boolean);
    const removeSet = new Set(removeNames.map((x) => String(x).toLowerCase()));

    const albaUsernames = list.map((u) => u?.username).filter(Boolean);
    const albaSet = new Set(albaUsernames.map((x) => String(x).toLowerCase()));

    try {
      const currentTickets = safeArr(eventRow.ticket_holders); // names
      const currentUnc = safeArr(eventRow.unconfirmed); // names

      const nextTickets = currentTickets.filter((n) => !removeSet.has(String(n).toLowerCase()));
      const nextUnc = currentUnc.filter((n) => !removeSet.has(String(n).toLowerCase()));

      const { error: eErr } = await supabase
        .from(EVENTS_TABLE)
        .update({ ticket_holders: nextTickets, unconfirmed: nextUnc })
        .eq("id", eventRow.id);

      if (eErr) throw eErr;

      if (postRow?.group_id && albaSet.size > 0) {
        const { data: g, error: gErr } = await supabase
          .from(GROUPS_TABLE)
          .select("id, members")
          .eq("id", postRow.group_id)
          .maybeSingle();

        if (!gErr && g?.id) {
          const curMembers = Array.isArray(g.members) ? g.members : [];
          const nextMembers = curMembers.filter((u) => !albaSet.has(String(u).toLowerCase()));
          await supabase.from(GROUPS_TABLE).update({ members: nextMembers }).eq("id", g.id);
        }
      }

      setModel((prev) => {
        if (!prev?.event) return prev;
        return {
          ...prev,
          event: { ...prev.event, ticket_holders: nextTickets, unconfirmed: nextUnc },
        };
      });

      setSelectedTicket(new Set());
      setSelectedUnconf(new Set());
    } catch (e) {
      console.warn("[EventSettings] removeUsers error", e);
      Alert.alert("Error", "Could not remove user(s).");
    }
  };

  /* ---------------- Save logic ---------------- */
  const isDirty = useMemo(() => {
    const baseTitle = postRow?.title || "";
    const baseDesc = postRow?.description || "";
    const baseDate = postRow?.date || "";
    const baseTime = (postRow?.time || "").toString().slice(0, 5) || "";
    const baseLoc = postRow?.location || "";

    return (
      (draftTitle || "") !== baseTitle ||
      (draftDesc || "") !== baseDesc ||
      (draftDate || "") !== baseDate ||
      (draftTime || "") !== baseTime ||
      (draftLocation || "") !== baseLoc
    );
  }, [postRow, draftTitle, draftDesc, draftDate, draftTime, draftLocation]);

  const onSave = async () => {
    if (!postRow?.id) return;
    setSaving(true);
    try {
      const baseTitle = postRow?.title || "";
      const baseDesc = postRow?.description || "";
      const baseDate = postRow?.date || "";
      const baseTime = (postRow?.time || "").toString().slice(0, 5) || "";
      const baseLoc = postRow?.location || "";

      const titleChanged = (draftTitle || "") !== baseTitle;
      const descChanged = (draftDesc || "") !== baseDesc;
      const dateChanged = (draftDate || "") !== baseDate;
      const timeChanged = (draftTime || "") !== baseTime;
      const locChanged = (draftLocation || "") !== baseLoc;

      const postPatch = {};
      if (titleChanged) postPatch.title = draftTitle;
      if (descChanged) postPatch.description = draftDesc;
      if (dateChanged) postPatch.date = draftDate;
      if (timeChanged) postPatch.time = draftTime;
      if (locChanged) postPatch.location = draftLocation;

      if (Object.keys(postPatch).length) {
        const { error } = await supabase.from(POSTS_TABLE).update(postPatch).eq("id", postRow.id);
        if (error) throw error;
      }

      if ((titleChanged || descChanged) && postRow?.group_id) {
        const groupPatch = {};
        if (titleChanged) groupPatch.groupname = draftTitle;
        if (descChanged) groupPatch.group_desc = draftDesc;

        const { error } = await supabase.from(GROUPS_TABLE).update(groupPatch).eq("id", postRow.group_id);
        if (error) throw error;
      }

      setModel((prev) => {
        if (!prev?.post) return prev;
        return { ...prev, post: { ...prev.post, ...postPatch } };
      });
    } catch (e) {
      console.warn("[EventSettings] save error", e);
      Alert.alert("Error", "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const onCancelEdits = () => {
    resetDraftsToPost();
  };

  /* ---------------- Invite users / PastEvents nav ---------------- */
  const onInviteFromPrevious = () => {
    if (!postRow?.id) return;
    navigation.navigate("PastEvents", {
      postId: postRow.id,
      eventId: eventRow?.id || null,
      groupId: postRow?.group_id || null,
    });
  };

  const inviteGroupPayload = useMemo(() => {
    if (!postRow?.group_id) return null;
    return { id: postRow.group_id };
  }, [postRow?.group_id]);

  const defaultInviteMessage = useMemo(() => {
    const title = postRow?.title || "an event";
    return `Join ${title}`;
  }, [postRow?.title]);

  /* ---------------- Delete event ---------------- */
  const deleteEvent = async () => {
    try {
      const postIdToDelete = postRow?.id || eventRow?.post_id || routePostId;
      if (!postIdToDelete) return;

      if (eventRow?.id) {
        const { error: eErr } = await supabase.from(EVENTS_TABLE).delete().eq("id", eventRow.id);
        if (eErr) throw eErr;
      } else {
        const { error: eErr } = await supabase.from(EVENTS_TABLE).delete().eq("post_id", postIdToDelete);
        if (eErr) throw eErr;
      }

      const { error: pErr } = await supabase.from(POSTS_TABLE).delete().eq("id", postIdToDelete);
      if (pErr) throw pErr;

      setDeleteVisible(false);
      navigation.goBack();
    } catch (e) {
      console.warn("[EventSettings] delete error", e);
      Alert.alert("Error", "Could not delete event.");
    }
  };

  /* ---------------- ✅ QR scan -> validate -> mark used ---------------- */
  const openScanner = async () => {
    if (!isAdmin) return;
    if (!eventRow?.id) {
      Alert.alert("Missing event", "No event loaded.");
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res?.granted) {
        Alert.alert("Camera permission", "Camera permission is required to scan tickets.");
        return;
      }
    }
    scanLockRef.current = false;
    setLastScanValue(null);
    setScanVisible(true);
  };

  const closeScanner = () => {
    setScanVisible(false);
    setScanBusy(false);
    scanLockRef.current = false;
  };

  const resolveUsernameFromDisplayName = (displayName) => {
    const info = safeObj(eventRow?.attendees_info);
    const rec = info?.[String(displayName || "")];
    const uname = rec?.username ? stripAt(rec.username) : null;
    return uname || null;
  };

  const markScanned = async ({ holderDisplay }) => {
    if (!eventRow?.id) return;

    const uname = resolveUsernameFromDisplayName(holderDisplay);
    const toStore = uname || String(holderDisplay || "").trim();
    if (!toStore) throw new Error("Missing holder.");

    const current = safeArr(eventRow?.scanned);
    const exists = current.some((x) => String(x).toLowerCase() === String(toStore).toLowerCase());
    if (exists) {
      Alert.alert("Already used", "This ticket was already scanned.");
      return { already: true, stored: toStore };
    }

    const next = uniqCI([...current, toStore]);

    const { error } = await supabase
      .from(EVENTS_TABLE)
      .update({ scanned: next })
      .eq("id", eventRow.id);

    if (error) throw error;

    // update local model
    setModel((prev) => {
      if (!prev?.event) return prev;
      return { ...prev, event: { ...prev.event, scanned: next } };
    });

    return { already: false, stored: toStore };
  };

  const handleBarcodeScanned = async ({ data }) => {
    const raw = String(data || "").trim();
    if (!raw) return;

    // hard lock to prevent double firing
    if (scanLockRef.current) return;
    scanLockRef.current = true;

    setLastScanValue(raw);
    setScanBusy(true);

    try {
      if (!eventRow?.id) throw new Error("Missing event.");

      // 1) find ticket by (id) OR (qr_payload)
      // If your qr_payload == ticket.id, the first query will work.
      let ticket = null;

      {
        const { data: row, error } = await supabase
          .from(TICKETS_TABLE)
          .select("id, event_id, post_id, holder_display, qr_payload")
          .eq("id", raw)
          .maybeSingle();
        if (error) {
          // ignore & fallback
        }
        if (row?.id) ticket = row;
      }

      if (!ticket) {
        const { data: row2 } = await supabase
          .from(TICKETS_TABLE)
          .select("id, event_id, post_id, holder_display, qr_payload")
          .eq("qr_payload", raw)
          .maybeSingle();
        if (row2?.id) ticket = row2;
      }

      if (!ticket?.id) {
        Alert.alert("Invalid ticket", "No ticket found for this QR code.");
        return;
      }

      // 2) validate ticket belongs to this event
      if (String(ticket.event_id) !== String(eventRow.id)) {
        Alert.alert("Wrong event", "This ticket is for a different event.");
        return;
      }

      // 3) mark as scanned (events.scanned stores username if available)
      const holderDisplay = String(ticket.holder_display || "").trim();
      const result = await markScanned({ holderDisplay });

      if (!result?.already) {
        Alert.alert("Success", `Ticket validated for: ${result.stored}`);
      }
    } catch (e) {
      console.warn("[ScanTicket] error", e?.message || e);
      Alert.alert("Error", e?.message || "Could not validate ticket.");
    } finally {
      setScanBusy(false);
      // allow scanning again after a short cooldown
      setTimeout(() => {
        scanLockRef.current = false;
      }, 900);
    }
  };

  /* ---------------- UI pieces ---------------- */
  const SelectionBar = ({ listKey, selectedCount }) => {
    if (!selectedCount) return null;
    return (
      <View style={styles.selectionBar}>
        <Text style={styles.selectionText}>{selectedCount} selected</Text>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity style={styles.selectionBtn} onPress={() => selectAll(listKey)}>
            <Text style={styles.selectionBtnText}>Select all</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.selectionBtn, styles.selectionPrimary]}
            onPress={() => {
              const users =
                listKey === "ticket"
                  ? ticketUsers.filter((u) => selectedTicket.has(u.name) && !!u?.username)
                  : unconfirmedUsers.filter((u) => selectedUnconf.has(u.name) && !!u?.username);
              openDM(users, "Message");
            }}
          >
            <Text style={[styles.selectionBtnText, { color: "#fff" }]}>DM users</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.selectionBtn, styles.selectionDanger]}
            onPress={() => {
              const users =
                listKey === "ticket"
                  ? ticketUsers.filter((u) => selectedTicket.has(u.name))
                  : unconfirmedUsers.filter((u) => selectedUnconf.has(u.name));
              confirmRemove(users);
            }}
          >
            <Text style={[styles.selectionBtnText, { color: "#fff" }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderUserRow = (listKey, user, selectedSet) => {
    const displayName = user?.name || "User";
    const username = user?.username ?? null;
    const isExternal = !username;
    const checked = selectedSet.has(displayName);
    const usernameColor = isExternal ? "#8c97a8" : theme.text;

    return (
      <View key={user.id?.toString() || displayName} style={[styles.memberRow, { borderBottomColor: theme.border }]}>
        {user.avatar_url && !isExternal ? (
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
          <Text style={[styles.memberUsername, { color: usernameColor }]}>
            {isExternal ? notOnAlbaLabel : `@${username}`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => toggleSelect(listKey, displayName)}
          style={styles.checkboxBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <View style={[styles.checkbox, checked && { backgroundColor: "#59A7FF", borderColor: "#59A7FF" }]}>
            {checked && <Feather name="check" size={14} color="#fff" />}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.memberMenuButton, { opacity: isAdmin ? 1 : 0.35 }]}
          onPress={() => openMenu(listKey, user)}
          disabled={!isAdmin}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Feather name="more-vertical" size={18} color={theme.subtleText || theme.text} />
        </TouchableOpacity>
      </View>
    );
  };

  const ticketSelectedCount = selectedTicket.size;
  const unconfSelectedCount = selectedUnconf.size;

  if (!fontsLoaded) return null;

  const scannedCount = safeArr(eventRow?.scanned).length;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t("event_settings_title") || "Event Settings"}
          </Text>
          <View style={{ width: 32 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
            {/* Change title/description */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Change title</Text>
            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder={postRow?.title || "Event title"}
                placeholderTextColor={theme.subtleText || "#8c97a8"}
                style={[styles.input, { color: theme.text }]}
              />
            </View>

            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 10 }]}>Change description</Text>
            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={draftDesc}
                onChangeText={setDraftDesc}
                placeholder={postRow?.description || "Event description"}
                placeholderTextColor={theme.subtleText || "#8c97a8"}
                style={[styles.input, { color: theme.text, height: 90 }]}
                multiline
              />
            </View>

            {/* Date/time */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t("change_date_time") || "Change date and time"}
            </Text>

            <View style={styles.dateTimeRow}>
              <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <TextInput
                  value={draftDate}
                  onChangeText={setDraftDate}
                  placeholder={postRow?.date || "YYYY-MM-DD"}
                  placeholderTextColor={theme.subtleText || "#8c97a8"}
                  style={[styles.pillInput, { color: theme.text }]}
                />
              </View>

              <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <TextInput
                  value={draftTime}
                  onChangeText={setDraftTime}
                  placeholder={(postRow?.time || "").toString().slice(0, 5) || "HH:MM"}
                  placeholderTextColor={theme.subtleText || "#8c97a8"}
                  style={[styles.pillInput, { color: theme.text }]}
                />
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 10 }]}>
              {t("change_location") || "Change location"}
            </Text>
            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={draftLocation}
                onChangeText={setDraftLocation}
                placeholder={postRow?.location || "Location"}
                placeholderTextColor={theme.subtleText || "#8c97a8"}
                style={[styles.input, { color: theme.text }]}
              />
            </View>

            {/* Save + Cancel (only when dirty) */}
            {isDirty && (
              <View style={styles.saveRow}>
                <TouchableOpacity
                  style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={onSave}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.cancelEditsBtn,
                    { backgroundColor: isDark ? "#111827" : "#EAF5FF", borderColor: theme.border },
                  ]}
                  onPress={onCancelEdits}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.cancelEditsText, { color: theme.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ✅ Scanner button */}
            <View style={{ marginTop: 14 }}>
              <TouchableOpacity
                style={[
                  styles.scanBtn,
                  { opacity: isAdmin ? 1 : 0.45, backgroundColor: "#6C63FF" },
                ]}
                onPress={openScanner}
                disabled={!isAdmin}
                activeOpacity={0.9}
              >
                <Feather name="camera" size={16} color="#fff" />
                <Text style={styles.scanBtnText}>Scan ticket QR</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.scanMetaText}>{scannedCount} scanned</Text>
              </TouchableOpacity>
            </View>

            {/* Ticket holders */}
            <View style={styles.listHeaderRow}>
              <Text style={[styles.listTitle, { color: theme.text }]}>{t("ticket_holders") || "Ticket holders"}</Text>
              <Text style={[styles.listCount, { color: theme.subtleText || theme.text }]}>{ticketUsers.length}</Text>
            </View>

            <SelectionBar listKey="ticket" selectedCount={ticketSelectedCount} />

            <View style={[styles.membersList, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingBottom: 4 }}>
                {ticketUsers.map((u) => renderUserRow("ticket", u, selectedTicket))}
              </ScrollView>
            </View>

            <TouchableOpacity
              style={styles.dmWholeBtn}
              onPress={() => openDM(ticketUsers.filter((u) => !!u?.username), "DM whole list")}
            >
              <Feather name="message-circle" size={15} color="#fff" />
              <Text style={styles.dmWholeText}>{t("dm_whole_list") || "DM whole list"}</Text>
            </TouchableOpacity>

            {/* Unconfirmed */}
            <View style={[styles.listHeaderRow, { marginTop: 16 }]}>
              <Text style={[styles.listTitle, { color: theme.text }]}>{t("unconfirmed") || "Unconfirmed"}</Text>
              <Text style={[styles.listCount, { color: theme.subtleText || theme.text }]}>{unconfirmedUsers.length}</Text>
            </View>

            <SelectionBar listKey="unconf" selectedCount={unconfSelectedCount} />

            <View style={[styles.membersList, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingBottom: 4 }}>
                {unconfirmedUsers.map((u) => renderUserRow("unconf", u, selectedUnconf))}
              </ScrollView>
            </View>

            <TouchableOpacity
              style={styles.dmWholeBtn}
              onPress={() => openDM(unconfirmedUsers.filter((u) => !!u?.username), "DM whole list")}
            >
              <Feather name="message-circle" size={15} color="#fff" />
              <Text style={styles.dmWholeText}>{t("dm_whole_list") || "DM whole list"}</Text>
            </TouchableOpacity>

            {/* Invite from previous */}
            <TouchableOpacity style={[styles.outlineButton, { marginTop: 14 }]} onPress={onInviteFromPrevious}>
              <Text style={styles.outlineButtonText}>{t("invite_previous_event") || "Invite users from previous event"}</Text>
            </TouchableOpacity>

            {/* Invite users -> ShareMenu */}
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                if (!inviteGroupPayload) {
                  Alert.alert("Missing group", "This event has no group chat to invite to.");
                  return;
                }
                setShareVisible(true);
              }}
            >
              <Text style={styles.primaryButtonText}>{t("invite_users") || "Invite users"}</Text>
            </TouchableOpacity>

            {/* Delete event -> modal */}
            <TouchableOpacity style={styles.deleteButton} onPress={() => setDeleteVisible(true)}>
              <Text style={styles.deleteButtonText}>{t("delete_event") || "Delete event"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ShareMenu for invites */}
      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        inviteGroup={inviteGroupPayload}
        postId={null}
        defaultMessage={defaultInviteMessage}
        onSent={() => {}}
      />

      {/* ✅ Scanner modal */}
      <Modal visible={scanVisible} transparent animationType="slide" onRequestClose={closeScanner}>
        <View style={styles.scanOverlay}>
          <View style={[styles.scanCard, { backgroundColor: isDark ? "#10131a" : "#fff" }]}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: isDark ? "#fff" : "#111" }]}>Scan ticket</Text>
              <TouchableOpacity onPress={closeScanner} hitSlop={10}>
                <Feather name="x" size={22} color={isDark ? "#fff" : "#111"} />
              </TouchableOpacity>
            </View>

            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                onBarcodeScanned={scanBusy ? undefined : handleBarcodeScanned}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              />
              <View style={styles.scanFrame} />

              {scanBusy && (
                <View style={styles.scanBusy}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.scanBusyText}>Validating…</Text>
                </View>
              )}
            </View>

            <Text style={[styles.scanHint, { color: isDark ? "#cfd6e6" : "#4a5568" }]}>
              Point the camera at the QR code.
            </Text>

            {!!lastScanValue && (
              <Text style={[styles.scanSmall, { color: isDark ? "#9aa7c0" : "#718096" }]} numberOfLines={1}>
                {lastScanValue}
              </Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete confirm modal (Alba aesthetics) */}
      <Modal visible={deleteVisible} transparent animationType="fade" onRequestClose={() => setDeleteVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setDeleteVisible(false)} />
        <View style={[styles.deleteCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.deleteTitle, { color: theme.text }]}>
            {t("delete_event_confirm") || "Are you sure you want to delete this event?"}
          </Text>

          <View style={styles.deleteRow}>
            <TouchableOpacity style={[styles.deleteChoice, { backgroundColor: "#ff4d4f" }]} onPress={deleteEvent} activeOpacity={0.9}>
              <Text style={styles.deleteChoiceText}>Yes</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#D9EEFF" }]}
              onPress={() => setDeleteVisible(false)}
              activeOpacity={0.9}
            >
              <Text style={[styles.deleteChoiceText, { color: "#2F6CA8" }]}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 3-dot menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
        <View style={[styles.menuCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.menuTitle, { color: theme.text }]} numberOfLines={1}>
            {menuCtx?.user?.name || ""}
          </Text>

          {!!menuCtx?.user?.username && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const user = menuCtx?.user;
                setMenuVisible(false);
                if (user) openDM([user], "DM user");
              }}
            >
              <Text style={[styles.menuText, { color: theme.text }]}>DM user</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              const user = menuCtx?.user;
              setMenuVisible(false);
              if (user) confirmRemove([user]);
            }}
          >
            <Text style={[styles.menuText, { color: "#ff4d4f", fontFamily: "PoppinsBold" }]}>Remove</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, { marginTop: 6 }]} onPress={() => setMenuVisible(false)}>
            <Text style={[styles.menuText, { color: theme.subtleText || theme.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Remove confirm */}
      <Modal visible={removeVisible} transparent animationType="fade" onRequestClose={() => setRemoveVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setRemoveVisible(false)} />
        <View style={[styles.deleteCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.deleteTitle, { color: theme.text }]}>
            {t("remove_user_confirm") || "Are you sure you want to remove this user?"}
          </Text>

          <View style={styles.deleteRow}>
            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#ff4d4f" }]}
              onPress={async () => {
                const users = removeCtx?.users || [];
                setRemoveVisible(false);
                setRemoveCtx(null);
                await removeUsers(users);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.deleteChoiceText}>Yes</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.deleteChoice, { backgroundColor: "#D9EEFF" }]} onPress={() => setRemoveVisible(false)} activeOpacity={0.9}>
              <Text style={[styles.deleteChoiceText, { color: "#2F6CA8" }]}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DMUsersModal visible={dmVisible} onClose={() => setDmVisible(false)} users={dmUsers} title={dmTitle} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: 16 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 4 },
  backButton: { paddingRight: 8, paddingVertical: 4 },
  headerTitle: { flex: 1, fontFamily: "PoppinsBold", fontSize: 18, textAlign: "center" },

  sectionTitle: { fontFamily: "PoppinsBold", fontSize: 14, marginTop: 16, marginBottom: 8 },

  inputWrap: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input: { fontFamily: "Poppins", fontSize: 14 },

  dateTimeRow: { flexDirection: "row", gap: 12 },
  pill: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pillInput: { fontFamily: "Poppins", fontSize: 14 },

  saveRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 12 },
  saveBtn: { backgroundColor: "#59A7FF", paddingVertical: 10, paddingHorizontal: 26, borderRadius: 10 },
  saveBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },
  cancelEditsBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1 },
  cancelEditsText: { fontFamily: "PoppinsBold", fontSize: 14 },

  // ✅ scan button
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  scanBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },
  scanMetaText: { fontFamily: "Poppins", fontSize: 12, color: "#efeefe" },

  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 2,
    alignItems: "center",
  },
  listTitle: { fontFamily: "PoppinsBold", fontSize: 14 },
  listCount: { fontFamily: "Poppins", fontSize: 14 },

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
  selectionDanger: { backgroundColor: "#ff4d4f" },
  selectionBtnText: { fontFamily: "PoppinsBold", fontSize: 12, color: "#2F6CA8" },

  membersList: { borderWidth: 1, borderRadius: 14, maxHeight: 190, overflow: "hidden" },

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

  dmWholeBtn: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#59A7FF",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 10,
  },
  dmWholeText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#fff" },

  outlineButton: {
    borderWidth: 1,
    borderColor: "#59A7FF",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
    marginTop: 6,
  },
  outlineButtonText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#59A7FF" },

  primaryButton: { borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#59A7FF", marginTop: 12 },
  primaryButtonText: { fontFamily: "PoppinsBold", fontSize: 15, color: "#fff" },

  deleteButton: { borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#ff4d4f", marginTop: 12, marginBottom: 6 },
  deleteButtonText: { fontFamily: "PoppinsBold", fontSize: 15, color: "#fff" },

  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  menuCard: { position: "absolute", left: 24, right: 24, bottom: 120, borderWidth: 1, borderRadius: 14, padding: 14 },
  menuTitle: { fontFamily: "PoppinsBold", fontSize: 15, marginBottom: 6 },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },

  deleteCard: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "50%",
    transform: [{ translateY: -90 }],
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  deleteTitle: { fontFamily: "PoppinsBold", fontSize: 14, textAlign: "center" },
  deleteRow: { flexDirection: "row", gap: 12, marginTop: 14, justifyContent: "center" },
  deleteChoice: { minWidth: 110, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, alignItems: "center" },
  deleteChoiceText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  // ✅ scanner modal styles
  scanOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  scanCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 14,
    paddingBottom: 18,
  },
  scanHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  scanTitle: { fontFamily: "PoppinsBold", fontSize: 16 },
  cameraWrap: { height: 360, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
  scanFrame: {
    position: "absolute",
    left: 34,
    right: 34,
    top: 60,
    bottom: 60,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.75)",
    borderRadius: 14,
  },
  scanBusy: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  scanBusyText: { color: "#fff", fontFamily: "PoppinsBold" },
  scanHint: { marginTop: 10, fontFamily: "Poppins", fontSize: 13, textAlign: "center" },
  scanSmall: { marginTop: 6, fontFamily: "Poppins", fontSize: 12, textAlign: "center" },
});
