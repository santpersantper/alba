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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
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
import PremiumPurchaseModal from "../components/PremiumPurchaseModal";

const TABS = ["General", "Events", "Ads", "Privacy"];

export default function CommunitySettingsScreen({ navigation }) {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const { theme, mode, setMode, isDark } = useAlbaTheme();
  const { language, setLanguage, t } = useAlbaLanguage();

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const [activeTab, setActiveTab] = useState("General");

  const [userId, setUserId] = useState(null);
  const [showNews, setShowNews] = useState(true);
  const [visibleToAll, setVisibleToAll] = useState(false);
  const [allowDMs, setAllowDMs] = useState(true);
  const [showFollowedPosts, setShowFollowedPosts] = useState(false);

  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockedProfiles, setBlockedProfiles] = useState([]);
  const [unblockModalVisible, setUnblockModalVisible] = useState(false);
  const [unblockCandidate, setUnblockCandidate] = useState(null);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);

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
  const { prefs, updatePrefs } = useUserPreferences();
  const [premiumModal, setPremiumModal] = useState(null); // { featureName, description, price, endpoint } | null
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState([]);
  const [cityLoading, setCityLoading] = useState(false);
  const cityDebounceRef = useRef(null);
  const [diffusionRadiusUnit, setDiffusionRadiusUnit] = useState("km"); // "km" | "mi"
  // Local string state for the radius text input — avoids clamping mid-edit
  const [diffusionRadiusText, setDiffusionRadiusText] = useState("5");
  const diffusionInputFocused = useRef(false);

  const loadSettings = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const u = auth?.user;
      if (!u) return;

      setUserId(u.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("show_local_news, visible_to_all, allow_dms, blocked_users, name, username, is_verified, show_followed_users_posts")
        .eq("id", u.id)
        .maybeSingle();

      if (error || !data) return;

      if (typeof data.show_local_news === "boolean") setShowNews(data.show_local_news);
      if (typeof data.visible_to_all === "boolean") setVisibleToAll(data.visible_to_all);
      if (typeof data.allow_dms === "boolean") setAllowDMs(data.allow_dms);
      if (typeof data.show_followed_users_posts === "boolean") setShowFollowedPosts(data.show_followed_users_posts);
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
      loadSettings();
      return undefined;
    }, [loadSettings])
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
    if (!userId) return Promise.resolve();
    return supabase.from("profiles").update(patch).eq("id", userId);
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

  const handleLogout = () => setLogoutModalVisible(true);

  const handleAdFreePress = () => {
    if (prefs.premiumAdFree) {
      updatePrefs({ premiumAdFree: false });
      return;
    }
    setPremiumModal({
      featureName: "Ad-Free",
      description: "Browse Community without ads.",
      price: "€2.99/month",
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
      price: "€4.99/month",
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
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?types=place&limit=5&access_token=${token}`
        );
        const json = await res.json();
        setCityResults(json.features || []);
      } catch { setCityResults([]); }
      finally { setCityLoading(false); }
    }, 400);
    return () => clearTimeout(cityDebounceRef.current);
  }, [cityQuery, prefs.premiumTravelerMode]);

  const renderTabContent = () => {
    if (activeTab === "General") {
      return (
        <>
          {/* ── Profile ── */}
          <ThemedView variant="gray" style={[styles.section, { paddingTop: 10 }]}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
              {t("settings_profile_section")}
            </ThemedText>

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
              <ThemedText style={[styles.verifiedText, { color: isVerified ? "#4CAF50" : "#F59E0B" }]}>
                {isVerified ? t("settings_verified") : t("settings_not_verified")}
              </ThemedText>
            </TouchableOpacity>

            <TextInput
              style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: theme.text, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}
              placeholder={t("settings_name_placeholder")}
              placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: theme.text, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}
              placeholder={t("settings_username_placeholder")}
              placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
              autoCapitalize="none"
              autoCorrect={false}
              value={editUsername}
              onChangeText={setEditUsername}
            />
            {usernameStatus === "checking" && (
              <View style={styles.usernameStatusRow}>
                <ActivityIndicator size="small" color="#00A9FF" style={{ marginRight: 5 }} />
                <ThemedText style={[styles.usernameStatusText, { color: isDark ? "#aaa" : "#666" }]}>{t("settings_checking_username")}</ThemedText>
              </View>
            )}
            {usernameStatus === "available" && (
              <View style={styles.usernameStatusRow}>
                <Feather name="check-circle" size={13} color="#4CAF50" style={{ marginRight: 5 }} />
                <ThemedText style={[styles.usernameStatusText, { color: "#4CAF50" }]}>{t("settings_username_available")}</ThemedText>
              </View>
            )}
            {usernameStatus === "taken" && (
              <View style={styles.usernameStatusRow}>
                <Feather name="x-circle" size={13} color="#E55353" style={{ marginRight: 5 }} />
                <ThemedText style={[styles.usernameStatusText, { color: "#E55353" }]}>{t("settings_username_taken")}</ThemedText>
              </View>
            )}
            {usernameStatus === "invalid" && (
              <View style={styles.usernameStatusRow}>
                <ThemedText style={[styles.usernameStatusText, { color: "#F59E0B" }]}>{t("settings_username_invalid")}</ThemedText>
              </View>
            )}
            <TextInput
              style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: theme.text, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}
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
                    <ThemedText style={[styles.pwCheckText, { color: pwChecks[key] ? "#4CAF50" : "#E55353" }]}>
                      {label}
                    </ThemedText>
                  </View>
                ))}
                <TextInput
                  style={[styles.profileInput, { borderColor: isDark ? "#444" : "#d0d7e2", color: theme.text, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa", marginTop: 8 }]}
                  placeholder={t("settings_confirm_password")}
                  placeholderTextColor={isDark ? "#666" : "#9fa5b3"}
                  secureTextEntry
                  value={editPasswordConfirm}
                  onChangeText={setEditPasswordConfirm}
                />
              </>
            )}

            {!!saveError && (
              <ThemedText style={styles.saveErrorText}>{saveError}</ThemedText>
            )}
            {saveSuccess && (
              <ThemedText style={styles.saveSuccessText}>{t("settings_saved")}</ThemedText>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
              onPress={saveProfile}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <ThemedText style={styles.saveBtnText}>{t("settings_save_changes")}</ThemedText>}
            </TouchableOpacity>
          </ThemedView>

          {/* ── Appearance ── */}
          <ThemedView variant="gray" style={[styles.section, { paddingTop: 10 }]}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
              {t("appearance_section_title")}
            </ThemedText>
            {renderCheckbox(nightAuto, t("night_auto"), () => handleSetMode("auto"))}
            {renderCheckbox(nightOn, t("night_on"), () => handleSetMode("dark"))}
            {renderCheckbox(nightOff, t("night_off"), () => handleSetMode("light"))}
          </ThemedView>

          <ThemedView variant="gray" style={[styles.section, { paddingTop: 16 }]}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
              {t("language_section_title")}
            </ThemedText>
            {renderCheckbox(language === "en", t("language_en"), () => setLanguage("en"))}
            {renderCheckbox(language === "it", t("language_it"), () => setLanguage("it"))}
          </ThemedView>

          <ThemedView variant="gray" style={[styles.section, { paddingTop: 16 }]}>
            {renderCheckbox(showNews, t("show_local_news"), async () => {
              const next = !showNews;
              setShowNews(next);
              await updateProfile({ show_local_news: next });
            })}
            {renderCheckbox(showFollowedPosts, t("show_followed_posts"), async () => {
              const next = !showFollowedPosts;
              setShowFollowedPosts(next);
              await updateProfile({ show_followed_users_posts: next });
            })}
          </ThemedView>

          {/* ── Alba Premium ── */}
          <View style={styles.premiumSection}>
            <Text style={styles.premiumHeader}>Alba Premium</Text>

            {/* Ad-Free checkbox */}
            <TouchableOpacity style={styles.checkboxRow} onPress={handleAdFreePress} activeOpacity={0.7}>
              <View style={[styles.premiumCheckbox, prefs.premiumAdFree && styles.premiumCheckboxChecked]}>
                {prefs.premiumAdFree && <Feather name="check" size={12} color="#00A9FF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumLabel}>Ad-Free</Text>
                <Text style={styles.premiumSublabel}>Browse Community without ads — €2.99/month</Text>
              </View>
            </TouchableOpacity>

            {/* Traveler Mode checkbox */}
            <TouchableOpacity style={[styles.checkboxRow, { marginTop: 12 }]} onPress={handleTravelerPress} activeOpacity={0.7}>
              <View style={[styles.premiumCheckbox, prefs.premiumTravelerMode && styles.premiumCheckboxChecked]}>
                {prefs.premiumTravelerMode && <Feather name="check" size={12} color="#00A9FF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumLabel}>Traveler Mode</Text>
                <Text style={styles.premiumSublabel}>Access Community in any city worldwide — €4.99/month</Text>
              </View>
            </TouchableOpacity>

            {/* City search — only shown when Traveler Mode is active */}
            {prefs.premiumTravelerMode && (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  style={styles.premiumInput}
                  placeholder="Search for a city..."
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
                    ? `Currently browsing as: ${prefs.travelerModeCity}`
                    : "No city selected — Community will use your real location"}
                </Text>
              </View>
            )}

            {/* Diffusion List checkbox */}
            <TouchableOpacity style={[styles.checkboxRow, { marginTop: 12 }]} onPress={handleDiffusionPress} activeOpacity={0.7}>
              <View style={[styles.premiumCheckbox, prefs.premiumDiffusionList && styles.premiumCheckboxChecked]}>
                {prefs.premiumDiffusionList && <Feather name="check" size={12} color="#00A9FF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumLabel}>Diffusion List</Text>
                <Text style={styles.premiumSublabel}>Broadcast a message to all Alba users nearby — €1.00 per message</Text>
              </View>
            </TouchableOpacity>

            {/* Radius input — shown when Diffusion List is active */}
            {prefs.premiumDiffusionList && (
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.premiumSublabel, { fontWeight: "600", marginBottom: 8 }]}>
                  Broadcast radius
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
                  Min 1 {diffusionRadiusUnit} · Max 50 {diffusionRadiusUnit}
                </Text>

                {/* Estimated users — placeholder formula, replace with real DB query once density data exists */}
                <Text style={[styles.premiumSublabel, { marginTop: 6 }]}>
                  Your message will reach approximately{" "}
                  {Math.round(prefs.diffusionRadiusKm * prefs.diffusionRadiusKm * Math.PI * 0.8)} users
                </Text>
              </View>
            )}
          </View>
        </>
      );
    }

    if (activeTab === "Events") {
      return (
        <>
          <MyEvents navigation={navigation} />
          <CommunityEventSettings />
        </>
      );
    }

    if (activeTab === "Ads") {
      return (
        <>
          <MyAds navigation={navigation} />
          <CommunityAdSettings navigation={navigation} />
        </>
      );
    }

    if (activeTab === "Privacy") {
      return (
        <>
          <ThemedView variant="gray" style={[styles.section, { paddingTop: 10 }]}>
            {renderCheckbox(visibleToAll, t("profile_visible_to_all"), () =>
              setVisibleToAll((v) => {
                const next = !v;
                updateProfile({ visible_to_all: next });
                return next;
              })
            )}
            {renderCheckbox(allowDMs, t("allow_dms_anyone"), () =>
              setAllowDMs((v) => {
                const next = !v;
                updateProfile({ allow_dms: next });
                return next;
              })
            )}
            {renderCheckbox(
              prefs.blockDiffusionMessages,
              "Block Diffusion Messages",
              () => updatePrefs({ blockDiffusionMessages: !prefs.blockDiffusionMessages })
            )}
            <ThemedText style={{ fontSize: 12, color: theme.secondaryText, fontFamily: "Poppins", marginLeft: 28, marginTop: -4, marginBottom: 4 }}>
              You won't receive broadcast messages from other users
            </ThemedText>
          </ThemedView>

          <ThemedView variant="gray" style={[styles.section, { paddingTop: 16 }]}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
              {t("settings_blocked_users_title")}
            </ThemedText>
            {blockedProfiles.length === 0 ? (
              <ThemedText style={[styles.blockedEmptyText, { color: theme.secondaryText }]}>
                {t("settings_no_blocked")}
              </ThemedText>
            ) : (
              <FlatList
                data={blockedProfiles}
                keyExtractor={(item) => item.id || item.username || Math.random().toString()}
                scrollEnabled={false}
                style={{ marginTop: 4 }}
                renderItem={({ item }) => (
                  <View style={styles.blockedRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[styles.blockedName, { color: theme.text }]} numberOfLines={1}>
                        {item.name || `@${item.username}`}
                      </ThemedText>
                      <ThemedText style={[styles.blockedUsername, { color: theme.secondaryText }]} numberOfLines={1}>
                        @{item.username}
                      </ThemedText>
                    </View>
                    <TouchableOpacity onPress={() => openUnblockModal(item.username)} hitSlop={8}>
                      <Feather name="x" size={18} color={theme.text} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </ThemedView>
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
        {TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab)}
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
            onPress={handleLogout}
            style={[styles.logoutBtn, { backgroundColor: isDark ? theme.gray : theme.background }]}
            activeOpacity={0.7}
          >
            <ThemedText style={styles.logoutBtnText}>Log out</ThemedText>
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
    fontWeight: "700",
    fontFamily: "Poppins",
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
    fontFamily: "Poppins",
    fontWeight: "600",
  },

  content: { paddingHorizontal: 15 },
  section: { marginTop: 16 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
    fontFamily: "Poppins",
  },
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
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 10,
  },
  premiumLabel: {
    color: "#fff",
    fontFamily: "Poppins",
    fontWeight: "600",
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
    fontWeight: "700",
    fontFamily: "Poppins",
  },
  logoutBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutBtnText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Poppins",
    color: "#E55353",
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
    fontFamily: "Poppins",
    fontSize: 14,
    fontWeight: "700",
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
    fontWeight: "600",
    fontFamily: "Poppins",
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
    fontFamily: "Poppins",
    fontWeight: "700",
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
