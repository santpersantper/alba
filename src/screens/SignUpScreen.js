// screens/SignUpScreen.js
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from "react-native";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { Picker } from "@react-native-picker/picker";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { useAlbaTheme } from "../theme/ThemeContext";

const { height } = Dimensions.get("window");

const AGE_MIN = 18;
const AGE_MAX = 100;
const ageOptions = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) =>
  String(AGE_MIN + i)
);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpScreen({ navigation }) {
  const { t } = useAlbaLanguage();
  const { theme, isDark } = useAlbaTheme();

  // fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [alertConfig, setAlertConfig] = useState(null);
  const showAlert = (title, message) => setAlertConfig({ title, message });

  // live validation
  const [emailValid, setEmailValid] = useState(null);
  const [usernameValid, setUsernameValid] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
  const [usernameChecking, setUsernameChecking] = useState(false);

  // debouncing
  const emailTimerRef = useRef(null);
  const usernameTimerRef = useRef(null);

  // pickers
  const [showAgePicker, setShowAgePicker] = useState(false);

  // city detected silently from device location
  const detectedCityRef = useRef(null);

  const scrollRef = useRef(null);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#FFFFFF" }} />;

  const bg = isDark ? theme.gray : "#FFFFFF";
  const accent = isDark ? "#FFFFFF" : "#00A9FF";
  const placeholder = accent;

  const borderStyle = isDark
    ? { borderBottomWidth: 1, borderBottomColor: "#FFFFFF" }
    : { borderWidth: 1, borderColor: "#00A9FF", borderRadius: 8, paddingHorizontal: 14 };

  const Logo = () => (
    <Image source={require("../../assets/icon.png")} style={styles.logo} />
  );

  useEffect(() => {
    return () => {
      if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
      if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    };
  }, []);

  // Silently detect city on mount — no UI shown, no error if it fails
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
        });
        const { latitude, longitude } = loc.coords;
        const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
        if (!token) return;
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?types=place&access_token=${token}`
        );
        const json = await res.json();
        detectedCityRef.current = json.features?.[0]?.text || null;
      } catch {
        // Silent — city will be null if detection fails
      }
    })();
  }, []);

  const checkUsernameUnique = async (value) => {
    const trimmed = value.trim();

    if (!trimmed || trimmed.length < 3) {
      setUsernameValid(false);
      setUsernameChecking(false);
      return false;
    }

    try {
      const { data: existingUser, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", trimmed)
        .maybeSingle();

      if (error) {
        console.warn("SignUp username check error:", error);
        setUsernameValid(false);
        return false;
      }

      const available = !existingUser;
      setUsernameValid(available);
      return available;
    } catch (e) {
      console.warn("SignUp username check error (outer):", e);
      setUsernameValid(false);
      return false;
    } finally {
      setUsernameChecking(false);
    }
  };

  const checkEmailUnique = async (value) => {
    const trimmed = value.trim();

    if (!trimmed || !emailRegex.test(trimmed)) {
      setEmailValid(false);
      setEmailChecking(false);
      return false;
    }

    try {
      const { data: existingEmail, error } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("email", trimmed)
        .maybeSingle();

      if (error) {
        console.warn("SignUp email check error:", error);
        setEmailValid(false);
        return false;
      }

      const available = !existingEmail;
      setEmailValid(available);
      return available;
    } catch (e) {
      console.warn("SignUp email check error (outer):", e);
      setEmailValid(false);
      return false;
    } finally {
      setEmailChecking(false);
    }
  };

  const handleEmailChange = (value) => {
    setEmail(value);
    setEmailValid(null);

    if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
    if (!value.trim()) {
      setEmailChecking(false);
      return;
    }

    setEmailChecking(true);
    emailTimerRef.current = setTimeout(() => {
      checkEmailUnique(value);
    }, 500);
  };

  const handleUsernameChange = (value) => {
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
    const trimmed = cleaned.slice(0, 25);

    setUsername(trimmed);
    setUsernameValid(null);

    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    if (!trimmed) {
      setUsernameChecking(false);
      return;
    }
    if (trimmed.length < 3) {
      setUsernameChecking(false);
      setUsernameValid(false);
      return;
    }

    setUsernameChecking(true);
    usernameTimerRef.current = setTimeout(() => {
      checkUsernameUnique(trimmed);
    }, 500);
  };

  const validate = async () => {
    if (!name.trim() || !username.trim() || !email.trim() || !password.trim()) {
      showAlert(t("signup_missing_info_title"), t("signup_missing_info_body"));
      return false;
    }
    if (!age) {
      showAlert(t("signup_missing_age_title"), t("signup_missing_age_body"));
      return false;
    }

    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) {
      showAlert(t("signup_invalid_name_title"), t("signup_invalid_name_body"));
      return false;
    }

    if (username.length < 3) {
      showAlert(t("signup_username_short_title"), t("signup_username_short_body"));
      return false;
    }

    if (!emailRegex.test(email.trim())) {
      showAlert(t("signup_invalid_email_title"), t("signup_invalid_email_body"));
      return false;
    }

    if (password.length < 6) {
      showAlert(t("signup_weak_password_title"), t("signup_weak_password_body"));
      return false;
    }

    setEmailChecking(true);
    setUsernameChecking(true);
    const [emailOk, userOk] = await Promise.all([
      checkEmailUnique(email),
      checkUsernameUnique(username),
    ]);

    if (!userOk) {
      showAlert(t("signup_username_unavailable_title"), t("signup_username_unavailable_body"));
      return false;
    }
    if (!emailOk) {
      showAlert(t("signup_email_unavailable_title"), t("signup_email_unavailable_body"));
      return false;
    }

    return true;
  };

  const handleSignUp = async () => {
    if (submitting) return;

    if (emailChecking || usernameChecking) {
      showAlert(t("signup_wait_checks_title"), t("signup_wait_checks_body"));
      return;
    }

    const ok = await validate();
    if (!ok) return;

    setSubmitting(true);
    try {
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim(), username: username.trim() } },
      });
      if (signUpErr) throw signUpErr;

      const user = signUp.user;
      if (!user?.id) throw new Error(t("signup_failed_generic"));

      const profile = {
        id: user.id,
        username: username.trim(),
        name: name.trim(),
        age: age ? Number(age) : null,
        gender: null,
        city: detectedCityRef.current || null,
        visible_to_all: true,
        preferences: {
          music: "",
          spotify: "",
          movies: "",
          letterboxd: "",
          books: "",
          goodreads: "",
        },
      };

      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert(profile, { onConflict: "id" });

      if (upsertErr) throw upsertErr;

      // Auth state change in AppNavigator handles navigation to MainNavigator automatically.
    } catch (e) {
      console.error("SIGNUP/PROFILE ERROR:", e);
      showAlert(t("signup_failed_title"), e.message || t("signup_failed_generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const renderValidationIcon = (valid) => {
    if (valid === null) return null;
    return (
      <Feather
        name={valid ? "check" : "x"}
        size={18}
        color={valid ? accent : '#FF3B30'}
        style={styles.validationIcon}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scrollContent, { backgroundColor: bg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.page}>
          <Logo />

          {/* Name */}
          <View style={[styles.inputContainer, borderStyle]}>
            <TextInput
              style={[styles.inputField, { color: accent }]}
              placeholder={t("signup_name_placeholder")}
              placeholderTextColor={placeholder}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />
          </View>

          {/* Email */}
          <View style={[styles.inputContainer, borderStyle]}>
            <TextInput
              style={[styles.inputField, { color: accent }]}
              placeholder={t("signup_email_placeholder")}
              placeholderTextColor={placeholder}
              value={email}
              onChangeText={handleEmailChange}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
            />
            {emailChecking ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              renderValidationIcon(emailValid)
            )}
          </View>

          {/* Username */}
          <View style={[styles.inputContainer, borderStyle]}>
            <TextInput
              style={[styles.inputField, { color: accent }]}
              placeholder={t("signup_username_placeholder")}
              placeholderTextColor={placeholder}
              value={username}
              onChangeText={handleUsernameChange}
              autoCapitalize="none"
              returnKeyType="next"
            />
            {usernameChecking ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              renderValidationIcon(usernameValid)
            )}
          </View>

          {/* Password */}
          <View style={[styles.inputContainer, borderStyle]}>
            <TextInput
              style={[styles.inputField, { color: accent }]}
              placeholder={t("signup_password_placeholder")}
              placeholderTextColor={placeholder}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              returnKeyType="next"
            />
          </View>

          {/* Age */}
          <TouchableOpacity
            style={[styles.inputContainer, borderStyle]}
            onPress={() => setShowAgePicker(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.inputField, { color: accent, opacity: age ? 1 : 0.8 }]}>
              {age || t("signup_age_placeholder")}
            </Text>
            <Feather name="chevron-down" size={18} color={accent} />
          </TouchableOpacity>

          {/* Button */}
          <TouchableOpacity
            style={[
              styles.nextBtn,
              isDark
                ? { backgroundColor: theme.gray, borderWidth: 1, borderColor: "#FFFFFF" }
                : { backgroundColor: "#00A9FF" },
              (submitting || emailValid === false || usernameValid === false) && { opacity: 0.7 },
            ]}
            onPress={handleSignUp}
            disabled={submitting || emailValid === false || usernameValid === false}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.btnText, { color: "#FFFFFF" }]}>
                {t("signup_button_label")}
              </Text>
            )}
          </TouchableOpacity>

          {/* Back to login */}
          <Text style={{ marginTop: 24, color: accent, fontFamily: "Poppins" }}>
            {t("signup_have_account_prefix")}{" "}
            <Text
              style={[styles.linkText, { color: accent }]}
              onPress={() => navigation.goBack()}
            >
              {t("login_button_label")}
            </Text>
          </Text>
        </View>
        </TouchableWithoutFeedback>
      </ScrollView>

      {/* Alba-native alert modal */}
      <Modal
        visible={!!alertConfig}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertConfig(null)}
      >
        <View style={styles.alertOverlay}>
          <View style={[styles.alertCard, { backgroundColor: isDark ? "#2a2a2a" : "#FFFFFF" }]}>
            <Text style={[styles.alertTitle, { color: isDark ? "#FFFFFF" : "#111" }]}>
              {alertConfig?.title}
            </Text>
            <Text style={[styles.alertBody, { color: isDark ? "#aaa" : "#555" }]}>
              {alertConfig?.message}
            </Text>
            <TouchableOpacity style={styles.alertBtn} onPress={() => setAlertConfig(null)}>
              <Text style={styles.alertBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Age picker modal */}
      <Modal
        visible={showAgePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAgePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.pickerCard,
              { backgroundColor: isDark ? theme.gray : "#fff" },
            ]}
          >
            <Text style={[styles.pickerTitle, { color: isDark ? "#FFFFFF" : "#111" }]}>
              {t("signup_age_picker_title")}
            </Text>
            <Picker
              selectedValue={age}
              onValueChange={(val) => setAge(val)}
              dropdownIconColor={isDark ? "#FFFFFF" : "#00A9FF"}
              style={[styles.picker, { color: isDark ? "#FFFFFF" : "#00A9FF" }]}
              itemStyle={{ color: isDark ? "#FFFFFF" : "#00A9FF", fontFamily: "Poppins" }}
            >
              <Picker.Item label={t("signup_age_placeholder")} value="" />
              {ageOptions.map((a) => (
                <Picker.Item key={a} label={a} value={a} />
              ))}
            </Picker>
            <TouchableOpacity
              style={styles.pickerCloseBtn}
              onPress={() => setShowAgePicker(false)}
            >
              <Text style={[styles.pickerCloseText, { color: isDark ? "#FFFFFF" : "#00A9FF" }]}>
                {t("signup_picker_done")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    minHeight: height,
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingBottom: 40,
  },
  page: {
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 30,
    resizeMode: "contain",
  },
  inputContainer: {
    width: "100%",
    paddingHorizontal: 0,
    paddingVertical: 10,
    marginBottom: 22,
    flexDirection: "row",
    alignItems: "center",
  },
  inputField: {
    flex: 1,
    fontFamily: "Poppins",
    fontSize: 14,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  validationIcon: {
    marginLeft: 8,
  },
  nextBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
    marginTop: 32,
  },
  btnText: {
    fontFamily: "Poppins",
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickerCard: {
    width: "80%",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerTitle: {
    fontFamily: "Poppins",
    fontSize: 16,
    marginBottom: 8,
  },
  picker: {
    width: "100%",
  },
  pickerCloseBtn: {
    alignSelf: "flex-end",
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pickerCloseText: {
    fontFamily: "Poppins",
    fontSize: 14,
  },
  linkText: {
    fontFamily: "PoppinsBold",
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  alertCard: {
    width: "100%",
    borderRadius: 16,
    padding: 24,
    elevation: 6,
    alignItems: "center",
  },
  alertTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 17,
    marginBottom: 10,
    textAlign: "center",
  },
  alertBody: {
    fontFamily: "Poppins",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  alertBtn: {
    backgroundColor: "#00A9FF",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 40,
  },
  alertBtnText: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
    color: "#fff",
  },
});
