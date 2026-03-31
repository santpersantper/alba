// navigation/AppNavigator.js — auth-gated root (FIXED)
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View, ActivityIndicator, AppState, Modal, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { LanguageProvider } from "../theme/LanguageContext";
import AuthNavigator from "./AuthNavigator";
import MainTabs from "./MainTabs";
import { ThemeProvider, useAlbaTheme } from "../theme/ThemeContext";
import { StripeProvider } from "@stripe/stripe-react-native";
import Constants from "expo-constants";
import ProfileSetupModal from "../components/ProfileSetupModal";

// detail screens
import CommunityScreen from "../screens/CommunityScreen";
import FeedScreen from "../screens/FeedScreen";
import GroupChatScreen from "../screens/GroupChatScreen";
import ChatListScreen from "../screens/ChatListScreen";
import ProfileScreen from "../screens/ProfileScreen";
import CreatePostScreen from "../screens/CreatePostScreen";
import SingleChatScreen from "../screens/SingleChatScreen";
import CommunitySettingsScreen from "../screens/CommunitySettingsScreen";
import FeedSettingsScreen from "../screens/FeedSettingsScreen";
import SavedPostsScreen from "../screens/SavedPostsScreen";
import UseTimeScreen from "../screens/UseTimeScreen";
import PreFaceRecognitionScreen from "../screens/PreFaceRecognitionScreen";
import FaceRecognitionScreen from "../screens/FaceRecognitionScreen";
import GroupInfoScreen from "../screens/GroupInfoScreen";
import SinglePostScreen from "../screens/SinglePostScreen";
import EventSettingsScreen from "../screens/EventSettingsScreen";
import PastEventsScreen from "../screens/PastEventsScreen";
import MyTicketsScreen from "../screens/MyTicketsScreen";
import AdPublisherScreen from "../screens/AdPublisherScreen";
import SavedVideosScreen from "../screens/SavedVideosScreen";
import SingleFeedVideoScreen from "../screens/SingleFeedVideoScreen";
import { registerForPushNotifications, savePushToken, addNotificationTapListener } from "../lib/notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { posthog } from "../lib/analytics";

const Stack = createNativeStackNavigator();

function MainNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="Community" component={CommunityScreen} />
      <Stack.Screen name="GroupChat" component={GroupChatScreen} />
      <Stack.Screen name="ChatList" component={ChatListScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="SingleChat" component={SingleChatScreen} />
      <Stack.Screen name="CreatePost" component={CreatePostScreen} />
      <Stack.Screen
        name="CommunitySettings"
        component={CommunitySettingsScreen}
      />
      <Stack.Screen name="SavedPosts" component={SavedPostsScreen} />
      <Stack.Screen name="FeedSettings" component={FeedSettingsScreen} />
      <Stack.Screen
        name="UseTime"
        component={UseTimeScreen}
        options={{ animation: "slide_from_left", gestureEnabled: false }}
      />
      <Stack.Screen
        name="PreFaceRecognition"
        component={PreFaceRecognitionScreen}
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="FaceRecognition" component={FaceRecognitionScreen} />
      <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
      <Stack.Screen name="SinglePost" component={SinglePostScreen} />
      <Stack.Screen name="EventSettings" component={EventSettingsScreen} />
      <Stack.Screen name="PastEvents" component={PastEventsScreen} />
      <Stack.Screen
        name="MyTickets"
        component={MyTicketsScreen}
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen name="AdPublisher" component={AdPublisherScreen} />
      <Stack.Screen name="SavedVideos" component={SavedVideosScreen} />
      <Stack.Screen name="SingleFeedVideo" component={SingleFeedVideoScreen} />
      <Stack.Screen name="Feed" component={FeedScreen} />
    </Stack.Navigator>
  );
}

