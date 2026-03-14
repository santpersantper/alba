// components/community-settings/AdSettings.js
import React, { useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import ThemedView from "../../theme/ThemedView";
import ThemedText from "../../theme/ThemedText";
import { useAlbaTheme } from "../../theme/ThemeContext";
import { useAlbaLanguage } from "../../theme/LanguageContext";
import Constants from "expo-constants";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants?.expoConfig?.extra?.expoPublic?.API_URL ??
  "http://localhost:3000";

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function AdSettings({ navigation }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [userId, setUserId] = useState(null);
  const [input, setInput] = useState("");
  const [tags, setTags] = useState([]);

  // Payout state
  const [payoutStatus, setPayoutStatus] = useState(null); // null | "not_started" | "pending" | "complete"
  const [payoutLoading, setPayoutLoading] = useState(false);

  const fetchPayoutStatus = async (token) => {
    try {
      const res = await fetch(`${API_URL}/connect/status/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) setPayoutStatus(json.status);
    } catch {
      // non-critical
    }
  };

  const handleSetupPayouts = async () => {
    if (payoutLoading) return;
    try {
      setPayoutLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || "";
      const res = await fetch(`${API_URL}/connect/onboard/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status}) — make sure the payment server is running and up to date.`);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to start onboarding");
      await Linking.openURL(json.url);
      setTimeout(() => fetchPayoutStatus(token), 3000);
    } catch (e) {
      console.warn("Ad payout onboarding error:", e.message);
      Alert.alert("Error", e.message || "Could not start payout setup. Please try again.");
    } finally {
      setPayoutLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u) return;
        if (!mounted) return;
        setUserId(u.id);

        const { data, error } = await supabase
          .from("profiles")
          .select("ad_tags")
          .eq("id", u.id)
          .maybeSingle();

        if (!mounted || error || !data) return;
        if (Array.isArray(data.ad_tags)) setTags(data.ad_tags);

        // Load payout status
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token || "";
        if (mounted) await fetchPayoutStatus(token);
      } catch (e) {
        console.warn("AdSettings load error", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Save to both ad_tags and event_tags so LabelsCard picks them up on next focus
  const addTagsFromString = async (str) => {
    if (!userId) return;
    const pieces = str
      .split(",")
      .map((s) => capitalize(s.trim()))
      .filter(Boolean);
    if (!pieces.length) return;

    // Read both columns, merge, save
    const { data } = await supabase
      .from("profiles")
      .select("ad_tags, event_tags")
      .eq("id", userId)
      .maybeSingle();

    const currentAdTags = Array.isArray(data?.ad_tags) ? data.ad_tags : tags;
    const currentEventTags = Array.isArray(data?.event_tags)
      ? data.event_tags
      : [];

    const nextAdTags = [...currentAdTags];
    const nextEventTags = [...currentEventTags];
    pieces.forEach((p) => {
      if (!nextAdTags.some((t) => t.toLowerCase() === p.toLowerCase()))
        nextAdTags.push(p);
      if (!nextEventTags.some((t) => t.toLowerCase() === p.toLowerCase()))
        nextEventTags.push(p);
    });

    setTags(nextAdTags);
    supabase
      .from("profiles")
      .update({ ad_tags: nextAdTags, event_tags: nextEventTags })
      .eq("id", userId)
      .then(({ error }) => {
        if (error) console.warn("AdSettings save error", error);
      });
  };

  const handleRemoveTag = async (name) => {
    if (!userId) return;
    const nextAdTags = tags.filter((t) => t !== name);
    setTags(nextAdTags);
    supabase
      .from("profiles")
      .update({ ad_tags: nextAdTags })
      .eq("id", userId)
      .then(({ error }) => {
        if (error) console.warn("AdSettings remove error", error);
      });
  };

  const handleInputChange = (text) => {
    if (text.includes(",")) {
      const parts = text.split(",");
      const finished = parts.slice(0, -1).join(",");
      const leftover = parts[parts.length - 1];
      if (finished.trim()) addTagsFromString(finished);
      setInput(leftover);
    } else {
      setInput(text);
    }
  };

  const handleSubmitEditing = () => {
    if (input.trim()) {
      addTagsFromString(input);
      setInput("");
    }
  };

  const handleInputBlur = () => {
    if (input.trim()) {
      addTagsFromString(input);
      setInput("");
    }
  };

  return (
    <ThemedView variant="gray" style={styles.section}>
      <ThemedText style={[styles.sectionLabel, { color: theme.text }]}>
        {t("ad_settings_tags_title")}
      </ThemedText>

      <TextInput
        value={input}
        onChangeText={handleInputChange}
        onBlur={handleInputBlur}
        onSubmitEditing={handleSubmitEditing}
        placeholder={t("ad_settings_tags_placeholder")}
        placeholderTextColor={isDark ? "#AAAAAA" : "#888888"}
        style={[
          styles.input,
          {
            backgroundColor: isDark ? (theme.card || theme.gray) : "#FFFFFF",
            color: theme.text,
            borderColor: isDark ? (theme.border || "#444") : "#d9d9d9",
          },
        ]}
        returnKeyType="done"
      />

      {/* Chips — same style as CommunityEventSettings */}
      {tags.length > 0 && (
        <View style={styles.tagsRow}>
          {tags.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={styles.tagChip}
              onPress={() => handleRemoveTag(tag)}
              activeOpacity={0.85}
            >
              <ThemedText style={styles.tagText}>{tag}</ThemedText>
              <Feather
                name="x"
                size={12}
                color="#FFFFFF"
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={() => {
          if (!userId) return;
          setTags([]);
          supabase.from("profiles").update({ ad_tags: [] }).eq("id", userId).then(() => {}).catch(() => {});
        }}
        activeOpacity={0.7}
      >
        <Feather name="refresh-ccw" size={13} color="#888" style={{ marginRight: 5 }} />
        <ThemedText style={styles.resetBtnText}>{t("payout_reset_ad")}</ThemedText>
      </TouchableOpacity>

      {/* ── Product-sale payout setup ── */}
      <View style={styles.payoutSection}>
        <ThemedText style={[styles.payoutTitle, { color: theme.text }]}>
          {t("payout_product_title")}
        </ThemedText>
        <ThemedText style={[styles.payoutHelper, { color: theme.secondaryText || "#888" }]}>
          {payoutStatus === "complete"
            ? t("payout_product_connected")
            : payoutStatus === "pending"
            ? t("payout_product_pending")
            : t("payout_product_not_setup")}
        </ThemedText>
        <View style={styles.payoutRow}>
          <View
            style={[
              styles.payoutBadge,
              {
                backgroundColor:
                  payoutStatus === "complete"
                    ? "#D1FAE5"
                    : payoutStatus === "pending"
                    ? "#FEF3C7"
                    : isDark ? "#2A2A2A" : "#F3F4F6",
              },
            ]}
          >
            <Feather
              name={payoutStatus === "complete" ? "check-circle" : payoutStatus === "pending" ? "clock" : "alert-circle"}
              size={13}
              color={payoutStatus === "complete" ? "#059669" : payoutStatus === "pending" ? "#D97706" : "#9CA3AF"}
              style={{ marginRight: 4 }}
            />
            <ThemedText style={{ fontSize: 12, fontFamily: "Poppins", color: payoutStatus === "complete" ? "#059669" : payoutStatus === "pending" ? "#D97706" : "#9CA3AF" }}>
              {payoutStatus === "complete" ? t("payout_status_connected") : payoutStatus === "pending" ? t("payout_status_pending") : t("payout_status_not_setup")}
            </ThemedText>
          </View>
          {payoutStatus !== "complete" && (
            <TouchableOpacity
              style={styles.payoutBtn}
              onPress={handleSetupPayouts}
              disabled={payoutLoading}
              activeOpacity={0.8}
            >
              {payoutLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <ThemedText style={styles.payoutBtnText}>
                    {payoutStatus === "pending" ? t("payout_continue_setup") : t("payout_setup")}
                  </ThemedText>
              }
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24 },
  sectionLabel: { fontSize: 14, fontFamily: "Poppins", marginBottom: 6 },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Poppins",
    borderWidth: 1.5,
  },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 6 },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#3D8BFF",
  },
  tagText: { color: "#FFFFFF", fontSize: 13, fontFamily: "Poppins" },
  resetBtn: { flexDirection: "row", alignItems: "center", marginTop: 14, alignSelf: "flex-start" },
  resetBtnText: { fontFamily: "Poppins", fontSize: 13, color: "#888" },
  payoutSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  payoutTitle: { fontFamily: "PoppinsBold", fontSize: 14, marginBottom: 4 },
  payoutHelper: { fontFamily: "Poppins", fontSize: 12, lineHeight: 17, marginBottom: 10 },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  payoutBadge: { flexDirection: "row", alignItems: "center", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  payoutBtn: { backgroundColor: "#00A9FF", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 44, alignItems: "center" },
  payoutBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 13 },
});
