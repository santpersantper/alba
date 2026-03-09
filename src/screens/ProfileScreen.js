// screens/ProfileScreen.js
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Animated,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Post from "../components/Post";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { decode as b64decodeStr } from "base-64";

import Constants from "expo-constants";
import {
  getCachedProfile,
  setCachedProfile,
  preloadProfileData,
  cacheImageToDisk,
} from "../lib/profileCache";

const PLACEHOLDERS = {
  location: "Location not disclosed",
  bio: " ",
  coverUri: null,
  avatarUri: null,
};

// Reads from the environment so we never hardcode a development IP or HTTP URL.
// Set EXPO_PUBLIC_API_URL to your production server domain (must be HTTPS in prod).
const _API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants?.expoConfig?.extra?.expoPublic?.API_URL ??
  "http://localhost:4000";
const AVATAR_FACE_DETECT_URL = `${_API_BASE}/api/face/detect-avatar`;

/* ------------ tiny utils ------------ */
const isHeicUrl = (u = "") => /\.heic($|\?)/i.test(String(u).split("?")[0] || "");
const asAt = (s) => (s ? String(s).trim().replace(/^@+/, "") : "");

// manual base64 string -> ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = b64decodeStr(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const toLocalJpegFromRemoteHeic = async (remoteUrl) => {
  const fname = `heic_${Date.now()}_${Math.random().toString(36).slice(2)}.heic`;
  const heicPath = FileSystem.cacheDirectory + fname;
  const dl = await FileSystem.downloadAsync(remoteUrl, heicPath);
  const out = await ImageManipulator.manipulateAsync(dl.uri, [], {
    compress: 0.92,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return out?.uri;
};

async function getMe() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user || null;
}

async function fetchProfileById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, city, email, avatar_url, cover_url, bio")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchProfileByUsername(username) {
  if (!username) return null;
  const uname = asAt(username);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, city, email, avatar_url, cover_url, bio")
    .eq("username", uname)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// upload via base64 + ArrayBuffer
