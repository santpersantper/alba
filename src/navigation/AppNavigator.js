// navigation/AppNavigator.js — auth-gated root (FIXED)
import React, { useEffect, useState } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View, ActivityIndicator } from "react-native";
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

function ThemedNavigation({ signedIn, needsProfileSetup, pendingGoogleUser, onProfileComplete }) {
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
      <NavigationContainer theme={navTheme} key={navKey}>
        {signedIn ? <MainNavigator /> : <AuthNavigator />}
      </NavigationContainer>

      {/* Profile completion screen for new Google sign-in users */}
      <ProfileSetupModal
        visible={!!(signedIn && needsProfileSetup)}
        user={pendingGoogleUser}
        onComplete={onProfileComplete}
      />
    </>
  );
}

export default function AppNavigator() {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState(null);

  const stripeKey =
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    Constants?.expoConfig?.extra?.expoPublic?.STRIPE_PUBLISHABLE_KEY ??
    "";

  useEffect(() => {
    let sub;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.warn("getSession error", error);

      setSignedIn(!!data?.session);
      setReady(true);

      const { data: listener } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (session?.user) {
            // Only show profile setup for Google OAuth users who have no profile yet
            const isGoogleUser =
              session.user.app_metadata?.provider === "google" ||
              (session.user.app_metadata?.providers ?? []).includes("google");

            if (isGoogleUser) {
              try {
                const { data: profile } = await supabase
                  .from("profiles")
                  .select("id")
                  .eq("id", session.user.id)
                  .maybeSingle();

                if (!profile) {
                  setPendingGoogleUser({
                    id: session.user.id,
                    name:
                      session.user.user_metadata?.full_name ||
                      session.user.user_metadata?.name ||
                      "",
                    email: session.user.email || "",
                  });
                  setNeedsProfileSetup(true);
                } else {
                  setNeedsProfileSetup(false);
                  setPendingGoogleUser(null);
                }
              } catch {
                // On error, let user in without profile setup
                setNeedsProfileSetup(false);
              }
            } else {
              setNeedsProfileSetup(false);
              setPendingGoogleUser(null);
            }
          } else {
            setNeedsProfileSetup(false);
            setPendingGoogleUser(null);
          }

          setSignedIn(!!session);
        }
      );

      sub = listener?.subscription;
    })();

    return () => sub?.unsubscribe?.();
  }, []);

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
    });
    return unsub;
  }, [signedIn]);

  const handleProfileComplete = () => {
    setNeedsProfileSetup(false);
    setPendingGoogleUser(null);
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
            <ThemedNavigation
              signedIn={signedIn}
              needsProfileSetup={needsProfileSetup}
              pendingGoogleUser={pendingGoogleUser}
              onProfileComplete={handleProfileComplete}
            />
          )}
        </ThemeProvider>
      </LanguageProvider>
    </StripeProvider>
  );
}
