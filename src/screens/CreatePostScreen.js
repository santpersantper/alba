// CreatePostScreen.js — DROP-IN
// Fixes:
// 1) Video length check: expo-image-picker `asset.duration` is often **milliseconds** → normalize to seconds (prevents false "too long").
// 2) Required info: map Italian inputs -> canonical English keys in required_info:
//    nome->name, età/eta->age, genere->gender, città/citta->city, email->email, nome utente/utente/username->username

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
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

/* ---------- Tiny UI bits ---------- */
function Header({ onSubmit, submitting, theme, titleText }) {
  const navigation = useNavigation();
  return (
    <View style={[styles.header, { backgroundColor: theme.gray }]}>
      <TouchableOpacity
        onPress={() => navigation.navigate("Community")}
        hitSlop={8}
        style={styles.iconBtn}
      >
        <Feather name="x" size={22} color={theme.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.text }]}>{titleText}</Text>
      <TouchableOpacity
        hitSlop={8}
        style={styles.iconBtn}
        onPress={onSubmit}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator /> : <Feather name="send" size={20} color={theme.text} />}
      </TouchableOpacity>
    </View>
  );
}

function Field({ style, children, isDark, lineOnly }) {
  return (
    <View
      style={[
        styles.fieldBase,
        lineOnly
          ? {
              backgroundColor: "transparent",
              borderWidth: 0,
              borderBottomWidth: 1,
              borderRadius: 0,
              borderColor: isDark ? "#555C69" : "#D9D9D9",
            }
          : {
              backgroundColor: isDark ? "#2B2B2B" : "#FFFFFF",
              borderColor: isDark ? "#444A55" : "#D9D9D9",
            },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function Input({ placeholder, value, onChangeText, multiline, theme, isDark }) {
  return (
    <Field style={multiline ? styles.textareaWrap : undefined} isDark={isDark} lineOnly={!multiline}>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#8C96A5" : "#8F8F8F"}
        value={value}
        onChangeText={onChangeText}
        style={[styles.textInput, multiline && styles.textarea, { color: theme.text }]}
        multiline={multiline}
      />
    </Field>
  );
}

function CheckboxRow({ label, checked, onToggle, style, theme, isDark }) {
  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.8} style={[styles.checkboxRow, style]}>
      <View
        style={[
          styles.checkboxBox,
          {
            backgroundColor: isDark ? "#2B2B2B" : "#fff",
            borderColor: isDark ? "#555C69" : "#B8B8B8",
          },
          checked && styles.checkboxBoxChecked,
        ]}
      >
        {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
      <Text style={[styles.checkboxLabel, { color: theme.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MediaThumb({ uri, isVideo }) {
  return (
    <View style={styles.mediaCard}>
      <Image source={{ uri }} style={styles.mediaImg} />
      {isVideo && (
        <View style={styles.videoBadge}>
          <Text style={styles.videoBadgeText}>VIDEO</Text>
        </View>
      )}
    </View>
  );
}

/* ---------- helpers ---------- */
const BUCKET = "alba-media";
const MAX_VIDEO_SECONDS = 20;

const FEED_TAGS = [
  "Music", "Art", "Food", "Travel", "Sports", "Fitness",
  "Gaming", "Fashion", "Comedy", "Dance", "Nature", "Tech",
  "Film", "Education", "Lifestyle", "Pets",
];

const stripDiacritics = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeDurationSeconds = (d) => {
  if (typeof d !== "number" || !Number.isFinite(d)) return null;
  // expo-image-picker often returns ms for videos (e.g., 15321) -> convert
  // If it’s already seconds (e.g., 12.3) keep it.
  return d > 1000 ? d / 1000 : d;
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

  // italian -> english canonical
  if (s === "nome") return "name";
  if (s === "eta" || s === "età") return "age";
  if (s === "genere") return "gender";
  if (s === "citta" || s === "città") return "city";
  if (s === "email") return "email";
  if (s === "nome utente" || s === "utente") return "username";

  // also accept english-ish variants
  if (s === "name") return "name";
  if (s === "age") return "age";
  if (s === "gender") return "gender";
  if (s === "city") return "city";
  if (s === "username") return "username";

  return null;
};

const normalizeRequiredInfoInput = (text) => {
  const parts = String(text || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const mapped = parts.map((p) => canonicalRequiredKey(p) || p); // keep custom fields as typed
  return uniq(mapped);
};

/* ---------- Screen ---------- */
export default function CreatePost() {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  // 'event' | 'ad' | 'article' | 'profilePost' | 'product' | 'feedPost'
  const [postType, setPostType] = useState("event");

  const [eventState, setEventState] = useState({
    enableGroupChat: true,
    allowTicketing: false,
    tickets: [],
    allowSubgroups: false,
    allowInvites: false,
    requiredBuyerInfo: "",
  });
  const [adState, setAdState] = useState({
    targetInterested: true,
    iap: false,
    products: [],
    requiredBuyerInfo: "",
  });

  // media items: {uri, type:'image'|'video', durationSec?, width?, height?, fileSize?}
  const [media, setMedia] = useState([]);
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successModal, setSuccessModal] = useState({ visible: false, title: "", message: "" });

  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const tr = (key, fallback) => {
    const s = t?.(key);
    if (!s || s === key) return fallback;
    return s;
  };

  // Date & time
  const [selectedDate, setSelectedDate] = useState(null); // "YYYY-MM-DD" or null
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [selectedTime, setSelectedTime] = useState(null); // "HH:MM:SS" or null
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Manual location input (required for events)
  const [locationText, setLocationText] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const locationDebounceRef = useRef(null);

  // Ad-specific notes
  const [adNotes, setAdNotes] = useState("");

  // Feed post tags
  const [feedTags, setFeedTags] = useState([]);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });
  if (!fontsLoaded) return null;

  // ✅ Create a group row for events (after post is created)
  const createEventGroup = async ({ groupname, group_desc, group_pic_link, username }) => {
    const row = {
      groupname: (groupname || "").trim(),
      group_desc: group_desc?.trim() ? group_desc.trim() : null,
      group_pic_link: group_pic_link || null,
      members: [username],
      subgroups_allowed: true,
      subgroups: [],
      group_admin: [username],
      is_subgroup_of: null,
    };

    const { error } = await supabase.from("groups").insert(row);
    if (error) throw error;
  };

  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("create_post_error_media_permission"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:
        postType === "feedPost"
          ? ImagePicker.MediaTypeOptions.Videos
          : ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 10,
    });
    if (result.canceled) return;

    const assets = result.assets || [];

    // ✅ FIX: normalize duration to seconds before comparing
    const tooLong = assets.filter((a) => {
      if (a.type !== "video") return false;
      const durSec = normalizeDurationSeconds(a.duration);
      return typeof durSec === "number" && durSec > MAX_VIDEO_SECONDS;
    });

    if (tooLong.length > 0) {
      Alert.alert(
        tr("create_post_error_video_too_long_title", "Video too long"),
        tr(
          "create_post_error_video_too_long_message",
          `Please pick videos that are ${MAX_VIDEO_SECONDS} seconds or less.`
        )
      );
    }

    const picked = assets
      .filter((a) => {
        if (a.type !== "video") return true;
        const durSec = normalizeDurationSeconds(a.duration);
        return durSec == null || durSec <= MAX_VIDEO_SECONDS;
      })
      .map((a) => {
        const durSec = a.type === "video" ? normalizeDurationSeconds(a.duration) : null;
        return {
          uri: a.uri,
          type: a.type === "video" ? "video" : "image",
          durationSec: typeof durSec === "number" ? durSec : null,
          width: a.width ?? null,
          height: a.height ?? null,
          fileSize: a.fileSize ?? null,
        };
      });

    if (!picked.length) return;
    setMedia((prev) => [...prev, ...picked]);
  };

  const pickThumbnail = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("create_post_error_media_permission"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) setThumbnailUri(asset.uri);
  };

  // Convert HEIC -> JPEG (so RN can display); leave videos as-is.
  const ensureDisplayableImage = async (fileUri) => {
    const lower = (fileUri || "").toLowerCase();
    const isHeic = lower.endsWith(".heic") || lower.includes(".heic?");
    if (!isHeic) return { uri: fileUri, contentType: "image/jpeg", ext: "jpg" };
    try {
      const manip = await ImageManipulator.manipulateAsync(fileUri, [], {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      return { uri: manip.uri, contentType: "image/jpeg", ext: "jpg" };
    } catch {
      return { uri: fileUri, contentType: "image/heic", ext: "heic" };
    }
  };

  // Upload using ArrayBuffer (RN-safe)
  const uploadOne = async ({ postId, fileUri, index, kind }) => {
    let lower = (fileUri || "").toLowerCase();
    let ext =
      lower.endsWith(".png")
        ? "png"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "jpg"
        : lower.endsWith(".heic")
        ? "heic"
        : lower.endsWith(".mp4")
        ? "mp4"
        : lower.endsWith(".mov")
        ? "mov"
        : kind === "video"
        ? "mp4"
        : "jpg";

    let toUploadUri = fileUri;
    let contentType =
      ext === "png"
        ? "image/png"
        : ext === "jpg"
        ? "image/jpeg"
        : ext === "jpeg"
        ? "image/jpeg"
        : ext === "heic"
        ? "image/heic"
        : ext === "mp4"
        ? "video/mp4"
        : ext === "mov"
        ? "video/quicktime"
        : kind === "video"
        ? "video/mp4"
        : "image/jpeg";

    if (kind === "image" && ext === "heic") {
      const converted = await ensureDisplayableImage(fileUri);
      toUploadUri = converted.uri;
      contentType = converted.contentType;
      ext = converted.ext;
      lower = toUploadUri.toLowerCase();
    }

    const key = `posts/${postId}/media_${index}.${ext}`;

    const res = await fetch(toUploadUri);
    const arrayBuffer = await res.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);

    const { error } = await supabase.storage.from(BUCKET).upload(key, fileBytes, {
      contentType,
      cacheControl: "31536000",
      upsert: true,
    });

    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return data.publicUrl;
  };

  // Labels for the chips
  const dateLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : t("create_post_any_date");

  const timeLabel = selectedTime ? selectedTime.slice(0, 5) : t("create_post_any_time");

  const handleDateChange = (event, date) => {
    if (!date) {
      setShowDatePicker(false);
      return;
    }
    const iso = date.toISOString().slice(0, 10);
    setSelectedDate(iso);
    setShowDatePicker(false);
  };

  const timeStringToDate = (timeStr) => {
    const [h, m, s] = timeStr.split(":").map((x) => parseInt(x || "0", 10));
    const d = new Date();
    d.setHours(h || 0, m || 0, s || 0, 0);
    return d;
  };

  const handleTimeChange = (event, date) => {
    if (!date) {
      setShowTimePicker(false);
      return;
    }
    const tStr = date.toTimeString().slice(0, 8); // "HH:MM:SS"
    setSelectedTime(tStr);
    setShowTimePicker(false);
  };

  const resetForm = () => {
    setTitle("");
    setDesc("");
    setMedia([]);
    setPostType("event");
    setEventState({
      enableGroupChat: true,
      allowTicketing: false,
      tickets: [],
      allowSubgroups: false,
      allowInvites: false,
      requiredBuyerInfo: "",
    });
    setAdState({
      targetInterested: true,
      iap: false,
      products: [],
      requiredBuyerInfo: "",
    });
    setSelectedDate(null);
    setSelectedTime(null);
    setLocationText("");
    setLocationSuggestions([]);
    setAdNotes("");
    setThumbnailUri(null);
    setFeedTags([]);
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      if (!title.trim()) throw new Error(t("create_post_error_title_required"));
      if (!media.length) throw new Error(t("create_post_error_media_required"));

      // ✅ FIX: enforce 20s max using normalized seconds (no false positives)
      const badVideo = media.find(
        (m) => m.type === "video" && typeof m.durationSec === "number" && m.durationSec > MAX_VIDEO_SECONDS
      );
      if (badVideo) {
        throw new Error(
          tr(
            "create_post_error_video_too_long_message",
            `Video must be ${MAX_VIDEO_SECONDS} seconds or less.`
          )
        );
      }

      // Feed Post: media must be video-only
      if (postType === "feedPost" && media.some((m) => m.type !== "video")) {
        throw new Error("Feed Posts must contain only video media.");
      }

      // for events, date + time + location mandatory
      if (postType === "event" && (!selectedDate || !selectedTime || !locationText.trim())) {
        throw new Error(t("create_post_error_event_fields_required"));
      }

      // Auth + username
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error(t("create_post_error_not_authenticated"));

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", uid)
        .maybeSingle();
      if (profErr) throw profErr;

      const username = prof?.username || uid;
      const userPicUri = null;

      // Device location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") throw new Error(t("create_post_error_location_denied"));

      const pos = await Location.getCurrentPositionAsync({});
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      let locationLabel = locationText.trim() || null;

      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (!locationLabel && geo && geo.length > 0) {
          const g = geo[0];
          locationLabel = g.city || g.subregion || g.region || g.country || g.name || null;
        }
      } catch {}

      // ----- FEED POST BRANCH → feed_videos table -----
      if (postType === "feedPost") {
        const mainVideo = media[0];
        if (!mainVideo || mainVideo.type !== "video") {
          throw new Error("Feed Posts require at least one video.");
        }
        if (typeof mainVideo.durationSec === "number" && mainVideo.durationSec > MAX_VIDEO_SECONDS) {
          throw new Error(
            tr(
              "create_post_error_video_too_long_message",
              `Video must be ${MAX_VIDEO_SECONDS} seconds or less.`
            )
          );
        }

        const feedVideoId = `feed_${uid}_${Date.now()}`;

        const videoUrl = await uploadOne({
          postId: feedVideoId,
          fileUri: mainVideo.uri,
          index: 0,
          kind: "video",
        });

        const caption = desc || title || null;

        const { data: feedRow, error: feedErr } = await supabase
          .from("feed_videos")
          .insert({
            user_id: uid,
            username: username,
            video_storage_path: videoUrl,
            thumbnail_path: null,
            video_duration: mainVideo.durationSec ?? null,
            video_width: mainVideo.width || null,
            video_height: mainVideo.height || null,
            filesize_bytes: mainVideo.fileSize || null,
            caption,
            tags: feedTags.length > 0 ? feedTags : [],
            visibility: "public",
            geo_lat: lat,
            geo_lon: lon,
            is_ready: true,
            is_processed: true,
          })
          .select("id")
          .single();

        if (feedErr) throw feedErr;

        // Fire-and-forget: embed the caption for semantic search
        if (feedRow?.id && caption) {
          (async () => {
            try {
              const { data: embedData } = await supabase.functions.invoke("embed-text", {
                body: { text: caption },
              });
              if (embedData?.embedding) {
                await supabase
                  .from("feed_videos")
                  .update({ caption_embedding: embedData.embedding })
                  .eq("id", feedRow.id);
              }
            } catch {}
          })();
        }

        resetForm();
        setSuccessModal({ visible: true, title: t("create_post_success_title"), message: t("create_post_success_message") });
        return;
      }

      // ----- COMMUNITY POSTS BRANCH → posts table -----
      const now = new Date();
      let dateStr;
      let timeStr;

      if (postType === "event") {
        dateStr = selectedDate;
        timeStr = selectedTime;
      } else {
        dateStr = selectedDate || now.toISOString().slice(0, 10);
        timeStr = selectedTime || now.toTimeString().slice(0, 8);
      }

      const typeLabel =
        postType === "event"
          ? "Event"
          : postType === "ad"
          ? "Ad"
          : postType === "article"
          ? "Article"
          : postType === "product"
          ? "Product"
          : "Update";

      // ----- Actions -----
      const rawActions = [];
      if (postType === "event") {
        if (eventState.allowTicketing) rawActions.push("tickets");
        if (eventState.enableGroupChat) rawActions.push("join_chat");
        if (eventState.allowSubgroups) rawActions.push("subgroups");
        if (eventState.allowInvites) rawActions.push("invite");
      } else if (postType === "ad") {
        if (adState.iap) rawActions.push("buy");
        rawActions.push("message");
      } else if (postType === "product") {
        rawActions.push("buy", "message");
      }
      rawActions.push("share", "save");
      const actions = Array.from(new Set(rawActions));

      // ----- Pricing + required_info -----
      let isticketable = false;
      let product_types = [];
      let product_prices = [];
      let required_info = [];

      if (postType === "event" && eventState.allowTicketing) {
        isticketable = true;
        const tickets = Array.isArray(eventState.tickets) ? eventState.tickets : [];

        product_types = tickets.map((t) => (t?.name || "").trim()).filter(Boolean);
        product_prices = tickets.map((t) => {
          if (t?.free) return 0;
          const n = parseFloat(String(t?.cost || "0").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        });

        // ✅ FIX: map italian fields -> english canonical keys
        if (eventState.requiredBuyerInfo) {
          required_info = normalizeRequiredInfoInput(eventState.requiredBuyerInfo);
        }
      }

      if (postType === "ad" && adState.iap) {
        const products = Array.isArray(adState.products) ? adState.products : [];

        product_types = products.map((p) => (p?.name || "").trim()).filter(Boolean);
        product_prices = products.map((p) => {
          const n = parseFloat(String(p?.cost || "0").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        });

        // ✅ FIX: map italian fields -> english canonical keys
        if (adState.requiredBuyerInfo) {
          required_info = normalizeRequiredInfoInput(adState.requiredBuyerInfo);
        }
      }

      // Merge adNotes into description for ad posts
      const finalDesc = isAd && adNotes.trim()
        ? [desc.trim(), adNotes.trim()].filter(Boolean).join("\n\n")
        : desc;

      // Create post (without media first)
      const baseRow = {
        title,
        description: finalDesc,
        user: username,
        userpicuri: userPicUri,
        type: typeLabel,
        date: dateStr,
        time: timeStr,
        location: locationLabel,
        actions,
        isticketable,
        product_types,
        product_prices,
        required_info,
        lat,
        lon,
        geom: `SRID=4326;POINT(${lon} ${lat})`,
        postmediauri: [],
      };

      const { data: inserted, error: insErr } = await supabase
        .from("posts")
        .insert(baseRow)
        .select("id")
        .single();

      if (insErr) throw insErr;
      const postId = inserted.id;

      // Fire-and-forget: embed title + description for semantic search in CommunityScreen
      if (postId) {
        const textToEmbed = [title, finalDesc].filter(Boolean).join(" ");
        if (textToEmbed) {
          (async () => {
            try {
              const { data: embedData } = await supabase.functions.invoke("embed-text", {
                body: { text: textToEmbed },
              });
              if (embedData?.embedding) {
                await supabase
                  .from("posts")
                  .update({ caption_embedding: embedData.embedding })
                  .eq("id", postId);
              }
            } catch {}
          })();
        }
      }

      if (postType === "event") {
        const { error: evErr } = await supabase.from("events").insert({
          title: title,                 // ✅ REQUIRED
          post_id: inserted.id,
          ticket_holders: [],
          attendees_info: [],
          created_at: new Date().toISOString(),
        });

        if (evErr) throw evErr;
      }

      // Upload media → store public URLs into postmediauri
      let uploaded = [];
      if (media.length > 0) {
        uploaded = await Promise.all(
          media.map((m, i) =>
            uploadOne({
              postId,
              fileUri: m.uri,
              index: i,
              kind: m.type,
            })
          )
        );
        const { error: updErr } = await supabase
          .from("posts")
          .update({ postmediauri: uploaded })
          .eq("id", postId);
        if (updErr) throw updErr;
      }

      // Upload thumbnail (if set)
      if (thumbnailUri) {
        const thumbUrl = await uploadOne({
          postId,
          fileUri: thumbnailUri,
          index: "thumb",
          kind: "image",
        });
        await supabase
          .from("posts")
          .update({ thumbnail_url: thumbUrl })
          .eq("id", postId)
          .then(() => {});
      }

      // ✅ If it's an event: auto-create a group (title as groupname, you as only member/admin)
      if (postType === "event") {
        await createEventGroup({
          groupname: title,
          group_desc: desc,
          group_pic_link: null,
          username,
        });
      }

      resetForm();
      setSuccessModal({ visible: true, title: t("create_post_success_title"), message: t("create_post_success_message") });
    } catch (e) {
      console.warn(e);
      Alert.alert(t("create_post_fail_title"), e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const fetchLocationSuggestions = (text) => {
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!text || text.trim().length < 2) {
      setLocationSuggestions([]);
      return;
    }
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const token = Constants.expoConfig?.extra?.expoPublic?.MAPBOX_PUBLIC_TOKEN ?? "";
        if (!token) return;
        const q = encodeURIComponent(text.trim());
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?types=poi,place,address&limit=5&access_token=${token}`
        );
        const json = await res.json();
        setLocationSuggestions(Array.isArray(json.features) ? json.features : []);
      } catch {
        setLocationSuggestions([]);
      }
    }, 350);
  };

  const isEvent = postType === "event";
  const isAd = postType === "ad";
  const isArticle = postType === "article";
  const isProfilePost = postType === "profilePost";
  const isProduct = postType === "product";
  const isFeedPost = postType === "feedPost";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.gray }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 72 : 0}
      >
        <View style={[styles.container, { backgroundColor: theme.gray }]}>
          <Header
            onSubmit={handleSubmit}
            submitting={submitting}
            theme={theme}
            titleText={t("create_post_header_title")}
          />

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 16 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title */}
            <Input
              placeholder={t("create_post_title_label")}
              value={title}
              onChangeText={setTitle}
              theme={theme}
              isDark={isDark}
            />

            {/* Description */}
            <Input
              multiline
              placeholder={t("create_post_description_placeholder")}
              value={desc}
              onChangeText={setDesc}
              theme={theme}
              isDark={isDark}
            />

            {/* Date & Time chips */}
            <View style={styles.dateTimeContainer}>
              <View style={styles.dateTimeRow}>
                {/* Date chip */}
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    isDark
                      ? { backgroundColor: "#2B2B2B", borderColor: "#FFFFFF" }
                      : { backgroundColor: "#FFFFFF", borderColor: "#d9e4f3" },
                  ]}
                  onPress={() => {
                    setShowDatePicker((prev) => !prev);
                    setShowTimePicker(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Feather name="calendar" size={16} color="#2F91FF" style={{ marginRight: 6 }} />
                  <Text style={[styles.filterText, { color: isDark ? "#FFFFFF" : "#111111" }]}>
                    {dateLabel}
                  </Text>

                  {selectedDate && (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        setSelectedDate(null);
                      }}
                      style={{ paddingHorizontal: 4 }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={[styles.filterClear, { color: isDark ? "#E0E0E0" : "#9aa6b6" }]}>
                        ×
                      </Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                {/* Time chip */}
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    { flex: 1 },
                    isDark
                      ? { backgroundColor: "#2B2B2B", borderColor: "#FFFFFF" }
                      : { backgroundColor: "#FFFFFF", borderColor: "#d9e4f3" },
                  ]}
                  onPress={() => {
                    setShowTimePicker((prev) => !prev);
                    setShowDatePicker(false);
                  }}
                  onLongPress={() => setSelectedTime(null)}
                  activeOpacity={0.8}
                >
                  <Feather name="clock" size={16} color="#2F91FF" style={{ marginRight: 6 }} />
                  <Text style={[styles.filterText, { color: isDark ? "#FFFFFF" : "#111111" }]}>
                    {timeLabel}
                  </Text>
                  <Feather
                    name={showTimePicker ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={isDark ? "#FFFFFF" : "#6F7D95"}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>
              </View>

              {showDatePicker && (
                <View
                  style={[
                    styles.dateDropdown,
                    {
                      backgroundColor: isDark ? "#2B2B2B" : "#FFFFFF",
                      borderColor: isDark ? "#FFFFFF" : "#d9e4f3",
                    },
                  ]}
                >
                  <DateTimePicker
                    value={selectedDate ? new Date(selectedDate) : new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "calendar"}
                    onChange={handleDateChange}
                    style={{ alignSelf: "center" }}
                  />
                </View>
              )}

              {showTimePicker && (
                <View
                  style={[
                    styles.timeDropdown,
                    {
                      backgroundColor: isDark ? "#2B2B2B" : "#FFFFFF",
                      borderColor: isDark ? "#FFFFFF" : "#d9e4f3",
                    },
                  ]}
                >
                  <DateTimePicker
                    value={selectedTime ? timeStringToDate(selectedTime) : new Date()}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "clock"}
                    onChange={handleTimeChange}
                    style={{ alignSelf: "center" }}
                  />
                </View>
              )}
            </View>

            {/* Location with Mapbox suggestions */}
            <View style={{ position: "relative", zIndex: 10 }}>
              <Field isDark={isDark} lineOnly>
                <TextInput
                  placeholder={t("create_post_location_placeholder")}
                  placeholderTextColor={isDark ? "#8C96A5" : "#8F8F8F"}
                  value={locationText}
                  onChangeText={(text) => {
                    setLocationText(text);
                    fetchLocationSuggestions(text);
                  }}
                  style={[styles.textInput, { color: theme.text }]}
                />
              </Field>
              {locationSuggestions.length > 0 && (
                <View
                  style={[
                    styles.suggestionsBox,
                    { backgroundColor: isDark ? "#2B2B2B" : "#fff", borderColor: isDark ? "#444" : "#ddd" },
                  ]}
                >
                  {locationSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.suggestionItem}
                      onPress={() => {
                        setLocationText(s.place_name);
                        setLocationSuggestions([]);
                      }}
                    >
                      <Feather name="map-pin" size={13} color="#2F91FF" style={{ marginRight: 8 }} />
                      <Text
                        style={[styles.suggestionText, { color: theme.text }]}
                        numberOfLines={2}
                      >
                        {s.place_name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Media + Thumbnail side by side */}
            <View style={styles.mediaButtonsRow}>
              <TouchableOpacity style={[styles.addMediaBtn, { flex: 1 }]} onPress={pickMedia} disabled={submitting}>
                <Text style={styles.addMediaText}>{t("create_post_add_media_button")}</Text>
              </TouchableOpacity>

              {!isFeedPost && (
                <TouchableOpacity
                  style={[styles.addMediaBtn, { flex: 1 }]}
                  onPress={pickThumbnail}
                  disabled={submitting}
                >
                  <Text style={styles.addMediaText}>
                    {thumbnailUri ? "Change thumbnail" : "Add thumbnail"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {media.length > 0 && (
              <View style={styles.mediaRow}>
                {media.map((m, i) => (
                  <MediaThumb key={`${m.uri}-${i}`} uri={m.uri} isVideo={m.type === "video"} />
                ))}
              </View>
            )}

            {thumbnailUri && (
              <View style={{ marginTop: 8, position: "relative", alignSelf: "flex-start" }}>
                <Image source={{ uri: thumbnailUri }} style={[styles.mediaImg, { borderRadius: 8, width: 110, height: 100 }]} />
                <TouchableOpacity
                  onPress={() => setThumbnailUri(null)}
                  style={styles.videoBadge}
                  hitSlop={8}
                >
                  <Text style={styles.videoBadgeText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Post Type */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t("create_post_post_type_title")}
            </Text>

            <View style={styles.postTypeRow}>
              <CheckboxRow
                label={t("create_post_post_type_event")}
                checked={isEvent}
                onToggle={() => setPostType("event")}
                theme={theme}
                isDark={isDark}
                style={styles.postTypeItem}
              />
              <CheckboxRow
                label={t("create_post_post_type_ad")}
                checked={isAd}
                onToggle={() => setPostType("ad")}
                theme={theme}
                isDark={isDark}
                style={styles.postTypeItem}
              />
              <CheckboxRow
                label={t("create_post_post_type_article")}
                checked={isArticle}
                onToggle={() => setPostType("article")}
                theme={theme}
                isDark={isDark}
                style={styles.postTypeItem}
              />
              <CheckboxRow
                label={t("create_post_post_type_profile")}
                checked={isProfilePost}
                onToggle={() => setPostType("profilePost")}
                theme={theme}
                isDark={isDark}
                style={styles.postTypeItem}
              />
              <CheckboxRow
                label={t("create_post_post_type_product")}
                checked={isProduct}
                onToggle={() => setPostType("product")}
                theme={theme}
                isDark={isDark}
                style={styles.postTypeItem}
              />
              <CheckboxRow
                label={t("create_post_post_type_feed")}
                checked={isFeedPost}
                onToggle={() => setPostType("feedPost")}
                theme={theme}
                isDark={isDark}
                style={styles.postTypeItem}
              />
            </View>

            {/* Dynamic panel */}
            {isEvent && <EventPanel onState={setEventState} />}
            {isAd && <AdPanel onState={setAdState} />}

            {/* Feed post tag selector */}
            {isFeedPost && (
              <View style={{ marginTop: 16 }}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  Video categories
                </Text>
                <Text style={{ color: isDark ? "#8C96A5" : "#8F8F8F", fontSize: 12, fontFamily: "Poppins", marginBottom: 10 }}>
                  Tag your video so people can discover it
                </Text>
                <View style={styles.tagsWrap}>
                  {FEED_TAGS.map((tag) => {
                    const active = feedTags.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        onPress={() =>
                          setFeedTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag]
                          )
                        }
                        style={[
                          styles.tagChip,
                          active
                            ? { backgroundColor: "#00A9FF", borderColor: "#00A9FF" }
                            : { backgroundColor: "transparent", borderColor: isDark ? "#555" : "#d0d7e2" },
                        ]}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: active ? "#fff" : isDark ? "#8C96A5" : "#6F7D95", fontSize: 13, fontFamily: "Poppins" }}>
                          {tag}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={{ height: 18 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Alba-native success modal */}
      <Modal
        visible={successModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessModal({ visible: false, title: "", message: "" })}
      >
        <View style={styles.successOverlay}>
          <View style={[styles.successCard, { backgroundColor: isDark ? "#101218" : "#fff" }]}>
            {!!successModal.title && (
              <Text style={[styles.successTitle, { color: isDark ? "#fff" : "#111" }]}>
                {successModal.title}
              </Text>
            )}
            <Text style={[styles.successMessage, { color: isDark ? "#ccc" : "#333" }]}>
              {successModal.message}
            </Text>
            <TouchableOpacity
              style={styles.successOkBtn}
              onPress={() => setSuccessModal({ visible: false, title: "", message: "" })}
            >
              <Text style={styles.successOkText}>{t("ok_button") || "OK"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */
const R = 10;
const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
    fontFamily: "Poppins",
  },
  scrollContent: { paddingHorizontal: 16 },
  fieldBase: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: R,
    paddingHorizontal: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
    fontFamily: "Poppins",
  },
  textareaWrap: { minHeight: 110, alignItems: "flex-start", paddingTop: 12 },
  textarea: { textAlignVertical: "top", height: 86 },
  addMediaBtn: {
    backgroundColor: "#4DA3FF",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignSelf: "center",
    marginTop: 8,
  },
  addMediaText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Poppins",
  },
  mediaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 2,
    marginTop: 16,
    marginBottom: 6,
  },
  mediaCard: {
    width: 110,
    height: 100,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#F2F2F2",
    elevation: 1,
  },
  mediaImg: { width: "100%", height: "100%" },
  videoBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  videoBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  sectionTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "700",
    color: "#2E2E2E",
    fontFamily: "Poppins",
  },
  postTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  postTypeItem: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  checkboxRow: { flexDirection: "row", alignItems: "center" },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  checkboxBoxChecked: { backgroundColor: "#3D8BFF", borderColor: "#3D8BFF" },
  checkboxLabel: { fontSize: 14, fontFamily: "Poppins" },

  // Date/time chip styles
  dateTimeContainer: {
    marginTop: 12,
    marginBottom: 4,
    position: "relative",
    zIndex: 20,
  },
  dateTimeRow: {
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
    left: 0,
    right: 0,
    paddingTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  timeDropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    paddingTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  timeOptionText: {
    fontSize: 13,
    fontFamily: "Poppins",
  },

  // Media buttons row (side by side)
  mediaButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },

  // Mapbox suggestions dropdown
  suggestionsBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 50,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Poppins",
  },

  successOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  successCard: {
    width: "82%",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  successTitle: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 6,
  },
  successMessage: {
    fontFamily: "Poppins",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  successOkBtn: {
    backgroundColor: "#4EBCFF",
    paddingVertical: 10,
    paddingHorizontal: 36,
    borderRadius: 12,
  },
  successOkText: {
    color: "#fff",
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 15,
  },

  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
