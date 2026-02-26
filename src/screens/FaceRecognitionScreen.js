// screens/FaceRecognitionScreen.js
import React, { useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Button,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "../lib/supabase";
import { useAlbaLanguage } from "../theme/LanguageContext";

const BACKEND_VERIFY_URLS = [
  "https://qe6bqd3ri0.execute-api.eu-north-1.amazonaws.com/verify",
];


function short(s, n = 220) {
  if (!s) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n) + "…" : str;
}

async function fetchWithTimeout(url, options, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export default function FaceRecognitionScreen() {
  const navigation = useNavigation();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [permission, requestPermission] = useCameraPermissions();
  const [verifying, setVerifying] = useState(false);
  const cameraRef = useRef(null);

  const handleBack = () => navigation.goBack();

  const handleVerify = async () => {
    const runId = `verify_${Date.now()}`;
    const log = (...args) => console.log(`[FaceVerify:${runId}]`, ...args);

    if (!cameraRef.current) {
      Alert.alert("Error", "Camera not ready yet.");
      return;
    }

    try {
      setVerifying(true);
      log("START");

      // 1) current user
      log("Step 1: supabase.auth.getUser()");
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;

      const user = data?.user;
      log("User:", { id: user?.id, email: user?.email });

      if (!user?.id) {
        log("No user id → navigate Start");
        navigation.navigate("Start");
        return;
      }

      // 2) fetch avatar_url
      log("Step 2: fetch profile avatar_url");
      const { data: profileRow, error: profileErr } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (profileErr) throw profileErr;

      const avatarUrl = profileRow?.avatar_url;
      log("avatar_url:", avatarUrl);

      if (!avatarUrl) {
        Alert.alert(
          "Profile photo missing",
          "Please upload a profile picture before verifying your face."
        );
        return;
      }

      // 3) download avatar + base64
      log("Step 3: download avatar");
      const fileName = `avatar_${user.id}_${Date.now()}.jpg`;
      const localPath = `${FileSystem.cacheDirectory}${fileName}`;

      const downloadRes = await FileSystem.downloadAsync(avatarUrl, localPath);
      log("Downloaded avatar to:", downloadRes?.uri);

      const profileBase64 = await FileSystem.readAsStringAsync(downloadRes.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      log("profileBase64 length:", profileBase64?.length);

      // 4) take selfie
      log("Step 4: takePictureAsync()");
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6, // slightly smaller payload than 0.7
        base64: true,
        skipProcessing: true,
      });

      if (!photo?.base64) throw new Error("Could not capture photo");
      const selfieBase64 = photo.base64;
      log("selfieBase64 length:", selfieBase64?.length);

      // Quick size sanity (very rough)
      const approxBytes = (profileBase64.length + selfieBase64.length) * 0.75;
      log("Approx payload bytes (both images):", approxBytes);

      // 5) send to Lambda
      log("Step 5: POST");
            const payload = JSON.stringify({
        userId: user.id,
        selfieBase64,
        profileBase64,
      });

      let res = null;
      let lastErr = null;

      for (const url of BACKEND_VERIFY_URLS) {
        const t0 = Date.now();
        log("Trying URL:", url);

        try {
          res = await fetchWithTimeout(
            url,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
            },
            60000 // ✅ give it 60s for cold start + Rekognition
          );

          log("URL finished in ms:", Date.now() - t0);
          log("HTTP status:", res.status, "ok:", res.ok);

          const text = await res.text().catch(() => "");
          log("Raw response text:", short(text, 500));

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${short(text, 500)}`);
          }


          // success
          let json;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            throw new Error("Backend returned non-JSON response");
          }

          log("Parsed JSON:", json);
          // ✅ reuse existing logic below by setting jsonVar
          var jsonVar = json; // eslint-disable-line no-var
          break;
        } catch (e) {
          lastErr = e;
          log("URL error:", e?.message || e);
        }
      }

      if (!res) {
        throw lastErr || new Error("No response from backend");
      }

      if (typeof jsonVar === "undefined") {
        throw lastErr || new Error("Backend did not return valid JSON");
      }

      const json = jsonVar;

            if (!json?.faceDetected) {
        Alert.alert(t("avatar_invalid_title"), t("avatar_invalid_message"));
        return;
      }

      if (!json?.match) {
        Alert.alert(
          "Verification failed",
          "We couldn't match your face with your profile picture. Please try again."
        );
        return;
      }


      // 6) mark verified
      log("Step 6: update profiles.is_verified");
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (upErr) throw upErr;

      log("SUCCESS → reset to Community");
      navigation.reset({ index: 0, routes: [{ name: "Community" }] });
    } catch (e) {
      console.log("[FaceVerify] FULL ERROR:", e);
      Alert.alert(
        "Error",
        `Something went wrong while verifying.\n${e?.message || e}`
      );
    } finally {
      setVerifying(false);
    }
  };

  if (!fontsLoaded) return null;

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.permissionText}>
            Camera permission is required for face verification.
          </Text>
          <Button title="Grant permission" onPress={requestPermission} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color="#111111" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{t("verification_face_title")}</Text>
        <Text style={styles.body}>{t("verification_face_body")}</Text>

        <View style={styles.cameraFrame}>
          <CameraView ref={cameraRef} style={styles.camera} facing="front" />
          <View style={styles.overlayCircle} />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, verifying && { opacity: 0.6 }]}
          onPress={handleVerify}
          disabled={verifying}
        >
          {verifying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>
              {t("verification_face_button_dev_complete")}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  headerRow: { paddingTop: 16, paddingHorizontal: 16 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  title: { fontFamily: "PoppinsBold", fontSize: 24, marginBottom: 8, color: "#111111" },
  body: { fontFamily: "Poppins", fontSize: 14, color: "#444444", lineHeight: 20, marginBottom: 16 },
  cameraFrame: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  camera: { ...StyleSheet.absoluteFillObject },
  overlayCircle: { width: 200, height: 200, borderRadius: 100, borderWidth: 2, borderColor: "#FFFFFF" },
  primaryBtn: { borderRadius: 999, backgroundColor: "#4BA8FF", paddingVertical: 12, alignItems: "center" },
  primaryText: { fontFamily: "PoppinsBold", fontSize: 15, color: "#FFFFFF" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  permissionText: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", color: "#444444", marginBottom: 12 },
});
