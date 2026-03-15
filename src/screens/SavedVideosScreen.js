// screens/SavedVideosScreen.js
import React, { useCallback, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
  Pressable,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { VideoView, useVideoPlayer } from "expo-video";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

function resolveVideoUrl(storagePath) {
  if (!storagePath) return null;
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }
  const cleanedPath = storagePath.startsWith("public/")
    ? storagePath.replace(/^public\//, "")
    : storagePath;
  const { data } = supabase.storage.from("public").getPublicUrl(cleanedPath);
  return data?.publicUrl ?? null;
}

function VideoItem({ item, isActive, itemHeight, safeBottom, onUnsave }) {
  const [playing, setPlaying] = useState(false);

  const player = useVideoPlayer(item.videoUrl, (p) => {
    p.loop = true;
    p.bufferOptions = {
      preferredForwardBufferDuration: 10,
      minBufferForPlayback: 2,
      maxBufferBytes: 15 * 1024 * 1024, // 15 MB cap
    };
  });

  React.useEffect(() => {
    if (!player) return;
    try {
      if (isActive) {
        player.play();
        setPlaying(true);
      } else {
        player.pause();
        setPlaying(false);
      }
    } catch {}
  }, [player, isActive]);

  const togglePlay = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  return (
    <Pressable style={[styles.itemContainer, { height: itemHeight }]} onPress={togglePlay}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        allowsPictureInPicture={false}
        pointerEvents="none"
      />

      {!playing && (
        <View style={styles.playOverlay}>
          <Ionicons name="play-circle" size={64} color="rgba(255,255,255,0.85)" />
        </View>
      )}

      <View style={[styles.bottomOverlay, { bottom: safeBottom + 16 }]}>
        <View style={styles.captionBlock}>
          <Text style={styles.usernameText}>@{item.username}</Text>
          {!!item.caption && (
            <Text style={styles.captionText} numberOfLines={2}>
              {item.caption}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => onUnsave(item.id)} hitSlop={8} style={styles.bookmarkBtn}>
          <Ionicons name="bookmark" size={28} color="#3D8BFF" />
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

export default function SavedVideosScreen({ navigation }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [savedVideos, setSavedVideos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewHeight, setViewHeight] = useState(SCREEN_HEIGHT);
  const listRef = useRef(null);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const loadSaved = useCallback(async () => {
    try {
      setLoading(true);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes?.user) throw new Error("Not authenticated");

      const userId = userRes.user.id;
      setUid(userId);

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("saved_feed_videos")
        .eq("id", userId)
        .single();

      if (profileErr) throw profileErr;

      const ids = Array.isArray(profile?.saved_feed_videos)
        ? profile.saved_feed_videos
        : [];

      if (!ids.length) {
        setSavedVideos([]);
        return;
      }

      const { data: rows, error: rowsErr } = await supabase
        .from("feed_videos")
        .select("id, user_id, username, caption, video_storage_path, created_at")
        .in("id", ids);

      if (rowsErr) throw rowsErr;

      const mapped = (rows || [])
        .map((row) => {
          const videoUrl = resolveVideoUrl(row.video_storage_path);
          if (!videoUrl) return null;
          return {
            id: String(row.id),
            userId: row.user_id,
            username: row.user_id || row.username || "alba_user",
            caption: row.caption || "",
            videoUrl,
          };
        })
        .filter(Boolean);

      const orderMap = {};
      ids.forEach((id, idx) => { orderMap[String(id)] = idx; });
      mapped.sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999));

      setSavedVideos(mapped);
    } catch {
      setSavedVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSaved();
    }, [loadSaved])
  );

  const handleUnsave = useCallback(
    (id) => {
      if (!uid) return;
      setSavedVideos((prev) => {
        const updated = prev.filter((v) => v.id !== id);
        const newIds = updated.map((v) => v.id);
        supabase
          .from("profiles")
          .update({ saved_feed_videos: newIds })
          .eq("id", uid)
          .then(() => {});
        return updated;
      });
    },
    [uid]
  );

  const handleMomentumEnd = (event) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    const pageHeight = layoutMeasurement.height || viewHeight;
    const newIndex = Math.round(contentOffset.y / pageHeight);
    if (newIndex !== currentIndex) setCurrentIndex(newIndex);
  };

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  }

  return (
    <View style={styles.container}>
      {/* Floating header overlay */}
      <SafeAreaView style={styles.headerSafe} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation?.goBack?.()}
            style={styles.backBtn}
            hitSlop={8}
          >
            <Feather name="chevron-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("saved_videos_title")}</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : savedVideos.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t("saved_videos_empty")}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={savedVideos}
          keyExtractor={(item) => item.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h && h !== viewHeight) setViewHeight(h);
          }}
          onMomentumScrollEnd={handleMomentumEnd}
          renderItem={({ item, index }) => (
            <VideoItem
              item={item}
              isActive={index === currentIndex}
              itemHeight={viewHeight}
              safeBottom={insets.bottom}
              onUnsave={handleUnsave}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  headerSafe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  backBtn: { padding: 2 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontFamily: "PoppinsBold",
    color: "#fff",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Poppins",
    fontSize: 15,
  },
  itemContainer: {
    width: "100%",
    backgroundColor: "#000",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  bottomOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  captionBlock: { flex: 1, marginRight: 12 },
  usernameText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 14,
    marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captionText: {
    color: "#fff",
    fontFamily: "Poppins",
    fontSize: 13,
    opacity: 0.9,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bookmarkBtn: { marginBottom: 4 },
});
