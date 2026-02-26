// components/chat/PostMessage.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../../lib/supabase";
import { useAlbaTheme } from "../../theme/ThemeContext";
import ShareMenu from "../ShareMenu";

// tiny in-memory cache to avoid re-fetching the same post repeatedly
const POST_CACHE = new Map(); // postId -> { id, user, title, description, image, avatar }

const prefetchUri = (uri) => {
  if (!uri) return;
  try {
    ExpoImage.prefetch?.(uri);
  } catch {}
};

const isVideoUri = (uri) => {
  if (!uri) return false;
  const p = String(uri).toLowerCase().split("?")[0];
  return p.endsWith(".mp4") || p.endsWith(".mov") || p.endsWith(".avi") || p.endsWith(".webm");
};

export default function PostMessage({
  id,
  isMe,
  time,
  postId,
  postPreview = null,
  onPress, // optional external handler (we'll still call it)
  onDeleted,
}) {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

  const previewPost = useMemo(() => {
    if (!postId && !postPreview) return null;
    const p = postPreview || POST_CACHE.get(postId) || {};

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
      // static image shown in the bubble (thumbnail > first photo > null)
      image: staticImage,
      // only set when there is no static image — renders video first-frame + play icon
      firstVideoUri: !staticImage ? firstVideo : null,
      thumbnail_url: thumbUrl,
      postmediauri: p.postmediauri ?? null,
      userpicuri: p.userpicuri ?? (p.avatarUrl ?? p.avatar ?? null),
      author_id: p.author_id ?? null,
      actions: p.actions ?? [],
      type: p.type ?? null,
      date: p.date ?? null,
      time: p.time ?? null,
      location: p.location ?? null,
    };
  }, [postPreview, postId]);

  const [post, setPost] = useState(previewPost);

  const [menuVisible, setMenuVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

  // adopt preview instantly
  useEffect(() => {
    if (!previewPost) return;
    setPost(previewPost);
    if (previewPost.avatar) prefetchUri(previewPost.avatar);
    if (previewPost.image) prefetchUri(previewPost.image);
  }, [previewPost]);

  // fallback fetch ONLY if not already cached/previewed
  useEffect(() => {
    let alive = true;

    if (!postId) return;

    const hasGoodPreview =
      !!postPreview &&
      (!!postPreview.title || !!postPreview.description || !!postPreview.media || !!postPreview.postmediauri);

    const cached = POST_CACHE.get(postId);
    if (hasGoodPreview || cached) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("posts")
          .select("id, user, userpicuri, author_id, title, description, postmediauri, thumbnail_url, actions, type, date, time, location")
          .eq("id", postId)
          .maybeSingle();

        if (error) throw error;
        if (!alive) return;

        const fetchedMedia = Array.isArray(data?.postmediauri) ? data.postmediauri : [];
        const fetchedThumb = data?.thumbnail_url ?? null;
        const fetchedFirstPhoto = fetchedMedia.find((uri) => uri && !isVideoUri(uri)) ?? null;
        const fetchedFirstVideo = fetchedMedia.find((uri) => uri && isVideoUri(uri)) ?? null;
        const fetchedStaticImage = fetchedThumb || fetchedFirstPhoto || null;

        const hydrated = {
          id: data?.id ?? postId,
          user: data?.user ?? "user",
          avatar: data?.userpicuri ?? null,
          userpicuri: data?.userpicuri ?? null,
          author_id: data?.author_id ?? null,
          title: data?.title ?? "Shared post",
          description: String(data?.description || "View post").trim(),
          image: fetchedStaticImage,
          firstVideoUri: !fetchedStaticImage ? fetchedFirstVideo : null,
          thumbnail_url: fetchedThumb,
          postmediauri: data?.postmediauri ?? null,
          actions: data?.actions ?? [],
          type: data?.type ?? null,
          date: data?.date ?? null,
          time: data?.time ?? null,
          location: data?.location ?? null,
        };

        POST_CACHE.set(postId, hydrated);
        setPost(hydrated);

        if (hydrated.avatar) prefetchUri(hydrated.avatar);
        if (hydrated.image) prefetchUri(hydrated.image);
      } catch {
        if (!alive) return;
        if (!post) {
          setPost({
            id: postId,
            user: "user",
            avatar: null,
            title: "Shared post",
            description: "View post",
            image: null,
            postmediauri: null,
          });
        }
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const openReport = () => {
    setMenuVisible(false);
    setReportVisible(true);
  };

  const submitReport = () => {
    console.log("REPORT post message", { messageId: id, postId, reason: reportText });
    setReportText("");
    setReportVisible(false);
    Alert.alert("", "Thanks for your report.");
  };

  const openDeleteConfirm = () => {
    setMenuVisible(false);
    setConfirmVisible(true);
  };

  const runDelete = async () => {
    if (!id) {
      setConfirmVisible(false);
      return;
    }
    try {
      setDeleting(true);
      const { error } = await supabase.from("messages").delete().eq("id", id);
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch (e) {
      console.warn("Post delete failed", e?.message || e);
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  const openForward = () => {
    setMenuVisible(false);
    setShareVisible(true);
  };

  const goToSinglePost = () => {
    const pid = post?.id || postId;
    if (!pid) return;

    // keep your old hook for compatibility (optional)
    if (onPress) {
      try {
        onPress(pid);
      } catch {}
    }

    // ✅ navigate to dedicated screen
    navigation.navigate("SinglePost", {
      postId: pid,
      // pass the best preview we have so SinglePostScreen can render instantly
      postPreview: post
        ? {
            ...post,
            // add fields SinglePostScreen/Post like
            userpicuri: post.userpicuri || post.avatar || null,
            postmediauri: post.postmediauri || null,
            author_id: post.author_id || null,
          }
        : postPreview || null,
    });
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={goToSinglePost}
        onLongPress={() => setMenuVisible(true)}
        delayLongPress={400}
      >
        <View style={styles.row}>
          <View style={[styles.bubble, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
            <View
              style={[
                styles.card,
                { backgroundColor: isDark ? theme.gray : "#fff" },

                // ✅ remove border on dark mode
                isDark
                  ? { borderWidth: 0, borderColor: "transparent" }
                  : isMe
                  ? { borderWidth: 1, borderColor: "#D9E6FF" }
                  : { borderWidth: 1, borderColor: "#F0F2F5" },
              ]}
            >
              {/* Header */}
              <View style={styles.headerRow}>
                {post?.avatar ? (
                  <ExpoImage
                    source={{ uri: post.avatar }}
                    style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]}
                    contentFit="cover"
                    cachePolicy="disk"
                    transition={0}
                  />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]} />
                )}

                <View style={{ flex: 1 }}>
                  <Text style={[styles.handle, { color: isDark ? "#C1CAD6" : "#888" }]} numberOfLines={1}>
                    @{post?.user || "user"}
                  </Text>
                  <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                    {post?.title || "Shared post"}
                  </Text>
                </View>
              </View>

              {/* Image or video first-frame */}
              {post?.image ? (
                <ExpoImage
                  source={{ uri: post.image }}
                  style={[styles.media, { backgroundColor: isDark ? "#3A3F46" : "#E9EEF4" }]}
                  contentFit="cover"
                  cachePolicy="disk"
                  transition={0}
                />
              ) : post?.firstVideoUri ? (
                <View style={[styles.media, { backgroundColor: "#000" }]}>
                  <Video
                    source={{ uri: post.firstVideoUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={false}
                    isMuted
                    isLooping={false}
                    volume={0}
                  />
                  <View style={styles.playOverlay}>
                    <View style={styles.playCircle}>
                      <Feather name="play" size={22} color="#fff" style={{ paddingLeft: 3 }} />
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Snippet */}
              <Text style={[styles.excerpt, { color: isDark ? "#E1E5EE" : "#3A3F46" }]} numberOfLines={2}>
                {post?.description || "View post"}
              </Text>
            </View>

            {!!time && (
              <Text
                style={[
                  styles.time,
                  { color: isDark ? "#A0A7B3" : "#9AA4AE" },
                  isMe ? styles.timeRight : styles.timeLeft,
                ]}
              >
                {time}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* bottom sheet menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuVisible(false)} />
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={openReport}>
            <Text style={styles.menuText}>Report</Text>
          </TouchableOpacity>

          {isMe && (
            <TouchableOpacity style={styles.menuItem} onPress={openForward}>
              <Text style={styles.menuText}>Forward</Text>
            </TouchableOpacity>
          )}

          {isMe && (
            <TouchableOpacity style={styles.menuItem} onPress={openDeleteConfirm}>
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>Delete</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.menuItem, { marginTop: 4 }]} onPress={() => setMenuVisible(false)}>
            <Text style={[styles.menuText, { color: "#6B7280" }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* report modal */}
      <Modal visible={reportVisible} transparent animationType="fade" onRequestClose={() => setReportVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report message</Text>
            <TextInput
              style={styles.reportInput}
              placeholder="Tell us briefly what is wrong"
              placeholderTextColor="#9CA3AF"
              value={reportText}
              onChangeText={setReportText}
              multiline
            />
            <View style={styles.reportRow}>
              <TouchableOpacity style={[styles.reportBtn, { backgroundColor: "#b0b6c0" }]} onPress={() => setReportVisible(false)}>
                <Text style={styles.reportBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: "#3D8BFF", opacity: reportText.trim() ? 1 : 0.6 }]}
                onPress={submitReport}
                disabled={!reportText.trim()}
              >
                <Text style={styles.reportBtnText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* delete confirm */}
      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Are you sure you want to delete this message?</Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Yes</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]} onPress={() => setConfirmVisible(false)}>
                <Text style={styles.confirmBtnText}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* forward (share post) */}
      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        onSent={() => setShareVisible(false)}
        postId={post?.id || postId}
      />
    </>
  );
}

const RADIUS = 16;

const styles = StyleSheet.create({
  row: { width: "100%", paddingBottom: 10 },
  bubble: { width: "78%" },
  bubbleLeft: { alignSelf: "flex-start" },
  bubbleRight: { alignSelf: "flex-end" },

  card: { borderRadius: RADIUS, overflow: "hidden" },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  avatar: { width: 26, height: 26, borderRadius: 13, marginRight: 8 },
  handle: { fontSize: 12, fontFamily: "Poppins" },
  title: { fontSize: 14, fontWeight: "700", fontFamily: "Poppins" },

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
  excerpt: { paddingHorizontal: 10, paddingVertical: 10, fontSize: 12, fontFamily: "Poppins" },

  time: { marginTop: 4, fontSize: 10, fontFamily: "Poppins" },
  timeLeft: { alignSelf: "flex-start", paddingLeft: 6 },
  timeRight: { alignSelf: "flex-end", paddingRight: 6 },

  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  menuCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
  },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  reportCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  reportTitle: { fontFamily: "Poppins", fontSize: 16, marginBottom: 10, textAlign: "center" },
  reportInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    minHeight: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Poppins",
    fontSize: 14,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  reportRow: { flexDirection: "row", gap: 10 },
  reportBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  reportBtnText: { color: "#fff", fontFamily: "Poppins", fontSize: 15, fontWeight: "600" },

  confirmCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  confirmTitle: { fontFamily: "Poppins", fontSize: 16, textAlign: "center", marginBottom: 14 },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "Poppins", fontSize: 15, fontWeight: "600" },
});