function BanModal({ banState, onRecheck, onGotIt }) {
  const { isDark } = useAlbaTheme();

  if (!banState) return null;

  const bg  = isDark ? "#1A1F27" : "#FFFFFF";
  const fg  = isDark ? "#FFFFFF" : "#111111";
  const sub = isDark ? "#A0A7B3" : "#555555";

  let title, body;
  if (banState.type === "terminated") {
    title = "Account Terminated";
    body  = "Your account has been permanently terminated for a violation of our Terms of Service.";
  } else {
    const remaining = Math.max(0, new Date(banState.bannedUntil) - Date.now());
    const hours     = Math.ceil(remaining / (1000 * 60 * 60));
    const days      = Math.ceil(remaining / (1000 * 60 * 60 * 24));
    const duration  = hours <= 48 ? `${hours} hour${hours !== 1 ? "s" : ""}` : `${days} day${days !== 1 ? "s" : ""}`;
    title = "Account Suspended";
    body  = `Your account has been suspended for ${duration} for a violation of our Terms of Service.`;
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={banStyles.overlay}>
        <View style={[banStyles.card, { backgroundColor: bg }]}>
          <Text style={[banStyles.icon]}>🚫</Text>
          <Text style={[banStyles.title, { color: fg }]}>{title}</Text>
          <Text style={[banStyles.body, { color: sub }]}>{body}</Text>
          {banState.reason ? (
            <Text style={[banStyles.reason, { color: sub }]}>Reason: {banState.reason}</Text>
          ) : null}
          <TouchableOpacity
            style={banStyles.tosBtn}
            onPress={() => Linking.openURL("https://albaappofficial.com/terms").catch(() => {})}
          >
            <Text style={banStyles.tosBtnText}>Read our Terms of Service</Text>
          </TouchableOpacity>
          {banState.type === "terminated" && onGotIt && (
            <TouchableOpacity style={[banStyles.recheckBtn, { marginTop: 8 }]} onPress={onGotIt}>
              <Text style={[banStyles.recheckText, { color: sub }]}>Got it — sign me out</Text>
            </TouchableOpacity>
          )}
          {banState.type === "temp" && (
            <TouchableOpacity style={banStyles.recheckBtn} onPress={onRecheck}>
              <Text style={[banStyles.recheckText, { color: sub }]}>Check again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const banStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 28 },
  card: { borderRadius: 20, padding: 28, alignItems: "center", width: "100%", maxWidth: 360 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontFamily: "PoppinsBold", fontSize: 22, marginBottom: 10, textAlign: "center" },
  body: { fontFamily: "Poppins", fontSize: 14, lineHeight: 22, textAlign: "center", marginBottom: 12 },
  reason: { fontFamily: "Poppins", fontSize: 12, fontStyle: "italic", textAlign: "center", marginBottom: 16, opacity: 0.75 },
  tosBtn: { backgroundColor: "#3D8BFF", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28, marginTop: 4 },
  tosBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 14 },
  recheckBtn: { marginTop: 16, paddingVertical: 6 },
  recheckText: { fontFamily: "Poppins", fontSize: 13, textDecorationLine: "underline" },
});

function ThemedNavigation({ signedIn, needsProfileSetup, pendingGoogleUser, onProfileComplete, navRef, banState, onBanRecheck, onTerminationAck }) {
  const { isDark } = useAlbaTheme();

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: "#000000",
          card: "#000000",
          border: "#111111",
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: "#FFFFFF",
          card: "#FFFFFF",
          border: "#E0E0E0",
        },
      };

  // ✅ KEY REMOUNT: this fully resets navigation state when auth flips
  const navKey = signedIn ? "nav-signed-in" : "nav-signed-out";

  return (
    <>
      <NavigationContainer ref={navRef} theme={navTheme} key={navKey}>
        {signedIn ? <MainNavigator /> : <AuthNavigator />}
      </NavigationContainer>

      {/* Profile completion screen for new Google sign-in users */}
      <ProfileSetupModal
        visible={!!(signedIn && needsProfileSetup)}
        user={pendingGoogleUser}
        onComplete={onProfileComplete}
      />

      {/* Ban / suspension modal — blocks all interaction while active */}
      <BanModal banState={banState} onRecheck={onBanRecheck} onGotIt={onTerminationAck} />
    </>
  );
}

