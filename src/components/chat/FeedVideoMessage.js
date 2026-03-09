// components/chat/FeedVideoMessage.js
// Renders a shared Feed video in a chat bubble.
// Shows a static thumbnail (no VideoView — avoids FlatList rendering issues)
// with a play icon overlay. Tap → SinglePostScreen.
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
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../../lib/supabase";
import { useAlbaTheme } from "../../theme/ThemeContext";

// Tiny in-memory cache shared with PostMessage to avoid double-fetching
const POST_CACHE = new Map();

export default function FeedVideoMessage({
  id,
  isMe,
  time,
  postId,
  thumbnailUrl,   // pre-stored in messages.thumbnail_url — no fetch needed when present
  onDeleted,
}) {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

  const [post, setPost] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch post metadata only if we don't already have the thumbnail or title
  useEffect(() => {
    if (!postId || thumbnailUrl) return; // thumbnailUrl already stored — skip fetch
    const cached = POST_CACHE.get(postId);
    if (cached) { setPost(cached); return; }

    let alive = true;
    supabase
      .from("posts")
      .select("id, user, userpicuri, title, thumbnail_url")
      .eq("id", postId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        POST_CACHE.set(postId, data);
        setPost(data);
      });
    return () => { alive = false; };
  }, [postId, thumbnailUrl]);

  const effectiveThumbnail = thumbnailUrl || post?.thumbnail_url || null;
  const username = post?.user || "user";
  const title = post?.title || "Shared video";

  const goToPost = () => {
    navigation.navigate("SinglePost", {
      postId,
      postPreview: post
        ? { ...post, userpicuri: post.userpicuri, postmediauri: null }
        : null,
    });
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
                ) : (
                  // Placeholder when no thumbnail available
                  <View style={styles.thumbPlaceholder}>
                    <Feather name="film" size={32} color="rgba(255,255,255,0.3)" />
                  </View>
                )}
                {/* Subtle dark overlay so play button is always visible */}
                <View style={styles.thumbOverlay} />
                {/* Play button */}
                <View style={styles.playWrap}>
                  <View style={styles.playCircle}>
                    <Feather name="play" size={22} color="#fff" style={{ paddingLeft: 3 }} />
                  </View>
                </View>
                {/* "Video" pill badge */}
                <View style={styles.badge}>
                  <Feather name="film" size={10} color="#fff" style={{ marginRight: 3 }} />
                  <Text style={styles.badgeText}>Video</Text>
                </View>
              </View>

              {/* Footer: avatar + username + title */}
              <View style={styles.footer}>
                {post?.userpicuri ? (
                  <ExpoImage
                    source={{ uri: post.userpicuri }}
                    style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]}
                    contentFit="cover"
                    cachePolicy="disk"
                    transition={0}
                  />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: isDark ? "#2A2F38" : "#E5ECF4" }]} />
                )}
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
  title: { fontSize: 13, fontWeight: "700", fontFamily: "Poppins" },

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
  confirmBtnText: { color: "#fff", fontFamily: "Poppins", fontSize: 15, fontWeight: "600" },
});
