// components/Post.js — DROP-IN
// Change: subtitle now shows:
// - if event: "Dec 22, 21:30, Playa Muelle" (date = "Dec 22" no year)  [date, time, location]
// - else: "Playa Muelle"                                              [location only]
//
// Assumptions:
// - event posts have a usable flag in props/basePost: `is_event` OR `post_type === "event"` OR `type === "event"` OR labelTag === "Event"
// - date/time can be in props or basePost: `date`, `time`
// - location can be in props or basePost: `location`

import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  StyleSheet as RNStyleSheet,
  Modal,
  ActivityIndicator,
  Alert,
  TextInput,
  Linking,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { Image as ExpoImage } from "expo-image";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { posthog } from "../lib/analytics";

import ShareMenu from "../components/ShareMenu";
import BuyModal from "../components/BuyModal";

import ThemedView from "../theme/ThemedView";
import ThemedText from "../theme/ThemedText";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { translateText } from "../utils/translate";

import {
  preloadProfileData,
  getCachedProfile,
  cacheImageToDisk,
} from "../lib/profileCache";
import { trackRequest } from "../lib/requestTracker";

/* ---------- config ---------- */
const _screenH = Dimensions.get("window").height;
const DEFAULT_MEDIA_HEIGHT = Math.round(Math.min(_screenH * 0.32, 420));
const MIN_MEDIA_HEIGHT = 200;
const MAX_MEDIA_HEIGHT = Math.round(_screenH * 0.8); // allow up to 80% of screen height so large photos show fully on iPad

/* ---------- actions ---------- */
const ACTIONS = {
  tickets: {
    i18nKey: "actions_tickets",
    text: "Tickets",
    icon: require("../../assets/ticket_white.png"),
    color: "#3D8BFF",
  },
  join_chat: {
    i18nKey: "actions_join_chat",
    text: "Join event chat",
    icon: require("../../assets/chat_white.png"),
    color: "#00A9FF",
  },
  share: {
    i18nKey: "actions_share",
    text: "Share",
    icon: require("../../assets/share_white.png"),
    color: "#6C63FF",
  },
  save: {
    i18nKey: "actions_save",
    text: "Save",
    icon: require("../../assets/save_white.png"),
    color: "#60affe",
  },
  buy: {
    i18nKey: "actions_buy",
    text: "Buy",
    icon: require("../../assets/buy_white.png"),
    color: "#2BB673",
  },
  message: {
    i18nKey: "actions_message_seller",
    text: "Message seller",
    icon: require("../../assets/chat_white.png"),
    color: "#008CFF",
  },
};

const HIDE_FROM_CTA = new Set(["subgroups", "invite"]);

const normalizeAction = (raw = "") => {
  const s = String(raw).toLowerCase().trim();
  if (s === "subgroups" || s.includes("subgroup")) return "subgroups";
  if (s === "invite" || s.includes("invitation") || s.includes("invites"))
    return "invite";
  if (s === "join_chat" || (s.includes("join") && s.includes("chat")))
    return "join_chat";
  if (s === "tickets" || s.includes("ticket")) return "tickets";
  if (s === "share") return "share";
  if (s === "save") return "save";
  if (s === "buy" || s.startsWith("buy")) return "buy";
  if (s === "message" || s.startsWith("message")) return "message";
  return ACTIONS[s] ? s : null;
};

/* ---------- utils ---------- */
const stripQuery = (u = "") => String(u).split("?")[0];
const isHeic = (u = "") => /\.heic$/i.test(stripQuery(u));
const isVideoUrl = (u = "") => /\.(mp4|mov|m4v|webm)$/i.test(stripQuery(u));
const isHttp = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
const stripAt = (h = "") => String(h).replace(/^@+/, "");


// ✅ parse possible json-string arrays
const toArray = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [raw];
      } catch {
        return [raw];
      }
    }
    return [trimmed];
  }
  return [];
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

const formatYYYYMMDDLocal = (s) => {
  const str = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str || null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const formatMonDD = (dateLike) => {
  const ymd = formatYYYYMMDDLocal(dateLike);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  // Use UTC to avoid timezone shifting since we already normalized to a local Y-M-D string.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit" }).replace(",", "");
};

const normalizeTime = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return null;
  // "HH:MM:SS" -> "HH:MM"
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return s;
  const hh = String(m[1]).padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
};

// Renders text with @mentions styled bold + coloured and tappable
function parseMentionText(text, isDark, onMentionPress) {
  if (!text || !text.includes("@")) return text;
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (/^@\w+$/.test(part)) {
      const username = part.slice(1);
      return (
        <Text
          key={i}
          style={{ fontFamily: "PoppinsBold", color: isDark ? "#a0a0a0" : "#4EBCFF" }}
          onPress={() => onMentionPress(username)}
        >
          {part}
        </Text>
      );
    }
    return part;
  });
}

// Session-level set so each ad post is counted as a view at most once per app session
const _adViewsTracked = new Set();

// Module-level auth cache — one getUser() + profiles fetch shared across all Post instances
let _cachedAuth = null; // { uid, username, isVerified }
let _cachedAuthTs = 0;
const AUTH_CACHE_TTL = 5 * 60 * 1000;

