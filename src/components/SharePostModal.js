// components/SharePostModal.js
// Modal for sharing a post on the user's profile (quote-tweet style).
// Preview matches the PostMessage card design exactly.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

// ─── helpers ────────────────────────────────────────────────────────────────

const isVideoUri = (uri) => {
  if (!uri) return false;
  const p = String(uri).toLowerCase().split("?")[0];
  return p.endsWith(".mp4") || p.endsWith(".mov") || p.endsWith(".avi") || p.endsWith(".webm");
};

function VideoThumbnail({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.bufferOptions = { preferredForwardBufferDuration: 3, minBufferForPlayback: 1 };
  });
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function SharePostModal({
  visible,
  onClose,
  postId,
  postPreview, // optional: same shape as PostMessage postPreview
  onShared,    // called with the new share post id on success
}) {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [post, setPost] = useState(null);

  // ── fetch post data if no preview ──────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    if (postPreview) {
      setPost(normalisePreview(postPreview, postId));
      return;
    }

    if (!postId) return;

    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("posts")
          .select("id, username, userpicuri, author_id, title, description, postmediauri, thumbnail_url, type")
          .eq("id", postId)
          .maybeSingle();
        if (error || !alive) return;
        const p = normaliseRow(data, postId);
        if (alive) setPost(p);
      } catch {}
    })();
    return () => { alive = false; };
  }, [visible, postId, postPreview]);

  // reset comment when closed
  useEffect(() => {
    if (!visible) setComment("");
  }, [visible]);

  // ── derived preview data ────────────────────────────────────────────────────
  const preview = useMemo(() => {
    if (post) return post;
    if (postPreview) return normalisePreview(postPreview, postId);
    return null;
  }, [post, postPreview, postId]);

  // ── share ───────────────────────────────────────────────────────────────────
  const handleShare = async () => {
    if (submitting) return;
    setSubmitting(true);
    console.log("[SharePost] handleShare called — postId:", postId, "comment:", comment.trim() || null);
    try {
      console.log("[SharePost] calling share_post RPC...");
      const { data, error } = await supabase.rpc("share_post", {
        p_original_post_id: postId,
        p_comment: comment.trim() || null,
      });
      console.log("[SharePost] RPC result — data:", data, "error:", error);

      if (error) {
        console.warn("[SharePost] RPC error — code:", error.code, "message:", error.message, "details:", error.details, "hint:", error.hint);
        if (error.message?.includes("rate_limited")) {
          Alert.alert("", t("share_rate_limited") || "You already shared this recently. Try again in a few minutes.");
        } else {
          Alert.alert("", t("share_error") || "Could not share. Please try again.");
        }
        return;
      }

      // fire-and-forget notifications
      const newSharePostId = data;
      console.log("[SharePost] success — newSharePostId:", newSharePostId);
      supabase.functions.invoke("send-push", {
        body: {
          type: "post_shared",
          original_post_id: postId,
          share_post_id: newSharePostId,
          comment: comment.trim() || null,
        },
      }).catch((e) => console.warn("[SharePost] send-push error:", e?.message));

      onShared?.(newSharePostId);
      onClose();
      Alert.alert("", t("share_success") || "Post shared!");
    } catch (e) {
      console.error("[SharePost] caught exception:", e?.message, e);
      Alert.alert("", t("share_error") || "Could not share. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  const bg = isDark ? "#121212" : "#fff";
  const cardBg = isDark ? theme.gray : "#fff";
  const borderColor = isDark ? "#2D3748" : "#E0E4EA";
  const subtleText = isDark ? "#C1CAD6" : "#888";
  const bodyText = isDark ? "#E1E5EE" : "#3A3F46";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.kav}
        >
          <View style={[styles.sheet, { backgroundColor: bg }]}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={22} color={isDark ? "#C1CAD6" : "#555"} />
              </TouchableOpacity>
              <Text style={[styles.headerTitle, { color: theme.text }]}>
                {t("share_on_profile") || "Share on my profile"}
              </Text>
              <View style={{ width: 22 }} />
            </View>

            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Comment input */}
              <TextInput
                style={[
                  styles.commentInput,
                  {
                    color: theme.text,
                    backgroundColor: isDark ? "#1E2330" : "#F4F6F9",
                    borderColor: isDark ? "#2D3748" : "#DDE1E9",
                  },
                ]}
                placeholder={t("share_comment_placeholder") || "Say something about this… (optional)"}
                placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
                value={comment}
                onChangeText={(v) => setComment(v.slice(0, 150))}
                multiline
                maxLength={150}
                textAlignVertical="top"
              />
              <Text style={[styles.charCount, { color: isDark ? "#6B7280" : "#9CA3AF" }]}>
                {comment.length}/150
              </Text>

              {/* PostMessage-style preview card */}
              {preview ? (
                <View
                  style={[
                    styles.card,
                    { backgroundColor: cardBg, borderColor, borderWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  {/* Header row */}
                  <View style={styles.cardHeaderRow}>
                    {preview.avatar ? (
                      <ExpoImage
                        source={{ uri: preview.avatar }}
                        style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]}
                        contentFit="cover"
                        cachePolicy="disk"
                        transition={0}
                      />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.handle, { color: subtleText }]} numberOfLines={1}>
                        @{preview.user || "user"}
                      </Text>
                      <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                        {preview.title || "Shared post"}
                      </Text>
                    </View>
                  </View>

                  {/* Media */}
                  {preview.image ? (
                    <ExpoImage
                      source={{ uri: preview.image }}
                      style={[styles.media, { backgroundColor: isDark ? "#3A3F46" : "#E9EEF4" }]}
                      contentFit="cover"
                      cachePolicy="disk"
                      transition={0}
                    />
                  ) : preview.firstVideoUri ? (
                    <View style={[styles.media, { backgroundColor: "#000" }]}>
                      <VideoThumbnail uri={preview.firstVideoUri} style={StyleSheet.absoluteFill} />
                      <View style={styles.playOverlay}>
                        <View style={styles.playCircle}>
                          <Feather name="play" size={22} color="#fff" style={{ paddingLeft: 3 }} />
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {/* Excerpt */}
                  <Text style={[styles.excerpt, { color: bodyText }]} numberOfLines={2}>
                    {preview.description || "View post"}
                  </Text>
                </View>
              ) : (
                <View style={[styles.cardPlaceholder, { backgroundColor: cardBg, borderColor }]}>
                  <ActivityIndicator color="#4EBCFF" />
                </View>
              )}

              {/* Share button */}
              <TouchableOpacity
                style={[styles.shareBtn, { opacity: submitting ? 0.6 : 1 }]}
                onPress={handleShare}
                disabled={submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.shareBtnText}>
                    {t("share_button") || "Share"}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── normalise helpers ───────────────────────────────────────────────────────

function normalisePreview(p, postId) {
  const mediaArr = Array.isArray(p.postmediauri) ? p.postmediauri : [];
  const thumbUrl = p.thumbnail_url ?? null;
  const firstPhoto = mediaArr.find((uri) => uri && !isVideoUri(uri)) ?? null;
  const firstVideo = mediaArr.find((uri) => uri && isVideoUri(uri)) ?? null;
  const staticImage = thumbUrl || p.media || p.image || firstPhoto || null;
  return {
    id: p.id ?? postId,
    user: p.username ?? p.user ?? "user",
    avatar: p.avatarUrl ?? p.avatar ?? p.userpicuri ?? null,
    title: String(p.title || "Shared post").trim(),
    description: String(p.description || "View post").trim(),
    image: staticImage,
    firstVideoUri: !staticImage ? firstVideo : null,
  };
}

function normaliseRow(data, postId) {
  const mediaArr = Array.isArray(data?.postmediauri) ? data.postmediauri : [];
  const thumbUrl = data?.thumbnail_url ?? null;
  const firstPhoto = mediaArr.find((uri) => uri && !isVideoUri(uri)) ?? null;
  const firstVideo = mediaArr.find((uri) => uri && isVideoUri(uri)) ?? null;
  const staticImage = thumbUrl || firstPhoto || null;
  return {
    id: data?.id ?? postId,
    user: data?.username ?? "user",
    avatar: data?.userpicuri ?? null,
    title: String(data?.title || "Shared post").trim(),
    description: String(data?.description || "View post").trim(),
    image: staticImage,
    firstVideoUri: !staticImage ? firstVideo : null,
  };
}

// ─── styles ──────────────────────────────────────────────────────────────────

const RADIUS = 16;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  kav: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  headerTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "android" ? 56 : 32,
    gap: 12,
  },
  commentInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: "Poppins",
    fontSize: 14,
    minHeight: 80,
  },
  charCount: {
    fontFamily: "Poppins",
    fontSize: 11,
    textAlign: "right",
    marginTop: -6,
  },
  // PostMessage card replica
  card: {
    borderRadius: RADIUS,
    overflow: "hidden",
  },
  cardPlaceholder: {
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  avatar: { width: 26, height: 26, borderRadius: 13, marginRight: 8 },
  handle: { fontSize: 12, fontFamily: "Poppins" },
  cardTitle: { fontSize: 14, fontFamily: "PoppinsBold" },
  media: { width: "100%", height: 180, overflow: "hidden" },
  playOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
  playCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  excerpt: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 12,
    fontFamily: "Poppins",
  },
  shareBtn: {
    backgroundColor: "#3D8BFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  shareBtnText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
});
