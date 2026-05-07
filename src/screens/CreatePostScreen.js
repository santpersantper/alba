// CreatePostScreen.js
// Visual refresh to match AdPublisherScreen aesthetic.
// Logic is unchanged from previous version.
// Ad tracking: fires a belt-and-suspenders ad_stats INSERT when type=Ad
// (DB trigger trg_create_ad_stats handles it too; both are safe with ON CONFLICT DO NOTHING).

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Image,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
  Modal, Platform, KeyboardAvoidingView, FlatList, Switch, Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useFonts } from "expo-font";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import EventPanel from "../components/EventPanel";
import AdPanel from "../components/AdPanel";
import * as ImageManipulator from "expo-image-manipulator";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { useAlbaTheme } from "../theme/ThemeContext";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { posthog } from "../lib/analytics";
import { userErrorMessage } from "../lib/errorUtils";

/* ── Post type definitions ──────────────────────────────────────── */
const POST_TYPES = [
  { key: "event",       labelKey: "create_post_post_type_event",    label: "Event",        icon: "calendar"  },
  { key: "ad",          labelKey: "create_post_post_type_ad",        label: "Ad",           icon: "speaker"   },
  { key: "article",     labelKey: "create_post_post_type_article",   label: "Article",      icon: "file-text" },
  { key: "profilePost", labelKey: "create_post_post_type_profile",   label: "Profile Post", icon: "user"      },
  { key: "feedPost",    labelKey: "create_post_post_type_feedPost",  label: "Feed Video",   icon: "video"     },
];

/* ── Constants & helpers ────────────────────────────────────────── */
const BUCKET = "alba-media";
const MAX_VIDEO_SECONDS = 20;

const FEED_TAGS = [
  "Music", "Art", "Food", "Travel", "Sports", "Fitness",
  "Gaming", "Fashion", "Comedy", "Dance", "Nature", "Tech",
  "Film", "Education", "Lifestyle", "Pets",
];

const DAYS_OF_WEEK = [
  { key: "Mon", dayKey: "day_mon" },
  { key: "Tue", dayKey: "day_tue" },
  { key: "Wed", dayKey: "day_wed" },
  { key: "Thu", dayKey: "day_thu" },
  { key: "Fri", dayKey: "day_fri" },
  { key: "Sat", dayKey: "day_sat" },
  { key: "Sun", dayKey: "day_sun" },
];

const stripDiacritics = (s) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const URL_REGEX = /https?:\/\/|www\./i;

const normalizeDurationSeconds = (d) => {
  if (typeof d !== "number" || !Number.isFinite(d)) return null;
  return d > 1000 ? d / 1000 : d; // expo-image-picker sometimes returns ms
};

const uniq = (arr) => {
  const out = [];
  const seen = new Set();
  (arr || []).forEach((x) => {
    const v = String(x || "").trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out;
};

const canonicalRequiredKey = (raw) => {
  const s0 = String(raw || "").trim();
  if (!s0) return null;
  const s = stripDiacritics(s0).toLowerCase();
  if (s === "nome") return "name";
  if (s === "eta" || s === "età") return "age";
  if (s === "genere") return "gender";
  if (s === "citta" || s === "città") return "city";
  if (s === "email") return "email";
  if (s === "nome utente" || s === "utente") return "username";
  if (s === "name") return "name";
  if (s === "age") return "age";
  if (s === "gender") return "gender";
  if (s === "city") return "city";
  if (s === "username") return "username";
  return null;
};

const normalizeRequiredInfoInput = (text) => {
  const parts = String(text || "").split(",").map((x) => x.trim()).filter(Boolean);
  return uniq(parts.map((p) => canonicalRequiredKey(p) || p));
};

/* ── Mention helpers ─────────────────────────────────────────────── */
function getActiveMention(text) {
  const m = text.match(/@([\w.]*)$/);
  return m ? m[1] : null;
}
function applyMention(text, query, username) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`@${escaped}$`), `@${username} `);
}

