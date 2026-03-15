// screens/FaceRecognitionScreen.js
import React, { useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Button,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../lib/supabase";
import { invalidateAuthCache } from "../components/Post";
import { useAlbaLanguage } from "../theme/LanguageContext";
import Constants from "expo-constants";

// Lambda endpoint — read from env so the URL is not baked into the binary.
// Set EXPO_PUBLIC_LAMBDA_VERIFY_URL in .env.local / EAS Secrets.
const LAMBDA_VERIFY_URL =
  process.env.EXPO_PUBLIC_LAMBDA_VERIFY_URL ??
  Constants?.expoConfig?.extra?.expoPublic?.LAMBDA_VERIFY_URL ??
  "";

const BACKEND_VERIFY_URLS = LAMBDA_VERIFY_URL ? [LAMBDA_VERIFY_URL] : [];


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
  const [alertModal, setAlertModal] = useState(null); // { title, message }
  const showModal = (title, message) => setAlertModal({ title, message });

  const handleBack = () => navigation.goBack();

  const handleVerify = async () => {
    const runId = `verify_${Date.now()}`;
    const log = (...args) => console.log(`[FaceVerify:${runId}]`, ...args);

    if (!cameraRef.current) {
      showModal("Error", "Camera not ready yet.");
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
        showModal(
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

      // Resize profile image to max 800px — Rekognition doesn't need full resolution
      const resizedProfile = await ImageManipulator.manipulateAsync(
        downloadRes.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const profileBase64 = resizedProfile.base64;
      log("profileBase64 length:", profileBase64?.length);

      // 4) take selfie
      log("Step 4: takePictureAsync()");
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
      });

      if (!photo?.uri) throw new Error("Could not capture photo");

      // Resize selfie to max 800px before sending
      const resizedSelfie = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const selfieBase64 = resizedSelfie.base64;
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
            let parsed;
            try { parsed = JSON.parse(text); } catch {}
            if (parsed?.message?.toLowerCase().includes("invalid parameters")) {
              throw new Error("PROFILE_NO_FACE");
            }
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
        showModal(t("avatar_invalid_title"), t("avatar_invalid_message"));
        return;
      }

      if (!json?.match) {
        showModal(
          "Verification failed",
          "We couldn't match your face with your profile picture. Please try again."
        );
        return;
      }


      // 6) Mark verified via Edge Function (service-role key server-side).
      // We never write is_verified directly from the client — RLS blocks it.
      log("Step 6: supabase.functions.invoke verify-face");
      const { data: verifyData, error: verifyErr } = await supabase.functions.invoke(
        "verify-face",
        { body: { userId: user.id } }
      );
      if (verifyErr) throw new Error(`Verification failed: ${verifyErr.message}`);
      if (!verifyData?.ok) throw new Error("Verification failed. Please try again.");

      log("SUCCESS → reset to Community");
      invalidateAuthCache(); // force Post.js to re-fetch isVerified on next render
      navigation.reset({ index: 0, routes: [{ name: "Community" }] });
    } catch (e) {
      console.log("[FaceVerify] FULL ERROR:", e);
      if (e?.message === "PROFILE_NO_FACE") {
        showModal(
          "Profile photo issue",
          "Your profile picture doesn't appear to contain a detectable face. Please update your profile photo with a clear picture of your face and try again."
        );
      } else {
        showModal("Error", "Something went wrong while verifying. Please try again.");
      }
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

      <Modal
        visible={!!alertModal}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{alertModal?.title}</Text>
            <Text style={styles.modalMessage}>{alertModal?.message}</Text>
            <TouchableOpacity
              style={styles.modalBtn}
              onPress={() => setAlertModal(null)}
            >
              <Text style={styles.modalBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: "80%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    elevation: 4,
  },
  modalTitle: { fontFamily: "PoppinsBold", fontSize: 16, color: "#111111", marginBottom: 8 },
  modalMessage: { fontFamily: "Poppins", fontSize: 14, color: "#444444", textAlign: "center", lineHeight: 20, marginBottom: 20 },
  modalBtn: {
    backgroundColor: "#4BA8FF",
    borderRadius: 999,
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  modalBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#FFFFFF" },
});