export function invalidateAuthCache() {
  _cachedAuth = null;
  _cachedAuthTs = 0;
}
let _authFetchPromise = null; // deduplicates in-flight fetches
async function getAuthCached() {
  if (_cachedAuth && Date.now() - _cachedAuthTs < AUTH_CACHE_TTL) return _cachedAuth;
  if (_authFetchPromise) return _authFetchPromise;
  _authFetchPromise = (async () => {
    const done = trackRequest("Post.getAuthCached (getUser+profiles)");
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id;
      if (!uid) return null;
      const { data: prof } = await supabase
        .from("profiles")
        .select("username, is_verified")
        .eq("id", uid)
        .maybeSingle();
      _cachedAuth = { uid, username: prof?.username || null, isVerified: !!prof?.is_verified };
      _cachedAuthTs = Date.now();
      return _cachedAuth;
    } finally {
      done();
      _authFetchPromise = null;
    }
  })();
  return _authFetchPromise;
}

// Module-level image dimensions cache — avoids redundant Image.getSize() fetches on re-mount
const _dimCache = {}; // uri → { width, height }

/* ---------- media subcomponents ---------- */
function ImageSlide({ uri, width, height, index }) {
  return (
    <ExpoImage
      key={`${uri}-${index}`}
      source={{ uri }}
      style={[styles.mediaItem, { width, height }]}
      contentFit="cover"
      cachePolicy="disk"
    />
  );
}

function VideoSlide({ uri, width, height, index, autoPlay }) {
  const [muted, setMuted] = useState(true);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.bufferOptions = {
      preferredForwardBufferDuration: 8,
      minBufferForPlayback: 2,
      maxBufferBytes: 10 * 1024 * 1024, // 10 MB cap
    };
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });
  const loaded = status === "readyToPlay";

  useEffect(() => {
    if (!loaded) return;
    try {
      if (autoPlay) player.play();
      else player.pause();
    } catch (e) {
      console.log("video control error", e);
    }
  }, [autoPlay, loaded]);

  useEffect(() => {
    player.muted = muted;
  }, [muted]);

  return (
    <View
      key={`${uri}-${index}`}
      style={[styles.mediaItem, { width, height, overflow: "hidden" }]}
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />

      {!loaded && (
        <View
          style={{
            ...StyleSheet.absoluteFillObject,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "black",
          }}
        >
          <ActivityIndicator color="#fff" />
        </View>
      )}

      <TouchableOpacity
        style={styles.muteButton}
        activeOpacity={0.8}
        onPress={() => setMuted((p) => !p)}
      >
        <Ionicons
          name={muted ? "volume-mute-outline" : "volume-high-outline"}
          size={18}
          color="#fff"
        />
      </TouchableOpacity>
    </View>
  );
}

