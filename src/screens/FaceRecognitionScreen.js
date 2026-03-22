// screens/FaceRecognitionScreen.js
import React, { useEffect, useRef, useState } from "react";
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
import { detectFacesAsync } from "expo-face-detector";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../lib/supabase";
import { invalidateAuthCache } from "../components/Post";
import { useAlbaLanguage } from "../theme/LanguageContext";

// Minimum displacement (in pixels) the face centre must travel across the
// rolling 2.5-second window before we consider the user "live".
const MOTION_THRESHOLD = 18;
// How often we sample a frame for face detection (ms)
const POLL_INTERVAL = 350;

export default function FaceRecognitionScreen() {
  const navigation = useNavigation();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [permission, requestPermission] = useCameraPermissions();
  const [verifying, setVerifying]       = useState(false);
  const [motionReady, setMotionReady]   = useState(false);
  const [faceVisible, setFaceVisible]   = useState(false);

  const cameraRef        = useRef(null);
  const facePositionsRef = useRef([]); // [{ x, y, timestamp }]
  const motionReadyRef   = useRef(false);
  const pollingRef       = useRef(null); // interval id

  const [alertModal, setAlertModal] = useState(null);
  const showModal = (title, message) => setAlertModal({ title, message });

  const handleBack = () => navigation.goBack();

  // ── Polling face detection ────────────────────────────────────────────────
  useEffect(() => {
    if (!permission?.granted || verifying) return;

    pollingRef.current = setInterval(async () => {
      if (!cameraRef.current || motionReadyRef.current) return;

      let snapshot;
      try {
        snapshot = await cameraRef.current.takePictureAsync({
          quality: 0.3,
          skipProcessing: true,
          shutterSound: false,
        });
      } catch {
        return; // camera not ready yet
      }

      if (!snapshot?.uri) return;

      let result;
      try {
        result = await detectFacesAsync(snapshot.uri, { mode: 1 }); // 1 = fast
      } catch (e) {
        console.log("[FaceDetect] detectFacesAsync error:", e?.message);
        return;
      }

      const faces = result?.faces ?? [];
      console.log("[FaceDetect] faces found:", faces.length);

      if (!faces.length) {
        setFaceVisible(false);
        return;
      }
      setFaceVisible(true);

      const face = faces[0];
      const cx = face.bounds.origin.x + face.bounds.size.width  / 2;
      const cy = face.bounds.origin.y + face.bounds.size.height / 2;
      const now = Date.now();

      facePositionsRef.current = [
        ...facePositionsRef.current.filter((p) => now - p.timestamp < 2500),
        { x: cx, y: cy, timestamp: now },
      ];

      const pts = facePositionsRef.current;
      if (pts.length < 5) return;

      let maxDist = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d > maxDist) maxDist = d;
        }
      }

      console.log("[FaceDetect] maxDist:", maxDist.toFixed(1), "threshold:", MOTION_THRESHOLD);

      if (maxDist >= MOTION_THRESHOLD) {
        console.log("[FaceDetect] MOTION READY");
        motionReadyRef.current = true;
        setMotionReady(true);
        clearInterval(pollingRef.current);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(pollingRef.current);
  }, [permission?.granted, verifying]);

  // ── Verification flow ─────────────────────────────────────────────────────
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
      if (!user?.id) {
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
      if (!avatarUrl) {
        showModal(
          "Profile photo missing",
          "Please upload a profile picture before verifying your face."
        );
        return;
      }

      // 3) download avatar + base64
      log("Step 3: download avatar");
      const localPath = `${FileSystem.cacheDirectory}avatar_${user.id}_${Date.now()}.jpg`;
      const downloadRes = await FileSystem.downloadAsync(avatarUrl, localPath);

      const resizedProfile = await ImageManipulator.manipulateAsync(
        downloadRes.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const profileBase64 = resizedProfile.base64;
      log("profileBase64 length:", profileBase64?.length);

      // 4) two selfie frames ~1 s apart — server uses pose diff for liveness
      log("Step 4a: takePictureAsync() frame 1");
      const photo1 = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
      });
      if (!photo1?.uri) throw new Error("Could not capture photo");

      await new Promise((resolve) => setTimeout(resolve, 1000));

      log("Step 4b: takePictureAsync() frame 2");
      const photo2 = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
      });

      const [resizedSelfie1, resizedSelfie2] = await Promise.all([
        ImageManipulator.manipulateAsync(
          photo1.uri,
          [{ resize: { width: 800 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        ),
        photo2?.uri
          ? ImageManipulator.manipulateAsync(
              photo2.uri,
              [{ resize: { width: 800 } }],
              { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
            )
          : Promise.resolve(null),
      ]);

      const selfieBase64  = resizedSelfie1.base64;
      const selfie2Base64 = resizedSelfie2?.base64 ?? undefined;
      log("selfie1:", selfieBase64?.length, "selfie2:", selfie2Base64?.length ?? 0);

      // 5) send to verify-face edge function
      log("Step 5: supabase.functions.invoke verify-face");
      const { data: verifyData, error: verifyErr } = await supabase.functions.invoke(
        "verify-face",
        { body: { selfieBase64, selfie2Base64, profileBase64 } }
      );
      if (verifyErr) throw new Error(`Verification failed: ${verifyErr.message}`);

      log("verifyData:", JSON.stringify(verifyData));

      if (!verifyData?.faceDetected) {
        const reason = verifyData?.reason;
        let message = "No face was detected in your selfie. Please make sure your face is clearly visible and try again.";
        if (reason === "low_sharpness")    message = "Your selfie was too blurry. Please hold your phone steady and try again.";
        if (reason === "bad_lighting")     message = "Lighting conditions weren't suitable. Try in a well-lit area and avoid glare.";
        if (reason === "eyes_closed")      message = "Your eyes appear closed in the photo. Please keep your eyes open and try again.";
        if (reason === "multiple_faces")   message = "Multiple faces were detected. Please make sure you're the only person in frame.";
        if (reason === "no_liveness")      message = "We couldn't confirm you're live. Please move your head slightly and try again.";
        showModal("Verification failed", message);
        return;
      }
      if (!verifyData?.match) {
        showModal(
          "Verification failed",
          "We couldn't match your face with your profile picture. Please try again."
        );
        return;
      }
      if (!verifyData?.ok) throw new Error("Verification failed. Please try again.");

      log("SUCCESS → reset to Community");
      invalidateAuthCache();
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
      // Reset motion state so a retry requires fresh movement
      motionReadyRef.current = false;
      setMotionReady(false);
      facePositionsRef.current = [];
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const motionStatus = verifying
    ? null
    : motionReady
    ? "Ready — tap to verify"
    : faceVisible
    ? "Move your head slightly…"
    : "Position your face in the circle";

  const btnDisabled = verifying || !motionReady;

  if (!fontsLoaded) return null;

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}><ActivityIndicator /></View>
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
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
          />
          <View style={[
            styles.overlayCircle,
            motionReady && styles.overlayCircleReady,
          ]} />
        </View>

        {/* Motion liveness status */}
        {motionStatus ? (
          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              motionReady ? styles.dotReady : faceVisible ? styles.dotActive : styles.dotIdle,
            ]} />
            <Text style={[styles.statusText, motionReady && styles.statusTextReady]}>
              {motionStatus}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryBtn, btnDisabled && styles.primaryBtnDisabled]}
          onPress={handleVerify}
          disabled={btnDisabled}
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
  body:  { fontFamily: "Poppins", fontSize: 14, color: "#444444", lineHeight: 20, marginBottom: 16 },
  cameraFrame: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  camera: { ...StyleSheet.absoluteFillObject },
  overlayCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
  },
  overlayCircleReady: {
    borderColor: "#4BFF9F",
    borderWidth: 3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotIdle:   { backgroundColor: "#CCCCCC" },
  dotActive: { backgroundColor: "#4BA8FF" },
  dotReady:  { backgroundColor: "#4BFF9F" },
  statusText:      { fontFamily: "Poppins", fontSize: 13, color: "#666666" },
  statusTextReady: { color: "#2AA86A", fontFamily: "PoppinsBold" },
  primaryBtn:         { borderRadius: 999, backgroundColor: "#4BA8FF", paddingVertical: 12, alignItems: "center" },
  primaryBtnDisabled: { backgroundColor: "#B0CEEF" },
  primaryText: { fontFamily: "PoppinsBold", fontSize: 15, color: "#FFFFFF" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  permissionText: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", color: "#444444", marginBottom: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  modalCard: { width: "80%", backgroundColor: "#FFFFFF", borderRadius: 18, padding: 24, alignItems: "center", elevation: 4 },
  modalTitle:   { fontFamily: "PoppinsBold", fontSize: 16, color: "#111111", marginBottom: 8 },
  modalMessage: { fontFamily: "Poppins", fontSize: 14, color: "#444444", textAlign: "center", lineHeight: 20, marginBottom: 20 },
  modalBtn:     { backgroundColor: "#4BA8FF", borderRadius: 999, paddingHorizontal: 32, paddingVertical: 10 },
  modalBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#FFFFFF" },
});
