// CreatePostScreen.js
// Visual refresh to match AdPublisherScreen aesthetic.
// Logic is unchanged from previous version.
// Ad tracking: fires a belt-and-suspenders ad_stats INSERT when type=Ad
// (DB trigger trg_create_ad_stats handles it too; both are safe with ON CONFLICT DO NOTHING).

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Image,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
  Modal, Platform, KeyboardAvoidingView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useFonts } from "expo-font";
import { useNavigation } from "@react-navigation/native";
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
  { key: "event",       label: "Event",       icon: "calendar"  },
  { key: "ad",          label: "Ad",           icon: "speaker"   },
  { key: "article",     label: "Article",      icon: "file-text" },
  { key: "profilePost", label: "Profile Post", icon: "user"      },

  { key: "feedPost",    label: "Feed Video",   icon: "video"     },
];

/* ── Constants & helpers ────────────────────────────────────────── */
const BUCKET = "alba-media";
const MAX_VIDEO_SECONDS = 20;

const FEED_TAGS = [
  "Music", "Art", "Food", "Travel", "Sports", "Fitness",
  "Gaming", "Fashion", "Comedy", "Dance", "Nature", "Tech",
  "Film", "Education", "Lifestyle", "Pets",
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

/* ── Screen ─────────────────────────────────────────────────────── */
export default function CreatePost() {
  const navigation = useNavigation();
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
  if (!fontsLoaded) return null;

  /* ── state ── */
  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [postType, setPostType] = useState("event");

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

  const [media,        setMedia]        = useState([]);
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [successModal, setSuccessModal] = useState({ visible: false, title: "", message: "" });

  const [selectedDate,    setSelectedDate]    = useState(null);
  const [showDatePicker,  setShowDatePicker]  = useState(false);
  const [selectedTime,    setSelectedTime]    = useState(null);
  const [showTimePicker,  setShowTimePicker]  = useState(false);
  const [selectedEndDate,    setSelectedEndDate]    = useState(null);
  const [showEndDatePicker,  setShowEndDatePicker]  = useState(false);
  const [selectedEndTime,    setSelectedEndTime]    = useState(null);
  const [showEndTimePicker,  setShowEndTimePicker]  = useState(false);

  const [locationText,        setLocationText]        = useState("");
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

  const [adNotes,  setAdNotes]  = useState("");
  const [feedTags, setFeedTags] = useState([]);

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
    : "End date";
  const endTimeLabel = selectedEndTime ? selectedEndTime.slice(0, 5) : "End time";

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

  /* ── reset ── */
  const resetForm = () => {
    setTitle(""); setDesc(""); setMedia([]); setPostType("event");
    setEventState({ enableGroupChat: true, allowTicketing: false, tickets: [], allowSubgroups: true, allowInvites: true });
    setAdState({ targetInterested: true, iap: false, products: [] });
    setSelectedDate(null); setSelectedTime(null);
    setSelectedEndDate(null); setSelectedEndTime(null);
    setLocationText(""); setLocationSuggestions([]); locationSessionToken.current = null;
    setAdNotes(""); setThumbnailUri(null); setFeedTags([]);
  };

  /* ── submit ── */
  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      if (!title.trim()) throw new Error(t("create_post_error_title_required"));
      if (!media.length) throw new Error(t("create_post_error_media_required"));

      const badVideo = media.find((m) => m.type === "video" && typeof m.durationSec === "number" && m.durationSec > MAX_VIDEO_SECONDS);
      if (badVideo) throw new Error(tr("create_post_error_video_too_long_message", `Video must be ${MAX_VIDEO_SECONDS} seconds or less.`));
      if (postType === "feedPost" && media.some((m) => m.type !== "video")) throw new Error("Feed Posts must contain only video media.");
      if (postType === "event" && (!selectedDate || !selectedTime || !locationText.trim())) throw new Error(t("create_post_error_event_fields_required"));
      if ((postType === "event" || postType === "ad") && selectedDate && selectedTime) {
        const startDT = new Date(`${selectedDate}T${selectedTime}`);
        if (startDT <= new Date()) throw new Error("The start date and time must be in the future.");
        if (selectedEndDate && selectedEndTime) {
          const endDT = new Date(`${selectedEndDate}T${selectedEndTime}`);
          if (endDT <= startDT) throw new Error("The end date and time must be after the start.");
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

      // Feature 1: rate limit — 1 post per 10 minutes
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

      // Feature 2: duplicate check — same title/caption by this user in last 24h
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
              console.warn("[CreatePost] embed-text failed for feed video:", e);
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
      const timeStr = postType === "event" ? selectedTime : (selectedTime || now.toTimeString().slice(0, 8));

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
        if (latestEventState.allowTicketing)  rawActions.push("tickets");
        if (latestEventState.enableGroupChat) rawActions.push("join_chat");
        if (latestEventState.allowSubgroups)  rawActions.push("subgroups");
        if (latestEventState.allowInvites)    rawActions.push("invite");
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

      if (postType === "event" && latestEventState.allowTicketing) {
        isticketable = true;
        is_age_restricted = !!latestEventState.isAgeRestricted;
        const allTickets = Array.isArray(latestEventState.tickets) ? latestEventState.tickets : [];
        // Filter out tickets with empty names
        const tickets = allTickets.filter((tk) => (tk?.name || "").trim());
        product_types  = tickets.map((tk) => tk.name.trim());
        product_prices = tickets.map((tk) => {
          if (tk?.free) return 0;
          const n = parseFloat(String(tk?.cost || "0").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        });
        product_notes = tickets.map((tk) => tk?.notes || "");
        product_required_info = tickets.map((tk) => {
          const ri = normalizeRequiredInfoInput(tk?.requiredInfo || "");
          if (is_age_restricted && !ri.includes("age")) ri.push("age");
          return ri;
        });
        product_options = tickets.map((tk) =>
          (tk?.options || [])
            .filter((o) => (o?.name || "").trim())
            .map((o) => ({
              name: o.name.trim(),
              extraCost: o.free ? 0 : (parseFloat(String(o?.extraCost || "0").replace(",", ".")) || 0),
            }))
        );
        // legacy required_info: union of all per-type required info
        required_info = uniq(product_required_info.flat());
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

      const { data: inserted, error: insErr } = await supabase.from("posts").insert({
        title, description: finalDesc, user: username, author_id: uid, userpicuri: null,
        type: typeLabel, date: dateStr, time: timeStr,
        end_date: selectedEndDate || null, end_time: selectedEndTime || null,
        location: locationLabel,
        actions, isticketable, is_age_restricted,
        product_types, product_prices, required_info,
        product_notes, product_required_info, product_options,
        labels: adLabelsToSave,
        lat, lon, geom: `SRID=4326;POINT(${lon} ${lat})`, postmediauri: [],
        ...(postType === "ad" && userStripeAccountId ? {
          stripe_account_id: userStripeAccountId,
          stripe_onboarding_complete: userStripeComplete,
        } : {}),
      }).select("id").single();
      if (insErr) throw insErr;
      const postId = inserted.id;
      posthog.capture('post_created', { post_type: postType });

      // Semantic embedding (fire-and-forget)
      const textToEmbed = [title, finalDesc].filter(Boolean).join(" ");
      if (textToEmbed) {
        (async () => {
          try {
            const { data: embedData } = await supabase.functions.invoke("embed-text", { body: { text: textToEmbed } });
            if (embedData?.embedding) await supabase.from("posts").update({ caption_embedding: embedData.embedding }).eq("id", postId);
          } catch (e) {
            console.warn("[CreatePost] embed-text failed for post:", e);
          }
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
      if (media.length > 0) {
        const uploaded = await Promise.all(
          media.map((m, i) => uploadOne({ postId, fileUri: m.uri, index: i, kind: m.type }))
        );
        const { error: updErr } = await supabase.from("posts").update({ postmediauri: uploaded }).eq("id", postId);
        if (updErr) throw updErr;
      }

      if (thumbnailUri) {
        const thumbUrl = await uploadOne({ postId, fileUri: thumbnailUri, index: "thumb", kind: "image" });
        await supabase.from("posts").update({ thumbnail_url: thumbUrl }).eq("id", postId).then(() => {});
      }

      if (postType === "event") {
        await createEventGroup({ groupname: title, group_desc: desc, group_pic_link: null, username });
      }

      resetForm();
      setSuccessModal({ visible: true, title: t("create_post_success_title"), message: t("create_post_success_message") });
    } catch (e) {
      console.warn(e);
      Alert.alert(t("create_post_fail_title"), userErrorMessage(e, t("create_post_fail_title")));
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
  const inputBg = isDark ? "#1a1a1a" : "#f5f6fa";

  /* ══════════════════════════════════════════════════════════════ */
  /*  JSX                                                           */
  /* ══════════════════════════════════════════════════════════════ */
  return (
    <SafeAreaView style={[cs.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 72 : 0}
      >
        {/* ── Header ── */}
        <View style={[cs.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.navigate("Community")} style={cs.headerBack}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[cs.headerTitle, { color: theme.text }]}>
            {t("create_post_header_title")}
          </Text>
          <TouchableOpacity
            style={[cs.publishBtn, { opacity: submitting ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={cs.publishBtnText}>{t("create_post_publish_button")}</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[cs.scroll, { paddingBottom: 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Post type chips ── */}
          <Text style={[cs.sectionLabel, { color: subtle }]}>Post type</Text>
          <View style={cs.typeRow}>
            {POST_TYPES.map((pt) => {
              const active = postType === pt.key;
              return (
                <TouchableOpacity
                  key={pt.key}
                  style={[
                    cs.typeChip,
                    { borderColor: active ? "#2F91FF" : (isDark ? "#444" : "#d0d7e2") },
                    active && cs.typeChipActive,
                  ]}
                  onPress={() => setPostType(pt.key)}
                  activeOpacity={0.8}
                >
                  <Feather name={pt.icon} size={13} color={active ? "#fff" : subtle} />
                  <Text style={[cs.typeChipText, { color: active ? "#fff" : subtle }]}>{pt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Title ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 20 }]}>Title</Text>
          <View style={[cs.inputWrap, { borderColor: theme.border, backgroundColor: inputBg }]}>
            <TextInput
              placeholder={t("create_post_title_label")}
              placeholderTextColor={subtle}
              value={title}
              onChangeText={setTitle}
              style={[cs.input, { color: theme.text }]}
              maxLength={120}
            />
          </View>

          {/* ── Description ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>Description</Text>
          <View style={[cs.inputWrap, { borderColor: theme.border, backgroundColor: inputBg }]}>
            <TextInput
              placeholder={t("create_post_description_placeholder")}
              placeholderTextColor={subtle}
              value={desc}
              onChangeText={setDesc}
              style={[cs.input, { color: theme.text, height: 90 }]}
              multiline
              textAlignVertical="top"
              maxLength={1000}
            />
          </View>

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
                {isEvent ? "Start date & time *" : "Start date & time"}
              </Text>
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
                </View>
                {showDatePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedDate ? new Date(selectedDate) : new Date()} mode="date" display={Platform.OS === "ios" ? "inline" : "calendar"} onChange={handleDateChange} minimumDate={new Date()} style={{ alignSelf: "center" }} />
                  </View>
                )}
                {showTimePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedTime ? timeStringToDate(selectedTime) : new Date()} mode="time" display={Platform.OS === "ios" ? "spinner" : "clock"} onChange={handleTimeChange} style={{ alignSelf: "center" }} />
                  </View>
                )}
              </View>

              <Text style={[cs.sectionLabel, { color: subtle, marginTop: 12 }]}>End date & time (optional)</Text>
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
                </View>
                {showEndDatePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedEndDate ? new Date(selectedEndDate) : (selectedDate ? new Date(selectedDate) : new Date())} mode="date" display={Platform.OS === "ios" ? "inline" : "calendar"} onChange={handleEndDateChange} minimumDate={selectedDate ? new Date(selectedDate) : new Date()} style={{ alignSelf: "center" }} />
                  </View>
                )}
                {showEndTimePicker && (
                  <View style={[cs.pickerDropdown, { backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "#444" : "#d0d7e2" }]}>
                    <DateTimePicker value={selectedEndTime ? timeStringToDate(selectedEndTime) : new Date()} mode="time" display={Platform.OS === "ios" ? "spinner" : "clock"} onChange={handleEndTimeChange} style={{ alignSelf: "center" }} />
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── Location ── */}
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>
            {isEvent ? "Location *" : "Location"}
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
          <Text style={[cs.sectionLabel, { color: subtle, marginTop: 16 }]}>Media *</Text>
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
                  {thumbnailUri ? "Change thumbnail" : "Add thumbnail"}
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

          {/* ── Dynamic panels ── */}
          {isEvent && <EventPanel onState={setEventStateSafe} />}
          {isAd    && <AdPanel    onState={setAdState}    />}

          {/* ── Feed tags ── */}
          {isFeedPost && (
            <View style={{ marginTop: 20 }}>
              <Text style={[cs.sectionLabel, { color: subtle }]}>Categories</Text>
              <Text style={[cs.tagHint, { color: subtle }]}>Tag your video so people can find it</Text>
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
  publishBtnText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#fff" },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Section labels (matches AdPublisherScreen)
  sectionLabel: { fontFamily: "PoppinsBold", fontSize: 10, marginBottom: 8 },

  // Post type chips
  typeRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip:      { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, gap: 5 },
  typeChipActive:{ backgroundColor: "#2F91FF" },
  typeChipText:  { fontFamily: "PoppinsBold", fontSize: 12 },

  // Inputs
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  input:     { fontFamily: "Poppins", fontSize: 14, flex: 1 },

  // Date / time
  dateTimeContainer: { marginBottom: 4, position: "relative", zIndex: 20 },
  dateTimeRow:       { flexDirection: "row", alignItems: "center", columnGap: 10 },
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
