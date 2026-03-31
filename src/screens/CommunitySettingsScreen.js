// screens/CommunitySettingsScreen.js — tabbed layout
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
  View,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Text,
  Switch,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { posthog } from "../lib/analytics";
import MyEvents from "../components/community-settings/MyEvents";
import MyAds from "../components/community-settings/MyAds";
import CommunityEventSettings from "../components/community-settings/CommunityEventSettings";
import CommunityAdSettings from "../components/community-settings/CommunityAdSettings";
import { useFonts } from "expo-font";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import ThemedView from "../theme/ThemedView";
import ThemedText from "../theme/ThemedText";

import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import Constants from "expo-constants";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { saveNotifPrefs } from "../lib/notifications";
import PremiumPurchaseModal from "../components/PremiumPurchaseModal";
import OnboardingOverlay from "../components/OnboardingOverlay";

const TABS_KEYS = ["general", "events", "ads", "privacy"];

export default function CommunitySettingsScreen({ navigation }) {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const { theme, mode, setMode, isDark } = useAlbaTheme();
  const { language, setLanguage, t } = useAlbaLanguage();

  const TABS = [
    t("settings_tab_general") || "General",
    t("settings_tab_events") || "Events",
    t("settings_tab_ads") || "Ads",
    t("settings_tab_privacy") || "Privacy",
  ];

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const [activeTab, setActiveTab] = useState("general");

  const [userId, setUserId] = useState(null);
  const [showNews, setShowNews] = useState(true);
  const [visibleToAll, setVisibleToAll] = useState(false);
  const [allowDMs, setAllowDMs] = useState(true);
  const [showFollowedPosts, setShowFollowedPosts] = useState(false);

  const [allowTags, setAllowTags] = useState(true);

  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockedProfiles, setBlockedProfiles] = useState([]);
  const [unblockModalVisible, setUnblockModalVisible] = useState(false);
  const [unblockCandidate, setUnblockCandidate] = useState(null);

  const [followedUserIds, setFollowedUserIds] = useState([]);
  const [followedProfiles, setFollowedProfiles] = useState([]);
  const [unfollowModalVisible, setUnfollowModalVisible] = useState(false);
  const [unfollowCandidate, setUnfollowCandidate] = useState(null); // { id, username }
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Profile editing
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState(null); // null | 'checking' | 'available' | 'taken' | 'invalid'
  const [editPassword, setEditPassword] = useState("");
  const [editPasswordConfirm, setEditPasswordConfirm] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Premium features
  const { prefs, updatePrefs, reload } = useUserPreferences();
  const [premiumModal, setPremiumModal] = useState(null); // { featureName, description, price, endpoint } | null
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState([]);
  const [cityLoading, setCityLoading] = useState(false);
  const cityDebounceRef = useRef(null);
  const [diffusionRadiusUnit, setDiffusionRadiusUnit] = useState("km"); // "km" | "mi"
  // Local string state for the radius text input — avoids clamping mid-edit
  const [diffusionRadiusText, setDiffusionRadiusText] = useState("5");
  const diffusionInputFocused = useRef(false);

  // Collapsible sections — all start open
  const [sectionsOpen, setSectionsOpen] = useState({
    profile: true,
    appearance: true,
    language: true,
    feed: true,
    premium: true,
    notifications: true,
  });
  const toggleSection = (key) =>
    setSectionsOpen((p) => ({ ...p, [key]: !p[key] }));

  const [showNotifTimeDropdown, setShowNotifTimeDropdown] = useState(false);
  const [showRemindersCountDropdown, setShowRemindersCountDropdown] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const u = auth?.user;
      if (!u) return;

      setUserId(u.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("show_local_news, visible_to_all, allow_dms, blocked_users, name, username, is_verified, show_followed_users_posts, allow_tags, followed_users")
        .eq("id", u.id)
        .maybeSingle();

      if (error) { console.warn("[loadSettings] SELECT error:", JSON.stringify(error)); return; }
      if (!data) return;

      if (typeof data.show_local_news === "boolean") setShowNews(data.show_local_news);
      if (typeof data.visible_to_all === "boolean") setVisibleToAll(data.visible_to_all);
      if (typeof data.allow_dms === "boolean") setAllowDMs(data.allow_dms);
      if (typeof data.show_followed_users_posts === "boolean") setShowFollowedPosts(data.show_followed_users_posts);
      if (typeof data.allow_tags === "boolean") setAllowTags(data.allow_tags);
      const fu = Array.isArray(data.followed_users) ? data.followed_users : [];
      setFollowedUserIds(fu);
      if (typeof data.name === "string") setEditName(data.name);
      if (typeof data.username === "string") {
        setEditUsername(data.username);
        setOriginalUsername(data.username);
      }
      if (typeof data.is_verified === "boolean") setIsVerified(data.is_verified);

      const bu = Array.isArray(data.blocked_users) ? data.blocked_users : [];
      setBlockedUsers(bu);
    } catch {}
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useFocusEffect(
    useCallback(() => {
      posthog.screen("Settings");
      loadSettings();
      reload();
      return undefined;
    }, [loadSettings, reload])
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!blockedUsers.length) {
          if (mounted) setBlockedProfiles([]);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, name")
          .in("username", blockedUsers);

        if (!mounted) return;

        if (!error && data && data.length > 0) {
          setBlockedProfiles(data);
        } else {
          setBlockedProfiles(blockedUsers.map((u) => ({ id: u, username: u, name: null })));
        }
      } catch {
        if (mounted) {
          setBlockedProfiles(blockedUsers.map((u) => ({ id: u, username: u, name: null })));
        }
      }
    })();
    return () => { mounted = false; };
  }, [blockedUsers]);

  // Load followed user profiles (followedUserIds are UUIDs)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!followedUserIds.length) {
          if (mounted) setFollowedProfiles([]);
          return;
        }
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, name")
          .in("id", followedUserIds);
        if (!mounted) return;
        if (!error && data && data.length > 0) {
          setFollowedProfiles(data);
        } else {
          setFollowedProfiles([]);
        }
      } catch {
        if (mounted) setFollowedProfiles([]);
      }
    })();
    return () => { mounted = false; };
  }, [followedUserIds]);

  // Debounced username availability check
  useEffect(() => {
    const trimmed = editUsername.trim();
    if (!trimmed || trimmed.toLowerCase() === originalUsername.toLowerCase()) {
      setUsernameStatus(null);
      return;
    }
    if (trimmed.length < 3) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id")
          .ilike("username", trimmed)
          .maybeSingle();
        if (error) { setUsernameStatus(null); return; }
        setUsernameStatus(data ? "taken" : "available");
      } catch {
        setUsernameStatus(null);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [editUsername, originalUsername]);

  // Password strength checks
  const pwChecks = useMemo(() => ({
    length: editPassword.length >= 8,
    letter: /[a-zA-Z]/.test(editPassword),
    number: /[0-9]/.test(editPassword),
    special: /[^a-zA-Z0-9]/.test(editPassword),
  }), [editPassword]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#fff" }} />;

  const saveProfile = async () => {
    if (saving) return;
    setSaveError(null);
    setSaveSuccess(false);

    const trimmedUsername = editUsername.trim();
    const trimmedName = editName.trim();

    if (!trimmedUsername) {
      setSaveError("Username cannot be empty.");
      return;
    }
    if (usernameStatus === "checking") {
      setSaveError("Please wait while we check username availability.");
      return;
    }
    if (usernameStatus === "taken") {
      setSaveError("That username is already taken.");
      return;
    }
    if (usernameStatus === "invalid") {
      setSaveError("Username must be at least 3 characters.");
      return;
    }
    if (editPassword) {
      if (!pwChecks.length || !pwChecks.letter || !pwChecks.number || !pwChecks.special) {
        setSaveError("Password doesn't meet all requirements.");
        return;
      }
      if (editPassword !== editPasswordConfirm) {
        setSaveError("Passwords don't match.");
        return;
      }
    }

    setSaving(true);
    try {
      // Use RPC for username change so it stays consistent across the DB
      const { error: unErr } = await supabase.rpc("change_username", {
        p_new_username: trimmedUsername,
        p_new_name: trimmedName,
      });
      if (unErr) throw unErr;

      if (editPassword) {
        const { error: passErr } = await supabase.auth.updateUser({ password: editPassword });
        if (passErr) throw passErr;
        setEditPassword("");
        setEditPasswordConfirm("");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError(e?.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const updateProfile = (patch) => {
    if (!userId) { console.warn("[updateProfile] no userId"); return Promise.resolve(); }
    return supabase.from("profiles").update(patch).eq("id", userId)
      .then(({ error }) => { if (error) console.warn("[updateProfile] error:", JSON.stringify(error), "patch:", JSON.stringify(patch)); });
  };

  const updateBlockedUsers = (next) => {
    setBlockedUsers(next);
    updateProfile({ blocked_users: next });
  };

  const handleSetMode = (next) => {
    const prev = modeRef.current;
    if (typeof setMode !== "function") return;
    try { setMode(next); } catch {}
    setTimeout(() => {
      const cur = modeRef.current;
      if (cur === prev) {
        if (next === "auto") { try { setMode("system"); } catch {} }
        else if (next === "system") { try { setMode("auto"); } catch {} }
      }
    }, 60);
  };

  const nightAuto = mode === "auto" || mode === "system";
  const nightOn = mode === "dark";
  const nightOff = mode === "light";

  const renderCheckbox = (checked, label, onPress) => (
    <TouchableOpacity style={styles.checkboxRow} onPress={onPress} activeOpacity={0.7}>
      <ThemedView
        variant="gray"
        style={[
          styles.checkbox,
          { backgroundColor: theme.background, borderColor: isDark ? "#555" : "#c9d8ee" },
          checked && styles.checkboxChecked,
        ]}
      >
        {checked && <Feather name="check" size={12} color="#fff" />}
      </ThemedView>
      <ThemedText style={[styles.checkboxLabel, { color: theme.text }]}>{label}</ThemedText>
    </TouchableOpacity>
  );

  const openUnblockModal = (username) => {
    setUnblockCandidate(username);
    setUnblockModalVisible(true);
  };

  const closeUnblockModal = () => {
    setUnblockCandidate(null);
    setUnblockModalVisible(false);
  };

  const confirmUnblock = () => {
    if (!unblockCandidate) { closeUnblockModal(); return; }
    const next = blockedUsers.filter((u) => u !== unblockCandidate);
    updateBlockedUsers(next);
    closeUnblockModal();
  };

  const openUnfollowModal = (profile) => {
    setUnfollowCandidate(profile);
    setUnfollowModalVisible(true);
  };

  const closeUnfollowModal = () => {
    setUnfollowCandidate(null);
    setUnfollowModalVisible(false);
  };

  const confirmUnfollow = async () => {
    if (!unfollowCandidate) { closeUnfollowModal(); return; }
    const next = followedUserIds.filter((id) => id !== unfollowCandidate.id);
    setFollowedUserIds(next);
    updateProfile({ followed_users: next });
    closeUnfollowModal();
  };

  const handleLogout = () => setLogoutModalVisible(true);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Not logged in.");
      const API_URL =
        Constants.expoConfig?.extra?.expoPublic?.API_URL ?? "http://localhost:3000";
      const res = await fetch(`${API_URL}/delete-account`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Server error");
      await supabase.auth.signOut().catch(() => {});
    } catch (e) {
      Alert.alert("Error", "Could not delete account. Please try again or contact support.");
    } finally {
      setDeleting(false);
      setDeleteModalVisible(false);
    }
  };

  const handleAdFreePress = () => {
    if (prefs.premiumAdFree) {
      updatePrefs({ premiumAdFree: false });
      return;
    }
    setPremiumModal({
      featureName: "Ad-Free",
      description: "Browse Community without ads.",
      price: "€5.00/month",
      endpoint: "/create-payment-intent/premium-ad-free",
    });
  };

  const handleTravelerPress = () => {
    if (prefs.premiumTravelerMode) {
      updatePrefs({ premiumTravelerMode: false, travelerModeCity: null, travelerModeCityCoords: null });
      return;
    }
    setPremiumModal({
      featureName: "Traveler Mode",
      description: "Access Community in any city worldwide.",
      price: "€5.00/week",
      endpoint: "/create-payment-intent/premium-traveler",
    });
  };

  const handleDiffusionPress = () => {
    if (prefs.premiumDiffusionList) {
      updatePrefs({ premiumDiffusionList: false });
      return;
    }
    setPremiumModal({
      featureName: "Diffusion List",
      description: "Broadcast a message to all Alba users nearby.",
      price: "€1.00 per message",
      endpoint: "/create-payment-intent/diffusion-message",
    });
  };

  // Called by steppers — commits immediately and syncs display text
  const stepDiffusionRadius = (newDisplayVal) => {
    const clamped = Math.min(50, Math.max(1, Math.round(newDisplayVal)));
    const km = diffusionRadiusUnit === "mi" ? Math.round(clamped * 1.60934) : clamped;
    const clampedKm = Math.min(50, Math.max(1, km));
    updatePrefs({ diffusionRadiusKm: clampedKm });
    setDiffusionRadiusText(String(clamped));
  };

  // Called on input blur — clamps and commits whatever the user typed
  const commitDiffusionRadiusText = () => {
    diffusionInputFocused.current = false;
    const parsed = parseInt(diffusionRadiusText, 10);
    const displayVal = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 1;
    const km = diffusionRadiusUnit === "mi" ? Math.round(displayVal * 1.60934) : displayVal;
    const clampedKm = Math.min(50, Math.max(1, km));
    updatePrefs({ diffusionRadiusKm: clampedKm });
    setDiffusionRadiusText(String(displayVal));
  };

  // Sync display text when prefs or unit changes (but not while user is typing)
  useEffect(() => {
    if (diffusionInputFocused.current) return;
    const displayVal = diffusionRadiusUnit === "mi"
      ? Math.round(prefs.diffusionRadiusKm / 1.60934)
      : prefs.diffusionRadiusKm;
    setDiffusionRadiusText(String(displayVal));
  }, [prefs.diffusionRadiusKm, diffusionRadiusUnit]);

  const handleSelectCity = async (feature) => {
    const name = feature.place_name;
    const [lng, lat] = feature.center;
    await updatePrefs({ travelerModeCity: name, travelerModeCityCoords: { lat, lng } });
    setCityQuery("");
    setCityResults([]);
  };

  // City search debounce — 400ms, Mapbox Geocoding REST API (no native SDK needed)
  useEffect(() => {
    if (!prefs.premiumTravelerMode) return;
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    if (!cityQuery.trim()) { setCityResults([]); return; }
    cityDebounceRef.current = setTimeout(async () => {
      setCityLoading(true);
      try {
        const token = Constants.expoConfig?.extra?.expoPublic?.MAPBOX_PUBLIC_TOKEN ?? "";
        const q = encodeURIComponent(cityQuery.trim());
        const res = await fetch(
          `https://api.mapbox.com/search/geocode/v6/forward?q=${q}&types=place&limit=5&access_token=${token}`
        );
        const json = await res.json();
        // Normalize v6 → v5-compatible shape (place_name + center)
        const normalized = (json.features || []).map((f) => ({
          id: f.id,
          place_name: f.properties?.place_formatted ?? f.properties?.name ?? "",
          center: f.geometry?.coordinates ?? [],
        }));
        setCityResults(normalized);
      } catch { setCityResults([]); }
      finally { setCityLoading(false); }
    }, 400);
    return () => clearTimeout(cityDebounceRef.current);
  }, [cityQuery, prefs.premiumTravelerMode]);

  const bg = isDark ? "#1a1a1a" : "#fff";
  const cardBg = isDark ? "#2b2b2b" : "#f6f8fb";
  const textColor = theme.text;
  const secondaryText = isDark ? "#aaa" : "#6F7D95";
  const borderColor = isDark ? "#444" : "#d9e4f3";
  const accent = "#00A9FF";

  // Which segment is active for the theme selector
  const themeSegment = nightAuto ? "auto" : nightOn ? "dark" : "light";

  const renderSectionHeader = (key, label, extraStyle) => (
    <TouchableOpacity
      onPress={() => toggleSection(key)}
      style={[
        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
        extraStyle,
      ]}
      activeOpacity={0.7}
    >
      <Text style={[styles.sectionLabel, { color: secondaryText, marginTop: 0 }]}>{label}</Text>
      <Feather
        name={sectionsOpen[key] ? "chevron-up" : "chevron-down"}
        size={16}
        color={secondaryText}
      />
    </TouchableOpacity>
  );

  const renderTabContent = () => {
    if (activeTab === "general") {
      return (
        <>
          {/* ── Profile ── */}
          {renderSectionHeader("profile", t("settings_profile_section"))}
          {sectionsOpen.profile && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={{ padding: 14 }}>
              {/* Verification badge */}
              <TouchableOpacity
                style={styles.verifiedRow}
                activeOpacity={isVerified ? 1 : 0.7}
                onPress={() => { if (!isVerified) navigation.navigate("PreFaceRecognition"); }}
              >
                <Feather
                  name={isVerified ? "check-circle" : "alert-circle"}
                  size={15}
                  color={isVerified ? "#4CAF50" : "#F59E0B"}
                  style={{ marginRight: 7 }}
                />
                <Text style={[styles.verifiedText, { color: isVerified ? "#4CAF50" : "#F59E0B" }]}>
                  {isVerified ? t("settings_verified") : t("settings_not_verified")}
                </Text>
              </TouchableOpacity>

              <TextInput
                style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: textColor, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}
                placeholder={t("settings_name_placeholder")}
                placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
                value={editName}
                onChangeText={setEditName}
              />
              <TextInput
                style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: textColor, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}
                placeholder={t("settings_username_placeholder")}
                placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
                autoCapitalize="none"
                autoCorrect={false}
                value={editUsername}
                onChangeText={setEditUsername}
              />
              {usernameStatus === "checking" && (
                <View style={styles.usernameStatusRow}>
                  <ActivityIndicator size="small" color={accent} style={{ marginRight: 5 }} />
                  <Text style={[styles.usernameStatusText, { color: secondaryText }]}>{t("settings_checking_username")}</Text>
                </View>
              )}
              {usernameStatus === "available" && (
                <View style={styles.usernameStatusRow}>
                  <Feather name="check-circle" size={13} color="#4CAF50" style={{ marginRight: 5 }} />
                  <Text style={[styles.usernameStatusText, { color: "#4CAF50" }]}>{t("settings_username_available")}</Text>
                </View>
              )}
              {usernameStatus === "taken" && (
                <View style={styles.usernameStatusRow}>
                  <Feather name="x-circle" size={13} color="#E55353" style={{ marginRight: 5 }} />
                  <Text style={[styles.usernameStatusText, { color: "#E55353" }]}>{t("settings_username_taken")}</Text>
                </View>
              )}
              {usernameStatus === "invalid" && (
                <View style={styles.usernameStatusRow}>
                  <Text style={[styles.usernameStatusText, { color: "#F59E0B" }]}>{t("settings_username_invalid")}</Text>
                </View>
              )}
              <TextInput
                style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: textColor, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}
                placeholder={t("settings_password_placeholder")}
                placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
                secureTextEntry
                value={editPassword}
                onChangeText={setEditPassword}
              />
              {!!editPassword && (
                <>
                  {[
                    { key: "length",  label: "At least 8 characters" },
                    { key: "letter",  label: "Contains a letter" },
                    { key: "number",  label: "Contains a number" },
                    { key: "special", label: "Contains a special character (!@#…)" },
                  ].map(({ key, label }) => (
                    <View key={key} style={styles.pwCheckRow}>
                      <Feather
                        name={pwChecks[key] ? "check" : "x"}
                        size={12}
                        color={pwChecks[key] ? "#4CAF50" : "#E55353"}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={[styles.pwCheckText, { color: pwChecks[key] ? "#4CAF50" : "#E55353" }]}>
                        {label}
                      </Text>
                    </View>
                  ))}
                  <TextInput
                    style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: textColor, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa", marginTop: 8 }]}
                    placeholder={t("settings_confirm_password")}
                    placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
                    secureTextEntry
                    value={editPasswordConfirm}
                    onChangeText={setEditPasswordConfirm}
                  />
                </>
              )}

              {!!saveError && (
                <Text style={styles.saveErrorText}>{saveError}</Text>
              )}
              {saveSuccess && (
                <Text style={styles.saveSuccessText}>{t("settings_saved")}</Text>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                onPress={saveProfile}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>{t("settings_save_changes")}</Text>}
              </TouchableOpacity>
            </View>
          </View>)}

          {/* ── Appearance ── */}
          {renderSectionHeader("appearance", t("appearance_section_title"))}
          {sectionsOpen.appearance && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            {[
              { key: "auto",  label: t("night_auto")  || "Auto"  },
              { key: "light", label: t("night_off")   || "Light" },
              { key: "dark",  label: t("night_on")    || "Dark"  },
            ].map(({ key, label }, idx) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.listOptionRow,
                  { borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: borderColor },
                ]}
                onPress={() => handleSetMode(key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.rowTitle, { color: textColor, fontWeight: "400" }]}>{label}</Text>
                {themeSegment === key && <Feather name="check" size={16} color={accent} />}
              </TouchableOpacity>
            ))}
          </View>)}

          {/* ── Language ── */}
          {renderSectionHeader("language", t("language_section_title"))}
          {sectionsOpen.language && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            {[
              { key: "en", label: t("language_en") || "English"  },
              { key: "it", label: t("language_it") || "Italiano" },
            ].map(({ key, label }, idx) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.listOptionRow,
                  { borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: borderColor },
                ]}
                onPress={() => setLanguage(key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.rowTitle, { color: textColor, fontWeight: "400" }]}>{label}</Text>
                {language === key && <Feather name="check" size={16} color={accent} />}
              </TouchableOpacity>
            ))}
          </View>)}

          {/* ── Feed preferences ── */}
          {renderSectionHeader("feed", "Feed")}
          {sectionsOpen.feed && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.rowTitle, { color: textColor }]}>{t("show_local_news")}</Text>
              </View>
              <Switch
                value={showNews}
                onValueChange={async (val) => {
                  setShowNews(val);
                  await updateProfile({ show_local_news: val });
                }}
                trackColor={{ false: borderColor, true: accent }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.rowBetween, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.rowTitle, { color: textColor }]}>{t("show_followed_posts")}</Text>
              </View>
              <Switch
                value={showFollowedPosts}
                onValueChange={async (val) => {
                  setShowFollowedPosts(val);
                  await updateProfile({ show_followed_users_posts: val });
                }}
                trackColor={{ false: borderColor, true: accent }}
                thumbColor="#fff"
              />
            </View>
          </View>)}

          {/* ── Alba Premium ── */}
          {renderSectionHeader("premium", t("premium_section_title"))}
          {sectionsOpen.premium && (
          <View style={styles.premiumSection}>
            {/* Ad-Free checkbox */}
            <TouchableOpacity style={styles.checkboxRow} onPress={handleAdFreePress} activeOpacity={0.7}>
              <View style={[styles.premiumCheckbox, prefs.premiumAdFree && styles.premiumCheckboxChecked]}>
                {prefs.premiumAdFree && <Feather name="check" size={12} color="#00A9FF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumLabel}>{t("premium_ad_free_label")}</Text>
                <Text style={styles.premiumSublabel}>{t("premium_ad_free_sub")}</Text>
              </View>
            </TouchableOpacity>

            {/* Traveler Mode checkbox */}
            <TouchableOpacity style={[styles.checkboxRow, { marginTop: 12 }]} onPress={handleTravelerPress} activeOpacity={0.7}>
              <View style={[styles.premiumCheckbox, prefs.premiumTravelerMode && styles.premiumCheckboxChecked]}>
                {prefs.premiumTravelerMode && <Feather name="check" size={12} color="#00A9FF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumLabel}>{t("premium_traveler_label")}</Text>
                <Text style={styles.premiumSublabel}>{t("premium_traveler_sub")}</Text>
              </View>
            </TouchableOpacity>

            {/* City search — only shown when Traveler Mode is active */}
            {prefs.premiumTravelerMode && (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  style={styles.premiumInput}
                  placeholder={t("premium_traveler_city_placeholder")}
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  value={cityQuery}
                  onChangeText={setCityQuery}
                />
                {cityLoading && <ActivityIndicator size="small" color="#fff" style={{ marginTop: 6 }} />}
                {cityResults.length > 0 && (
                  <View style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 8, marginTop: 4, overflow: "hidden" }}>
                    {cityResults.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        onPress={() => handleSelectCity(item)}
                        style={{ padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(0,0,0,0.15)" }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Poppins" }}>
                          {item.place_name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <Text style={styles.premiumSublabel}>
                  {prefs.travelerModeCity
                    ? t("premium_traveler_browsing").replace("{city}", prefs.travelerModeCity)
                    : t("premium_traveler_no_city")}
                </Text>
              </View>
            )}

            {/* Diffusion List checkbox */}
            <TouchableOpacity style={[styles.checkboxRow, { marginTop: 12 }]} onPress={handleDiffusionPress} activeOpacity={0.7}>
              <View style={[styles.premiumCheckbox, prefs.premiumDiffusionList && styles.premiumCheckboxChecked]}>
                {prefs.premiumDiffusionList && <Feather name="check" size={12} color="#00A9FF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumLabel}>{t("premium_diffusion_label")}</Text>
                <Text style={styles.premiumSublabel}>{t("premium_diffusion_sub")}</Text>
              </View>
            </TouchableOpacity>

            {/* Radius input — shown when Diffusion List is active */}
            {prefs.premiumDiffusionList && (
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.premiumSublabel, { fontWeight: "600", marginBottom: 8 }]}>
                  {t("premium_broadcast_radius")}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      const cur = diffusionRadiusUnit === "mi"
                        ? Math.round(prefs.diffusionRadiusKm / 1.60934)
                        : prefs.diffusionRadiusKm;
                      stepDiffusionRadius(cur - 1);
                    }}
                    style={styles.premiumStepper}
                  >
                    <Text style={styles.premiumStepperText}>−</Text>
                  </TouchableOpacity>

                  <TextInput
                    style={styles.premiumRadiusInput}
                    keyboardType="numeric"
                    value={diffusionRadiusText}
                    onChangeText={(v) => {
                      const digits = v.replace(/[^0-9]/g, "");
                      if (digits === "") { setDiffusionRadiusText(""); return; }
                      const n = parseInt(digits, 10);
                      if (n > 50) setDiffusionRadiusText("50");
                      else if (n < 1) setDiffusionRadiusText("1");
                      else setDiffusionRadiusText(digits);
                    }}
                    onFocus={() => { diffusionInputFocused.current = true; }}
                    onBlur={commitDiffusionRadiusText}
                  />

                  <TouchableOpacity
                    onPress={() => {
                      const cur = diffusionRadiusUnit === "mi"
                        ? Math.round(prefs.diffusionRadiusKm / 1.60934)
                        : prefs.diffusionRadiusKm;
                      stepDiffusionRadius(cur + 1);
                    }}
                    style={styles.premiumStepper}
                  >
                    <Text style={styles.premiumStepperText}>+</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setDiffusionRadiusUnit((u) => u === "km" ? "mi" : "km")}
                    style={styles.premiumUnitToggle}
                  >
                    <Text style={{ color: "#fff", fontFamily: "Poppins", fontSize: 13 }}>{diffusionRadiusUnit}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.premiumSublabel, { marginTop: 4 }]}>
                  {t("premium_radius_hint").replace(/{unit}/g, diffusionRadiusUnit)}
                </Text>

                {/* Estimated users — placeholder formula, replace with real DB query once density data exists */}
                <Text style={[styles.premiumSublabel, { marginTop: 6 }]}>
                  {t("premium_reach_users").replace("{n}", Math.round(prefs.diffusionRadiusKm * prefs.diffusionRadiusKm * Math.PI * 0.8))}
                </Text>
              </View>
            )}
          </View>)}

          {/* ── Notifications ── */}
          {renderSectionHeader("notifications", t("notif_section_title"))}
          {sectionsOpen.notifications && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            {[
              { key: "notifChatMessages",  label: t("notif_direct_messages"),   sub: t("notif_direct_messages_sub") },
              { key: "notifGroupMessages", label: t("notif_group_messages"),     sub: t("notif_group_messages_sub") },
              { key: "notifDiffusion",     label: t("notif_diffusion"),          sub: t("notif_diffusion_sub") },
              { key: "notifFollowedPosts", label: t("notif_followed_posts"),     sub: t("notif_followed_posts_sub") },
            ].map(({ key, label, sub }, idx) => (
              <View
                key={key}
                style={[
                  styles.rowBetween,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor },
                ]}
              >
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={[styles.rowTitle, { color: textColor }]}>{label}</Text>
                  <Text style={[styles.rowSub, { color: secondaryText }]}>{sub}</Text>
                </View>
                <Switch
                  value={prefs[key] ?? true}
                  onValueChange={(val) => {
                    updatePrefs({ [key]: val });
                    saveNotifPrefs({ ...prefs, [key]: val });
                  }}
                  trackColor={{ false: borderColor, true: accent }}
                  thumbColor="#fff"
                />
              </View>
            ))}

            {/* ── Screen time intraday reminders count picker ── */}
            {(() => {
              const count = prefs.screenTimeRemindersCount ?? 3;
              const countOptions = [
                { value: 0, label: "Off" },
                { value: 1, label: "1×" },
                { value: 2, label: "2×" },
                { value: 3, label: "3×" },
              ];
              return (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={[styles.rowTitle, { color: textColor }]}>Screen Time reminders</Text>
                      <Text style={[styles.rowSub, { color: secondaryText }]}>
                        {Platform.OS === "ios"
                          ? "Daily mindfulness nudges to keep your screen time streak going"
                          : "Alerts at 50%, 90% and 99% of your daily screen time goal"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setShowRemindersCountDropdown(p => !p)}
                      style={{ flexDirection: "row", alignItems: "center" }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.rowSub, { color: accent, fontFamily: "PoppinsBold", marginRight: 4 }]}>
                        {count === 0 ? "Off" : `${count}×`}
                      </Text>
                      <Feather name={showRemindersCountDropdown ? "chevron-up" : "chevron-down"} size={14} color={accent} />
                    </TouchableOpacity>
                  </View>
                  {showRemindersCountDropdown && (
                    <View style={{ paddingBottom: 4 }}>
                      {countOptions.map((opt) => {
                        const selected = opt.value === count;
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                            onPress={() => {
                              updatePrefs({ screenTimeRemindersCount: opt.value });
                              setShowRemindersCountDropdown(false);
                            }}
                          >
                            <Text style={[styles.rowSub, { color: selected ? accent : textColor, fontFamily: selected ? "PoppinsBold" : "Poppins" }]}>{opt.label}</Text>
                            {selected && <Feather name="check" size={14} color={accent} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })()}

            {/* ── Screen time notification time ── */}
            {(() => {
              const notifHour = prefs.screenTimeNotifHour ?? 8;
              const notifMinute = prefs.screenTimeNotifMinute ?? 0;
              const timeOptions = [
                { hour: 6, minute: 0 }, { hour: 6, minute: 30 },
                { hour: 7, minute: 0 }, { hour: 7, minute: 30 },
                { hour: 8, minute: 0 }, { hour: 8, minute: 30 },
                { hour: 9, minute: 0 }, { hour: 9, minute: 30 },
                { hour: 10, minute: 0 },
              ];
              const label12 = (h, m) => {
                const ampm = h < 12 ? "AM" : "PM";
                const h12 = h % 12 === 0 ? 12 : h % 12;
                return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
              };
              return (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={[styles.rowTitle, { color: textColor }]}>{t("notif_screentime_time_label")}</Text>
                      <Text style={[styles.rowSub, { color: secondaryText }]}>{t("notif_screentime_time_sub")}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setShowNotifTimeDropdown(p => !p)}
                      style={{ flexDirection: "row", alignItems: "center" }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.rowSub, { color: accent, fontFamily: "PoppinsBold", marginRight: 4 }]}>{label12(notifHour, notifMinute)}</Text>
                      <Feather name={showNotifTimeDropdown ? "chevron-up" : "chevron-down"} size={14} color={accent} />
                    </TouchableOpacity>
                  </View>
                  {showNotifTimeDropdown && (
                    <View style={{ paddingBottom: 4 }}>
                      {timeOptions.map((opt) => {
                        const selected = opt.hour === notifHour && opt.minute === notifMinute;
                        return (
                          <TouchableOpacity
                            key={`${opt.hour}:${opt.minute}`}
                            style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                            onPress={() => {
                              updatePrefs({ screenTimeNotifHour: opt.hour, screenTimeNotifMinute: opt.minute, scheduledMorningNotifId: null, scheduledWeeklyNotifId: null });
                              setShowNotifTimeDropdown(false);
                            }}
                          >
                            <Text style={[styles.rowSub, { color: selected ? accent : textColor, fontFamily: selected ? "PoppinsBold" : "Poppins" }]}>{label12(opt.hour, opt.minute)}</Text>
                            {selected && <Feather name="check" size={14} color={accent} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })()}
          </View>)}
        </>
      );
    }

    if (activeTab === "events") {
      return (
        <>
          <MyEvents navigation={navigation} />
          <CommunityEventSettings />
        </>
      );
    }

    if (activeTab === "ads") {
      return (
        <>
          <MyAds navigation={navigation} />
          <CommunityAdSettings navigation={navigation} />
        </>
      );
    }

    if (activeTab === "privacy") {
      return (
        <>
          {/* ── Visibility & messaging ── */}
          <Text style={[styles.sectionLabel, { color: secondaryText, marginTop: 16 }]}>Visibility & messaging</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.rowTitle, { color: textColor }]}>{t("profile_visible_to_all")}</Text>
              </View>
              <Switch
                value={visibleToAll}
                onValueChange={async (val) => {
                  setVisibleToAll(val);
                  await supabase.rpc("update_privacy_settings", { p_visible_to_all: val, p_allow_dms: allowDMs });
                }}
                trackColor={{ false: borderColor, true: accent }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.rowBetween, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.rowTitle, { color: textColor }]}>{t("allow_dms_anyone")}</Text>
              </View>
              <Switch
                value={allowDMs}
                onValueChange={async (val) => {
                  setAllowDMs(val);
                  await supabase.rpc("update_privacy_settings", { p_visible_to_all: visibleToAll, p_allow_dms: val });
                }}
                trackColor={{ false: borderColor, true: accent }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.rowBetween, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.rowTitle, { color: textColor }]}>{t("settings_block_diffusion") || "Block Diffusion Messages"}</Text>
                <Text style={[styles.rowSub, { color: secondaryText }]}>
                  {t("settings_block_diffusion_sub") || "You won't receive broadcast messages from other users"}
                </Text>
              </View>
              <Switch
                value={prefs.blockDiffusionMessages}
                onValueChange={(val) => updatePrefs({ blockDiffusionMessages: val })}
                trackColor={{ false: borderColor, true: accent }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.rowBetween, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.rowTitle, { color: textColor }]}>{t("settings_allow_tags") || "Allow others to tag me"}</Text>
                <Text style={[styles.rowSub, { color: secondaryText }]}>
                  {t("settings_allow_tags_sub") || "Others can @mention you in their posts"}
                </Text>
              </View>
              <Switch
                value={allowTags}
                onValueChange={async (val) => {
                  setAllowTags(val);
                  await updateProfile({ allow_tags: val });
                }}
                trackColor={{ false: borderColor, true: accent }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* ── Followed users ── */}
          <Text style={[styles.sectionLabel, { color: secondaryText }]}>{t("settings_followed_users_title") || "Following"}</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            {followedProfiles.length === 0 ? (
              <View style={{ padding: 14 }}>
                <Text style={[styles.rowSub, { color: secondaryText }]}>{t("settings_no_following") || "You're not following anyone yet."}</Text>
              </View>
            ) : (
              <FlatList
                data={followedProfiles}
                keyExtractor={(item) => item.id || item.username || Math.random().toString()}
                scrollEnabled={false}
                renderItem={({ item, index }) => (
                  <View
                    style={[
                      styles.blockedRow,
                      { paddingHorizontal: 14 },
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.blockedName, { color: textColor }]} numberOfLines={1}>
                        {item.name || `@${item.username}`}
                      </Text>
                      <Text style={[styles.blockedUsername, { color: secondaryText }]} numberOfLines={1}>
                        @{item.username}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => openUnfollowModal(item)} hitSlop={8}>
                      <Feather name="x" size={18} color={textColor} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>

          {/* ── Blocked users ── */}
          <Text style={[styles.sectionLabel, { color: secondaryText }]}>{t("settings_blocked_users_title")}</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            {blockedProfiles.length === 0 ? (
              <View style={{ padding: 14 }}>
                <Text style={[styles.rowSub, { color: secondaryText }]}>{t("settings_no_blocked")}</Text>
              </View>
            ) : (
              <FlatList
                data={blockedProfiles}
                keyExtractor={(item) => item.id || item.username || Math.random().toString()}
                scrollEnabled={false}
                renderItem={({ item, index }) => (
                  <View
                    style={[
                      styles.blockedRow,
                      { paddingHorizontal: 14 },
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.blockedName, { color: textColor }]} numberOfLines={1}>
                        {item.name || `@${item.username}`}
                      </Text>
                      <Text style={[styles.blockedUsername, { color: secondaryText }]} numberOfLines={1}>
                        @{item.username}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => openUnblockModal(item.username)} hitSlop={8}>
                      <Feather name="x" size={18} color={textColor} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </>
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: isDark ? theme.gray : theme.background }]}>
      <ThemedView variant="gray" style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>
        <ThemedText style={[styles.headerTitle, { color: theme.text }]}>
          {t("community_settings_title")}
        </ThemedText>
        <ThemedView variant="gray" style={{ width: 24 }} />
      </ThemedView>

      {/* Tab bar */}
      <ThemedView variant="gray" style={styles.tabBar}>
        {TABS.map((tab, idx) => {
          const tabKey = TABS_KEYS[idx];
          const isActive = activeTab === tabKey;
          return (
            <TouchableOpacity
              key={tabKey}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tabKey)}
              activeOpacity={0.7}
            >
              <ThemedText style={[styles.tabLabel, { color: isActive ? "#00A9FF" : (isDark ? "#aaa" : "#6F7D95") }]}>
                {tab}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ThemedView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 16 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderTabContent()}

          {/* Always-visible bottom actions */}
          <TouchableOpacity
            onPress={() => navigation.navigate("SavedPosts")}
            style={[styles.savedPostsBtn, { backgroundColor: isDark ? theme.gray : theme.background }]}
            activeOpacity={0.7}
          >
            <ThemedText style={[styles.savedPostsBtnText, { color: theme.text }]}>
              {t("saved_posts_button")}
            </ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Linking.openURL("mailto:support@albaappofficial.com")}
            style={[styles.logoutBtn, { backgroundColor: isDark ? theme.gray : theme.background }]}
            activeOpacity={0.7}
          >
            <ThemedText style={[styles.logoutBtnText, { color: theme.text }]}>Contact Support</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Linking.openURL("https://albaappofficial.com/feedback")}
            style={[styles.logoutBtn, { backgroundColor: isDark ? theme.gray : theme.background }]}
            activeOpacity={0.7}
          >
            <ThemedText style={[styles.logoutBtnText, { color: theme.text }]}>Send Feedback</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleLogout}
            style={[styles.logoutBtn, { backgroundColor: isDark ? theme.gray : theme.background }]}
            activeOpacity={0.7}
          >
            <ThemedText style={styles.logoutBtnText}>{t("settings_logout")}</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setDeleteModalVisible(true)}
            style={[styles.deleteAccountBtn, { backgroundColor: isDark ? theme.gray : theme.background }]}
            activeOpacity={0.7}
          >
            <Text style={styles.deleteAccountBtnText}>{t("settings_delete_account")}</Text>
          </TouchableOpacity>

          <ThemedView variant="gray" style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={unblockModalVisible} transparent animationType="fade" onRequestClose={closeUnblockModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.unblockModalContent, { backgroundColor: isDark ? theme.gray : theme.background }]}>
            <ThemedText style={[styles.unblockTitle, { color: theme.text }]}>
              Are you sure you want to unblock this user?
            </ThemedText>
            <View style={styles.unblockButtonsRow}>
              <TouchableOpacity style={[styles.unblockBtnSmall, styles.unblockNoBtn]} onPress={closeUnblockModal}>
                <ThemedText style={styles.unblockBtnSmallText}>No</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.unblockBtnSmall, styles.unblockYesBtn]} onPress={confirmUnblock}>
                <ThemedText style={[styles.unblockBtnSmallText, { color: "#fff" }]}>Yes</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={unfollowModalVisible} transparent animationType="fade" onRequestClose={closeUnfollowModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.unblockModalContent, { backgroundColor: isDark ? theme.gray : theme.background }]}>
            <ThemedText style={[styles.unblockTitle, { color: theme.text }]}>
              {t("settings_unfollow_confirm") || `Unfollow @${unfollowCandidate?.username || ""}?`}
            </ThemedText>
            <View style={styles.unblockButtonsRow}>
              <TouchableOpacity style={[styles.unblockBtnSmall, styles.unblockNoBtn]} onPress={closeUnfollowModal}>
                <ThemedText style={styles.unblockBtnSmallText}>{t("confirm_no") || "No"}</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.unblockBtnSmall, styles.unblockYesBtn]} onPress={confirmUnfollow}>
                <ThemedText style={[styles.unblockBtnSmallText, { color: "#fff" }]}>{t("confirm_yes") || "Yes"}</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={logoutModalVisible} transparent animationType="fade" onRequestClose={() => setLogoutModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.unblockModalContent, { backgroundColor: isDark ? theme.gray : theme.background }]}>
            <ThemedText style={[styles.unblockTitle, { color: theme.text }]}>
              {t("logout_confirm") || "Are you sure you want to log out?"}
            </ThemedText>
            <View style={styles.unblockButtonsRow}>
              <TouchableOpacity style={[styles.unblockBtnSmall, styles.unblockNoBtn]} onPress={() => setLogoutModalVisible(false)}>
                <ThemedText style={styles.unblockBtnSmallText}>{t("cancel_button") || "Cancel"}</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unblockBtnSmall, { backgroundColor: "#E55353" }]}
                onPress={async () => {
                  setLogoutModalVisible(false);
                  try { await supabase.auth.signOut(); } catch {}
                }}
              >
                <ThemedText style={[styles.unblockBtnSmallText, { color: "#fff" }]}>
                  {t("logout_title") || "Log out"}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete account confirmation modal ── */}
      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.unblockModalContent, { backgroundColor: isDark ? theme.gray : theme.background }]}>
            <ThemedText style={[styles.unblockTitle, { color: theme.text }]}>
              {t("settings_delete_title")}
            </ThemedText>
            <ThemedText style={{ fontFamily: "Poppins", fontSize: 13, color: theme.secondaryText, textAlign: "center", marginBottom: 16 }}>
              {t("settings_delete_body")}
            </ThemedText>
            <View style={styles.unblockButtonsRow}>
              <TouchableOpacity
                style={[styles.unblockBtnSmall, styles.unblockNoBtn]}
                onPress={() => setDeleteModalVisible(false)}
                disabled={deleting}
              >
                <ThemedText style={styles.unblockBtnSmallText}>{t("cancel_button")}</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unblockBtnSmall, { backgroundColor: "#E55353", opacity: deleting ? 0.6 : 1 }]}
                onPress={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <ThemedText style={[styles.unblockBtnSmallText, { color: "#fff" }]}>{t("settings_delete_confirm")}</ThemedText>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {premiumModal && (
        <PremiumPurchaseModal
          visible={!!premiumModal}
          onClose={() => setPremiumModal(null)}
          onSuccess={async () => {
            const ep = premiumModal.endpoint;
            if (ep.includes("ad-free")) {
              await updatePrefs({ premiumAdFree: true });
            } else if (ep.includes("traveler")) {
              await updatePrefs({ premiumTravelerMode: true });
            } else if (ep.includes("diffusion")) {
              await updatePrefs({ premiumDiffusionList: true });
            }
            setPremiumModal(null);
          }}
          featureName={premiumModal.featureName}
          description={premiumModal.description}
          price={premiumModal.price}
          paymentEndpoint={premiumModal.endpoint}
          userId={userId || ""}
        />
      )}

      <OnboardingOverlay screenKey="settings" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: { padding: 2 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontFamily: "PoppinsBold",
  },

  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d0d7e2",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabItemActive: {
    borderBottomColor: "#00A9FF",
  },
  tabLabel: {
    fontSize: 13,
    fontFamily: "PoppinsBold",
  },

  content: { paddingHorizontal: 15 },

  // FeedSettings-style card
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "PoppinsBold",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 2,
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

  // List-style option row (theme / language)
  listOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  // Legacy checkbox (kept for renderCheckbox still used in Premium section indirectly)
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#00A9FF",
    borderColor: "#00A9FF",
  },
  checkboxLabel: {
    fontSize: 14,
    fontFamily: "Poppins",
  },
  // ── Premium (blue) section styles ──
  premiumSection: {
    backgroundColor: "#0077CC",
    marginTop: 16,
    marginBottom: 4,
    marginHorizontal: -15, // bleed out of ScrollView's paddingHorizontal: 15
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  premiumHeader: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
    marginBottom: 10,
  },
  premiumLabel: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 14,
  },
  premiumSublabel: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Poppins",
    fontSize: 12,
    marginTop: 1,
  },
  premiumCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  premiumCheckboxChecked: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  premiumInput: {
    color: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Poppins",
    fontSize: 14,
    marginTop: 4,
  },
  premiumStepper: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumStepperText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
  },
  premiumRadiusInput: {
    color: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.5)",
    fontFamily: "Poppins",
    fontSize: 16,
    minWidth: 40,
    textAlign: "center",
    paddingVertical: 2,
  },
  premiumUnitToggle: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  savedPostsBtn: {
    marginTop: 24,
    paddingVertical: 12,
    alignItems: "center",
  },
  savedPostsBtnText: {
    fontSize: 16,
    fontFamily: "PoppinsBold",
  },
  logoutBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutBtnText: {
    fontSize: 16,
    fontFamily: "PoppinsBold",
    color: "#E55353",
  },
  deleteAccountBtn: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteAccountBtnText: {
    fontSize: 13,
    fontFamily: "Poppins",
    color: "#999",
    textDecorationLine: "underline",
  },

  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 4,
  },
  verifiedText: {
    fontFamily: "Poppins",
    fontSize: 13,
    flex: 1,
  },
  profileInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: "Poppins",
    fontSize: 14,
    marginBottom: 10,
  },
  saveBtn: {
    height: 42,
    borderRadius: 10,
    backgroundColor: "#00A9FF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  saveBtnText: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
    color: "#fff",
  },
  saveErrorText: {
    fontFamily: "Poppins",
    fontSize: 13,
    color: "#E55353",
    marginBottom: 8,
  },
  saveSuccessText: {
    fontFamily: "Poppins",
    fontSize: 13,
    color: "#4CAF50",
    marginBottom: 8,
  },
  usernameStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: -6,
    marginBottom: 8,
  },
  usernameStatusText: {
    fontFamily: "Poppins",
    fontSize: 12,
  },
  pwCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  pwCheckText: {
    fontFamily: "Poppins",
    fontSize: 12,
  },
  blockedEmptyText: {
    fontSize: 13,
    marginTop: 4,
    fontFamily: "Poppins",
  },
  blockedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
  },
  blockedName: {
    fontSize: 14,
    fontFamily: "PoppinsBold",
  },
  blockedUsername: {
    fontSize: 12,
    fontFamily: "Poppins",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  unblockModalContent: {
    width: "80%",
    borderRadius: 18,
    padding: 16,
    elevation: 4,
  },
  unblockTitle: {
    fontSize: 15,
    fontFamily: "PoppinsBold",
    marginBottom: 12,
  },
  unblockButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  unblockBtnSmall: {
    minWidth: 70,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  unblockNoBtn: {
    borderWidth: 0.5,
    borderColor: "#6F7D95",
  },
  unblockYesBtn: {
    backgroundColor: "#12A7E0",
  },
  unblockBtnSmallText: {
    fontSize: 14,
    fontFamily: "Poppins",
  },
});
