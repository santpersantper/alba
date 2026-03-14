// screens/MyTicketsScreen.js — DROP-IN
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useFonts } from "expo-font";
import QRCode from "react-native-qrcode-svg";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const { width: SCREEN_W } = Dimensions.get("window");

const PROFILES_TABLE = "profiles";
const EVENTS_TABLE = "events";
const POSTS_TABLE = "posts";
const TICKETS_TABLE = "tickets";

const cleanUsername = (v) =>
  String(v || "").trim().replace(/^@+/, "").replace(/\s+/g, "");

const formatMonDD = (dateLike) => {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  });
};

const isTodayOrFuture = (dateLike) => {
  if (!dateLike) return true;
  const d = new Date(dateLike);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d >= today;
};

export default function MyTicketsScreen({ navigation }) {
  const { theme } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [loading, setLoading] = useState(true);
  const [eventPosts, setEventPosts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [collapsed, setCollapsed] = useState({}); // true = hidden
  const [myUid, setMyUid] = useState(null);
  const [myUsername, setMyUsername] = useState(null);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelEventId, setCancelEventId] = useState(null);
  const [cancelError, setCancelError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleteTicketModalVisible, setDeleteTicketModalVisible] = useState(false);
  const [deleteTicketId, setDeleteTicketId] = useState(null);
  const [deleteTicketEventId, setDeleteTicketEventId] = useState(null);
  const [deletingTicket, setDeletingTicket] = useState(false);
  const [deleteTicketError, setDeleteTicketError] = useState(null);
  const formatHM = (t) => (t ? String(t).slice(0, 5) : null);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;

      setMyUid(uid);

      const { data: prof } = await supabase
        .from(PROFILES_TABLE)
        .select("username")
        .eq("id", uid)
        .maybeSingle();

      const uname = cleanUsername(prof?.username);
      setMyUsername(uname);

      // Source of truth: tickets owned by this user (works even if ticket_holders is stale)
      const { data: myTickets } = await supabase
        .from(TICKETS_TABLE)
        .select("id, event_id, product_type, qr_payload, holder_display, created_at")
        .eq("owner_id", uid)
        .order("created_at", { ascending: false });

      const eventIds = [...new Set((myTickets || []).map((t) => t.event_id))].filter(Boolean);

      if (!eventIds.length) {
        setEventPosts([]);
        setTickets([]);
        return;
      }

      const { data: evs } = await supabase
        .from(EVENTS_TABLE)
        .select("id, post_id")
        .in("id", eventIds);

      const postIds = (evs || []).map((e) => e.post_id).filter(Boolean);
      let postsById = {};
      if (postIds.length) {
        const { data: ps } = await supabase
          .from(POSTS_TABLE)
          .select("id, title, date, time, location")
          .in("id", postIds);
        (ps || []).forEach((p) => (postsById[p.id] = p));
      }

      const evsById = {};
      (evs || []).forEach((e) => (evsById[e.id] = e));

      const merged = eventIds
        .map((eventId) => {
          const ev = evsById[eventId];
          if (!ev) return null;
          const p = postsById[ev.post_id] || {};
          return {
            event_id: eventId,
            title: p.title || "Event",
            date: p.date,
            time: p.time,
            location: p.location,
          };
        })
        .filter(Boolean)
        .filter((e) => isTodayOrFuture(e.date));

      const initialCollapsed = {};
      merged.forEach((e) => (initialCollapsed[e.event_id] = true));

      setCollapsed(initialCollapsed);
      setEventPosts(merged);
      setTickets(myTickets || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelRegistration = useCallback((eventId) => {
    setCancelEventId(eventId);
    setCancelError(null);
    setCancelModalVisible(true);
  }, []);

  const confirmCancel = useCallback(async () => {
    if (!cancelEventId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      // Single SECURITY DEFINER RPC — deletes tickets and cleans events.ticket_holders
      // and events.attendees_info atomically, bypassing RLS for non-owners.
      const { error } = await supabase.rpc("cancel_ticket_registration", {
        p_event_id: cancelEventId,
        p_username: myUsername || null,
      });
      if (error) throw error;

      setEventPosts((prev) => prev.filter((e) => e.event_id !== cancelEventId));
      setTickets((prev) => prev.filter((tk) => tk.event_id !== cancelEventId));
      setCancelModalVisible(false);
      setCancelEventId(null);
    } catch (e) {
      console.warn("confirmCancel error:", e?.message ?? e);
      setCancelError("Could not cancel registration. Please try again.");
    } finally {
      setCancelling(false);
    }
  }, [cancelEventId, myUsername]);

  const openDeleteTicket = useCallback((ticketId, eventId) => {
    setDeleteTicketId(ticketId);
    setDeleteTicketEventId(eventId);
    setDeleteTicketError(null);
    setDeleteTicketModalVisible(true);
  }, []);

  const confirmDeleteTicket = useCallback(async () => {
    if (!deleteTicketId || !deleteTicketEventId) return;
    setDeletingTicket(true);
    setDeleteTicketError(null);
    try {
      const { error } = await supabase.rpc("delete_single_ticket", {
        p_ticket_id: deleteTicketId,
        p_event_id: deleteTicketEventId,
        p_purchased_by: myUsername || null,
      });
      if (error) throw error;

      const removedId = deleteTicketId;
      const removedEventId = deleteTicketEventId;

      setTickets((prev) => {
        const next = prev.filter((tk) => tk.id !== removedId);
        const stillHasTickets = next.some((tk) => tk.event_id === removedEventId);
        if (!stillHasTickets) {
          setEventPosts((ep) => ep.filter((e) => e.event_id !== removedEventId));
        }
        return next;
      });

      setDeleteTicketModalVisible(false);
      setDeleteTicketId(null);
      setDeleteTicketEventId(null);
    } catch (e) {
      console.warn("confirmDeleteTicket error:", e?.message ?? e);
      setDeleteTicketError("Could not delete ticket. Please try again.");
    } finally {
      setDeletingTicket(false);
    }
  }, [deleteTicketId, deleteTicketEventId, myUsername]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ticketsByEvent = useMemo(() => {
    const map = {};
    tickets.forEach((t) => {
      if (!map[t.event_id]) map[t.event_id] = [];
      map[t.event_id].push(t);
    });
    return map;
  }, [tickets]);

  if (!fontsLoaded) return null;

  return (
    <ThemedView style={styles.screen}>
      {/* HEADER — identical behavior to ChatListScreen */}
      <SafeAreaView edges={["top"]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={8}
          >
            <Feather name="chevron-left" size={26} color='white' />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>
            {t("my_tickets_title") || "My tickets"}
          </Text>

          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {eventPosts.map((ev) => {
            const list = ticketsByEvent[ev.event_id] || [];
            const subtitle = [formatMonDD(ev.date), formatHM(ev.time), ev.location]
              .filter(Boolean)
              .join(", ");
            const isCollapsed = collapsed[ev.event_id];

            return (
              <View key={ev.event_id} style={styles.card}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{ev.title}</Text>

                  <TouchableOpacity
                    onPress={() => cancelRegistration(ev.event_id)}
                    style={[styles.backBtn, { marginRight: 6 }]}
                    hitSlop={8}
                  >
                    <Feather name="x" size={20} color="white" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() =>
                      setCollapsed((p) => ({
                        ...p,
                        [ev.event_id]: !p[ev.event_id],
                      }))
                    }
                    style={styles.backBtn}
                    hitSlop={8}
                  >
                    <Feather
                      name={isCollapsed ? "chevron-down" : "chevron-up"}
                      size={22}
                      color='white'
                    />
                  </TouchableOpacity>
                </View>

                {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}

                {!isCollapsed &&
                  (list.length ? (
                    list.map((tk) => {
                      const label = [
                        tk.product_type,
                        tk.holder_display ? `@${tk.holder_display}` : null,
                      ]
                        .filter(Boolean)
                        .join(" — ");
                      return (
                        <View key={tk.id} style={styles.qrWrap}>
                          <View style={styles.ticketLabelRow}>
                            {!!label && (
                              <Text style={styles.ticketType}>{label}</Text>
                            )}
                            <TouchableOpacity
                              onPress={() => openDeleteTicket(tk.id, tk.event_id)}
                              style={styles.ticketDeleteBtn}
                              hitSlop={8}
                            >
                              <Feather name="x" size={16} color="white" />
                            </TouchableOpacity>
                          </View>
                          <View style={styles.qrBox}>
                            <QRCode
                              value={String(tk.qr_payload || tk.id)}
                              size={SCREEN_W - 64}
                            />
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.emptySmall}>
                      {t("no_qr_found") || "No QR found"}
                    </Text>
                  ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={deleteTicketModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteTicketModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.cancelCard}>
            <Text style={styles.cancelTitle}>Delete ticket</Text>
            <Text style={styles.cancelBody}>
              Remove this ticket? This cannot be undone.
            </Text>
            {deleteTicketError ? <Text style={styles.cancelErrorText}>{deleteTicketError}</Text> : null}
            <View style={styles.cancelRow}>
              <TouchableOpacity
                style={[styles.cancelBtn, styles.keepBtn]}
                onPress={() => { setDeleteTicketModalVisible(false); setDeleteTicketError(null); }}
                disabled={deletingTicket}
              >
                <Text style={[styles.cancelBtnText, { color: "#2F91FF" }]}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelBtn, styles.confirmBtn]}
                onPress={confirmDeleteTicket}
                disabled={deletingTicket}
              >
                <Text style={styles.cancelBtnText}>
                  {deletingTicket ? "Deleting…" : "Delete ticket"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelModalVisible} transparent animationType="fade" onRequestClose={() => setCancelModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.cancelCard}>
            <Text style={styles.cancelTitle}>Cancel registration</Text>
            <Text style={styles.cancelBody}>
              Remove yourself from this event? Your ticket will be deleted.
            </Text>
            {cancelError ? <Text style={styles.cancelErrorText}>{cancelError}</Text> : null}
            <View style={styles.cancelRow}>
              <TouchableOpacity
                style={[styles.cancelBtn, styles.keepBtn]}
                onPress={() => { setCancelModalVisible(false); setCancelError(null); }}
                disabled={cancelling}
              >
                <Text style={[styles.cancelBtnText, { color: "#2F91FF" }]}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelBtn, styles.confirmBtn]}
                onPress={confirmCancel}
                disabled={cancelling}
              >
                <Text style={styles.cancelBtnText}>
                  {cancelling ? "Cancelling…" : "Cancel registration"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#6C2BD9" },

  headerRow: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  backBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 17,
    color: 'white',
  },

  loading: { flex: 1, justifyContent: "center", alignItems: "center", color: 'white', },

  content: { padding: 16, paddingBottom: 40 },

  card: { marginBottom: 28 },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    color: 'white',
  },

  title: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    flex: 1,
    color: 'white',
  },

  sub: {
    marginTop: 4,
    fontFamily: "Poppins",
    fontSize: 12,
    opacity: 0.7,
    color: 'white',
  },

  qrWrap: { marginTop: 16, alignItems: "center" },

  ticketLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: 12,
  },

  ticketDeleteBtn: {
    padding: 4,
    marginLeft: 8,
  },

  ticketType: {
    fontFamily: "Poppins",
    fontSize: 14,
    flex: 1,
    color: 'white',
  },

  qrBox: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
  },

  emptySmall: {
    marginTop: 12,
    fontFamily: "Poppins",
    opacity: 0.6,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  cancelCard: {
    width: "80%",
    borderRadius: 18,
    padding: 20,
    backgroundColor: "#fff",
    elevation: 4,
  },
  cancelTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    color: "#111",
    textAlign: "center",
    marginBottom: 8,
  },
  cancelBody: {
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#444",
    textAlign: "center",
    marginBottom: 16,
  },
  cancelErrorText: {
    fontFamily: "Poppins",
    fontSize: 12,
    color: "#E55353",
    textAlign: "center",
    marginBottom: 10,
  },
  cancelRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
  cancelBtn: {
    minWidth: 80,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  keepBtn: {
    borderWidth: 1,
    borderColor: "#2F91FF",
  },
  confirmBtn: {
    backgroundColor: "#E55353",
  },
  cancelBtnText: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
    color: "#fff",
  },
});
