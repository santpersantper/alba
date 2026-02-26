// screens/SinglePostScreen.js
import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";

import { supabase } from "../lib/supabase";
import ThemedView from "../theme/ThemedView";
import ThemedText from "../theme/ThemedText";
import { useAlbaTheme } from "../theme/ThemeContext";
import Post from "../components/Post";

const toArray = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [raw];
      } catch {
        return [raw];
      }
    }
    return [trimmed];
  }
  return [];
};

export default function SinglePostScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme, isDark } = useAlbaTheme();

  const postId = route?.params?.postId ?? null;
  const postPreview = route?.params?.postPreview ?? null;

  const [post, setPost] = useState(postPreview || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    if (!postId) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // show loading only if we don't already have media to render
        const previewHasMedia =
          toArray(postPreview?.postmediauri || postPreview?.postMediaUri || postPreview?.media).length > 0 ||
          !!postPreview?.image;

        setLoading(!previewHasMedia);

        const { data, error } = await supabase
          .from("posts")
          .select("id, user, userpicuri, author_id, title, description, postmediauri, actions, type, date, time, location")
          .eq("id", postId)
          .maybeSingle();

        if (error) throw error;
        if (!alive) return;

        if (data) setPost(data);
      } catch {
        // keep preview if any
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [postId]);

  // ✅ Build a post object that ALWAYS has postmediauri once available
  const effectivePost = useMemo(() => {
    const p = post || postPreview || null;
    if (!p) return null;

    const media = toArray(p.postmediauri || p.postMediaUri || p.media || null);
    const thumb = p.image || (media.length ? media[0] : null);
    const ensuredMedia = media.length ? media : thumb ? [thumb] : [];

    return {
      ...p,
      postmediauri: ensuredMedia,
      userpicuri: p.userpicuri || p.avatar || p.avatarUrl || null,
    };
  }, [post, postPreview]);

  const mediaArr = useMemo(() => toArray(effectivePost?.postmediauri), [effectivePost]);

  // ✅ IMPORTANT: force Post.js to remount once media arrives (since Post freezes media on mount)
  const postKey = useMemo(() => {
    const first = mediaArr?.[0] ? String(mediaArr[0]) : "";
    return `${postId || effectivePost?.id || "noid"}:${mediaArr?.length || 0}:${first.slice(0, 40)}`;
  }, [postId, effectivePost, mediaArr]);

  const canRenderPost = !!(effectivePost && mediaArr.length > 0);

  return (
    <ThemedView style={[styles.root, { backgroundColor: isDark ? theme.gray : theme.background }]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: isDark ? theme.gray : theme.background }}>
        <View style={[styles.header, { borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "#EAEFF6" }]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.backBtn}
            activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={24} color={isDark ? "#FFFFFF" : "#111111"} />
          </TouchableOpacity>

          <ThemedText style={styles.headerTitle}>Post</ThemedText>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <View style={styles.body}>
        {loading && !canRenderPost ? (
          <View style={styles.center}>
            <ActivityIndicator color={isDark ? "#FFFFFF" : "#111111"} />
          </View>
        ) : effectivePost ? (
          <Post
            key={postKey}
            post={effectivePost}
            postId={effectivePost.id}
            authorId={effectivePost.author_id}
            user={effectivePost.user}
            userPicUri={effectivePost.userpicuri || "https://placehold.co/48x48"}
            title={effectivePost.title}
            description={effectivePost.description}
            type={effectivePost.type}
            date={effectivePost.date}
            time={effectivePost.time}
            location={effectivePost.location}
            actions={effectivePost.actions || []}
            postMediaUri={effectivePost.postmediauri}
            postMediaUriHint={effectivePost.postmediauri}
            isActive={true}
            colors={["#56d1f0", "#00a4e6", "#60affe"]}
          />
        ) : (
          <View style={styles.center}>
            <ThemedText style={{ opacity: 0.8 }}>Post not found.</ThemedText>
          </View>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Poppins", fontSize: 18, fontWeight: "700" },
  body: { flex: 1, paddingTop: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