async function uploadImageToAlbaMedia(localUri, pathPrefix = "profiles") {
  let uri = localUri;
  let ext = (localUri.split(".").pop() || "jpg").toLowerCase();
  let mime = "image/jpeg";

  if (ext === "png") mime = "image/png";
  if (ext === "heic" || ext === "heif") {
    const manipulated = await ImageManipulator.manipulateAsync(localUri, [], {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    uri = manipulated.uri;
    ext = "jpg";
    mime = "image/jpeg";
  }

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const arrayBuffer = base64ToArrayBuffer(base64);

  const filePath = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { data, error } = await supabase.storage.from("alba-media").upload(filePath, arrayBuffer, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;

  const { data: publicData } = supabase.storage.from("alba-media").getPublicUrl(data.path);
  return publicData.publicUrl;
}

export default function ProfileScreen({ navigation, route }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const params = route?.params || {};
  const wantUserId = params.userId || null;
  const wantUsername = params.username ? asAt(params.username) : null;
  const isMe = !wantUserId && !wantUsername;

  const [booting, setBooting] = useState(true);
  const [fetched, setFetched] = useState(null);

  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const [authId, setAuthId] = useState(null);
  const [prettyCity, setPrettyCity] = useState(null);

  const [showFullBio, setShowFullBio] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioEditValue, setBioEditValue] = useState("");
  const [savingBio, setSavingBio] = useState(false);

  // ✅ render sources can be remote OR file://
  const [coverRenderable, setCoverRenderable] = useState(null);
  const [avatarRenderable, setAvatarRenderable] = useState(null);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const [isFollowing, setIsFollowing] = useState(false);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [unblockModalVisible, setUnblockModalVisible] = useState(false);

  const [toastMessage, setToastMessage] = useState("");
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback(
    (msg) => {
      if (!msg) return;
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);

      setToastMessage(msg);
      Animated.timing(toastOpacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();

      toastTimeoutRef.current = setTimeout(() => {
        Animated.timing(toastOpacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(
          () => setToastMessage("")
        );
      }, 2000);
    },
    [toastOpacity]
  );

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  /* ---------------- PROFILE BOOT: refresh on every focus ---------------- */
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      // 1) cache-first UI (instant)
      (async () => {
        try {
          const cached = await getCachedProfile({ userId: wantUserId, username: wantUsername, isMe });
          if (!alive) return;

          if (cached) {
            setFetched((prev) => ({
              ...(prev || {}),
              ...cached,
              username: cached.username ?? wantUsername ?? prev?.username ?? null,
            }));
          }
          setBooting(false);
        } catch {
          if (!alive) return;
          setBooting(false);
        }
      })();

      // 2) background refresh + also warms image cache in profileCache
      (async () => {
        try {
          const me = await getMe().catch(() => null);
          if (alive && me?.id) setAuthId(me.id);

          const row = await preloadProfileData({ userId: wantUserId, username: wantUsername, isMe });
          if (!alive) return;
          if (row) setFetched(row);
        } catch {}
      })();

      return () => {
        alive = false;
      };
    }, [params.userId, params.username])
  );

  // blocked + followed users (background, runs when authId is known)
  useEffect(() => {
    if (!authId) return;
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("blocked_users, followed_users")
          .eq("id", authId)
          .maybeSingle();
        if (error || !data || !mounted) return;
        setBlockedUsers(Array.isArray(data.blocked_users) ? data.blocked_users : []);
        // Init follow state once we know both authId and the target's id
        const targetId = display?.id;
        if (targetId && Array.isArray(data.followed_users)) {
          setIsFollowing(data.followed_users.includes(targetId));
        }
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [authId, display?.id]);

  const persistBlockedUsers = async (next) => {
    setBlockedUsers(next);
    try {
      const { data, error } = await supabase.auth.getUser();
      const uid = data?.user?.id;
      if (error || !uid) return;
      await supabase.from("profiles").update({ blocked_users: next }).eq("id", uid);
    } catch {}
  };

  // reverse geocode (background)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({});
        const [place] = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (!mounted || !place) return;

        const zone = place.neighborhood || place.district || place.subregion;
        const city = place.city || place.subregion || place.region;
        const label = zone ? `${zone}, ${city || ""}`.trim().replace(/,\s*$/, "") : city || null;

        setPrettyCity(label);
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const display = useMemo(() => {
    const name = params.name ?? fetched?.name ?? (fetched?.username ? `@${fetched.username}` : "User");

    return {
      id: fetched?.id ?? params.userId ?? null,
      username: fetched?.username ?? params.username ?? null,
      name,
      location: params.location ?? fetched?.city ?? PLACEHOLDERS.location,
      bio: fetched?.bio ?? PLACEHOLDERS.bio,

      // remote urls
      coverUri: params.coverUri ?? fetched?.cover_url ?? PLACEHOLDERS.coverUri,
      avatarUri: params.avatarUri ?? fetched?.avatar_url ?? PLACEHOLDERS.avatarUri,

      // ✅ local disk cache paths (if present)
      coverLocal: fetched?.cover_local ?? null,
      avatarLocal: fetched?.avatar_local ?? null,

      email: fetched?.email ?? null,
    };
  }, [fetched, params]);

  const isSelf = display?.id && authId && display.id === authId;
  const targetUsername = asAt(display.username);
  const isBlocked = !isSelf && !!targetUsername && blockedUsers.includes(targetUsername);

  const firstName =
    display?.name && display.name !== "User"
      ? String(display.name).split(" ")[0]
      : display?.username
      ? `@${display.username}`
      : "User";

  const locationText = prettyCity || display.location || PLACEHOLDERS.location;

  const initials = useMemo(
    () =>
      (firstName || "U")
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
    [firstName]
  );

  const bioText = display.bio || "";
  const firstLineBio = useMemo(() => (bioText ? bioText.split(/\r?\n/)[0] : ""), [bioText]);

  const shouldShowReadMore = useMemo(() => {
    if (!bioText) return false;
    if (bioText.includes("\n")) return true;
    return bioText.length > 60;
  }, [bioText]);

  const displayedBio = showFullBio || !shouldShowReadMore ? bioText : firstLineBio;

  const goMessage = () => {
    const chatKey = display.username ? `@${display.username}` : display.id ? `user:${display.id}` : firstName;
    navigation.navigate("SingleChat", {
      chat: chatKey,
      isGroup: false,
      peerName: firstName,
      username: display.username || undefined,
    });
  };

  const onToggleFollow = async () => {
    if (isSelf || !authId || !display.id) return;
    const next = !isFollowing;
    setIsFollowing(next);
    try {
      // Load current followed_users, then add/remove target
      const { data: myProfile } = await supabase
        .from("profiles")
        .select("followed_users")
        .eq("id", authId)
        .maybeSingle();
      const current = Array.isArray(myProfile?.followed_users) ? myProfile.followed_users : [];
      const updated = next
        ? Array.from(new Set([...current, display.id]))
        : current.filter((id) => id !== display.id);
      await supabase.from("profiles").update({ followed_users: updated }).eq("id", authId);
    } catch {
      setIsFollowing(!next); // revert on error
    }
  };

  const openProfileMenu = () => {
    if (isSelf) return;
    setProfileMenuVisible(true);
  };

  const handleBlockUser = () => {
    if (!targetUsername) return;
    setProfileMenuVisible(false);

    if (isBlocked) {
      setUnblockModalVisible(true);
      return;
    }

    const next = blockedUsers.includes(targetUsername) ? blockedUsers : [...blockedUsers, targetUsername];
    persistBlockedUsers(next);
    showToast("You've blocked this user.");
  };

  const confirmUnblock = () => {
    if (!targetUsername) {
      setUnblockModalVisible(false);
      return;
    }
    const next = blockedUsers.filter((u) => u !== targetUsername);
    persistBlockedUsers(next);
    setUnblockModalVisible(false);
  };

  const cancelUnblock = () => setUnblockModalVisible(false);

  const handleSaveBio = async () => {
    if (!display.id) return;
    setSavingBio(true);
    try {
      const newBio = bioEditValue.trim() || null;
      const { error } = await supabase.from("profiles").update({ bio: newBio }).eq("id", display.id);
      if (error) throw error;
      setFetched((prev) => (prev ? { ...prev, bio: newBio } : prev));
      await setCachedProfile(
        { userId: display.id, username: display.username, isMe: true },
        { ...fetched, id: display.id, username: display.username, bio: newBio }
      );
      setEditingBio(false);
    } catch {
      showToast(t("profile_couldnt_save_bio"));
    } finally {
      setSavingBio(false);
    }
  };

  // ✅ pictures: prefer local disk cache instantly; otherwise remote
  useEffect(() => {
    let ok = true;

    (async () => {
      const cover = display.coverLocal || display.coverUri;
      const avatar = display.avatarLocal || display.avatarUri;

      if (ok) {
        setCoverRenderable(cover || null);
        setAvatarRenderable(avatar || null);
      }

      try {
        const needCoverLocal = !display.coverLocal && display.coverUri && !isHeicUrl(display.coverUri);
        const needAvatarLocal = !display.avatarLocal && display.avatarUri && !isHeicUrl(display.avatarUri);

        const [coverLocal, avatarLocal] = await Promise.all([
          needCoverLocal ? cacheImageToDisk(display.coverUri) : Promise.resolve(null),
          needAvatarLocal ? cacheImageToDisk(display.avatarUri) : Promise.resolve(null),
        ]);

        if (!ok) return;

        if (coverLocal) setCoverRenderable(coverLocal);
        if (avatarLocal) setAvatarRenderable(avatarLocal);

        if (fetched?.id && (coverLocal || avatarLocal)) {
          await setCachedProfile(
            { userId: fetched.id, username: fetched.username, isMe },
            {
              ...fetched,
              cover_local: coverLocal || fetched.cover_local || null,
              avatar_local: avatarLocal || fetched.avatar_local || null,
            }
          );
        }
      } catch {}

      try {
        if (display.coverUri && isHeicUrl(display.coverUri)) {
          const u = await toLocalJpegFromRemoteHeic(display.coverUri);
          if (ok && u) setCoverRenderable(u);
        }
      } catch {}

      try {
        if (display.avatarUri && isHeicUrl(display.avatarUri)) {
          const u = await toLocalJpegFromRemoteHeic(display.avatarUri);
          if (ok && u) setAvatarRenderable(u);
        }
      } catch {}
    })();

    return () => {
      ok = false;
    };
  }, [display.coverUri, display.avatarUri, display.coverLocal, display.avatarLocal, fetched?.id]);

  /* =======================
     ✅ FIX: FETCH POSTS
     ======================= */
  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        // Don’t show other users’ posts if blocked (optional, but consistent with your UI state)
        if (isBlocked) {
          console.log("[Profile][Posts] blocked -> skipping posts load", { targetUsername });
          if (alive) setPosts([]);
          return;
        }

        const authorId = display?.id || null;
        const uname = asAt(display?.username) || null;

        console.log("[Profile][Posts] start", {
          isMe,
          isSelf,
          authId,
          authorId,
          uname,
          wantUserId,
          wantUsername,
        });

        if (!authorId && !uname) {
          console.log("[Profile][Posts] no authorId/username yet -> wait");
          return;
        }

        if (alive) setPostsLoading(true);

        // Prefer author_id (most reliable); fallback to username
        let q = supabase
          .from("posts")
          .select("*")
          .order("date", { ascending: false })
          .order("time", { ascending: false });

        if (authorId) q = q.eq("author_id", authorId);
        else q = q.eq("user", uname);

        const { data, error } = await q;

        if (error) {
          console.log("[Profile][Posts] ERROR", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          throw error;
        }

        console.log("[Profile][Posts] ok", { count: data?.length || 0 });

        if (!alive) return;
        setPosts(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!alive) return;
        console.log("[Profile][Posts] catch", e?.message || e);
        setPosts([]);
      } finally {
        if (alive) setPostsLoading(false);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, [
    display?.id,
    display?.username,
    isBlocked,
    authId,
    isMe,
    isSelf,
    wantUserId,
    wantUsername,
  ]);

  const detectFaceInAvatar = async (localUri) => {
    try {
      const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: "base64" });

      const res = await fetch(AVATAR_FACE_DETECT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      if (!res.ok) throw new Error("Avatar detect request failed");

      const json = await res.json();
      return !!json.faceDetected;
    } catch {
      return true;
    }
  };

  const handlePickAvatar = async () => {
    if (!isSelf || !display.id) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Alba needs access to your photos to set a profile picture.");
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

      setUploadingAvatar(true);

      const hasFace = await detectFaceInAvatar(asset.uri);
      if (!hasFace) {
        Alert.alert(t("avatar_invalid_title"), t("avatar_invalid_message"));
        setUploadingAvatar(false);
        return;
      }

      const publicUrl = await uploadImageToAlbaMedia(asset.uri, "avatars");

      const { error } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", display.id);
      if (error) throw error;

      const local = await cacheImageToDisk(publicUrl);

      setFetched((prev) =>
        prev ? { ...prev, avatar_url: publicUrl, avatar_local: local || prev.avatar_local || null } : prev
      );
      setAvatarRenderable(local || publicUrl);

      await setCachedProfile(
        { userId: display.id, username: display.username, isMe: true },
        {
          ...fetched,
          id: display.id,
          username: display.username,
          name: fetched?.name || display.name,
          city: fetched?.city || null,
          avatar_url: publicUrl,
          avatar_local: local || null,
          cover_url: fetched?.cover_url || null,
          cover_local: fetched?.cover_local || null,
          bio: fetched?.bio || null,
        }
      );
    } catch {
      Alert.alert("Error", "Could not update profile picture.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handlePickCover = async () => {
    if (!isSelf || !display.id) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Alba needs access to your photos to set a cover picture.");
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

      setUploadingCover(true);

      const publicUrl = await uploadImageToAlbaMedia(asset.uri, "covers");

      const { error } = await supabase.from("profiles").update({ cover_url: publicUrl }).eq("id", display.id);
      if (error) throw error;

      const local = await cacheImageToDisk(publicUrl);

      setFetched((prev) =>
        prev ? { ...prev, cover_url: publicUrl, cover_local: local || prev.cover_local || null } : prev
      );
      setCoverRenderable(local || publicUrl);

      await setCachedProfile(
        { userId: display.id, username: display.username, isMe: true },
        {
          ...fetched,
          id: display.id,
          username: display.username,
          name: fetched?.name || display.name,
          city: fetched?.city || null,
          avatar_url: fetched?.avatar_url || null,
          avatar_local: fetched?.avatar_local || null,
          cover_url: publicUrl,
          cover_local: local || null,
          bio: fetched?.bio || null,
        }
      );
    } catch {
      Alert.alert("Error", "Could not update cover picture.");
    } finally {
      setUploadingCover(false);
    }
  };

  if (!fontsLoaded) return null;

  function Header({ title, onBack }) {
    return (
      <View style={[styles.headerWrap, { backgroundColor: theme.gray, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={8}>
          <Feather name="chevron-left" size={26} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
              {title ? `@${title}` : "Profile"}
            </Text>
          </View>
        </View>

        <View style={{ width: 30 }} />
      </View>
    );
  }

  const showBootSpinner = booting && !fetched;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.gray }]}>
      <Header
        title={display.username}
        onBack={() => navigation?.goBack?.()}
      />

      {showBootSpinner ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: theme.gray }}>
          {/* Cover */}
          <View
            style={[
              styles.coverWrap,
              { backgroundColor: coverRenderable ? "transparent" : isDark ? "#333333" : "#EAF0F5" },
            ]}
          >
            {coverRenderable && <Image source={{ uri: coverRenderable }} style={styles.coverImg} />}
            {isSelf && (
              <TouchableOpacity
                style={[styles.addCoverBtn, isDark && { backgroundColor: "#1f3440", borderColor: "#328fbd" }]}
                onPress={handlePickCover}
                disabled={uploadingCover}
              >
                <Feather name="plus" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Avatar + "+" */}
          <View style={styles.avatarRow}>
            <View style={styles.avatarOuter}>
              {avatarRenderable ? (
                <Image source={{ uri: avatarRenderable }} style={styles.avatar} />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    styles.avatarFallback,
                    { backgroundColor: isDark ? "#444" : "#E3E9F1" },
                  ]}
                >
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
              )}

              {isSelf && (
                <TouchableOpacity
                  style={[styles.addAvatarBtn, isDark && { backgroundColor: "#1f3440", borderColor: "#328fbd" }]}
                  onPress={handlePickAvatar}
                  disabled={uploadingAvatar}
                >
                  <Feather name="plus" size={14} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Meta */}
          <View style={styles.infoWrap}>
            <Text style={[styles.name, { color: theme.text }]}>{firstName}</Text>
            <Text style={[styles.location, { color: theme.secondaryText }]}>{locationText}</Text>

            {isSelf ? (
              editingBio ? (
                <View style={{ marginTop: 8 }}>
                  <TextInput
                    style={[styles.bio, { color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8, textAlignVertical: "top", minHeight: 70 }]}
                    multiline
                    value={bioEditValue}
                    onChangeText={setBioEditValue}
                    placeholder="Write something about yourself..."
                    placeholderTextColor={theme.secondaryText}
                    autoFocus
                    maxLength={200}
                  />
                  <View style={{ flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => setEditingBio(false)}
                      style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}
                    >
                      <Text style={{ color: theme.text, fontFamily: "Poppins", fontSize: 13 }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSaveBio}
                      disabled={savingBio}
                      style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, backgroundColor: "#12A7E0" }}
                    >
                      <Text style={{ color: "#fff", fontFamily: "Poppins", fontSize: 13 }}>{savingBio ? t("profile_bio_saving") : t("profile_bio_save")}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 8 }}>
                  {bioText ? (
                    <Text
                      style={[styles.bio, { color: theme.secondaryText, marginTop: 0, flex: 1 }]}
                      onPress={() => shouldShowReadMore && setShowFullBio((v) => !v)}
                    >
                      {displayedBio}
                      {!showFullBio && shouldShowReadMore && (
                        <Text style={[styles.readMore, { color: theme.text }]}>{" "}{t("profile_bio_read_more")}</Text>
                      )}
                    </Text>
                  ) : (
                    <Text style={[styles.bio, { color: theme.secondaryText, opacity: 0.55, marginTop: 0, flex: 1 }]}>
                      {t("profile_bio_add")}
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={() => { setBioEditValue(bioText); setEditingBio(true); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ paddingLeft: 6, paddingTop: 2 }}
                  >
                    <Feather name="edit-2" size={11} color={theme.secondaryText} style={{ opacity: 0.6 }} />
                  </TouchableOpacity>
                </View>
              )
            ) : (
              !!bioText && (
                <Text
                  style={[styles.bio, { color: theme.secondaryText }]}
                  onPress={() => shouldShowReadMore && setShowFullBio((v) => !v)}
                >
                  {displayedBio}
                  {!showFullBio && shouldShowReadMore && (
                    <Text style={[styles.readMore, { color: theme.text }]}>{" "}{t("profile_bio_read_more")}</Text>
                  )}
                </Text>
              )
            )}

            {/* Actions — only shown when viewing another user's profile */}
            {!isSelf && (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={() => {
                    if (isBlocked) setUnblockModalVisible(true);
                    else goMessage();
                  }}
                >
                  <Feather name="message-circle" size={16} color="#fff" />
                  <Text style={[styles.btnText, { color: "#fff" }]}>{t("profile_message_button")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.gray }]}
                  onPress={onToggleFollow}
                  disabled={isBlocked}
                >
                  <Text style={[styles.btnText, { color: theme.text, fontWeight: "600" }]}>
                    {isBlocked ? t("profile_blocked_label") : isFollowing ? t("profile_following") : t("profile_follow")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.squareBtn, { backgroundColor: theme.gray, borderColor: theme.border }]}
                  onPress={openProfileMenu}
                >
                  <Feather name="more-horizontal" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {postsLoading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator />
            </View>
          ) : posts.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
              @{asAt(display.username) || "user"} {t("profile_no_posts")}
            </Text>
          ) : (
            posts.map((item) => (
              <View key={item.id} style={{ backgroundColor: theme.gray, paddingHorizontal: 0, marginBottom: 12 }}>
                <Post {...item} />
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Profile action menu (Report / Block) */}
      <Modal
        visible={profileMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setProfileMenuVisible(false)}
        >
          <View style={[styles.sheetCard, { backgroundColor: isDark ? "#2a2a2a" : "#fff" }]}>
            <Text style={[styles.sheetTitle, { color: isDark ? "#fff" : "#111" }]} numberOfLines={1}>
              {display.name || (display.username ? `@${display.username}` : "User")}
            </Text>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                setProfileMenuVisible(false);
                setReportText("");
                setReportModalVisible(true);
              }}
            >
              <Feather name="alert-triangle" size={18} color={isDark ? "#fff" : "#333"} style={{ marginRight: 12 }} />
              <Text style={[styles.sheetItemText, { color: isDark ? "#fff" : "#111" }]}>{t("profile_report_label")}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetItem} onPress={handleBlockUser}>
              <Feather
                name={isBlocked ? "user-check" : "user-x"}
                size={18}
                color="#d23b3b"
                style={{ marginRight: 12 }}
              />
              <Text style={[styles.sheetItemText, { color: "#d23b3b" }]}>
                {isBlocked ? t("profile_unblock_label") : t("profile_block_label")}
              </Text>
            </TouchableOpacity>

            <View style={[styles.sheetDivider, { backgroundColor: isDark ? "#444" : "#eee" }]} />

            <TouchableOpacity style={styles.sheetItem} onPress={() => setProfileMenuVisible(false)}>
              <Feather name="x" size={18} color={isDark ? "#aaa" : "#888"} style={{ marginRight: 12 }} />
              <Text style={[styles.sheetItemText, { color: isDark ? "#aaa" : "#888" }]}>{t("profile_cancel_label")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report text modal */}
      <Modal
        visible={reportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.centeredOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: isDark ? "#2a2a2a" : "#fff" }]}>
            <Text style={[styles.dialogTitle, { color: isDark ? "#fff" : "#111" }]}>{t("profile_report_user_title")}</Text>
            <TextInput
              style={[
                styles.reportInput,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: isDark ? "#1a1a1a" : "#f5f5f5",
                },
              ]}
              placeholder={t("profile_report_placeholder")}
              placeholderTextColor={isDark ? "#888" : "#aaa"}
              value={reportText}
              onChangeText={setReportText}
              multiline
              maxLength={500}
            />
            <View style={styles.dialogBtns}>
              <TouchableOpacity
                onPress={() => setReportModalVisible(false)}
                style={styles.dialogBtnCancel}
              >
                <Text style={[styles.dialogBtnCancelText, { color: theme.text }]}>{t("profile_cancel_label")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dialogBtnSubmit}
                onPress={async () => {
                  const { data: auth } = await supabase.auth.getUser();
                  const reporterId = auth?.user?.id || null;
                  const reason = reportText.trim() || `Profile: @${targetUsername}`;
                  try {
                    await supabase.from("reports").insert({
                      reported_by: reporterId,
                      reported_user: targetUsername || null,
                      reason,
                    });
                  } catch {}
                  try {
                    const { data: myProfile } = await supabase
                      .from("profiles")
                      .select("username")
                      .eq("id", reporterId)
                      .maybeSingle();
                    await supabase.functions.invoke("send-report", {
                      body: {
                        type: "profile",
                        reported_by_id: reporterId,
                        reported_by_username: myProfile?.username || null,
                        reason,
                        context: { reported_username: targetUsername },
                      },
                    });
                  } catch {}
                  setReportModalVisible(false);
                  showToast(t("profile_thanks_report"));
                }}
              >
                <Text style={styles.dialogBtnSubmitText}>{t("submit_button")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Unblock confirm modal */}
      <Modal
        visible={unblockModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelUnblock}
      >
        <View style={styles.centeredOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: isDark ? "#2a2a2a" : "#fff" }]}>
            <Text style={[styles.dialogTitle, { color: isDark ? "#fff" : "#111" }]}>
              Unblock @{targetUsername}?
            </Text>
            <Text style={{ fontFamily: "Poppins", fontSize: 13, color: theme.secondaryText, marginBottom: 16 }}>
              They'll be able to see your posts and contact you again.
            </Text>
            <View style={styles.dialogBtns}>
              <TouchableOpacity onPress={cancelUnblock} style={styles.dialogBtnCancel}>
                <Text style={[styles.dialogBtnCancelText, { color: theme.text }]}>{t("profile_cancel_label")}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmUnblock} style={styles.dialogBtnSubmit}>
                <Text style={styles.dialogBtnSubmitText}>{t("profile_unblock_label")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {!!toastMessage && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, marginBottom: 0 },
  headerWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { paddingRight: 4, paddingVertical: 4 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  menuBtn: { paddingLeft: 8, paddingVertical: 4 },
  title: { fontSize: 15.5, fontWeight: "700", fontFamily: "Poppins", alignItems: "center" },

  coverWrap: { width: "100%", height: 132, position: "relative" },
  coverImg: { width: "100%", height: "100%" },
  addCoverBtn: {
    position: "absolute",
    bottom: 10,
    left: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#12A7E0",
  },

  avatarRow: { alignItems: "center", marginTop: -40 },
  avatarOuter: { position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800", color: "#596576", fontSize: 28, fontFamily: "Poppins" },
  addAvatarBtn: {
    position: "absolute",
    bottom: 0,
    right: -4,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#12A7E0",
  },

  infoWrap: { paddingHorizontal: 20, paddingTop: 10 },
  name: { fontSize: 20, fontWeight: "800", textAlign: "center", fontFamily: "Poppins" },
  location: { fontSize: 13, textAlign: "center", marginTop: 4, fontFamily: "Poppins" },
  bio: { fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 18, fontFamily: "Poppins" },
  readMore: { fontWeight: "700", fontFamily: "Poppins" },

  actionsRow: { flexDirection: "row", marginTop: 14, gap: 10, justifyContent: "center", marginBottom: 14 },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 38, borderRadius: 10 },
  btnPrimary: { backgroundColor: "#12A7E0" },
  btnText: { fontSize: 14, fontWeight: "200", fontFamily: "Poppins" },
  squareBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyText: { textAlign: "center", marginTop: 20, fontSize: 14, fontFamily: "Poppins" },

  // Sheet modal (Report / Block)
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetCard: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingBottom: 32, paddingHorizontal: 16 },
  sheetTitle: { fontFamily: "PoppinsBold", fontSize: 15, textAlign: "center", paddingVertical: 10, marginBottom: 4 },
  sheetItem: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  sheetItemText: { fontFamily: "Poppins", fontSize: 15 },
  sheetDivider: { height: 1, marginVertical: 4 },

  // Centered dialog (Report text / Unblock)
  centeredOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  dialogCard: { width: "100%", borderRadius: 16, padding: 20 },
  dialogTitle: { fontFamily: "PoppinsBold", fontSize: 16, marginBottom: 12 },
  reportInput: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 80, fontFamily: "Poppins", fontSize: 14, textAlignVertical: "top", marginBottom: 16 },
  dialogBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  dialogBtnCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  dialogBtnCancelText: { fontFamily: "Poppins", fontSize: 14 },
  dialogBtnSubmit: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: "#12A7E0" },
  dialogBtnSubmitText: { fontFamily: "Poppins", fontSize: 14, color: "#fff" },

  // Toast
  toast: { position: "absolute", bottom: 32, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.75)", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  toastText: { color: "#fff", fontFamily: "Poppins", fontSize: 13 },
});
