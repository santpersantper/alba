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
import { getDeviceId } from "../lib/deviceId";
import { posthog } from "../lib/analytics";

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

  // ── form fields ──────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");

  // ── verification step: "form" → "verify" ─────────────────────────────────
  const [step, setStep] = useState("form");
  const [otp, setOtp] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);

  const deviceIdRef = useRef(null);

  const [alertConfig, setAlertConfig] = useState(null);
  const showAlert = (title, message) => setAlertConfig({ title, message });

  // ── live validation ───────────────────────────────────────────────────────
  const [emailValid, setEmailValid] = useState(null);
  const [emailErrorReason, setEmailErrorReason] = useState(null); // 'taken' | 'disposable' | null
  const [usernameValid, setUsernameValid] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
  const [usernameChecking, setUsernameChecking] = useState(false);

  const emailTimerRef = useRef(null);
  const usernameTimerRef = useRef(null);

  const [showAgePicker, setShowAgePicker] = useState(false);

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

  // Load device ID once on mount
  useEffect(() => {
    getDeviceId().then((id) => { deviceIdRef.current = id; });
  }, []);

  useEffect(() => {
    return () => {
      if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
      if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    };
  }, []);

  // Silently detect city on mount
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
          `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${longitude}&latitude=${latitude}&types=place&access_token=${token}`
        );
        const json = await res.json();
        detectedCityRef.current = json.features?.[0]?.properties?.name || json.features?.[0]?.properties?.place_formatted || null;
      } catch {
        // Silent
      }
    })();
  }, []);

  // ── uniqueness checks ─────────────────────────────────────────────────────

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
        .select("id")
        .eq("username", trimmed)
        .maybeSingle();
      if (error) { setUsernameValid(false); return false; }
      const available = !existingUser;
      setUsernameValid(available);
      return available;
    } catch {
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
      setEmailErrorReason(null);
      setEmailChecking(false);
      return false;
    }
    try {
      const domain = trimmed.split("@")[1];

      // Disposable email check
      const { data: dispData } = await supabase.functions.invoke("check-signup-eligibility", {
        body: { email_domain: domain },
      });
      if (!dispData?.allowed) {
        setEmailValid(false);
        setEmailErrorReason("disposable");
        return false;
      }

      // Uniqueness check
      const { data: existingEmail, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", trimmed)
        .maybeSingle();
      if (error) { setEmailValid(false); setEmailErrorReason(null); return false; }
      const available = !existingEmail;
      setEmailValid(available);
      setEmailErrorReason(available ? null : "taken");
      return available;
    } catch {
      setEmailValid(false);
      setEmailErrorReason(null);
      return false;
    } finally {
      setEmailChecking(false);
    }
  };

  const handleEmailChange = (value) => {
    setEmail(value);
    setEmailValid(null);
    setEmailErrorReason(null);
    if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
    if (!value.trim()) { setEmailChecking(false); return; }
    setEmailChecking(true);
    emailTimerRef.current = setTimeout(() => { checkEmailUnique(value); }, 500);
  };

  const handleUsernameChange = (value) => {
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25);
    setUsername(cleaned);
    setUsernameValid(null);
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    if (!cleaned) { setUsernameChecking(false); return; }
    if (cleaned.length < 3) { setUsernameChecking(false); setUsernameValid(false); return; }
    setUsernameChecking(true);
    usernameTimerRef.current = setTimeout(() => { checkUsernameUnique(cleaned); }, 500);
  };

  // ── form validation ───────────────────────────────────────────────────────

  const validate = async () => {
    if (!name.trim() || !username.trim() || !email.trim() || !password.trim()) {
      showAlert(t("signup_missing_info_title"), t("signup_missing_info_body"));
      return false;
    }
    if (name.trim().split(/\s+/).length < 2) {
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
      if (emailErrorReason === "disposable") {
        showAlert("Disposable email not allowed", "Please use a real, permanent email address. Temporary or disposable email services are not accepted.");
      } else {
        showAlert(t("signup_email_unavailable_title"), t("signup_email_unavailable_body"));
      }
      return false;
    }
    return true;
  };

  // ── Step 1: send verification code ───────────────────────────────────────

  const handleProceed = async () => {
    if (sendingCode) return;
    if (emailChecking || usernameChecking) {
      showAlert(t("signup_wait_checks_title"), t("signup_wait_checks_body"));
      return;
    }
    const ok = await validate();
    if (!ok) return;

    setSendingCode(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-verification-code", {
        body: {
          action: "send",
          email: email.trim().toLowerCase(),
          device_id: deviceIdRef.current,
        },
      });

      if (error) throw error;

      if (data?.error === "device_banned") {
        showAlert(t("signup_device_banned_title"), t("signup_device_banned_body"));
        return;
      }
      if (data?.error === "device_limit") {
        showAlert(t("signup_device_limit_title"), t("signup_device_limit_body"));
        return;
      }
      if (data?.error === "ip_limit") {
        showAlert(t("signup_ip_limit_title"), t("signup_ip_limit_body"));
        return;
      }
      if (data?.error === "disposable_email") {
        showAlert(t("signup_disposable_email_title"), t("signup_disposable_email_body"));
        return;
      }
      if (data?.error === "rate_limit") {
        showAlert(
          t("signup_code_ratelimit_title"),
          `${t("signup_code_ratelimit_body")} ${data.wait}s.`
        );
        return;
      }
      if (data?.error) throw new Error(data.error);

      setStep("verify");
      setOtp("");
    } catch (e) {
      showAlert(t("signup_failed_title"), e.message || t("signup_failed_generic"));
    } finally {
      setSendingCode(false);
    }
  };

  // ── Step 2: verify code + create account ─────────────────────────────────

  const doSignUp = async (signupIp = null) => {
    const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim(), username: username.trim() } },
    });
    if (signUpErr) throw signUpErr;

    const user = signUp.user;
    if (!user?.id) throw new Error(t("signup_failed_generic"));

    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username: username.trim(),
          name: name.trim(),
          age: age ? Number(age) : null,
          gender: null,
          city: detectedCityRef.current || null,
          device_id: deviceIdRef.current || null,
          signup_ip: signupIp || null,
          visible_to_all: true,
          preferences: {
            music: "", spotify: "", movies: "",
            letterboxd: "", books: "", goodreads: "",
          },
        },
        { onConflict: "id" }
      );
    if (upsertErr) throw upsertErr;
  };

  const handleVerifyAndSignUp = async () => {
    if (verifyingCode) return;
    if (otp.length < 6) {
      showAlert(t("signup_code_invalid_title"), t("signup_code_enter_6_digits"));
      return;
    }

    setVerifyingCode(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-verification-code", {
        body: { action: "verify", email: email.trim().toLowerCase(), code: otp },
      });

      if (error) throw error;

      if (!data?.ok) {
        const reason = data?.reason;
        const msg =
          reason === "expired"
            ? t("signup_code_expired_body")
            : t("signup_code_invalid_body");
        showAlert(t("signup_code_invalid_title"), msg);
        return;
      }

      await doSignUp(data?.signup_ip ?? null);
      posthog.capture('user_signed_up', { method: 'email' });
      // Auth state change in AppNavigator handles navigation automatically.
    } catch (e) {
      showAlert(t("signup_failed_title"), e.message || t("signup_failed_generic"));
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleResend = async () => {
    if (sendingCode) return;
    setSendingCode(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-verification-code", {
        body: {
          action: "send",
          email: email.trim().toLowerCase(),
          device_id: deviceIdRef.current,
        },
      });
      if (error) throw error;
      if (data?.error === "rate_limit") {
        showAlert(
          t("signup_code_ratelimit_title"),
          `${t("signup_code_ratelimit_body")} ${data.wait}s.`
        );
        return;
      }
      if (data?.error) throw new Error(data.error);
      showAlert(t("signup_code_resent_title"), t("signup_code_resent_body"));
    } catch (e) {
      showAlert(t("signup_failed_title"), e.message || t("signup_failed_generic"));
    } finally {
      setSendingCode(false);
    }
  };

  // ── helpers ───────────────────────────────────────────────────────────────

  const renderValidationIcon = (valid) => {
    if (valid === null) return null;
    return (
      <Feather
        name={valid ? "check" : "x"}
        size={18}
        color={valid ? accent : "#FF3B30"}
        style={styles.validationIcon}
      />
    );
  };

  const formDisabled = step === "verify";

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
            <View style={[styles.inputContainer, borderStyle, formDisabled && styles.fieldDisabled]}>
              <TextInput
                style={[styles.inputField, { color: accent }]}
                placeholder={t("signup_name_placeholder")}
                placeholderTextColor={placeholder}
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                editable={!formDisabled}
                maxLength={60}
              />
            </View>

            {/* Email */}
            <View style={[styles.inputContainer, borderStyle, formDisabled && styles.fieldDisabled]}>
              <TextInput
                style={[styles.inputField, { color: accent }]}
                placeholder={t("signup_email_placeholder")}
                placeholderTextColor={placeholder}
                value={email}
                onChangeText={handleEmailChange}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                editable={!formDisabled}
              />
              {!formDisabled && (
                emailChecking
                  ? <ActivityIndicator size="small" color={accent} />
                  : renderValidationIcon(emailValid)
              )}
            </View>

            {/* Username */}
            <View style={[styles.inputContainer, borderStyle, formDisabled && styles.fieldDisabled]}>
              <TextInput
                style={[styles.inputField, { color: accent }]}
                placeholder={t("signup_username_placeholder")}
                placeholderTextColor={placeholder}
                value={username}
                onChangeText={handleUsernameChange}
                autoCapitalize="none"
                returnKeyType="next"
                editable={!formDisabled}
              />
              {!formDisabled && (
                usernameChecking
                  ? <ActivityIndicator size="small" color={accent} />
                  : renderValidationIcon(usernameValid)
              )}
            </View>

            {/* Password */}
            <View style={[styles.inputContainer, borderStyle, formDisabled && styles.fieldDisabled]}>
              <TextInput
                style={[styles.inputField, { color: accent }]}
                placeholder={t("signup_password_placeholder")}
                placeholderTextColor={placeholder}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                returnKeyType="next"
                editable={!formDisabled}
              />
            </View>

            {/* Age */}
            <TouchableOpacity
              style={[styles.inputContainer, borderStyle, formDisabled && styles.fieldDisabled]}
              onPress={() => !formDisabled && setShowAgePicker(true)}
              activeOpacity={formDisabled ? 1 : 0.8}
            >
              <Text style={[styles.inputField, { color: accent, opacity: age ? 1 : 0.8 }]}>
                {age || `${t("signup_age_placeholder")} (optional)`}
              </Text>
              {!formDisabled && <Feather name="chevron-down" size={18} color={accent} />}
            </TouchableOpacity>

            {/* ── Step: form → show "Proceed" button ───────────────────── */}
            {step === "form" ? (
              <TouchableOpacity
                style={[
                  styles.nextBtn,
                  isDark
                    ? { backgroundColor: theme.gray, borderWidth: 1, borderColor: "#FFFFFF" }
                    : { backgroundColor: "#00A9FF" },
                  (sendingCode || emailValid === false || usernameValid === false) && { opacity: 0.7 },
                ]}
                onPress={handleProceed}
                disabled={sendingCode || emailValid === false || usernameValid === false}
              >
                {sendingCode ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.btnText, { color: "#FFFFFF" }]}>
                    {t("signup_button_label")}
                  </Text>
                )}
              </TouchableOpacity>

            ) : (
              /* ── Step: verify → show OTP input + "Sign Up" button ─────── */
              <View style={{ width: "100%", alignItems: "center", marginTop: 32 }}>
                <Text style={[styles.codeSentText, { color: accent }]}>
                  {t("signup_code_sent_prefix")} {email}.
                </Text>

                <View style={[styles.inputContainer, borderStyle, { marginBottom: 0, width: "100%" }]}>
                  <TextInput
                    style={[
                      styles.inputField,
                      { color: accent, letterSpacing: 14, textAlign: "center", fontSize: 22 },
                    ]}
                    placeholder={t("signup_code_placeholder")}
                    placeholderTextColor={placeholder}
                    value={otp}
                    onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, "").slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.nextBtn,
                    isDark
                      ? { backgroundColor: theme.gray, borderWidth: 1, borderColor: "#FFFFFF" }
                      : { backgroundColor: "#00A9FF" },
                    (verifyingCode || otp.length < 6) && { opacity: 0.7 },
                  ]}
                  onPress={handleVerifyAndSignUp}
                  disabled={verifyingCode || otp.length < 6}
                >
                  {verifyingCode ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={[styles.btnText, { color: "#FFFFFF" }]}>
                      {t("signup_complete_label")}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleResend}
                  disabled={sendingCode}
                  style={styles.resendBtn}
                >
                  <Text style={[styles.resendText, { color: accent, opacity: sendingCode ? 0.4 : 0.75 }]}>
                    {sendingCode ? t("signup_code_sending") : t("signup_code_resend")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { setStep("form"); setOtp(""); }}
                  style={styles.editBtn}
                >
                  <Text style={[styles.resendText, { color: accent, opacity: 0.5 }]}>
                    ← {t("signup_code_edit_details")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

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

      {/* Alert modal */}
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
          <View style={[styles.pickerCard, { backgroundColor: isDark ? theme.gray : "#fff" }]}>
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
  fieldDisabled: {
    opacity: 0.45,
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
  codeSentText: {
    fontFamily: "Poppins",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 20,
  },
  resendBtn: {
    marginTop: 18,
  },
  editBtn: {
    marginTop: 10,
  },
  resendText: {
    fontFamily: "Poppins",
    fontSize: 13,
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
