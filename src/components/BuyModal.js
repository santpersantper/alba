import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
  Alert,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Calendar from "expo-calendar";
import { decode } from "base-64";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { useGuest } from "../theme/GuestContext";
import { posthog } from "../lib/analytics";
import * as Crypto from "expo-crypto";
import {
  PlatformPayButton,
  PlatformPay,
  usePlatformPay,
  useStripe,
} from "@stripe/stripe-react-native";


const POSTS_TABLE = "posts";
const EVENTS_TABLE = "events";
const PROFILES_TABLE = "profiles";

const BASIC_KEYS = new Set(["name", "age", "gender", "sex"]);

const cleanUsername = (v) =>
  String(v || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "");

const normKey = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const fieldIsName = (f) => { const k = normKey(f); return k === "name" || k === "nome"; };
const fieldIsAge = (f) => { const k = normKey(f); return k === "age" || k === "età" || k === "eta"; };
const fieldIsGender = (f) => {
  const k = normKey(f);
  return k === "gender" || k === "sex";
};

const profileValueForField = (f, profile) => {
  if (!profile) return "";
  const k = normKey(f);
  if (k === "name" || k === "nome") return String(profile.name || "");
  if (k === "age" || k === "età" || k === "eta") return profile.age != null ? String(profile.age) : "";
  if (k === "email" || k === "mail") return String(profile.email || "");
  if (k === "username" || k === "nomeutente") return String(profile.username || "");
  return "";
};

const looksLikeUuid = (s) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);


