// screens/HiddenPostsScreen.js
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
import { useAlbaLanguage } from "../theme/LanguageContext";
import ThemedView from "../theme/ThemedView";

export default function HiddenPostsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [hiddenPosts, setHiddenPosts] = useState([]);

  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const loadHidden = useCallback(async () => {
    try {
      setLoading(true);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes?.user) {
        throw new Error("Not authenticated");
      }

      const userId = userRes.user.id;
      setUid(userId);

      const { data: posts, error: postsErr } = await supabase
        .from("posts")
        .select("*")
        .eq("author_id", userId)
        .eq("hidden", true)
        .order("date", { ascending: false });


      if (postsErr) throw postsErr;

      setHiddenPosts(Array.isArray(posts) ? posts : []);
    } catch (e) {
      Alert.alert("Error", `Couldn't load hidden posts.\n\n${e?.message || String(e)}`);
      setHiddenPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHidden();
    }, [loadHidden])
  );

  // When a post is shown again (hidden = false), remove it from this list
  const handleToggleHidden = useCallback((postId, newHidden) => {
    if (!newHidden) {
      setHiddenPosts((prev) => prev.filter((p) => p.id !== postId));
    }
  }, []);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#FFFFFF" }} />;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.gray }]}>
      {/* Header */}
      <ThemedView variant="gray" style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {t("hidden_posts_title") || "Hidden Posts"}
        </Text>
        <View style={{ width: 24 }} />
      </ThemedView>

      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {loading && !hiddenPosts.length ? (
          <ThemedView variant="gray" style={styles.center}>
            <ActivityIndicator size="large" />
          </ThemedView>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { backgroundColor: theme.gray }]}
            showsVerticalScrollIndicator={false}
          >
            {hiddenPosts.map((p) => (
              <Post
                key={p.id}
                postId={p.id}
                post={p}
                title={p.title}
                description={p.description}
                type={p.type}
                date={p.date}
                time={p.time}
                end_date={p.end_date}
                end_time={p.end_time}
                all_day={p.all_day}
                every_day={p.every_day}
                online={p.online}
                location={p.location}
                user={p.user}
                userPicUri={p.userpicuri || "https://placehold.co/48x48"}
                colors={["#56d1f0", "#00a4e6", "#60affe"]}
                actions={p.actions || []}
                actionIconPaths={[]}
                postMediaUri={p.postmediauri || []}
                authorId={p.author_id}
                isOnHiddenList={true}
                onToggleHidden={handleToggleHidden}
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
    paddingBottom: 12,
  },
  backBtn: { padding: 2 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
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
