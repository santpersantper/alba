// src/components/OnboardingOverlay.js
// First-time screen introduction overlay.

import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import { useGuest } from "../theme/GuestContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

// ── TESTING FLAG ──────────────────────────────────────────────────────────────
// Set to true during QA to show the overlay on every launch.
// Set to false before shipping to production.
const ALWAYS_SHOW_ONBOARDING = false;
// ─────────────────────────────────────────────────────────────────────────────

// Per-screen copy
const CONTENT = {
  community: {
    title: "Welcome to Community",
    body: "Discover events and things going on around you.\n\n Get tickets in a few clicks, join a group chat with people who are going, and use the filters at the top to find what matters to you. \n\n ",
  },
  settings: {
    title: "Community Settings",
    body: "Manage your events and ads, tell the algorithm what events and ads to show you, control who can interact with you and get premium features.",
  },
  feed: {
    title: "Welcome to Feed",
    body: "Swipe up and down through short videos posted by people around you.\n\nTap the phone icon to check your screen time, and use Settings to adjust your timer and tell the algorithm what you want to see.",
  },
  usetime: {
    title: "Screen Time",
    body: "Track how long you use social media each day.\n\nSet a weekly reduction goal and a daily maximum to build healthier digital habits and keep your streak going!",
  },
};

const storageKey = (screenKey) => `onboarding_seen_${screenKey}`;

export default function OnboardingOverlay({ screenKey }) {
  const { isGuest } = useGuest();
  const { t } = useAlbaLanguage();
  // Start visible immediately when always-show is on — no useEffect round-trip needed.
  const [visible, setVisible] = useState(ALWAYS_SHOW_ONBOARDING);

  useEffect(() => {
    if (ALWAYS_SHOW_ONBOARDING) return;

    let cancelled = false;

    async function check() {
      // Don't show again if already dismissed on this device
      try {
        const local = await AsyncStorage.getItem(storageKey(screenKey));
        if (local) return;
      } catch {}

      // Only show for freshly created accounts (< 1 hour old)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const accountAgeMs = Date.now() - new Date(user.created_at).getTime();
        if (accountAgeMs < 60 * 60 * 1000 && !cancelled) setVisible(true);
      } catch {}
    }

    check();
    return () => { cancelled = true; };
  }, [screenKey]);

  async function handleClose() {
    setVisible(false);
    if (ALWAYS_SHOW_ONBOARDING) return;
    // Remember dismissal locally so it never shows again on this device
    AsyncStorage.setItem(storageKey(screenKey), "1").catch(() => {});
  }

  const content = (isGuest && screenKey === "community")
    ? { title: t("guest_welcome_title") || "Welcome to Alba!", body: t("guest_welcome_body") || "You can access the ticket by clicking on the small purple ticket button on the bottom right. If you like Alba, go to Settings and set up your account!" }
    : CONTENT[screenKey];
  if (!content) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        {/* Close button — top-left */}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
        >
          <Feather name="x" size={24} color="#fff" />
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>

          <TouchableOpacity style={styles.gotItBtn} onPress={handleClose} activeOpacity={0.85}>
            <Text style={styles.gotItBtnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  closeBtn: {
    position: "absolute",
    top: 52,
    left: 20,
    padding: 6,
    zIndex: 10,
  },
  content: {
    alignItems: "center",
    maxWidth: 320,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontFamily: "PoppinsBold",
    textAlign: "center",
    marginBottom: 16,
  },
  body: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 15,
    fontFamily: "Poppins",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 36,
  },
  gotItBtn: {
    backgroundColor: "#fff",
    paddingHorizontal: 36,
    paddingVertical: 13,
    borderRadius: 28,
  },
  gotItBtnText: {
    color: "#000",
    fontSize: 15,
    fontFamily: "PoppinsBold",
  },
});
