// screens/FeedSettingsScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAlbaTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";

export const FEED_TIMER_ENABLED_KEY = "alba_feed_timer_enabled";
export const FEED_TIMER_ALERT_MINUTES_KEY = "alba_feed_timer_alert_minutes";
export const DEFAULT_ALERT_MINUTES = 15;

const FEED_TAGS = [
  "Music", "Art", "Food", "Travel", "Sports", "Fitness",
  "Gaming", "Fashion", "Comedy", "Dance", "Nature", "Tech",
  "Film", "Education", "Lifestyle", "Pets",
];

export default function FeedSettingsScreen() {
  const navigation = useNavigation();
  const { isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  // --- existing timer state ---
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [alertMinutes, setAlertMinutes] = useState(String(DEFAULT_ALERT_MINUTES));

  // --- personalization state ---
  const [meId, setMeId] = useState(null);
  const [radiusEnabled, setRadiusEnabled] = useState(false);
  const [radiusKm, setRadiusKm] = useState("50");
  const [selectedTags, setSelectedTags] = useState([]);
  const [preferencePrompt, setPreferencePrompt] = useState("");
  const [embeddingLoading, setEmbeddingLoading] = useState(false);
  const [prefSaved, setPrefSaved] = useState(false);

  // Load timer from AsyncStorage + personalization from Supabase
  useEffect(() => {
    (async () => {
      try {
        const [enabled, mins] = await Promise.all([
          AsyncStorage.getItem(FEED_TIMER_ENABLED_KEY),
          AsyncStorage.getItem(FEED_TIMER_ALERT_MINUTES_KEY),
        ]);
        if (enabled !== null) setTimerEnabled(enabled === "true");
        if (mins !== null) setAlertMinutes(mins);
      } catch {}

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMeId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("feed_tags, feed_preference_prompt, feed_radius_km")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile) return;
      setSelectedTags(profile.feed_tags || []);
      setPreferencePrompt(profile.feed_preference_prompt || "");
      if (profile.feed_radius_km) {
        setRadiusEnabled(true);
        setRadiusKm(String(profile.feed_radius_km));
      }
    })();
  }, []);

  // --- timer handlers (unchanged) ---
  const saveTimerEnabled = async (val) => {
    setTimerEnabled(val);
    try { await AsyncStorage.setItem(FEED_TIMER_ENABLED_KEY, String(val)); } catch {}
  };

  const saveAlertMinutes = async (val) => {
    const cleaned = val.replace(/[^0-9]/g, "");
    setAlertMinutes(cleaned);
    try {
      await AsyncStorage.setItem(
        FEED_TIMER_ALERT_MINUTES_KEY,
        cleaned || String(DEFAULT_ALERT_MINUTES)
      );
    } catch {}
  };

  // --- personalization handlers ---
  const handleRadiusToggle = async (val) => {
    setRadiusEnabled(val);
    if (!meId) return;
    const km = val ? (parseInt(radiusKm, 10) || 50) : null;
    try {
      await supabase.from("profiles").update({ feed_radius_km: km }).eq("id", meId);
    } catch {}
  };

  const handleRadiusKmChange = async (val) => {
    const cleaned = val.replace(/[^0-9]/g, "");
    setRadiusKm(cleaned);
    if (!meId || !radiusEnabled) return;
    const km = parseInt(cleaned, 10);
    if (!km) return;
    try {
      await supabase.from("profiles").update({ feed_radius_km: km }).eq("id", meId);
    } catch {}
  };

  const toggleTag = async (tag) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(newTags);
    if (!meId) return;
    try {
      await supabase.from("profiles").update({ feed_tags: newTags }).eq("id", meId);
    } catch {}
  };

  const savePreference = async () => {
    const text = preferencePrompt.trim();
    if (!meId || !text) return;
    setEmbeddingLoading(true);
    setPrefSaved(false);
    try {
      const { data } = await supabase.functions.invoke("embed-text", {
        body: { text },
      });
      await supabase.from("profiles").update({
        feed_preference_prompt: text,
        feed_preference_embedding: data?.embedding || null,
      }).eq("id", meId);
      setPrefSaved(true);
      setTimeout(() => setPrefSaved(false), 2000);
    } catch {}
    setEmbeddingLoading(false);
  };

  const clearPreference = async () => {
    setPreferencePrompt("");
    setPrefSaved(false);
    if (!meId) return;
    try {
      await supabase.from("profiles").update({
        feed_preference_prompt: null,
        feed_preference_embedding: null,
      }).eq("id", meId);
    } catch {}
  };

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#fff" }} />;

  const bg = isDark ? "#1a1a1a" : "#fff";
  const cardBg = isDark ? "#2b2b2b" : "#f6f8fb";
  const textColor = isDark ? "#fff" : "#111";
  const secondaryText = isDark ? "#aaa" : "#6F7D95";
  const borderColor = isDark ? "#444" : "#d9e4f3";
  const accent = "#00A9FF";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { backgroundColor: bg, borderBottomColor: borderColor }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="chevron-left" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor }]}>{t("feed_settings_title")}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

        {/* ── Timer ── */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.rowTitle, { color: textColor }]}>{t("feed_settings_timer_title")}</Text>
              <Text style={[styles.rowSub, { color: secondaryText }]}>
                {t("feed_settings_timer_sub")}
              </Text>
            </View>
            <Switch
              value={timerEnabled}
              onValueChange={saveTimerEnabled}
              trackColor={{ false: borderColor, true: accent }}
              thumbColor="#fff"
            />
          </View>
          {timerEnabled && (
            <View style={[styles.alertRow, { borderTopColor: borderColor }]}>
              <Text style={[styles.rowTitle, { color: textColor }]}>{t("feed_settings_alert_title")}</Text>
              <View style={styles.minutesRow}>
                <TextInput
                  style={[styles.minutesInput, { color: textColor, borderColor, backgroundColor: isDark ? "#222" : "#fff" }]}
                  value={alertMinutes}
                  onChangeText={saveAlertMinutes}
                  keyboardType="number-pad"
                  maxLength={3}
                  selectTextOnFocus
                />
                <Text style={[styles.minutesLabel, { color: secondaryText }]}>{t("feed_settings_minutes")}</Text>
              </View>
            </View>
          )}
        </View>

        <Text style={[styles.hint, { color: secondaryText }]}>
          {t("feed_settings_hint")}
        </Text>

        {/* ── Radius filter ── */}
        <Text style={[styles.sectionLabel, { color: secondaryText }]}>FEED PERSONALIZATION</Text>

        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.rowTitle, { color: textColor }]}>Location radius</Text>
              <Text style={[styles.rowSub, { color: secondaryText }]}>
                Only show videos posted near you
              </Text>
            </View>
            <Switch
              value={radiusEnabled}
              onValueChange={handleRadiusToggle}
              trackColor={{ false: borderColor, true: accent }}
              thumbColor="#fff"
            />
          </View>
          {radiusEnabled && (
            <View style={[styles.alertRow, { borderTopColor: borderColor }]}>
              <Text style={[styles.rowTitle, { color: textColor }]}>Max distance</Text>
              <View style={styles.minutesRow}>
                <TextInput
                  style={[styles.minutesInput, { color: textColor, borderColor, backgroundColor: isDark ? "#222" : "#fff" }]}
                  value={radiusKm}
                  onChangeText={handleRadiusKmChange}
                  keyboardType="number-pad"
                  maxLength={4}
                  selectTextOnFocus
                />
                <Text style={[styles.minutesLabel, { color: secondaryText }]}>km</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Preferred categories (tags) ── */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <View style={{ padding: 14 }}>
            <Text style={[styles.rowTitle, { color: textColor }]}>Show me more of</Text>
            <Text style={[styles.rowSub, { color: secondaryText, marginBottom: 12 }]}>
              Tap categories to prioritize them in your feed
            </Text>
            <View style={styles.tagsWrap}>
              {FEED_TAGS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={[
                      styles.tagChip,
                      active
                        ? { backgroundColor: accent, borderColor: accent }
                        : { backgroundColor: "transparent", borderColor: isDark ? "#555" : "#d0d7e2" },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.tagText, { color: active ? "#fff" : secondaryText }]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Preference prompt (semantic search) ── */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <View style={{ padding: 14 }}>
            <Text style={[styles.rowTitle, { color: textColor }]}>What do you want to see?</Text>
            <Text style={[styles.rowSub, { color: secondaryText, marginBottom: 10 }]}>
              Describe it in your own words. Alba will find videos that match.
            </Text>
            <TextInput
              style={[
                styles.promptInput,
                {
                  color: textColor,
                  borderColor,
                  backgroundColor: isDark ? "#1a1a1a" : "#fff",
                },
              ]}
              placeholder="e.g. cooking, indie music, street art, surfing..."
              placeholderTextColor={isDark ? "#555" : "#b0b8c8"}
              value={preferencePrompt}
              onChangeText={(v) => { setPreferencePrompt(v); setPrefSaved(false); }}
              multiline
              maxLength={300}
            />
            <View style={styles.promptRow}>
              {!!preferencePrompt.trim() && (
                <TouchableOpacity
                  onPress={clearPreference}
                  style={[styles.clearBtn, { borderColor }]}
                >
                  <Text style={[styles.clearBtnText, { color: secondaryText }]}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={savePreference}
                disabled={embeddingLoading || !preferencePrompt.trim()}
                style={[
                  styles.saveBtn,
                  { opacity: embeddingLoading || !preferencePrompt.trim() ? 0.5 : 1 },
                ]}
              >
                {embeddingLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {prefSaved ? "Saved ✓" : "Set preference"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Saved videos ── */}
        <TouchableOpacity
          style={[styles.card, styles.savedRow, { backgroundColor: cardBg, borderColor }]}
          onPress={() => navigation.navigate("SavedVideos")}
          activeOpacity={0.7}
        >
          <Text style={[styles.rowTitle, { color: textColor }]}>{t("feed_settings_saved_videos")}</Text>
          <Feather name="chevron-right" size={18} color={secondaryText} />
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 32, justifyContent: "center", alignItems: "flex-start" },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontFamily: "PoppinsBold",
  },
  body: { flex: 1, padding: 16 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "PoppinsBold",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 8,
    marginLeft: 2,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  rowTitle: {
    fontSize: 14,
    fontFamily: "PoppinsBold",
    marginBottom: 2,
  },
  rowSub: { fontSize: 12, fontFamily: "Poppins", lineHeight: 16 },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  minutesRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  minutesInput: {
    width: 56,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    textAlign: "center",
    fontSize: 16,
    fontFamily: "PoppinsBold",
  },
  minutesLabel: { fontSize: 14, fontFamily: "Poppins" },
  hint: {
    fontSize: 12,
    fontFamily: "Poppins",
    lineHeight: 18,
    marginHorizontal: 4,
    marginBottom: 16,
  },
  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagText: { fontSize: 13, fontFamily: "Poppins" },
  promptInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: "Poppins",
    minHeight: 70,
    textAlignVertical: "top",
    marginBottom: 10,
  },
  promptRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  clearBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  clearBtnText: { fontSize: 13, fontFamily: "Poppins" },
  saveBtn: {
    backgroundColor: "#00A9FF",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 110,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 13, fontFamily: "PoppinsBold" },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    marginTop: 4,
  },
});
