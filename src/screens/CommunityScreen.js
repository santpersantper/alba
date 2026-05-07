// screens/CommunityScreen.js — DROP-IN (FIX: await location update BEFORE nearby_posts RPC + force fresh coords)
// Root cause: you were updating profiles.location WITHOUT awaiting it, so nearby_posts often ran using the OLD profile location.
// Also: avoid stale getLastKnownPositionAsync (Villa Gesell) by only trusting it if very recent.

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  Animated,
  AppState,
  View,
  StyleSheet,
  Alert,
  Text,
  TouchableOpacity,
  Platform,
  FlatList,
  TextInput,
  Modal,
  Linking,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import { useFonts } from "expo-font";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Feather, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { useUserPreferences, PREFS_KEY } from "../hooks/useUserPreferences";
import Post from "../components/Post";
import TopBar from "../components/TopBar";
import LabelsCard from "../components/LabelsCard";
import OnboardingOverlay from "../components/OnboardingOverlay";

import {
  readCachedFirstPostOverride,
  warmCommunityFirstPost,
} from "../lib/communityFirstPostCache";
import { posthog } from "../lib/analytics";

/* --------------------------- CONSTANTS ---------------------------- */

const DEFAULT_RADIUS_KM = 50;
const VISIBLE_TYPES = new Set(["Event", "Ad", "Article"]);

const BASE_LABELS = [
  "Parties",
  "Sports",
  "Music",
  "Health",
  "Movies",
  "Science & Tech",
];

const LABEL_COLORS = ["#78C0E9", "#5BC4B8", "#7DB0FF", "#6BCB77", "#87A8FF", "#3D8BFF"];

// Expands each label into a richer semantic query so the embedding model has more
// signal than a single word. User-defined labels fall back to the label name alone.
const LABEL_EXPANSIONS: Record<string, string> = {
  "Parties": "party celebration nightlife drinking social gathering birthday anniversary get-together bar club dance",
  "Sports": "sports match game athletics fitness workout gym running cycling swimming football tennis basketball competition tournament outdoor activity",
  "Music": "music concert live performance band DJ festival gig show singing instrument entertainment stage",
  "Health": "health wellness fitness yoga meditation mindfulness nutrition mental health therapy workshop well-being self-care exercise pilates",
  "Movies": "movie film cinema screening documentary short film festival preview premiere director actor screening room",
  "Science & Tech": "technology science innovation startup coding programming developer AI machine learning software engineering hackathon STEM workshop",
};

const asAt = (s) => String(s || "").replace(/^@+/, "");

const formatSearchDate = (dateStr) => {
  if (!dateStr) return "";
  const parts = String(dateStr).slice(0, 10).split("-");
  if (parts.length !== 3) return String(dateStr).slice(0, 10);
  const [year, month, day] = parts.map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const withTimeout = async (promise, ms) => {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
};

/* --------------------------- LOCATION HELPERS ---------------------------- */

const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000; // only trust last-known if <= 2 min old

// Returns { ...coords, mocked } or null. `mocked` is true on Android when a
// fake GPS provider is active — reliable signal of location spoofing.
const getFreshCoords = async () => {
  // 1) last-known (only if recent)
  try {
    const last = await Location.getLastKnownPositionAsync();
    const ts = last?.timestamp;
    const coords = last?.coords;
    if (
      coords?.latitude != null &&
      coords?.longitude != null &&
      typeof ts === "number" &&
      Date.now() - ts <= LAST_KNOWN_MAX_AGE_MS
    ) {
      return { ...coords, mocked: last.mocked ?? false };
    }
  } catch {}

  // 2) current position (best effort)
  try {
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      6500
    );
    if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
      return { ...pos.coords, mocked: pos.mocked ?? false };
    }
  } catch {}

  // 3) low accuracy fallback (sometimes succeeds when balanced times out)
  try {
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      }),
      6500
    );
    if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
      return { ...pos.coords, mocked: pos.mocked ?? false };
    }
  } catch {}

  return null;
};

/* ---------------------------------------------------------------------- */

