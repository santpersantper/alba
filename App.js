import "react-native-get-random-values";

import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SignupScreen from "./screens/SignupScreen";
import { LanguageProvider } from "../theme/LanguageContext";
import { supabase } from "./lib/supabase";


import { preloadChatListData } from "./lib/chatListCache";
import { preloadGroupChatData } from "./lib/groupChatCache";
import { preloadSingleChatData } from "./lib/singleChatCache";
import { preloadProfileData } from "./lib/profileCache";

// ✅ optional: prime Community first-post override read (no location / no network)
import { readCachedFirstPostOverride } from "./lib/communityFirstPostCache";

// ✅ NEW: prime Feed first-video override read (no network)
import { readCachedFirstFeedVideoOverride } from "./lib/feedFirstVideoCache";

const Stack = createNativeStackNavigator();

const DBG = true;
const nowMs = () => global?.performance?.now?.() ?? Date.now();
const log = (...a) => DBG && console.log("[App]", ...a);

export default function App() {
  useEffect(() => {
    let mounted = true;

    const kickOffPreload = async () => {
      const t0 = nowMs();
      log("kickOffPreload START");
      try {
        const tUser0 = nowMs();
        const { data, error } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        log(
          "auth.getUser",
          uid ? "OK" : "NO_UID",
          error?.message || "",
          `(${Math.round(nowMs() - tUser0)}ms)`
        );

        if (!uid || !mounted) return;

        // ✅ touch cached overrides early (instant read)
        readCachedFirstPostOverride().catch((e) =>
          log("readCachedFirstPostOverride ERR", e?.message || e)
        );
        readCachedFirstFeedVideoOverride().catch((e) =>
          log("readCachedFirstFeedVideoOverride ERR", e?.message || e)
        );

        // ✅ warm my profile cache (fire-and-forget)
        log("preloadProfileData fire", { uid });
        preloadProfileData({ userId: uid, isMe: true }).catch((e) =>
          log("preloadProfileData ERR", e?.message || e)
        );

        // 1) Fire-and-forget: chat list cache
        log("preloadChatListData fire", { uid });
        preloadChatListData(uid, { limit: 120 }).catch((e) =>
          log("preloadChatListData ERR", e?.message || e)
        );

        // latest 5 threads
        const tThreads0 = nowMs();
        const { data: threads, error: thErr } = await supabase
          .from("chat_threads")
          .select("chat_id,is_group,group_id")
          .eq("owner_id", uid)
          .order("last_sent_at", { ascending: false, nullsFirst: true })
          .limit(5);

        log(
          "threads",
          thErr ? "ERR" : `OK(${threads?.length || 0})`,
          thErr?.message || "",
          `(${Math.round(nowMs() - tThreads0)}ms)`
        );

        if (thErr || !Array.isArray(threads) || !threads.length) return;

        // 2) warm last 5 GROUP chats
        const groupIds = Array.from(
          new Set(
            threads
              .filter((t) => !!t?.is_group)
              .map((t) => t.group_id || t.chat_id)
              .filter(Boolean)
          )
        );

        if (groupIds.length) {
          const tGroups0 = nowMs();
          const { data: groups, error: gErr } = await supabase
            .from("groups")
            .select("id,members")
            .in("id", groupIds);

          log(
            "groups",
            gErr ? "ERR" : `OK(${groups?.length || 0})`,
            gErr?.message || "",
            `(${Math.round(nowMs() - tGroups0)}ms)`
          );

          if (!gErr && Array.isArray(groups) && groups.length) {
            groups.forEach((g) => {
              log("preloadGroupChatData fire", {
                chatId: g.id,
                members: (g.members || []).length,
              });
              preloadGroupChatData({
                chatId: g.id,
                members: Array.isArray(g.members) ? g.members : [],
                messagesLimit: 80,
              }).catch((e) =>
                log("preloadGroupChatData ERR", e?.message || e)
              );
            });
          }
        }

        // 3) warm last 5 DM chats too
        const dmIds = Array.from(
          new Set(
            threads
              .filter((t) => !t?.is_group)
              .map((t) => t.chat_id)
              .filter(Boolean)
          )
        );

        if (dmIds.length) {
          const tPeers0 = nowMs();
          const { data: peers, error: pErr } = await supabase
            .from("profiles")
            .select("id,username")
            .in("id", dmIds);

          log(
            "peers",
            pErr ? "ERR" : `OK(${peers?.length || 0})`,
            pErr?.message || "",
            `(${Math.round(nowMs() - tPeers0)}ms)`
          );

          (peers || []).forEach((p) => {
            log("preloadSingleChatData fire", {
              chatId: p.id,
              peerUsername: p.username || null,
            });
            preloadSingleChatData({
              chatId: p.id,
              peerUsername: p.username || null,
              messagesLimit: 80,
            }).catch((e) =>
              log("preloadSingleChatData ERR", e?.message || e)
            );
          });
        }
      } catch (e) {
        log("kickOffPreload ERR", e?.message || e);
      } finally {
        log("kickOffPreload END", `(${Math.round(nowMs() - t0)}ms)`);
      }
    };

    kickOffPreload();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <LanguageProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Signup"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Signup" component={SignupScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </LanguageProvider>
  );
}
