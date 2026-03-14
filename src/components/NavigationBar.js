// components/NavigationBar.js — icon-only bottom bar with theme + verification gate
import React, { useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";

export default function NavigationBar({ state, navigation }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const currentRoute = state.routes[state.index];
  const routeName = currentRoute.name;
  const params = currentRoute.params || {};

  const { theme, isDark } = useAlbaTheme();
  const insets = useSafeAreaInsets();

  // base rule: only Feed & Community can show the bar
  let shouldShow = false;

  if (routeName === "Feed") {
    // hidden in fullscreen mode
    shouldShow = !params.fullscreenFeed;
  } else if (routeName === "Community") {
    // hidden when scroll says so
    shouldShow = params.bottomBarVisible !== false; // default: visible
  } else {
    shouldShow = false;
  }

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: shouldShow ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: shouldShow ? 0 : 80,
        duration: 180,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [shouldShow]);

  const goTo = (name) => {
    const event = navigation.emit({
      type: "tabPress",
      target: name,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(name);
    }
  };

  const handlePressCreate = async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const user = data?.user;
      if (!user?.id) {
        navigation.navigate("Start");
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("is_verified")
        .eq("id", user.id)
        .maybeSingle();

      if (profErr) throw profErr;

      if (!prof?.is_verified) {
        navigation.navigate("PreFaceRecognition");
      } else {
        goTo("CreatePost");
      }
    } catch (e) {
      console.warn("Create gate error:", e?.message || e);
      navigation.navigate("PreFaceRecognition");
    }
  };

  const bottomActiveTab = routeName;

  return (
    <Animated.View
      style={[
        styles.bottomBar,
        {
          opacity,
          transform: [{ translateY }],
          backgroundColor: theme.gray,
          shadowColor: isDark ? "#000000" : "#0C1A4B",
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
      pointerEvents={shouldShow ? "auto" : "none"}
    >
      {/* Feed */}
      <TouchableOpacity
        activeOpacity={0.7}
        style={styles.bottomItem}
        onPress={() => goTo("Feed")}
      >
        <Image
          source={
            bottomActiveTab === "Feed"
              ? require("../../assets/feed_active.png")
              : require("../../assets/feed_inactive.png")
          }
          style={styles.bottomIcon}
          resizeMode="contain"
        />
      </TouchableOpacity>

      {/* Create (gated by verification) */}
      <TouchableOpacity
        activeOpacity={0.7}
        style={styles.bottomItem}
        onPress={handlePressCreate}
      >
        <Image
          source={
            bottomActiveTab === "CreatePost"
              ? require("../../assets/post_active.png")
              : require("../../assets/post_inactive.png")
          }
          style={styles.bottomIcon}
          resizeMode="contain"
        />
      </TouchableOpacity>

      {/* Community */}
      <TouchableOpacity
        activeOpacity={0.7}
        style={styles.bottomItem}
        onPress={() => goTo("Community")}
      >
        <Image
          source={
            bottomActiveTab === "Community"
              ? require("../../assets/community_active.png")
              : require("../../assets/community_inactive.png")
          }
          style={styles.bottomIcon}
          resizeMode="contain"
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -6 },
    elevation: 6,
  },
  bottomItem: {
    flex: 1,
    alignItems: "center",
  },
  bottomIcon: {
    width: 26,
    height: 26,
  },
});
