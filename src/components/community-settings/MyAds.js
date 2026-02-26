// components/community-settings/MyAds.js
// themed (dark on dark mode, light on light mode)

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import { useFonts } from "expo-font";
import { supabase } from "../../lib/supabase";
import { useAlbaTheme } from "../../theme/ThemeContext";

function AdCard({ title, when, where, onPressSettings, theme, isDark }) {
  const cardBg = theme.card || (isDark ? "#222" : "#fff");
  const border = theme.border || (isDark ? "#333" : "#e8f4fb");
  const titleColor = theme.text || (isDark ? "#fff" : "#1b1b1b");
  const subColor =
    theme.subtleText || theme.secondaryText || (isDark ? "#AEB6C2" : "#8c97a8");

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: isDark ? "#1f2530" : "#e8f2ff" },
        ]}
      >
        <View
          style={[
            styles.iconDot,
            { backgroundColor: isDark ? "#59A7FF" : "#2F91FF" },
          ]}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.cardSubtitle, { color: subColor }]} numberOfLines={1}>
          {when}
          {where ? `, ${where}` : ""}
        </Text>

        <View style={styles.rowBtns}>
          <TouchableOpacity
            style={[styles.pill, { backgroundColor: "#2F91FF" }]}
            onPress={onPressSettings}
            activeOpacity={0.85}
          >
            <Image
              source={require("../../../assets/settings_white.png")}
              style={styles.pillIcon}
              resizeMode="contain"
            />
            <Text style={styles.pillText}>Ad settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function MyAds({ navigation }) {
  const { theme, isDark } = useAlbaTheme();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../../assets/fonts/Poppins-Regular.ttf"),
  });

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) {
          if (alive) setRows([]);
          return;
        }

        const { data: profile, error: profErr } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", uid)
          .maybeSingle();

        if (profErr) throw profErr;

        const username = profile?.username;
        if (!username) {
          if (alive) setRows([]);
          return;
        }

        // Ads are posts with type = "Ad"
        const { data, error } = await supabase
          .from("posts")
          .select("id, title, type, date, time, location, user")
          .eq("user", username)
          .eq("type", "Ad")
          .order("date", { ascending: false })
          .order("time", { ascending: false })
          .limit(100);

        if (error) throw error;

        const mapped = (data || []).map((p) => {
          const dateStr = p?.date ? String(p.date) : "TBD";
          const timeStr = p?.time ? String(p.time).slice(0, 5) : "—";
          const when = `${dateStr}, ${timeStr}`;
          const where = p?.location || "";
          return {
            id: p.id,
            title: p.title || "Untitled ad",
            when,
            where,
          };
        });

        if (alive) setRows(mapped);
      } catch (e) {
        console.warn("MyAds load error:", e);
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigation]);

  if (!fontsLoaded) return null;

  // If finished loading and there are no ads, hide the whole block
  if (!loading && rows.length === 0) return null;

  const containerBg = theme.card || (isDark ? "#1f1f1f" : "#ffffff");
  const border = theme.border || (isDark ? "#333" : "#e6eef6");
  const titleColor = theme.text || (isDark ? "#fff" : "#111");
  const subtle =
    theme.subtleText || theme.secondaryText || (isDark ? "#AEB6C2" : "#8c97a8");

  return (
    <View style={[styles.container, { backgroundColor: containerBg, borderColor: border }]}>
      <Text style={[styles.title, { color: titleColor }]}>My ads</Text>

      {loading ? (
        <ActivityIndicator color={subtle} />
      ) : (
        rows.map((row) => (
          <AdCard
            key={row.id}
            title={row.title}
            when={row.when}
            where={row.where}
            theme={theme}
            isDark={isDark}
            onPressSettings={() => navigation?.navigate?.("AdPublisher")}
          />
        ))
      )}

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => navigation?.navigate?.("CreatePost")}
        activeOpacity={0.85}
      >
        <Text style={styles.addBtnText}>Add ad</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 12,
    fontFamily: "Poppins",
  },
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconDot: { width: 26, height: 26, borderRadius: 13 },
  cardTitle: {
    fontSize: 14,
    fontFamily: "Poppins",
    fontWeight: "600",
  },
  cardSubtitle: {
    fontSize: 12,
    marginBottom: 6,
    fontFamily: "Poppins",
  },
  rowBtns: { flexDirection: "row", gap: 8 },
  pill: {
    height: 32,
    paddingHorizontal: 15,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  pillIcon: { width: 16, height: 16, marginRight: 6 },
  pillText: {
    color: "#fff",
    fontWeight: "200",
    fontSize: 14,
    fontFamily: "Poppins",
  },
  addBtn: {
    alignSelf: "center",
    backgroundColor: "#6aa9ff",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontFamily: "Poppins" },
});
