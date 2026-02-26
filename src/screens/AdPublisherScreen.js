// screens/AdPublisherScreen.js — Ad publisher dashboard
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";

const POSTS_TABLE = "posts";
const POSTS_COLS = "id, title, description, date, time, location, user";

export default function AdPublisherScreen() {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [myUsername, setMyUsername] = useState(null);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);

  // inline editing
  const [expandedId, setExpandedId] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [saving, setSaving] = useState(false);

  // delete
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  /* ---------- auth ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user || !alive) return;

        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        if (!alive) return;
        setMyUsername(prof?.username || user.user_metadata?.username || null);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  /* ---------- load ads ---------- */
  const loadAds = useCallback(async () => {
    if (!myUsername) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from(POSTS_TABLE)
        .select(POSTS_COLS)
        .eq("user", myUsername)
        .eq("type", "Ad")
        .order("date", { ascending: false })
        .order("time", { ascending: false })
        .limit(100);

      if (error) throw error;
      const adList = data || [];
      let statsMap = {};
      if (adList.length > 0) {
        const ids = adList.map((a) => a.id);
        const { data: stats } = await supabase
          .from("ad_stats")
          .select("post_id, views, purchases, contacts")
          .in("post_id", ids);
        (stats || []).forEach((s) => { statsMap[s.post_id] = s; });
      }
      setAds(adList.map((a) => ({
        ...a,
        stats: statsMap[a.id] || { views: 0, purchases: 0, contacts: 0 },
      })));
    } catch (e) {
      console.warn("[AdPublisher] load error", e);
    } finally {
      setLoading(false);
    }
  }, [myUsername]);

  useFocusEffect(
    useCallback(() => {
      loadAds();
    }, [loadAds])
  );

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  /* ---------- expand/collapse edit ---------- */
  const openEdit = (ad) => {
    setExpandedId(ad.id);
    setDraftTitle(ad.title || "");
    setDraftDesc(ad.description || "");
    setDraftDate(ad.date || "");
    setDraftTime(String(ad.time || "").slice(0, 5));
    setDraftLocation(ad.location || "");
  };

  const closeEdit = () => setExpandedId(null);

  /* ---------- save ---------- */
  const saveEdit = async (adId) => {
    const ad = ads.find((a) => a.id === adId);
    if (!ad) return;

    const patch = {};
    if (draftTitle !== (ad.title || "")) patch.title = draftTitle;
    if (draftDesc !== (ad.description || "")) patch.description = draftDesc;
    if (draftDate !== (ad.date || "")) patch.date = draftDate;
    if (draftTime !== String(ad.time || "").slice(0, 5)) patch.time = draftTime;
    if (draftLocation !== (ad.location || "")) patch.location = draftLocation;

    if (!Object.keys(patch).length) { closeEdit(); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from(POSTS_TABLE).update(patch).eq("id", adId);
      if (error) throw error;
      setAds((prev) => prev.map((a) => a.id === adId ? { ...a, ...patch } : a));
      closeEdit();
    } catch {
      Alert.alert("Error", "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- delete ---------- */
  const confirmDelete = (id) => {
    setDeleteId(id);
    setDeleteVisible(true);
  };

  const deleteAd = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from(POSTS_TABLE).delete().eq("id", deleteId);
      if (error) throw error;
      setAds((prev) => prev.filter((a) => a.id !== deleteId));
      if (expandedId === deleteId) closeEdit();
    } catch {
      Alert.alert("Error", "Could not delete ad.");
    } finally {
      setDeleteVisible(false);
      setDeleteId(null);
    }
  };

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#fff" }} />;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Ad Dashboard</Text>
          <View style={{ width: 32 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

            {loading ? (
              <ActivityIndicator color={theme.text} style={{ marginTop: 40 }} />
            ) : ads.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.subtleText || "#8c97a8" }]}>
                You haven't published any ads yet.
              </Text>
            ) : (
              ads.map((ad) => {
                const isExpanded = expandedId === ad.id;
                const dateStr = ad.date ? String(ad.date) : "—";

                return (
                  <View
                    key={ad.id}
                    style={[styles.adCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    {/* Card header */}
                    <View style={styles.adCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.adTitle, { color: theme.text }]} numberOfLines={isExpanded ? undefined : 1}>
                          {ad.title || "Untitled ad"}
                        </Text>
                        {!isExpanded && (
                          <Text style={[styles.adMeta, { color: theme.subtleText || "#8c97a8" }]}>
                            {dateStr}{ad.location ? ` · ${ad.location}` : ""}
                          </Text>
                        )}
                      </View>

                      <View style={styles.adCardBtns}>
                        <TouchableOpacity
                          style={[styles.adActionBtn, { backgroundColor: "#2F91FF" }]}
                          onPress={() => isExpanded ? closeEdit() : openEdit(ad)}
                          activeOpacity={0.85}
                        >
                          <Feather name={isExpanded ? "x" : "edit-2"} size={14} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.adActionBtn, { backgroundColor: "#ff4d4f" }]}
                          onPress={() => confirmDelete(ad.id)}
                          activeOpacity={0.85}
                        >
                          <Feather name="trash-2" size={14} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Stats row */}
                    <View style={styles.statRow}>
                      <View style={styles.statChip}>
                        <Feather name="eye" size={11} color="#6C63FF" />
                        <Text style={[styles.statValue, { color: "#6C63FF" }]}> {ad.stats?.views ?? 0}</Text>
                        <Text style={[styles.statLabel, { color: theme.subtleText || "#8c97a8" }]}> views</Text>
                      </View>
                      <View style={styles.statChip}>
                        <Feather name="shopping-cart" size={11} color="#2BB673" />
                        <Text style={[styles.statValue, { color: "#2BB673" }]}> {ad.stats?.purchases ?? 0}</Text>
                        <Text style={[styles.statLabel, { color: theme.subtleText || "#8c97a8" }]}> purchases</Text>
                      </View>
                      <View style={styles.statChip}>
                        <Feather name="message-circle" size={11} color="#008CFF" />
                        <Text style={[styles.statValue, { color: "#008CFF" }]}> {ad.stats?.contacts ?? 0}</Text>
                        <Text style={[styles.statLabel, { color: theme.subtleText || "#8c97a8" }]}> contacts</Text>
                      </View>
                    </View>

                    {/* Inline edit form */}
                    {isExpanded && (
                      <View style={styles.editBlock}>
                        <Text style={[styles.editLabel, { color: theme.text }]}>Title</Text>
                        <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}>
                          <TextInput
                            value={draftTitle}
                            onChangeText={setDraftTitle}
                            placeholder="Ad title"
                            placeholderTextColor={theme.subtleText || "#8c97a8"}
                            style={[styles.inputField, { color: theme.text }]}
                          />
                        </View>

                        <Text style={[styles.editLabel, { color: theme.text }]}>Description</Text>
                        <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}>
                          <TextInput
                            value={draftDesc}
                            onChangeText={setDraftDesc}
                            placeholder="Ad description"
                            placeholderTextColor={theme.subtleText || "#8c97a8"}
                            style={[styles.inputField, { color: theme.text, height: 80 }]}
                            multiline
                          />
                        </View>

                        <View style={styles.dateTimeRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.editLabel, { color: theme.text }]}>Date</Text>
                            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}>
                              <TextInput
                                value={draftDate}
                                onChangeText={setDraftDate}
                                placeholder="YYYY-MM-DD"
                                placeholderTextColor={theme.subtleText || "#8c97a8"}
                                style={[styles.inputField, { color: theme.text }]}
                              />
                            </View>
                          </View>

                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[styles.editLabel, { color: theme.text }]}>Time</Text>
                            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}>
                              <TextInput
                                value={draftTime}
                                onChangeText={setDraftTime}
                                placeholder="HH:MM"
                                placeholderTextColor={theme.subtleText || "#8c97a8"}
                                style={[styles.inputField, { color: theme.text }]}
                              />
                            </View>
                          </View>
                        </View>

                        <Text style={[styles.editLabel, { color: theme.text }]}>Location</Text>
                        <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}>
                          <TextInput
                            value={draftLocation}
                            onChangeText={setDraftLocation}
                            placeholder="Location"
                            placeholderTextColor={theme.subtleText || "#8c97a8"}
                            style={[styles.inputField, { color: theme.text }]}
                          />
                        </View>

                        <TouchableOpacity
                          style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                          onPress={() => saveEdit(ad.id)}
                          disabled={saving}
                          activeOpacity={0.85}
                        >
                          {saving
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.saveBtnText}>Save changes</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}

            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => navigation.navigate("CreatePostScreen")}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={16} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.createBtnText}>Create new ad</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Delete confirm */}
      <Modal visible={deleteVisible} transparent animationType="fade" onRequestClose={() => setDeleteVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setDeleteVisible(false)} />
        <View style={[styles.deleteCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.deleteTitle, { color: theme.text }]}>
            Are you sure you want to delete this ad?
          </Text>
          <View style={styles.deleteRow}>
            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#ff4d4f" }]}
              onPress={deleteAd}
              activeOpacity={0.9}
            >
              <Text style={styles.deleteChoiceText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#D9EEFF" }]}
              onPress={() => setDeleteVisible(false)}
              activeOpacity={0.9}
            >
              <Text style={[styles.deleteChoiceText, { color: "#2F6CA8" }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: 16 },
  scrollContent: { paddingBottom: 18 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 4 },
  backButton: { paddingRight: 8, paddingVertical: 4 },
  headerTitle: { flex: 1, fontFamily: "PoppinsBold", fontSize: 18, textAlign: "center" },

  emptyText: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", marginTop: 40 },

  adCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  adCardHeader: { flexDirection: "row", alignItems: "flex-start" },
  adTitle: { fontFamily: "PoppinsBold", fontSize: 14 },
  adMeta: { fontFamily: "Poppins", fontSize: 12, marginTop: 2 },
  adCardBtns: { flexDirection: "row", gap: 8, marginLeft: 10 },
  adActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  statRow: { flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" },
  statChip: { flexDirection: "row", alignItems: "center" },
  statValue: { fontFamily: "PoppinsBold", fontSize: 12 },
  statLabel: { fontFamily: "Poppins", fontSize: 12 },

  editBlock: { marginTop: 14 },
  editLabel: { fontFamily: "PoppinsBold", fontSize: 13, marginBottom: 4, marginTop: 8 },
  inputWrap: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputField: { fontFamily: "Poppins", fontSize: 14 },
  dateTimeRow: { flexDirection: "row" },

  saveBtn: {
    backgroundColor: "#59A7FF",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  saveBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6aa9ff",
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 20,
  },
  createBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
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
});