/* ---------- main component ---------- */
export default function Post(props) {
  const {
    title,
    description,
    user,
    userPicUri,
    actions = [],
    colors = [],
    actionIconPaths = [],
    postMediaUri,
    onPressBuy,
    onPressMessage,
    onPressShare,

    groupId: groupIdProp,
    groupName: groupNameProp,
    groupMembers,

    labelTag,
    labelColor,

    postId,
    authorId,
    onReport,
    onDelete,
    onDeleted,
    canDeleteOverride,
    initialSaved = false,
    onToggleSave,
    isActive = false,

    postMediaUriHint,
  } = props;

  const basePost = props.post || props.item || {};
  const effectivePostId = postId || basePost.id;
  // DB spreads use snake_case (author_id); explicit props use camelCase (authorId)
  const resolvedAuthorId = authorId || props.author_id || basePost.author_id || null;

  const navigation = useNavigation();
  const { isDark } = useAlbaTheme();
  const { t, language } = useAlbaLanguage();

  const toImageSource = (v) => (typeof v === "string" ? { uri: v } : v || null);

  const displayUser = user || basePost.user;
  const displayUsername = stripAt(displayUser || "");
  const fallbackAvatar =
    props.userpicuri || basePost.userpicuri || "https://placehold.co/48x48";

  const [avatarForHeader, setAvatarForHeader] = useState(
    userPicUri || fallbackAvatar
  );
  // Resolved from profileCache by UUID so it stays current even if posts.user is stale
  const [resolvedUsername, setResolvedUsername] = useState(displayUsername);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const current = userPicUri || fallbackAvatar;
        if (typeof current === "string" && current.startsWith("file://")) {
          if (mounted) setAvatarForHeader(current);
          // Still resolve username even when avatar is already local
        }

        let cached =
          (await getCachedProfile({ userId: resolvedAuthorId })) ||
          (await getCachedProfile({ username: displayUsername }));

        // If cache is stale / missing, fetch fresh (updates cache for next render too)
        if (!cached && resolvedAuthorId) {
          cached = await preloadProfileData({ userId: resolvedAuthorId });
        }

        if (cached?.username && mounted) setResolvedUsername(cached.username);

        const local = cached?.avatar_local || null;
        if (local && mounted) {
          setAvatarForHeader(local);
          return;
        }

        const disk = await cacheImageToDisk(current);
        if (disk && mounted) setAvatarForHeader(disk);
        else if (mounted) setAvatarForHeader(current);
      } catch {
        if (mounted) setAvatarForHeader(userPicUri || fallbackAvatar);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userPicUri, fallbackAvatar, resolvedAuthorId, displayUsername]);

  /* ---------- MEDIA ARRAY ---------- */
  const rawMedia =
    postMediaUri ?? basePost.postmediauri ?? props.postmediauri ?? [];
  const mediaArr = toArray(rawMedia)
    .filter(Boolean)
    .map(String)
    .filter((m) => !isHeic(m));

  const rawHint =
    postMediaUriHint ?? basePost.postmediauri ?? props.postmediauri ?? [];
  const hintArr = toArray(rawHint).filter(Boolean).map(String);

  const mediaRef = useRef(mediaArr);
  const hintRef = useRef(hintArr);
  const media = mediaRef.current;
  const mediaHint = hintRef.current;

  /* ---------- MEDIA DIMENSIONS ---------- */
  const windowWidth = Dimensions.get("window").width;
  const [containerW, setContainerW] = useState(windowWidth);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef(null);
  const [mediaDims, setMediaDims] = useState([]);

  useEffect(() => {
    if (!media.length) return;
    media.forEach((m, index) => {
      const hint = mediaHint[index] || m;
      if (!m || isVideoUrl(hint) || isVideoUrl(m)) return;
      if (!isHttp(m) && !String(m).startsWith("file://")) return;

      // Use session-level cache to avoid re-fetching dimensions on every mount/unmount
      if (_dimCache[m]) {
        setMediaDims((prev) => {
          const next = [...prev];
          if (next[index]?.width && next[index]?.height) return prev;
          next[index] = _dimCache[m];
          return next;
        });
        return;
      }

      const doneSize = trackRequest(`Post.Image.getSize idx=${index}`);
      Image.getSize(
        m,
        (width, height) => {
          doneSize();
          _dimCache[m] = { width, height };
          setMediaDims((prev) => {
            const next = [...prev];
            if (next[index]?.width && next[index]?.height) return prev;
            next[index] = { width, height };
            return next;
          });
        },
        () => { doneSize(); }
      );
    });
  }, []); // once

  const onLayoutContainer = (e) => {
    const w = e.nativeEvent.layout.width;
    if (w && w !== containerW) setContainerW(w);
  };

  const onScrollEnd = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    const viewportW =
      containerW || e.nativeEvent.layoutMeasurement?.width || windowWidth;
    const i = Math.round(x / viewportW);
    setCurrentIndex(i);
  };

  const computeHeightForIndex = (idx) => {
    const dim = mediaDims[idx];
    const baseW = containerW || windowWidth;
    if (dim && dim.width > 0 && dim.height > 0 && baseW && baseW > 0) {
      const ratio = dim.height / dim.width;
      let h = baseW * ratio;
      if (h < MIN_MEDIA_HEIGHT) h = MIN_MEDIA_HEIGHT;
      if (h > MAX_MEDIA_HEIGHT) h = MAX_MEDIA_HEIGHT;
      return h;
    }
    return DEFAULT_MEDIA_HEIGHT;
  };

  const slideWidth = containerW || windowWidth;
  const currentHeight = computeHeightForIndex(currentIndex);

  /* ---------- menus / modals, auth, etc. ---------- */
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSuccessOpen, setReportSuccessOpen] = useState(false);

  const [shareVisible, setShareVisible] = useState(false);
  const [buyVisible, setBuyVisible] = useState(false);
  const [joinPendingModal, setJoinPendingModal] = useState(false);

  // Translation
  const [translated, setTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translatedCaption, setTranslatedCaption] = useState("");

  const [authUserId, setAuthUserId] = useState(null);
  const [authUsername, setAuthUsername] = useState(null);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const auth = await getAuthCached();
        if (!mounted || !auth) return;
        setAuthUserId(auth.uid);
        setAuthUsername(auth.username);
        setIsVerified(auth.isVerified);

        // Track ad view — once per session, skip own posts
        const postTypeStr = String(props.type || basePost.type || "").toLowerCase();
        const postAuthor = String(displayUser || "").toLowerCase();
        const myUser = String(auth.username || "").toLowerCase();
        if (
          postTypeStr === "ad" &&
          effectivePostId &&
          myUser &&
          postAuthor &&
          postAuthor !== myUser &&
          !_adViewsTracked.has(effectivePostId)
        ) {
          _adViewsTracked.add(effectivePostId);
          supabase.from("ad_views")
            .insert({ post_id: effectivePostId, viewer_id: auth.uid })
            .then(({ error: viewErr }) => {
              if (!viewErr) {
                supabase.rpc("increment_ad_stat", { p_post_id: effectivePostId, p_field: "views" })
                  .then(({ error }) => { if (error) console.warn("[Post] increment views error:", error.message); else console.log("[Post] view tracked:", effectivePostId); })
                  .catch((e) => console.warn("[Post] increment views catch:", e?.message));
              } else if (viewErr.code === "23505") {
                console.log("[Post] view already counted:", effectivePostId);
              } else {
                console.warn("[Post] ad_views insert error:", viewErr.message);
              }
            })
            .catch((e) => console.warn("[Post] ad_views insert catch:", e?.message));
        }
      } catch {
        if (mounted) {
          setAuthUsername(null);
          setIsVerified(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const canDelete = !!(
    canDeleteOverride ||
    // Moderator account can delete any post
    authUsername?.toLowerCase() === "alba_mod" ||
    // UUID comparison — immune to username changes
    (authUserId && resolvedAuthorId && authUserId === resolvedAuthorId) ||
    // Fallback for old posts without author_id
    (!resolvedAuthorId &&
      authUsername &&
      (displayUser || basePost.user) &&
      String(authUsername).toLowerCase() ===
        String(displayUser || basePost.user).toLowerCase())
  );

  const [saved, setSaved] = useState(initialSaved);
  useEffect(() => setSaved(initialSaved), [initialSaved]);

  const handleSavePress = () => {
    const next = !saved;
    setSaved(next);
    onToggleSave?.(effectivePostId, next);
  };

  const openProfile = async () => {
    const uname = resolvedUsername || stripAt(displayUser || "");
    try {
      if (resolvedAuthorId) await preloadProfileData({ userId: resolvedAuthorId });
      else if (uname) await preloadProfileData({ username: uname });
    } catch {}
    navigation.navigate("Profile", { username: uname });
  };

  /* ---------- JOIN GROUP + EVENT UNCONFIRMED ---------- */
  const joinGroupAndOpenChat = async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error("Not authenticated");

      // Fresh verification check — don't rely on cached state
      const { data: verCheck } = await supabase
        .from("profiles")
        .select("is_verified")
        .eq("id", uid)
        .maybeSingle();
      if (!verCheck?.is_verified) {
        navigation.navigate("PreFaceRecognition");
        return;
      }

      let myUname = authUsername;
      if (!myUname) {
        const { data: prof, error: pErr } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", uid)
          .maybeSingle();
        if (pErr) throw pErr;
        myUname = prof?.username || null;
        setAuthUsername(myUname);
      }
      if (!myUname) throw new Error("Missing username");

      const desiredName = String(groupNameProp || title || basePost.title || "Group");

      // 1) find group row
      let groupRow = null;

      if (groupIdProp) {
        const { data: g, error } = await supabase
          .from("groups")
          .select("id, groupname, members, group_pic_link, require_approval, pending_members")
          .eq("id", groupIdProp)
          .maybeSingle();
        if (error) throw error;
        groupRow = g;
      } else {
        const { data: g, error } = await supabase
          .from("groups")
          .select("id, groupname, members, group_pic_link, require_approval, pending_members")
          .eq("groupname", desiredName)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        groupRow = g;
      }

      if (!groupRow?.id) throw new Error(`Group not found for "${desiredName}"`);

      const currentMembers = Array.isArray(groupRow.members) ? groupRow.members : [];
      const alreadyMember = currentMembers.some(
        (m) => String(m).toLowerCase() === myUname.toLowerCase()
      );

      // Check if already pending
      const currentPending = Array.isArray(groupRow.pending_members) ? groupRow.pending_members : [];
      const alreadyPending = currentPending.some(
        (m) => String(m).toLowerCase() === myUname.toLowerCase()
      );

      if (!alreadyMember) {
        // If group requires approval, add to pending instead of members
        if (groupRow.require_approval) {
          if (!alreadyPending) {
            const { error: pendingErr } = await supabase.rpc("request_to_join_group", {
              p_group_id: groupRow.id,
              p_username: myUname,
            });
            if (pendingErr) console.warn("[Post] request_to_join_group error:", pendingErr.message);
            else console.log("[Post] join request sent:", myUname, "→", groupRow.id);
          }
          setJoinPendingModal(true);
          return;
        }

        // 2) add to groups.members (via RPC if you have it)
        {
          const { error: addErr } = await supabase.rpc("add_member_to_group", {
            gid: groupRow.id,
            uname: myUname,
          });
          if (addErr) {
            const next = uniqCI([...currentMembers, myUname]);
            const { error: upErr } = await supabase
              .from("groups")
              .update({ members: next })
              .eq("id", groupRow.id);
            if (upErr) throw upErr;
          }
        }

        // 3) add to events.unconfirmed only if user doesn't already have a ticket
        if (effectivePostId) {
          try {
            const { data: evRow } = await supabase
              .from("events")
              .select("ticket_holders")
              .eq("post_id", effectivePostId)
              .maybeSingle();
            const holders = Array.isArray(evRow?.ticket_holders) ? evRow.ticket_holders : [];
            const alreadyHasTicket = holders.some(
              (h) => String(h).toLowerCase() === myUname.toLowerCase()
            );
            if (!alreadyHasTicket) {
              const { error: upU } = await supabase.rpc("add_to_unconfirmed", {
                p_post_id: effectivePostId,
                p_username: myUname,
              });
              if (upU) console.warn("[Post join] add_to_unconfirmed error:", upU.message);
            }
          } catch (e) {
            console.warn("[Post join] events.unconfirmed update failed:", e?.message || e);
          }
        }

        // 4) system message
        const now = new Date();
        const sent_date = now.toISOString().slice(0, 10);
        const sent_time = now.toTimeString().slice(0, 8);

        await supabase.from("messages").insert({
          sender_id: uid,
          chat_id: groupRow.id,
          is_group: true,
          sender_username: myUname,
          content: `You joined ${groupRow.groupname || desiredName}.`,
          media_reference: null,
          post_id: null,
          sent_date,
          sent_time,
        });
      }

      const mergedMembers = Array.isArray(groupRow.members) ? groupRow.members : [];
      const finalMembers = uniqCI([...mergedMembers, myUname]);

      posthog.capture('event_group_chat_joined', { group_id: groupRow.id, group_name: groupRow.groupname || desiredName });
      navigation.navigate("GroupChat", {
        groupId: groupRow.id,
        groupName: groupRow.groupname || desiredName,
        members: groupMembers || finalMembers,
        groupAvatarUri: groupRow.group_pic_link || null,
        myUsername: myUname,
      });
    } catch (e) {
      console.warn("[joinGroupAndOpenChat] error:", e);
      Alert.alert("Couldn’t join group", e?.message || "Please try again.");
    }
  };

  /* ---------- translation ---------- */
  const handleTranslate = async () => {
    if (translated) {
      setTranslated(false);
      return;
    }
    const src = description || basePost.description || "";
    if (!src) return;
    setTranslating(true);
    try {
      const result = await translateText(src, language);
      setTranslatedCaption(result);
      setTranslated(true);
    } catch {
      setTranslated(false);
    } finally {
      setTranslating(false);
    }
  };

  /* ---------- caption ---------- */
  const captionText = translated && translatedCaption
    ? translatedCaption
    : (description || basePost.description || "");
  const [showFullCaption, setShowFullCaption] = useState(false);
  const [isLongCaption, setIsLongCaption] = useState(false);
  const [hasMeasuredCaption, setHasMeasuredCaption] = useState(false);

  const onMentionPress = (uname) => navigation.navigate("Profile", { username: uname });
  const parsedCaption = captionText ? parseMentionText(captionText, isDark, onMentionPress) : null;

  let captionContent = null;
  if (!captionText) captionContent = null;
  else if (!hasMeasuredCaption) {
    captionContent = (
      <ThemedText
        style={styles.description}
        onTextLayout={(e) => {
          if (!hasMeasuredCaption) {
            setHasMeasuredCaption(true);
            if (e.nativeEvent.lines.length > 1) setIsLongCaption(true);
          }
        }}
      >
        {parsedCaption}
      </ThemedText>
    );
  } else if (showFullCaption) {
    captionContent = (
      <>
        <ThemedText style={styles.description}>{parsedCaption}</ThemedText>
        {isLongCaption && (
          <ThemedText style={styles.readMoreText} onPress={() => setShowFullCaption(false)}>
            {t("caption_read_less") || "Read less"}
          </ThemedText>
        )}
      </>
    );
  } else {
    captionContent = (
      <>
        <ThemedText style={styles.description} numberOfLines={1} ellipsizeMode="tail">
          {parsedCaption}
        </ThemedText>
        {isLongCaption && (
          <ThemedText style={styles.readMoreText} onPress={() => setShowFullCaption(true)}>
            {t("caption_read_more")}
          </ThemedText>
        )}
      </>
    );
  }

  /* ---------- actions & CTAs ---------- */
  const rawActions = (actions || basePost.actions || []).filter(Boolean);
  const hasSaveAction = rawActions.some((a) => normalizeAction(a) === "save");

  const ctas = rawActions
    .filter((raw) => {
      const key = normalizeAction(raw);
      if (!key) return false;
      if (key === "save") return false;
      if (HIDE_FROM_CTA.has(key)) return false;
      return true;
    })
    .slice(0, 4)
    .map((raw, i) => {
      const key = normalizeAction(raw);
      const conf = key ? ACTIONS[key] : null;
      const text = conf ? t(conf.i18nKey) || conf.text : String(raw);

      const legacyIcon = actionIconPaths?.[i];
      const icon = conf?.icon
        ? conf.icon
        : typeof legacyIcon === "string"
        ? { uri: legacyIcon }
        : legacyIcon || null;

      const bg = conf?.color || colors?.[i] || undefined;

      let onPress;

      if (key === "join_chat") {
        onPress = joinGroupAndOpenChat;
      } else if (key === "share") {
        onPress = onPressShare ? onPressShare : () => setShareVisible(true);
      } else if (key === "tickets" || key === "buy") {
        onPress = onPressBuy || (() => setBuyVisible(true));
      } else if (key === "message") {
        const goToDm = () => {
          const target = stripAt(displayUser || "");
          if (!target) return;
          navigation.navigate("SingleChat", {
            chat: target,
            isGroup: false,
            peerName: target,
            myUsername: authUsername || "me",
          });
        };
        onPress = () => {
          if (!isVerified) {
            navigation.navigate("PreFaceRecognition");
            return;
          }
          // Track contact for ad posts
          const postTypeStr = String(props.type || basePost.type || "").toLowerCase();
          if (postTypeStr === "ad" && effectivePostId) {
            supabase.rpc("increment_ad_stat", { p_post_id: effectivePostId, p_field: "contacts" })
              .then(({ error }) => { if (error) console.warn("[Post] increment contacts error:", error.message); else console.log("[Post] contact tracked:", effectivePostId); })
              .catch((e) => console.warn("[Post] increment contacts catch:", e?.message));
            supabase.auth.getUser().then(({ data: authData }) => {
              const cid = authData?.user?.id;
              if (!cid) { console.warn("[Post] contact upsert skipped — no user id"); return; }
              supabase.from("profiles").select("username, avatar_url").eq("id", cid).maybeSingle()
                .then(({ data: prof }) => {
                  supabase.from("ad_contacts").insert({
                    post_id: effectivePostId,
                    contacter_id: cid,
                    contacter_username: prof?.username || null,
                    contacter_avatar: prof?.avatar_url || null,
                  }).then(({ error }) => {
                    if (error && error.code !== "23505") console.warn("[Post] ad_contacts insert error:", error.message);
                    else console.log("[Post] ad_contacts insert ok");
                  }).catch((e) => console.warn("[Post] ad_contacts insert catch:", e?.message));
                }).catch((e) => console.warn("[Post] profiles fetch catch:", e?.message));
            }).catch((e) => console.warn("[Post] getUser catch:", e?.message));
          }
          posthog.capture('message_seller_tapped', { post_id: postId });
          if (onPressMessage) onPressMessage();
          else goToDm();
        };
      }

      return { key: key || `custom-${i}`, text, icon, bg, onPress };
    });

  const runDelete = async () => {
    if (!effectivePostId) {
      setConfirmOpen(false);
      return;
    }
    try {
      setDeleting(true);
      const { error } = await supabase.from("posts").delete().eq("id", effectivePostId);
      if (error) throw error;
      onDeleted?.(effectivePostId);
    } catch (e) {
      console.warn("Delete failed:", e?.message || e);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  // ✅ NEW subtitle logic
  const isEventPost =
    !!(props.is_event ?? basePost.is_event) ||
    String(props.post_type ?? basePost.post_type ?? props.type ?? basePost.type ?? "")
      .toLowerCase()
      .includes("event") ||
    String(labelTag || "").toLowerCase().includes("event");

  const rawDate = props.date || basePost.date;
  const rawTime = props.time || basePost.time;
  const rawLocation = props.location || basePost.location;
  const rawEndDate = props.end_date || basePost.end_date;
  const rawEndTime = props.end_time || basePost.end_time;

  const prettyTime = rawTime ? normalizeTime(rawTime) : null;
  const prettyEndTime = rawEndTime ? normalizeTime(rawEndTime) : null;

  // Date range: "14 Mar to 19 Mar" — year only if start/end differ
  const prettyDateRange = (() => {
    if (!rawDate) return null;
    const startYear = rawDate.slice(0, 4);
    const endYear = rawEndDate ? rawEndDate.slice(0, 4) : null;
    const showYear = endYear && startYear !== endYear;
    const fmt = (d, withYear) =>
      new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
        day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
      });
    const startStr = fmt(rawDate, false);
    if (rawEndDate) {
      const endStr = fmt(rawEndDate, showYear);
      return `${startStr} to ${endStr}`;
    }
    return startStr;
  })();

  const timeRange = prettyTime && prettyEndTime
    ? `${prettyTime} to ${prettyEndTime}`
    : prettyTime || prettyEndTime || null;

  const subtitle = isEventPost
    ? [prettyDateRange, timeRange, rawLocation].filter(Boolean).join(", ")
    : [rawLocation].filter(Boolean).join(", ");

  return (
    <ThemedView style={[styles.card, { backgroundColor: isDark ? "#222222" : "#FFFFFF" }]}>
      {labelTag && (
        <ThemedView
          style={[styles.postLabelChip, { backgroundColor: labelColor || "#2F91FF" }]}
        >
          <ThemedText style={styles.postLabelText}>{labelTag}</ThemedText>
        </ThemedView>
      )}

      <View style={styles.headerRow}>
        <TouchableOpacity onPress={openProfile} activeOpacity={0.8}>
          <Image
            source={toImageSource(avatarForHeader || userPicUri || fallbackAvatar)}
            style={styles.avatar}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <TouchableOpacity onPress={openProfile} activeOpacity={0.7}>
            <ThemedText style={styles.handleLine}>@{resolvedUsername || displayUser}</ThemedText>
          </TouchableOpacity>
          {(isEventPost ? (prettyDateRange || timeRange || rawLocation) : rawLocation) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" }}>
              {isEventPost && (prettyDateRange || timeRange) && (
                <ThemedText style={styles.subtitle}>
                  {[prettyDateRange, timeRange].filter(Boolean).join(", ")}{rawLocation ? ",\u00A0" : ""}
                </ThemedText>
              )}
              {!!rawLocation && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    const q = encodeURIComponent(rawLocation);
                    const url = Platform.OS === "ios" ? `maps://0,0?q=${q}` : `geo:0,0?q=${q}`;
                    Linking.openURL(url).catch(() =>
                      Linking.openURL(`https://maps.google.com/?q=${q}`)
                    );
                  }}
                >
                  <ThemedText style={[styles.subtitle, { color: isDark ? "#AAAAAA" : "#0D2B6B" }]}>{rawLocation}</ThemedText>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Translate icon */}
        {!!(description || basePost.description) && (
          <TouchableOpacity
            style={[styles.kebabBtn, { marginRight: 4 }]}
            onPress={handleTranslate}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
            disabled={translating}
          >
            {translating
              ? <ActivityIndicator size="small" color="#59A7FF" />
              : <MaterialCommunityIcons name="translate" size={18} color={translated ? "#59A7FF" : (isDark ? "#FFFFFF" : "#111111")} />
            }
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.kebabBtn}
          onPress={() => setMenuOpen((v) => !v)}
          hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
        >
          <Feather
            name="more-vertical"
            size={20}
            color={isDark ? "#FFFFFF" : "#111111"}
          />
        </TouchableOpacity>
      </View>

      {!!(title || basePost.title) && (
        <ThemedText style={styles.title}>
          {parseMentionText(title || basePost.title, isDark, (uname) => navigation.navigate("Profile", { username: uname }))}
        </ThemedText>
      )}
      {captionContent}

      {media.length > 0 && (
        <ThemedView onLayout={onLayoutContainer} style={[styles.carouselWrap, { height: currentHeight }]}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            snapToInterval={slideWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            style={{ width: slideWidth }}
          >
            {media.map((m, i) => {
              const hint = mediaHint[i] || m;
              const isVid = isVideoUrl(hint) || isVideoUrl(m);

              return isVid ? (
                <VideoSlide
                  key={`${m}-${i}`}
                  uri={m}
                  width={slideWidth}
                  height={currentHeight}
                  index={i}
                  autoPlay={isActive && i === currentIndex}
                />
              ) : (
                <ImageSlide key={`${m}-${i}`} uri={m} width={slideWidth} height={currentHeight} index={i} />
              );
            })}
          </ScrollView>

          {media.length > 1 && (
            <ThemedView style={styles.dots}>
              {media.map((_, i) => (
                <ThemedView key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
              ))}
            </ThemedView>
          )}
        </ThemedView>
      )}

      {ctas.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ctaScroll}>
          {ctas.map((cta, i) => (
            <TouchableOpacity
              key={`${cta.key}-${i}`}
              onPress={cta.onPress}
              activeOpacity={0.85}
              style={[
                styles.ctaButton,
                cta.bg ? { backgroundColor: cta.bg } : null,
                i === ctas.length - 1 ? { marginRight: 0 } : null,
              ]}
            >
              {cta.icon && <Image source={cta.icon} style={styles.ctaIcon} resizeMode="contain" />}
              <ThemedText style={styles.ctaLabel} numberOfLines={1} ellipsizeMode="tail">
                {cta.text}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        onSend={() => setShareVisible(false)}
        postId={effectivePostId}
        isVideo={(props.type || basePost.type || "") === "feedPost"}
        thumbnailUrl={basePost.thumbnail_url || hintArr.find((u) => u && !isVideoUrl(u)) || null}
      />
      <BuyModal visible={buyVisible} onClose={() => setBuyVisible(false)} postId={effectivePostId} />

      {joinPendingModal && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setJoinPendingModal(false)}>
          <View style={styles.menuBackdrop}>
            <ThemedView style={[styles.menuCard, { backgroundColor: isDark ? "#2a2a2a" : "#fff", padding: 24, margin: 32, borderRadius: 16 }]}>
              <ThemedText style={{ fontWeight: "700", fontSize: 16, marginBottom: 8 }}>Approval required</ThemedText>
              <ThemedText style={{ fontSize: 14, marginBottom: 20, lineHeight: 20 }}>
                Joining this group requires admin approval. Your request has been sent.
              </ThemedText>
              <TouchableOpacity
                style={{ backgroundColor: "#3D8BFF", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
                onPress={() => setJoinPendingModal(false)}
              >
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>OK</ThemedText>
              </TouchableOpacity>
            </ThemedView>
          </View>
        </Modal>
      )}

      {menuOpen && (
        <View style={styles.menuRoot}>
          <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <ThemedView style={[styles.menuCard, { backgroundColor: isDark ? "#333333" : "#FFFFFF" }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                if (props.onReport) {
                  props.onReport(effectivePostId);
                } else {
                  setReportText("");
                  setReportOpen(true);
                }
              }}
            >
              <Feather
                name="alert-triangle"
                size={16}
                color={isDark ? "#FFFFFF" : "#333333"}
                style={{ marginRight: 8 }}
              />
              <ThemedText style={styles.menuText}>{t("menu_report")}</ThemedText>
            </TouchableOpacity>

            {hasSaveAction && (
              <TouchableOpacity style={styles.menuItem} onPress={handleSavePress}>
                <Ionicons
                  name={saved ? "bookmark" : "bookmark-outline"}
                  size={16}
                  color={isDark ? "#FFFFFF" : "#333333"}
                  style={{ marginRight: 8 }}
                />
                <ThemedText style={styles.menuText}>
                  {saved ? t("menu_saved") : t("menu_save")}
                </ThemedText>
              </TouchableOpacity>
            )}

            {canDelete && <ThemedView style={styles.menuDivider} />}

            {canDelete && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  navigation.navigate("CreatePost", {
                    editPost: {
                      id: effectivePostId,
                      title: title || basePost.title || "",
                      description: description || basePost.description || "",
                      type: props.type || basePost.type || "",
                      date: rawDate || null,
                      time: rawTime || null,
                      endDate: rawEndDate || null,
                      endTime: rawEndTime || null,
                      location: rawLocation || null,
                      mediaUrls: mediaArr,
                    },
                  });
                }}
              >
                <Feather name="edit-2" size={16} color={isDark ? "#FFFFFF" : "#333333"} style={{ marginRight: 8 }} />
                <ThemedText style={styles.menuText}>{t("menu_edit") || "Edit"}</ThemedText>
              </TouchableOpacity>
            )}

            {canDelete && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
              >
                <Feather name="x" size={16} color="#d23b3b" style={{ marginRight: 8 }} />
                <ThemedText style={[styles.menuText, { color: "#d23b3b" }]}>{t("menu_delete")}</ThemedText>
              </TouchableOpacity>
            )}
          </ThemedView>
        </View>
      )}

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.reportOverlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportCardTitle}>{t("menu_report") || "Report post"}</Text>
            <TextInput
              style={styles.reportCardInput}
              placeholder={t("report_group_placeholder") || "Tell us briefly what is wrong"}
              placeholderTextColor="#9CA3AF"
              value={reportText}
              onChangeText={setReportText}
              multiline
              maxLength={300}
            />
            <View style={styles.reportCardRow}>
              <TouchableOpacity
                style={[styles.reportCardBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setReportOpen(false)}
              >
                <Text style={styles.reportCardBtnText}>{t("confirm_no") || "Cancel"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportCardBtn, { backgroundColor: "#3D8BFF", opacity: reportText.trim() && !reportSending ? 1 : 0.6 }]}
                disabled={!reportText.trim() || reportSending}
                onPress={async () => {
                  setReportSending(true);
                  try {
                    const { data: auth } = await supabase.auth.getUser();
                    const reporterId = auth?.user?.id || null;
                    await supabase.from("reports").insert({
                      post_id: effectivePostId,
                      reported_by: reporterId,
                      reason: reportText.trim() || null,
                    });
                    // Notify poster via DM and email
                    supabase.functions.invoke("send-report", {
                      body: {
                        type: "community_post",
                        reported_by_id: reporterId,
                        post_id: effectivePostId,
                        poster_user_id: resolvedAuthorId,
                        reason: reportText.trim(),
                      },
                    }).catch(() => {});
                  } catch {}
                  setReportSending(false);
                  setReportOpen(false);
                  setReportSuccessOpen(true);
                }}
              >
                {reportSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.reportCardBtnText}>{t("confirm_yes") || "OK"}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={reportSuccessOpen} transparent animationType="fade" onRequestClose={() => setReportSuccessOpen(false)}>
        <View style={styles.reportOverlay}>
          <View style={styles.reportCard}>
            <Text style={[styles.reportCardTitle, { marginBottom: 6 }]}>
              {t("group_report_success") || "Thanks for your report."}
            </Text>
            <Text style={{ fontFamily: "Poppins", fontSize: 13, color: "#6B7280", marginBottom: 16, textAlign: "center" }}>
              {t("report_sent_body") || "We'll review it and take action if it goes against our guidelines."}
            </Text>
            <TouchableOpacity
              style={[styles.reportCardBtn, { backgroundColor: "#3D8BFF", alignSelf: "stretch" }]}
              onPress={() => setReportSuccessOpen(false)}
            >
              <Text style={styles.reportCardBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <ThemedView style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalOverlayTouch} activeOpacity={1} onPress={() => setConfirmOpen(false)} />
          <ThemedView style={[styles.confirmCard, { backgroundColor: isDark ? "#333333" : "#FFFFFF" }]}>
            <ThemedText style={styles.confirmTitle}>{t("confirm_delete_title")}</ThemedText>
            <ThemedView style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.confirmBtnText}>{t("confirm_yes")}</ThemedText>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]} onPress={() => setConfirmOpen(false)}>
                <ThemedText style={styles.confirmBtnText}>{t("confirm_no")}</ThemedText>
              </TouchableOpacity>
            </ThemedView>
          </ThemedView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  card: { borderRadius: 10, marginBottom: 8, marginTop: 8, overflow: "visible" },

  postLabelChip: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
    marginHorizontal: 10,
    marginBottom: 4,
  },
  postLabelText: { fontSize: 12, color: "#fff", fontFamily: "PoppinsBold" },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, paddingLeft: 10, paddingRight: 10, paddingTop: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10, backgroundColor: "#18314f" },
  handleLine: { fontSize: 14, fontFamily: "PoppinsBold" },
  subtitle: { fontSize: 12, fontFamily: "Poppins" },

  title: { fontSize: 18, marginBottom: 8, fontFamily: "PoppinsBold", paddingLeft: 10, paddingRight: 10 },
  description: { fontSize: 14, marginBottom: 4, fontFamily: "Poppins", paddingLeft: 10, paddingRight: 10 },
  readMoreText: { fontSize: 12, fontFamily: "PoppinsBold", paddingLeft: 10, paddingRight: 10, marginBottom: 8 },

  carouselWrap: { width: "100%", overflow: "hidden", marginBottom: 12 },
  mediaItem: { width: "100%", height: "100%" },
  dots: { position: "absolute", bottom: 8, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.15)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)" },
  dotActive: { backgroundColor: "#fff" },

  ctaScroll: { paddingTop: 6, paddingRight: 4, padding: 10 },
  ctaButton: { height: 40, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, marginRight: 8, overflow: "hidden", flexShrink: 0 },
  ctaIcon: { width: 16, height: 16, marginRight: 6 },
  ctaLabel: { color: "#FFFFFF", fontSize: 14, fontFamily: "Poppins" },

  kebabBtn: { paddingHorizontal: 6, paddingVertical: 4, marginLeft: 6, alignItems: "center", justifyContent: "center" },

  menuRoot: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 12 },
  menuBackdrop: { ...RNStyleSheet.absoluteFillObject, backgroundColor: "transparent" },
  menuCard: { position: "absolute", top: 6, right: 6, borderRadius: 10, paddingVertical: 6, minWidth: 180, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 14 },
  menuItem: { paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
  menuText: { fontFamily: "Poppins", fontSize: 14 },
  menuDivider: { height: 1, backgroundColor: "#eceff3", marginVertical: 2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" },
  modalOverlayTouch: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  confirmCard: { width: "82%", borderRadius: 14, padding: 16, alignItems: "center" },
  confirmTitle: { fontFamily: "Poppins", fontSize: 16, textAlign: "center", marginBottom: 14 },
  confirmRow: { flexDirection: "row", gap: 10, width: "100%" },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },

  muteButton: { position: "absolute", right: 10, bottom: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center" },
  reportInput: { borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 12 },
  reportOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  reportCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  reportCardTitle: { fontFamily: "Poppins", fontSize: 16, marginBottom: 10, textAlign: "center" },
  reportCardInput: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, minHeight: 80, paddingHorizontal: 10, paddingVertical: 8, fontFamily: "Poppins", fontSize: 14, textAlignVertical: "top", marginBottom: 12 },
  reportCardRow: { flexDirection: "row", gap: 10 },
  reportCardBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  reportCardBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
});
