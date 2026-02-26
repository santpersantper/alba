// components/community-settings/AdSettings.js
import React, { useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import ThemedView from "../../theme/ThemedView";
import ThemedText from "../../theme/ThemedText";
import { useAlbaTheme } from "../../theme/ThemeContext";
import { useAlbaLanguage } from "../../theme/LanguageContext";

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function AdSettings({ navigation }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [userId, setUserId] = useState(null);
  const [input, setInput] = useState("");
  const [tags, setTags] = useState([]);

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
});
