// screens/FeedSettingsScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAlbaTheme } from "../theme/ThemeContext";

export const FEED_TIMER_ENABLED_KEY = "alba_feed_timer_enabled";
export const FEED_TIMER_ALERT_MINUTES_KEY = "alba_feed_timer_alert_minutes";
export const DEFAULT_ALERT_MINUTES = 15;

export default function FeedSettingsScreen() {
  const navigation = useNavigation();
  const { isDark } = useAlbaTheme();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const [timerEnabled, setTimerEnabled] = useState(false);
  const [alertMinutes, setAlertMinutes] = useState(String(DEFAULT_ALERT_MINUTES));

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
    })();
  }, []);

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

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#fff" }} />;

  const bg = isDark ? "#1a1a1a" : "#fff";
  const cardBg = isDark ? "#2b2b2b" : "#f6f8fb";
  const textColor = isDark ? "#fff" : "#111";
  const secondaryText = isDark ? "#aaa" : "#6F7D95";
  const borderColor = isDark ? "#444" : "#d9e4f3";

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { backgroundColor: bg, borderBottomColor: borderColor }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="chevron-left" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor }]}>Feed Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.body}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.rowTitle, { color: textColor }]}>Show use-time timer</Text>
              <Text style={[styles.rowSub, { color: secondaryText }]}>
                Display a timer on Feed showing how long you've been watching
              </Text>
            </View>
            <Switch
              value={timerEnabled}
              onValueChange={saveTimerEnabled}
              trackColor={{ false: borderColor, true: "#00A9FF" }}
              thumbColor="#fff"
            />
          </View>

          {timerEnabled && (
            <View style={[styles.alertRow, { borderTopColor: borderColor }]}>
              <Text style={[styles.rowTitle, { color: textColor }]}>Alert me after</Text>
              <View style={styles.minutesRow}>
                <TextInput
                  style={[
                    styles.minutesInput,
                    { color: textColor, borderColor, backgroundColor: isDark ? "#222" : "#fff" },
                  ]}
                  value={alertMinutes}
                  onChangeText={saveAlertMinutes}
                  keyboardType="number-pad"
                  maxLength={3}
                  selectTextOnFocus
                />
                <Text style={[styles.minutesLabel, { color: secondaryText }]}>minutes</Text>
              </View>
            </View>
          )}
        </View>

        <Text style={[styles.hint, { color: secondaryText }]}>
          When the timer reaches your limit, you'll receive a reminder to take a break.
        </Text>
      </View>
    </View>
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
  backBtn: {
    width: 32,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    fontFamily: "Poppins",
  },
  body: {
    flex: 1,
    padding: 16,
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
    fontFamily: "Poppins",
    fontWeight: "600",
    marginBottom: 2,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: "Poppins",
    lineHeight: 16,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  minutesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  minutesInput: {
    width: 56,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    textAlign: "center",
    fontSize: 16,
    fontFamily: "Poppins",
    fontWeight: "700",
  },
  minutesLabel: {
    fontSize: 14,
    fontFamily: "Poppins",
  },
  hint: {
    fontSize: 12,
    fontFamily: "Poppins",
    lineHeight: 18,
    marginHorizontal: 4,
  },
});
