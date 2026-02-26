// screens/SignUpScreen.js
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from "react-native";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { Picker } from "@react-native-picker/picker";
import { Feather } from "@expo/vector-icons";
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
  const [gender, setGender] = useState("");
  const [city, setCity] = useState("");

  const [submitting, setSubmitting] = useState(false);

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
  const [showGenderPicker, setShowGenderPicker] = useState(false);

  const scrollRef = useRef(null);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#FFFFFF" }} />;

  const bg = isDark ? theme.gray : "#FFFFFF";
  const accent = isDark ? "#FFFFFF" : "#00A9FF";
  const placeholder = accent;

  // ✅ border logic: dark => bottom only (white), light => full (light blue)
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
      Alert.alert(t("signup_missing_info_title"), t("signup_missing_info_body"));
      return false;
    }
    if (!age) {
      Alert.alert(t("signup_missing_age_title"), t("signup_missing_age_body"));
      return false;
    }
    if (!gender) {
      Alert.alert(t("signup_missing_gender_title"), t("signup_missing_gender_body"));
      return false;
    }
    if (!city.trim()) {
      Alert.alert(t("signup_missing_city_title"), t("signup_missing_city_body"));
      return false;
    }

    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) {
      Alert.alert(t("signup_invalid_name_title"), t("signup_invalid_name_body"));
      return false;
    }

    if (username.length < 3) {
      Alert.alert(t("signup_username_short_title"), t("signup_username_short_body"));
      return false;
    }

    if (!emailRegex.test(email.trim())) {
      Alert.alert(t("signup_invalid_email_title"), t("signup_invalid_email_body"));
      return false;
    }

    if (password.length < 6) {
      Alert.alert(t("signup_weak_password_title"), t("signup_weak_password_body"));
      return false;
    }

    setEmailChecking(true);
    setUsernameChecking(true);
    const [emailOk, userOk] = await Promise.all([
      checkEmailUnique(email),
      checkUsernameUnique(username),
    ]);

    if (!userOk) {
      Alert.alert(t("signup_username_unavailable_title"), t("signup_username_unavailable_body"));
      return false;
    }
    if (!emailOk) {
      Alert.alert(t("signup_email_unavailable_title"), t("signup_email_unavailable_body"));
      return false;
    }

    return true;
  };

  const handleSignUp = async () => {
    if (submitting) return;

    if (emailChecking || usernameChecking) {
      Alert.alert(t("signup_wait_checks_title"), t("signup_wait_checks_body"));
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
        gender,
        city: city.trim(),
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
      Alert.alert(t("signup_failed_title"), e.message || t("signup_failed_generic"));
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
        color={accent}
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
      >
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

          {/* Gender */}
          <TouchableOpacity
            style={[styles.inputContainer, borderStyle]}
            onPress={() => setShowGenderPicker(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.inputField, { color: accent, opacity: gender ? 1 : 0.8 }]}>
              {gender || t("signup_gender_placeholder")}
            </Text>
            <Feather name="chevron-down" size={18} color={accent} />
          </TouchableOpacity>

          {/* City */}
          <View style={[styles.inputContainer, borderStyle]}>
            <TextInput
              style={[styles.inputField, { color: accent }]}
              placeholder={t("signup_city_placeholder")}
              placeholderTextColor={placeholder}
              value={city}
              onChangeText={setCity}
              onFocus={() => {
                setTimeout(() => {
                  scrollRef.current?.scrollToEnd({ animated: true });
                }, 100);
              }}
              returnKeyType="done"
            />
          </View>

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
      </ScrollView>

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
              {
                backgroundColor: isDark ? theme.gray : "#fff",
                borderColor: isDark ? "#FFFFFF" : "#00A9FF",
                borderWidth: 1,
              },
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
              itemStyle={{ color: isDark ? "#FFFFFF" : "#00A9FF" }}
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

      {/* Gender picker modal */}
      <Modal
        visible={showGenderPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGenderPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.pickerCard,
              {
                backgroundColor: isDark ? theme.gray : "#fff",
                borderColor: isDark ? "#FFFFFF" : "#00A9FF",
                borderWidth: 1,
              },
            ]}
          >
            <Text style={[styles.pickerTitle, { color: isDark ? "#FFFFFF" : "#111" }]}>
              {t("signup_gender_picker_title")}
            </Text>
            <Picker
              selectedValue={gender}
              onValueChange={(val) => setGender(val)}
              dropdownIconColor={isDark ? "#FFFFFF" : "#00A9FF"}
              style={[styles.picker, { color: isDark ? "#FFFFFF" : "#00A9FF" }]}
              itemStyle={{ color: isDark ? "#FFFFFF" : "#00A9FF" }}
            >
              <Picker.Item label={t("signup_gender_placeholder")} value="" />
              <Picker.Item label="M" value="M" />
              <Picker.Item label="F" value="F" />
            </Picker>
            <TouchableOpacity
              style={styles.pickerCloseBtn}
              onPress={() => setShowGenderPicker(false)}
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

  // ✅ more vertical spacing BETWEEN components (not internal)
  inputContainer: {
    width: "100%",
    paddingHorizontal: 0, // light mode override adds 14 via borderStyle
    paddingVertical: 10,
    marginBottom: 22, // ⬅️ more spacing between rows
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
    marginTop: 32, // ⬅️ more spacing above the button
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
    fontWeight: "700",
  },
});
