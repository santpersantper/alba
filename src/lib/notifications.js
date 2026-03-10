/**
 * notifications.js
 *
 * Push notification helpers for Alba.
 *
 * IMPORTANT — native rebuild required:
 *   expo-notifications and expo-device need native code compiled into the app.
 *   After running `npx expo run:android` / `npx expo run:ios`, uncomment the
 *   NATIVE BLOCK below and remove the STUB BLOCK.
 */

import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// STUB BLOCK — active until the dev client is rebuilt with expo-notifications
// ─────────────────────────────────────────────────────────────────────────────

export async function registerForPushNotifications() {
  return null;
}

export function addNotificationTapListener(_handler) {
  return () => {};
}

export async function savePushToken(_token) {
  // no-op until native module is available
}

// ─────────────────────────────────────────────────────────────────────────────
// NATIVE BLOCK — uncomment once dev client has been rebuilt
// ─────────────────────────────────────────────────────────────────────────────
/*
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;
  if (Constants.appOwnership === "expo") return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Alba",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#00A9FF",
      });
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      "e60b55c9-7893-4d92-a121-0f23c058f513";
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return result.data ?? null;
  } catch (e) {
    console.warn("[Push] registerForPushNotifications failed:", e?.message);
    return null;
  }
}

export function addNotificationTapListener(handler) {
  try {
    const sub = Notifications.addNotificationResponseReceivedListener(handler);
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

export async function savePushToken(token) {
  if (!token) return;
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return;
    await supabase.from("profiles").update({ push_token: token }).eq("id", auth.user.id);
  } catch (e) {
    console.warn("[Push] savePushToken failed:", e?.message);
  }
}
*/

// ─────────────────────────────────────────────────────────────────────────────
// Notification preferences — always active (no native module needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist notification preferences to the profiles table.
 * prefs shape: { notifChatMessages, notifGroupMessages, notifDiffusion, notifFollowedPosts }
 */
export async function saveNotifPrefs(prefs) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return;
    const notif_prefs = {
      chat:           prefs.notifChatMessages  ?? true,
      groups:         prefs.notifGroupMessages ?? true,
      diffusion:      prefs.notifDiffusion     ?? true,
      followed_posts: prefs.notifFollowedPosts ?? true,
    };
    await supabase
      .from("profiles")
      .update({ notif_prefs })
      .eq("id", auth.user.id);
  } catch (e) {
    console.warn("[Push] saveNotifPrefs failed:", e?.message);
  }
}
