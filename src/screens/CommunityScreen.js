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
  View,
  StyleSheet,
  Alert,
  Text,
  TouchableOpacity,
  Platform,
  FlatList,
  TextInput,
  Modal,
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

import {
  readCachedFirstPostOverride,
  warmCommunityFirstPost,
} from "../lib/communityFirstPostCache";
import { checkVPN } from "../utils/vpnDetector";

/* --------------------------- CONSTANTS ---------------------------- */

const DEFAULT_RADIUS_KM = 50;
const VISIBLE_TYPES = new Set(["Event", "Ad", "Article"]);

const BASE_LABELS = [
  "Sports",
  "Science & Tech",
  "Parties",
  "Music",
  "English-speaking",
];

const LABEL_COLORS = ["#78C0E9", "#5BC4B8", "#7DB0FF", "#6BCB77", "#87A8FF"];

/* --------------------------- FUZZY + TRANSLATION ---------------------------- */

const normalizeText = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (s) => normalizeText(s).split(" ").filter(Boolean);

const trigrams = (s) => {
  const str = normalizeText(s).replace(/\s+/g, "");
  if (!str) return [];
  if (str.length <= 3) return [str];
  const out = [];
  for (let i = 0; i < str.length - 2; i++) out.push(str.slice(i, i + 3));
  return out;
};

const jaccard = (aArr, bArr) => {
  if (!aArr.length || !bArr.length) return 0;
  const a = new Set(aArr);
  const b = new Set(bArr);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
};

const editDistance1 = (a, b) => {
  if (a === b) return true;
  const la = a.length,
    lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  let i = 0,
    j = 0,
    edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;

    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
};

const similarityScore = (labelRaw, postHayRaw) => {
  const label = normalizeText(labelRaw);
  if (!label) return 0;

  const hay = normalizeText(postHayRaw);
  if (!hay) return 0;

  if (hay.includes(label)) return 1;

  const labelTokens = tokenize(label);
  const postTokens = tokenize(hay);

  for (const lt of labelTokens) {
    if (lt.length >= 3) {
      for (const pt of postTokens) {
        if (pt.startsWith(lt) || lt.startsWith(pt)) return 0.92;
      }
    }
  }

  for (const lt of labelTokens) {
    if (lt.length >= 3 && lt.length <= 6) {
      for (const pt of postTokens) {
        if (pt.length >= 3 && pt.length <= 10 && editDistance1(lt, pt)) {
          return 0.85;
        }
      }
    }
  }

  const ltJoined = labelTokens.join("");
  const ltTris = trigrams(ltJoined);

  let best = 0;
  for (const pt of postTokens) {
    const s = jaccard(ltTris, trigrams(pt));
    if (s > best) best = s;
    if (best >= 0.6) break;
  }

  const hayTris = trigrams(hay);
  best = Math.max(best, jaccard(ltTris, hayTris) * 0.85);

  return best;
};

const LABEL_MATCH_THRESHOLD = 0.55;

const buildSearchText = (p) => {
  const labels = Array.isArray(p.labels) ? p.labels.join(" ") : "";
  return `${p.title || ""} ${p.description || ""} ${labels}`;
};

const asAt = (s) => String(s || "").replace(/^@+/, "");

/* --- translation cache helpers --- */
const TR_CACHE_PREFIX = "alba_label_tr_v1:";

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

