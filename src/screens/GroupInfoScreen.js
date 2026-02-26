// screens/GroupInfoScreen.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";

import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { decode as b64decodeStr } from "base-64";

import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { supabase } from "../lib/supabase";
import ShareMenu from "../components/ShareMenu";


/* ---------- helpers: same upload strategy as ProfileScreen ---------- */

function base64ToArrayBuffer(base64) {
  const binary = b64decodeStr(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function uploadGroupImageToAlbaMedia(localUri) {
  let uri = localUri;
  let ext = (localUri.split(".").pop() || "jpg").toLowerCase();
  let mime = "image/jpeg";

  if (ext === "png") mime = "image/png";

  if (ext === "heic" || ext === "heif") {
    const manipulated = await ImageManipulator.manipulateAsync(
      localUri,
      [],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
    );
    uri = manipulated.uri;
    ext = "jpg";
    mime = "image/jpeg";
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: "base64",
  });
  const arrayBuffer = base64ToArrayBuffer(base64);

  const filePath = `avatars/group_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}.${ext}`;

  const { data, error } = await supabase.storage
    .from("alba-media")
    .upload(filePath, arrayBuffer, {
      contentType: mime,
      upsert: true,
    });

  if (error) throw error;

  const { data: publicData } = supabase.storage
    .from("alba-media")
    .getPublicUrl(data.path);

  return publicData.publicUrl;
}

/* --------------------------- main screen --------------------------- */

export default function GroupInfoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  // Clean group name: remove "group:" prefix if present, trim spaces
  const rawGroupName = route.params?.groupName || "";
  const cleanedGroupName = String(rawGroupName).replace(/^group:/i, "").trim();
  const [resolvedGroupName] = useState(cleanedGroupName);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  // group meta
  const [groupId, setGroupId] = useState(null);
  const [groupAvatarUrl, setGroupAvatarUrl] = useState(null);
  const [groupDesc, setGroupDesc] = useState("");
  const [groupAdmins, setGroupAdmins] = useState([]);
  const [membersUsernames, setMembersUsernames] = useState([]);

  // member profiles (for count & basic info)
  const [members, setMembers] = useState([]);
  const [memberCount, setMemberCount] = useState(0);

  // search (now local)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // current user
  const [myUsername, setMyUsername] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // exit/report
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [exiting, setExiting] = useState(false);

  // member menu
  const [memberMenuVisible, setMemberMenuVisible] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  // pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);

  // subgroups
  const [subgroups, setSubgroups] = useState([]);
  const [loadingSubgroups, setLoadingSubgroups] = useState(false);

  // new subgroup editing
  const [editingSubgroupId, setEditingSubgroupId] = useState(null);
  const [newSubgroupName, setNewSubgroupName] = useState("");

  const [shareVisible, setShareVisible] = useState(false);


  /* ---------------- current auth user ---------------- */

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error || !user) return;
        const username =
          user.user_metadata?.username || user.email || user.id;
        setMyUsername(username);
      } catch (e) {
        console.error("auth getUser error", e);
      }
    })();
  }, []);

  /* ---------------- load group from groups table ---------------- */

  const loadGroup = useCallback(async () => {
    if (!resolvedGroupName) return;

    try {
      const { data, error } = await supabase
        .from("groups")
        .select(
          "id, groupname, group_desc, group_pic_link, members, group_admin"
        )
        .eq("groupname", resolvedGroupName)
        .maybeSingle();


      if (error) {
        console.error("loadGroup error:", error);
        return;
      }
      if (!data) {
        console.warn("Group not found for name:", resolvedGroupName);
        return;
      }

      setGroupId(data.id);
      setGroupDesc(data.group_desc || "");
      setGroupAvatarUrl(data.group_pic_link || null);
      setGroupAdmins(Array.isArray(data.group_admin) ? data.group_admin : []);
      setMembersUsernames(Array.isArray(data.members) ? data.members : []);
    } catch (e) {
      console.error("loadGroup unexpected:", e);
    }
  }, [resolvedGroupName]);

  // initial load
  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  // reload every time screen gains focus
  useFocusEffect(
    useCallback(() => {
      setSearchQuery("");
      setSearchResults([]);
      loadGroup();
    }, [loadGroup])
  );

  /* ---------------- load subgroups for this group ---------------- */

  const loadSubgroups = useCallback(async () => {
    if (!groupId) return;
    setLoadingSubgroups(true);
    try {
      const { data, error } = await supabase
        .from("groups")
        .select("id, groupname, group_pic_link, members")
        .eq("is_subgroup_of", groupId);


      if (error) {
        console.error("loadSubgroups error:", error);
        setSubgroups([]);
        return;
      }
      setSubgroups(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("loadSubgroups unexpected:", e);
      setSubgroups([]);
    } finally {
      setLoadingSubgroups(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadSubgroups();
  }, [loadSubgroups]);

  // pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadGroup();
      await loadSubgroups();
    } finally {
      setRefreshing(false);
    }
  }, [loadGroup, loadSubgroups]);

  /* ---------------- recompute isAdmin when we know both ---------------- */

  useEffect(() => {
    if (!myUsername) return;
    const admin =
      Array.isArray(groupAdmins) && groupAdmins.includes(myUsername);
    setIsAdmin(admin);
  }, [groupAdmins, myUsername]);

  /* ---------------- compute memberCount from membersUsernames + me ----- */

  useEffect(() => {
    const base = Array.isArray(membersUsernames)
      ? membersUsernames.length
      : 0;

    const includeMe =
      myUsername &&
      Array.isArray(groupAdmins) &&
      groupAdmins.includes(myUsername) &&
      !membersUsernames.includes(myUsername);

    setMemberCount(base + (includeMe ? 1 : 0));
  }, [membersUsernames, groupAdmins, myUsername]);

  /* ---------------- load member profiles based on membersUsernames ------ */

  const loadMembers = useCallback(async () => {
    if (!membersUsernames || membersUsernames.length === 0) {
      setMembers([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, username, avatar_url")
        .in("username", membersUsernames);


      if (error) {
        console.error("loadMembers error:", error);
        return;
      }

      const rows = Array.isArray(data) ? data : [];

      // ensure every username appears at least once, even if profile missing
      const fallbackMembers = membersUsernames
        .filter(
          (u) => !rows.some((r) => (r.username || "").toLowerCase() === u)
        )
        .map((u) => ({
          id: `missing:${u}`,
          name: null,
          username: u,
          avatar_url: null,
        }));

      setMembers([...rows, ...fallbackMembers]);
    } catch (e) {
      console.error("loadMembers unexpected:", e);
    }
  }, [membersUsernames]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  /* ---------------- search locally within members ---------------- */

  const handleSearchChange = (text) => {
    setSearchQuery(text);
    const q = text.trim().toLowerCase();

    if (!q) {
      setSearchResults([]);
      return;
    }

    const filtered =
      members.filter((m) => {
        const uname = (m.username || "").toLowerCase();
        const name = (m.name || "").toLowerCase();
        return uname.includes(q) || name.includes(q);
      }) || [];

    setSearchResults(filtered);
  };

  /* ---------------- exit group (groups TABLE) ---------------- */

  const handleExitGroup = async () => {
    if (exiting) return;
    setExiting(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        console.error("Error getting user:", authError);
        Alert.alert("Error", "Could not identify current user.");
        setExiting(false);
        return;
      }

      const username =
        user.user_metadata?.username || user.email || user.id;

      if (!groupId) {
        console.error("No groupId set when exiting group");
        Alert.alert("Error", "Group not found.");
        setExiting(false);
        return;
      }

      const nextMembers = (membersUsernames || []).filter(
        (u) => u !== username
      );
      const nextAdmins = (groupAdmins || []).filter((u) => u !== username);

      const { error: updError } = await supabase
        .from("groups")
        .update({
          members: nextMembers,
          group_admin: nextAdmins,
        })
        .eq("id", groupId);

      if (updError) {
        console.error("Error exiting group (groups update):", updError);
        Alert.alert("Error", "Could not exit the group.");
        setExiting(false);
        return;
      }

      setMembersUsernames(nextMembers);
      setGroupAdmins(nextAdmins);

      Alert.alert("", t("group_exit_success") || "You left this group.");
      navigation.goBack();
    } catch (e) {
      console.error("Unexpected error exiting group:", e);
      Alert.alert("Error", "Could not exit the group.");
    } finally {
      setExiting(false);
    }
  };

  /* ---------------- report group ---------------- */

  const handleSubmitReport = () => {
    console.log("You reported this group");
    console.log("Reported group:", resolvedGroupName, "Reason:", reportText);
    setReportText("");
    setReportModalVisible(false);
    Alert.alert(
      "",
      t("group_report_success") || "Thanks for your report."
    );
  };

  /* ---------------- admin: change avatar (uses groups.group_pic_link) --- */

  const handleChangeAvatar = async () => {
    if (!isAdmin) return;

    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          "Alba needs access to your photos to set a group picture."
        );
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 0.9,
      });
      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      const publicUrl = await uploadGroupImageToAlbaMedia(asset.uri);
      console.log("DEBUG uploaded group avatar publicUrl =", publicUrl);

      if (!groupId) {
        console.log("DEBUG handleChangeAvatar: missing groupId");
        Alert.alert("Error", "Group row not found.");
        return;
      }

      const { error } = await supabase
        .from("groups")
        .update({ group_pic_link: publicUrl })
        .eq("id", groupId);

      console.log("DEBUG update group_pic_link error =", error);

      if (error) {
        console.error("update group_pic_link error", error);
        Alert.alert("Error", "Could not update group picture.");
        return;
      }

      setGroupAvatarUrl(publicUrl);
    } catch (e) {
      console.error("Unexpected error uploading avatar:", e);
      Alert.alert("Error", "Could not upload image.");
    }
  };

  /* ---------------- admin: member menu actions ---------------- */

  const openMemberMenu = (member) => {
    if (!isAdmin) return;
    setSelectedMember(member);
    setMemberMenuVisible(true);
  };

  const handleMessageMember = () => {
    if (!selectedMember) return;
    const uname = selectedMember.username;
    if (!uname) return;

    setMemberMenuVisible(false);

    console.log("DEBUG navigate to SingleChat with username =", uname);

    navigation.navigate("SingleChat", {
      username: uname,
      otherUsername: uname,
    });
  };

  const handleMakeAdmin = async () => {
    if (!selectedMember || !groupId) return;
    const uname = selectedMember.username;
    if (!uname) return;

    const nextAdmins = Array.from(new Set([...(groupAdmins || []), uname]));

    try {
      const { error } = await supabase
        .from("groups")
        .update({ group_admin: nextAdmins })
        .eq("id", groupId);

      if (error) {
        console.error("make admin error", error);
        Alert.alert("Error", "Could not make admin.");
        return;
      }

      console.log("DEBUG make admin, nextAdmins =", nextAdmins);

      setGroupAdmins(nextAdmins);
      setMemberMenuVisible(false);
    } catch (e) {
      console.error("make admin unexpected", e);
      Alert.alert("Error", "Could not make admin.");
    }
  };

  const handleDeleteMember = async () => {
    if (!selectedMember || !groupId) return;
    const uname = selectedMember.username;
    if (!uname) return;

    const nextMembers = (membersUsernames || []).filter(
      (u) => u !== uname
    );
    const nextAdmins = (groupAdmins || []).filter((u) => u !== uname);

    try {
      const { error } = await supabase
        .from("groups")
        .update({ members: nextMembers, group_admin: nextAdmins })
        .eq("id", groupId);

      if (error) {
        console.error("delete member error", error);
        Alert.alert("Error", "Could not remove member.");
        return;
      }

      console.log(
        "DEBUG delete member, nextMembers =",
        nextMembers,
        "nextAdmins =",
        nextAdmins
      );

      setMembersUsernames(nextMembers);
      setGroupAdmins(nextAdmins);
      setMembers((prev) => prev.filter((m) => m.username !== uname));
      setSearchResults((prev) =>
        prev.filter((m) => m.username !== uname)
      );
      setMemberMenuVisible(false);
    } catch (e) {
      console.error("delete member unexpected", e);
      Alert.alert("Error", "Could not remove member.");
    }
  };

  /* ---------------- admin: delete group ---------------- */

  const confirmDeleteGroup = () => {
    Alert.alert(
      t("group_delete_title") || "Delete group",
      t("group_delete_confirm") ||
        "Are you sure you want to delete this group?",
      [
        { text: t("cancel_button") || "Cancel", style: "cancel" },
        {
          text: t("delete_button") || "Delete",
          style: "destructive",
          onPress: handleDeleteGroup,
        },
      ]
    );
  };

  const handleDeleteGroup = async () => {
    try {
      if (!groupId) {
        Alert.alert("Error", "Group not found.");
        return;
      }

      const { error: gErr } = await supabase
        .from("groups")
        .delete()
        .eq("id", groupId);

      if (gErr) {
        console.error("delete group row error", gErr);
        Alert.alert("Error", "Could not delete group.");
        return;
      }

      Alert.alert("", t("group_deleted") || "Group deleted.");
      navigation.goBack();
    } catch (e) {
      console.error("delete group unexpected", e);
      Alert.alert("Error", "Could not delete group.");
    }
  };

  /* ---------------- subgroups: join / add / confirm ---------------- */

  const handleSubgroupPress = async (group, alreadyMember) => {
    if (!myUsername) return;

    // If I'm already a member, just navigate
    if (alreadyMember) {
      navigation.navigate("GroupChat", { groupName: group.groupname });
      return;
    }

    const currentMembers = Array.isArray(group.members) ? group.members : [];
    const nextMembers = currentMembers.includes(myUsername)
      ? currentMembers
      : [...currentMembers, myUsername];

    try {
      const { data, error } = await supabase
        .from("groups")
        .update({ members: nextMembers })
        .eq("id", group.id)
        .select("id, groupname, group_pic_link, members")
        .maybeSingle();

      if (error) {
        console.error("join subgroup error", error);
        Alert.alert("Error", "Could not join subgroup.");
        return;
      }

      const updated = data || { ...group, members: nextMembers };

      setSubgroups((prev) =>
        prev.map((g) => (g.id === group.id ? updated : g))
      );

      navigation.navigate("GroupInfoScreen", { groupName: updated.groupname });
    } catch (e) {
      console.error("join subgroup unexpected", e);
      Alert.alert("Error", "Could not join subgroup.");
    }
  };

  const handleAddSubgroup = () => {
    if (!myUsername || !groupId) return;

    const tempId = `temp-${Date.now()}`;
    const tempSubgroup = {
      id: tempId,
      groupname: "",
      group_pic_link: null,
      members: [myUsername],
      isNew: true,
    };

    setSubgroups((prev) => [...prev, tempSubgroup]);
    setEditingSubgroupId(tempId);
    setNewSubgroupName("");
  };

  const handleConfirmNewSubgroup = async (tempId) => {
    if (!editingSubgroupId || editingSubgroupId !== tempId) return;

    const name = newSubgroupName.trim();
    if (!name) {
      // Cancel creation if empty
      setSubgroups((prev) => prev.filter((g) => g.id !== tempId));
      setEditingSubgroupId(null);
      setNewSubgroupName("");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("groups")
        .insert({
          groupname: name,
          group_desc: null,
          group_pic_link: null,
          members: [myUsername],
          subgroups_allowed: false,
          subgroups: [],
          group_admin: [myUsername],
          is_subgroup_of: groupId,
        })
        .select("id, groupname, group_pic_link, members")
        .single();

      if (error) {
        console.error("create subgroup error", error);
        Alert.alert("Error", "Could not create subgroup.");
        return;
      }

      setSubgroups((prev) =>
        prev.map((g) => (g.id === tempId ? data : g))
      );
    } catch (e) {
      console.error("create subgroup unexpected", e);
      Alert.alert("Error", "Could not create subgroup.");
    } finally {
      setEditingSubgroupId(null);
      setNewSubgroupName("");
    }
  };

  /* ---------------- render member row ------------------- */

  const renderMember = (item) => {
    const displayName = item.name || item.username || "User";
    const username = item.username || "";
    const key =
      item.id?.toString() || item.username || Math.random().toString();

    return (
      <View
        key={key}
        style={[styles.memberRow, { borderBottomColor: theme.border }]}
      >
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.memberAvatar} />
        ) : (
          <View
            style={[
              styles.memberAvatar,
              {
                backgroundColor: theme.card,
                alignItems: "center",
                justifyContent: "center",
              },
            ]}
          >
            <Text style={[styles.memberInitials, { color: theme.text }]}>
              {displayName[0]?.toUpperCase() || "?"}
            </Text>
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={[styles.memberName, { color: theme.text }]}>
            {displayName}
          </Text>
          {!!username && (
            <Text
              style={[
                styles.memberUsername,
                { color: theme.subtleText || theme.text },
              ]}
            >
              @{username}
            </Text>
          )}
        </View>

        {isAdmin && username !== myUsername && (
          <TouchableOpacity
            style={styles.memberMenuButton}
            onPress={() => openMemberMenu(item)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather
              name="more-vertical"
              size={18}
              color={theme.subtleText || theme.text}
            />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  /* ---------------- render subgroup row ------------------- */

  const renderSubgroupRow = (group) => {
    const isMember =
      Array.isArray(group.members) &&
      myUsername &&
      group.members.includes(myUsername);

    // use first names based on parent group's member profiles
    const memberNames = Array.isArray(group.members)
      ? group.members
          .map((uname) => {
            const profile = members.find((m) => m.username === uname);
            const full =
              profile?.name || profile?.username || uname || "";
            const first = full.split(" ")[0] || full;
            return first;
          })
          .slice(0, 4)
      : [];

    const memberPreview = memberNames.join(", ");

    const isEditing = group.id === editingSubgroupId && group.isNew;

    return (
      <View
        key={group.id}
        style={[styles.memberRow, { borderBottomColor: theme.border }]}
      >
        {group.group_pic_link ? (
          <Image
            source={{ uri: group.group_pic_link }}
            style={styles.memberAvatar}
          />
        ) : (
          <View
            style={[
              styles.memberAvatar,
              {
                backgroundColor: "#FF6C6C",
              },
            ]}
          />
        )}

        <View style={{ flex: 1 }}>
          {isEditing ? (
            <TextInput
              style={[
                styles.memberName,
                { color: theme.text, paddingVertical: 0 },
              ]}
              value={newSubgroupName}
              onChangeText={setNewSubgroupName}
              placeholder={
                t("group_new_subgroup_placeholder") || "New subgroup name"
              }
              placeholderTextColor={theme.subtleText || "#999"}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => handleConfirmNewSubgroup(group.id)}
              onBlur={() => handleConfirmNewSubgroup(group.id)}
            />
          ) : (
            <Text
              style={[styles.memberName, { color: theme.text }]}
              numberOfLines={1}
            >
              {group.groupname}
            </Text>
          )}

          {!!memberPreview && (
            <Text
              style={[
                styles.memberUsername,
                { color: theme.subtleText || theme.text },
              ]}
              numberOfLines={1}
            >
              {memberPreview}
            </Text>
          )}
        </View>

        {!isEditing && (
          <TouchableOpacity
            style={styles.subgroupButton}
            onPress={() => handleSubgroupPress(group, isMember)}
          >
            <Text style={styles.subgroupButtonText}>
              {isMember ? "See" : "Join"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (!fontsLoaded) return null;

      const listData =
    searchQuery.trim().length > 0 ? searchResults : members;
  const isSearching = searchQuery.trim().length > 0;

  const rawNoMatch = t("group_no_matching_users");
  const noMatchText =
    rawNoMatch && rawNoMatch !== "group_no_matching_users"
      ? rawNoMatch
      : "No matching users";

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t("group_info_title") || "Group info"}
          </Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Scrollable content with pull-to-refresh */}
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.text}
            />
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          {/* Group main info */}
          <View style={styles.groupHeader}>
            <View style={styles.avatarWrap}>
              {groupAvatarUrl ? (
                <Image
                  source={{ uri: groupAvatarUrl }}
                  style={styles.groupAvatar}
                />
              ) : (
                <View
                  style={[
                    styles.groupAvatar,
                    {
                      backgroundColor: theme.card,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                  ]}
                >
                  <Feather name="users" size={40} color={theme.text} />
                </View>
              )}

              {isAdmin && (
                <TouchableOpacity
                  style={styles.avatarPlus}
                  onPress={handleChangeAvatar}
                >
                  <Feather name="plus" size={16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.groupName, { color: theme.text }]}>
              {resolvedGroupName}
            </Text>

            <Text
              style={[
                styles.groupMeta,
                { color: theme.subtleText || theme.text },
              ]}
            >
              {`Group · ${memberCount} ${
                memberCount === 1 ? "member" : "members"
              }`}
            </Text>

            {!!groupDesc && (
              <Text
                style={[
                  styles.groupDesc,
                  { color: theme.subtleText || theme.text },
                ]}
                numberOfLines={2}
              >
                {groupDesc}
              </Text>
            )}
          </View>

          {/* Search bar */}
          <View
            style={[
              styles.searchContainer,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Feather
              name="search"
              size={18}
              color={theme.subtleText || theme.text}
              style={{ marginRight: 8 }}
            />
            <TextInput
              placeholder={t("search_members_placeholder") || "Search members"}
              placeholderTextColor={theme.subtleText || "#888"}
              value={searchQuery}
              onChangeText={handleSearchChange}
              style={[styles.searchInput, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {/* Invite users button BELOW search */}
          {isAdmin && (
            <TouchableOpacity
              style={styles.inviteButton}
              onPress={() => setShareVisible(true)}
            >
              <Text style={styles.inviteButtonText}>
                {t("group_invite_user_button") || "Invite users"}
              </Text>
            </TouchableOpacity>
          )}

          {/* Members search results: only visible while searching */}
          {isSearching && (
            <>
              <View style={styles.membersHeaderRow}>
                <Text style={[styles.membersTitle, { color: theme.text }]}>
                  {t("group_members_title") || "Members"}
                </Text>
                <Text
                  style={[
                    styles.membersCount,
                    { color: theme.subtleText || theme.text },
                  ]}
                >
                  {listData.length}
                </Text>
              </View>

              <View
                style={[
                  styles.membersList,
                  { borderColor: theme.border, backgroundColor: theme.card },
                ]}
              >
                {listData.length > 0 ? (
                  <ScrollView
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 4 }}
                  >
                    {listData.map(renderMember)}
                  </ScrollView>
                ) : (
                  <View style={{ paddingVertical: 12, paddingHorizontal: 8 }}>
                    <Text
                      style={{
                        fontFamily: "Poppins",
                        fontSize: 14,
                        textAlign: "center",
                        color: theme.subtleText || theme.text,
                      }}
                    >
                      {noMatchText}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Subgroups section */}
          {subgroups.length > 0 && (
            <View style={styles.subgroupsSection}>
              <View style={styles.subgroupsHeaderRow}>
                <Text
                  style={[
                    styles.subgroupsTitle,
                    { color: theme.text },
                  ]}
                >
                  {t("group_subgroups_title") || "Subgroups"}
                </Text>
                <Text
                  style={[
                    styles.subgroupsCount,
                    { color: theme.subtleText || theme.text },
                  ]}
                >
                  {subgroups.length}
                </Text>
              </View>

              <View
                style={[
                  styles.membersList,
                  { borderColor: theme.border, backgroundColor: theme.card },
                ]}
              >
                {loadingSubgroups ? (
                  <View style={{ paddingVertical: 12 }}>
                    <ActivityIndicator color={theme.text} />
                  </View>
                ) : (
                  <ScrollView
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 4 }}
                  >
                    {subgroups.map((g) => renderSubgroupRow(g))}
                  </ScrollView>
                )}
              </View>
            </View>
          )}

          {/* Add subgroup button (light blue) */}
          {isAdmin && (
            <TouchableOpacity
              style={styles.addSubgroupButton}
              onPress={handleAddSubgroup}
            >
              <Text style={styles.addSubgroupButtonText}>
                {t("group_add_subgroup_button") || "Add subgroup"}
              </Text>
            </TouchableOpacity>
          )}

          {/* Footer buttons */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.exitButton}
              onPress={handleExitGroup}
              disabled={exiting}
            >
              <Text style={styles.exitButtonText}>
                {t("exit_group_button") || "Exit group"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.reportButton}
              onPress={() => setReportModalVisible(true)}
            >
              <Text style={styles.reportButtonText}>
                {t("report_group_button") || "Report group"}
              </Text>
            </TouchableOpacity>

            {isAdmin && (
              <TouchableOpacity
                style={styles.deleteGroupButton}
                onPress={confirmDeleteGroup}
              >
                <Text style={styles.deleteGroupButtonText}>
                  {t("delete_group_button") || "Delete group"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Report modal */}
      <Modal
        visible={reportModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setReportModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOuter}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[
              styles.modalInner,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {t("report_group_title") || "Report group"}
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                { color: theme.text, borderColor: theme.border },
              ]}
              placeholder={
                t("report_group_placeholder") ||
                "Tell us briefly what is wrong"
              }
              placeholderTextColor={theme.subtleText || "#888"}
              value={reportText}
              onChangeText={setReportText}
              multiline
            />
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setReportModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>
                  {t("cancel_button") || "Cancel"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSubmit}
                onPress={handleSubmitReport}
                disabled={!reportText.trim()}
              >
                <Text style={styles.modalSubmitText}>
                  {t("submit_button") || "Send"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Member menu modal */}
      <Modal
        visible={memberMenuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setMemberMenuVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOuter}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[
              styles.memberMenuInner,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.memberMenuTitle, { color: theme.text }]}>
              {selectedMember?.name || selectedMember?.username || ""}
            </Text>

            <TouchableOpacity
              style={styles.memberMenuItem}
              onPress={handleMessageMember}
            >
              <Text style={[styles.memberMenuText, { color: theme.text }]}>
                {t("group_message_member") || "Message"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.memberMenuItem}
              onPress={handleMakeAdmin}
            >
              <Text style={[styles.memberMenuText, { color: theme.text }]}>
                {t("group_make_admin") || "Make admin"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.memberMenuItem}
              onPress={handleDeleteMember}
            >
              <Text
                style={[
                  styles.memberMenuText,
                  { color: "#ff4d4f", fontWeight: "600" },
                ]}
              >
                {t("group_remove_member") || "Delete user"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.memberMenuItem, { marginTop: 6 }]}
              onPress={() => setMemberMenuVisible(false)}
            >
              <Text
                style={[
                  styles.memberMenuText,
                  { color: theme.subtleText || theme.text },
                ]}
              >
                {t("cancel_button") || "Cancel"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ShareMenu for invites */}
      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        inviteGroup={
          groupId
            ? {
                id: groupId,
                groupname: resolvedGroupName,
                group_pic_link: groupAvatarUrl,
              }
            : null
        }
        onSent={() => setShareVisible(false)}
      />
    </ThemedView>
  );
}

/* ----------------------------- styles ----------------------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 4,
  },
  backButton: {
    paddingRight: 8,
    paddingVertical: 4,
  },
  headerTitle: {
    flex: 1,
    fontFamily: "PoppinsBold",
    fontSize: 18,
    textAlign: "center",
  },

  groupHeader: {
    alignItems: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  avatarWrap: {
    position: "relative",
    marginBottom: 12,
  },
  groupAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlus: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#59A7FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  groupName: {
    fontFamily: "PoppinsBold",
    fontSize: 22,
    marginBottom: 4,
  },
  groupMeta: {
    fontFamily: "Poppins",
    fontSize: 13,
  },
  groupDesc: {
    fontFamily: "Poppins",
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
  },

  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: "Poppins",
    fontSize: 14,
    paddingVertical: 2,
  },

  inviteButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 8,
    backgroundColor: "#59A7FF",
    marginBottom: 20
  },
  inviteButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },

  membersHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginTop: 20,
    marginBottom: 4,
  },
  membersTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
  membersCount: {
    fontFamily: "Poppins",
    fontSize: 14,
  },

  membersList: {
    marginTop: 0,
    borderWidth: 1,
    borderRadius: 14,
    maxHeight: 170, // ~3 rows, scroll for more
    overflow: "hidden",
  },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  memberInitials: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
  },
  memberName: {
    fontFamily: "Poppins",
    fontSize: 15,
  },
  memberUsername: {
    fontFamily: "Poppins",
    fontSize: 13,
    marginTop: 2,
  },
  memberMenuButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  subgroupsSection: {
    marginTop: 20,
    marginBottom: 10,
  },
  subgroupsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  subgroupsTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
  subgroupsCount: {
    fontFamily: "Poppins",
    fontSize: 14,
    fontWeight: "700",
  },
  subgroupButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 5,
    backgroundColor: "#59A7FF",
    justifyContent: "center",
    alignItems: "center",
  },
  subgroupButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 13,
    color: "#ffffff",
  },

  addSubgroupButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 30,
    marginTop: 10,
    backgroundColor: "#59A7FF",
  },
  addSubgroupButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },

  primaryButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#59A7FF",
  },
  primaryButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },

  footer: {
    paddingVertical: 16,
    gap: 10,
  },
  exitButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    borderColor: "#59A7FF",
    backgroundColor: "white",
  },
  exitButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#59A7FF",
  },

  reportButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  reportButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },
  deleteGroupButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#ff4d4f",
  },
  deleteGroupButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },

  modalOuter: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalInner: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
  },
  modalTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 18,
    marginBottom: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontFamily: "Poppins",
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 14,
  },
  modalButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancel: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modalCancelText: {
    fontFamily: "Poppins",
    fontSize: 14,
  },
  modalSubmit: {
    backgroundColor: "#59A7FF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  modalSubmitText: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
    color: "#fff",
  },

  memberMenuInner: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  memberMenuTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    marginBottom: 8,
  },
  memberMenuItem: {
    paddingVertical: 8,
  },
  memberMenuText: {
    fontFamily: "Poppins",
    fontSize: 15,
  },

    inviteButton: {
    marginTop: 10,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#59A7FF",
  },
  inviteButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#FFFFFF",
  },

  addSubgroupButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 30,
    marginTop: 10,
    backgroundColor: "#59A7FF",
  },
  addSubgroupButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },

  footer: {
    paddingVertical: 16,
    gap: 10,
  },
  exitButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    borderColor: "#59A7FF",
    backgroundColor: "#FFFFFF",
  },
  exitButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#59A7FF",
  },
  reportButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#59A7FF",
  },
  reportButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },
  deleteGroupButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FF4D4F",
  },
  deleteGroupButtonText: {
    fontFamily: "PoppinsBold",
    fontSize: 15,
    color: "#ffffff",
  },
});
