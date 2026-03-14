// components/DMUsersModal.js — DROP-IN
// Adapted from ShareMenu send logic so it can send:
//  1) InviteMessage (row with group_id set)  ✅ this is what your InviteMessage renderer expects
//  2) The optional text note right after it  ✅ joins it like ShareMenu
//
// NEW props (all optional, backwards compatible):
// - inviteGroup: { id } (or full group obj) -> when present, sends InviteMessage row first
// - postId: string|null -> attached to the text row (same as ShareMenu behavior)
// - allowEmpty: boolean -> when true, allow sending invite even if message empty
//
// IMPORTANT: This modal sends to many users => it inserts 1 or 2 rows PER recipient.
// That matches how you DM in your schema (messages.chat = recipient profile id).

import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";

export default function DMUsersModal({
  visible,
  onClose,
  users = [], // [{ username, name, avatar_url, id? }]
  defaultMessage = "",
  title = "",

  // ✅ NEW (optional)
  inviteGroup = null, // { id } -> sends InviteMessage row
  postId = null, // attaches to text row (like ShareMenu)
  allowEmpty = false, // allow invite with no text
}) {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const { theme, isDark } = useAlbaTheme();

  const [meId, setMeId] = useState(null);
  const [meUsername, setMeUsername] = useState(null);
  const [message, setMessage] = useState(defaultMessage || "");
  const [sending, setSending] = useState(false);

  const namesLine = useMemo(() => {
    const names = (users || [])
      .map((u) => u?.name || u?.username || "")
      .filter(Boolean);
    return names.join(", ");
  }, [users]);

  useEffect(() => {
    if (!visible) return;
    setMessage(defaultMessage || "");
  }, [visible, defaultMessage]);

  useEffect(() => {
    let alive = true;
    if (!visible) return;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user?.id) return;
        const uid = data.user.id;
        if (!alive) return;
        setMeId(uid);

        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", uid)
          .maybeSingle();

        if (alive) setMeUsername(prof?.username || null);
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, [visible]);

  const handleSend = async () => {
    if (sending) return;

    const typed = (message || "").trim();
    const fallback = (defaultMessage || "").trim();
    const finalText = typed || fallback;

    const hasInvite = !!inviteGroup?.id;
    const hasPost = postId != null;

    // Same rule as ShareMenu:
    // - if invite exists, can send even with empty text (if allowEmpty or defaultMessage)
    // - otherwise need either text or post
    if (!hasInvite && !hasPost && !finalText) return;
    if (hasInvite && !finalText && !allowEmpty) {
      // allowEmpty=false: still allow invite-only if you pass allowEmpty=true
      // (keeps old modal behavior sane)
      // If you want invite-only always, pass allowEmpty
      return;
    }

    try {
      setSending(true);

      const { data: auth, error: aErr } = await supabase.auth.getUser();
      const owner_id = auth?.user?.id;
      if (aErr || !owner_id) return;

      const usernames = (users || []).map((u) => u?.username).filter(Boolean);
      if (!usernames.length) return;

      const { data: recips, error } = await supabase
        .from("profiles")
        .select("id, username")
        .in("username", usernames);

      if (error) throw error;

      const now = new Date();
      const sent_date = now.toISOString().slice(0, 10);
      const sent_time = now.toTimeString().slice(0, 8);

      const rows = [];

      for (const p of recips || []) {
        const base = {
          chat: p.id,
          is_group: false,
          owner_id,
          sender_username: meUsername || "me",
          sender_is_me: true,
          is_read: true,
          sent_date,
          sent_time,
        };

        // 1) InviteMessage row (this is what your InviteMessage uses: group_id set, content empty)
        if (hasInvite) {
          rows.push({
            ...base,
            content: "",
            media_reference: null,
            post_reference: null,
            post_id: null,
            group_id: inviteGroup.id,
          });
        }

        // 2) Text note row (like ShareMenu)
        if (finalText) {
          rows.push({
            ...base,
            content: finalText,
            media_reference: null,
            post_reference: null,
            post_id: hasPost ? postId : null,
            group_id: null,
          });
        } else if (hasPost && !hasInvite) {
          // share post with empty text (ShareMenu behavior)
          rows.push({
            ...base,
            content: "",
            media_reference: null,
            post_reference: null,
            post_id: postId,
            group_id: null,
          });
        }
      }

      if (!rows.length) return;

      const { error: insErr } = await supabase.from("messages").insert(rows);
      if (insErr) throw insErr;

      setMessage("");
      onClose?.();
    } catch (e) {
      // keep silent
    } finally {
      setSending(false);
    }
  };

  if (!fontsLoaded) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardWrap}
      >
        <View style={[styles.card, { backgroundColor: theme.gray }]}>
          <Text style={[styles.title, { color: theme.text, marginBottom: 6 }]} numberOfLines={1}>
            {title || "Message"}
          </Text>

          <Text
            style={[styles.recipients, { color: isDark ? "#9CA3AF" : "#6B7280" }]}
            numberOfLines={2}
          >
            {namesLine}
          </Text>

          <View style={[styles.msgBox, { backgroundColor: isDark ? "#1F2933" : "#F4F6F9" }]}>
            <TextInput
              style={[styles.msgInput, { color: theme.text }]}
              placeholder="Message"
              placeholderTextColor={isDark ? "#6B7280" : "#B8B8B8"}
              value={message}
              onChangeText={setMessage}
              multiline
            />
          </View>

          <View style={styles.bottomRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.sendBtn]}
              onPress={handleSend}
              disabled={sending || (!allowEmpty && !((message || "").trim()) && !inviteGroup?.id && !postId)}
              activeOpacity={0.9}
            >
              {sending ? (
                <ActivityIndicator />
              ) : (
                <Text style={[styles.actionText, { color: "#fff" }]}>Send</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={onClose}
              activeOpacity={0.9}
            >
              <Text style={[styles.actionText, { color: isDark ? "#9CA3AF" : "#8A96A3" }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.32)" },
  card: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "55%" },
  title: { fontFamily: "PoppinsBold", fontSize: 16 },
  recipients: { fontFamily: "Poppins", fontSize: 13 },
  msgBox: { marginTop: 12, borderRadius: 10, paddingHorizontal: 12, justifyContent: "center" },
  msgInput: { fontSize: 14, fontFamily: "Poppins", paddingTop: 10, paddingBottom: 10 },
  bottomRow: { flexDirection: "row", justifyContent: "center", gap: 12, paddingTop: 16 },
  actionBtn: {
    height: 42,
    minWidth: 110,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  sendBtn: { backgroundColor: "#4EBCFF", borderColor: "#4EBCFF", marginBottom: 20 },
  cancelBtn: { backgroundColor: "#fff", borderColor: "#E3E8EE", marginBottom: 20 },
  actionText: { fontFamily: "PoppinsBold" },
});
