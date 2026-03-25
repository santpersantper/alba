// components/chat/InviteMessage.js — DROP-IN
// Change: tapping "Join" now ALSO:
// - adds you to groups.members (rpc + fallback)
// - tries to add you to events.unconfirmed for the event tied to this group:
//    * first tries events.group_id = groupId (if that column exists)
//    * if that fails (schema doesn’t have group_id), it just joins the group
// Also keeps your original navigation to GroupChat.

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../../lib/supabase";
import ShareMenu from "../ShareMenu";
import { useAlbaTheme } from "../../theme/ThemeContext";

// tiny in-memory cache to avoid re-fetching the same group repeatedly
const GROUP_CACHE = new Map(); // groupId -> { id, name, pic, members, memberLine }

const prefetchUri = (uri) => {
  if (!uri) return;
  try {
    ExpoImage.prefetch?.(uri);
  } catch {}
};

const uniqCI = (arr) => {
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s = String(v || "").trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
};

export default function InviteMessage({
  id,
  isMe,
  time,
  groupId,
  groupPreview = null,
  onDeleted,
}) {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

  const preview = useMemo(() => {
    if (!groupId && !groupPreview) return null;
    const g = groupPreview || GROUP_CACHE.get(groupId) || {};
    return {
      id: g.id ?? groupId,
      name: g.name || g.groupname || "Group",
      pic: g.pic || g.group_pic_link || null,
      members: Array.isArray(g.members) ? g.members : [],
      memberLine: typeof g.memberLine === "string" ? g.memberLine : "",
    };
  }, [groupPreview, groupId]);

  const [groupName, setGroupName] = useState(preview?.name || "Group");
  const [groupAvatarUri, setGroupAvatarUri] = useState(preview?.pic || null);
  const [memberLine, setMemberLine] = useState(
    preview?.memberLine ||
      (preview?.members?.length ? preview.members.join(", ") : "")
  );

  const [menuVisible, setMenuVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [approvalModalVisible, setApprovalModalVisible] = useState(false);

  useEffect(() => {
    if (!preview) return;
    setGroupName(preview.name || "Group");
    setGroupAvatarUri(preview.pic || null);
    if (preview.memberLine) setMemberLine(preview.memberLine);
  }, [preview]);

  useEffect(() => {
    if (groupAvatarUri) prefetchUri(groupAvatarUri);
  }, [groupAvatarUri]);

  useEffect(() => {
    let active = true;
    if (!groupId) return;

    const cached = GROUP_CACHE.get(groupId);
    const hasPreview = !!groupPreview || !!cached;
    if (hasPreview) return;

    (async () => {
      try {
        const { data: group } = await supabase
          .from("groups")
          .select("id, groupname, group_pic_link, members")
          .eq("id", groupId)
          .maybeSingle();

        if (!active || !group) return;

        const name = group.groupname || "Group";
        const pic = group.group_pic_link || null;
        const usernames = Array.isArray(group.members) ? group.members : [];

        setGroupName(name);
        setGroupAvatarUri(pic);
        if (pic) prefetchUri(pic);

        if (!usernames.length) {
          setMemberLine("");
          GROUP_CACHE.set(groupId, {
            id: groupId,
            name,
            pic,
            members: [],
            memberLine: "",
          });
          return;
        }

        const { data: profs } = await supabase
          .from("profiles")
          .select("username, name")
          .in("username", usernames);

        if (!active || !profs) return;

        const names = profs.map((p) => p.name || p.username).filter(Boolean);
        const line = names.join(", ");

        setMemberLine(line);
        GROUP_CACHE.set(groupId, {
          id: groupId,
          name,
          pic,
          members: usernames,
          memberLine: line,
        });
      } catch (e) {
        console.warn("[InviteMessage] fetch error", e);
      }
    })();

    return () => {
      active = false;
    };
  }, [groupId, groupPreview]);

  const runDelete = async () => {
    if (!id) { setConfirmVisible(false); return; }
    try {
      setDeleting(true);
      const { error } = await supabase.rpc("delete_chat_message", { p_message_id: id });
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch {
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  const persistJoin = async () => {
    if (!groupId) return;

    // auth + verified gate (same behavior as Post)
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error("Not authenticated");

    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("username, is_verified")
      .eq("id", uid)
      .maybeSingle();
    if (pErr) throw pErr;

    if (!prof?.is_verified) {
      navigation.navigate("PreFaceRecognition");
      return;
    }

    const myUsername = prof?.username;
    if (!myUsername) throw new Error("Missing username");

    // groups.members (rpc + fallback)
    const { data: gRow, error: gErr } = await supabase
      .from("groups")
      .select("id, members, require_approval, pending_members")
      .eq("id", groupId)
      .maybeSingle();
    if (gErr || !gRow?.id) throw gErr || new Error("Group not found");

    const alreadyMember = (Array.isArray(gRow.members) ? gRow.members : [])
      .some((m) => String(m).toLowerCase() === String(myUsername).toLowerCase());

    // If group requires approval and user is not already a member, add to pending
    if (gRow.require_approval && !alreadyMember) {
      const currentPending = Array.isArray(gRow.pending_members) ? gRow.pending_members : [];
      const alreadyPending = currentPending.some(
        (m) => String(m).toLowerCase() === String(myUsername).toLowerCase()
      );
      if (!alreadyPending) {
        const { error: pendingErr } = await supabase.rpc("request_to_join_group", {
          p_group_id: groupId,
          p_username: myUsername,
        });
        if (pendingErr) {
          console.warn("[InviteMessage] request_to_join_group error:", pendingErr.message, pendingErr.code);
        } else {
          console.log("[InviteMessage] join request sent for:", myUsername, "→ group:", groupId);
        }
      } else {
        console.log("[InviteMessage] already pending:", myUsername);
      }
      return { requiresApproval: true };
    }

    const { error: addErr } = await supabase.rpc("add_member_to_group", {
      gid: groupId,
      uname: myUsername,
    });

    if (addErr) {
      const current = Array.isArray(gRow.members) ? gRow.members : [];
      const next = uniqCI([...current, myUsername]);
      const { error: upErr } = await supabase
        .from("groups")
        .update({ members: next })
        .eq("id", groupId);
      if (upErr) throw upErr;
    }

    // events.unconfirmed: try by group_id (if column exists)
    try {
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id, unconfirmed")
        .eq("group_id", groupId)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!evErr && ev?.id) {
        const cur = Array.isArray(ev.unconfirmed) ? ev.unconfirmed : [];
        const next = uniqCI([...cur, myUsername]);
        const { error: upU } = await supabase
          .from("events")
          .update({ unconfirmed: next })
          .eq("id", ev.id);
        if (upU) throw upU;
      }
    } catch (e) {
      // if schema doesn't have group_id or other issues, ignore (still joined group)
      console.warn("[InviteMessage join] events.unconfirmed update skipped:", e?.message || e);
    }
  };

  const handleJoin = async () => {
    if (!groupId) return;

    // Fresh verification check before joining
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id;
    if (uid) {
      const { data: verCheck } = await supabase
        .from("profiles")
        .select("is_verified")
        .eq("id", uid)
        .maybeSingle();
      if (!verCheck?.is_verified) {
        navigation.navigate("PreFaceRecognition");
        return;
      }
    }

    try {
      const result = await persistJoin();
      if (result?.requiresApproval) {
        setApprovalModalVisible(true);
        return;
      }
    } catch (e) {
      console.warn("[InviteMessage] join error:", e);
      // don’t block navigation; still allow opening chat
    }

    navigation.navigate("GroupChat", {
      groupId,
      groupName,
      fromInvite: true,
    });
  };

  const alignStyle = isMe ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" };

  const cardBg = theme.gray;
  const cardBorderWidth = StyleSheet.hairlineWidth;
  const cardBorderColor = isDark ? "#2D3748" : "#D9E6FF";

  return (
    <>
      <View style={[styles.row, alignStyle]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleJoin}
          onLongPress={() => setMenuVisible(true)}
          delayLongPress={400}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderWidth: cardBorderWidth,
                borderColor: cardBorderColor,
              },
            ]}
          >
            <View style={styles.innerRow}>
              {groupAvatarUri ? (
                <ExpoImage
                  source={{ uri: groupAvatarUri }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="disk"
                  transition={0}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]} />
              )}

              <View style={styles.textCol}>
                <Text style={[styles.title, { color: isDark ? "#FFFFFF" : "#000000" }]} numberOfLines={1}>
                  {groupName}
                </Text>

                {!!memberLine && (
                  <Text
                    style={[styles.members, { color: isDark ? "#FFFFFF" : "#000000" }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {memberLine}
                  </Text>
                )}

                <View style={styles.metaRow}>
                  <TouchableOpacity style={styles.joinBtn} activeOpacity={0.8} onPress={handleJoin}>
                    <Text style={styles.joinText}>Join</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {!!time && (
          <Text style={[styles.timeText, { color: isDark ? "#9CA3AF" : "#9CA3AF" }]}>
            {time}
          </Text>
        )}
      </View>

      {/* menus / modals unchanged (trimmed) */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuVisible(false)} />
        <View style={[styles.menuCard, { backgroundColor: isDark ? "#0F1720" : "#FFFFFF" }]}>
          {isMe && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuVisible(false); setShareVisible(true); }}
            >
              <Text style={[styles.menuText, { color: isDark ? "#E5E7EB" : "#111827" }]}>Forward</Text>
            </TouchableOpacity>
          )}

          {isMe && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuVisible(false); setConfirmVisible(true); }}
            >
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>Delete</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.menuItem, { marginTop: 4 }]} onPress={() => setMenuVisible(false)}>
            <Text style={[styles.menuText, { color: "#6B7280" }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={approvalModalVisible} transparent animationType="fade" onRequestClose={() => setApprovalModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Joining this group requires admin approval</Text>
            <Text style={[styles.confirmTitle, { fontSize: 13, fontWeight: "400", marginTop: 4, marginBottom: 8 }]}>
              Your request has been sent. You'll be able to join once an admin approves it.
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF" }]}
                onPress={() => setApprovalModalVisible(false)}
              >
                <Text style={styles.confirmBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Are you sure you want to delete this message?</Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Yes</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={styles.confirmBtnText}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        inviteGroup={
          groupId
            ? {
                id: groupId,
                groupname: groupName,
                group_pic_link: groupAvatarUri,
              }
            : null
        }
        onSent={() => setShareVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { maxWidth: "80%", marginTop: 2, marginBottom: 6 },
  card: { borderRadius: 16, padding: 15, minWidth: 260 },
  innerRow: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 999,
    marginRight: 10,
    backgroundColor: "#E5ECF4",
  },
  avatarFallback: { backgroundColor: "#E5ECF4" },
  textCol: { flex: 1 },
  title: { fontFamily: "PoppinsBold", fontSize: 16, marginBottom: 2 },
  members: { fontFamily: "Poppins", fontSize: 11, marginBottom: 4, opacity: 0.9 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  joinBtn: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 5, backgroundColor: "#4EBCFF" },
  joinText: { fontFamily: "Poppins", fontSize: 12, color: "#FFFFFF" },
  timeText: { marginTop: 2, fontSize: 11, alignSelf: "flex-end", fontFamily: "Poppins" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  confirmCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  confirmTitle: { fontFamily: "Poppins", fontSize: 16, textAlign: "center", marginBottom: 14 },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },

  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  menuCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },
});