export default function CommunityScreen() {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();
  const { t, language } = useAlbaLanguage();

  const topBarOpacity = useRef(new Animated.Value(1)).current;
  const lastOffset = useRef(0);
  const animationState = useRef("shown");

  const fadeTopAndBottomBars = (toValue) => {
    const effective = lastOffset.current <= 0 ? "shown" : toValue;
    if (animationState.current === effective) return;

    animationState.current = effective;

    topBarOpacity.stopAnimation();
    Animated.timing(topBarOpacity, {
      toValue: effective === "shown" ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();

    navigation.setParams({
      bottomBarVisible: effective === "shown",
    });
  };

  const handleScroll = ({ nativeEvent }) => {
    const currentOffset = nativeEvent.contentOffset.y;
    const diff = currentOffset - lastOffset.current;
    if (Math.abs(diff) >= 12) {
      fadeTopAndBottomBars(diff > 0 ? "hidden" : "shown");
      lastOffset.current = currentOffset;
    }
  };

  const [topActiveTab, setTopActiveTab] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [uid, setUid] = useState(null);
  const [savedMeta, setSavedMeta] = useState({});
  const [communityRadiusM, setCommunityRadiusM] = useState(DEFAULT_RADIUS_KM * 1000);
  const [userLat, setUserLat] = useState(null);
  const [userLon, setUserLon] = useState(null);

  const { prefs, reload: reloadPrefs } = useUserPreferences();
  const [travelBannerDismissed, setTravelBannerDismissed] = useState(false);

  const [eventTags, setEventTags] = useState([]);
  const [adTags, setAdTags] = useState([]);
  const [showLocalNews, setShowLocalNews] = useState(true);

  const [labels, setLabels] = useState(BASE_LABELS);
  const [activeLabels, setActiveLabels] = useState([]);
  const labelExpansionCache = useRef({}); // session cache: label → expansion string
  const perLabelResultsRef = useRef(new Map()); // label → [{id, similarity}] — cached search results
  const postLabelMapRef = useRef(new Map()); // postId → which label matched it (for badge display)
  const [followedUserIds, setFollowedUserIds] = useState([]);
  const [followedUsernames, setFollowedUsernames] = useState([]);
  const [showFollowedPosts, setShowFollowedPosts] = useState(false);

  const [selectedDate, setSelectedDate] = useState(null);
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  const [activePostId, setActivePostId] = useState(null);

  const [communitySearchUsers, setCommunitySearchUsers] = useState([]);
  const [communitySearchPosts, setCommunitySearchPosts] = useState([]);
  const [communitySearchLoading, setCommunitySearchLoading] = useState(false);
  const [communitySearchPostsVisible, setCommunitySearchPostsVisible] = useState(2);
  const [communitySearchUsersVisible, setCommunitySearchUsersVisible] = useState(2);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState(null); // null = inactive; [{id, similarity}] = active
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [labelPosts, setLabelPosts] = useState(null); // full post records for semantic result IDs when label is active
  const [firstPostOverride, setFirstPostOverride] = useState(null);

  // Ad interest prompt — track rejected categories so we never ask again this session
  const [rejectedCategories, setRejectedCategories] = useState(new Set());

  const [spoofReason, setSpoofReason] = useState(null); // null | "mocked" | "impossible_jump" | "country_mismatch"
  const [locationDenied, setLocationDenied] = useState(false);
  const [showLocationInstructions, setShowLocationInstructions] = useState(false);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  const scrollRef = useRef(null);
  const scrollToTop = () => {
    scrollRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const loadSavedFromProfile = useCallback(async (userId) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("saved_posts, save_times")
        .eq("id", userId)
        .single();

      if (!data) {
        setSavedMeta({});
        return;
      }

      const ids = data.saved_posts ?? [];
      const times = data.save_times ?? [];
      const map = {};
      ids.forEach((id, idx) => {
        map[id] = times[idx] || new Date().toISOString();
      });

      setSavedMeta(map);
    } catch {
      setSavedMeta({});
    }
  }, []);

  const toggleSave = useCallback(
    (postId, nextSaved) => {
      if (!uid) return;
      setSavedMeta((prev) => {
        const copy = { ...prev };
        if (nextSaved) copy[postId] = new Date().toISOString();
        else delete copy[postId];

        const ids = Object.keys(copy);
        const times = ids.map((id) => copy[id]);

        supabase
          .from("profiles")
          .update({
            saved_posts: ids,
            save_times: times,
          })
          .eq("id", uid)
          .then(() => {});

        return copy;
      });
    },
    [uid]
  );

  const handlePostDeleted = useCallback((id) => {
    setPosts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handlePostHidden = useCallback((id, newHidden) => {
    if (newHidden) setPosts((prev) => prev.filter((x) => x.id !== id));
  }, []);


  const fetchNearbyPosts = useCallback(async () => {
    try {
      setLoading(true);
      setLocationDenied(false);
      setShowLocationInstructions(false);

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes?.user) throw new Error("Not authenticated");
      const userId = userRes.user.id;
      setUid(userId);

      const [, prefRes] = await Promise.all([
        loadSavedFromProfile(userId),
        supabase
          .from("profiles")
          .select("event_tags, ad_tags, show_local_news, blocked_users, followed_users, show_followed_users_posts, max_event_distance")
          .eq("id", userId)
          .maybeSingle(),
      ]);

      const pref = prefRes?.data;
      if (pref) {
        if (Array.isArray(pref.event_tags)) setEventTags(pref.event_tags);
        if (Array.isArray(pref.ad_tags)) setAdTags(pref.ad_tags);
        if (Array.isArray(pref.blocked_users))
          setBlockedUsers(pref.blocked_users);
        if (typeof pref.show_local_news === "boolean")
          setShowLocalNews(pref.show_local_news);
        const followedIds = Array.isArray(pref.followed_users) ? pref.followed_users : [];
        setFollowedUserIds(followedIds);
        const showFollowed = typeof pref.show_followed_users_posts === "boolean" ? pref.show_followed_users_posts : false;
        setShowFollowedPosts(showFollowed);

        // Build LabelsCard from DB — event_tags is source of truth so removals persist.
        // Fall back to BASE_LABELS only for first-time users (event_tags null/empty).
        const capitalize = (s) =>
          s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        const fromEventTags =
          Array.isArray(pref.event_tags) && pref.event_tags.length > 0
            ? pref.event_tags
            : null;
        const adTagsList = Array.isArray(pref.ad_tags) ? pref.ad_tags : [];
        const base = fromEventTags ?? BASE_LABELS;
        const seen = new Set(base.map((s) => s.toLowerCase()));
        const merged = [...base];
        for (const t of adTagsList) {
          const cap = capitalize(t);
          if (cap && !seen.has(cap.toLowerCase())) {
            seen.add(cap.toLowerCase());
            merged.push(cap);
          }
        }
        setLabels(merged);
      }

      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== "granted") {
          setLocationDenied(true);
          setActivePostId(null);
          return;
        }
      }

      // Read prefs fresh from AsyncStorage — the hook state on this tab screen is only
      // initialized on mount and never re-reads when another screen updates the same key.
      let freshPrefs = { premiumTravelerMode: false, travelerModeCityCoords: null };
      try {
        const raw = await AsyncStorage.getItem(PREFS_KEY);
        if (raw) freshPrefs = { ...freshPrefs, ...JSON.parse(raw) };
      } catch {}

      let latitude, longitude;
      if (freshPrefs.premiumTravelerMode && freshPrefs.travelerModeCityCoords) {
        // Traveler Mode: use selected city coords instead of real device location
        latitude = freshPrefs.travelerModeCityCoords.lat;
        longitude = freshPrefs.travelerModeCityCoords.lng;
      } else {
        const coords = await getFreshCoords();
        if (!coords) {
          setActivePostId(null);
          return;
        }

        // ── Check 1: Android mock location flag (device-level, most reliable) ──
        if (coords.mocked) {
          setSpoofReason("mocked");
          setActivePostId(null);
          return;
        }

        ({ latitude, longitude } = coords);
      }

      setUserLat(latitude);
      setUserLon(longitude);

      // ✅ IMPORTANT FIX: await the profile location update so nearby_posts uses the NEW location
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          location: `SRID=4326;POINT(${longitude} ${latitude})`,
          location_updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (upErr) {
      }

      // ── Checks 2 & 3: impossible jump + IP vs GPS country (server-side, async) ──
      // Run after DB update so the jump check can compare against the previous stored location.
      supabase.functions.invoke("check-location", {
        body: { latitude, longitude },
      }).then(({ data }) => {
        if (data?.spoofed) {
          setSpoofReason(data.reason);
        }
      }).catch(() => {}); // fail open — don't block on network error

      const { trackRequest } = require("../lib/requestTracker");
      const radiusM = (typeof pref?.max_event_distance === "number" && pref.max_event_distance > 0)
        ? pref.max_event_distance
        : DEFAULT_RADIUS_KM * 1000;
      setCommunityRadiusM(radiusM);
      const _doneNearby = trackRequest(`Community.nearby_posts radius=${radiusM / 1000}km`);
      const { data, error: rpcErr } = await withTimeout(
        supabase.rpc("nearby_posts", { uid: userId, radius_m: radiusM }).limit(50),
        15000,
      );
      _doneNearby();

      if (rpcErr) {
        Alert.alert("Could not load posts", "Check your connection and pull down to retry.");
      }

      let arr = Array.isArray(data) ? data : [];

      // If "show posts from followed users" is enabled, fetch their posts and merge
      const followedIds = Array.isArray(pref?.followed_users) ? pref.followed_users : [];
      const showFollowed = pref?.show_followed_users_posts === true;
      if (showFollowed && followedIds.length > 0) {
        try {
          // Also resolve followed usernames for collaborator matching
          const { data: followedProfileRows } = await supabase
            .from("profiles")
            .select("id, username")
            .in("id", followedIds);
          const resolvedFollowedUsernames = (followedProfileRows || []).map((p) => p.username).filter(Boolean);
          setFollowedUsernames(resolvedFollowedUsernames);

          const _doneFollowed = trackRequest(`Community.followedPosts count=${followedIds.length}`);
          const { data: followedPostsData } = await supabase
            .from("posts")
            .select("*")
            .in("author_id", followedIds)
            .order("date", { ascending: false })
            .limit(20);
          _doneFollowed();
          if (Array.isArray(followedPostsData) && followedPostsData.length > 0) {
            const existingIds = new Set(arr.map((p) => String(p.id)));
            const newPosts = followedPostsData.filter((p) => !existingIds.has(String(p.id)));
            arr = [...arr, ...newPosts];
          }

          // Fetch posts where a followed user is a collaborator (not already loaded)
          if (resolvedFollowedUsernames.length > 0) {
            const existingIds = new Set(arr.map((p) => String(p.id)));
            for (const uname of resolvedFollowedUsernames) {
              try {
                const { data: collabPosts } = await supabase
                  .from("posts")
                  .select("*")
                  .contains("collaborators", [uname])
                  .order("date", { ascending: false })
                  .limit(10);
                if (Array.isArray(collabPosts)) {
                  collabPosts.forEach((p) => {
                    if (!existingIds.has(String(p.id))) {
                      existingIds.add(String(p.id));
                      arr.push(p);
                    }
                  });
                }
              } catch {}
            }
          }

          // Fetch share posts authored by followed users (not already loaded)
          if (followedIds.length > 0) {
            const existingIds = new Set(arr.map((p) => String(p.id)));
            try {
              const { data: sharePosts } = await supabase
                .from("posts")
                .select("*")
                .in("author_id", followedIds)
                .not("shared_post_id", "is", null)
                .order("date", { ascending: false })
                .limit(20);
              if (Array.isArray(sharePosts)) {
                sharePosts.forEach((p) => {
                  if (!existingIds.has(String(p.id))) {
                    existingIds.add(String(p.id));
                    arr.push(p);
                  }
                });
              }
            } catch {}
          }
        } catch {}
      }

      // Filter out hidden posts
      arr = arr.filter((p) => !p.hidden);

      setPosts(arr);
      setActivePostId(arr.length ? String(arr[0].id) : null);

      if (arr.length) {
        warmCommunityFirstPost(arr[0])
          .then((ov) => ov && setFirstPostOverride(ov))
          .catch(() => {});
      }
    } catch (e) {
      setActivePostId(null);
      if (e?.message === "timeout") {
        Alert.alert("Taking too long", "The request timed out. Check your connection and pull down to retry.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadSavedFromProfile, t]);

  useFocusEffect(
    useCallback(() => {
      posthog.screen("Community");
      navigation.setParams({ bottomBarVisible: true });
      animationState.current = "shown";
      topBarOpacity.setValue(1);
      lastOffset.current = 0;
      setTopActiveTab(null);

      // Sync prefs state from AsyncStorage on every focus so visiblePosts useMemo
      // (ad-free filter) reflects changes made in CommunitySettings since last visit.
      reloadPrefs();

      readCachedFirstPostOverride()
        .then((ov) => ov && setFirstPostOverride(ov))
        .catch(() => {});

      fetchNearbyPosts();
    }, [fetchNearbyPosts, navigation, topBarOpacity, reloadPrefs])
  );

  // Re-check location permission when the app returns to foreground after the
  // user may have granted access in device Settings.
  const locationDeniedRef = useRef(locationDenied);
  useEffect(() => { locationDeniedRef.current = locationDenied; }, [locationDenied]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && locationDeniedRef.current) {
        fetchNearbyPosts();
      }
    });
    return () => sub.remove();
  }, [fetchNearbyPosts]);


  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNearbyPosts();
  }, [fetchNearbyPosts]);

  const handleChangeLabels = useCallback(
    (nextLabels) => {
      setLabels(nextLabels);
      const cleaned = nextLabels.map((s) => s.trim()).filter(Boolean);
      setEventTags(cleaned);

      const nextLower = new Set(cleaned.map((s) => s.toLowerCase()));

      // Detect removed labels so they can be purged from ad_tags too (prevents re-appearing on load)
      const removedLower = new Set(
        labels.map((s) => s.toLowerCase()).filter((s) => !nextLower.has(s))
      );

      // Detect newly added labels and merge them into adTags
      const addedItems = nextLabels.filter(
        (l) => !labels.some((existing) => existing.toLowerCase() === l.toLowerCase())
      );

      setAdTags((prev) => {
        const stripped = removedLower.size > 0
          ? prev.filter((s) => !removedLower.has(s.toLowerCase()))
          : prev;
        const prevLower = new Set(stripped.map((s) => s.toLowerCase()));
        const toAdd = addedItems.filter((l) => !prevLower.has(l.toLowerCase()));
        const nextAdTags = toAdd.length ? [...stripped, ...toAdd] : stripped;
        if (uid) {
          supabase
            .from("profiles")
            .update({ event_tags: cleaned, ad_tags: nextAdTags })
            .eq("id", uid)
            .then(() => {});
        }
        return nextAdTags;
      });
    },
    [uid, labels]
  );

  // Helpers to (re)compute semanticResults from the per-label cache, no API calls needed.
  const recomputeFromLabelCache = useCallback((labelsToUse) => {
    const mergedMap = new Map(); // postId → { similarity, label }
    for (const label of labelsToUse) {
      for (const r of (perLabelResultsRef.current.get(label) ?? [])) {
        const id = String(r.id);
        const existing = mergedMap.get(id);
        if (!existing || r.similarity > existing.similarity) {
          mergedMap.set(id, { similarity: r.similarity, label });
        }
      }
    }
    const merged = Array.from(mergedMap.entries()).map(([id, { similarity }]) => ({ id, similarity }));
    postLabelMapRef.current = new Map(
      Array.from(mergedMap.entries()).map(([id, { label }]) => [id, label])
    );
    setSemanticResults(merged.length > 0 ? merged : null);
  }, []);

  // Semantic search: active labels → embed → call RPC.
  // Results are cached per label so deselecting a label is instant (no API call).
  useEffect(() => {
    const combined = [...activeLabels].filter(Boolean).join(" ");
    if (!combined || !uid) {
      setSemanticResults(null);
      postLabelMapRef.current = new Map();
      return;
    }

    const labelsToSearch = activeLabels.filter((l) => !perLabelResultsRef.current.has(l));

    if (labelsToSearch.length === 0) {
      recomputeFromLabelCache(activeLabels);
      return;
    }

    const searchForLabel = async (label) => {
      let expansion = LABEL_EXPANSIONS[label];
      if (expansion === undefined) {
        if (labelExpansionCache.current[label] !== undefined) {
          expansion = labelExpansionCache.current[label];
        } else {
          const { data: expData } = await supabase.functions.invoke("expand-label", {
            body: { label },
          });
          expansion = expData?.expansion ?? "";
          labelExpansionCache.current[label] = expansion;
        }
      }
      const expandedQuery = [label, expansion].filter(Boolean).join(" ");

      const [mmResult, textResult] = await Promise.all([
        supabase.functions.invoke("embed-multimodal", { body: { text: expandedQuery } })
          .then(({ data }) => data?.embedding
            ? supabase.rpc("search_community_posts_mm", { uid, query_embedding: data.embedding, radius_m: communityRadiusM, match_count: 60 })
            : { data: null })
          .catch(() => ({ data: null })),
        supabase.functions.invoke("embed-text", { body: { text: expandedQuery } })
          .then(({ data }) => data?.embedding
            ? supabase.rpc("search_community_posts", { uid, query_embedding: data.embedding, radius_m: communityRadiusM, match_count: 60 })
            : { data: null })
          .catch(() => ({ data: null })),
      ]);

      const mergedMap = new Map();
      for (const row of [...(mmResult?.data ?? []), ...(textResult?.data ?? [])]) {
        const id = String(row.id);
        if (!mergedMap.has(id) || row.similarity > mergedMap.get(id)) {
          mergedMap.set(id, row.similarity);
        }
      }
      const merged = Array.from(mergedMap.entries()).map(([id, similarity]) => ({ id, similarity }));
      return { label, results: merged };
    };

    const timer = setTimeout(async () => {
      setSemanticLoading(true);
      try {
        const newPerLabel = await Promise.all(labelsToSearch.map(searchForLabel));
        for (const { label, results } of newPerLabel) {
          perLabelResultsRef.current.set(label, results);
        }
        recomputeFromLabelCache(activeLabels);
      } catch (e) {
        setSemanticResults(null);
        postLabelMapRef.current = new Map();
      } finally {
        setSemanticLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [activeLabels, uid, recomputeFromLabelCache]);

  // When a label is active and semantic results arrive, fetch the full post records
  // for those IDs. This bypasses the nearby_posts limit so all semantically relevant
  // posts are shown, not just the ones that happened to load in the initial feed.
  useEffect(() => {
    if (!activeLabels.length || !semanticResults || semanticResults.length === 0) {
      setLabelPosts(null);
      return;
    }
    const ids = semanticResults.map((r) => r.id);
    supabase
      .from("posts")
      .select("*")
      .in("id", ids)
      .then(({ data }) => { setLabelPosts(data ?? []); })
      .catch(() => { setLabelPosts([]); });
  }, [semanticResults, activeLabels]);

  // Returns true if any of this ad post's labels match any of the user's ad_tags
  const adMatchesUserTags = useCallback((post, userAdTags) => {
    if (!Array.isArray(userAdTags) || !userAdTags.length) return false;
    const postLabels = Array.isArray(post.labels) ? post.labels : [];
    const tagsLower = userAdTags.map((t) => String(t).toLowerCase().trim());
    return postLabels.some((label) => {
      const lLower = String(label).toLowerCase().trim();
      return tagsLower.some((tag) => lLower.includes(tag) || tag.includes(lLower));
    });
  }, []);

  const visiblePosts = useMemo(() => {
    // When a label is active, use the fetched semantic posts as the source.
    // Fall back to the nearby_posts feed while labelPosts is still loading.
    const sourcePosts = (activeLabels.length > 0 && labelPosts !== null) ? labelPosts : posts;
    if (!sourcePosts.length) return [];

    // Ad-Free: strip all Ad items before any processing so no ad_prompt cards are generated either
    const postsInput = prefs.premiumAdFree
      ? sourcePosts.filter((p) => p.type !== "Ad")
      : sourcePosts;

    // Build list in original RPC order; ads become inline prompts when category unknown
    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const promptedCategories = new Set();
    let out = postsInput.reduce((acc, p) => {
      const type = String(p.type || "");
      const isFromFollowed = showFollowedPosts && (
        (followedUserIds.length > 0 && followedUserIds.includes(p.author_id)) ||
        (followedUsernames.length > 0 && Array.isArray(p.collaborators) && p.collaborators.some((u) => followedUsernames.includes(u))) ||
        // Share posts from followed users
        (followedUserIds.length > 0 && !!p.shared_post_id && followedUserIds.includes(p.author_id))
      );
      if (!VISIBLE_TYPES.has(type) && !isFromFollowed) return acc;
      if (type === "Article" && !showLocalNews) return acc;
      if (blockedUsers.length && blockedUsers.includes(asAt(p.user))) return acc;
      // Hide events whose date has already passed, unless end_date is today or future,
      // or the event repeats every day / has specific periodic days (shown until deleted by the poster)
      if (type === "Event" && !p.every_day && !(p.repeat_days?.length > 0) && p.date && String(p.date).slice(0, 10) < todayStr) {
        const endDate = p.end_date ? String(p.end_date).slice(0, 10) : null;
        if (!endDate || endDate < todayStr) return acc;
      }

      // Location filter: both the post's stored coordinates (where the poster was at creation)
      // and the event venue (what's displayed in the subtitle) are represented by p.lat/p.lon.
      // Filter out posts whose venue is outside the user's max-event-distance radius.
      // Posts with no coordinates (non-geotagged articles, etc.) pass through.
      if (
        userLat != null &&
        userLon != null &&
        typeof p.lat === "number" &&
        typeof p.lon === "number" &&
        haversineKm(userLat, userLon, p.lat, p.lon) * 1000 > communityRadiusM
      ) return acc;

      if (type === "Ad") {
        // Creator always sees their own ad directly
        if (p.author_id && uid && p.author_id === uid) {
          acc.push(p);
          return acc;
        }
        // When labels are active, ads in labelPosts already passed semantic similarity —
        // show them directly instead of going through the ad_tags gate.
        if (activeLabels.length > 0 && labelPosts !== null) {
          acc.push(p);
          return acc;
        }
        if (adMatchesUserTags(p, adTags)) {
          acc.push(p);
        } else {
          const category =
            Array.isArray(p.labels) && p.labels[0]
              ? String(p.labels[0]).trim()
              : null;
          const key = category ? category.toLowerCase() : null;
          if (
            key &&
            !rejectedCategories.has(key) &&
            !promptedCategories.has(key)
          ) {
            promptedCategories.add(key);
            // Synthetic item rendered as an inline interest-prompt card
            acc.push({
              id: `ad_prompt_${p.id}`,
              type: "ad_prompt",
              category,
              date: p.date,
            });
          }
        }
        return acc;
      }

      acc.push(p);
      return acc;
    }, []);

    if (selectedDate) {
      out = out.filter((p) => {
        if (p.type === "ad_prompt") return true;
        const type = String(p.type);
        if (type !== "Event") return false;
        if (String(p.date).slice(0, 10) !== selectedDate) return false;
        return true;
      });
    }

    if (semanticResults !== null) {
      // Semantic search active: filter + rank by embedding similarity
      const simMap = new Map(semanticResults.map((r) => [String(r.id), r.similarity]));
      const SIM_THRESHOLD = 0.35;

      // Secondary keyword check for user-created labels (e.g. "Jazz", "Pizza").
      // Uses the full expansion (from the expand-label edge function) so sibling
      // sub-categories are filtered without over-restricting results.
      // Base labels skip this check — their similarity score is sufficient.
      const labelKeywordSets = new Map(); // label → Set<string>
      for (const label of activeLabels) {
        if (label in LABEL_EXPANSIONS) continue; // base labels: trust similarity alone
        const expansion = labelExpansionCache.current[label] ?? "";
        const terms = [label, ...expansion.split(/[\s,]+/)]
          .map((s) => s.toLowerCase().trim())
          .filter((s) => s.length > 2);
        labelKeywordSets.set(label, new Set(terms));
      }
      const passesKeywordCheck = (p) => {
        if (activeLabels.length === 0) return true;
        const matchedLabel = postLabelMapRef.current.get(String(p.id));
        const keyTerms = matchedLabel ? labelKeywordSets.get(matchedLabel) : null;
        if (!keyTerms || keyTerms.size === 0) return true; // base label or unknown → pass
        const haystack = [p.ai_caption, p.title, p.description]
          .filter(Boolean).join(" ").toLowerCase();
        return [...keyTerms].some((t) => haystack.includes(t));
      };

      out = out
        .filter((p) => p.type === "ad_prompt" || (
          simMap.has(String(p.id)) &&
          simMap.get(String(p.id)) >= SIM_THRESHOLD &&
          passesKeywordCheck(p)
        ))
        .sort((a, b) => {
          if (a.type === "ad_prompt") return -1;
          if (b.type === "ad_prompt") return 1;
          return (simMap.get(String(b.id)) || 0) - (simMap.get(String(a.id)) || 0);
        });
    } else {
      // Sort chronologically (newest first); compare by date then time
      out = [...out].sort((a, b) => {
        const da = String(a.date || ""), db = String(b.date || "");
        if (db !== da) return db > da ? 1 : -1;
        const ta = String(a.time || ""), tb = String(b.time || "");
        return tb > ta ? 1 : -1;
      });
    }

    // Ad placement: never first, never consecutive (when enough non-ads exist)
    const isAdItem = (p) => p.type === "Ad" || p.type === "ad_prompt";
    const outAds = out.filter(isAdItem);
    const outNonAds = out.filter((p) => !isAdItem(p));
    if (outAds.length > 0 && outNonAds.length > 0) {
      const result = [];
      let ai = 0;
      let ni = 0;
      while (ni < outNonAds.length || ai < outAds.length) {
        // Emit up to 2 non-ads
        let added = 0;
        while (ni < outNonAds.length && added < 2) {
          result.push(outNonAds[ni++]);
          added++;
        }
        // Emit 1 ad after non-ads (only if we actually emitted some)
        if (ai < outAds.length && added > 0) {
          result.push(outAds[ai++]);
        }
        // No more non-ads — append remaining ads at end
        if (ni >= outNonAds.length && ai < outAds.length) {
          while (ai < outAds.length) result.push(outAds[ai++]);
          break;
        }
      }
      out = result;
    }

    // Always show an Event first if one exists
    const firstEventIdx = out.findIndex((p) => p.type === "Event");
    if (firstEventIdx > 0) {
      const floated = out[firstEventIdx];
      out = [floated, ...out.slice(0, firstEventIdx), ...out.slice(firstEventIdx + 1)];
    }

    return out;
  }, [
    posts,
    adTags,
    rejectedCategories,
    showLocalNews,
    blockedUsers,
    selectedDate,
    semanticResults,
    labelPosts,
    activeLabels,
    showFollowedPosts,
    followedUserIds,
    followedUsernames,
    adMatchesUserTags,
    prefs.premiumAdFree,
    uid,
    userLat,
    userLon,
    communityRadiusM,
  ]);

  const dateLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      })
    : t("filter_date");

  const handleDateChange = (event, date) => {
    if (!date) return;
    const iso = date.toISOString().slice(0, 10);
    setSelectedDate(iso);
    setShowDateDropdown(false);
    scrollToTop();
    fetchNearbyPosts();
  };

  const clearDate = () => {
    setSelectedDate(null);
    setShowDateDropdown(false);
    scrollToTop();
    fetchNearbyPosts();
  };

  const clearSearch = () => {
    setSearchQuery("");
    setCommunitySearchUsers([]);
    setCommunitySearchPosts([]);
    scrollToTop();
  };

  // Text search for the community dropdown: profiles + posts
  useEffect(() => {
    const term = searchQuery.trim();
    if (!term || !uid) {
      setCommunitySearchUsers([]);
      setCommunitySearchPosts([]);
      setCommunitySearchLoading(false);
      return;
    }

    setCommunitySearchLoading(true);
    setCommunitySearchPostsVisible(2);
    setCommunitySearchUsersVisible(2);
    const safeTerm = term.replace(/%/g, "");

    const timer = setTimeout(async () => {
      try {
        const [usersRes, postsRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, name, avatar_url")
            .or(`username.ilike.%${safeTerm}%,name.ilike.%${safeTerm}%`)
            .not("username", "is", null)
            .neq("id", uid)
            .limit(8),
          supabase
            .from("posts")
            .select("id, title, description, type, date, author_id")
            .or(`title.ilike.%${safeTerm}%,description.ilike.%${safeTerm}%`)
            .in("type", ["Event", "Ad", "Article"])
            .or(`type.neq.Event,date.gte.${new Date().toISOString().slice(0, 10)}`)
            .order("date", { ascending: false })
            .limit(10),
        ]);
        setCommunitySearchUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
        setCommunitySearchPosts(Array.isArray(postsRes.data) ? postsRes.data : []);
      } catch {
        setCommunitySearchUsers([]);
        setCommunitySearchPosts([]);
      } finally {
        setCommunitySearchLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, uid]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 90,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (!viewableItems?.length) return;
    const first = viewableItems[0];
    if (first?.item?.id != null) setActivePostId(String(first.item.id));
  }).current;

  const renderPost = useCallback(({ item, index }) => {
    // Inline ad-interest prompt card — handled inline, no Post involved
    if (item.type === "ad_prompt") return null; // kept in FlatList renderItem below
    const isActive = String(item.id) === String(activePostId);
    const matchLabel =
      activeLabels.length > 0 && semanticResults !== null
        ? semanticResults.some((r) => String(r.id) === String(item.id) && r.similarity >= 0.20)
        : false;
    const matchedLabelName = matchLabel
      ? (postLabelMapRef.current.get(String(item.id)) ?? activeLabels[0])
      : null;
    const matchedLabelColor = matchedLabelName
      ? LABEL_COLORS[labels.indexOf(matchedLabelName) % LABEL_COLORS.length]
      : null;
    const isFirst = index === 0;
    const ovOk =
      isFirst &&
      firstPostOverride &&
      String(firstPostOverride.postId) === String(item.id);
    const effectiveAvatar = ovOk ? firstPostOverride.cachedAvatar || item.userpicuri : item.userpicuri;
    const effectiveMedia  = ovOk ? firstPostOverride.cachedMedia  || item.postmediauri : item.postmediauri;
    return (
      <ThemedView variant="gray" style={styles.feedSection}>
        <Post
          {...item}
          postId={item.id}
          userPicUri={effectiveAvatar || "https://placehold.co/48x48"}
          postMediaUri={effectiveMedia}
          postMediaUriHint={item.postmediauri}
          actions={item.actions || []}
          authorId={item.author_id}
          initialSaved={!!savedMeta[item.id]}
          onToggleSave={toggleSave}
          onDeleted={handlePostDeleted}
          onToggleHidden={handlePostHidden}
          labelTag={matchedLabelName}
          labelColor={matchedLabelColor}
          isActive={isActive}
          colors={["#56d1f0", "#00a4e6", "#60affe"]}
        />
      </ThemedView>
    );
  }, [activePostId, savedMeta, firstPostOverride, activeLabels, semanticResults, labels, toggleSave, handlePostDeleted, handlePostHidden]);

  return (
    <ThemedView
      style={[
        styles.container,
        { backgroundColor: isDark ? theme.gray : theme.background },
      ]}
    >
      <TopBar
        opacity={topBarOpacity}
        activeTab={topActiveTab}
        setActiveTab={setTopActiveTab}
      />

      {locationDenied ? (
        <View style={[styles.locationDeniedContainer, { backgroundColor: isDark ? theme.gray : "#FFFFFF" }]}>
          <Ionicons name="location-outline" size={52} color="#3D8BFF" style={{ marginBottom: 16 }} />
          <Text style={[styles.locationDeniedCaption, { color: isDark ? "#FFFFFF" : "#111111" }]}>
            {t("community_location_denied_caption")}
          </Text>
          {!showLocationInstructions ? (
            <TouchableOpacity
              style={styles.locationSettingsBtn}
              activeOpacity={0.85}
              onPress={async () => {
                try {
                  await Linking.openSettings();
                } catch {
                  setShowLocationInstructions(true);
                }
              }}
            >
              <Text style={styles.locationSettingsBtnText}>
                {t("community_location_settings_btn")}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.locationInstructionsBox}>
              <Text style={[styles.locationInstructionsText, { color: isDark ? "#CCCCCC" : "#444444" }]}>
                {Platform.OS === "ios"
                  ? t("community_location_instructions_ios")
                  : t("community_location_instructions_android")}
              </Text>
            </View>
          )}
        </View>
      ) : (
      <FlatList
        ref={scrollRef}
        data={visiblePosts}
        keyExtractor={(item) => String(item.id)}
        style={{ backgroundColor: isDark ? theme.gray : "#FFFFFF" }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        windowSize={3}
        maxToRenderPerBatch={3}
        initialNumToRender={3}
        ListHeaderComponent={
          <View style={[styles.innerPadding, { paddingTop: 92 }]}>
            {/* Traveler Mode banner — dismissable per session, does not deactivate the feature */}
            {prefs.premiumTravelerMode && !travelBannerDismissed && (
              <View style={styles.travelerBanner}>
                <Text style={styles.travelerBannerText} numberOfLines={2}>
                  {prefs.travelerModeCityCoords && prefs.travelerModeCity
                    ? `📍 Browsing as: ${prefs.travelerModeCity}`
                    : "📍 Traveler Mode active — select a city in Settings to get started"}
                </Text>
                <TouchableOpacity onPress={() => setTravelBannerDismissed(true)} hitSlop={8}>
                  <Feather name="x" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            <LabelsCard
              labels={labels}
              colors={LABEL_COLORS}
              activeLabels={activeLabels}
              loading={semanticLoading}
              onSelect={(name) => {
                setActiveLabels((prev) =>
                  prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
                );
                scrollToTop();
              }}
              onChangeLabels={handleChangeLabels}
            />

            <View style={styles.filtersContainer}>
              <View style={styles.filterRow}>
                {/* Date chip */}
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    selectedDate
                      ? { backgroundColor: "#2F91FF", borderColor: "transparent" }
                      : isDark
                        ? { backgroundColor: "#555", borderColor: "transparent" }
                        : { backgroundColor: "#FFFFFF", borderColor: "#d9e4f3" },
                  ]}
                  onPress={() => setShowDateDropdown((p) => !p)}
                  activeOpacity={0.8}
                >
                  <Feather
                    name="calendar"
                    size={16}
                    color={selectedDate ? "#FFFFFF" : (isDark ? "#FFFFFF" : "#2F91FF")}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.filterText, { color: selectedDate ? "#FFFFFF" : (isDark ? "rgba(255,255,255,0.7)" : "#111111") }]}>
                    {dateLabel}
                  </Text>
                  {selectedDate && (
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); clearDate(); }}
                      style={{ paddingHorizontal: 4 }}
                    >
                      <Text style={[styles.filterClear, { color: "rgba(255,255,255,0.8)" }]}>×</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                {/* Search bar */}
                <View
                  style={[
                    styles.searchBarContainer,
                    {
                      backgroundColor: isDark ? "#555" : "#FFFFFF",
                      borderColor: isDark ? "transparent" : "#d9e4f3",
                      borderWidth: isDark ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Feather
                    name="search"
                    size={16}
                    color={isDark ? "#FFFFFF" : "#2F91FF"}
                    style={{ marginRight: 6 }}
                  />
                  <TextInput
                    style={[
                      styles.searchInput,
                      { color: isDark ? "#FFFFFF" : "#111111"},
                    ]}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={language === "it" ? "Cerca eventi e utenti" : "Search events and users"}
                    placeholderTextColor={isDark ? "rgba(255,255,255,0.7)" : "#111111"}
                    returnKeyType="search"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={clearSearch} hitSlop={8}>
                      <Feather
                        name="x"
                        size={16}
                        color={isDark ? "#9fb0c6" : "#6F7D95"}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {showDateDropdown && (
                <View
                  style={[
                    styles.dateDropdown,
                    {
                      backgroundColor: isDark ? theme.gray : "#FFFFFF",
                      borderColor: isDark ? "#FFFFFF" : "#d9e4f3",
                    },
                  ]}
                >
                  <DateTimePicker
                    value={selectedDate ? new Date(selectedDate) : new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "calendar"}
                    onChange={handleDateChange}
                    themeVariant={isDark ? "dark" : "light"}
                  />
                </View>
              )}

              {/* Community search dropdown */}
              {searchQuery.trim().length > 0 && (
                <View style={[styles.communitySearchDropdown, {
                  backgroundColor: isDark ? theme.gray : "#FFFFFF",
                  borderColor: isDark ? "#333" : "#d9e4f3",
                }]}>
                  {communitySearchLoading ? (
                    <View style={{ paddingVertical: 14, alignItems: "center" }}>
                      <ActivityIndicator size="small" color="#2F91FF" />
                    </View>
                  ) : (communitySearchUsers.length === 0 && communitySearchPosts.length === 0) ? (
                    <Text style={{ fontFamily: "Poppins", fontSize: 13, color: isDark ? "#aaa" : "#888", textAlign: "center", paddingVertical: 12 }}>
                      {language === "it" ? "Nessun risultato" : "No results"}
                    </Text>
                  ) : (
                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 300 }}>
                      {/* Events & Posts — shown first */}
                      {communitySearchPosts.length > 0 && (
                        <>
                          <Text style={[styles.communitySearchSection, { color: isDark ? "#aaa" : "#888" }]}>
                            {language === "it" ? "Eventi e post" : "Events & Posts"}
                          </Text>
                          {communitySearchPosts.slice(0, communitySearchPostsVisible).map((post) => {
                            const postTitle = post.title || (post.description ? post.description.slice(0, 50) : null) || "Untitled";
                            return (
                              <View key={String(post.id)} style={[styles.communitySearchRow, { borderBottomColor: isDark ? "#333" : "#eee" }]}>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontFamily: "Poppins", fontSize: 14, color: isDark ? "#fff" : "#111" }} numberOfLines={1}>{postTitle}</Text>
                                  <Text style={{ fontFamily: "Poppins", fontSize: 12, color: isDark ? "#aaa" : "#888" }}>
                                    {post.type}{post.date ? ` · ${formatSearchDate(post.date)}` : ""}
                                  </Text>
                                </View>
                                <TouchableOpacity style={styles.communitySearchBtn} onPress={() => navigation.navigate("SinglePost", { postId: post.id })}>
                                  <Feather name="arrow-right" size={15} color="#59A7FF" />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                          {communitySearchPostsVisible < communitySearchPosts.length && (
                            <TouchableOpacity
                              style={styles.communitySearchMore}
                              onPress={() => setCommunitySearchPostsVisible((v) => v + 3)}
                            >
                              <Text style={[styles.communitySearchMoreText, { color: isDark ? "#59A7FF" : "#2F91FF" }]}>More</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      )}
                      {/* People — shown second */}
                      {communitySearchUsers.length > 0 && (
                        <>
                          <Text style={[styles.communitySearchSection, { color: isDark ? "#aaa" : "#888", marginTop: communitySearchPosts.length > 0 ? 8 : 0 }]}>
                            {language === "it" ? "Utenti" : "People"}
                          </Text>
                          {communitySearchUsers.slice(0, communitySearchUsersVisible).map((user) => {
                            const displayName = user.name || user.username || "User";
                            return (
                              <View key={user.id} style={[styles.communitySearchRow, { borderBottomColor: isDark ? "#333" : "#eee" }]}>
                                {user.avatar_url ? (
                                  <Image source={{ uri: user.avatar_url }} style={styles.communitySearchAvatar} />
                                ) : (
                                  <View style={[styles.communitySearchAvatar, { backgroundColor: isDark ? "#444" : "#d9e4f3", alignItems: "center", justifyContent: "center" }]}>
                                    <Text style={{ fontFamily: "Poppins", fontSize: 14, color: isDark ? "#fff" : "#555" }}>{displayName[0]?.toUpperCase() || "?"}</Text>
                                  </View>
                                )}
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontFamily: "Poppins", fontSize: 14, color: isDark ? "#fff" : "#111" }} numberOfLines={1}>{displayName}</Text>
                                  {!!user.username && <Text style={{ fontFamily: "Poppins", fontSize: 12, color: isDark ? "#aaa" : "#888" }}>@{user.username}</Text>}
                                </View>
                                <TouchableOpacity style={styles.communitySearchBtn} onPress={() => navigation.navigate("Profile", { username: user.username })}>
                                  <Feather name="user" size={15} color="#59A7FF" />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                          {communitySearchUsersVisible < communitySearchUsers.length && (
                            <TouchableOpacity
                              style={styles.communitySearchMore}
                              onPress={() => setCommunitySearchUsersVisible((v) => v + 3)}
                            >
                              <Text style={[styles.communitySearchMoreText, { color: isDark ? "#59A7FF" : "#2F91FF" }]}>More</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      )}
                    </ScrollView>
                  )}
                </View>
              )}

            </View>
          </View>
        }
        ListHeaderComponentStyle={styles.headerWrapper}
        ListFooterComponent={<ThemedView variant="gray" style={{ height: 60 }} />}
        ListEmptyComponent={<ThemedView variant="gray" style={{ paddingVertical: 24 }} />}
        renderItem={({ item, index }) => {
          if (item.type !== "ad_prompt") return renderPost({ item, index });
          // Inline ad-interest prompt card
          return (
              <View style={[styles.adPromptCard, { backgroundColor: isDark ? theme.gray : "#FFFFFF" }]}>
                <Text style={[styles.adPromptTitle, { color: theme.text }]}>
                  Are you interested in seeing ads about{" "}
                  <Text style={{ fontFamily: "PoppinsBold" }}>{item.category}</Text>?
                </Text>
                <View style={styles.adPromptRow}>
                  <TouchableOpacity
                    style={[styles.adPromptBtn, { backgroundColor: "#b0b6c0" }]}
                    onPress={() =>
                      setRejectedCategories(
                        (prev) => new Set([...prev, item.category.toLowerCase()])
                      )
                    }
                  >
                    <Text style={styles.adPromptBtnText}>No</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.adPromptBtn, { backgroundColor: "#3D8BFF" }]}
                    onPress={async () => {
                      const cat = item.category;
                      const capitalized =
                        cat.charAt(0).toUpperCase() + cat.slice(1);

                      // Add to adTags
                      const nextAdTags = adTags.some(
                        (t) => t.toLowerCase() === cat.toLowerCase()
                      )
                        ? adTags
                        : [...adTags, cat];
                      setAdTags(nextAdTags);

                      // Add capitalized to labels (LabelsCard)
                      const nextLabels = labels.some(
                        (l) => l.toLowerCase() === capitalized.toLowerCase()
                      )
                        ? labels
                        : [...labels, capitalized];
                      setLabels(nextLabels);
                      const nextEventTags = nextLabels
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setEventTags(nextEventTags);

                      if (uid) {
                        await supabase
                          .from("profiles")
                          .update({
                            ad_tags: nextAdTags,
                            event_tags: nextEventTags,
                          })
                          .eq("id", uid)
                          .then(() => {});
                      }
                    }}
                  >
                    <Text style={styles.adPromptBtnText}>Yes</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
        }}
      />
      )}

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate("MyTickets")}
        style={[
          styles.ticketsWidget,
          { backgroundColor: "#6C2BD9" },
        ]}
      >
        <Ionicons name="ticket-outline" size={18} color="#fff" />
      </TouchableOpacity>

      <Modal
        visible={!!spoofReason}
        transparent
        animationType="slide"
        onRequestClose={() => setSpoofReason(null)}
      >
        <View style={styles.vpnOverlay}>
          <View style={[styles.vpnCard, { backgroundColor: theme.background }]}>
            <View style={styles.vpnHandle} />
            <Feather name="map-pin" size={32} color="#FF4D4D" style={{ marginBottom: 12 }} />
            <Text style={[styles.vpnTitle, { color: theme.text }]}>Location issue detected</Text>
            <Text style={[styles.vpnBody, { color: theme.secondaryText }]}>
              {spoofReason === "mocked"
                ? "A mock location app appears to be active on your device. Please disable it and try again."
                : spoofReason === "impossible_jump"
                ? "Your location changed faster than physically possible. Please make sure you're sharing your real location."
                : spoofReason === "country_mismatch"
                ? "Your GPS location and network location don't match. Please make sure you're sharing your real location."
                : "We couldn't verify your location. Please make sure you're sharing your real location."}
            </Text>
            <TouchableOpacity
              style={styles.vpnBtn}
              onPress={() => setSpoofReason(null)}
            >
              <Text style={styles.vpnBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.vpnTravelerBtn}
              onPress={() => { setSpoofReason(null); navigation.navigate("Settings"); }}
            >
              <Text style={[styles.vpnTravelerText, { color: theme.secondaryText }]}>
                Travelling? Try Traveler Mode →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <OnboardingOverlay screenKey="community" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {},
  innerPadding: { paddingHorizontal: 16 },

  headerWrapper: {
    zIndex: 50,
    elevation: 50,
  },

  filtersContainer: {
    marginTop: 12,
    marginBottom: 6,
    position: "relative",
    zIndex: 30,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterText: {
    fontSize: 13,
    fontFamily: "Poppins",
  },
  filterClear: {
    fontSize: 13,
    marginLeft: 4,
    fontFamily: "Poppins",
  },

  dateDropdown: {
    position: "absolute",
    top: "100%",
    paddingTop: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 40,
    paddingLeft: 5,
    paddingRight: 5,
    fontFamily: "Poppins",
  },

  searchBarContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
    fontFamily: "Poppins",
    letterSpacing: 0,
  },

  communitySearchDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  communitySearchSection: {
    fontFamily: "Poppins",
    fontSize: 11,
    paddingHorizontal: 2,
    paddingBottom: 2,
    paddingTop: 2,
  },
  communitySearchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  communitySearchAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 10,
  },
  communitySearchBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#59A7FF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  communitySearchMore: {
    paddingVertical: 7,
    alignItems: "center",
  },
  communitySearchMoreText: {
    fontFamily: "Poppins",
    fontSize: 13,
  },

  noEventsText: {
    fontSize: 13,
    fontFamily: "Poppins",
  },

  feedSection: {
    marginTop: 8,
  },

  ticketsWidget: {
    position: "absolute",
    right: 16,
    bottom: Platform.OS === "android" ? 104 : 86,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 10,
  },

  travelerBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#00A9FF",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  travelerBannerText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Poppins",
    flex: 1,
    marginRight: 8,
  },

  adPromptCard: {
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
  },
  adPromptTitle: {
    fontFamily: "Poppins",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 14,
  },
  adPromptRow: {
    flexDirection: "row",
    gap: 10,
  },
  adPromptBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  adPromptBtnText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },

  vpnOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  vpnCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, alignItems: "center" },
  vpnHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#ddd", marginBottom: 16 },
  vpnTitle: { fontFamily: "PoppinsBold", fontSize: 20, marginBottom: 8 },
  vpnBody: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: 24, opacity: 0.75 },
  vpnBtn: { backgroundColor: "#2F91FF", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, marginBottom: 12 },
  vpnBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
  vpnTravelerBtn: { paddingVertical: 8 },
  vpnTravelerText: { fontFamily: "Poppins", fontSize: 13, textAlign: "center" },

  locationDeniedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
  },
  locationDeniedCaption: {
    fontFamily: "Poppins",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 24,
    opacity: 0.85,
  },
  locationSettingsBtn: {
    backgroundColor: "#3D8BFF",
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 32,
  },
  locationSettingsBtnText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
  locationInstructionsBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3D8BFF",
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginTop: 4,
  },
  locationInstructionsText: {
    fontFamily: "Poppins",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
});
