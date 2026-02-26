// components/TopBar.js — instant nav (no getUser network call on tap)
import React, { useCallback } from "react";
import {
  View,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Image,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { getMyProfileCached, getUserIdFast, getIsVerifiedCached } from "../lib/authFast";

export default function TopBar({ opacity, activeTab, setActiveTab }) {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

  const handlePressProfile = useCallback(async () => {
    setActiveTab("Profile");

    // instant: session is local
    const userId = await getUserIdFast();
    if (!userId) {
      navigation.navigate("Start");
      return;
    }

    // usually instant after warm cache; otherwise one DB call
    const prof = await getMyProfileCached();
    const uname = String(prof?.username || "").replace(/^@/, "");

    const firstName = prof?.name ? prof.name.split(" ")[0] : (uname || "User");

    if (!uname) {
      navigation.navigate("Start");
      return;
    }

    navigation.navigate("Profile", { username: uname, name: firstName });
  }, [navigation, setActiveTab]);

  const handlePressChats = useCallback(async () => {
    setActiveTab("Chats");

    const userId = await getUserIdFast();
    if (!userId) {
      navigation.navigate("Start");
      return;
    }

    // cached (fast) after warm; falls back to 1 profile read
    const isVerified = await getIsVerifiedCached();
    navigation.navigate(isVerified ? "ChatList" : "PreFaceRecognition");
  }, [navigation, setActiveTab]);

  return (
    <Animated.View
      style={[
        styles.topBar,
        {
          opacity,
          backgroundColor: isDark ? theme.gray : theme.background,
        },
      ]}
    >
      <ThemedView variant="gray" style={styles.topIconsRow}>
        {/* Chats (gated) */}
        <TouchableOpacity
          style={styles.topIconItem}
          onPress={handlePressChats}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Image
            source={
              activeTab === "Chats"
                ? require("../../assets/chat_active.png")
                : require("../../assets/chat_inactive.png")
            }
            style={styles.topIconImage}
            resizeMode="contain"
          />
        </TouchableOpacity>

        {/* Profile */}
        <TouchableOpacity
          style={styles.topIconItem}
          onPress={handlePressProfile}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Image
            source={
              activeTab === "Profile"
                ? require("../../assets/profile_active.png")
                : require("../../assets/profile_inactive.png")
            }
            style={styles.topIconImage}
            resizeMode="contain"
          />
        </TouchableOpacity>

        {/* Settings */}
        <TouchableOpacity
          style={styles.topIconItem}
          onPress={() => {
            setActiveTab("Settings");
            navigation.navigate("CommunitySettings");
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Image
            source={
              activeTab === "Settings"
                ? require("../../assets/settings_active.png")
                : require("../../assets/settings_inactive.png")
            }
            style={styles.topIconImage}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </ThemedView>

      <View
        style={[
          styles.divider,
          { backgroundColor: isDark ? "#444444" : "#E6EAF2" },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  topIconsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingBottom: 4,
  },
  topIconItem: {
    alignItems: "center",
  },
  topIconImage: {
    width: 24,
    height: 24,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
});
