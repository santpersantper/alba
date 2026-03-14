// components/chat/FeedVideoMessage.js
// Renders a shared Feed video in a chat bubble.
// Shows a static thumbnail or a muted VideoView first-frame with a play icon overlay.
// Tap → Feed tab.
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../../lib/supabase";
import { useAlbaTheme } from "../../theme/ThemeContext";

// In-memory cache: postId → enriched feed_video row
// Keyed as "postId:username" to detect stale "alba_user" entries and re-fetch
const POST_CACHE = new Map();

function resolveVideoUrl(storagePath) {
  if (!storagePath) return null;
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) return storagePath;
  const cleanedPath = storagePath.startsWith("public/")
    ? storagePath.replace(/^public\//, "")
    : storagePath;
  const { data } = supabase.storage.from("public").getPublicUrl(cleanedPath);
  return data?.publicUrl ?? null;
}

// Muted VideoView paused at frame 0 — shows first frame as a static thumbnail
function VideoFirstFrame({ videoUrl, style }) {
  const player = useVideoPlayer(videoUrl, (p) => { p.muted = true; });
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

export default function FeedVideoMessage({
  id,
  isMe,
  time,
  postId,
  thumbnailUrl,   // optional static thumbnail pre-stored in message content
  onDeleted,
}) {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

  const [post, setPost] = useState(null);
  const [isActuallyPost, setIsActuallyPost] = useState(false); // true when postId belongs to posts table
  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch feed video metadata — falls back to posts table for old incorrectly-encoded messages
  useEffect(() => {
    if (!postId) return;
    const cached = POST_CACHE.get(postId);
    // Skip cache if username is still the placeholder — always re-fetch to get real username
    if (cached && cached.username && cached.username !== "alba_user") {
      setPost(cached);
      setIsActuallyPost(!!cached._isPost);
      return;
    }

    let alive = true;
    (async () => {
      // 1. Try feed_videos first
      const { data } = await supabase
        .from("feed_videos")
        .select("id, user_id, username, caption, video_storage_path")
        .eq("id", postId)
        .maybeSingle();

      if (alive && data) {
        // In feed_videos, user_id stores the poster's username (not a UUID)
        const enriched = { ...data, username: data.user_id || data.username || "user" };
        POST_CACHE.set(postId, enriched);
        if (alive) { setPost(enriched); setIsActuallyPost(false); }
        return;
      }

      // 2. postId not in feed_videos — it's a community post incorrectly encoded as __feed_video__
      const { data: postData } = await supabase
        .from("posts")
        .select("id, user, author_id, title, description")
        .eq("id", postId)
        .maybeSingle();
      if (!alive) return;

      if (postData) {
        const enriched = {
          id: postData.id,
          username: postData.user || "user",
          caption: postData.title || postData.description || "Shared post",
          video_storage_path: null,
          _isPost: true,
        };
        POST_CACHE.set(postId, enriched);
        setPost(enriched);
        setIsActuallyPost(true);
      }
    })();
    return () => { alive = false; };
  }, [postId]);

  const effectiveThumbnail = thumbnailUrl || null;
  const videoUrl = post?.video_storage_path ? resolveVideoUrl(post.video_storage_path) : null;
  const username = post?.username || "alba_user";
  const title = post?.caption || "Shared video";

  const goToPost = () => {
    if (isActuallyPost) {
      navigation.navigate("SinglePost", { postId });
    } else {
      navigation.navigate("SingleFeedVideo", { postId });
    }
  };

  const runDelete = async () => {
    if (!id) { setConfirmVisible(false); return; }
    try {
      setDeleting(true);
      const { error } = await supabase.from("messages").delete().eq("id", id);
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch {
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={goToPost}
        onLongPress={() => setMenuVisible(true)}
        delayLongPress={400}
      >
        <View style={styles.row}>
          <View style={[styles.bubble, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
            <View
              style={[
                styles.card,
                { backgroundColor: isDark ? theme.gray : "#fff" },
                isDark
                  ? { borderWidth: 0 }
                  : isMe
                  ? { borderWidth: 1, borderColor: "#D9E6FF" }
                  : { borderWidth: 1, borderColor: "#F0F2F5" },
              ]}
            >
              {/* Thumbnail area */}
              <View style={[styles.thumb, { backgroundColor: "#0a0a0a" }]}>
                {effectiveThumbnail ? (
                  <ExpoImage
                    source={{ uri: effectiveThumbnail }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="disk"
                    transition={0}
                  />
                ) : videoUrl ? (
                  <VideoFirstFrame videoUrl={videoUrl} style={StyleSheet.absoluteFill} />
                ) : (
                  <View style={styles.thumbPlaceholder}>
                    <Feather name={isActuallyPost ? "file-text" : "film"} size={32} color="rgba(255,255,255,0.3)" />
                  </View>
                )}
                {/* Subtle dark overlay */}
                <View style={styles.thumbOverlay} />
                {/* Play button — only shown for real videos, not community posts */}
                {!isActuallyPost && (
                  <View style={styles.playWrap}>
                    <View style={styles.playCircle}>
                      <Feather name="play" size={22} color="#fff" style={{ paddingLeft: 3 }} />
                    </View>
                  </View>
                )}
                {/* Type pill badge */}
                <View style={styles.badge}>
                  <Feather name={isActuallyPost ? "file-text" : "film"} size={10} color="#fff" style={{ marginRight: 3 }} />
                  <Text style={styles.badgeText}>{isActuallyPost ? "Post" : "Video"}</Text>
                </View>
              </View>

              {/* Footer: avatar + username + title */}
              <View style={styles.footer}>
                <View style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.handle, { color: isDark ? "#C1CAD6" : "#888" }]}
                    numberOfLines={1}
                  >
                    @{username}
                  </Text>
                  <Text
                    style={[styles.title, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                </View>
              </View>
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

      {/* Long-press menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        />
        <View style={styles.menuCard}>
          {isMe && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuVisible(false); setConfirmVisible(true); }}
            >
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>Delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.menuItem, { marginTop: 4 }]}
            onPress={() => setMenuVisible(false)}
          >
            <Text style={[styles.menuText, { color: "#6B7280" }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Delete this message?</Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.confirmBtnText}>Yes</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={styles.confirmBtnText}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const RADIUS = 16;

const styles = StyleSheet.create({
  row: { width: "100%", paddingBottom: 10 },
  bubble: { width: "72%" },
  bubbleLeft: { alignSelf: "flex-start" },
  bubbleRight: { alignSelf: "flex-end" },
  card: { borderRadius: RADIUS, overflow: "hidden" },

  thumb: { width: "100%", height: 190, overflow: "hidden" },
  thumbPlaceholder: { flex: 1, justifyContent: "center", alignItems: "center" },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  playWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Poppins" },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  avatar: { width: 26, height: 26, borderRadius: 13, marginRight: 8 },
  handle: { fontSize: 11, fontFamily: "Poppins" },
  title: { fontSize: 13, fontFamily: "PoppinsBold" },

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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  confirmCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  confirmTitle: {
    fontFamily: "Poppins",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 14,
  },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
});
