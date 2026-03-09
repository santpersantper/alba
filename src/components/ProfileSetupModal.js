// components/ProfileSetupModal.js
// Shown over the app after a new Google sign-in to collect username + age.
// City is auto-detected from device location. Name/email come from Google.
import React, { useState, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useFonts } from "expo-font";
import { Picker } from "@react-native-picker/picker";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";

const AGE_MIN = 18;
const AGE_MAX = 100;
const ageOptions = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) =>
  String(AGE_MIN + i)
);

export default function ProfileSetupModal({ visible, user, onComplete }) {
  const { theme, isDark } = useAlbaTheme();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [showAgePicker, setShowAgePicker] = useState(false);
  const [usernameValid, setUsernameValid] = useState(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const usernameTimerRef = useRef(null);

  const accent = isDark ? "#FFFFFF" : "#00A9FF";
  const bg = isDark ? theme.gray : "#FFFFFF";
  const borderStyle = isDark
    ? { borderBottomWidth: 1, borderBottomColor: "#FFFFFF" }
    : { borderWidth: 1, borderColor: "#00A9FF", borderRadius: 8, paddingHorizontal: 14 };

  const checkUsername = async (value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameValid(false);
      setUsernameChecking(false);
      return false;
    }
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", trimmed)
        .maybeSingle();
      const ok = !data;
      setUsernameValid(ok);
      return ok;
    } catch {
      setUsernameValid(false);
      return false;
    } finally {
      setUsernameChecking(false);
    }
  };

  const handleUsernameChange = (value) => {
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25);
    setUsername(cleaned);
    setUsernameValid(null);
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    if (!cleaned || cleaned.length < 3) {
      setUsernameChecking(false);
      return;
    }
    setUsernameChecking(true);
    usernameTimerRef.current = setTimeout(() => checkUsername(cleaned), 500);
  };

  const handleSubmit = async () => {
    if (!username.trim() || !age) {
      Alert.alert("Missing info", "Please choose a username and your age.");
      return;
    }
    if (usernameChecking) {
      Alert.alert("Please wait", "Checking username availability…");
      return;
    }
    if (!usernameValid) {
      Alert.alert("Username unavailable", "Please choose a different username.");
      return;
    }

    setSubmitting(true);
    try {
      // Silently detect city
      let city = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });
          const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
          if (mapboxToken) {
            const res = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${loc.coords.longitude},${loc.coords.latitude}.json?types=place&access_token=${mapboxToken}`
            );
            const json = await res.json();
            city = json.features?.[0]?.text || null;
          }
        }
      } catch {
        // Silent — city stays null
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          username: username.trim(),
          name: user.name || username.trim(),
          age: Number(age),
          gender: null,
          city,
          email: user.email || null,
          visible_to_all: true,
          preferences: {
            music: "",
            spotify: "",
            movies: "",
            letterboxd: "",
            books: "",
            goodreads: "",
          },
        },
        { onConflict: "id" }
      );

      if (error) throw error;
      onComplete();
    } catch (e) {
      Alert.alert("Error", e.message || "Could not create profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!fontsLoaded) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => {}}>
      <View style={[styles.container, { backgroundColor: bg }]}>
        <Text style={[styles.title, { color: accent }]}>Almost there!</Text>
        {!!user?.name && (
          <Text style={[styles.subtitle, { color: accent }]}>
            Welcome, {user.name}.{"\n"}Just a couple more details to get you started.
          </Text>
        )}

        {/* Username */}
        <View style={[styles.inputRow, borderStyle]}>
          <TextInput
            style={[styles.input, { color: accent }]}
            placeholder="choose a username"
            placeholderTextColor={accent}
            value={username}
            onChangeText={handleUsernameChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {usernameChecking ? (
            <ActivityIndicator size="small" color={accent} />
          ) : usernameValid !== null ? (
            <Feather name={usernameValid ? "check" : "x"} size={18} color={accent} />
          ) : null}
        </View>

        {/* Age */}
        <TouchableOpacity
          style={[styles.inputRow, borderStyle]}
          onPress={() => setShowAgePicker(true)}
          activeOpacity={0.8}
        >
          <Text style={[styles.input, { color: accent, opacity: age ? 1 : 0.8 }]}>
            {age || "your age"}
          </Text>
          <Feather name="chevron-down" size={18} color={accent} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.btn,
            isDark
              ? { backgroundColor: theme.gray, borderWidth: 1, borderColor: "#FFFFFF" }
              : { backgroundColor: "#00A9FF" },
            { opacity: submitting ? 0.7 : 1 },
          ]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.btnText}>Continue</Text>
          )}
        </TouchableOpacity>

        {/* Age picker */}
        <Modal
          visible={showAgePicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAgePicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerCard, { backgroundColor: isDark ? theme.gray : "#fff" }]}>
              <Text style={[styles.pickerTitle, { color: isDark ? "#FFFFFF" : "#111" }]}>
                Your age
              </Text>
              <Picker
                selectedValue={age}
                onValueChange={setAge}
                dropdownIconColor={isDark ? "#FFFFFF" : "#00A9FF"}
                style={[styles.picker, { color: isDark ? "#FFFFFF" : "#00A9FF" }]}
                itemStyle={{ color: isDark ? "#FFFFFF" : "#00A9FF", fontFamily: "Poppins" }}
              >
                <Picker.Item label="select age" value="" />
                {ageOptions.map((a) => (
                  <Picker.Item key={a} label={a} value={a} />
                ))}
              </Picker>
              <TouchableOpacity
                style={styles.pickerDoneBtn}
                onPress={() => setShowAgePicker(false)}
              >
                <Text style={[styles.pickerDoneText, { color: isDark ? "#FFFFFF" : "#00A9FF" }]}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  title: {
    fontFamily: "PoppinsBold",
    fontSize: 26,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: "Poppins",
    fontSize: 14,
    marginBottom: 36,
    textAlign: "center",
    lineHeight: 22,
    opacity: 0.85,
  },
  inputRow: {
    width: "100%",
    paddingVertical: 10,
    marginBottom: 22,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    fontFamily: "Poppins",
    fontSize: 14,
    paddingVertical: 0,
  },
  btn: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
    marginTop: 32,
  },
  btnText: {
    color: "#FFFFFF",
    fontFamily: "Poppins",
    fontSize: 16,
  },
  pickerOverlay: {
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
  pickerDoneBtn: {
    alignSelf: "flex-end",
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pickerDoneText: {
    fontFamily: "Poppins",
    fontSize: 14,
  },
});
