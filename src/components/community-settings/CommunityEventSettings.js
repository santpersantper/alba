// components/community-settings/EventSettings.js
import React, { useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from "react-native";
import Slider from "@react-native-community/slider";
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

// Same defaults shown in CommunityScreen's LabelsCard
const BASE_LABELS = [
  "Sports",
  "Science & Tech",
  "Parties",
  "Music",
  "English-speaking",
];

export default function CommunityEventSettings() {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [userId, setUserId] = useState(null);
  const [input, setInput] = useState("");
  const [tags, setTags] = useState([...BASE_LABELS]);
  const [maxDistance, setMaxDistance] = useState(1500);

  // Payout / Stripe Connect state
  const [groupId, setGroupId] = useState(null);
  const [payoutStatus, setPayoutStatus] = useState(null); // null | "not_started" | "pending" | "complete"
  const [payoutLoading, setPayoutLoading] = useState(false);

  const fetchPayoutStatus = async (gId, token) => {
    try {
      const res = await fetch(`${API_URL}/connect/status?groupId=${gId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) setPayoutStatus(json.status);
    } catch {
      // silently ignore — non-critical
    }
  };

  const handleSetupPayouts = async () => {
    if (!groupId || payoutLoading) return;
    try {
      setPayoutLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || "";
      const res = await fetch(`${API_URL}/connect/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, groupId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to start onboarding");
      await Linking.openURL(json.url);
      // Re-check status after returning from browser
      setTimeout(() => fetchPayoutStatus(groupId, token), 3000);
    } catch (e) {
      console.warn("Payout onboarding error:", e.message);
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
        console.log("[EventSettings] auth user:", u?.id);
        if (!u) return;
        if (!mounted) return;
        setUserId(u.id);

        const { data, error } = await supabase
          .from("profiles")
          .select("event_tags")
          .eq("id", u.id)
          .maybeSingle();

        if (!mounted) return;

        if (Array.isArray(data?.event_tags)) {
          const merged = [...BASE_LABELS];
          for (const tag of data.event_tags) {
            if (!merged.some((t) => t.toLowerCase() === tag.toLowerCase())) {
              merged.push(tag);
            }
          }
          setTags(merged);
        } else {
          setTags([...BASE_LABELS]);
        }

        // Find a group where this user is an admin — more reliable than going via posts.group_id
        // (createEventGroup never back-fills posts.group_id, so the post lookup always fails).
        const { data: profRow } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", u.id)
          .maybeSingle();
        const uname = profRow?.username;

        if (uname) {
          const { data: groupData, error: groupErr } = await supabase
            .from("groups")
            .select("id")
            .contains("group_admin", [uname])
            .limit(1)
            .maybeSingle();

          console.log("[EventSettings] group lookup for", uname, "→", groupData, groupErr);

          if (mounted && groupData?.id) {
            setGroupId(groupData.id);
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token || "";
            await fetchPayoutStatus(groupData.id, token);
          }
        }
      } catch (e) {
        console.warn("EventSettings load error", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const savePatch = (patch) => {
    if (!userId) return;
    supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .then(({ error }) => {
        if (error) console.warn("EventSettings save error", error);
      });
  };

  const addTagsFromString = async (str) => {
    if (!userId) return;
    const pieces = str
      .split(",")
      .map((s) => {
        const t = s.trim();
        return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
      })
      .filter(Boolean);
    if (!pieces.length) return;

    // Read both columns so we can merge into both (keeps LabelsCard + ad filtering in sync)
    const { data } = await supabase
      .from("profiles")
      .select("event_tags, ad_tags")
      .eq("id", userId)
      .maybeSingle();

    const currentEventTags = Array.isArray(data?.event_tags) ? data.event_tags : tags;
    const currentAdTags = Array.isArray(data?.ad_tags) ? data.ad_tags : [];

    const nextEventTags = [...currentEventTags];
    const nextAdTags = [...currentAdTags];
    pieces.forEach((p) => {
      if (!nextEventTags.some((t) => t.toLowerCase() === p.toLowerCase()))
        nextEventTags.push(p);
      if (!nextAdTags.some((t) => t.toLowerCase() === p.toLowerCase()))
        nextAdTags.push(p);
    });

    setTags(nextEventTags);
    savePatch({ event_tags: nextEventTags, ad_tags: nextAdTags });
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

  const handleInputBlur = () => {
    if (input.trim()) {
      addTagsFromString(input);
      setInput("");
    }
  };

  const handleRemoveTag = (name) => {
    setTags((prev) => {
      const next = prev.filter((t) => t !== name);
      savePatch({ event_tags: next });
      return next;
    });
  };

  const handleDistanceChange = (val) => {
    setMaxDistance(val);
    // write both columns so whichever you use elsewhere stays in sync
    savePatch({ max_event_distance: val, event_distance_m: val });
  };

  return (
    <ThemedView variant="gray" style={styles.section}>
      <ThemedText style={[styles.sectionLabel, { color: theme.text }]}>
        {t("event_settings_tags_title")}
      </ThemedText>

      <TextInput
        value={input}
        onChangeText={handleInputChange}
        onBlur={handleInputBlur}
        placeholder={t("event_settings_tags_placeholder")}
        placeholderTextColor={isDark ? "#AAAAAA" : "#888888"}
        style={[
          styles.input,
          {
            backgroundColor: isDark ? (theme.card || theme.gray) : "#FFFFFF",
            color: theme.text,
            borderColor: isDark ? (theme.border || "#444") : "#d9d9d9",
          },
        ]}
      />

      {/* Tags row — all chips are removable */}
      <View style={styles.tagsRow}>
        {tags.map((tag) => (
          <TouchableOpacity
            key={tag}
            style={styles.tagChip}
            onPress={() => handleRemoveTag(tag)}
            activeOpacity={0.85}
          >
            <ThemedText style={styles.tagText}>{tag}</ThemedText>
            <Feather name="x" size={12} color="#FFFFFF" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        ))}
      </View>

      {/* ✅ Slider title + helper text */}
      <ThemedText style={[styles.sliderTitle, { color: theme.text }]}>
        {t("settings_area_title")}
      </ThemedText>
      <ThemedText style={[styles.sliderHelper, { color: theme.subtleText || theme.text }]}>
        {t("settings_area_helper")}
      </ThemedText>

      <View style={styles.distanceRow}>
        <ThemedView
          variant="gray"
          style={[
            styles.distanceBox,
            { borderColor: isDark ? (theme.border || "#444") : "#d9d9d9" },
          ]}
        >
          <ThemedText style={[styles.distanceText, { color: theme.text }]}>
            {Math.round(maxDistance)}
          </ThemedText>
        </ThemedView>
        <ThemedText style={[styles.metersText, { color: theme.text }]}>
          {t("settings_meters")}
        </ThemedText>
      </View>

      <Slider
        style={{ marginTop: 4 }}
        minimumValue={500}
        maximumValue={5000}
        step={100}
        value={maxDistance}
        onValueChange={setMaxDistance}
        onSlidingComplete={handleDistanceChange}
        minimumTrackTintColor="#3D8BFF"
        maximumTrackTintColor={isDark ? "#555555" : "#E0E0E0"}
        thumbTintColor="#FFFFFF"
      />

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={() => {
          setTags([...BASE_LABELS]);
          setMaxDistance(1500);
          savePatch({ event_tags: BASE_LABELS, max_event_distance: 1500, event_distance_m: 1500 });
        }}
        activeOpacity={0.7}
      >
        <Feather name="refresh-ccw" size={13} color="#888" style={{ marginRight: 5 }} />
        <ThemedText style={styles.resetBtnText}>Reset event preference settings</ThemedText>
      </TouchableOpacity>

      {/* ── Ticket payout setup ── */}
      <View style={styles.payoutSection}>
        <ThemedText style={[styles.payoutTitle, { color: theme.text }]}>
          Ticket payouts
        </ThemedText>
        <ThemedText style={[styles.payoutHelper, { color: theme.secondaryText || "#888" }]}>
          {!groupId
            ? "If you organise events and sell tickets on Alba, you can connect a bank account here to receive ticket revenue directly. Create an event first to get started."
            : payoutStatus === "complete"
            ? "Your bank account is connected. Ticket sales will be transferred to you automatically, minus a small platform fee."
            : payoutStatus === "pending"
            ? "Onboarding started — please complete verification on Stripe to receive payments."
            : "Connect a bank account to receive ticket revenue directly. Alba collects a small platform fee per transaction; the rest goes straight to you."}
        </ThemedText>
        {groupId && (
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
                {payoutStatus === "complete" ? "Connected" : payoutStatus === "pending" ? "Pending verification" : "Not set up"}
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
                      {payoutStatus === "pending" ? "Continue setup" : "Set up payouts"}
                    </ThemedText>
                }
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
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

  sliderTitle: { marginTop: 12, fontSize: 14, fontFamily: "Poppins", marginBottom: 4, fontWeight: 700 },
  sliderHelper: { fontSize: 12.5, fontFamily: "Poppins", lineHeight: 16 },

  distanceRow: { flexDirection: "row", alignItems: "center", marginTop: 8, marginBottom: 4 },
  distanceBox: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1.5,
    marginRight: 6,
  },
  distanceText: { fontFamily: "Poppins", fontSize: 14 },
  metersText: { fontFamily: "Poppins", fontSize: 14 },
  resetBtn: { flexDirection: "row", alignItems: "center", marginTop: 14, alignSelf: "flex-start" },
  resetBtnText: { fontFamily: "Poppins", fontSize: 13, color: "#888" },
  payoutSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  payoutTitle: { fontFamily: "Poppins", fontWeight: "700", fontSize: 14, marginBottom: 4 },
  payoutHelper: { fontFamily: "Poppins", fontSize: 12, lineHeight: 17, marginBottom: 10 },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  payoutBadge: { flexDirection: "row", alignItems: "center", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  payoutBtn: { backgroundColor: "#00A9FF", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 44, alignItems: "center" },
  payoutBtnText: { color: "#fff", fontFamily: "Poppins", fontWeight: "700", fontSize: 13 },
});