export default function BuyModal({ visible, onClose, postId }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();
  const { isGuest } = useGuest();

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [postCalendarData, setPostCalendarData] = useState(null);
  const showFeedback = (title, message, onOk, showCalendar = false) =>
    setFeedback({ title, message, onOk: onOk || null, showCalendar });
  const [types, setTypes] = useState([]);
  const [prices, setPrices] = useState([]);
  const [bools, setBools] = useState([]);
  const [requiredInfo, setRequiredInfo] = useState([]);
  const [productNotes, setProductNotes] = useState([]);
  const [productRequiredInfo, setProductRequiredInfo] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [isAgeRestricted, setIsAgeRestricted] = useState(false);
  const [postType, setPostType] = useState(null);
  const [items, setItems] = useState([]);

  // Manual approval state
  const [manuallyApprove, setManuallyApprove] = useState(false);
  const [approvalInfoPlaceholder, setApprovalInfoPlaceholder] = useState("");
  const [approvalInfo, setApprovalInfo] = useState("");
  const [approvalPhoto, setApprovalPhoto] = useState(null);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [organizerUser, setOrganizerUser] = useState(null);
  const [freeConfirmationVisible, setFreeConfirmationVisible] = useState(false);

  const [isSoldOut, setIsSoldOut] = useState(false);

  // auth context
  const [myUsername, setMyUsername] = useState(null);
  const [myProfile, setMyProfile] = useState(null);


  const LOG = () => {};
  const WARN = () => {};

  const { isPlatformPaySupported, confirmPlatformPayPayment } = usePlatformPay();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [platformPayAvailable, setPlatformPayAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === "android") return;
    isPlatformPaySupported()
      .then(setPlatformPayAvailable)
      .catch(() => {});
  }, [isPlatformPaySupported]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid || !alive) return;

        const { data: prof } = await supabase
          .from(PROFILES_TABLE)
          .select("username, name, age, email")
          .eq("id", uid)
          .maybeSingle();

        if (!alive) return;
        setMyUsername(prof?.username || data?.user?.user_metadata?.username || null);
        setMyProfile(prof || null);
      } catch (e) {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  // fetch data when modal opens
  useEffect(() => {
    if (!visible || !postId) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);

        let buyerProfile = myProfile;
        const { data: authData } = await supabase.auth.getUser();
        const buyerUid = authData?.user?.id;
        if (buyerUid) {
          const { data: freshProf } = await supabase
            .from(PROFILES_TABLE)
            .select("username, name, age, email")
            .eq("id", buyerUid)
            .maybeSingle();
          if (freshProf) {
            buyerProfile = freshProf;
            setMyUsername(freshProf.username || null);
            setMyProfile(freshProf);
          }
        }

        let data, fetchError;
        ({ data, error: fetchError } = await supabase
          .from(POSTS_TABLE)
          .select("type, product_types, product_prices, product_booleans, required_info, product_notes, product_required_info, product_options, is_age_restricted, manually_approve_attendees, ticket_approval_info, is_ticket_number_fixed, ticket_number, pending_ticket_requests, user, title, date, time, end_date, end_time, location")
          .eq("id", postId)
          .maybeSingle());

        if (fetchError) {
          if (fetchError.code === "PGRST204" || fetchError.message?.includes("column") || fetchError.message?.includes("schema")) {
            let basicErr;
            ({ data, error: basicErr } = await supabase
              .from(POSTS_TABLE)
              .select("type, product_types, product_prices, product_booleans, required_info")
              .eq("id", postId)
              .maybeSingle());
            if (basicErr) throw basicErr;
          } else {
            throw fetchError;
          }
        }

        if (cancelled || !data) return;

        const rawTypes = data.product_types || [];
        const rawPrices = data.product_prices || [];
        const rawBools = data.product_booleans || [];
        const rawNotes = Array.isArray(data.product_notes) ? data.product_notes : [];
        const rawReqInfo = Array.isArray(data.product_required_info) ? data.product_required_info : [];
        const rawOptions = Array.isArray(data.product_options) ? data.product_options : [];

        const validIndices = rawTypes.map((t, i) => ({ t, i })).filter(({ t }) => String(t || "").trim());
        const pTypes  = validIndices.map(({ t }) => t);
        const pPrices = validIndices.map(({ i }) => rawPrices[i] ?? 0);
        const pNotes  = validIndices.map(({ i }) => rawNotes[i] ?? "");
        const pReqInfo = validIndices.map(({ i }) => rawReqInfo[i] ?? []);
        const pOptions = validIndices.map(({ i }) => rawOptions[i] ?? []);

        const pBools = rawBools;
        const reqInfo = data.required_info || [];

        setTypes(pTypes);
        setPrices(pPrices);
        setBools(pBools);
        setRequiredInfo(reqInfo);
        setProductNotes(pNotes);
        setProductRequiredInfo(pReqInfo);
        setProductOptions(pOptions);
        setIsAgeRestricted(!!data.is_age_restricted);
        setPostType(data.type || null);

        const manApprove = !!data.manually_approve_attendees;
        setManuallyApprove(manApprove);
        setApprovalInfoPlaceholder(data.ticket_approval_info || "");
        setApprovalInfo("");
        setApprovalPhoto(null);
        setFreeConfirmationVisible(false);
        setOrganizerUser(data.user || null);
        setPostCalendarData({
          title: data.title || "",
          date: data.date || "",
          time: String(data.time || "").slice(0, 5),
          end_date: data.end_date || "",
          end_time: String(data.end_time || "").slice(0, 5),
          location: data.location || "",
        });

        if (manApprove && buyerProfile?.username) {
          const uname = String(buyerProfile.username).toLowerCase();
          const pendingList = Array.isArray(data.pending_ticket_requests) ? data.pending_ticket_requests : [];
          const isAlreadyPending = pendingList.some(
            (r) => String(r?.username || "").toLowerCase() === uname
          );
          setHasPendingRequest(isAlreadyPending);
        } else {
          setHasPendingRequest(false);
        }

        if (data.is_ticket_number_fixed && data.ticket_number > 0) {
          const { ev: evData } = await fetchEventForPost(postId);
          const holdersCount = Array.isArray(evData?.ticket_holders) ? evData.ticket_holders.length : 0;
          setIsSoldOut(holdersCount >= data.ticket_number);
        } else {
          setIsSoldOut(false);
        }

        const baseToggleState = (pBools || []).reduce((acc, label) => {
          acc[label] = false;
          return acc;
        }, {});

        const makePrefilledDetails = (typeIndex) => {
          const details = {};
          const rInfo = [...(rawReqInfo[typeIndex] ?? []), ...(reqInfo ?? [])];
          const seen = new Set();
          const extraFields = rInfo.filter((f) => {
            const k = normKey(f);
            if (BASIC_KEYS.has(k) || seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          extraFields.forEach((f) => {
            const v = profileValueForField(f, buyerProfile);
            if (v) details[`ME__${f}`] = v;
          });
          return details;
        };

        setItems(
          pTypes.map((_, idx) => ({
            checked: false,
            quantity: "",
            toggles: { ...baseToggleState },
            forMeOnly: true,
            forMeUnit1: false,
            details: makePrefilledDetails(idx),
            selectedOptions: [],
          }))
        );
      } catch (e) {
        WARN("fetch error:", e?.message || e, e);
        setTypes([]);
        setPrices([]);
        setBools([]);
        setRequiredInfo([]);
        setProductNotes([]);
        setProductRequiredInfo([]);
        setProductOptions([]);
        setIsAgeRestricted(false);
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [visible, postId]);

  const toggleProduct = (index) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, checked: !it.checked } : it)));
  };

  const changeQty = (index, value) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, quantity: value } : it)));
  };

  const toggleBoolean = (index, key) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, toggles: { ...it.toggles, [key]: !it.toggles[key] } } : it
      )
    );
  };

  const toggleOption = (itemIndex, optionIndex) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== itemIndex) return it;
        const cur = it.selectedOptions || [];
        const next = cur.includes(optionIndex)
          ? cur.filter((x) => x !== optionIndex)
          : [...cur, optionIndex];
        return { ...it, selectedOptions: next };
      })
    );
  };

  const toggleForMeOnly = (index) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? {
              ...it,
              forMeOnly: !it.forMeOnly,
              ...(it.forMeOnly ? {} : { quantity: it.quantity, details: it.details }),
            }
          : it
      )
    );
  };

  const toggleForMeUnit1 = (index) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, forMeUnit1: !it.forMeUnit1 } : it)));
  };

  const changeDetail = (index, unitIndex, field, value) => {
    const key = `${unitIndex}__${field}`;
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, details: { ...(it.details || {}), [key]: value } } : it
      )
    );
  };

  const changeAlbaUsername = (index, unitIndex, value) => {
    const cleaned = cleanUsername(value);
    changeDetail(index, unitIndex, "__alba_username", cleaned);
  };

  const changeMeExtra = (index, field, value) => {
    const key = `ME__${field}`;
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, details: { ...(it.details || {}), [key]: value } } : it
      )
    );
  };

  const uploadApprovalPhoto = async (localUri) => {
    const ext = (localUri.split(".").pop()?.split("?")[0] || "jpg").toLowerCase();
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";
    const key = `ticket-approvals/${postId}/${myUsername}_${Date.now()}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: "base64" });
    const binary = decode(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    const { error } = await supabase.storage
      .from("alba-media")
      .upload(key, buffer, { upsert: false, contentType: mimeType });
    if (error) throw error;
    const { data: pub } = supabase.storage.from("alba-media").getPublicUrl(key);
    return pub.publicUrl;
  };

  const handleTakePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) setApprovalPhoto(asset.uri);
  };

  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) setApprovalPhoto(asset.uri);
  };

  const handleCancel = () => { setApprovalPhoto(null); onClose?.(); };

  const formatPrice = (p) => {
    if (p == null) return "";
    const num = Number(p);
    if (Number.isNaN(num)) return String(p);
    return `€${num.toFixed(2)}`;
  };

  const kindWord = (() => {
    const t = String(postType || "").toLowerCase();
    if (t === "ad") return "product";
    if (t === "event") return "ticket";
    return "ticket";
  })();
  const capitalKind = kindWord.charAt(0).toUpperCase() + kindWord.slice(1);

  // Compute total for currently selected items — used to decide button type
  const selectedTotalCents = useMemo(() => {
    return items.reduce((sum, state, idx) => {
      if (!state.checked) return sum;
      const priceEuros = Number(prices[idx]) || 0;
      const qty = state.forMeOnly ? 1 : parseInt(state.quantity, 10) || 0;
      const opts = productOptions[idx] || [];
      const optExtra = (state.selectedOptions || []).reduce((s, optIdx) => {
        return s + (Number(opts[optIdx]?.extraCost) || 0);
      }, 0);
      return sum + (Math.round(priceEuros * 100) + Math.round(optExtra * 100)) * qty;
    }, 0);
  }, [items, prices, productOptions]);

  const buildTicketUnits = () => {
    const units = [];

    items.forEach((state, productIndex) => {
      if (!state?.checked) return;

      if (state.forMeOnly) {
        units.push({
          productIndex,
          productLabel: types?.[productIndex] || `Item ${productIndex + 1}`,
          unitKey: "ME_ONLY",
          isMe: true,
          usernameHint: myUsername || null,
          manual: {},
          toggles: state.toggles || {},
        });
        return;
      }

      const qtyNum = parseInt(state.quantity, 10) || 0;
      if (qtyNum <= 0) return;

      if (qtyNum > 1 && state.forMeUnit1) {
        units.push({
          productIndex,
          productLabel: types?.[productIndex] || `Item ${productIndex + 1}`,
          unitKey: `ME_UNIT1`,
          isMe: true,
          usernameHint: myUsername || null,
          manual: {},
          toggles: state.toggles || {},
        });
      }

      Array.from({ length: qtyNum }, (_, k) => k + 1).forEach((unitIdx) => {
        const isHiddenMe = unitIdx === 1 && qtyNum > 1 && state.forMeUnit1;
        if (isHiddenMe) return;

        const details = state.details || {};
        const rInfo = getRequiredInfoForIndex(productIndex);

        const usernameVal = details[`${unitIdx}____alba_username`] || "";
        const manual = {};
        rInfo.forEach((field) => {
          manual[field] = details[`${unitIdx}__${field}`] || "";
        });

        units.push({
          productIndex,
          productLabel: types?.[productIndex] || `Item ${productIndex + 1}`,
          unitKey: `UNIT_${unitIdx}`,
          isMe: false,
          usernameHint: cleanUsername(usernameVal) || null,
          manual,
          toggles: state.toggles || {},
        });
      });
    });

    return units;
  };

  const loadProfilesByUsernames = async (usernames) => {
    const list = Array.isArray(usernames) ? usernames.map(cleanUsername).filter(Boolean) : [];
    if (!list.length) return [];

    const { data, error } = await supabase
      .from(PROFILES_TABLE)
      .select("id, username, name, age, gender, city, email")
      .in("username", list);

    if (error) {
      WARN("profiles fetch error", error);
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    const byU = {};
    rows.forEach((r) => (byU[String(r.username || "").toLowerCase()] = r));
    return list.map((u) => byU[u.toLowerCase()] || null);
  };

  const coerceAge = (v) => {
    const n = parseInt(String(v || "").trim(), 10);
    return Number.isFinite(n) ? n : null;
  };

  const getRequiredInfoForIndex = (idx) => {
    const perType = Array.isArray(productRequiredInfo) ? productRequiredInfo[idx] : null;
    if (Array.isArray(perType) && perType.length > 0) return perType;
    return Array.isArray(requiredInfo) ? requiredInfo : [];
  };

  const resolvePersonInfo = (unit, profileByUsername) => {
    const rInfo = getRequiredInfoForIndex(unit.productIndex);
    const profile = unit.usernameHint ? profileByUsername[unit.usernameHint.toLowerCase()] : null;

    const fromProfile = {
      username: profile?.username ? cleanUsername(profile.username) : unit.usernameHint || null,
      name: profile?.name || null,
      age: profile?.age ?? null,
      gender: profile?.gender || null,
    };

    const manual = unit.manual || {};
    const nameField = rInfo.find(fieldIsName);
    const ageField = rInfo.find(fieldIsAge);
    const genderField = rInfo.find(fieldIsGender);

    const manualName = nameField ? manual[nameField] : null;
    const manualAge = ageField ? manual[ageField] : null;
    const manualGender = genderField ? manual[genderField] : null;

    const unitExtraFields = rInfo.filter((f) => !BASIC_KEYS.has(normKey(f)));
    let extra = {};
    if (unit.isMe) {
      const state = items[unit.productIndex] || {};
      const det = state.details || {};
      unitExtraFields.forEach((f) => {
        const k = normKey(f);
        let val = "";
        if (profile) {
          if (k === "city") val = profile.city || "";
          else if (k === "email") val = profile.email || "";
          else if (k === "username") val = profile.username || "";
        }
        if (!val) val = det[`ME__${f}`] || "";
        if (String(val).trim()) extra[f] = val;
      });
    } else {
      unitExtraFields.forEach((f) => {
        const k = normKey(f);
        let val = "";
        if (profile) {
          if (k === "city") val = profile.city || "";
          else if (k === "email") val = profile.email || "";
          else if (k === "username") val = profile.username || "";
        }
        if (!val) val = manual?.[f] || "";
        if (String(val).trim()) extra[f] = val;
      });
    }

    const name =
      (unit.usernameHint ? fromProfile.name : null) ||
      (unit.isMe ? fromProfile.name : null) ||
      (manualName ? String(manualName).trim() : null) ||
      null;

    const age =
      (unit.usernameHint ? fromProfile.age : null) ||
      (unit.isMe ? fromProfile.age : null) ||
      (manualAge ? coerceAge(manualAge) : null);

    const gender =
      (unit.usernameHint ? fromProfile.gender : null) ||
      (unit.isMe ? fromProfile.gender : null) ||
      (manualGender ? String(manualGender).trim() : null);

    return {
      username: unit.usernameHint ? cleanUsername(unit.usernameHint) : null,
      name,
      age,
      gender,
      extra,
    };
  };

  const validateBeforePay = (units) => {
    if (!postId) return "Missing postId.";
    if (!units.length) return "Select at least one option.";
    if (isGuest) return null; // guests skip required_info validation

    for (const u of units) {
      const rInfo = getRequiredInfoForIndex(u.productIndex);
      if (!rInfo.length) continue;

      if (u.isMe) {
        // Basic fields come from the user's profile automatically
        for (const f of rInfo) {
          const k = normKey(f);
          if (k === "name" || k === "nome") {
            if (!String(myProfile?.name || "").trim())
              return "Please set your name in your profile to buy this ticket.";
          } else if (k === "age" || k === "età" || k === "eta") {
            if (myProfile?.age == null)
              return "Please set your age in your profile to buy this ticket.";
          } else if (k === "gender" || k === "sex") {
            if (!String(myProfile?.gender || "").trim())
              return "Please set your gender in your profile to buy this ticket.";
          } else {
            // Extra field: profile value takes precedence, then manually entered
            const fromProf = String(profileValueForField(f, myProfile) || "").trim();
            if (!fromProf) {
              const state = items[u.productIndex] || {};
              const det = state.details || {};
              const fromDet = String(det[`ME__${f}`] || "").trim();
              if (!fromDet) return `Please fill in: ${f}.`;
            }
          }
        }
      } else if (!u.usernameHint) {
        // Manual entry for someone else — ALL required fields must be filled
        for (const f of rInfo) {
          const v = String(u.manual?.[f] || "").trim();
          if (!v)
            return `Please fill in "${f}" for each attendee (or add their Alba @username).`;
        }
      }
      // If an Alba username was provided, their profile will supply the info — skip validation
    }

    return null;
  };

  const fetchEventForPost = async (postIdValue) => {
    const q1 = await supabase
      .from(EVENTS_TABLE)
      .select("id, post_id, ticket_holders, attendees_info")
      .eq("post_id", postIdValue)
      .maybeSingle();

    if (!q1.error && q1.data?.id) {
      return { ev: q1.data, evErr: null, attempt: 1 };
    }

    const maybeNum = parseInt(String(postIdValue), 10);
    const numericOk = Number.isFinite(maybeNum) && String(maybeNum) === String(postIdValue).trim();

    if (numericOk) {
      const q2 = await supabase
        .from(EVENTS_TABLE)
        .select("id, post_id, ticket_holders, attendees_info")
        .eq("post_id", maybeNum)
        .maybeSingle();

      if (!q2.error && q2.data?.id) {
        return { ev: q2.data, evErr: null, attempt: 2 };
      }
      if (q2.error) WARN("EVENT lookup #2 error", q2.error);
    }

    return { ev: null, evErr: q1.error || null, attempt: numericOk ? 2 : 1 };
  };

  const mapStripeError = (code) => {
    if (code === "card_declined")
      return "Payment declined. Please try a different payment method.";
    if (code === "insufficient_funds") return "Insufficient funds.";
    return "Connection error. Please check your internet and try again.";
  };

  const generateTicketId = () => {
    try {
      if (typeof Crypto.randomUUID === "function") return Crypto.randomUUID();
      const b = Crypto.getRandomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    } catch (_e) {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }
  };

  const handleAddToCalendar = async () => {
    const cal = postCalendarData;
    if (!cal?.date) {
      Alert.alert("", t("calendar_no_date") || "This event has no date set.");
      return;
    }
    try {
      const [sy, sm, sd] = cal.date.split("-").map(Number);
      const startDate = cal.time
        ? (() => { const [h, mi] = cal.time.split(":").map(Number); return new Date(sy, sm - 1, sd, h, mi); })()
        : new Date(sy, sm - 1, sd);

      let endDate;
      if (cal.end_date) {
        const [ey, em, ed] = cal.end_date.split("-").map(Number);
        endDate = cal.end_time
          ? (() => { const [h, mi] = cal.end_time.split(":").map(Number); return new Date(ey, em - 1, ed, h, mi); })()
          : new Date(ey, em - 1, ed);
      } else {
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      }

      if (Platform.OS === "android") {
        // Opens the default calendar app (Google Calendar etc.) with the event pre-filled.
        const title = encodeURIComponent(cal.title || "Event");
        const location = encodeURIComponent(cal.location || "");
        const allDayExtra = !cal.time ? ";l.allDay=1" : "";
        await Linking.openURL(
          `intent:#Intent;action=android.intent.action.INSERT;` +
          `type=vnd.android.cursor.dir%2Fevent;` +
          `S.title=${title};` +
          `S.eventLocation=${location};` +
          `l.beginTime=${startDate.getTime()};` +
          `l.endTime=${endDate.getTime()}` +
          `${allDayExtra};end`
        );
      } else {
        // iOS: write the event directly into the native calendar store (which may sync to
        // Google Calendar if the user has a Google account set up in iOS Settings > Calendar).
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            t("calendar_permission_title") || "Calendar Access",
            t("calendar_permission_body") || "To add events, allow calendar access in Settings."
          );
          return;
        }
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const writable = calendars.filter((c) => c.allowsModifications);
        const target = writable[0];
        if (!target) {
          Alert.alert("Error", "No writable calendar found on this device.");
          return;
        }
        await Calendar.createEventAsync(target.id, {
          title: cal.title || "Event",
          startDate,
          endDate,
          allDay: !cal.time,
          location: cal.location || undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        });
        Alert.alert(
          t("calendar_added_title") || "Added to Calendar",
          t("calendar_added_body") || "The event has been added to your calendar."
        );
      }
    } catch (e) {
      Alert.alert("Error", "Could not add to calendar.");
    }
  };

  const handlePay = async () => {
    if (loading) return;

    if (isSoldOut) {
      showFeedback("Sold out", "There are no more tickets available for this event.");
      return;
    }

    const units = buildTicketUnits();
    const err = validateBeforePay(units);
    if (err) {
      showFeedback("Missing info", err);
      return;
    }

    if (manuallyApprove && postType !== "Ad" && !approvalInfo.trim() && !approvalPhoto) {
      const prompt = approvalInfoPlaceholder || "approval info";
      showFeedback("Missing info", `Please provide at least a message or photo: ${prompt}`);
      return;
    }

    // Only block if this purchase includes a ticket for the buyer themselves
    const buyingForSelf = units.some((u) => u.isMe);
    if (hasPendingRequest && buyingForSelf) {
      showFeedback(
        t("ticket_request_already_pending_title") || "Already submitted",
        t("ticket_request_already_pending") || "Your request is already pending. The event organizer will get back to you."
      );
      return;
    }

    let ticketSuccess = false;
    try {
      setLoading(true);

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      if (authErr) WARN("auth.getUser error", authErr);
      if (!uid) {
        showFeedback("Error", "Login required.");
        return;
      }

      const totalCents = items.reduce((sum, state, idx) => {
        if (!state.checked) return sum;
        const priceEuros = Number(prices[idx]) || 0;
        const qty = state.forMeOnly ? 1 : parseInt(state.quantity, 10) || 0;
        const opts = productOptions[idx] || [];
        const optExtra = (state.selectedOptions || []).reduce((s, optIdx) => {
          return s + (Number(opts[optIdx]?.extraCost) || 0);
        }, 0);
        return sum + (Math.round(priceEuros * 100) + Math.round(optExtra * 100)) * qty;
      }, 0);

      // ── PRE-PAYMENT: fetch event + duplicate check ────────────────────────
      let ev = null;
      if (postType !== "Ad") {
        const { ev: fetchedEv, evErr, attempt } = await fetchEventForPost(postId);
        if (evErr || !fetchedEv?.id) {
          WARN("Could not find event", { attempt, postId, evErr });
          showFeedback("Error", "Could not find the event for this post.");
          return;
        }
        ev = fetchedEv;

        const parseInfo = (raw) => {
          if (Array.isArray(raw)) return raw;
          if (typeof raw === "string" && raw.trim()) {
            try { return JSON.parse(raw); } catch { return []; }
          }
          return [];
        };
        const attendeesInfo = parseInfo(ev.attendees_info);
        const registeredUsernames = new Set(
          attendeesInfo.map((a) => String(a.username || "").toLowerCase()).filter(Boolean)
        );
        const existingHolders = new Set(
          (ev.ticket_holders || []).map((x) => String(x).toLowerCase())
        );
        const purchaseUsernames = new Set();
        for (const u of units) {
          const holderId = u.isMe ? cleanUsername(myUsername || "") : cleanUsername(u.usernameHint || "");
          if (!holderId) continue;
          const lc = holderId.toLowerCase();
          if (purchaseUsernames.has(lc)) {
            showFeedback("Duplicate", u.isMe
              ? "Cannot buy multiple tickets for yourself in one purchase."
              : `Cannot buy multiple tickets for @${holderId} in one purchase.`);
            return;
          }
          purchaseUsernames.add(lc);
        }
        for (const u of units) {
          const holderId = u.isMe ? cleanUsername(myUsername || "") : cleanUsername(u.usernameHint || "");
          if (!holderId) continue;
          const lc = holderId.toLowerCase();
          if (registeredUsernames.has(lc) || existingHolders.has(lc)) {
            showFeedback("Already registered", u.isMe
              ? "You already have a ticket for this event."
              : `@${holderId} already has a ticket for this event.`);
            return;
          }
        }
        if (!myUsername && units.some((u) => u.isMe)) {
          const { data: myExisting } = await supabase
            .from("tickets").select("id").eq("event_id", ev.id).eq("owner_id", uid).limit(1);
          if (myExisting?.length) {
            showFeedback("Already registered", "You already have a ticket for this event.");
            return;
          }
        }
        const nameCheckField = (requiredInfo || []).find(fieldIsName) || getRequiredInfoForIndex(0).find(fieldIsName);
        if (nameCheckField) {
          const purchaseManualNames = new Set();
          for (const u of units) {
            if (u.isMe || u.usernameHint) continue;
            const mn = String(u.manual?.[nameCheckField] || "").trim().toLowerCase();
            if (!mn) continue;
            if (purchaseManualNames.has(mn)) {
              showFeedback("Duplicate", "Cannot buy multiple tickets for the same person in one purchase.");
              return;
            }
            purchaseManualNames.add(mn);
          }
          const buyer = String(myUsername || "").toLowerCase();
          for (const u of units) {
            if (u.isMe || u.usernameHint) continue;
            const mn = String(u.manual?.[nameCheckField] || "").trim();
            if (!mn) continue;
            const isDupe = attendeesInfo.some(
              (a) => String(a.purchased_by || "").toLowerCase() === buyer &&
                     String(a.name || "").toLowerCase() === mn.toLowerCase()
            );
            if (isDupe) {
              showFeedback("Already registered", `Someone named "${mn}" already has a ticket for this event.`);
              return;
            }
          }
        }
      }

      // ── Build ticket data (needed for both approval storage and direct issuance) ──
      let ticketsToInsert = [];
      let attendeesEntries = [];
      let additions = [];

      if (postType !== "Ad" && ev) {
        const neededUsernamesSet = new Set();
        units.forEach((u) => {
          if (u.isMe && myUsername) neededUsernamesSet.add(cleanUsername(myUsername));
          if (!u.isMe && u.usernameHint) neededUsernamesSet.add(cleanUsername(u.usernameHint));
        });

        const neededUsernames = Array.from(neededUsernamesSet);
        const profRows = await loadProfilesByUsernames(neededUsernames);
        const profileByUsername = {};
        neededUsernames.forEach((u, i) => {
          const row = profRows[i];
          if (row?.username) profileByUsername[u.toLowerCase()] = row;
        });

        if (isAgeRestricted) {
          for (const u of units) {
            const info = resolvePersonInfo(u, profileByUsername);
            if (info.age != null && Number(info.age) < 18) {
              const who = info.name || info.username || (u.isMe ? "You" : "One of the attendees");
              showFeedback("Age restriction", `${who} must be 18 or older to attend this event.`);
              return;
            }
            const rInfo = getRequiredInfoForIndex(u.productIndex);
            if (rInfo.find(fieldIsAge) && info.age == null) {
              showFeedback("Age required", "Please provide the age for each attendee.");
              return;
            }
          }
        }

        for (const u of units) {
          const info = resolvePersonInfo(u, profileByUsername);
          const holderId = info.username || info.name || null;
          if (holderId) additions.push(holderId);

          const ticketId = generateTicketId();

          attendeesEntries.push({
            post_id: postId,
            event_id: ev.id,
            product_type: u.productLabel,
            purchased_by: myUsername || null,
            username: info.username || null,
            name: info.name || null,
            age: info.age ?? null,
            gender: info.gender || null,
            extra: info.extra || {},
            toggles: u.toggles || {},
            created_at: new Date().toISOString(),
          });

          ticketsToInsert.push({
            id: ticketId,
            event_id: ev.id,
            post_id: postId,
            owner_id: uid,
            holder_display: String(holderId || ""),
            product_type: u.productLabel || null,
            qr_payload: String(ticketId),
          });
        }

        // Deduplicate additions
        const seenAdds = new Set();
        additions = additions.filter((a) => {
          const k = String(a).toLowerCase();
          if (seenAdds.has(k)) return false;
          seenAdds.add(k);
          return true;
        });
      }

      // === MANUAL APPROVAL PATH ===
      if (manuallyApprove && postType !== "Ad") {
        let paymentIntentId = null;

        if (totalCents > 0) {
          // Authorize payment with capture_method: manual (money held, not captured yet)
          let clientSecret;
          try {
            const { data: fnData, error: fnError } = await supabase.functions.invoke(
              "create-payment-intent",
              { body: { amount: totalCents, currency: "eur", eventId: String(postId), userId: uid, captureMethod: "manual" } }
            );
            if (fnError || !fnData?.clientSecret)
              throw new Error(fnData?.error || fnError?.message || "Payment setup failed");
            clientSecret = fnData.clientSecret;
          } catch (e) {
            WARN("create-payment-intent error:", e?.message);
            showFeedback("Error", "Connection error. Please check your internet and try again.");
            return;
          }

          paymentIntentId = clientSecret.split("_secret_")[0];

          if (platformPayAvailable) {
            const cartItems = items
              .map((state, idx) => {
                if (!state.checked) return null;
                const qty = state.forMeOnly ? 1 : parseInt(state.quantity, 10) || 0;
                if (qty <= 0) return null;
                const opts = productOptions[idx] || [];
                const optExtra = (state.selectedOptions || []).reduce((s, oIdx) => s + (Number(opts[oIdx]?.extraCost) || 0), 0);
                const unitPrice = (Number(prices[idx]) || 0) + optExtra;
                return {
                  label: types[idx] || "Ticket",
                  amount: String((unitPrice * qty).toFixed(2)),
                  paymentType: "Immediate",
                };
              })
              .filter(Boolean);

            const { error: payError } = await confirmPlatformPayPayment(
              clientSecret,
              {
                applePay: { cartItems, merchantCountryCode: "IT", currencyCode: "EUR" },
                googlePay: { merchantCountryCode: "IT", currencyCode: "EUR", testEnv: false },
              }
            );

            if (payError?.code === "Canceled") return;
            if (payError) {
              showFeedback("Payment failed", mapStripeError(payError.code));
              return;
            }
          } else {
            const { error: initError } = await initPaymentSheet({
              paymentIntentClientSecret: clientSecret,
              merchantDisplayName: "Alba",
            });
            if (initError) { showFeedback("Error", "Payment setup failed."); return; }
            const { error: presentError } = await presentPaymentSheet();
            if (presentError?.code === "Canceled") return;
            if (presentError) { showFeedback("Payment failed", mapStripeError(presentError.code)); return; }
          }
        }

        // Upload photo if present
        let photoUrl = null;
        if (approvalPhoto) {
          try {
            photoUrl = await uploadApprovalPhoto(approvalPhoto);
          } catch (e) {
            WARN("photo upload error:", e?.message);
          }
        }

        // Store full ticket data in the request so the edge function can issue the ticket on approval
        const { error: rpcErr } = await supabase.rpc("submit_ticket_request", {
          p_post_id: postId,
          p_username: myUsername,
          p_info: approvalInfo.trim(),
          p_photo_url: photoUrl,
          p_payment_intent_id: paymentIntentId,
          p_buyer_uid: uid,
          p_event_id: ev?.id || null,
          p_tickets_to_insert: ticketsToInsert.length > 0 ? ticketsToInsert : null,
          p_ticket_holders_to_add: additions.length > 0 ? additions : null,
          p_attendees_to_add: attendeesEntries.length > 0 ? attendeesEntries : null,
        });
        if (rpcErr) throw rpcErr;

        setApprovalPhoto(null);
        setHasPendingRequest(true);
        setFreeConfirmationVisible(true);
        return;
      }

      // === AD PURCHASE (no approval) ===
      if (postType === "Ad") {
        supabase.rpc("increment_ad_stat", { p_post_id: postId, p_field: "purchases" }).catch(() => {});
        const purchaseRows = units.map((u) => ({
          post_id: postId,
          buyer_id: uid,
          buyer_username: myUsername || null,
          product_name: u.productLabel || null,
          required_info: u.manual && Object.keys(u.manual).length > 0 ? u.manual : null,
        }));
        if (purchaseRows.length > 0) {
          supabase.from("ad_purchases").insert(purchaseRows).catch(() => {});
        }
        posthog.capture('product_purchased', {
          post_id: postId,
          product_names: units.map(u => u.productLabel).filter(Boolean),
          quantity: units.length,
        });
        showFeedback("Success", "Order confirmed.", () => { setFeedback(null); onClose?.(); }, false);
        return;
      }

      // === REGULAR TICKET PURCHASE (no approval) ===

      // Stripe payment gate
      if (totalCents > 0) {
        let clientSecret;
        try {
          const { data: fnData, error: fnError } = await supabase.functions.invoke(
            "create-payment-intent",
            { body: { amount: totalCents, currency: "eur", eventId: String(postId), userId: uid } }
          );
          if (fnError || !fnData?.clientSecret)
            throw new Error(fnData?.error || fnError?.message || "Payment setup failed");
          clientSecret = fnData.clientSecret;
        } catch (e) {
          WARN("create-payment-intent error:", e?.message);
          showFeedback("Error", "Connection error. Please check your internet and try again.");
          return;
        }

        if (platformPayAvailable) {
          const cartItems = items
            .map((state, idx) => {
              if (!state.checked) return null;
              const qty = state.forMeOnly ? 1 : parseInt(state.quantity, 10) || 0;
              if (qty <= 0) return null;
              const opts = productOptions[idx] || [];
              const optExtra = (state.selectedOptions || []).reduce((s, oIdx) => s + (Number(opts[oIdx]?.extraCost) || 0), 0);
              const unitPrice = (Number(prices[idx]) || 0) + optExtra;
              return {
                label: types[idx] || "Ticket",
                amount: String((unitPrice * qty).toFixed(2)),
                paymentType: "Immediate",
              };
            })
            .filter(Boolean);

          const { error: payError } = await confirmPlatformPayPayment(
            clientSecret,
            {
              applePay: { cartItems, merchantCountryCode: "IT", currencyCode: "EUR" },
              googlePay: { merchantCountryCode: "IT", currencyCode: "EUR", testEnv: false },
            }
          );

          if (payError?.code === "Canceled") return;
          if (payError) { showFeedback("Payment failed", mapStripeError(payError.code)); return; }
        } else {
          const { error: initError } = await initPaymentSheet({
            paymentIntentClientSecret: clientSecret,
            merchantDisplayName: "Alba",
          });
          if (initError) { showFeedback("Error", "Payment setup failed."); return; }
          const { error: presentError } = await presentPaymentSheet();
          if (presentError?.code === "Canceled") return;
          if (presentError) { showFeedback("Payment failed", mapStripeError(presentError.code)); return; }
        }
      }

      // Issue ticket
      const current = Array.isArray(ev.ticket_holders) ? ev.ticket_holders : [];
      const seen = new Set(current.map((x) => String(x).toLowerCase()));
      const nextTicketHolders = [...current];
      additions.forEach((a) => {
        const k = String(a).toLowerCase();
        if (!seen.has(k)) { seen.add(k); nextTicketHolders.push(a); }
      });

      const curInfo = Array.isArray(ev.attendees_info) ? ev.attendees_info : [];
      const nextInfo = [...curInfo, ...attendeesEntries];

      const { error: upErr } = await supabase.rpc("add_event_attendee", {
        p_event_id: ev.id,
        p_ticket_holders: nextTicketHolders,
        p_attendees_info: nextInfo,
      });
      if (upErr) throw upErr;

      if (ticketsToInsert.length) {
        const { error: tErr } = await supabase.from("tickets").insert(ticketsToInsert);
        if (tErr) throw tErr;
      }

      ticketSuccess = true;
      posthog.capture('ticket_purchased', { post_id: postId });
      showFeedback("Success", "Tickets bought successfully!", () => { setFeedback(null); onClose?.(); }, true);

      if (additions.length > 0) {
        supabase.rpc("remove_from_unconfirmed", {
          p_post_id: postId,
          p_usernames: additions,
        }).catch(() => {});
      }
    } catch (e) {
      WARN("pay error:", e?.message || e, e);
      if (!ticketSuccess) showFeedback("Error", "Could not complete purchase.");
    } finally {
      setLoading(false);
    }
  };

  const showEmpty = !loading && (!types || types.length === 0);

  const renderConfirmation = () => (
    <View style={[styles.feedbackCard, { backgroundColor: theme.gray }]}>
      <Text style={[styles.feedbackTitle, { color: theme.text }]}>
        {t("ticket_registered_title") || "You're registered!"}
      </Text>
      <Text style={[styles.feedbackMessage, { color: theme.text }]}>
        {(t("ticket_registered_body") || "Thanks for registering! Once @{organizer} approves it, your ticket will be available on My tickets.")
          .replace("{organizer}", organizerUser || "the organizer")}
      </Text>
      <View style={styles.feedbackBtnRow}>
        <TouchableOpacity
          style={[styles.feedbackCalBtn, { borderColor: "#4EBCFF" }]}
          onPress={handleAddToCalendar}
        >
          <Feather name="calendar" size={14} color="#4EBCFF" />
          <Text style={[styles.feedbackBtnText, { color: "#4EBCFF" }]} numberOfLines={1}>
            {t("add_to_calendar") || "Add to Calendar"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.feedbackOkBtn, { backgroundColor: "#4EBCFF" }]}
          onPress={() => { setFreeConfirmationVisible(false); onClose?.(); }}
        >
          <Text style={styles.feedbackOkText}>OK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible || !!feedback || freeConfirmationVisible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (feedback) { setFeedback(null); return; }
        if (freeConfirmationVisible) { setFreeConfirmationVisible(false); onClose?.(); return; }
        onClose?.();
      }}
    >
      <View style={styles.overlay}>
        {feedback ? (
          <View style={[styles.feedbackCard, { backgroundColor: theme.gray }]}>
            <Text style={[styles.feedbackTitle, { color: theme.text }]}>{feedback.title}</Text>
            <Text style={[styles.feedbackMessage, { color: theme.text }]}>{feedback.message}</Text>
            <View style={styles.feedbackBtnRow}>
              {feedback.showCalendar && (
                <TouchableOpacity
                  style={[styles.feedbackCalBtn, { borderColor: "#4EBCFF" }]}
                  onPress={handleAddToCalendar}
                >
                  <Feather name="calendar" size={14} color="#4EBCFF" />
                  <Text style={[styles.feedbackBtnText, { color: "#4EBCFF" }]} numberOfLines={1}>
                    {t("add_to_calendar") || "Add to Calendar"}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.feedbackOkBtn, { backgroundColor: feedback.title === "Success" ? "#4EBCFF" : "#E55353" }]}
                onPress={() => { const cb = feedback.onOk; setFeedback(null); cb?.(); }}
              >
                <Text style={styles.feedbackOkText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : freeConfirmationVisible ? renderConfirmation()
        : (
        <View style={[styles.card, { backgroundColor: theme.gray }]}>
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator />
              <Text style={[styles.loadingText, { color: theme.text }]}>Loading…</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              {showEmpty ? (
                <Text style={[styles.emptyText, { color: isDark ? "#9CA3AF" : "#666" }]}>
                  No options available for this post.
                </Text>
              ) : (
                types.map((label, index) => {
                  const price = prices?.[index];
                  const state = items[index] || {};
                  const qtyNum = parseInt(state.quantity, 10) || 0;
                  const note = (productNotes || [])[index] || "";
                  const typeOptions = (productOptions || [])[index] || [];
                  const typeReqInfo = getRequiredInfoForIndex(index);
                  const typeExtraFields = typeReqInfo.filter((f) => !BASIC_KEYS.has(normKey(f)));
                  const showMeExtra = typeExtraFields.length > 0 && (state.forMeOnly || state.forMeUnit1);

                  const optExtra = (state.selectedOptions || []).reduce((s, oIdx) => s + (Number(typeOptions[oIdx]?.extraCost) || 0), 0);
                  const displayPrice = (Number(price) || 0) + optExtra;

                  return (
                    <View key={`${label}-${index}`} style={styles.productBlock}>
                      <TouchableOpacity
                        style={styles.productRow}
                        activeOpacity={0.8}
                        onPress={() => toggleProduct(index)}
                      >
                        <View style={styles.checkboxOuter}>
                          {state.checked && <View style={styles.checkboxInner} />}
                        </View>
                        <Text style={[styles.productLabel, { color: theme.text }]} numberOfLines={1}>
                          {label}
                        </Text>
                        <Text style={[styles.priceText, { color: theme.text }]}>{formatPrice(displayPrice)}</Text>
                      </TouchableOpacity>
                      {!!note && (
                        <Text style={[styles.noteText, { color: isDark ? "#9CA3AF" : "#888" }]}>{note}</Text>
                      )}
                      {typeOptions.length > 0 && (
                        <View style={styles.optionsList}>
                          {typeOptions.map((opt, oIdx) => {
                            const selected = (state.selectedOptions || []).includes(oIdx);
                            return (
                              <TouchableOpacity
                                key={`opt-${index}-${oIdx}`}
                                style={styles.optionRow}
                                onPress={() => toggleOption(index, oIdx)}
                                activeOpacity={0.8}
                              >
                                <View style={styles.checkboxOuterSmall}>
                                  {selected && <View style={styles.checkboxInnerSmall} />}
                                </View>
                                <Text style={[styles.booleanLabel, { color: theme.text, flex: 1 }]}>{opt.name}</Text>
                                {opt.extraCost > 0 && (
                                  <Text style={[styles.optionPrice, { color: isDark ? "#9CA3AF" : "#888" }]}>+{formatPrice(opt.extraCost)}</Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}

                      {state.checked && (
                        <View style={styles.detailsArea}>
                          <View style={styles.booleanList}>
                            <TouchableOpacity
                              style={styles.booleanRow}
                              onPress={() => toggleForMeOnly(index)}
                              activeOpacity={0.8}
                            >
                              <View style={styles.checkboxOuterSmall}>
                                {state.forMeOnly && <View style={styles.checkboxInnerSmall} />}
                              </View>
                              <Text style={[styles.booleanLabel, { color: theme.text }]}>For me only</Text>
                            </TouchableOpacity>

                            {!state.forMeOnly &&
                              bools?.length > 0 &&
                              bools.map((bLabel, bIndex) => {
                                const on = state.toggles?.[bLabel];
                                return (
                                  <TouchableOpacity
                                    key={`${bLabel}-${bIndex}`}
                                    style={styles.booleanRow}
                                    onPress={() => toggleBoolean(index, bLabel)}
                                    activeOpacity={0.8}
                                  >
                                    <View style={styles.checkboxOuterSmall}>
                                      {on && <View style={styles.checkboxInnerSmall} />}
                                    </View>
                                    <Text style={[styles.booleanLabel, { color: theme.text }]}>{bLabel}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                          </View>

                          {showMeExtra && (
                            <View style={{ marginTop: 6, marginBottom: 6 }}>
                              <Text style={[styles.meExtraTitle, { color: isDark ? "#9CA3AF" : "#666" }]}>
                                For me (extra info)
                              </Text>
                              {typeExtraFields.map((f) => {
                                const val = state.details?.[`ME__${f}`] || "";
                                return (
                                  <View key={`me-extra-${f}`} style={styles.unitField}>
                                    <TextInput
                                      style={[
                                        styles.unitInput,
                                        {
                                          backgroundColor: "transparent",
                                          color: theme.text,
                                        },
                                      ]}
                                      placeholder={f}
                                      placeholderTextColor={isDark ? "#6B7280" : "#9fa5b3"}
                                      value={val}
                                      onChangeText={(v) => changeMeExtra(index, f, v)}
                                    />
                                  </View>
                                );
                              })}
                            </View>
                          )}

                          {!state.forMeOnly && (
                            <>
                              <TextInput
                                style={[
                                  styles.qtyInput,
                                  {
                                    backgroundColor: "transparent",
                                    color: theme.text,
                                  },
                                ]}
                                placeholder="How many?"
                                placeholderTextColor={isDark ? "#6B7280" : "#9fa5b3"}
                                keyboardType="number-pad"
                                value={state.quantity}
                                onChangeText={(v) => changeQty(index, v)}
                              />

                              {typeReqInfo?.length > 0 && qtyNum > 0 && (
                                <View style={styles.unitsBlock}>
                                  {qtyNum > 1 && (
                                    <TouchableOpacity
                                      style={styles.forMeRow}
                                      activeOpacity={0.8}
                                      onPress={() => toggleForMeUnit1(index)}
                                    >
                                      <View style={styles.checkboxOuterSmall}>
                                        {state.forMeUnit1 && <View style={styles.checkboxInnerSmall} />}
                                      </View>
                                      <Text style={[styles.booleanLabel, { color: theme.text }]}>For me</Text>
                                    </TouchableOpacity>
                                  )}

                                  {Array.from({ length: qtyNum }, (_, k) => k + 1).map((unitIdx) => {
                                    const hideUnit1 = unitIdx === 1 && qtyNum > 1 && state.forMeUnit1;
                                    if (hideUnit1) return null;

                                    const usernameKey = `${unitIdx}____alba_username`;
                                    const usernameVal = state.details?.[usernameKey] || "";

                                    return (
                                      <View key={`unit-${unitIdx}`} style={styles.unitGroup}>
                                        <Text style={[styles.unitTitle, { color: isDark ? "#9CA3AF" : "#666" }]}>
                                          {`${capitalKind} ${unitIdx}`}
                                        </Text>

                                        <View style={styles.unitRow}>
                                          {typeReqInfo.map((field) => {
                                            const key = `${unitIdx}__${field}`;
                                            const val = state.details?.[key] || "";

                                            return (
                                              <View key={`${field}-${unitIdx}`} style={styles.unitField}>
                                                <TextInput
                                                  style={[
                                                    styles.unitInput,
                                                    {
                                                      backgroundColor: "transparent",
                                                      color: theme.text,
                                                    },
                                                  ]}
                                                  placeholder={`${field} ${kindWord} ${unitIdx}`}
                                                  placeholderTextColor={isDark ? "#6B7280" : "#9fa5b3"}
                                                  value={val}
                                                  onChangeText={(v) => changeDetail(index, unitIdx, field, v)}
                                                />
                                              </View>
                                            );
                                          })}

                                          <View style={styles.unitField}>
                                            <TextInput
                                              style={styles.usernameInput}
                                              placeholder="or just add their Alba @username"
                                              placeholderTextColor="#ffffff"
                                              autoCapitalize="none"
                                              autoCorrect={false}
                                              value={usernameVal}
                                              onChangeText={(v) => changeAlbaUsername(index, unitIdx, v)}
                                            />
                                          </View>
                                        </View>
                                      </View>
                                    );
                                  })}
                                </View>
                              )}
                            </>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}

              {/* Approval info section — shown inline when organizer requires manual approval */}
              {manuallyApprove && postType !== "Ad" && (
                <View style={styles.approvalSection}>
                  {!!approvalInfoPlaceholder && (
                    <Text style={[styles.approvalSectionHint, { color: isDark ? "#8C96A5" : "#888" }]}>
                      {approvalInfoPlaceholder}
                    </Text>
                  )}
                  <View style={[styles.approvalInputWrap, { borderColor: isDark ? "#444" : "#E0E0E0", backgroundColor: isDark ? "#1E1E1E" : "#FAFAFA" }]}>
                    <TextInput
                      value={approvalInfo}
                      onChangeText={setApprovalInfo}
                      style={[styles.approvalInput, { color: theme.text }]}
                      multiline
                    />
                    <View style={styles.approvalPhotoButtons}>
                      <TouchableOpacity
                        onPress={handleTakePhoto}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={t("ticket_request_take_photo") || "Take a photo"}
                      >
                        <Feather name="camera" size={20} color={isDark ? "#8C96A5" : "#AEAEAE"} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handlePickPhoto}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={t("ticket_request_pick_photo") || "Upload from gallery"}
                      >
                        <Feather name="image" size={20} color={isDark ? "#8C96A5" : "#AEAEAE"} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {approvalPhoto && (
                    <View style={styles.approvalPhotoPreviewRow}>
                      <View>
                        <Image source={{ uri: approvalPhoto }} style={styles.approvalPhotoPreview} />
                        <TouchableOpacity
                          style={styles.approvalPhotoRemoveBtn}
                          onPress={() => setApprovalPhoto(null)}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          accessibilityLabel={t("ticket_request_remove_photo") || "Remove photo"}
                        >
                          <Feather name="x" size={10} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      <Text style={[styles.approvalPhotoLabel, { color: isDark ? "#9CA3AF" : "#888" }]}>
                        {t("ticket_request_photo_attached") || "Photo attached"}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          )}

          <View style={styles.bottomRow}>
            {selectedTotalCents === 0 ? (
              <TouchableOpacity
                style={[styles.actionBtn, styles.payBtn, { opacity: loading ? 0.6 : 1 }]}
                onPress={handlePay}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[styles.actionText, { color: "#fff" }]}>{t("get_ticket_button") || "Get ticket"}</Text>
                }
              </TouchableOpacity>
            ) : platformPayAvailable && Platform.OS !== "android" ? (
              <PlatformPayButton
                onPress={handlePay}
                type="buy"
                borderRadius={10}
                style={styles.platformPayBtn}
              />
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, styles.payBtn]}
                onPress={handlePay}
                disabled={loading}
              >
                <Text style={[styles.actionText, { color: "#fff" }]}>Pay</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={handleCancel}
              disabled={loading}
            >
              <Text style={[styles.actionText, { color: isDark ? "#9CA3AF" : "#8A96A3" }]}>
                {t("buy_modal_cancel")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        )}
      </View>
    </Modal>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "88%",
    maxHeight: "80%",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  content: { paddingBottom: 10 },
  loadingBox: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  loadingText: { marginTop: 8, fontFamily: "Poppins", fontSize: 14 },

  productBlock: { marginBottom: 14 },
  productRow: { flexDirection: "row", alignItems: "center" },
  checkboxOuter: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#3D8BFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  checkboxInner: { width: 10, height: 10, borderRadius: 2, backgroundColor: "#3D8BFF" },
  productLabel: { flex: 1, fontFamily: "Poppins", fontSize: 14 },
  priceText: { fontFamily: "PoppinsBold", fontSize: 14, marginLeft: 8 },

  detailsArea: { marginTop: 8, marginLeft: 26 },
  booleanList: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  booleanRow: { flexDirection: "row", alignItems: "center", marginRight: 16, marginBottom: 6 },
  checkboxOuterSmall: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: "#3D8BFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  checkboxInnerSmall: { width: 8, height: 8, borderRadius: 2, backgroundColor: "#3D8BFF" },
  booleanLabel: { fontFamily: "Poppins", fontSize: 13 },

  meExtraTitle: { fontFamily: "Poppins", fontSize: 12, marginBottom: 6 },

  qtyInput: {
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 0,
    fontFamily: "Poppins",
    fontSize: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
    marginBottom: 8,
  },

  unitsBlock: { marginTop: 4 },
  forMeRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  unitGroup: { marginTop: 6 },
  unitTitle: { fontFamily: "Poppins", fontSize: 12, marginBottom: 4 },
  unitRow: { flexDirection: "column" },

  unitField: { width: "100%", marginBottom: 6 },
  unitInput: {
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 0,
    fontFamily: "Poppins",
    fontSize: 12,
    includeFontPadding: false,
    textAlignVertical: "center",
  },

  usernameInput: {
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 0,
    fontFamily: "Poppins",
    fontSize: 12,
    includeFontPadding: false,
    textAlignVertical: "center",
    backgroundColor: "#78C0E9",
    color: "#fff",
  },

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
  payBtn: { backgroundColor: "#4EBCFF", borderColor: "#4EBCFF" },
  platformPayBtn: { minWidth: 110, height: 42 },
  cancelBtn: { backgroundColor: "#FFFFFF", borderColor: "#E3E8EE" },
  actionText: { fontFamily: "PoppinsBold" },
  emptyText: { fontFamily: "Poppins", fontSize: 14 },

  noteText: { fontFamily: "Poppins", fontSize: 12, marginTop: 2, marginLeft: 26, marginBottom: 4 },
  optionsList: { marginLeft: 26, marginTop: 4, marginBottom: 4 },
  optionRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  optionPrice: { fontFamily: "Poppins", fontSize: 12, marginLeft: 6 },

  feedbackCard: {
    width: "78%",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  feedbackTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 8,
  },
  feedbackMessage: {
    fontFamily: "Poppins",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  feedbackBtnRow: {
    flexDirection: "row",
    gap: 8,
    alignSelf: "stretch",
  },
  feedbackCalBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  feedbackBtnText: {
    fontFamily: "PoppinsBold",
    fontSize: 13,
    textAlign: "center",
    flexShrink: 1,
  },
  feedbackOkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  feedbackOkText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 14,
    textAlign: "center",
  },

  approvalSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(128,128,128,0.15)",
  },
  approvalSectionHint: {
    fontFamily: "Poppins",
    fontSize: 13,
    marginBottom: 8,
  },
  approvalInputWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
  },
  approvalInput: {
    fontFamily: "Poppins",
    fontSize: 14,
    textAlignVertical: "top",
    minHeight: 60,
  },
  approvalPhotoButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 14,
    paddingTop: 6,
  },
  approvalPhotoPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  approvalPhotoPreview: {
    width: 58,
    height: 58,
    borderRadius: 8,
  },
  approvalPhotoRemoveBtn: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  approvalPhotoLabel: {
    fontFamily: "Poppins",
    fontSize: 12,
    flex: 1,
  },
});
