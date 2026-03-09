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
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import * as Crypto from "expo-crypto";
import {
  PlatformPayButton,
  PlatformPay,
  usePlatformPay,
  useStripe,
} from "@stripe/stripe-react-native";
import Constants from "expo-constants";


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

const fieldIsName = (f) => normKey(f) === "name";
const fieldIsAge = (f) => normKey(f) === "age";
const fieldIsGender = (f) => {
  const k = normKey(f);
  return k === "gender" || k === "sex";
};

const looksLikeUuid = (s) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

// Read payment server URL from Expo config; falls back to localhost during development
const API_URL =
  Constants.expoConfig?.extra?.expoPublic?.API_URL ?? "http://localhost:3000";

export default function BuyModal({ visible, onClose, postId }) {
  const { theme, isDark } = useAlbaTheme();

  const [loading, setLoading] = useState(false);
  // { title, message, onOk } — replaces all Alert.alert calls
  const [feedback, setFeedback] = useState(null);
  const showFeedback = (title, message, onOk) =>
    setFeedback({ title, message, onOk: onOk || null });
  const [types, setTypes] = useState([]);
  const [prices, setPrices] = useState([]);
  const [bools, setBools] = useState([]);
  const [requiredInfo, setRequiredInfo] = useState([]);
  const [postType, setPostType] = useState(null);
  const [items, setItems] = useState([]);

  // auth context
  const [myUsername, setMyUsername] = useState(null);

  const LOG = (...args) => console.log("[BuyModal]", ...args);
  const WARN = (...args) => console.warn("[BuyModal]", ...args);

  const { isPlatformPaySupported, confirmPlatformPayPayment } = usePlatformPay();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [platformPayAvailable, setPlatformPayAvailable] = useState(false);

  // Check once on mount whether Apple Pay / Google Pay is available on this device
  useEffect(() => {
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
          .select("username")
          .eq("id", uid)
          .maybeSingle();

        if (!alive) return;
        setMyUsername(prof?.username || data?.user?.user_metadata?.username || null);
      } catch (e) {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const extraFields = useMemo(() => {
    const r = Array.isArray(requiredInfo) ? requiredInfo : [];
    return r.filter((f) => {
      const k = normKey(f);
      return !BASIC_KEYS.has(k);
    });
  }, [requiredInfo]);

  // fetch data when modal opens
  useEffect(() => {
    if (!visible || !postId) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);

        LOG("OPEN fetch post", {
          postId,
          postId_type: typeof postId,
          looksLikeUuid: looksLikeUuid(String(postId)),
        });

        const { data, error } = await supabase
          .from(POSTS_TABLE)
          .select("type, product_types, product_prices, product_booleans, required_info")
          .eq("id", postId)
          .maybeSingle();

        if (error) throw error;
        if (cancelled || !data) return;

        const pTypes = data.product_types || [];
        const pPrices = data.product_prices || [];
        const pBools = data.product_booleans || [];
        const reqInfo = data.required_info || [];

        setTypes(pTypes);
        setPrices(pPrices);
        setBools(pBools);
        setRequiredInfo(reqInfo);
        setPostType(data.type || null);

        const baseToggleState = (pBools || []).reduce((acc, label) => {
          acc[label] = false;
          return acc;
        }, {});

        setItems(
          (pTypes || []).map(() => ({
            checked: false,
            quantity: "",
            toggles: { ...baseToggleState },
            forMeOnly: true,
            forMeUnit1: false,
            details: {},
          }))
        );
      } catch (e) {
        WARN("fetch error:", e?.message || e, e);
        setTypes([]);
        setPrices([]);
        setBools([]);
        setRequiredInfo([]);
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

  // per-unit Alba @username (stored under __alba_username)
  const changeAlbaUsername = (index, unitIndex, value) => {
    const cleaned = cleanUsername(value);
    changeDetail(index, unitIndex, "__alba_username", cleaned);
  };

  // for-me extra fields
  const changeMeExtra = (index, field, value) => {
    const key = `ME__${field}`;
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, details: { ...(it.details || {}), [key]: value } } : it
      )
    );
  };

  const handleCancel = () => onClose?.();

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

  const buildTicketUnits = () => {
    const rInfo = Array.isArray(requiredInfo) ? requiredInfo : [];
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

        // key is `${unitIdx}__${field}` where field="__alba_username" → 4 underscores total
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

  const resolvePersonInfo = (unit, profileByUsername) => {
    const rInfo = Array.isArray(requiredInfo) ? requiredInfo : [];
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

    let extra = {};
    if (unit.isMe) {
      const state = items[unit.productIndex] || {};
      const det = state.details || {};
      extraFields.forEach((f) => {
        const k = normKey(f);
        let val = "";
        // Auto-fill from profile if available
        if (profile) {
          if (k === "city") val = profile.city || "";
          else if (k === "email") val = profile.email || "";
          else if (k === "username") val = profile.username || "";
        }
        // Fall back to manual input
        if (!val) val = det[`ME__${f}`] || "";
        if (String(val).trim()) extra[f] = val;
      });
    } else {
      extraFields.forEach((f) => {
        const k = normKey(f);
        let val = "";
        // Auto-fill from profile if available
        if (profile) {
          if (k === "city") val = profile.city || "";
          else if (k === "email") val = profile.email || "";
          else if (k === "username") val = profile.username || "";
        }
        // Fall back to manual input
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

    const nameField = (requiredInfo || []).find(fieldIsName);
    if (nameField) {
      for (const u of units) {
        if (!u.isMe && !u.usernameHint) {
          const n = (u.manual?.[nameField] || "").toString().trim();
          if (!n) return "Please fill in the name for each attendee (or add their @username).";
        }
      }
    }

    if (extraFields.length) {
      for (const u of units) {
        if (!u.isMe) continue;
        const state = items[u.productIndex] || {};
        const det = state.details || {};
        for (const f of extraFields) {
          const v = (det[`ME__${f}`] || "").toString().trim();
          if (!v) return `Please fill in: ${f} (for you).`;
        }
      }
    }
    return null;
  };

  const fetchEventForPost = async (postIdValue) => {
    // Attempt #1: eq(post_id, postId as-is)
    LOG("EVENT lookup attempt #1", { postId: postIdValue, looksLikeUuid: looksLikeUuid(String(postIdValue)) });

    const q1 = await supabase
      .from(EVENTS_TABLE)
      .select("id, post_id, ticket_holders, attendees_info")
      .eq("post_id", postIdValue)
      .maybeSingle();

    if (!q1.error && q1.data?.id) {
      LOG("EVENT lookup success #1", { eventId: q1.data.id, post_id: q1.data.post_id });
      return { ev: q1.data, evErr: null, attempt: 1 };
    }

    if (q1.error) {
      WARN("EVENT lookup #1 error", q1.error);
    } else {
      LOG("EVENT lookup #1 returned no row");
    }

    // Attempt #2: if postId is numeric-ish, try bigint
    const maybeNum = parseInt(String(postIdValue), 10);
    const numericOk = Number.isFinite(maybeNum) && String(maybeNum) === String(postIdValue).trim();

    if (numericOk) {
      LOG("EVENT lookup attempt #2 (numeric)", { postId_num: maybeNum });
      const q2 = await supabase
        .from(EVENTS_TABLE)
        .select("id, post_id, ticket_holders, attendees_info")
        .eq("post_id", maybeNum)
        .maybeSingle();

      if (!q2.error && q2.data?.id) {
        LOG("EVENT lookup success #2", { eventId: q2.data.id, post_id: q2.data.post_id });
        return { ev: q2.data, evErr: null, attempt: 2 };
      }
      if (q2.error) WARN("EVENT lookup #2 error", q2.error);
      else LOG("EVENT lookup #2 returned no row");
    }

    return { ev: null, evErr: q1.error || null, attempt: numericOk ? 2 : 1 };
  };

  const mapStripeError = (code) => {
    if (code === "card_declined")
      return "Payment declined. Please try a different payment method.";
    if (code === "insufficient_funds") return "Insufficient funds.";
    return "Connection error. Please check your internet and try again.";
  };

  const handlePay = async () => {
    if (loading) return;

    const units = buildTicketUnits();
    const err = validateBeforePay(units);
    if (err) {
      showFeedback("Missing info", err);
      return;
    }

    try {
      setLoading(true);

      // ✅ define uid here (you used it later but it didn’t exist)
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      if (authErr) WARN("auth.getUser error", authErr);
      if (!uid) {
        showFeedback("Error", "Login required.");
        return;
      }

      // Calculate total in cents using integers to avoid floating-point errors
      const totalCents = items.reduce((sum, state, idx) => {
        if (!state.checked) return sum;
        const priceEuros = Number(prices[idx]) || 0;
        const qty = state.forMeOnly ? 1 : parseInt(state.quantity, 10) || 0;
        return sum + Math.round(priceEuros * 100) * qty;
      }, 0);

      // === STRIPE PAYMENT GATE (skipped automatically for free events) ===
      if (totalCents > 0) {
        // 1. Create a PaymentIntent on the backend
        let clientSecret;
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token || "";
          const res = await fetch(`${API_URL}/create-payment-intent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
              amount: totalCents,
              currency: "eur",
              eventId: String(postId),
              userId: uid,
            }),
          });
          const json = await res.json();
          if (!res.ok || !json.clientSecret)
            throw new Error(json.error || "Payment setup failed");
          clientSecret = json.clientSecret;
        } catch (e) {
          WARN("create-payment-intent error:", e?.message);
          showFeedback(
            "Error",
            "Connection error. Please check your internet and try again."
          );
          return;
        }

        // 2. Confirm payment via Apple Pay / Google Pay — or card sheet on unsupported devices
        if (platformPayAvailable) {
          const cartItems = items
            .map((state, idx) => {
              if (!state.checked) return null;
              const qty = state.forMeOnly
                ? 1
                : parseInt(state.quantity, 10) || 0;
              if (qty <= 0) return null;
              return {
                label: types[idx] || "Ticket",
                amount: String(((Number(prices[idx]) || 0) * qty).toFixed(2)),
                paymentType: "Immediate",
              };
            })
            .filter(Boolean);

          const { error: payError } = await confirmPlatformPayPayment(
            clientSecret,
            {
              applePay: {
                cartItems,
                merchantCountryCode: "IT",
                currencyCode: "EUR",
              },
              googlePay: {
                merchantCountryCode: "IT",
                currencyCode: "EUR",
                testEnv: true,
              },
            }
          );

          if (payError?.code === "Canceled") return; // user dismissed — silent, no error
          if (payError) {
            showFeedback("Payment failed", mapStripeError(payError.code));
            return;
          }
        } else {
          // Card fallback via Stripe Payment Sheet
          const { error: initError } = await initPaymentSheet({
            paymentIntentClientSecret: clientSecret,
            merchantDisplayName: "Alba",
          });
          if (initError) {
            showFeedback("Error", "Payment setup failed.");
            return;
          }
          const { error: presentError } = await presentPaymentSheet();
          if (presentError?.code === "Canceled") return; // user dismissed — silent
          if (presentError) {
            showFeedback("Payment failed", mapStripeError(presentError.code));
            return;
          }
        }
      }
      // === END PAYMENT GATE — proceed with ticket issuance ===

      LOG("PAY start", {
        postId,
        postId_type: typeof postId,
        myUsername,
        unitsCount: units.length,
      });

      // 1) load event by post_id (with logs + fallback)
      const { ev, evErr, attempt } = await fetchEventForPost(postId);

      if (evErr || !ev?.id) {
        if (postType === "Ad") {
          // Ad purchase — no event row; track stat and confirm
          supabase.rpc("increment_ad_stat", { p_post_id: postId, p_field: "purchases" }).catch(() => {});
          showFeedback("Success", "Order confirmed.", () => { setFeedback(null); onClose?.(); });
          return;
        }
        WARN("Could not find event", { attempt, postId, evErr });
        showFeedback("Error", "Could not find the event for this post.");
        return;
      }

      // Block duplicate tickets.
      // Primary source: attendees_info (ticket_holders is often stale/empty).
      // attendees_info may be a parsed array (jsonb) or a JSON string (text column).
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
      // Fallback: ticket_holders array (kept for backwards compatibility)
      const existingHolders = new Set(
        (ev.ticket_holders || []).map((x) => String(x).toLowerCase())
      );
      // Check for duplicates within this purchase (e.g. two units for the same person)
      const purchaseUsernames = new Set();
      for (const u of units) {
        const holderId = u.isMe
          ? cleanUsername(myUsername || "")
          : cleanUsername(u.usernameHint || "");
        if (!holderId) continue;
        const lc = holderId.toLowerCase();
        if (purchaseUsernames.has(lc)) {
          const msg = u.isMe
            ? "Cannot buy multiple tickets for yourself in one purchase."
            : `Cannot buy multiple tickets for @${holderId} in one purchase.`;
          showFeedback("Duplicate", msg);
          return;
        }
        purchaseUsernames.add(lc);
      }

      // Check against already-registered attendees
      for (const u of units) {
        const holderId = u.isMe
          ? cleanUsername(myUsername || "")
          : cleanUsername(u.usernameHint || "");
        if (!holderId) continue;
        const lc = holderId.toLowerCase();
        if (registeredUsernames.has(lc) || existingHolders.has(lc)) {
          const msg = u.isMe
            ? "You already have a ticket for this event."
            : `@${holderId} already has a ticket for this event.`;
          showFeedback("Already registered", msg);
          return;
        }
      }

      // Safety: if myUsername is null, fall back to owner_id check in tickets table
      if (!myUsername && units.some((u) => u.isMe)) {
        const { data: myExisting } = await supabase
          .from("tickets")
          .select("id")
          .eq("event_id", ev.id)
          .eq("owner_id", uid)
          .limit(1);
        if (myExisting?.length) {
          showFeedback("Already registered", "You already have a ticket for this event.");
          return;
        }
      }

      // Duplicate check for manual-entry units (no @username, name typed manually)
      const nameCheckField = (requiredInfo || []).find(fieldIsName);
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
        // Check against already-registered attendees (same purchased_by + name combo)
        const buyer = String(myUsername || "").toLowerCase();
        for (const u of units) {
          if (u.isMe || u.usernameHint) continue;
          const mn = String(u.manual?.[nameCheckField] || "").trim();
          if (!mn) continue;
          const isDupe = attendeesInfo.some(
            (a) =>
              String(a.purchased_by || "").toLowerCase() === buyer &&
              String(a.name || "").toLowerCase() === mn.toLowerCase()
          );
          if (isDupe) {
            showFeedback("Already registered", `Someone named "${mn}" already has a ticket for this event.`);
            return;
          }
        }
      }

      // ✅ FIX: define ticketsToInsert
      const ticketsToInsert = [];

      // 2) determine which usernames we need to fetch from profiles
      const neededUsernamesSet = new Set();
      units.forEach((u) => {
        if (u.isMe && myUsername) neededUsernamesSet.add(cleanUsername(myUsername));
        if (!u.isMe && u.usernameHint) neededUsernamesSet.add(cleanUsername(u.usernameHint));
      });

      const neededUsernames = Array.from(neededUsernamesSet);
      LOG("neededUsernames", neededUsernames);

      const profRows = await loadProfilesByUsernames(neededUsernames);

      const profileByUsername = {};
      neededUsernames.forEach((u, i) => {
        const row = profRows[i];
        if (row?.username) profileByUsername[u.toLowerCase()] = row;
      });

      // 3) build ticket_holders additions + attendees_info entries
      const additions = [];
      const attendeesEntries = [];

      for (const u of units) {
        const info = resolvePersonInfo(u, profileByUsername);

        const holderId = info.username || info.name || null;
        if (holderId) additions.push(holderId);

        const ticketId =
          typeof Crypto.randomUUID === "function"
            ? Crypto.randomUUID()
            : await (async () => {
                const bytes = await Crypto.getRandomBytesAsync(16);
                bytes[6] = (bytes[6] & 0x0f) | 0x40; // v4
                bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
                const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
                return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
                  16,
                  20
                )}-${hex.slice(20)}`;
              })();

        const qrPayload = String(ticketId);

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
          qr_payload: qrPayload,
        });
      }

      // dedupe ticket_holders
      const current = Array.isArray(ev.ticket_holders) ? ev.ticket_holders : [];
      const seen = new Set(current.map((x) => String(x).toLowerCase()));
      const nextTicketHolders = [...current];
      additions.forEach((a) => {
        const k = String(a).toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          nextTicketHolders.push(a);
        }
      });

      const curInfo = Array.isArray(ev.attendees_info) ? ev.attendees_info : [];
      const nextInfo = [...curInfo, ...attendeesEntries];

      LOG("EVENT update payload", {
        eventId: ev.id,
        add_ticket_holders: additions,
        nextTicketHolders_len: nextTicketHolders.length,
        attendees_added: attendeesEntries.length,
        ticketsToInsert_len: ticketsToInsert.length,
      });

      // Use SECURITY DEFINER RPC — direct UPDATE on events is blocked by RLS for non-owners
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

      showFeedback("Success", "Tickets reserved.", () => { setFeedback(null); onClose?.(); });
    } catch (e) {
      WARN("pay error:", e?.message || e, e);
      showFeedback("Error", "Could not complete purchase.");
    } finally {
      setLoading(false);
    }
  };

  const showEmpty = !loading && (!types || types.length === 0);

  return (
    <Modal
      visible={visible || !!feedback}
      transparent
      animationType="fade"
      onRequestClose={() => { if (feedback) setFeedback(null); else onClose?.(); }}
    >
      <View style={styles.overlay}>
        {feedback ? (
          <View style={[styles.feedbackCard, { backgroundColor: theme.gray }]}>
            <Text style={[styles.feedbackTitle, { color: theme.text }]}>{feedback.title}</Text>
            <Text style={[styles.feedbackMessage, { color: theme.text }]}>{feedback.message}</Text>
            <TouchableOpacity
              style={[styles.feedbackOkBtn, { backgroundColor: feedback.title === "Success" ? "#4EBCFF" : "#E55353" }]}
              onPress={() => { const cb = feedback.onOk; setFeedback(null); cb?.(); }}
            >
              <Text style={styles.feedbackOkText}>OK</Text>
            </TouchableOpacity>
          </View>
        ) : (
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

                  const showMeExtra = extraFields.length > 0 && (state.forMeOnly || state.forMeUnit1);

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
                        <Text style={[styles.priceText, { color: theme.text }]}>{formatPrice(price)}</Text>
                      </TouchableOpacity>

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
                              {extraFields.map((f) => {
                                const val = state.details?.[`ME__${f}`] || "";
                                return (
                                  <View key={`me-extra-${f}`} style={styles.unitField}>
                                    <TextInput
                                      style={[
                                        styles.unitInput,
                                        {
                                          backgroundColor: isDark ? "#111827" : "#f5f6fa",
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
                                    backgroundColor: isDark ? "#111827" : "#f5f6fa",
                                    color: theme.text,
                                  },
                                ]}
                                placeholder="How many?"
                                placeholderTextColor={isDark ? "#6B7280" : "#9fa5b3"}
                                keyboardType="number-pad"
                                value={state.quantity}
                                onChangeText={(v) => changeQty(index, v)}
                              />

                              {requiredInfo?.length > 0 && qtyNum > 0 && (
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
                                          {requiredInfo.map((field) => {
                                            const key = `${unitIdx}__${field}`;
                                            const val = state.details?.[key] || "";

                                            return (
                                              <View key={`${field}-${unitIdx}`} style={styles.unitField}>
                                                <TextInput
                                                  style={[
                                                    styles.unitInput,
                                                    {
                                                      backgroundColor: isDark ? "#111827" : "#f5f6fa",
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
            </ScrollView>
          )}

          <View style={styles.bottomRow}>
            {platformPayAvailable ? (
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
                Cancel
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
  priceText: { fontFamily: "Poppins", fontSize: 14, fontWeight: "600", marginLeft: 8 },

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
    fontFamily: "Poppins",
    fontSize: 13,
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
    fontFamily: "Poppins",
    fontSize: 12,
  },

  usernameInput: {
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 10,
    fontFamily: "Poppins",
    fontSize: 12,
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
  actionText: { fontWeight: "700", fontFamily: "Poppins" },
  emptyText: { fontFamily: "Poppins", fontSize: 14 },

  feedbackCard: {
    width: "78%",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  feedbackTitle: {
    fontFamily: "Poppins",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  feedbackMessage: {
    fontFamily: "Poppins",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  feedbackOkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 36,
    borderRadius: 12,
  },
  feedbackOkText: {
    color: "#fff",
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 14,
  },
});
