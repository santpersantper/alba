// screens/SingleFeedVideoScreen.js
// Plays a single shared Feed video. Navigated to from FeedVideoMessage.
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Image as ExpoImage } from "expo-image";

import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const PUBLIC_BUCKET = "public";

function resolveVideoUrl(storagePath) {
  if (!storagePath) return null;
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) return storagePath;
  const cleaned = storagePath.startsWith("public/")
    ? storagePath.replace(/^public\//, "")
    : storagePath;
  const { data } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(cleaned);
  return data?.publicUrl ?? null;
}

function VideoPlayer({ videoUrl }) {
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export default function SingleFeedVideoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme, isDark } = useAlbaTheme();

  const postId = route?.params?.postId ?? null;

  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase
          .from("feed_videos")
          .select("id, user_id, username, caption, video_storage_path")
          .eq("id", postId)
          .maybeSingle();

        if (!alive || !data) return;

        // In feed_videos, user_id stores the poster's username (not a UUID)
        const username = data.user_id || data.username || "user";
        let avatarUrl = null;
        if (username && username !== "user") {
          const { data: prof } = await supabase
            .from("profiles")
            .select("avatar_url")
            .eq("username", username)
            .maybeSingle();
          avatarUrl = prof?.avatar_url || null;
        }

        setVideo({ ...data, username, _avatarUrl: avatarUrl });
      } catch {
        // keep loading=false so screen shows error state
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [postId]);

  const videoUrl = video?.video_storage_path ? resolveVideoUrl(video.video_storage_path) : null;

  return (
    <View style={styles.root}>
      {/* Black background */}
      <View style={StyleSheet.absoluteFill} />

      {/* Video */}
      {videoUrl && <VideoPlayer videoUrl={videoUrl} />}

      {/* Top bar */}
      <SafeAreaView edges={["top"]} style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <Feather name="chevron-left" size={26} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Loading */}
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}

      {/* No video found */}
      {!loading && !videoUrl && (
        <View style={styles.center}>
          <Text style={{ color: "#fff", fontFamily: "Poppins", opacity: 0.8 }}>
            Video not available.
          </Text>
        </View>
      )}

      {/* Bottom overlay: avatar + username + caption */}
      {video && (
        <SafeAreaView edges={["bottom"]} style={styles.bottomOverlay}>
          <TouchableOpacity
            style={styles.authorRow}
            activeOpacity={0.8}
            onPress={() => navigation.navigate("Profile", {
              userId: video.user_id || undefined,
              username: video.username || undefined,
            })}
          >
            {video._avatarUrl ? (
              <ExpoImage
                source={{ uri: video._avatarUrl }}
                style={styles.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.avatar, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
            )}
            <Text style={styles.username}>@{video.username || "alba_user"}</Text>
          </TouchableOpacity>
          {!!video.caption && (
            <Text style={styles.caption} numberOfLines={3}>
              {video.caption}
            </Text>
          )}
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    margin: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 22,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 20,
    background: "transparent",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
  },
  username: {
    color: "#fff",
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 15,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  caption: {
    color: "#fff",
    fontFamily: "Poppins",
    fontSize: 14,
    lineHeight: 20,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
