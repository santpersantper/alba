// screens/SavedPostsScreen.js
import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Text,
  TouchableOpacity,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import Post from "../components/Post";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import ThemedView from "../theme/ThemedView";

export default function SavedPostsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [savedPosts, setSavedPosts] = useState([]); // [{...post, saved_at}]

  const { theme, isDark } = useAlbaTheme();

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
        .select("saved_posts, save_times")
        .eq("id", userId)
        .single();

      if (profileErr) throw profileErr;

      const ids = Array.isArray(profile?.saved_posts)
        ? profile.saved_posts
        : [];
      const times = Array.isArray(profile?.save_times)
        ? profile.save_times
        : [];

      if (!ids.length) {
        setSavedPosts([]);
        return;
      }

      const { data: posts, error: postsErr } = await supabase
        .from("posts")
        .select("*")
        .in("id", ids);

      if (postsErr) throw postsErr;

      const timeMap = {};
      ids.forEach((id, idx) => {
        timeMap[id] =
          times[idx] ||
          times[times.length - 1] ||
          new Date().toISOString();
      });

      const merged = (posts || [])
        .map((p) => ({
          ...p,
          saved_at: timeMap[p.id] || new Date().toISOString(),
        }))
        .sort(
          (a, b) =>
            new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()
        );

      setSavedPosts(merged);
    } catch (e) {
      Alert.alert("Error", "Couldn't load saved posts.");
      setSavedPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSaved();
    }, [loadSaved])
  );

  // Unsave here => remove from list and update profile arrays
  const handleToggleSave = useCallback(
    (postId, nextSaved) => {
      if (!uid) return;

      setSavedPosts((prev) => {
        let updated = prev;

        if (!nextSaved) {
          updated = prev.filter((p) => p.id !== postId);
        }

        const ids = updated.map((p) => p.id);
        const times = updated.map(
          (p) => p.saved_at || new Date().toISOString()
        );

        supabase
          .from("profiles")
          .update({ saved_posts: ids, save_times: times })
          .eq("id", uid)
          .then(() => {});

        return updated;
      });
    },
    [uid]
  );

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#FFFFFF" }} />;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.gray }]}
    >
      {/* Header */}
      <ThemedView variant="gray" style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text
          style={[
            styles.headerTitle,
            { color: theme.text },
          ]}
        >
          Saved Posts
        </Text>
        <View style={{ width: 24 }} />
      </ThemedView>

      <View
        style={[
          styles.container,
          { backgroundColor: theme.background },
        ]}
      >
        {loading && !savedPosts.length ? (
          <ThemedView variant="gray" style={styles.center}>
            <ActivityIndicator size="large" />
          </ThemedView>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              { backgroundColor: theme.gray },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {savedPosts.map((p) => (
              <Post
                key={p.id}
                postId={p.id}
                title={p.title}
                description={p.description}
                type={p.type}
                date={p.date}
                time={p.time}
                user={p.user}
                userPicUri={p.userpicuri || "https://placehold.co/48x48"}
                colors={["#56d1f0", "#00a4e6", "#60affe"]}
                actions={p.actions || []}
                actionIconPaths={[]}
                postMediaUri={p.postmediauri || []}
                groupName={p.title}
                authorId={p.author_id}
                initialSaved={true}
                onToggleSave={handleToggleSave}
              />
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12
  },
  backBtn: { padding: 2 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    color: "#111",
    fontFamily: "PoppinsBold",
  },

  container: { flex: 1 },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