function JoinPendingModal({ visible, onClose }) {
  const { isDark } = useAlbaTheme();
  const bg = isDark ? "#1A1F27" : "#FFFFFF";
  const fg = isDark ? "#FFFFFF" : "#111111";
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={joinModalStyles.overlay}>
        <View style={[joinModalStyles.card, { backgroundColor: bg }]}>
          <Text style={[joinModalStyles.message, { color: fg }]}>
            Admins will review your request. Once they approve it, you will join the group.
          </Text>
          <TouchableOpacity style={joinModalStyles.okBtn} onPress={onClose}>
            <Text style={joinModalStyles.okText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const joinModalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 28 },
  card: { borderRadius: 18, padding: 22, alignItems: "center", width: "82%" },
  message: { fontFamily: "Poppins", fontSize: 15, textAlign: "center", marginBottom: 20 },
  okBtn: { backgroundColor: "#4EBCFF", paddingVertical: 10, paddingHorizontal: 36, borderRadius: 12 },
  okText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
});

export default function AppNavigator() {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState(null);
  const [banState, setBanState] = useState(null); // null | { type: "temp"|"terminated", bannedUntil?, reason? }
  const [joinPendingModal, setJoinPendingModal] = useState(false);
  const navRef = useRef(null);
  const signedInRef = useRef(false);
  const sessionStartRef = useRef(null);
  const pendingDeepLinkRef = useRef(null);

  const trackLoginStreak = async (userId) => {
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const raw = await AsyncStorage.getItem("alba_login_streak");
      const stored = raw ? JSON.parse(raw) : null;

      let streak = 1;
      if (stored?.lastDate) {
        const last = new Date(stored.lastDate);
        const now = new Date(today);
        const diffDays = Math.round((now - last) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) {
          // Already logged in today — keep existing streak, don't re-identify
          return;
        } else if (diffDays === 1) {
          streak = (stored.streak ?? 1) + 1;
        }
        // diffDays > 1 → streak resets to 1
      }

      await AsyncStorage.setItem("alba_login_streak", JSON.stringify({ lastDate: today, streak }));
      posthog.identify(userId, {
        $set: { login_streak: streak, last_login: today },
        $set_once: { first_login: today },
      });
    } catch (e) {
      console.warn("[AppNav] trackLoginStreak error:", e?.message);
    }
  };

  const checkBanStatus = async (userId) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("banned_until, account_terminated, ban_reason")
        .eq("id", userId)
        .single();
      if (!data) return;
      if (data.account_terminated) {
        setBanState({ type: "terminated", reason: data.ban_reason || null });
        return;
      }
      if (data.banned_until && new Date(data.banned_until) > new Date()) {
        setBanState({ type: "temp", bannedUntil: data.banned_until, reason: data.ban_reason || null });
        return;
      }
      setBanState(null);
    } catch {}
  };

  const stripeKey =
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    Constants?.expoConfig?.extra?.expoPublic?.STRIPE_PUBLISHABLE_KEY ??
    "";

  useEffect(() => {
    let sub;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.warn("getSession error", error);
      console.log('[AppNav] cold-start getSession — hasSession:', !!data?.session);

      setSignedIn(!!data?.session);
      signedInRef.current = !!data?.session;
      setReady(true);

      // Check ban for session that's already active at cold start
      if (data?.session?.user?.id) {
        checkBanStatus(data.session.user.id);
      }

      const { data: listener } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          console.log('[AppNav] onAuthStateChange event:', event, 'userId:', session?.user?.id ?? null);

          // TOKEN_REFRESHED / USER_UPDATED don't change sign-in state and must
          // not re-trigger the Google profile-setup check (would race with
          // child screens that are already mounted and fetching data).
          if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            console.log('[AppNav] filtered out event:', event);
            return;
          }

          // Navigate immediately — don't block on the async profile check below.
          // ProfileSetupModal is rendered above the nav tree so it can appear
          // after navigation has already occurred.
          console.log('[AppNav] setSignedIn →', !!session);
          setSignedIn(!!session);
          signedInRef.current = !!session;

          if (session?.user?.id) {
            checkBanStatus(session.user.id);
          } else {
            setBanState(null);
          }

          // Only run Google profile-setup check on actual sign-in events
          if (event === 'SIGNED_IN' && session?.user) {
            trackLoginStreak(session.user.id);
            const isGoogleUser =
              session.user.app_metadata?.provider === "google" ||
              (session.user.app_metadata?.providers ?? []).includes("google");

            console.log('[AppNav] SIGNED_IN — isGoogleUser:', isGoogleUser, 'provider:', session.user.app_metadata?.provider, 'providers:', session.user.app_metadata?.providers);

            if (isGoogleUser) {
              // Defer the DB call out of the onAuthStateChange callback.
              // Supabase JS v2 fires this callback synchronously during setSession,
              // so the auth middleware is still in a transitional state — any DB
              // query made here will hang or run without valid auth headers (RLS
              // returns null), incorrectly triggering the profile-setup modal for
              // existing users.  A small timeout lets the session fully settle first.
              const capturedUser = session.user;
              setTimeout(async () => {
                try {
                  const { data: profile } = await supabase
                    .from("profiles")
                    .select("id")
                    .eq("id", capturedUser.id)
                    .maybeSingle();

                  console.log('[AppNav] Google profile check — hasProfile:', !!profile);

                  if (!profile) {
                    setPendingGoogleUser({
                      id: capturedUser.id,
                      name:
                        capturedUser.user_metadata?.full_name ||
                        capturedUser.user_metadata?.name ||
                        "",
                      email: capturedUser.email || "",
                    });
                    setNeedsProfileSetup(true);
                    console.log('[AppNav] needsProfileSetup → true (new Google user)');
                  } else {
                    setNeedsProfileSetup(false);
                    setPendingGoogleUser(null);
                    console.log('[AppNav] needsProfileSetup → false (existing Google user)');
                  }
                } catch (e) {
                  // On error, let user in without profile setup
                  console.warn('[AppNav] Google profile check error:', e?.message);
                  setNeedsProfileSetup(false);
                }
              }, 500);
            } else {
              setNeedsProfileSetup(false);
              setPendingGoogleUser(null);
            }
          } else if (!session) {
            setNeedsProfileSetup(false);
            setPendingGoogleUser(null);
          }
        }
      );

      sub = listener?.subscription;
    })();

    return () => sub?.unsubscribe?.();
  }, []);

  // Real-time ban detection — fires immediately while the app is open
  useEffect(() => {
    if (!signedIn) return;
    let channel;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: null }));
      const userId = data?.user?.id;
      if (!userId) return;
      channel = supabase
        .channel(`profile-ban-${userId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        }, (payload) => {
          const row = payload.new;
          if (row.account_terminated) {
            setBanState({ type: 'terminated', reason: row.ban_reason || null });
          } else if (row.banned_until && new Date(row.banned_until) > new Date()) {
            setBanState({ type: 'temp', bannedUntil: row.banned_until, reason: row.ban_reason || null });
          } else {
            setBanState(null);
          }
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [signedIn]);

  // Clear expo-image in-memory LRU cache when app returns to foreground.
  // Decoded bitmaps (up to ~4MB each) accumulate in the LRU and can fill the heap.
  // Re-decoding on re-display costs a little CPU but prevents OOM.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === "active") {
        ExpoImage.clearMemoryCache?.().catch(() => {});
        // Re-check ban status on foreground so active bans take effect immediately
        if (signedInRef.current) {
          const { data } = await supabase.auth.getUser().catch(() => ({ data: null }));
          if (data?.user?.id) checkBanStatus(data.user.id);
        }
        // Start session timer when app comes to foreground
        sessionStartRef.current = Date.now();
      } else if (next.match(/inactive|background/) && !appStateRef.current.match(/inactive|background/)) {
        // App going to background — fire session_ended with duration
        if (sessionStartRef.current) {
          const duration_seconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
          if (duration_seconds > 0) {
            posthog.capture('session_ended', { duration_seconds });
          }
          sessionStartRef.current = null;
        }
      }
      appStateRef.current = next;
    });
    // Start timing the initial session when the component mounts
    sessionStartRef.current = Date.now();
    return () => sub.remove();
  }, []);

  // Deep link handler
  const handleDeepLink = useCallback(async (url, attempt = 0) => {
    if (!url) return;

    let path = "";
    try {
      const parsed = new URL(url);
      path = parsed.pathname;
    } catch {
      path = url.replace(/^alba:\/\//, "/").split("?")[0];
    }

    const nav = navRef.current;
    if (!nav?.isReady()) {
      if (attempt < 15) {
        setTimeout(() => handleDeepLink(url, attempt + 1), 300);
      }
      return;
    }

    if (path.startsWith("/join/group/")) {
      const groupId = path.replace("/join/group/", "").replace(/\/$/, "").trim();
      if (!groupId) return;
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", authData.user.id)
          .maybeSingle();
        const username = profile?.username;
        if (!username) return;
        const { data: group } = await supabase
          .from("groups")
          .select("id, groupname, members, pending_members, require_approval")
          .eq("id", groupId)
          .maybeSingle();
        if (!group) return;
        const currentMembers = Array.isArray(group.members) ? group.members : [];
        const currentPending = Array.isArray(group.pending_members) ? group.pending_members : [];
        if (!group.require_approval) {
          if (!currentMembers.includes(username)) {
            await supabase
              .from("groups")
              .update({ members: [...currentMembers, username] })
              .eq("id", groupId);
          }
          nav.navigate("Community");
        } else {
          if (!currentPending.includes(username) && !currentMembers.includes(username)) {
            await supabase
              .from("groups")
              .update({ pending_members: [...currentPending, username] })
              .eq("id", groupId);
          }
          nav.navigate("Community");
          setJoinPendingModal(true);
        }
      } catch (e) {
        console.warn("[DeepLink] join group error:", e?.message);
      }
    } else if (path.startsWith("/post/")) {
      const postId = path.replace("/post/", "").replace(/\/$/, "").trim();
      if (postId) nav.navigate("SinglePost", { postId });
    } else if (path.startsWith("/video/")) {
      const postId = path.replace("/video/", "").replace(/\/$/, "").trim();
      if (postId) nav.navigate("SingleFeedVideo", { postId });
    }
  }, []);

  useEffect(() => {
    Linking.getInitialURL()
      .then((url) => { if (url) handleDeepLink(url); })
      .catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => handleDeepLink(url));
    return () => sub.remove();
  }, [handleDeepLink]);

  // Register push token when user signs in
  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      const token = await registerForPushNotifications();
      if (token) await savePushToken(token);
    })();

    // Handle notification taps — navigate to relevant screen
    const unsub = addNotificationTapListener((response) => {
      const data = response.notification.request.content.data;
      console.log("[Push] notification tapped:", data);
      const nav = navRef.current;
      if (!nav?.isReady()) return;
      if (data?.type === "dm" && data.sender_username) {
        nav.navigate("SingleChat", { username: data.sender_username });
      } else if (data?.type === "group_message" && data.chat) {
        nav.navigate("GroupChat", { groupId: data.chat });
      } else if (data?.type === "follow" && data.username) {
        nav.navigate("Profile", { username: data.username });
      }
    });
    return unsub;
  }, [signedIn]);

  const handleProfileComplete = () => {
    setNeedsProfileSetup(false);
    setPendingGoogleUser(null);
  };

  const handleBanRecheck = async () => {
    const { data } = await supabase.auth.getUser().catch(() => ({ data: null }));
    if (data?.user?.id) checkBanStatus(data.user.id);
  };

  const handleTerminationAck = async () => {
    await supabase.auth.signOut().catch(() => {});
    setBanState(null);
    setSignedIn(false);
    signedInRef.current = false;
  };

  return (
    <StripeProvider
      publishableKey={stripeKey}
      merchantIdentifier="merchant.com.alba.app"
      urlScheme="alba"
    >
      <LanguageProvider>
        <ThemeProvider>
          {!ready || !fontsLoaded ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              <ThemedNavigation
                signedIn={signedIn}
                needsProfileSetup={needsProfileSetup}
                pendingGoogleUser={pendingGoogleUser}
                onProfileComplete={handleProfileComplete}
                navRef={navRef}
                banState={banState}
                onBanRecheck={handleBanRecheck}
                onTerminationAck={handleTerminationAck}
              />
              <JoinPendingModal
                visible={joinPendingModal}
                onClose={() => setJoinPendingModal(false)}
              />
            </>
          )}
        </ThemeProvider>
      </LanguageProvider>
    </StripeProvider>
  );
}
