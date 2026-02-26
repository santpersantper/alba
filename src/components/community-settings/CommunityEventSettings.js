// components/community-settings/EventSettings.js
import React, { useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import ThemedView from "../../theme/ThemedView";
import ThemedText from "../../theme/ThemedText";
import { useAlbaTheme } from "../../theme/ThemeContext";
import { useAlbaLanguage } from "../../theme/LanguageContext";

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u) return;
        if (!mounted) return;
        setUserId(u.id);

        // support both legacy and your current column naming
        const { data, error } = await supabase
          .from("profiles")
          .select("event_tags, max_event_distance, event_distance_m")
          .eq("id", u.id)
          .maybeSingle();

        if (!mounted || error || !data) return;

        if (Array.isArray(data.event_tags)) {
          // Merge BASE_LABELS at the front, then any custom tags not already present
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

        const dist =
          typeof data.max_event_distance === "number"
            ? data.max_event_distance
            : typeof data.event_distance_m === "number"
            ? data.event_distance_m
            : null;

        if (typeof dist === "number") setMaxDistance(dist);
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
});