const translateOnce = async (text, targetLang) => {
  const q = encodeURIComponent(String(text || ""));
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${q}`;

  const res = await withTimeout(fetch(url), 2200);
  if (!res.ok) throw new Error(`translate http ${res.status}`);
  const json = await res.json();

  const chunks = Array.isArray(json?.[0]) ? json[0] : [];
  const out = chunks.map((c) => c?.[0]).filter(Boolean).join("");
  return out || null;
};

const uniqNorm = (arr) => {
  const set = new Set();
  (arr || []).forEach((x) => {
    const n = normalizeText(x);
    if (n) set.add(n);
  });
  return Array.from(set);
};

/* --------------------------- LOCATION HELPERS ---------------------------- */

const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000; // only trust last-known if <= 2 min old

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
      return coords;
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
      return pos.coords;
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
      return pos.coords;
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

  const { prefs, reload: reloadPrefs } = useUserPreferences();
  const [travelBannerDismissed, setTravelBannerDismissed] = useState(false);

  const [eventTags, setEventTags] = useState([]);
  const [adTags, setAdTags] = useState([]);
  const [showLocalNews, setShowLocalNews] = useState(true);

  const [labels, setLabels] = useState(BASE_LABELS);
  const [activeLabel, setActiveLabel] = useState(null);

  const [selectedDate, setSelectedDate] = useState(null);
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  const [timeFilter, setTimeFilter] = useState(null);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);

  const [activePostId, setActivePostId] = useState(null);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [firstPostOverride, setFirstPostOverride] = useState(null);

  const [activeLabelNeedles, setActiveLabelNeedles] = useState([]);
  const activeLabelReqId = useRef(0);

  // Ad interest prompt — track rejected categories so we never ask again this session
  const [rejectedCategories, setRejectedCategories] = useState(new Set());

  const [vpnBlockVisible, setVpnBlockVisible] = useState(false);

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

  const fetchNearbyPosts = useCallback(async () => {
    try {
      setLoading(true);

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes?.user) throw new Error("Not authenticated");
      const userId = userRes.user.id;
      setUid(userId);

      const [, prefRes] = await Promise.all([
        loadSavedFromProfile(userId),
        supabase
          .from("profiles")
          .select("event_tags, ad_tags, show_local_news, blocked_users")
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
          Alert.alert(
            t("community_location_title"),
            t("community_location_message")
          );
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
        ({ latitude, longitude } = coords);
      }

      // ✅ IMPORTANT FIX: await the profile location update so nearby_posts uses the NEW location
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          location: `SRID=4326;POINT(${longitude} ${latitude})`,
          location_updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (upErr) {
        // still try to fetch, but log (if the RPC relies on profile.location, this matters)
        console.warn("[Community] location update error", upErr);
      }

      const { data, error: rpcErr } = await supabase.rpc("nearby_posts", {
        uid: userId,
        radius_m: DEFAULT_RADIUS_KM * 1000,
      });

      if (rpcErr) {
        console.warn("[Community] nearby_posts error", rpcErr);
      }

      const arr = Array.isArray(data) ? data : [];
      setPosts(arr);
      setActivePostId(arr.length ? String(arr[0].id) : null);

      if (arr.length) {
        warmCommunityFirstPost(arr[0])
          .then((ov) => ov && setFirstPostOverride(ov))
          .catch(() => {});
      }
    } catch (e) {
      console.warn("fetchNearbyPosts error", e);
      setActivePostId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadSavedFromProfile, t]);

  useFocusEffect(
    useCallback(() => {
      navigation.setParams({ bottomBarVisible: true });
      animationState.current = "shown";
      topBarOpacity.setValue(1);
      lastOffset.current = 0;

      // Sync prefs state from AsyncStorage on every focus so visiblePosts useMemo
      // (ad-free filter) reflects changes made in CommunitySettings since last visit.
      reloadPrefs();

      readCachedFirstPostOverride()
        .then((ov) => ov && setFirstPostOverride(ov))
        .catch(() => {});

      fetchNearbyPosts();
    }, [fetchNearbyPosts, navigation, topBarOpacity, reloadPrefs])
  );

  useFocusEffect(
    useCallback(() => {
      checkVPN().then((detected) => setVpnBlockVisible(detected));
    }, [])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNearbyPosts();
  }, [fetchNearbyPosts]);

  const handleChangeLabels = useCallback(
    (nextLabels) => {
      setLabels(nextLabels);
      const cleaned = nextLabels.map((s) => s.trim()).filter(Boolean);
      setEventTags(cleaned);

      // Detect newly added labels and also merge them into adTags
      const addedItems = nextLabels.filter(
        (l) => !labels.some((existing) => existing.toLowerCase() === l.toLowerCase())
      );

      if (addedItems.length > 0) {
        setAdTags((prev) => {
          const prevLower = new Set(prev.map((s) => s.toLowerCase()));
          const toAdd = addedItems.filter((l) => !prevLower.has(l.toLowerCase()));
          const nextAdTags = toAdd.length ? [...prev, ...toAdd] : prev;
          if (uid) {
            supabase
              .from("profiles")
              .update({ event_tags: cleaned, ad_tags: nextAdTags })
              .eq("id", uid)
              .then(() => {});
          }
          return nextAdTags;
        });
      } else {
        if (uid) {
          supabase
            .from("profiles")
            .update({ event_tags: cleaned })
            .eq("id", uid)
            .then(() => {});
        }
      }
    },
    [uid, labels]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const label = activeLabel;
      const reqId = ++activeLabelReqId.current;

      if (!label) {
        setActiveLabelNeedles([]);
        return;
      }

      setActiveLabelNeedles(uniqNorm([label]));

      const key = `${TR_CACHE_PREFIX}${normalizeText(label)}`;
      try {
        const cached = await AsyncStorage.getItem(key);
        if (cancelled || reqId !== activeLabelReqId.current) return;

        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.needles) && parsed.needles.length) {
            setActiveLabelNeedles(uniqNorm([label, ...parsed.needles]));
            return;
          }
        }
      } catch {}

      try {
        const [en, it] = await Promise.all([
          translateOnce(label, "en").catch(() => null),
          translateOnce(label, "it").catch(() => null),
        ]);

        if (cancelled || reqId !== activeLabelReqId.current) return;

        const needles = uniqNorm([label, en, it]);
        setActiveLabelNeedles(needles);

        AsyncStorage.setItem(
          key,
          JSON.stringify({ needles, cachedAt: Date.now() })
        ).catch(() => {});
      } catch {}
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [activeLabel]);

  const matchesSearchQuery = (p, q) => {
    if (!q) return true;
    const nq = normalizeText(q);
    if (!nq) return true;

    const uname = asAt(p.user || "");
    const hay = normalizeText(`${uname} ${p.title || ""} ${p.description || ""}`);
    const words = hay.split(" ").filter(Boolean);
    return words.some((w) => w.startsWith(nq));
  };

  const isLabelMatch = useCallback((post, needles) => {
    if (!needles?.length) return false;
    const hay = buildSearchText(post);
    for (const n of needles) {
      if (similarityScore(n, hay) >= LABEL_MATCH_THRESHOLD) return true;
    }
    return false;
  }, []);

  const scoreLabelMatch = useCallback((post, needles) => {
    if (!needles?.length) return 0;
    const hay = buildSearchText(post);
    let best = 0;
    for (const n of needles) {
      const s = similarityScore(n, hay);
      if (s > best) best = s;
      if (best >= 0.92) break;
    }
    return best;
  }, []);

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
    if (!posts.length) return [];

    // Ad-Free: strip all Ad items before any processing so no ad_prompt cards are generated either
    const postsInput = prefs.premiumAdFree
      ? posts.filter((p) => p.type !== "Ad")
      : posts;

    // Build list in original RPC order; ads become inline prompts when category unknown
    const promptedCategories = new Set();
    let out = postsInput.reduce((acc, p) => {
      const type = String(p.type || "");
      if (!VISIBLE_TYPES.has(type)) return acc;
      if (type === "Article" && !showLocalNews) return acc;
      if (blockedUsers.length && blockedUsers.includes(asAt(p.user))) return acc;

      if (type === "Ad") {
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
              created_at: p.created_at,
            });
          }
        }
        return acc;
      }

      acc.push(p);
      return acc;
    }, []);

    if (selectedDate || timeFilter) {
      out = out.filter((p) => {
        if (p.type === "ad_prompt") return true; // keep prompts through date/time filter
        const type = String(p.type);
        if (type !== "Event") return false;

        if (selectedDate) {
          if (String(p.date).slice(0, 10) !== selectedDate) return false;
        }

        if (timeFilter) {
          const h = parseInt(String(p.time || "").split(":")[0], 10);
          if (Number.isNaN(h)) return false;

          if (timeFilter === "morning") return h >= 6 && h < 12;
          if (timeFilter === "afternoon") return h >= 12 && h < 20;
          if (timeFilter === "night") return h >= 20 || h < 6;
        }

        return true;
      });
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      out = out.filter(
        (p) => p.type === "ad_prompt" || matchesSearchQuery(p, trimmedQuery)
      );
    }

    if (activeLabelNeedles.length) {
      const withLabel = [];
      const without = [];

      out.forEach((p) => {
        if (p.type === "ad_prompt") { without.push(p); return; }
        if (isLabelMatch(p, activeLabelNeedles)) withLabel.push(p);
        else without.push(p);
      });

      withLabel.sort((a, b) => {
        const sa = scoreLabelMatch(a, activeLabelNeedles);
        const sb = scoreLabelMatch(b, activeLabelNeedles);
        return sb - sa;
      });

      out = [...withLabel, ...without];
    } else {
      // Sort chronologically (newest first); ad_prompts use their ad's created_at
      out = [...out].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
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
    timeFilter,
    searchQuery,
    activeLabelNeedles,
    isLabelMatch,
    scoreLabelMatch,
    adMatchesUserTags,
    prefs.premiumAdFree,
  ]);

  const dateLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      })
    : t("filter_any_date");

  const timeLabel =
    timeFilter === "morning"
      ? t("filter_morning_range")
      : timeFilter === "afternoon"
      ? t("filter_afternoon_range")
      : timeFilter === "night"
      ? t("filter_night_range")
      : t("filter_any_time");

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

  const clearTime = () => {
    setTimeFilter(null);
    setShowTimeDropdown(false);
    scrollToTop();
    fetchNearbyPosts();
  };

  const clearSearch = () => {
    setSearchQuery("");
    scrollToTop();
  };

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 90,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (!viewableItems?.length) return;
    const first = viewableItems[0];
    if (first?.item?.id != null) setActivePostId(String(first.item.id));
  }).current;

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

      <FlatList
        ref={scrollRef}
        data={visiblePosts}
        keyExtractor={(item) => String(item.id)}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        removeClippedSubviews
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
              activeLabel={activeLabel}
              onSelect={(name) => {
                setActiveLabel((prev) => (prev === name ? null : name));
                scrollToTop();
              }}
              onChangeLabels={handleChangeLabels}
            />

            <View style={styles.filtersContainer}>
              <View style={styles.filterRow}>
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    isDark
                      ? { backgroundColor: theme.gray, borderColor: "#FFFFFF" }
                      : {
                          backgroundColor: "#FFFFFF",
                          borderColor: "#d9e4f3",
                        },
                  ]}
                  onPress={() => {
                    setShowDateDropdown((p) => !p);
                    setShowTimeDropdown(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Feather
                    name="calendar"
                    size={16}
                    color="#2F91FF"
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.filterText,
                      { color: isDark ? "#FFFFFF" : "#111111" },
                    ]}
                  >
                    {dateLabel}
                  </Text>

                  {selectedDate && (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        clearDate();
                      }}
                      style={{ paddingHorizontal: 4 }}
                    >
                      <Text
                        style={[
                          styles.filterClear,
                          { color: isDark ? "#E0E0E0" : "#9aa6b6" },
                        ]}
                      >
                        ×
                      </Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    { flex: 1 },
                    isDark
                      ? { backgroundColor: theme.gray, borderColor: "#FFFFFF" }
                      : {
                          backgroundColor: "#FFFFFF",
                          borderColor: "#d9e4f3",
                        },
                  ]}
                  onPress={() => {
                    setShowTimeDropdown((p) => !p);
                    setShowDateDropdown(false);
                  }}
                  onLongPress={clearTime}
                  activeOpacity={0.8}
                >
                  <Feather
                    name="clock"
                    size={16}
                    color="#2F91FF"
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.filterText,
                      { color: isDark ? "#FFFFFF" : "#111111" },
                    ]}
                  >
                    {timeLabel}
                  </Text>
                  <Feather
                    name={showTimeDropdown ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={isDark ? "#FFFFFF" : "#6F7D95"}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>
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

              {showTimeDropdown && (
                <ThemedView
                  style={[
                    styles.timeDropdown,
                    {
                      backgroundColor: isDark ? theme.gray : "#FFFFFF",
                      borderColor: isDark ? "#FFFFFF" : "#d9e4f3",
                    },
                  ]}
                >
                  {[
                    { key: null, label: t("filter_any_time") },
                    { key: "morning", label: t("filter_morning_range") },
                    { key: "afternoon", label: t("filter_afternoon_range") },
                    { key: "night", label: t("filter_night_range") },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={String(opt.key)}
                      style={styles.timeOption}
                      onPress={() => {
                        setTimeFilter(opt.key);
                        setShowTimeDropdown(false);
                        scrollToTop();
                        fetchNearbyPosts();
                      }}
                    >
                      <Text
                        style={[
                          styles.timeOptionText,
                          { color: isDark ? "#FFFFFF" : "#111111" },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ThemedView>
              )}

              <View
                style={[
                  styles.searchBarContainer,
                  {
                    backgroundColor: isDark ? theme.gray : "#FFFFFF",
                    borderColor: isDark ? "#FFFFFF" : "#d9e4f3",
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Feather
                  name="search"
                  size={16}
                  color={isDark ? "#FFFFFF" : "#111111"}
                  style={{ marginRight: 6 }}
                />
                <TextInput
                  style={[
                    styles.searchInput,
                    { color: isDark ? "#FFFFFF" : "#111111"},
                  ]}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={language === "it" ? "Cerca eventi" : "Search events"}
                  placeholderTextColor={isDark ? "#FFFFFF" : "#111111"}
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
          </View>
        }
        ListHeaderComponentStyle={styles.headerWrapper}
        ListFooterComponent={<ThemedView variant="gray" style={{ height: 60 }} />}
        ListEmptyComponent={<ThemedView style={{ paddingVertical: 24 }} />}
        renderItem={({ item, index }) => {
          // Inline ad-interest prompt card
          if (item.type === "ad_prompt") {
            return (
              <View style={styles.adPromptCard}>
                <Text style={styles.adPromptTitle}>
                  Are you interested in seeing ads about{" "}
                  <Text style={{ fontWeight: "700" }}>{item.category}</Text>?
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
          }

          const isActive = String(item.id) === String(activePostId);

          const matchLabel =
            activeLabel && activeLabelNeedles.length
              ? isLabelMatch(item, activeLabelNeedles)
              : false;

          const isFirst = index === 0;
          const ovOk =
            isFirst &&
            firstPostOverride &&
            String(firstPostOverride.postId) === String(item.id);

          const effectiveAvatar = ovOk
            ? firstPostOverride.cachedAvatar || item.userpicuri
            : item.userpicuri;
          const effectiveMedia = ovOk
            ? firstPostOverride.cachedMedia || item.postmediauri
            : item.postmediauri;

          return (
            <ThemedView variant="gray" style={styles.feedSection}>
              <Post
                postId={item.id}
                title={item.title}
                description={item.description}
                type={item.type}
                date={item.date}
                time={item.time}
                location={item.location}
                user={item.user}
                userPicUri={effectiveAvatar || "https://placehold.co/48x48"}
                postMediaUri={effectiveMedia}
                postMediaUriHint={item.postmediauri}
                actions={item.actions || []}
                groupName={item.title}
                authorId={item.author_id}
                end_time={item.end_time}
                initialSaved={!!savedMeta[item.id]}
                onToggleSave={toggleSave}
                onDeleted={(id) =>
                  setPosts((prev) => prev.filter((x) => x.id !== id))
                }
                labelTag={matchLabel ? activeLabel : null}
                labelColor={
                  activeLabel
                    ? LABEL_COLORS[labels.indexOf(activeLabel)] ||
                      LABEL_COLORS[LABEL_COLORS.length - 1]
                    : null
                }
                isActive={isActive}
                colors={["#56d1f0", "#00a4e6", "#60affe"]}
              />
            </ThemedView>
          );
        }}
      />

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate("MyTickets")}
        style={[
          styles.ticketsWidget,
          { backgroundColor: "#6C2BD9", borderColor: "rgba(255,255,255,0.35)" },
        ]}
      >
        <Ionicons name="ticket-outline" size={18} color="#fff" />
      </TouchableOpacity>

      <Modal
        visible={vpnBlockVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setVpnBlockVisible(false)}
      >
        <View style={styles.vpnOverlay}>
          <View style={[styles.vpnCard, { backgroundColor: theme.background }]}>
            <View style={styles.vpnHandle} />
            <Feather name="shield-off" size={32} color="#FF4D4D" style={{ marginBottom: 12 }} />
            <Text style={[styles.vpnTitle, { color: theme.text }]}>VPN Detected</Text>
            <Text style={[styles.vpnBody, { color: theme.secondaryText }]}>
              Community shows real nearby events based on your location. Please turn off your VPN to continue.
            </Text>
            <TouchableOpacity
              style={styles.vpnBtn}
              onPress={() => checkVPN().then((still) => { if (!still) setVpnBlockVisible(false); })}
            >
              <Text style={styles.vpnBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.vpnTravelerBtn}
              onPress={() => { setVpnBlockVisible(false); navigation.navigate("Settings"); }}
            >
              <Text style={[styles.vpnTravelerText, { color: theme.secondaryText }]}>
                Want to browse another city? Try Traveler Mode →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    borderWidth: 1,
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
    borderWidth: 1,
    zIndex: 40,
    paddingLeft: 5,
    paddingRight: 5,
    fontFamily: "Poppins",
  },

  timeDropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    paddingTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 40,
  },
  timeOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  timeOptionText: {
    fontSize: 13,
    fontFamily: "Poppins",
  },

  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,    
    fontFamily: "Poppins",
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,    
    fontFamily: "Poppins",
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
    bottom: 86,
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
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
    backgroundColor: "#FFFFFF",
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
    fontFamily: "Poppins",
    fontSize: 15,
    fontWeight: "600",
  },

  vpnOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  vpnCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, alignItems: "center" },
  vpnHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#ddd", marginBottom: 16 },
  vpnTitle: { fontFamily: "Poppins", fontWeight: "700", fontSize: 20, marginBottom: 8 },
  vpnBody: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: 24, opacity: 0.75 },
  vpnBtn: { backgroundColor: "#2F91FF", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, marginBottom: 12 },
  vpnBtnText: { color: "#fff", fontFamily: "Poppins", fontWeight: "700", fontSize: 15 },
  vpnTravelerBtn: { paddingVertical: 8 },
  vpnTravelerText: { fontFamily: "Poppins", fontSize: 13, textAlign: "center" },
});