/* ── Screen ─────────────────────────────────────────────────────── */
export default function CreatePost() {
  const navigation = useNavigation();
  const route = useRoute();
  const editPost = route.params?.editPost ?? null; // pre-filled for edit mode
  const prefillPost = route.params?.prefillPost ?? null; // pre-filled for "Repeat" flow
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const tr = (key, fallback) => {
    const s = t?.(key);
    return !s || s === key ? fallback : s;
  };

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });
  useFocusEffect(useCallback(() => { posthog.screen("Create Post"); }, []));
  if (!fontsLoaded) return null;

  /* ── state ── */
  const [title,    setTitle]    = useState(editPost?.title    ?? "");
  const [desc,     setDesc]     = useState(editPost?.description ?? "");
  const [postType, setPostType] = useState(() => {
    const src = editPost?.type || prefillPost?.type || "";
    if (!src) return "event";
    const s = src.toLowerCase();
    if (s === "event")      return "event";
    if (s === "ad")         return "ad";
    if (s === "article")    return "article";
    if (s === "product")    return "product";
    if (s === "profilepost" || s === "profile post") return "profilePost";
    if (s === "feedpost"    || s === "feed post")    return "feedPost";
    return "event";
  });

  // @ mention autocomplete
  const [mentionQuery,   setMentionQuery]   = useState(null); // string after @, or null
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionField,   setMentionField]   = useState(null); // "title" | "desc"
  const mentionDebounceRef = useRef(null);

  // Collaborators
  const [collaborators,       setCollaborators]       = useState(
    Array.isArray(editPost?.collaborators) ? editPost.collaborators : []
  ); // array of usernames
  const [collabInput,         setCollabInput]         = useState("");
  const [collabResults,       setCollabResults]       = useState([]);
  const collabDebounceRef = useRef(null);

  const [eventState, setEventState] = useState({
    enableGroupChat: true, allowTicketing: false, tickets: [],
    allowSubgroups: true, allowInvites: true,
  });
  // Ref mirrors eventState so handleSubmit always reads the latest value
  // even if a concurrent re-render (e.g. language context loading) caused
  // the state update from EventPanel's useEffect to be lost.
  const eventStateRef = useRef(null);
  const setEventStateSafe = useCallback((next) => {
    eventStateRef.current = next;
    setEventState(next);
  }, []);

  const [adState, setAdState] = useState({
    targetInterested: true, iap: false, products: [],
  });

  const [media,        setMedia]        = useState(
    editPost?.mediaUrls
      ? editPost.mediaUrls.map((uri) => ({ uri, type: /\.(mp4|mov|m4v)$/i.test(uri) ? "video" : "image", isNew: false }))
      : []
  );
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [successModal, setSuccessModal] = useState({ visible: false, title: "", message: "" });

  const [selectedDate,    setSelectedDate]    = useState(editPost?.date    ?? null);
  const [showDatePicker,  setShowDatePicker]  = useState(false);
  const [selectedTime,    setSelectedTime]    = useState(editPost?.time    ?? null);
  const [showTimePicker,  setShowTimePicker]  = useState(false);
  const [selectedEndDate,    setSelectedEndDate]    = useState(editPost?.endDate ?? null);
  const [showEndDatePicker,  setShowEndDatePicker]  = useState(false);
  const [selectedEndTime,    setSelectedEndTime]    = useState(editPost?.endTime ?? null);
  const [showEndTimePicker,  setShowEndTimePicker]  = useState(false);
  const [allDay,          setAllDay]          = useState(editPost?.all_day ?? false);
  const [everyDay,        setEveryDay]        = useState(editPost?.every_day ?? false);
  const [isOnline,        setIsOnline]        = useState(editPost?.online ?? false);
  const initRepeatDays = Array.isArray(editPost?.repeat_days ?? prefillPost?.repeat_days)
    ? (editPost?.repeat_days ?? prefillPost?.repeat_days)
    : [];
  const [isPeriodic,      setIsPeriodic]      = useState(initRepeatDays.length > 0);
  const [repeatDays,      setRepeatDays]      = useState(initRepeatDays);
  const prefillAppliedRef = useRef(false);

  const [typeDropdownOpen,    setTypeDropdownOpen]    = useState(false);

  const [locationText,        setLocationText]        = useState(editPost?.location ?? "");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const locationDebounceRef = useRef(null);
  const userCoordsRef = useRef(null);
  const locationSessionToken = useRef(null);

  // Silently pre-fetch last-known position so proximity biasing works immediately
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getLastKnownPositionAsync({});
        if (pos?.coords) userCoordsRef.current = pos.coords;
      } catch {}
    })();
  }, []);

  // Fetch Stripe status once on mount for the event wizard disclaimer
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid || !mounted) return;
        setStripeUserId(uid);
        const { data } = await supabase
          .from("profiles")
          .select("stripe_account_id, stripe_onboarding_complete")
          .eq("id", uid)
          .maybeSingle();
        if (!mounted) return;
        if (!data?.stripe_account_id)        setStripeStatus("not_started");
        else if (data.stripe_onboarding_complete) setStripeStatus("complete");
        else                                      setStripeStatus("pending");
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Reset wizard whenever the user switches away from Event and back.
  // Skipped if a prefill has already set the wizard (prefillAppliedRef guard).
  useEffect(() => {
    if (postType === "event") {
      if (prefillAppliedRef.current) return;
      setWizardStep(0);
      setWizardAnswers({
        multipleTypes: null, ticketTypesText: "", prices: {}, notes: {},
        fixedTickets: null,  ticketCounts: {},
        requireInfo: null,   requiredInfoText: "",
        exclusive: null,     approvalInfoText: "",
        ageRestricted: null,
      });
      setWizardComplete(false);
    }
  }, [postType]);

  // Apply state from a "Repeat" prefill when navigating back from PastEventsScreen
  useEffect(() => {
    const prefill = route.params?.prefillPost;
    console.log("[CreatePost] prefillPost param changed:", prefill ? `title="${prefill.title}" _ts=${prefill._ts}` : "null/undefined");
    if (!prefill) return;
    prefillAppliedRef.current = true;
    console.log("[CreatePost] applying prefill...");

    setTitle(prefill.title ?? "");
    setDesc(prefill.description ?? "");
    setSelectedTime(prefill.time ?? null);
    setSelectedEndTime(prefill.endTime ?? null);
    setAllDay(prefill.all_day ?? false);
    const nextEvery = prefill.every_day ?? false;
    const rdays = Array.isArray(prefill.repeat_days) ? prefill.repeat_days : [];
    setEveryDay(nextEvery);
    setIsPeriodic(rdays.length > 0);
    setRepeatDays(rdays);
    setIsOnline(prefill.online ?? false);
    setLocationText(prefill.location ?? "");
    setCollaborators(Array.isArray(prefill.collaborators) ? prefill.collaborators : []);
    setMedia((prefill.mediaUrls || []).map((uri) => ({
      uri,
      type: /\.(mp4|mov|m4v)$/i.test(uri) ? "video" : "image",
      isNew: false,
    })));

    const s = (prefill.type || "").toLowerCase();
    const mappedType = s === "event" ? "event"
      : s === "ad" ? "ad"
      : s === "article" ? "article"
      : "event";
    setPostType(mappedType);

    if (mappedType === "event") {
      const types = Array.isArray(prefill.product_types) && prefill.product_types.length > 0
        ? prefill.product_types : ["General"];
      const prices = {};
      const notes = {};
      types.forEach((tp, i) => {
        prices[tp] = String(prefill.product_prices?.[i] ?? 0);
        notes[tp] = prefill.product_notes?.[i] ?? "";
      });
      setWizardAnswers({
        multipleTypes: types.length > 1 ? true : false,
        ticketTypesText: types.length > 1 ? types.join(", ") : "",
        prices,
        notes,
        fixedTickets: prefill.is_ticket_number_fixed ?? false,
        ticketCounts: {},
        requireInfo: Array.isArray(prefill.required_info) && prefill.required_info.length > 0,
        requiredInfoText: (Array.isArray(prefill.required_info) ? prefill.required_info : []).join(", "),
        exclusive: prefill.manually_approve_attendees ?? false,
        approvalInfoText: prefill.ticket_approval_info ?? "",
        ageRestricted: prefill.is_age_restricted ?? false,
      });
      setWizardComplete(true);
    }
    navigation.setParams({ prefillPost: undefined });
  }, [route.params?.prefillPost?._ts, route.params?.prefillPost]); // eslint-disable-line react-hooks/exhaustive-deps

  const [adNotes,  setAdNotes]  = useState("");
  const [feedTags, setFeedTags] = useState([]);

  // ── Event wizard ──────────────────────────────────────────────────
  const [wizardStep,     setWizardStep]     = useState(0);
  const [wizardAnswers,  setWizardAnswers]  = useState({
    multipleTypes:    null,  // Q1
    ticketTypesText:  "",    // Q1 yes branch
    prices:           {},    // Q2  { [typeName]: string }
    notes:            {},    // Q2  { [typeName]: string }
    fixedTickets:     null,  // Q3
    ticketCounts:     {},    // Q3 yes branch { [typeName]: string }
    requireInfo:      null,  // Q4
    requiredInfoText: "",    // Q4 yes branch
    exclusive:        null,  // Q5
    approvalInfoText: "",    // Q5 yes branch
    ageRestricted:    null,  // Q6
  });
  const [wizardComplete, setWizardComplete] = useState(false);
  const [stripeStatus,   setStripeStatus]   = useState(null); // null | "not_started" | "pending" | "complete"
  const [stripeLoading,  setStripeLoading]  = useState(false);
  const [stripeUserId,   setStripeUserId]   = useState(null);

  /* ── derived booleans (used in both handleSubmit and JSX) ── */
  const isEvent    = postType === "event";
  const isAd       = postType === "ad";
  const isProduct  = postType === "product";
  const isFeedPost = postType === "feedPost";

  /* ── event group creation ── */
  const createEventGroup = async ({ groupname, group_desc, group_pic_link, username }) => {
    const { error } = await supabase.from("groups").insert({
      groupname: (groupname || "").trim(),
      group_desc: group_desc?.trim() || null,
      group_pic_link: group_pic_link || null,
      members: [username],
      subgroups_allowed: true,
      subgroups: [],
      group_admin: [username],
      is_subgroup_of: null,
    });
    if (error) throw error;
  };

  /* ── media pick ── */
  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert(t("create_post_error_media_permission")); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isFeedPost ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: isFeedPost,
      allowsEditing: !isFeedPost,
      aspect: [4, 3],
      quality: 0.9,
      selectionLimit: isFeedPost ? 10 : 1,
    });
    if (result.canceled) return;

    const assets = result.assets || [];
    const tooLong = assets.filter((a) => {
      if (a.type !== "video") return false;
      const d = normalizeDurationSeconds(a.duration);
      return typeof d === "number" && d > MAX_VIDEO_SECONDS;
    });
    if (tooLong.length > 0) {
      Alert.alert(
        tr("create_post_error_video_too_long_title", "Video too long"),
        tr("create_post_error_video_too_long_message", `Please pick videos that are ${MAX_VIDEO_SECONDS} seconds or less.`)
      );
    }

    const picked = assets
      .filter((a) => {
        if (a.type !== "video") return true;
        const d = normalizeDurationSeconds(a.duration);
        return d == null || d <= MAX_VIDEO_SECONDS;
      })
      .map((a) => {
        const d = a.type === "video" ? normalizeDurationSeconds(a.duration) : null;
        return {
          uri: a.uri,
          type: a.type === "video" ? "video" : "image",
          durationSec: typeof d === "number" ? d : null,
          width: a.width ?? null, height: a.height ?? null, fileSize: a.fileSize ?? null,
        };
      });
    if (picked.length) setMedia((prev) => [...prev, ...picked]);
  };

  const pickThumbnail = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert(t("create_post_error_media_permission")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) setThumbnailUri(asset.uri);
  };

  /* ── upload helpers ── */
  const ensureDisplayableImage = async (fileUri) => {
    const lower = (fileUri || "").toLowerCase();
    if (!lower.endsWith(".heic") && !lower.includes(".heic?"))
      return { uri: fileUri, contentType: "image/jpeg", ext: "jpg" };
    try {
      const manip = await ImageManipulator.manipulateAsync(
        fileUri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      return { uri: manip.uri, contentType: "image/jpeg", ext: "jpg" };
    } catch {
      return { uri: fileUri, contentType: "image/heic", ext: "heic" };
    }
  };

  const uploadOne = async ({ postId, fileUri, index, kind }) => {
    const lower = (fileUri || "").toLowerCase();
    let ext = lower.endsWith(".png") ? "png"
      : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "jpg"
      : lower.endsWith(".heic") ? "heic"
      : lower.endsWith(".mp4") ? "mp4"
      : lower.endsWith(".mov") ? "mov"
      : kind === "video" ? "mp4" : "jpg";

    let toUploadUri = fileUri;
    let contentType = ext === "png" ? "image/png"
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "heic" ? "image/heic"
      : ext === "mp4" ? "video/mp4"
      : ext === "mov" ? "video/quicktime"
      : kind === "video" ? "video/mp4" : "image/jpeg";

    if (kind === "image" && ext === "heic") {
      const converted = await ensureDisplayableImage(fileUri);
      toUploadUri = converted.uri;
      contentType = converted.contentType;
      ext = converted.ext;
    }

    const key = `posts/${postId}/media_${index}.${ext}`;
    const res = await fetch(toUploadUri);
    const fileBytes = new Uint8Array(await res.arrayBuffer());
    const { error } = await supabase.storage.from(BUCKET).upload(key, fileBytes, {
      contentType, cacheControl: "31536000", upsert: true,
    });
    if (error) throw error;
    return supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
  };

  /* ── date / time labels ── */
  const dateLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : t("create_post_any_date");
  const timeLabel = selectedTime ? selectedTime.slice(0, 5) : t("create_post_any_time");
  const endDateLabel = selectedEndDate
    ? new Date(selectedEndDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : t("create_post_end_date_placeholder");
  const endTimeLabel = selectedEndTime ? selectedEndTime.slice(0, 5) : t("create_post_end_time_placeholder");

  const timeStringToDate = (s) => {
    const [h, m, sec] = s.split(":").map((x) => parseInt(x || "0", 10));
    const d = new Date(); d.setHours(h || 0, m || 0, sec || 0, 0); return d;
  };
  const handleDateChange = (_, date) => {
    setShowDatePicker(false);
    if (date) setSelectedDate(date.toISOString().slice(0, 10));
  };
  const handleTimeChange = (_, date) => {
    setShowTimePicker(false);
    if (date) setSelectedTime(date.toTimeString().slice(0, 8));
  };
  const handleEndDateChange = (_, date) => {
    setShowEndDatePicker(false);
    if (date) setSelectedEndDate(date.toISOString().slice(0, 10));
  };
  const handleEndTimeChange = (_, date) => {
    setShowEndTimePicker(false);
    if (date) setSelectedEndTime(date.toTimeString().slice(0, 8));
  };

  /* ── collaborator search ── */
  const searchCollaborators = useCallback((query) => {
    if (collabDebounceRef.current) clearTimeout(collabDebounceRef.current);
    if (!query || query.length < 1) { setCollabResults([]); return; }
    collabDebounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("username, name")
          .ilike("username", `${query}%`)
          .eq("allows_collab", true)
          .limit(8);
        setCollabResults((data || []).filter((u) => !collaborators.includes(u.username)));
      } catch { setCollabResults([]); }
    }, 250);
  }, [collaborators]);

  const addCollaborator = (username) => {
    if (!collaborators.includes(username)) setCollaborators((prev) => [...prev, username]);
    setCollabInput("");
    setCollabResults([]);
  };

  const removeCollaborator = (username) => {
    setCollaborators((prev) => prev.filter((u) => u !== username));
  };

  /* ── reset ── */
  const resetForm = () => {
    prefillAppliedRef.current = false;
    setTitle(""); setDesc(""); setMedia([]); setPostType("event");
    setEventState({ enableGroupChat: true, allowTicketing: false, tickets: [], allowSubgroups: true, allowInvites: true });
    setAdState({ targetInterested: true, iap: false, products: [] });
    setSelectedDate(null); setSelectedTime(null);
    setSelectedEndDate(null); setSelectedEndTime(null);
    setAllDay(false);
    setEveryDay(false);
    setIsPeriodic(false); setRepeatDays([]);
    setLocationText(""); setLocationSuggestions([]); locationSessionToken.current = null;
    setAdNotes(""); setThumbnailUri(null); setFeedTags([]);
    setCollaborators([]); setCollabInput(""); setCollabResults([]);
  };

  /* ── @ mention search ── */
  const searchMentions = useCallback((query) => {
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
    if (!query) { setMentionResults([]); return; }
    mentionDebounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("username, name")
          .ilike("username", `${query}%`)
          .eq("allow_tags", true)
          .limit(8);
        setMentionResults(data || []);
      } catch { setMentionResults([]); }
    }, 250);
  }, []);

  const handleTitleChange = (v) => {
    setTitle(v);
    const q = getActiveMention(v);
    if (q !== null) { setMentionField("title"); setMentionQuery(q); searchMentions(q); }
    else { setMentionQuery(null); setMentionResults([]); }
  };

  const handleDescChange = (v) => {
    setDesc(v);
    const q = getActiveMention(v);
    if (q !== null) { setMentionField("desc"); setMentionQuery(q); searchMentions(q); }
    else { setMentionQuery(null); setMentionResults([]); }
  };

  const onSelectMention = (username) => {
    if (mentionField === "title") setTitle(applyMention(title, mentionQuery, username));
    else setDesc(applyMention(desc, mentionQuery, username));
    setMentionResults([]);
    setMentionQuery(null);
    setMentionField(null);
  };

  /* ── Collaborators renderer (shared by events + other post types) ── */
  const renderCollaborators = (zIndex = 6) => (
    <>
      <Text style={[cs.sectionLabel, { color: subtle }]}>{t("create_post_collaborators_label") || "Collaborators"}</Text>
      {collaborators.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {collaborators.map((u) => (
            <View key={u} style={{ flexDirection: "row", alignItems: "center", backgroundColor: isDark ? "#2a2a2a" : "#eef4ff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: isDark ? "#aad4ff" : "#1a6fd4", fontFamily: "Poppins", fontSize: 13 }}>@{u}</Text>
              <TouchableOpacity onPress={() => removeCollaborator(u)} style={{ marginLeft: 6 }} hitSlop={8}>
                <Feather name="x" size={12} color={isDark ? "#aaa" : "#666"} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <View style={{ position: "relative", zIndex }}>
        <View style={[cs.inputWrap, { borderColor: theme.border, backgroundColor: inputBg }]}>
          <Feather name="users" size={15} color="#2F91FF" style={{ marginRight: 8 }} />
          <TextInput
            placeholder={t("create_post_collaborators_placeholder") || "Search users to collaborate…"}
            placeholderTextColor={subtle}
            value={collabInput}
            onChangeText={(v) => { setCollabInput(v); searchCollaborators(v); }}
            style={[cs.input, { color: theme.text }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!collabInput && (
            <TouchableOpacity onPress={() => { setCollabInput(""); setCollabResults([]); }} hitSlop={8}>
              <Feather name="x" size={14} color={subtle} />
            </TouchableOpacity>
          )}
        </View>
        {collabResults.length > 0 && (
          <View style={[cs.suggestionsBox, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#ddd" }]}>
            {collabResults.map((u) => (
              <TouchableOpacity key={u.username} style={cs.suggestionItem} onPress={() => addCollaborator(u.username)}>
                <Feather name="user" size={13} color="#2F91FF" style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[cs.suggestionText, { color: theme.text }]}>@{u.username}</Text>
                  {!!u.name && <Text style={[cs.suggestionText, { color: subtle, fontSize: 12 }]}>{u.name}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </>
  );

  /* ── Stripe connect (event wizard) ── */
  const handleStripeConnect = async () => {
    if (stripeLoading || !stripeUserId) return;
    try {
      setStripeLoading(true);
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "onboard-profile", userId: stripeUserId },
      });
      if (error) throw new Error(error.message || "Failed to start onboarding");
      if (!data?.url) throw new Error("No onboarding URL received");
      posthog.capture("stripe_connect_started");
      await Linking.openURL(data.url);
      setTimeout(async () => {
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("stripe_account_id, stripe_onboarding_complete")
            .eq("id", stripeUserId)
            .maybeSingle();
          if (!prof?.stripe_account_id)            setStripeStatus("not_started");
          else if (prof.stripe_onboarding_complete) { setStripeStatus("complete"); posthog.capture("stripe_connected"); }
          else                                      setStripeStatus("pending");
        } catch {}
      }, 3000);
    } catch (e) {
      Alert.alert("Error", e.message || "Could not start payout setup. Please try again.");
    } finally {
      setStripeLoading(false);
    }
  };

  /* ── Wizard helpers ── */
  const resetWizardFromStep = (step) => {
    const u = {};
    if (step <= 0) { u.multipleTypes = null;  u.ticketTypesText = ""; }
    if (step <= 1) { u.prices = {}; }
    if (step <= 2) { u.fixedTickets = null;  u.ticketCounts = {}; }
    if (step <= 3) { u.requireInfo = null;   u.requiredInfoText = ""; }
    if (step <= 4) { u.exclusive = null;     u.approvalInfoText = ""; }
    if (step <= 5) { u.ageRestricted = null; }
    setWizardAnswers((prev) => ({ ...prev, ...u }));
    setWizardComplete(false);
  };

  const wizardGoBack = () => {
    if (wizardStep === 0) return;
    const prev = wizardStep - 1;
    resetWizardFromStep(prev);
    setWizardStep(prev);
  };

  /* ── Wizard step renderer ── */
  const renderWizardStep = () => {
    const wa = wizardAnswers;
    const ticketTypes = wa.multipleTypes === false
      ? ["General"]
      : wa.ticketTypesText.split(",").map((s) => s.trim()).filter(Boolean);
    const hasNonZeroPrice = ticketTypes.some((t) => {
      const p = parseFloat(String(wa.prices[t] || "0").replace(",", "."));
      return Number.isFinite(p) && p > 0;
    });
    const needsStripe = hasNonZeroPrice && stripeStatus !== "complete";

    const inputStyle = [cs.wizardInputWrap, {
      backgroundColor: isDark ? "#1a2a3a" : "#fff",
      borderColor: isDark ? "#2a4a6a" : "#b3d4ff",
    }];
    const noBorderColor = isDark ? "#444" : "#d0d7e2";

    switch (wizardStep) {
      case 0:
        return (
          <View>
            <Text style={[cs.wizardQuestion, { color: theme.text }]}>
              {tr("event_wizard_q1", "Is there more than one ticket type? For example: 'General' and 'VIP'.")}
            </Text>
            <View style={cs.wizardBtnRow}>
              <TouchableOpacity
                style={[cs.wizardYesBtn, wa.multipleTypes === true && cs.wizardBtnActive]}
                onPress={() => setWizardAnswers((p) => ({ ...p, multipleTypes: true }))}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.multipleTypes === true && { color: "#fff" }]}>
                  {tr("confirm_yes", "Yes")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.wizardNoBtn, { borderColor: noBorderColor }, wa.multipleTypes === false && cs.wizardBtnActive]}
                onPress={() => {
                  setWizardAnswers((p) => ({ ...p, multipleTypes: false, ticketTypesText: "", prices: { General: p.prices?.General || "" }, notes: { General: p.notes?.General || "" } }));
                  setWizardStep(1);
                }}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.multipleTypes === false && { color: "#fff" }]}>
                  {tr("confirm_no", "No")}
                </Text>
              </TouchableOpacity>
            </View>
            {wa.multipleTypes === true && (
              <>
                <Text style={[cs.wizardInputLabel, { color: subtle }]}>
                  {tr("event_wizard_q1_list_label", "List your ticket types")}
                </Text>
                <View style={inputStyle}>
                  <TextInput
                    placeholder={tr("event_wizard_q1_placeholder", "General, VIP...")}
                    placeholderTextColor={subtle}
                    value={wa.ticketTypesText}
                    onChangeText={(v) => setWizardAnswers((p) => ({ ...p, ticketTypesText: v }))}
                    style={[cs.input, { color: theme.text }]}
                  />
                </View>
                <TouchableOpacity
                  style={[cs.wizardNextBtn, { opacity: wa.ticketTypesText.trim() ? 1 : 0.4 }]}
                  onPress={() => { if (wa.ticketTypesText.trim()) setWizardStep(1); }}
                  activeOpacity={0.8}
                >
                  <Text style={cs.wizardNextBtnText}>{tr("event_wizard_next", "Next")}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );

      case 1:
        return (
          <View>
            <Text style={[cs.wizardQuestion, { color: theme.text }]}>
              {tr("event_wizard_q2", "How much do tickets cost?")}
            </Text>
            {ticketTypes.map((typeName) => (
              <View key={typeName} style={{ marginBottom: 10 }}>
                {ticketTypes.length > 1 && (
                  <Text style={[cs.wizardInputLabel, { color: subtle }]}>{typeName}</Text>
                )}
                <View style={[inputStyle, { flexDirection: "row", alignItems: "center" }]}>
                  <Text style={{ color: subtle, fontFamily: "Poppins", fontSize: 14, marginRight: 4 }}>€</Text>
                  <TextInput
                    placeholder="0"
                    placeholderTextColor={subtle}
                    value={wa.prices[typeName] ?? ""}
                    onChangeText={(v) => setWizardAnswers((p) => ({ ...p, prices: { ...p.prices, [typeName]: v } }))}
                    style={[cs.input, { color: theme.text }]}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={[cs.wizardInputLabel, { color: subtle, marginTop: 6 }]}>
                  {tr("ticket_type_notes_label", "Add notes to this ticket type (optional)")}
                </Text>
                <TextInput
                  placeholder={tr("ticket_type_notes_placeholder", "Ex: free entry + one drink")}
                  placeholderTextColor={subtle}
                  value={wa.notes[typeName] ?? ""}
                  onChangeText={(v) => setWizardAnswers((p) => ({ ...p, notes: { ...p.notes, [typeName]: v } }))}
                  style={[cs.input, { color: theme.text, borderBottomWidth: 1, borderBottomColor: subtle, paddingVertical: 6 }]}
                />
              </View>
            ))}
            {needsStripe && (
              <View style={cs.stripeWarning}>
                <Text style={cs.stripeWarningText}>
                  {tr("event_wizard_stripe_warning", "Connect your Stripe account to receive payments")}
                </Text>
                <TouchableOpacity
                  style={cs.stripeConnectBtn}
                  onPress={handleStripeConnect}
                  disabled={stripeLoading}
                  activeOpacity={0.8}
                >
                  {stripeLoading
                    ? <ActivityIndicator size="small" color="#EF4444" />
                    : <Text style={cs.stripeConnectBtnText}>{tr("event_wizard_stripe_connect", "Connect")}</Text>
                  }
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={cs.wizardNextBtn} onPress={() => setWizardStep(2)} activeOpacity={0.8}>
              <Text style={cs.wizardNextBtnText}>{tr("event_wizard_next", "Next")}</Text>
            </TouchableOpacity>
          </View>
        );

      case 2:
        return (
          <View>
            <Text style={[cs.wizardQuestion, { color: theme.text }]}>
              {tr("event_wizard_q3", "Are you selling a fixed number of tickets?")}
            </Text>
            <View style={cs.wizardBtnRow}>
              <TouchableOpacity
                style={[cs.wizardYesBtn, wa.fixedTickets === true && cs.wizardBtnActive]}
                onPress={() => setWizardAnswers((p) => ({ ...p, fixedTickets: true }))}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.fixedTickets === true && { color: "#fff" }]}>
                  {tr("confirm_yes", "Yes")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.wizardNoBtn, { borderColor: noBorderColor }, wa.fixedTickets === false && cs.wizardBtnActive]}
                onPress={() => {
                  setWizardAnswers((p) => ({ ...p, fixedTickets: false, ticketCounts: {} }));
                  setWizardStep(3);
                }}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.fixedTickets === false && { color: "#fff" }]}>
                  {tr("confirm_no", "No")}
                </Text>
              </TouchableOpacity>
            </View>
            {wa.fixedTickets === true && (
              <>
                {ticketTypes.map((typeName) => (
                  <View key={typeName} style={{ marginBottom: 8 }}>
                    <Text style={[cs.wizardInputLabel, { color: subtle }]}>
                      {ticketTypes.length === 1
                        ? tr("event_wizard_q3_how_many_single", "How many tickets?")
                        : tr("event_wizard_q3_how_many", "How many {type} tickets?").replace("{type}", typeName)}
                    </Text>
                    <View style={inputStyle}>
                      <TextInput
                        placeholderTextColor={subtle}
                        value={wa.ticketCounts[typeName] ?? ""}
                        onChangeText={(v) => setWizardAnswers((p) => ({ ...p, ticketCounts: { ...p.ticketCounts, [typeName]: v } }))}
                        style={[cs.input, { color: theme.text }]}
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>
                ))}
                <TouchableOpacity
                  style={[cs.wizardNextBtn, {
                    opacity: ticketTypes.length > 0 && ticketTypes.every((t) => parseInt(wa.ticketCounts[t] || "0", 10) > 0) ? 1 : 0.4,
                  }]}
                  onPress={() => {
                    if (ticketTypes.every((t) => parseInt(wa.ticketCounts[t] || "0", 10) > 0)) setWizardStep(3);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={cs.wizardNextBtnText}>{tr("event_wizard_next", "Next")}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );

      case 3:
        return (
          <View>
            <Text style={[cs.wizardQuestion, { color: theme.text }]}>
              {tr("event_wizard_q4", "Do you require personal info from ticket buyers? For example name, age, etc.")}
            </Text>
            <View style={cs.wizardBtnRow}>
              <TouchableOpacity
                style={[cs.wizardYesBtn, wa.requireInfo === true && cs.wizardBtnActive]}
                onPress={() => setWizardAnswers((p) => ({ ...p, requireInfo: true }))}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.requireInfo === true && { color: "#fff" }]}>
                  {tr("confirm_yes", "Yes")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.wizardNoBtn, { borderColor: noBorderColor }, wa.requireInfo === false && cs.wizardBtnActive]}
                onPress={() => {
                  setWizardAnswers((p) => ({
                    ...p, requireInfo: false, requiredInfoText: "",
                    exclusive: null, approvalInfoText: "", ageRestricted: null,
                  }));
                  setWizardComplete(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.requireInfo === false && { color: "#fff" }]}>
                  {tr("confirm_no", "No")}
                </Text>
              </TouchableOpacity>
            </View>
            {wa.requireInfo === true && (
              <>
                <Text style={[cs.wizardInputLabel, { color: subtle }]}>
                  {tr("event_wizard_q4_what_info", "What info do you need?")}
                </Text>
                <View style={inputStyle}>
                  <TextInput
                    placeholder={tr("event_wizard_q4_placeholder", "name, age, etc.")}
                    placeholderTextColor={subtle}
                    value={wa.requiredInfoText}
                    onChangeText={(v) => setWizardAnswers((p) => ({ ...p, requiredInfoText: v }))}
                    style={[cs.input, { color: theme.text }]}
                  />
                </View>
                <TouchableOpacity
                  style={[cs.wizardNextBtn, { opacity: wa.requiredInfoText.trim() ? 1 : 0.4 }]}
                  onPress={() => { if (wa.requiredInfoText.trim()) setWizardStep(4); }}
                  activeOpacity={0.8}
                >
                  <Text style={cs.wizardNextBtnText}>{tr("event_wizard_next", "Next")}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );

      case 4:
        return (
          <View>
            <Text style={[cs.wizardQuestion, { color: theme.text }]}>
              {tr("event_wizard_q5", "Is this an exclusive event? For example, for Bocconi students or ARCI members only.")}
            </Text>
            <View style={cs.wizardBtnRow}>
              <TouchableOpacity
                style={[cs.wizardYesBtn, wa.exclusive === true && cs.wizardBtnActive]}
                onPress={() => setWizardAnswers((p) => ({ ...p, exclusive: true }))}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.exclusive === true && { color: "#fff" }]}>
                  {tr("confirm_yes", "Yes")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.wizardNoBtn, { borderColor: noBorderColor }, wa.exclusive === false && cs.wizardBtnActive]}
                onPress={() => {
                  setWizardAnswers((p) => ({ ...p, exclusive: false, approvalInfoText: "" }));
                  setWizardStep(5);
                }}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.exclusive === false && { color: "#fff" }]}>
                  {tr("confirm_no", "No")}
                </Text>
              </TouchableOpacity>
            </View>
            {wa.exclusive === true && (
              <>
                <Text style={[cs.wizardInputLabel, { color: subtle }]}>
                  {tr("event_wizard_q5_what_info", "What info do you need?")}
                </Text>
                <View style={inputStyle}>
                  <TextInput
                    placeholder={tr("event_wizard_q5_placeholder", "Ex: 'Membership card number'.")}
                    placeholderTextColor={subtle}
                    value={wa.approvalInfoText}
                    onChangeText={(v) => setWizardAnswers((p) => ({ ...p, approvalInfoText: v }))}
                    style={[cs.input, { color: theme.text }]}
                  />
                </View>
                <TouchableOpacity
                  style={[cs.wizardNextBtn, { opacity: wa.approvalInfoText.trim() ? 1 : 0.4 }]}
                  onPress={() => { if (wa.approvalInfoText.trim()) setWizardStep(5); }}
                  activeOpacity={0.8}
                >
                  <Text style={cs.wizardNextBtnText}>{tr("event_wizard_next", "Next")}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );

      case 5:
        return (
          <View>
            <Text style={[cs.wizardQuestion, { color: theme.text }]}>
              {tr("event_wizard_q6", "Is this a +18 event only?")}
            </Text>
            <View style={cs.wizardBtnRow}>
              <TouchableOpacity
                style={[cs.wizardYesBtn, wa.ageRestricted === true && cs.wizardBtnActive]}
                onPress={() => { setWizardAnswers((p) => ({ ...p, ageRestricted: true })); setWizardComplete(true); }}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.ageRestricted === true && { color: "#fff" }]}>
                  {tr("confirm_yes", "Yes")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.wizardNoBtn, { borderColor: noBorderColor }, wa.ageRestricted === false && cs.wizardBtnActive]}
                onPress={() => { setWizardAnswers((p) => ({ ...p, ageRestricted: false })); setWizardComplete(true); }}
                activeOpacity={0.8}
              >
                <Text style={[cs.wizardBtnText, wa.ageRestricted === false && { color: "#fff" }]}>
                  {tr("confirm_no", "No")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  /* ── submit ── */
  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      if (!title.trim()) throw new Error(t("create_post_error_title_required"));
      if (!editPost && !media.length) throw new Error(t("create_post_error_media_required"));

      const badVideo = media.find((m) => m.type === "video" && typeof m.durationSec === "number" && m.durationSec > MAX_VIDEO_SECONDS);
      if (badVideo) throw new Error(tr("create_post_error_video_too_long_message", `Video must be ${MAX_VIDEO_SECONDS} seconds or less.`));
      if (postType === "feedPost" && media.some((m) => m.type !== "video")) throw new Error("Feed Posts must contain only video media.");
      if (postType === "event" && (!selectedDate || (!allDay && !selectedTime) || !locationText.trim())) throw new Error(t("create_post_error_event_fields_required"));
      if (postType === "event" && !editPost && !wizardComplete) throw new Error(tr("event_wizard_incomplete", "Please answer all event questions before publishing."));
      if (!editPost && (postType === "event" || postType === "ad") && selectedDate && (allDay || selectedTime)) {
        if (!allDay) {
          const startDT = new Date(`${selectedDate}T${selectedTime}`);
          if (startDT <= new Date()) throw new Error("The start date and time must be in the future.");
          if (selectedEndDate && selectedEndTime) {
            const endDT = new Date(`${selectedEndDate}T${selectedEndTime}`);
            if (endDT <= startDT) throw new Error("The end date and time must be after the start.");
          }
        }
      }

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error(t("create_post_error_not_authenticated"));

      const { data: prof, error: profErr } = await supabase.from("profiles").select("username, stripe_account_id, stripe_onboarding_complete").eq("id", uid).maybeSingle();
      if (profErr) throw profErr;
      const username = prof?.username || uid;
      const userStripeAccountId = prof?.stripe_account_id || null;
      const userStripeComplete = !!prof?.stripe_onboarding_complete;

      // Features 1 & 2: rate limit + duplicate check (skipped for edits)
      if (!editPost) {
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        try {
          const { data: lastPost } = await supabase
            .from("posts")
            .select("date, time")
            .eq("user", username)
            .order("date", { ascending: false })
            .order("time", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastPost) {
            const postTs = new Date(`${lastPost.date}T${lastPost.time || "00:00:00"}`);
            if (postTs > tenMinsAgo) throw new Error("You can only post once every 10 minutes. Please wait a moment before posting again.");
          }
          const { data: lastFeed } = await supabase
            .from("feed_videos")
            .select("created_at")
            .eq("username", username)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastFeed && new Date(lastFeed.created_at) > tenMinsAgo) {
            throw new Error("You can only post once every 10 minutes. Please wait a moment before posting again.");
          }
        } catch (e) {
          if (e.message?.includes("10 minutes")) throw e;
          // DB errors — skip rate limit silently
        }

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const checkTitle = (title || "").trim();
        if (checkTitle) {
          try {
            if (postType !== "feedPost") {
              const { data: dupPost } = await supabase
                .from("posts")
                .select("id")
                .eq("user", username)
                .ilike("title", checkTitle)
                .order("date", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (dupPost) throw new Error("You already posted something with this title recently. Please use a different title.");
            } else {
              const caption = (desc || title || "").trim();
              if (caption) {
                const { data: dupFeed } = await supabase
                  .from("feed_videos")
                  .select("id")
                  .eq("username", username)
                  .ilike("caption", caption)
                  .gte("created_at", oneDayAgo.toISOString())
                  .limit(1)
                  .maybeSingle();
                if (dupFeed) throw new Error("You already posted a video with this caption recently. Please use a different caption.");
              }
            }
          } catch (e) {
            if (e.message?.includes("already posted")) throw e;
            // DB errors — skip duplicate check silently
          }
        }
      } // end !editPost gate

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") throw new Error(t("create_post_error_location_denied"));

      const pos = await Location.getCurrentPositionAsync({});
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      let locationLabel = locationText.trim() || null;
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (!locationLabel && geo?.length) {
          const g = geo[0];
          locationLabel = g.city || g.subregion || g.region || g.country || g.name || null;
        }
      } catch {}

      /* ── Feed post branch ── */
      if (postType === "feedPost") {
        const mainVideo = media[0];
        if (!mainVideo || mainVideo.type !== "video") throw new Error("Feed Posts require at least one video.");
        if (typeof mainVideo.durationSec === "number" && mainVideo.durationSec > MAX_VIDEO_SECONDS)
          throw new Error(tr("create_post_error_video_too_long_message", `Video must be ${MAX_VIDEO_SECONDS} seconds or less.`));

        const feedVideoId = `feed_${uid}_${Date.now()}`;
        const videoUrl = await uploadOne({ postId: feedVideoId, fileUri: mainVideo.uri, index: 0, kind: "video" });
        const caption = desc || title || null;

        const { data: feedRow, error: feedErr } = await supabase.from("feed_videos").insert({
          user_id: uid, username, video_storage_path: videoUrl, thumbnail_path: null,
          video_duration: mainVideo.durationSec ?? null, video_width: mainVideo.width || null,
          video_height: mainVideo.height || null, filesize_bytes: mainVideo.fileSize || null,
          caption, tags: feedTags.length > 0 ? feedTags : [], visibility: "public",
          geo_lat: lat, geo_lon: lon, is_ready: true, is_processed: true,
        }).select("id").single();
        if (feedErr) throw feedErr;

        if (feedRow?.id && caption) {
          (async () => {
            try {
              const { data: embedData } = await supabase.functions.invoke("embed-text", { body: { text: caption } });
              if (embedData?.embedding) await supabase.from("feed_videos").update({ caption_embedding: embedData.embedding }).eq("id", feedRow.id);
            } catch (e) {
            }
          })();
        }

        resetForm();
        setSuccessModal({ visible: true, title: t("create_post_success_title"), message: t("create_post_success_message") });
        return;
      }

      /* ── Community posts branch ── */
      const now = new Date();
      const dateStr = postType === "event" ? selectedDate : (selectedDate || now.toISOString().slice(0, 10));
      const timeStr = postType === "event"
        ? (allDay ? null : selectedTime)
        : (selectedTime || now.toTimeString().slice(0, 8));

      const typeLabel = postType === "event" ? "Event"
        : postType === "ad"          ? "Ad"
        : postType === "article"     ? "Article"
        : postType === "product"     ? "Product"
        : "Update";

      // Use ref as authoritative source — guards against state update being lost
      // during a concurrent re-render (e.g. language context loading from AsyncStorage).
      const latestEventState = eventStateRef.current ?? eventState;

      const rawActions = [];
      if (postType === "event") {
        rawActions.push("tickets", "join_chat", "subgroups", "invite");
      } else if (postType === "ad") {
        if (adState.iap) rawActions.push("buy");
        rawActions.push("message");
      } else if (postType === "product") {
        rawActions.push("buy", "message");
      }
      rawActions.push("share", "save");
      const actions = Array.from(new Set(rawActions));

      let isticketable = false, is_age_restricted = false;
      let product_types = [], product_prices = [], required_info = [];
      let product_notes = [], product_required_info = [], product_options = [];
      let is_ticket_number_fixed = false, ticket_number = null;
      let manually_approve_attendees = false, ticket_approval_info = null;
      let allow_guests = true;

      if (postType === "event" && !editPost) {
        const wizardTypes = wizardAnswers.multipleTypes === false
          ? ["General"]
          : wizardAnswers.ticketTypesText.split(",").map((s) => s.trim()).filter(Boolean);

        isticketable      = true;
        is_age_restricted = !!wizardAnswers.ageRestricted;
        product_types     = wizardTypes;
        product_prices    = wizardTypes.map((t) => {
          const n = parseFloat(String(wizardAnswers.prices[t] || "0").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        });
        product_notes   = wizardTypes.map((t) => (wizardAnswers.notes[t] || "").trim());
        product_options = wizardTypes.map(() => []);

        const normalizedInfo = normalizeRequiredInfoInput(wizardAnswers.requiredInfoText || "");
        if (is_age_restricted && !normalizedInfo.includes("age")) normalizedInfo.push("age");
        product_required_info = wizardTypes.map(() => [...normalizedInfo]);
        required_info         = uniq(normalizedInfo);

        if (wizardAnswers.fixedTickets) {
          is_ticket_number_fixed = true;
          const counts = wizardTypes.map((t) => parseInt(String(wizardAnswers.ticketCounts[t] || "0"), 10) || 0);
          ticket_number = counts.reduce((a, b) => a + b, 0) || null;
        }

        allow_guests = wizardAnswers.requireInfo !== true;

        if (wizardAnswers.exclusive) {
          manually_approve_attendees = true;
          ticket_approval_info       = (wizardAnswers.approvalInfoText || "").trim() || null;
          allow_guests               = false;
        }
      }

      if (postType === "ad" && adState.iap) {
        const allProducts = Array.isArray(adState.products) ? adState.products : [];
        // Filter out products with empty names
        const products = allProducts.filter((p) => (p?.name || "").trim());
        product_types  = products.map((p) => p.name.trim());
        product_prices = products.map((p) => {
          const n = parseFloat(String(p?.cost || "0").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        });
        product_notes = products.map((p) => p?.notes || "");
        product_required_info = products.map((p) => normalizeRequiredInfoInput(p?.requiredInfo || ""));
        product_options = products.map((p) =>
          (p?.options || [])
            .filter((o) => (o?.name || "").trim())
            .map((o) => ({
              name: o.name.trim(),
              extraCost: o.free ? 0 : (parseFloat(String(o?.extraCost || "0").replace(",", ".")) || 0),
            }))
        );
        required_info = uniq(product_required_info.flat());
      }

      // Auto-include title as first label so the question card reads "Do you want to see ads about [title]?"
      const adLabels = postType === "ad"
        ? [
            ...(title.trim() ? [title.trim()] : []),
            ...(Array.isArray(adState.labels) ? adState.labels : []),
          ].filter((v, i, arr) => v && arr.indexOf(v) === i) // dedupe
          .slice(0, 5) // cap at 5 labels
        : null;
      const adLabelsToSave = adLabels?.length > 0 ? adLabels : null;

      const finalDesc = postType === "ad" && adNotes.trim()
        ? [desc.trim(), adNotes.trim()].filter(Boolean).join("\n\n")
        : desc;

      // Extract @mentions and resolve to tagged_usernames (only users who allow tags)
      const mentionMatches = [...new Set([
        ...(title.match(/@(\w+)/g) || []),
        ...(finalDesc.match(/@(\w+)/g) || []),
      ].map((m) => m.slice(1).toLowerCase()))];
      let taggedUsernames = [];
      if (mentionMatches.length > 0) {
        try {
          const { data: tagData } = await supabase
            .from("profiles")
            .select("username")
            .in("username", mentionMatches)
            .eq("allow_tags", true);
          taggedUsernames = (tagData || []).map((p) => p.username);
        } catch {}
      }

      // ── Edit mode: update existing post ──────────────────────────
      if (editPost?.id) {
        // Upload only new media; keep existing URLs as-is
        const finalMediaUrls = await Promise.all(
          media.map((m, i) =>
            m.isNew
              ? uploadOne({ postId: editPost.id, fileUri: m.uri, index: `edit_${Date.now()}_${i}`, kind: m.type })
              : Promise.resolve(m.uri)
          )
        );
        const { error: upErr } = await supabase.from("posts").update({
          title,
          description: finalDesc,
          date: dateStr,
          time: timeStr,
          end_date: selectedEndDate || null,
          end_time: selectedEndTime || null,
          all_day: allDay,
          every_day: everyDay,
          online: isOnline,
          location: locationLabel,
          postmediauri: finalMediaUrls,
          tagged_usernames: taggedUsernames,
          collaborators: collaborators.length > 0 ? collaborators : null,
          repeat_days: isPeriodic && repeatDays.length > 0 ? repeatDays : null,
        }).eq("id", editPost.id);
        if (upErr) throw upErr;

        // Re-embed on edit (fire-and-forget): caption any new images, keep existing caption if none added.
        (async () => {
          try {
            const newImageUrls = finalMediaUrls
              .filter((url, i) => url && media[i]?.isNew && media[i]?.type === "image")
              .slice(0, 3);
            const newVideoThumb = finalMediaUrls.some((url, i) => media[i]?.isNew && media[i]?.type === "video")
              ? (editPost.thumbnail_url || null)
              : null;
            const editUrlsToCaption = newImageUrls.length > 0 ? newImageUrls : (newVideoThumb ? [newVideoThumb] : []);
            let newCaption = "";
            if (editUrlsToCaption.length > 0) {
              const captionResults = await Promise.all(
                editUrlsToCaption.map((url) =>
                  supabase.functions.invoke("caption-image", { body: { imageUrl: url } }).catch(() => ({ data: null }))
                )
              );
              newCaption = captionResults
                .map((r) => r?.data?.caption || "")
                .filter(Boolean)
                .join(" ");
            }
            const aiCaption = newCaption || editPost.ai_caption || "";
            const textToEmbed = [title, finalDesc, aiCaption].filter(Boolean).join(" ");
            if (!textToEmbed) return;
            if (newCaption) {
              supabase.from("posts").update({ ai_caption: newCaption }).eq("id", editPost.id).catch(() => {});
            }
            const { data: embedData } = await supabase.functions.invoke("embed-text", { body: { text: textToEmbed } });
            if (embedData?.embedding) {
              await supabase.from("posts").update({ caption_embedding: embedData.embedding }).eq("id", editPost.id);
            }
          } catch {}
        })();

        resetForm();
        setSuccessModal({ visible: true, title: t("create_post_success_title") || "Updated!", message: t("create_post_edit_success") || "Your post has been updated." });
        return;
      }

      // ── Create mode: insert new post ──────────────────────────────
      const { data: inserted, error: insErr } = await supabase.from("posts").insert({
        title, description: finalDesc, user: username, author_id: uid, userpicuri: null,
        type: typeLabel, date: dateStr, time: timeStr,
        end_date: selectedEndDate || null, end_time: selectedEndTime || null,
        all_day: allDay, every_day: everyDay, online: isOnline,
        location: locationLabel,
        actions, isticketable, is_age_restricted,
        product_types, product_prices, required_info,
        product_notes, product_required_info, product_options,
        is_ticket_number_fixed, ticket_number,
        manually_approve_attendees, ticket_approval_info,
        allow_guests,
        ...(postType === "event" && !editPost && wizardAnswers.fixedTickets ? {
          number_per_ticket_type: (() => {
            const types = wizardAnswers.multipleTypes === false
              ? ["General"]
              : wizardAnswers.ticketTypesText.split(",").map((s) => s.trim()).filter(Boolean);
            return types.map((t) => parseInt(String(wizardAnswers.ticketCounts[t] || "0"), 10) || 0);
          })(),
        } : {}),
        labels: adLabelsToSave,
        lat, lon, geom: `SRID=4326;POINT(${lon} ${lat})`, postmediauri: [],
        tagged_usernames: taggedUsernames,
        collaborators: collaborators.length > 0 ? collaborators : null,
        repeat_days: isPeriodic && repeatDays.length > 0 ? repeatDays : null,
        ...(postType === "ad" && userStripeAccountId ? {
          stripe_account_id: userStripeAccountId,
          stripe_onboarding_complete: userStripeComplete,
        } : {}),
      }).select("id").single();
      if (insErr) throw insErr;
      const postId = inserted.id;
      posthog.capture('post_created', { post_type: postType });

      // Collaborator notifications (fire-and-forget)
      if (collaborators.length > 0) {
        (async () => {
          try {
            for (const collabUsername of collaborators) {
              // Notify the collaborator they were tagged
              supabase.functions.invoke("send-push", {
                body: {
                  type: "collab_tagged",
                  collaborator_username: collabUsername,
                  poster_username: username,
                  post_id: postId,
                },
              }).catch(() => {});
              // Notify the collaborator's followers
              supabase.functions.invoke("send-push", {
                body: {
                  type: "new_collab_post",
                  collaborator_username: collabUsername,
                  post_id: postId,
                },
              }).catch(() => {});
            }
          } catch {}
        })();
      }

      // Ad stats row — belt-and-suspenders alongside DB trigger trg_create_ad_stats
      if (postType === "ad") {
        supabase.from("ad_stats")
          .insert({ post_id: postId, views: 0, purchases: 0, contacts: 0 })
          .then(() => {}).catch(() => {});
      }

      if (postType === "event") {
        const eventTimestamp = selectedDate && selectedTime
          ? new Date(`${selectedDate}T${selectedTime}`).toISOString()
          : null;
        const { error: evErr } = await supabase.from("events").insert({
          title, post_id: postId, ticket_holders: [], attendees_info: [],
          created_at: new Date().toISOString(),
          organizers: [username],
          timestamp: eventTimestamp,
        });
        if (evErr) throw evErr;
      }

      // Upload media
      let mediaUploadedUrls = [];
      if (media.length > 0) {
        const uploaded = await Promise.all(
          media.map((m, i) => uploadOne({ postId, fileUri: m.uri, index: i, kind: m.type }))
        );
        mediaUploadedUrls = uploaded;
        const { error: updErr } = await supabase.from("posts").update({ postmediauri: uploaded }).eq("id", postId);
        if (updErr) throw updErr;

        // If any media is a video, insert a feed_videos row so it appears in the video feed
        const videoItems = media
          .map((m, i) => ({ type: m.type, url: uploaded[i] }))
          .filter((m) => m.type === "video");
        if (videoItems.length > 0) {
          (async () => {
            try {
              let linkedPostId = isticketable ? postId : null;
              if (!linkedPostId) {
                const todayStr = new Date().toISOString().slice(0, 10);
                const { data: closestEvent } = await supabase
                  .from("posts")
                  .select("id")
                  .eq("user", username)
                  .eq("type", "Event")
                  .eq("isticketable", true)
                  .gte("date", todayStr)
                  .order("date", { ascending: true })
                  .limit(1)
                  .maybeSingle();
                linkedPostId = closestEvent?.id || null;
              }
              await supabase.from("feed_videos").insert({
                user_id: uid,
                username,
                video_storage_path: videoItems[0].url,
                caption: title || null,
                tags: [],
                visibility: "public",
                geo_lat: lat,
                geo_lon: lon,
                is_ready: true,
                is_processed: true,
                linked_post_id: linkedPostId,
              });
            } catch {}
          })();
        }
      }

      // Upload thumbnail before embedding so it's available as a fallback for video posts.
      let thumbUrl = null;
      if (thumbnailUri) {
        thumbUrl = await uploadOne({ postId, fileUri: thumbnailUri, index: "thumb", kind: "image" });
        await supabase.from("posts").update({ thumbnail_url: thumbUrl }).eq("id", postId).then(() => {});
      }

      // Semantic embedding + image captioning (fire-and-forget)
      // For image posts: captions up to 3 images.
      // For video posts with no images: falls back to the thumbnail.
      (async () => {
        try {
          const imageUrls = mediaUploadedUrls
            .filter((url, i) => url && media[i]?.type === "image")
            .slice(0, 3);
          const urlsToCaption = imageUrls.length > 0
            ? imageUrls
            : (thumbUrl ? [thumbUrl] : []);
          let aiCaption = "";
          if (urlsToCaption.length > 0) {
            const captionResults = await Promise.all(
              urlsToCaption.map((url) =>
                supabase.functions.invoke("caption-image", { body: { imageUrl: url } }).catch(() => ({ data: null }))
              )
            );
            aiCaption = captionResults
              .map((r) => r?.data?.caption || "")
              .filter(Boolean)
              .join(" ");
          }
          const textToEmbed = [title, finalDesc, aiCaption].filter(Boolean).join(" ");
          if (!textToEmbed) return;
          if (aiCaption) {
            supabase.from("posts").update({ ai_caption: aiCaption }).eq("id", postId).catch(() => {});
          }
          const { data: embedData } = await supabase.functions.invoke("embed-text", { body: { text: textToEmbed } });
          if (embedData?.embedding) {
            await supabase.from("posts").update({ caption_embedding: embedData.embedding }).eq("id", postId);
          }
          // Multimodal embedding: text + first image in the shared visual-semantic space.
          // Powers label-based filtering on CommunityScreen (searches multimodal_embedding column).
          const firstImageUrl = imageUrls[0] || thumbUrl || null;
          const mmBody: Record<string, string> = {};
          if (textToEmbed) mmBody.text = textToEmbed;
          if (firstImageUrl) mmBody.imageUrl = firstImageUrl;
          if (Object.keys(mmBody).length > 0) {
            supabase.functions.invoke("embed-multimodal", { body: mmBody })
              .then(({ data: mmData }) => {
                if (mmData?.embedding) {
                  supabase.from("posts").update({ multimodal_embedding: mmData.embedding }).eq("id", postId).catch(() => {});
                }
              })
              .catch(() => {});
          }
        } catch {}
      })();

      if (postType === "event") {
        await createEventGroup({ groupname: title, group_desc: desc, group_pic_link: null, username });
      }

      resetForm();
      setSuccessModal({ visible: true, title: t("create_post_success_title"), message: t("create_post_success_message") });
    } catch (e) {
      // Show the actual message for validation errors we throw ourselves;
      // fall back to a generic message for Supabase/network errors (which have a `code` field).
      const userMsg = e.code
        ? tr("create_post_fail_title", "Something went wrong. Please try again.")
        : (e.message || tr("create_post_fail_title", "Something went wrong. Please try again."));
      Alert.alert(t("create_post_fail_title"), userMsg);
    } finally {
      setSubmitting(false);
    }
  };

  /* ── location autocomplete ── */
  const fetchLocationSuggestions = (text) => {
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!text || text.trim().length < 2) { setLocationSuggestions([]); return; }
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const token = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? Constants.expoConfig?.extra?.expoPublic?.MAPBOX_PUBLIC_TOKEN ?? "";
        if (!token) return;
        if (!locationSessionToken.current) {
          locationSessionToken.current = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
        }
        const q = encodeURIComponent(text.trim());
        const coords = userCoordsRef.current;
        const proximityParam = coords ? `&proximity=${coords.longitude},${coords.latitude}` : "";
        const res = await fetch(
          `https://api.mapbox.com/search/searchbox/v1/suggest` +
          `?q=${q}&session_token=${locationSessionToken.current}&types=poi,street,address,place,locality,neighborhood${proximityParam}&limit=8&access_token=${token}`
        );
        const json = await res.json();
        const normalized = (json.suggestions || []).map((s) => ({
          id: s.mapbox_id,
          text: s.name ?? "",
          place_name: s.place_formatted ?? s.name ?? "",
          mapbox_id: s.mapbox_id,
          context: Object.entries(s.context ?? {}).map(([key, val]) => ({
            id: `${key}.${val?.mapbox_id ?? key}`,
            text: val?.name ?? "",
          })),
        }));
        setLocationSuggestions(normalized);
      } catch { setLocationSuggestions([]); }
    }, 350);
  };

  const subtle = theme.subtleText || "#8c97a8";
  const inputBg = "transparent";

  /* ══════════════════════════════════════════════════════════════ */
  /*  JSX                                                           */
  /* ══════════════════════════════════════════════════════════════ */
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[cs.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* ── Header ── */}
        <View style={[cs.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.navigate("Community")} style={cs.headerBack}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TouchableOpacity
              style={cs.repeatBtn}
              onPress={() => navigation.navigate("PastEvents", { fromCreatePost: true })}
              activeOpacity={0.85}
            >
              <Text style={cs.publishBtnText}>{tr("create_post_repeat_button", "Repeat")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                cs.publishBtn,
                { opacity: submitting ? 0.6 : 1 },
                (isEvent && !editPost && !wizardComplete) && { backgroundColor: isDark ? "#334" : "#b3c8e8" },
              ]}
              onPress={handleSubmit}
              disabled={submitting || (isEvent && !editPost && !wizardComplete)}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={cs.publishBtnText}>{t("create_post_publish_button")}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[cs.scroll, { paddingBottom: 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentInset={Platform.OS === "ios" ? { bottom: 24 } : undefined}
          scrollIndicatorInsets={Platform.OS === "ios" ? { bottom: 24 } : undefined}
        >
          {/* ── Post type dropdown ── */}
          <Text style={[cs.sectionLabel, { color: subtle }]}>{t("create_post_post_type_title")}</Text>
          <TouchableOpacity
            style={[cs.typeDropdownTrigger, { borderColor: theme.border, backgroundColor: inputBg }]}
            onPress={() => setTypeDropdownOpen(true)}
            activeOpacity={0.8}
          >
            {(() => { const pt = POST_TYPES.find(p => p.key === postType); return (
              <>
                <Feather name={pt?.icon || "calendar"} size={14} color="#2F91FF" />
                <Text style={[cs.typeDropdownText, { color: theme.text }]}>{t(pt?.labelKey) || pt?.label || "Event"}</Text>
              </>
            ); })()}
            <Feather name="chevron-down" size={16} color={subtle} style={{ marginLeft: "auto" }} />
          </TouchableOpacity>

          <Modal visible={typeDropdownOpen} transparent animationType="fade" onRequestClose={() => setTypeDropdownOpen(false)}>
            <TouchableOpacity style={cs.typeDropdownOverlay} activeOpacity={1} onPress={() => setTypeDropdownOpen(false)}>
              <View style={[cs.typeDropdownMenu, { backgroundColor: theme.gray, borderColor: theme.border }]}>
                {POST_TYPES.map((pt) => (
                  <TouchableOpacity
                    key={pt.key}
                    style={[cs.typeDropdownItem, postType === pt.key && { backgroundColor: isDark ? "#1a3a5c" : "#e8f3ff" }]}
                    onPress={() => { setPostType(pt.key); setTypeDropdownOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Feather name={pt.icon} size={14} color={postType === pt.key ? "#2F91FF" : subtle} />
                    <Text style={[cs.typeDropdownItemText, { color: postType === pt.key ? "#2F91FF" : theme.text }]}>{t(pt.labelKey) || pt.label}</Text>
                    {postType === pt.key && <Feather name="check" size={14} color="#2F91FF" style={{ marginLeft: "auto" }} />}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          {/* ── Title ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>{t("create_post_title_label")}</Text>
          <View style={[cs.inputWrap, { borderColor: theme.border, backgroundColor: inputBg }]}>
            <TextInput
              placeholder={t("create_post_title_label")}
              placeholderTextColor={subtle}
              value={title}
              onChangeText={handleTitleChange}
              style={[cs.input, { color: theme.text }]}
              maxLength={120}
            />
          </View>
          {mentionField === "title" && mentionResults.length > 0 && (
            <View style={[cs.mentionDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: theme.border }]}>
              {mentionResults.map((u) => (
                <TouchableOpacity
                  key={u.username}
                  style={[cs.mentionItem, { borderBottomColor: theme.border }]}
                  onPress={() => onSelectMention(u.username)}
                >
                  <Text style={[cs.mentionUsername, { color: theme.text }]}>@{u.username}</Text>
                  {!!u.name && <Text style={[cs.mentionName, { color: subtle }]}>{u.name}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── Description ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>{t("create_post_section_description")}</Text>
          <View style={[cs.inputWrap, { borderColor: theme.border, backgroundColor: inputBg }]}>
            <TextInput
              placeholder={t("create_post_description_placeholder")}
              placeholderTextColor={subtle}
              value={desc}
              onChangeText={handleDescChange}
              style={[cs.input, { color: theme.text, height: 60 }]}
              multiline
              textAlignVertical="top"
              maxLength={1000}
            />
          </View>
          {mentionField === "desc" && mentionResults.length > 0 && (
            <View style={[cs.mentionDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: theme.border }]}>
              {mentionResults.map((u) => (
                <TouchableOpacity
                  key={u.username}
                  style={[cs.mentionItem, { borderBottomColor: theme.border }]}
                  onPress={() => onSelectMention(u.username)}
                >
                  <Text style={[cs.mentionUsername, { color: theme.text }]}>@{u.username}</Text>
                  {!!u.name && <Text style={[cs.mentionName, { color: subtle }]}>{u.name}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Feature 7: link warning */}
          {URL_REGEX.test(title + " " + desc) && (
            <View style={{ backgroundColor: "#FFF3CD", borderRadius: 8, padding: 10, marginTop: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Feather name="alert-triangle" size={15} color="#856404" style={{ marginTop: 1 }} />
              <Text style={{ color: "#856404", fontFamily: "Poppins", fontSize: 12, flex: 1 }}>
                We recommend not including links in posts. Links may be flagged or removed.
              </Text>
            </View>
          )}

          {/* ── Date & Time ── */}
          {(isEvent || isAd) && (
            <>
              <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>
                {t("create_post_section_start_datetime")}{isEvent ? " *" : ""}
              </Text>

              {/* All day / Every day / Online — inline row */}
              {isEvent && (
                <View style={cs.togglesRow}>
                  {[
                    {
                      label: t("event_all_day") || "All day",
                      value: allDay,
                      onToggle: () => {
                        const next = !allDay;
                        setAllDay(next);
                        if (next) { setSelectedTime(null); setSelectedEndTime(null); setShowTimePicker(false); setShowEndTimePicker(false); }
                      },
                    },
                    {
                      label: t("event_every_day") || "Every day",
                      value: everyDay,
                      onToggle: () => {
                        const next = !everyDay;
                        if (next) { setIsPeriodic(false); setRepeatDays([]); }
                        setEveryDay(next);
                      },
                    },
                    {
                      label: t("event_online") || "Online",
                      value: isOnline,
                      onToggle: () => setIsOnline((p) => !p),
                    },
                    {
                      label: t("event_periodic") || "Periodic",
                      value: isPeriodic,
                      onToggle: () => {
                        const next = !isPeriodic;
                        if (next) setEveryDay(false);
                        setIsPeriodic(next);
                      },
                    },
                  ].map(({ label, value, onToggle }) => (
                    <TouchableOpacity key={label} style={cs.toggleItem} onPress={onToggle} activeOpacity={0.7}>
                      <Text style={[cs.toggleLabel, { color: subtle }]}>{label}</Text>
                      <Switch
                        value={value}
                        onValueChange={onToggle}
                        trackColor={{ false: isDark ? "#444" : "#d0d7e2", true: "#3D8BFF" }}
                        thumbColor="#fff"
                        style={{ alignSelf: "center" }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={[cs.dateTimeContainer, (showDatePicker || showTimePicker) && { zIndex: 40 }]}>
                <View style={cs.dateTimeRow}>
                  <TouchableOpacity
                    style={[cs.filterChip, { borderColor: isDark ? "#444" : "#d0d7e2", backgroundColor: inputBg }]}
                    onPress={() => { setShowDatePicker((p) => !p); setShowTimePicker(false); setShowEndDatePicker(false); setShowEndTimePicker(false); }}
                    activeOpacity={0.8}
                  >
                    <Feather name="calendar" size={15} color="#2F91FF" style={{ marginRight: 6 }} />
                    <Text style={[cs.filterText, { color: theme.text }]}>{dateLabel}</Text>
                    {selectedDate && (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation(); setSelectedDate(null); }} style={{ paddingHorizontal: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Text style={[cs.filterClear, { color: subtle }]}>×</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                  {!allDay && (
                    <TouchableOpacity
                      style={[cs.filterChip, { flex: 1, borderColor: isDark ? "#444" : "#d0d7e2", backgroundColor: inputBg }]}
                      onPress={() => { setShowTimePicker((p) => !p); setShowDatePicker(false); setShowEndDatePicker(false); setShowEndTimePicker(false); }}
                      onLongPress={() => setSelectedTime(null)}
                      activeOpacity={0.8}
                    >
                      <Feather name="clock" size={15} color="#2F91FF" style={{ marginRight: 6 }} />
                      <Text style={[cs.filterText, { color: theme.text }]}>{timeLabel}</Text>
                      <Feather name={showTimePicker ? "chevron-up" : "chevron-down"} size={14} color={subtle} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  )}
                </View>
                {showDatePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedDate ? new Date(selectedDate) : new Date()} mode="date" display={Platform.OS === "ios" ? "inline" : "calendar"} onChange={handleDateChange} minimumDate={new Date()} style={{ alignSelf: "center" }} />
                  </View>
                )}
                {!allDay && showTimePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedTime ? timeStringToDate(selectedTime) : new Date()} mode="time" display={Platform.OS === "ios" ? "spinner" : "clock"} onChange={handleTimeChange} style={{ alignSelf: "center" }} />
                  </View>
                )}
              </View>

              <Text style={[cs.sectionLabel, { color: subtle, marginTop: 12 }]}>{t("create_post_section_end_datetime")}</Text>
              <View style={[cs.dateTimeContainer, (showEndDatePicker || showEndTimePicker) && { zIndex: 40 }]}>
                <View style={cs.dateTimeRow}>
                  <TouchableOpacity
                    style={[cs.filterChip, { borderColor: isDark ? "#444" : "#d0d7e2", backgroundColor: inputBg }]}
                    onPress={() => { setShowEndDatePicker((p) => !p); setShowEndTimePicker(false); setShowDatePicker(false); setShowTimePicker(false); }}
                    activeOpacity={0.8}
                  >
                    <Feather name="calendar" size={15} color={isDark ? "#888" : "#aaa"} style={{ marginRight: 6 }} />
                    <Text style={[cs.filterText, { color: selectedEndDate ? theme.text : subtle }]}>{endDateLabel}</Text>
                    {selectedEndDate && (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation(); setSelectedEndDate(null); }} style={{ paddingHorizontal: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Text style={[cs.filterClear, { color: subtle }]}>×</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                  {!allDay && (
                    <TouchableOpacity
                      style={[cs.filterChip, { flex: 1, borderColor: isDark ? "#444" : "#d0d7e2", backgroundColor: inputBg }]}
                      onPress={() => { setShowEndTimePicker((p) => !p); setShowEndDatePicker(false); setShowDatePicker(false); setShowTimePicker(false); }}
                      onLongPress={() => setSelectedEndTime(null)}
                      activeOpacity={0.8}
                    >
                      <Feather name="clock" size={15} color={isDark ? "#888" : "#aaa"} style={{ marginRight: 6 }} />
                      <Text style={[cs.filterText, { color: selectedEndTime ? theme.text : subtle }]}>{endTimeLabel}</Text>
                      <Feather name={showEndTimePicker ? "chevron-up" : "chevron-down"} size={14} color={subtle} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  )}
                </View>
                {showEndDatePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedEndDate ? new Date(selectedEndDate) : (selectedDate ? new Date(selectedDate) : new Date())} mode="date" display={Platform.OS === "ios" ? "inline" : "calendar"} onChange={handleEndDateChange} minimumDate={selectedDate ? new Date(selectedDate) : new Date()} style={{ alignSelf: "center" }} />
                  </View>
                )}
                {!allDay && showEndTimePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedEndTime ? timeStringToDate(selectedEndTime) : new Date()} mode="time" display={Platform.OS === "ios" ? "spinner" : "clock"} onChange={handleEndTimeChange} style={{ alignSelf: "center" }} />
                  </View>
                )}
              </View>

              {/* ── Periodic day selector ── */}
              {isPeriodic && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14, marginBottom: 4 }}>
                  {DAYS_OF_WEEK.map(({ key, dayKey }) => {
                    const selected = repeatDays.includes(key);
                    const letter = (t(dayKey) || key)[0].toUpperCase();
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setRepeatDays((prev) =>
                          prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
                        )}
                        style={[
                          cs.dayCircle,
                          selected
                            ? { backgroundColor: "#3D8BFF", borderColor: "#3D8BFF" }
                            : { backgroundColor: inputBg, borderColor: isDark ? "#444" : "#d0d7e2" },
                        ]}
                        activeOpacity={0.75}
                      >
                        <Text style={[cs.dayCircleText, { color: selected ? "#fff" : subtle }]}>
                          {letter}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {/* ── Location ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>
            {t("create_post_location_placeholder")}{isEvent ? " *" : ""}
          </Text>
          <View style={{ position: "relative", zIndex: 5 }}>
            <View style={[cs.inputWrap, { borderColor: theme.border, backgroundColor: inputBg }]}>
              <Feather name="map-pin" size={15} color="#2F91FF" style={{ marginRight: 8 }} />
              <TextInput
                placeholder={t("create_post_location_placeholder")}
                placeholderTextColor={subtle}
                value={locationText}
                onChangeText={(text) => { setLocationText(text); fetchLocationSuggestions(text); }}
                style={[cs.input, { color: theme.text }]}
              />
            </View>
            {locationSuggestions.length > 0 && (
              <View style={[cs.suggestionsBox, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#ddd" }]}>
                {locationSuggestions.map((s) => {
                  const primaryName = s.text || s.place_name;
                  // Build a short context string: city / region, country
                  const context = s.context || [];
                  const city = context.find((c) => c.id?.startsWith("place.") || c.id?.startsWith("locality."))?.text;
                  const country = context.find((c) => c.id?.startsWith("country."))?.text;
                  const subtitle = [city, country].filter(Boolean).join(", ");
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={cs.suggestionItem}
                      onPress={() => { setLocationText(primaryName); setLocationSuggestions([]); locationSessionToken.current = null; }}
                    >
                      <Feather name="map-pin" size={13} color="#2F91FF" style={{ marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[cs.suggestionText, { color: theme.text }]} numberOfLines={1}>{primaryName}</Text>
                        {!!subtitle && (
                          <Text style={[cs.suggestionText, { color: theme.subtleText || "#8c97a8", fontSize: 12 }]} numberOfLines={1}>{subtitle}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── Media ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>{t("create_post_section_media")} *</Text>
          <View style={cs.mediaButtonsRow}>
            <TouchableOpacity
              style={[cs.mediaBtn, { flex: 1, borderColor: theme.border, backgroundColor: inputBg }]}
              onPress={pickMedia}
              disabled={submitting}
              activeOpacity={0.8}
            >
              <Feather name={isFeedPost ? "video" : "image"} size={16} color="#2F91FF" style={{ marginRight: 8 }} />
              <Text style={[cs.mediaBtnText, { color: theme.text }]}>{t("create_post_add_media_button")}</Text>
            </TouchableOpacity>

            {!isFeedPost && (
              <TouchableOpacity
                style={[cs.mediaBtn, { flex: 1, borderColor: theme.border, backgroundColor: inputBg }]}
                onPress={pickThumbnail}
                disabled={submitting}
                activeOpacity={0.8}
              >
                <Feather name="film" size={16} color="#6C63FF" style={{ marginRight: 8 }} />
                <Text style={[cs.mediaBtnText, { color: theme.text }]}>
                  {thumbnailUri ? t("create_post_change_thumbnail") : t("create_post_add_thumbnail")}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {media.length > 0 && (
            <View style={cs.mediaGrid}>
              {media.map((m, i) => (
                <TouchableOpacity
                  key={`${m.uri}-${i}`}
                  onPress={() => setMedia((prev) => prev.filter((_, idx) => idx !== i))}
                  activeOpacity={0.85}
                >
                  <View style={cs.mediaCard}>
                    <Image source={{ uri: m.uri }} style={cs.mediaImg} />
                    <View style={cs.removeBtn}>
                      <Feather name="x" size={11} color="#fff" />
                    </View>
                    {m.type === "video" && (
                      <View style={cs.videoBadge}>
                        <Text style={cs.videoBadgeText}>VIDEO</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {thumbnailUri && (
            <View style={{ marginTop: 10, position: "relative", alignSelf: "flex-start" }}>
              <Image source={{ uri: thumbnailUri }} style={{ width: 110, height: 100, borderRadius: 12 }} />
              <TouchableOpacity onPress={() => setThumbnailUri(null)} style={cs.removeBtn} hitSlop={8}>
                <Feather name="x" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* ── Collaborators (non-event posts) ── */}
          {(!isEvent && (isAd || postType === "article" || postType === "profilePost")) && (
            <View style={{ marginTop: 16 }}>
              {renderCollaborators(6)}
            </View>
          )}

          {/* ── Event wizard ── */}
          {isEvent && !editPost && (
            <View style={{ marginTop: 24 }}>
              <Text style={[cs.wizardIntro, { color: theme.text }]}>
                {tr("event_wizard_intro", "Please answer some questions about your event before you post.")}
              </Text>

              {!wizardComplete ? (
                <>
                  <View style={[cs.wizardCard, {
                    backgroundColor: isDark ? "#0e1c30" : "#e8f3ff",
                    borderColor:     isDark ? "#1e3a5c" : "#b3d4ff",
                  }]}>
                    {/* Back arrow — hidden on first step */}
                    {wizardStep > 0 && (
                      <TouchableOpacity
                        style={cs.wizardBack}
                        onPress={wizardGoBack}
                        hitSlop={10}
                        activeOpacity={0.7}
                      >
                        <Feather name="arrow-left" size={18} color="#2F91FF" />
                      </TouchableOpacity>
                    )}
                    <View style={{ marginTop: 4 }}>
                      {renderWizardStep()}
                    </View>
                  </View>

                  {/* Step counter */}
                  <Text style={[cs.wizardCounter, { color: subtle }]}>
                    {wizardStep + 1}/{wizardAnswers.requireInfo === false ? 4 : 6}
                  </Text>
                </>
              ) : (
                <Text style={[cs.wizardDone, { color: theme.text }]}>
                  {tr("event_wizard_done", "Your post is ready to go! ✅")}
                </Text>
              )}

              {/* Collaborators — below the wizard card for events */}
              <View style={{ marginTop: 20 }}>
                {renderCollaborators(6)}
              </View>
            </View>
          )}

          {/* Collaborators for event edit mode */}
          {isEvent && !!editPost && (
            <View style={{ marginTop: 16 }}>
              {renderCollaborators(6)}
            </View>
          )}

          {/* ── Dynamic panels ── */}
          {isAd && <AdPanel onState={setAdState} />}

          {/* ── Feed tags ── */}
          {isFeedPost && (
            <View style={{ marginTop: 20 }}>
              <Text style={[cs.sectionLabel, { color: subtle }]}>{t("create_post_section_categories")}</Text>
              <Text style={[cs.tagHint, { color: subtle }]}>{t("create_post_section_categories_hint")}</Text>
              <View style={cs.tagsWrap}>
                {FEED_TAGS.map((tag) => {
                  const active = feedTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      onPress={() => setFeedTags((prev) =>
                        prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
                      )}
                      style={[
                        cs.tagChip,
                        active
                          ? { backgroundColor: "#2F91FF", borderColor: "#2F91FF" }
                          : { backgroundColor: "transparent", borderColor: isDark ? "#555" : "#d0d7e2" },
                      ]}
                      activeOpacity={0.7}
                    >
                      <Text style={[cs.tagChipText, { color: active ? "#fff" : subtle }]}>{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ height: 18 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Success modal ── */}
      <Modal
        visible={successModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessModal({ visible: false, title: "", message: "" })}
      >
        <View style={cs.successOverlay}>
          <View style={[cs.successCard, { backgroundColor: isDark ? "#101218" : "#fff" }]}>
            <View style={cs.successIconWrap}>
              <Feather name="check-circle" size={40} color="#2BB673" />
            </View>
            {!!successModal.title && (
              <Text style={[cs.successTitle, { color: isDark ? "#fff" : "#111" }]}>
                {successModal.title}
              </Text>
            )}
            <Text style={[cs.successMsg, { color: isDark ? "#ccc" : "#555" }]}>
              {successModal.message}
            </Text>
            <TouchableOpacity
              style={cs.successOkBtn}
              onPress={() => setSuccessModal({ visible: false, title: "", message: "" })}
            >
              <Text style={cs.successOkText}>{t("ok_button") || "OK"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */
const cs = StyleSheet.create({
  safeArea: { flex: 1 },

  // Header
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  headerBack:     { paddingRight: 8, paddingVertical: 4 },
  headerTitle:    { flex: 1, textAlign: "center", fontFamily: "PoppinsBold", fontSize: 17 },
  publishBtn:     { backgroundColor: "#2F91FF", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, minWidth: 74, alignItems: "center" },
  repeatBtn:      { backgroundColor: "#2F91FF", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  publishBtnText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#fff" },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Section labels (matches AdPublisherScreen)
  sectionLabel: { fontFamily: "PoppinsBold", fontSize: 10, marginBottom: 8 },

  // Post type dropdown
  typeDropdownTrigger:   { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  typeDropdownText:      { fontFamily: "PoppinsBold", fontSize: 13, flex: 1 },
  typeDropdownOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 32 },
  typeDropdownMenu:      { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  typeDropdownItem:      { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  typeDropdownItemText:  { fontFamily: "Poppins", fontSize: 14, flex: 1 },

  // Inputs
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  input:     { fontFamily: "Poppins", fontSize: 14, flex: 1 },

  // @ mention dropdown
  mentionDropdown:  { borderWidth: 1, borderRadius: 8, marginTop: 4, marginBottom: 8, overflow: "hidden" },
  mentionItem:      { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 8 },
  mentionUsername:  { fontFamily: "PoppinsBold", fontSize: 13 },
  mentionName:      { fontFamily: "Poppins", fontSize: 12 },

  // Date / time
  dateTimeContainer: { marginBottom: 4, position: "relative", zIndex: 20 },
  dateTimeRow:       { flexDirection: "row", alignItems: "center", columnGap: 10 },
  allDayRow:         { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  allDayLabel:       { fontFamily: "Poppins", fontSize: 14, marginLeft: 10 },

  // Inline toggles (All day / Every day / Online / Periodic)
  togglesRow:  { flexDirection: "row", alignItems: "flex-start", marginBottom: 14, width: "100%" },
  toggleItem:  { width: "25%", alignItems: "center", justifyContent: "flex-start", gap: 6 },
  toggleLabel: { fontFamily: "Poppins", fontSize: 10, textAlign: "center" },

  // Periodic day selector circles
  dayCircle:     { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  dayCircleText: { fontFamily: "PoppinsBold", fontSize: 12 },

  // Event wizard
  wizardIntro:       { fontFamily: "PoppinsBold", fontSize: 13, lineHeight: 20, marginBottom: 14 },
  wizardCard:        { borderRadius: 16, borderWidth: 1.5, padding: 18, paddingTop: 14 },
  wizardBack:        { alignSelf: "flex-start", marginBottom: 2 },
  wizardQuestion:    { fontFamily: "PoppinsBold", fontSize: 15, lineHeight: 22, marginBottom: 20 },
  wizardBtnRow:      { flexDirection: "row", gap: 12, marginBottom: 14 },
  wizardYesBtn:      { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#2F91FF", alignItems: "center" },
  wizardNoBtn:       { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  wizardBtnActive:   { backgroundColor: "#2F91FF", borderColor: "#2F91FF" },
  wizardBtnText:     { fontFamily: "PoppinsBold", fontSize: 14, color: "#2F91FF" },
  wizardInputLabel:  { fontFamily: "Poppins", fontSize: 12, marginBottom: 6 },
  wizardInputWrap:   { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  wizardNextBtn:     { backgroundColor: "#2F91FF", borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  wizardNextBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },
  wizardCounter:     { textAlign: "center", fontFamily: "Poppins", fontSize: 12, marginTop: 10, marginBottom: 2 },
  wizardDone:        { fontFamily: "PoppinsBold", fontSize: 16, textAlign: "center", marginTop: 10, marginBottom: 4 },

  // Stripe warning (inside wizard Q2)
  stripeWarning:        { backgroundColor: "#EF4444", borderRadius: 12, padding: 14, marginBottom: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stripeWarningText:    { color: "#fff", fontFamily: "Poppins", fontSize: 13, flex: 1, marginRight: 10, lineHeight: 18 },
  stripeConnectBtn:     { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center" },
  stripeConnectBtnText: { color: "#EF4444", fontFamily: "PoppinsBold", fontSize: 13 },
  filterChip:        { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  filterText:        { fontFamily: "Poppins", fontSize: 13 },
  filterClear:       { fontSize: 15, marginLeft: 4, fontFamily: "Poppins" },
  pickerDropdown:    { position: "absolute", top: "100%", left: 0, right: 0, paddingTop: 4, borderRadius: 12, borderWidth: 1, overflow: "hidden", zIndex: 50, elevation: 5, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },

  // Location suggestions
  suggestionsBox:  { position: "absolute", top: "100%", left: 0, right: 0, borderWidth: 1, borderRadius: 12, overflow: "hidden", zIndex: 50, elevation: 5, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  suggestionItem:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee" },
  suggestionText:  { flex: 1, fontSize: 13, fontFamily: "Poppins" },

  // Media
  mediaButtonsRow: { flexDirection: "row", gap: 10 },
  mediaBtn:        { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, justifyContent: "center" },
  mediaBtnText:    { fontFamily: "PoppinsBold", fontSize: 13 },
  mediaGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  mediaCard:       { width: 100, height: 90, borderRadius: 12, overflow: "hidden", backgroundColor: "#e0e0e0" },
  mediaImg:        { width: "100%", height: "100%" },
  removeBtn:       { position: "absolute", top: 5, right: 5, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  videoBadge:      { position: "absolute", bottom: 5, right: 5, backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  videoBadgeText:  { color: "#fff", fontSize: 9, fontWeight: "700" },

  // Feed tags
  tagHint:    { fontSize: 12, fontFamily: "Poppins", marginBottom: 10 },
  tagsWrap:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip:    { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  tagChipText:{ fontSize: 13, fontFamily: "Poppins" },

  // Success modal
  successOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" },
  successCard:    { width: "82%", borderRadius: 18, padding: 24, alignItems: "center", elevation: 4 },
  successIconWrap:{ marginBottom: 12 },
  successTitle:   { fontFamily: "PoppinsBold", fontSize: 16, textAlign: "center", marginBottom: 6 },
  successMsg:     { fontFamily: "Poppins", fontSize: 14, textAlign: "center", marginBottom: 20 },
  successOkBtn:   { backgroundColor: "#2F91FF", paddingVertical: 12, paddingHorizontal: 36, borderRadius: 12 },
  successOkText:  { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
});
