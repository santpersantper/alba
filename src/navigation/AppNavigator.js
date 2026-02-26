// navigation/AppNavigator.js — auth-gated root (FIXED)
import React, { useEffect, useState } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { LanguageProvider } from "../theme/LanguageContext";
import AuthNavigator from "./AuthNavigator";
import MainTabs from "./MainTabs";
import { ThemeProvider, useAlbaTheme } from "../theme/ThemeContext";
import { StripeProvider } from "@stripe/stripe-react-native";
import Constants from "expo-constants";

// detail screens
import CommunityScreen from "../screens/CommunityScreen";
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

    </Stack.Navigator>
  );
}

function ThemedNavigation({ signedIn }) {
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
    <NavigationContainer theme={navTheme} key={navKey}>
      {signedIn ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

export default function AppNavigator() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const stripeKey =
    Constants.expoConfig?.extra?.expoPublic?.STRIPE_PUBLISHABLE_KEY ?? "";

  useEffect(() => {
    let sub;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.warn("getSession error", error);

      setSignedIn(!!data?.session);
      setReady(true);

      const { data: listener } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          setSignedIn(!!session);
        }
      );

      sub = listener?.subscription;
    })();

    return () => sub?.unsubscribe?.();
  }, []);

  return (
    <StripeProvider
      publishableKey={stripeKey}
      merchantIdentifier="merchant.com.alba.app"
      urlScheme="alba"
    >
      <LanguageProvider>
        <ThemeProvider>
          {!ready ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator />
            </View>
          ) : (
            <ThemedNavigation signedIn={signedIn} />
          )}
        </ThemeProvider>
      </LanguageProvider>
    </StripeProvider>
  );
}
