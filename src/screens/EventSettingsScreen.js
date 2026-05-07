// screens/EventSettingsScreen.js
// Features:
// 1. Togglable info expand on ticket-holder, unconfirmed and pending-request rows
// 2. Google Forms integration (OAuth, form selection modal, auto-sync, disconnect)
// 3. isAdmin now respects the collaborators→organizers trigger added in the migration

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { decode } from "base-64";
import * as Google from "expo-auth-session/providers/google";
import { ResponseType } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { supabase } from "../lib/supabase";
import DMUsersModal from "../components/DMUsersModal";
import ShareMenu from "../components/ShareMenu";

/* ─── Google OAuth ──────────────────────────────────────────────────────── */
WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID =
  "1060018833152-6inqrhrvjj8e7ld7igvadjfmeikeebfi.apps.googleusercontent.com";
const GOOGLE_ANDROID_CLIENT_ID =
  "1060018833152-8viosmmkbi0a2719vu4kbjd774rsb1hq.apps.googleusercontent.com";

// Google requires the redirect URI to be the reversed client ID scheme for native apps.
// expo-auth-session auto-computes the app scheme (alba://) which Google rejects.
const GOOGLE_REDIRECT_URI =
  Platform.OS === "ios"
    ? "com.googleusercontent.apps.1060018833152-6inqrhrvjj8e7ld7igvadjfmeikeebfi:/oauth2redirect"
    : "com.googleusercontent.apps.1060018833152-8viosmmkbi0a2719vu4kbjd774rsb1hq:/oauth2redirect";
/* ─── Schema ────────────────────────────────────────────────────────────── */
const POSTS_TABLE = "posts";
const POSTS_COLS =
  "id, title, description, date, time, end_date, end_time, all_day, every_day, online, location, author_id, group_id, actions, postmediauri, manually_approve_attendees, is_ticket_number_fixed, ticket_number, ticket_approval_info, pending_ticket_requests, allow_guests";

const EVENTS_TABLE = "events";
const EVENTS_COLS =
  "id, title, post_id, unconfirmed, ticket_holders, organizers, attendees_info, scanned, purchases_active, google_integration, google_forms_respondent_ids";

const GROUPS_TABLE = "groups";
const GROUPS_COLS = "id, members, group_admin, groupname, group_desc";

const TICKETS_TABLE = "tickets";

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function safeObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}
function safeArr(x) {
  return Array.isArray(x) ? x : [];
}
function parseJsonArr(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === "string") { try { return JSON.parse(x); } catch { return []; } }
  return [];
}
const stripAt = (s) => String(s || "").trim().replace(/^@+/, "");
const uniqCI = (arr) => {
  const out = [];
  const seen = new Set();
  safeArr(arr).forEach((v) => {
    const s = String(v || "").trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
};
const isVideoUrl = (url) => {
  if (!url) return false;
  const l = String(url).toLowerCase();
  return l.includes(".mp4") || l.includes(".mov") || l.includes(".m4v");
};

async function buildUsersFromUsernames(usernames) {
  const list = safeArr(usernames)
    .map((u) => stripAt(u))
    .filter(Boolean);
  if (!list.length) return [];

  const { data: profs, error } = await supabase
    .from("profiles")
    .select("id, username, name, avatar_url")
    .in("username", list);

  if (error) {
    return list.map((u) => ({
      id: `u:${u}`,
      name: u,
      username: u,
      avatar_url: null,
      isExternal: false,
    }));
  }

  const byUsername = new Map(
    (profs || []).map((p) => [String(p.username || "").toLowerCase(), p])
  );

  return list.map((u) => {
    const p = byUsername.get(u.toLowerCase()) || null;
    const fullName = String(p?.name || "").trim();
    return {
      id: p?.id || `u:${u}`,
      name: fullName || u,
      username: p?.username || null,
      avatar_url: p?.avatar_url || null,
      isExternal: !p?.username,
    };
  });
}

/* ─── Google API helpers (outside component for clarity) ────────────────── */
async function gFetchForms(accessToken) {
  const resp = await fetch(
    "https://www.googleapis.com/drive/v3/files" +
      "?q=mimeType%3D'application%2Fvnd.google-apps.form'" +
      "&fields=files(id%2Cname)&orderBy=modifiedTime+desc&pageSize=50",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Drive API ${resp.status}: ${data?.error?.message || ""}`);
  return safeArr(data.files);
}

async function gRefreshToken(refreshToken) {
  const clientId =
    Platform.OS === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: [
      `client_id=${encodeURIComponent(clientId)}`,
      `refresh_token=${encodeURIComponent(refreshToken)}`,
      `grant_type=refresh_token`,
    ].join("&"),
  });
  const data = await resp.json();
  return data.access_token || null;
}

async function gExchangeCode(code, codeVerifier, redirectUri) {
  const clientId =
    Platform.OS === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: [
      `code=${encodeURIComponent(code)}`,
      `client_id=${encodeURIComponent(clientId)}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `grant_type=authorization_code`,
      `code_verifier=${encodeURIComponent(codeVerifier)}`,
    ].join("&"),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(data.error || "Token exchange failed");
  return data; // { access_token, refresh_token, ... }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function EventSettingsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const routeEventId = route.params?.eventId || null;
  const routePostId = route.params?.postId || route.params?.id || null;

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  /* ── auth ── */
  const [meId, setMeId] = useState(null);
  const [myUsername, setMyUsername] = useState(null);

  /* ── data model ── */
  const [model, setModel] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const eventRow = model?.event || null;
  const postRow = model?.post || null;

  /* ── event drafts ── */
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [draftEndTime, setDraftEndTime] = useState("");
  const [draftAllDay, setDraftAllDay] = useState(false);
  const [draftEveryDay, setDraftEveryDay] = useState(false);
  const [draftOnline, setDraftOnline] = useState(false);
  const [draftLocation, setDraftLocation] = useState("");
  const [draftMedia, setDraftMedia] = useState([]);

  /* ── ticket controls ── */
  const [purchasesActive, setPurchasesActive] = useState(true);
  const [allowGuests, setAllowGuests] = useState(true);
  const [ticketsPaused, setTicketsPaused] = useState(false);
  const [manuallyApprove, setManuallyApprove] = useState(false);
  const [fixedTicketCount, setFixedTicketCount] = useState(false);
  const [ticketNumber, setTicketNumber] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingRequestsProfiles, setPendingRequestsProfiles] = useState({});
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [savingTicketControls, setSavingTicketControls] = useState(false);

  /* ── save ── */
  const [saving, setSaving] = useState(false);

  /* ── lists ── */
  const [ticketUsers, setTicketUsers] = useState([]);
  const [unconfirmedUsers, setUnconfirmedUsers] = useState([]);
  const [sharedByUsers, setSharedByUsers] = useState([]);

  const [selectedTicket, setSelectedTicket] = useState(new Set());
  const [selectedUnconf, setSelectedUnconf] = useState(new Set());

  /* ── expand / collapse ── */
  // keyed by `user.id?.toString() || displayName` for ticket/unconf rows
  const [expandedUserInfo, setExpandedUserInfo] = useState(new Set());
  // keyed by pending request username
  const [expandedPendingInfo, setExpandedPendingInfo] = useState(new Set());
  const [lightboxUri, setLightboxUri] = useState(null);

  /* ── menus / modals ── */
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuCtx, setMenuCtx] = useState(null);
  const [dmVisible, setDmVisible] = useState(false);
  const [dmUsers, setDmUsers] = useState([]);
  const [dmTitle, setDmTitle] = useState("Message");
  const [removeVisible, setRemoveVisible] = useState(false);
  const [removeCtx, setRemoveCtx] = useState(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

  /* ── QR scanner ── */
  const [scanVisible, setScanVisible] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastScanValue, setLastScanValue] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);

  /* ── Excel export ── */
  const [exportingExcel, setExportingExcel] = useState(false);

  /* ── Google Forms ── */
  const [googleIntegration, setGoogleIntegration] = useState(null);
  const [formsModalVisible, setFormsModalVisible] = useState(false);
  const [availableForms, setAvailableForms] = useState([]);
  const [selectedFormIdInModal, setSelectedFormIdInModal] = useState(null);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [formsSyncing, setFormsSyncing] = useState(false);
  const tempTokensRef = useRef(null);

  /* ── Google OAuth hook (must be at top level) ── */
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    redirectUri: GOOGLE_REDIRECT_URI,
    scopes: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/forms.body.readonly",
      "https://www.googleapis.com/auth/forms.responses.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    responseType: ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: "offline", prompt: "consent" },
  });

  /* ── derived ── */
  const isAdmin = useMemo(() => {
    const orgs = Array.isArray(eventRow?.organizers) ? eventRow.organizers : [];
    if (myUsername && orgs.includes(myUsername)) return true;
    if (meId && postRow?.author_id && postRow.author_id === meId) return true;
    return false;
  }, [eventRow?.organizers, myUsername, postRow?.author_id, meId]);

  const notOnAlbaLabel = t("not_on_alba_yet") || "Not on Alba yet";

  /* ══════════════════════════════════════════════════════════════════════
     AUTH
  ══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user || !alive) return;
        setMeId(user.id);
        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();
        if (!alive) return;
        setMyUsername(prof?.username || user.user_metadata?.username || user.email || null);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     LOAD EVENT + POST
  ══════════════════════════════════════════════════════════════════════ */
  const loadEventModel = useCallback(async () => {
    try {
      console.log("[ESS] loadEventModel start, routeEventId:", routeEventId, "routePostId:", routePostId);
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      console.log("[ESS] session uid:", sess?.session?.user?.id, "sessErr:", sessErr?.message);
      let ev = null;
      if (routeEventId) {
        const { data, error } = await supabase
          .from(EVENTS_TABLE).select(EVENTS_COLS).eq("id", routeEventId).maybeSingle();
        console.log("[ESS] event by eventId:", data?.id, "err:", error?.message);
        ev = data || null;
      } else if (routePostId) {
        const { data, error } = await supabase
          .from(EVENTS_TABLE).select(EVENTS_COLS).eq("post_id", routePostId).maybeSingle();
        console.log("[ESS] event by postId:", data?.id, "err:", error?.message);
        ev = data || null;
      }
      if (!ev?.post_id && !routePostId) { console.log("[ESS] no ev.post_id and no routePostId, aborting"); setModel(null); return; }

      const postId = ev?.post_id || routePostId;
      const { data: post, error: pErr } = await supabase
        .from(POSTS_TABLE).select(POSTS_COLS).eq("id", postId).maybeSingle();
      console.log("[ESS] post:", post?.id, "pErr:", pErr?.message);
      if (pErr || !post) { setModel(null); return; }

      setModel({ event: ev, post, group: null });
      console.log("[ESS] model set OK");
    } catch (e) {
      console.warn("[ESS] loadEventModel error:", e);
    }
  }, [routeEventId, routePostId]);

  useFocusEffect(useCallback(() => { loadEventModel(); }, [loadEventModel]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadEventModel(); } finally { setRefreshing(false); }
  }, [loadEventModel]);

  /* ══════════════════════════════════════════════════════════════════════
     INIT DRAFTS
  ══════════════════════════════════════════════════════════════════════ */
  const resetDraftsToPost = useCallback(() => {
    setDraftTitle(postRow?.title || "");
    setDraftDesc(postRow?.description || "");
    setDraftDate(postRow?.date || "");
    setDraftTime((postRow?.time || "").toString().slice(0, 5) || "");
    setDraftEndDate(postRow?.end_date || "");
    setDraftEndTime((postRow?.end_time || "").toString().slice(0, 5) || "");
    setDraftAllDay(postRow?.all_day ?? false);
    setDraftEveryDay(postRow?.every_day ?? false);
    setDraftOnline(postRow?.online ?? false);
    setDraftLocation(postRow?.location || "");
    const existingMedia = Array.isArray(postRow?.postmediauri)
      ? postRow.postmediauri.map((uri) => ({
          uri,
          type: isVideoUrl(uri) ? "video" : "image",
          isNew: false,
        }))
      : [];
    setDraftMedia(existingMedia);
  }, [
    postRow?.title, postRow?.description, postRow?.date, postRow?.time,
    postRow?.end_date, postRow?.end_time, postRow?.all_day, postRow?.every_day, postRow?.online,
    postRow?.location, postRow?.postmediauri,
  ]);

  useEffect(() => { resetDraftsToPost(); }, [postRow?.id, resetDraftsToPost]);

  useEffect(() => {
    setPurchasesActive(eventRow?.purchases_active !== false);
  }, [eventRow?.id, eventRow?.purchases_active]);

  useEffect(() => {
    setAllowGuests(postRow?.allow_guests !== false);
    setManuallyApprove(!!postRow?.manually_approve_attendees);
    setFixedTicketCount(!!postRow?.is_ticket_number_fixed);
    setTicketNumber(postRow?.ticket_number != null ? String(postRow.ticket_number) : "");
    setPendingRequests(
      Array.isArray(postRow?.pending_ticket_requests)
        ? postRow.pending_ticket_requests
        : []
    );
  }, [
    postRow?.id, postRow?.manually_approve_attendees,
    postRow?.is_ticket_number_fixed, postRow?.ticket_number,
    postRow?.pending_ticket_requests,
  ]);

  useEffect(() => {
    const acts = safeArr(postRow?.actions).map((a) => String(a).toLowerCase());
    setTicketsPaused(!acts.includes("tickets"));
  }, [postRow?.id, postRow?.actions]);

  /* ── pending requests profiles ── */
  useEffect(() => {
    const usernames = pendingRequests.map((r) => String(r?.username || "")).filter(Boolean);
    if (!usernames.length) { setPendingRequestsProfiles({}); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("profiles").select("username, name, avatar_url").in("username", usernames);
      if (!alive) return;
      const map = {};
      (data || []).forEach((p) => { map[p.username] = p; });
      setPendingRequestsProfiles(map);
    })();
    return () => { alive = false; };
  }, [pendingRequests]);

  /* ── build user lists ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      const tickets = await buildUsersFromUsernames(safeArr(eventRow?.ticket_holders));
      const unconf = await buildUsersFromUsernames(safeArr(eventRow?.unconfirmed));
      if (!alive) return;
      setTicketUsers(tickets);
      setUnconfirmedUsers(unconf);
      setSelectedTicket(new Set());
      setSelectedUnconf(new Set());
    })();
    return () => { alive = false; };
  }, [eventRow?.id, eventRow?.ticket_holders, eventRow?.unconfirmed]);

  /* ── shared-by users ── */
  useEffect(() => {
    if (!postRow?.id) return;
    let alive = true;
    (async () => {
      try {
        const { data: sharePosts } = await supabase
          .from(POSTS_TABLE).select("author_id, username").eq("shared_post_id", postRow.id);
        if (!alive || !Array.isArray(sharePosts) || !sharePosts.length) {
          if (alive) setSharedByUsers([]);
          return;
        }
        const usernames = sharePosts.map((p) => p.username).filter(Boolean);
        const users = await buildUsersFromUsernames(usernames);
        if (alive) setSharedByUsers(users);
      } catch { if (alive) setSharedByUsers([]); }
    })();
    return () => { alive = false; };
  }, [postRow?.id]);

  /* ── init Google integration state + auto-sync ── */
  useEffect(() => {
    const integration = eventRow?.google_integration || null;
    setGoogleIntegration(integration);
    if (integration?.form_id && eventRow?.id && isAdmin) {
      syncGoogleFormResponses(integration, eventRow);
    }
  }, [eventRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── handle Google OAuth response ── */
  useEffect(() => {
    if (googleResponse?.type !== "success") return;

    const directToken = googleResponse.params?.access_token || null;
    const code = googleResponse.params?.code;
    const codeVerifier = googleRequest?.codeVerifier;
    const redirectUri = googleRequest?.redirectUri;

    (async () => {
      setGoogleAuthLoading(true);
      try {
        let accessToken, refreshToken;

        if (directToken) {
          // Android native OAuth clients return the access token directly in the redirect.
          // The accompanying code is a server-auth-code not usable with PKCE exchange.
          accessToken = directToken;
          refreshToken = null;
        } else if (code && codeVerifier && redirectUri) {
          const tokens = await gExchangeCode(code, codeVerifier, redirectUri);
          accessToken = tokens.access_token;
          refreshToken = tokens.refresh_token || null;
        } else {
          return;
        }

        tempTokensRef.current = { access_token: accessToken, refresh_token: refreshToken };
        const forms = await gFetchForms(accessToken);
         setAvailableForms(forms);
        setSelectedFormIdInModal(null);
        setFormsModalVisible(true);
      } catch (err) {
        Alert.alert("Error", t("google_forms_connect_error") || "Could not connect to Google.");
      } finally {
        setGoogleAuthLoading(false);
      }
    })();
  }, [googleResponse]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ══════════════════════════════════════════════════════════════════════
     GOOGLE FORMS FUNCTIONS
  ══════════════════════════════════════════════════════════════════════ */

  // Sync form responses into ticket_holders + attendees_info
  const syncGoogleFormResponses = async (integration, ev) => {
     if (!integration?.form_id || !ev?.id) return;
    setFormsSyncing(true);
    try {
      let accessToken = integration.access_token;

      const gGet = async (url) => {
        let resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (resp.status === 401 && integration.refresh_token) {
          const newToken = await gRefreshToken(integration.refresh_token);
          if (newToken) {
            accessToken = newToken;
            const updated = { ...integration, access_token: newToken };
            await supabase.from(EVENTS_TABLE).update({ google_integration: updated }).eq("id", ev.id);
            setGoogleIntegration(updated);
            setModel((prev) =>
              prev ? { ...prev, event: { ...prev.event, google_integration: updated } } : prev
            );
            resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          }
        }
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
           throw new Error(`HTTP ${resp.status}: ${errBody?.error?.message || ""}`);
        }
        return resp.json();
      };

      const formData = await gGet(`https://forms.googleapis.com/v1/forms/${integration.form_id}`);
      const fieldMap = {};
      safeArr(formData.items).forEach((item) => {
        const qId = item.questionItem?.question?.questionId;
        if (qId) fieldMap[qId] = item.title || qId;
      });

      const responsesData = await gGet(
        `https://forms.googleapis.com/v1/forms/${integration.form_id}/responses`
      );
      const responses = safeArr(responsesData.responses);

      const existingRespondentIds = new Set(safeArr(ev.google_forms_respondent_ids));
      const currentAttendeesArr = parseJsonArr(ev.attendees_info);
      const existingEmails = new Set(
        currentAttendeesArr
          .map((item) => String(item?.extra?.email || item?.respondentEmail || "").toLowerCase())
          .filter(Boolean)
      );

      const newTicketHolders = [...safeArr(ev.ticket_holders)];
      const newAttendeesArr = [...currentAttendeesArr];
      const newRespondentIds = [...existingRespondentIds];
      let changed = false;

      for (const response of responses) {
        const responseId = response.responseId;
        if (!responseId || existingRespondentIds.has(responseId)) continue;

        const answers = safeObj(response.answers);
        const extra = {};
        let displayName = null;

        for (const [questionId, answerObj] of Object.entries(answers)) {
          const label = fieldMap[questionId] || questionId;
          const value = answerObj?.textAnswers?.answers?.[0]?.value || "";
          extra[label] = value;
          const labelLc = label.toLowerCase();
          if ((labelLc.includes("email") || labelLc === "e-mail") && !extra.email) {
            extra.email = value;
          }
          if (labelLc.includes("name") && !labelLc.includes("last") && !displayName) {
            displayName = value;
          }
        }

        if (!extra.email && response.respondentEmail) extra.email = response.respondentEmail;

        const emailLc = String(extra.email || "").toLowerCase();
        if (emailLc && existingEmails.has(emailLc)) {
          newRespondentIds.push(responseId);
          continue;
        }

        let finalName = displayName || extra.email || responseId;
        let suffix = 2;
        while (newTicketHolders.includes(finalName)) {
          finalName = `${displayName || extra.email || responseId} (${suffix++})`;
        }

        newAttendeesArr.push({
          name: finalName,
          username: null,
          age: null,
          gender: null,
          extra,
          source: "google_forms",
          response_id: responseId,
          post_id: ev.post_id || null,
          event_id: ev.id,
          product_type: "Google Forms",
          purchased_by: null,
          created_at: new Date().toISOString(),
        });
        newTicketHolders.push(finalName);
        newRespondentIds.push(responseId);
        if (emailLc) existingEmails.add(emailLc);
        changed = true;
      }

      if (changed) {
        const { data: syncData, error: syncErr } = await supabase
          .from(EVENTS_TABLE)
          .update({
            ticket_holders: newTicketHolders,
            attendees_info: newAttendeesArr,
            google_forms_respondent_ids: newRespondentIds,
          })
          .eq("id", ev.id)
          .select("id, ticket_holders, google_forms_respondent_ids");
         if (syncErr) throw syncErr;

        setModel((prev) =>
          prev
            ? {
                ...prev,
                event: {
                  ...prev.event,
                  ticket_holders: newTicketHolders,
                  attendees_info: newAttendeesArr,
                  google_forms_respondent_ids: newRespondentIds,
                },
              }
            : prev
        );
      }
    } catch (err) {
     } finally {
      setFormsSyncing(false);
    }
  };

  // Connect: save integration + immediately sync
  const connectGoogleForm = async () => {
    const formId = selectedFormIdInModal;
    if (!formId || !eventRow?.id || !tempTokensRef.current) {
       return;
    }

    const formName =
      availableForms.find((f) => f.id === formId)?.name || formId;
    const integration = {
      form_id: formId,
      form_name: formName,
      access_token: tempTokensRef.current.access_token,
      refresh_token: tempTokensRef.current.refresh_token,
    };

    try {
       const { data: saveData, error: saveErr } = await supabase
        .from(EVENTS_TABLE)
        .update({ google_integration: integration })
        .eq("id", eventRow.id)
        .select("id, google_integration");
        if (saveErr) throw saveErr;

      setGoogleIntegration(integration);
      setModel((prev) =>
        prev
          ? { ...prev, event: { ...prev.event, google_integration: integration } }
          : prev
      );
      setFormsModalVisible(false);
      setSelectedFormIdInModal(null);
      tempTokensRef.current = null;

      await syncGoogleFormResponses(integration, { ...eventRow, google_integration: integration });
    } catch (err) {
      Alert.alert("Error", t("google_forms_connect_error") || "Could not save integration.");
    }
  };

  // Disconnect: remove integration and undo imported respondents
  const disconnectGoogleForm = async () => {
    if (!eventRow?.id) return;
    Alert.alert(
      t("disconnect_google_form") || "Disconnect",
      t("google_forms_disconnect_confirm") ||
        "Disconnect Google Forms? All imported respondents will be removed.",
      [
        { text: t("google_forms_cancel") || "Cancel", style: "cancel" },
        {
          text: t("disconnect_google_form") || "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              const currentAttendeesArr = parseJsonArr(eventRow.attendees_info);
              const namesToRemove = new Set(
                currentAttendeesArr
                  .filter((item) => item?.source === "google_forms")
                  .map((item) => item?.name)
                  .filter(Boolean)
              );
              const newTicketHolders = safeArr(eventRow.ticket_holders).filter(
                (h) => !namesToRemove.has(h)
              );
              const newAttendeesInfo = currentAttendeesArr.filter(
                (item) => item?.source !== "google_forms"
              );

              await supabase
                .from(EVENTS_TABLE)
                .update({
                  ticket_holders: newTicketHolders,
                  attendees_info: newAttendeesInfo,
                  google_integration: null,
                  google_forms_respondent_ids: [],
                })
                .eq("id", eventRow.id);

              setGoogleIntegration(null);
              setModel((prev) =>
                prev
                  ? {
                      ...prev,
                      event: {
                        ...prev.event,
                        ticket_holders: newTicketHolders,
                        attendees_info: newAttendeesInfo,
                        google_integration: null,
                        google_forms_respondent_ids: [],
                      },
                    }
                  : prev
              );
            } catch {
              Alert.alert("Error", "Could not disconnect Google Forms.");
            }
          },
        },
      ]
    );
  };

  /* ══════════════════════════════════════════════════════════════════════
     EXCEL EXPORT
  ══════════════════════════════════════════════════════════════════════ */
  const handleExportExcel = async () => {
    try {
      setExportingExcel(true);
      const { data: evData, error } = await supabase
        .from(EVENTS_TABLE)
        .select("attendees_info")
        .eq("id", eventRow.id)
        .maybeSingle();
      if (error) throw error;

      const attendees = parseJsonArr(evData?.attendees_info);

      const extraKeys = new Set();
      attendees.forEach((a) => {
        if (a.extra && typeof a.extra === "object" && !Array.isArray(a.extra)) {
          Object.keys(a.extra).forEach((k) => extraKeys.add(k));
        }
      });

      const rows = attendees.map((a) => {
        const row = {
          username: a.username ?? "",
          name: a.name ?? "",
          age: a.age ?? "",
          gender: a.gender ?? "",
          product_type: a.product_type ?? "",
          purchased_by: a.purchased_by ?? "",
          created_at: a.created_at ?? "",
        };
        extraKeys.forEach((k) => {
          row[k] = a.extra?.[k] ?? "";
        });
        return row;
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Attendees");

      const wbOut = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const uri = FileSystem.cacheDirectory + "attendees.xlsx";
      await FileSystem.writeAsStringAsync(uri, wbOut, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        UTI: "com.microsoft.excel.xlsx",
        dialogTitle: t("export_to_excel") || "Export to Excel",
      });
      Alert.alert("", t("attendees_downloaded") || "Attendees data saved to your device.");
    } catch (e) {
      Alert.alert("Error", "Could not export attendees.");
    } finally {
      setExportingExcel(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     SELECTION
  ══════════════════════════════════════════════════════════════════════ */
  const toggleSelect = (listKey, displayName) => {
    const key = String(displayName || "").trim();
    if (!key) return;
    if (listKey === "ticket") {
      setSelectedTicket((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
    } else {
      setSelectedUnconf((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
    }
  };

  const selectAll = (listKey) => {
    if (listKey === "ticket") {
      setSelectedTicket(new Set(ticketUsers.map((u) => u.name).filter(Boolean)));
    } else {
      setSelectedUnconf(new Set(unconfirmedUsers.map((u) => u.name).filter(Boolean)));
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     DM / MENU / REMOVE
  ══════════════════════════════════════════════════════════════════════ */
  const openDM = (users, title) => {
    const onlyAlba = (users || []).filter((u) => !!u?.username);
    setDmUsers(onlyAlba);
    setDmTitle(title || "Message");
    setDmVisible(true);
  };

  const openMenu = (listKey, user) => {
    if (!isAdmin) return;
    setMenuCtx({ listKey, user });
    setMenuVisible(true);
  };

  const confirmRemove = (users) => {
    if (!isAdmin) return;
    setRemoveCtx({ users: users || [] });
    setRemoveVisible(true);
  };

  const removeUsers = async (users) => {
    const list = Array.isArray(users) ? users : [];
    if (!list.length || !eventRow?.id) return;

    const removeNames = list.map((u) => u?.name).filter(Boolean);
    const removeSet = new Set(removeNames.map((x) => String(x).toLowerCase()));
    const albaSet = new Set(
      list.map((u) => u?.username).filter(Boolean).map((x) => String(x).toLowerCase())
    );

    try {
      const nextTickets = safeArr(eventRow.ticket_holders).filter(
        (n) => !removeSet.has(String(n).toLowerCase())
      );
      const nextUnc = safeArr(eventRow.unconfirmed).filter(
        (n) => !removeSet.has(String(n).toLowerCase())
      );

      const { error: eErr } = await supabase
        .from(EVENTS_TABLE)
        .update({ ticket_holders: nextTickets, unconfirmed: nextUnc })
        .eq("id", eventRow.id);
      if (eErr) throw eErr;

      if (postRow?.group_id && albaSet.size > 0) {
        const { data: g, error: gErr } = await supabase
          .from(GROUPS_TABLE).select("id, members").eq("id", postRow.group_id).maybeSingle();
        if (!gErr && g?.id) {
          const nextMembers = (Array.isArray(g.members) ? g.members : []).filter(
            (u) => !albaSet.has(String(u).toLowerCase())
          );
          await supabase.from(GROUPS_TABLE).update({ members: nextMembers }).eq("id", g.id);
        }
      }

      setModel((prev) =>
        prev?.event
          ? { ...prev, event: { ...prev.event, ticket_holders: nextTickets, unconfirmed: nextUnc } }
          : prev
      );
      setSelectedTicket(new Set());
      setSelectedUnconf(new Set());
    } catch {
      Alert.alert("Error", "Could not remove user(s).");
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     TICKET CONTROLS
  ══════════════════════════════════════════════════════════════════════ */
  const saveTicketControls = async (patch) => {
    if (!postRow?.id) return;
    setSavingTicketControls(true);
    try {
      const { error } = await supabase.from(POSTS_TABLE).update(patch).eq("id", postRow.id);
      if (error) throw error;
      setModel((prev) => (prev ? { ...prev, post: { ...prev.post, ...patch } } : prev));
    } catch {
      Alert.alert("Error", "Could not save setting.");
    } finally {
      setSavingTicketControls(false);
    }
  };

  /* ── pending ticket requests: approve / reject ── */
  const approveTicketRequest = async (request_id, username) => {
      if (!postRow?.id) return;
    try {
      console.log("[ESS] approveTicketRequest →", { post_id: postRow.id, request_id, username });
      const { data, error } = await supabase.functions.invoke("approve-ticket-request", {
        body: { post_id: postRow.id, request_id, username },
      });
      console.log("[ESS] approve-ticket-request response:", JSON.stringify(data), "error:", error?.message, error?.status);
      if (error) {
        // Try to read the body from FunctionsHttpError for the real server message
        let body = null;
        try { body = await error.context?.json?.(); } catch (_) {}
        console.error("[ESS] approve FunctionsHttpError body:", JSON.stringify(body));
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      await loadEventModel();
    } catch (err) {
      console.error("[ESS] approveTicketRequest caught:", err?.message, err);
      Alert.alert("Error", "Could not approve request.");
    }
  };

  const rejectTicketRequest = async (request_id, username) => {
    if (!postRow?.id) return;
    try {
      console.log("[ESS] rejectTicketRequest →", { post_id: postRow.id, request_id, username });
      const { data, error } = await supabase.functions.invoke("reject-ticket-request", {
        body: { post_id: postRow.id, request_id, username },
      });
      console.log("[ESS] reject-ticket-request response:", JSON.stringify(data), "error:", error?.message, error?.status);
      if (error) {
        let body = null;
        try { body = await error.context?.json?.(); } catch (_) {}
        console.error("[ESS] reject FunctionsHttpError body:", JSON.stringify(body));
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      // Remove only the specific request that was rejected.
      // For new requests use request_id; for legacy requests without one, remove
      // only the first match by username so sibling requests are untouched.
      let removed = false;
      const nextPending = pendingRequests.filter((r) => {
        if (request_id && r?.request_id === request_id) return false;
        if (!request_id && r?.username === username && !removed) { removed = true; return false; }
        return true;
      });
      setPendingRequests(nextPending);
      setModel((prev) =>
        prev ? { ...prev, post: { ...prev.post, pending_ticket_requests: nextPending } } : prev
      );
    } catch (err) {
      console.error("[ESS] rejectTicketRequest caught:", err?.message, err);
      Alert.alert("Error", "Could not reject request.");
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     SAVE EVENT DETAILS
  ══════════════════════════════════════════════════════════════════════ */
  const isDirty = useMemo(() => {
    const baseTitle = postRow?.title || "";
    const baseDesc = postRow?.description || "";
    const baseDate = postRow?.date || "";
    const baseTime = (postRow?.time || "").toString().slice(0, 5) || "";
    const baseEndDate = postRow?.end_date || "";
    const baseEndTime = (postRow?.end_time || "").toString().slice(0, 5) || "";
    const baseLoc = postRow?.location || "";
    const baseMediaUris = Array.isArray(postRow?.postmediauri) ? postRow.postmediauri : [];
    const draftMediaUris = draftMedia.map((m) => m.uri);
    const mediaChanged =
      draftMedia.some((m) => m.isNew) ||
      draftMediaUris.length !== baseMediaUris.length ||
      draftMediaUris.some((u, i) => u !== baseMediaUris[i]);
    return (
      (draftTitle || "") !== baseTitle ||
      (draftDesc || "") !== baseDesc ||
      (draftDate || "") !== baseDate ||
      (draftTime || "") !== baseTime ||
      (draftEndDate || "") !== baseEndDate ||
      (draftEndTime || "") !== baseEndTime ||
      (draftLocation || "") !== baseLoc ||
      draftAllDay !== (postRow?.all_day ?? false) ||
      draftEveryDay !== (postRow?.every_day ?? false) ||
      draftOnline !== (postRow?.online ?? false) ||
      mediaChanged
    );
  }, [
    postRow, draftTitle, draftDesc, draftDate, draftTime,
    draftEndDate, draftEndTime, draftLocation, draftAllDay, draftEveryDay, draftOnline, draftMedia,
  ]);

  const onSave = async () => {
    if (!postRow?.id) return;
    setSaving(true);
    try {
      const finalMedia = [];
      for (const m of draftMedia) {
        if (!m.isNew) { finalMedia.push(m.uri); }
        else { finalMedia.push(await uploadEventMedia(m.uri, postRow.id)); }
      }
      const baseMediaUris = Array.isArray(postRow?.postmediauri) ? postRow.postmediauri : [];
      const mediaChanged =
        draftMedia.some((m) => m.isNew) ||
        finalMedia.length !== baseMediaUris.length ||
        finalMedia.some((u, i) => u !== baseMediaUris[i]);

      const postPatch = {};
      if ((draftTitle || "") !== (postRow?.title || "")) postPatch.title = draftTitle;
      if ((draftDesc || "") !== (postRow?.description || "")) postPatch.description = draftDesc;
      if ((draftDate || "") !== (postRow?.date || "")) postPatch.date = draftDate;
      const baseTime = (postRow?.time || "").toString().slice(0, 5);
      if ((draftTime || "") !== baseTime || draftAllDay !== (postRow?.all_day ?? false))
        postPatch.time = draftAllDay ? null : draftTime;
      if ((draftEndDate || "") !== (postRow?.end_date || "")) postPatch.end_date = draftEndDate || null;
      const baseEndTime = (postRow?.end_time || "").toString().slice(0, 5);
      if ((draftEndTime || "") !== baseEndTime || draftAllDay !== (postRow?.all_day ?? false))
        postPatch.end_time = draftAllDay ? null : (draftEndTime || null);
      if (draftAllDay !== (postRow?.all_day ?? false)) postPatch.all_day = draftAllDay;
      if (draftEveryDay !== (postRow?.every_day ?? false)) postPatch.every_day = draftEveryDay;
      if (draftOnline !== (postRow?.online ?? false)) postPatch.online = draftOnline;
      if ((draftLocation || "") !== (postRow?.location || "")) postPatch.location = draftLocation;
      if (mediaChanged) postPatch.postmediauri = finalMedia;

      if (Object.keys(postPatch).length) {
        const { error } = await supabase.from(POSTS_TABLE).update(postPatch).eq("id", postRow.id);
        if (error) throw error;
      }
      if ((postPatch.title || postPatch.description) && postRow?.group_id) {
        const groupPatch = {};
        if (postPatch.title) groupPatch.groupname = draftTitle;
        if (postPatch.description) groupPatch.group_desc = draftDesc;
        await supabase.from(GROUPS_TABLE).update(groupPatch).eq("id", postRow.group_id);
      }
      setModel((prev) =>
        prev?.post ? { ...prev, post: { ...prev.post, ...postPatch } } : prev
      );
    } catch {
      Alert.alert("Error", "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const onCancelEdits = () => { resetDraftsToPost(); };

  /* ── media helpers ── */
  const uploadEventMedia = async (localUri, postId) => {
    const ext = localUri.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
    const isVideo = ["mp4", "mov", "m4v"].includes(ext);
    const mimeType = isVideo ? "video/mp4" : ext === "png" ? "image/png" : "image/jpeg";
    const key = `posts/${postId}/media/${Date.now()}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: "base64" });
    const binary = decode(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    const { error } = await supabase.storage
      .from("alba-media").upload(key, buffer, { upsert: false, contentType: mimeType });
    if (error) throw error;
    const { data: pub } = supabase.storage.from("alba-media").getPublicUrl(key);
    return pub.publicUrl;
  };

  const pickEventMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
      allowsMultipleSelection: false,
      allowsEditing: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setDraftMedia((prev) => [
      ...prev,
      { uri: asset.uri, type: asset.type === "video" ? "video" : "image", isNew: true },
    ]);
  };

  const removeEventMedia = (index) => {
    setDraftMedia((prev) => prev.filter((_, i) => i !== index));
  };

  /* ── invite / delete ── */
  const onInviteFromPrevious = () => {
    if (!postRow?.id) return;
    navigation.navigate("PastEvents", {
      postId: postRow.id,
      eventId: eventRow?.id || null,
      groupId: postRow?.group_id || null,
    });
  };

  const inviteGroupPayload = useMemo(
    () => (postRow?.group_id ? { id: postRow.group_id } : null),
    [postRow?.group_id]
  );

  const defaultInviteMessage = useMemo(
    () => `Join ${postRow?.title || "an event"}`,
    [postRow?.title]
  );

  const deleteEvent = async () => {
    try {
      const postIdToDelete = postRow?.id || eventRow?.post_id || routePostId;
      if (!postIdToDelete) return;
      if (eventRow?.id) {
        const { error: eErr } = await supabase.from(EVENTS_TABLE).delete().eq("id", eventRow.id);
        if (eErr) throw eErr;
      } else {
        await supabase.from(EVENTS_TABLE).delete().eq("post_id", postIdToDelete);
      }
      const { error: pErr } = await supabase.from(POSTS_TABLE).delete().eq("id", postIdToDelete);
      if (pErr) throw pErr;
      setDeleteVisible(false);
      navigation.goBack();
    } catch {
      Alert.alert("Error", "Could not delete event.");
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     QR SCANNER
  ══════════════════════════════════════════════════════════════════════ */
  const openScanner = async () => {
    if (!isAdmin || !eventRow?.id) return;
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res?.granted) {
        Alert.alert("Camera permission", "Camera permission is required to scan tickets.");
        return;
      }
    }
    scanLockRef.current = false;
    setLastScanValue(null);
    setScanVisible(true);
  };

  const closeScanner = () => {
    setScanVisible(false);
    setScanBusy(false);
    scanLockRef.current = false;
  };

  const resolveUsernameFromDisplayName = (displayName) => {
    const arr = parseJsonArr(eventRow?.attendees_info);
    const rec = arr.find((item) => item?.name === displayName || item?.username === displayName);
    const uname = rec?.username ? stripAt(rec.username) : null;
    return uname || null;
  };

  const markScanned = async ({ holderDisplay }) => {
    if (!eventRow?.id) return;
    const uname = resolveUsernameFromDisplayName(holderDisplay);
    const toStore = uname || String(holderDisplay || "").trim();
    if (!toStore) throw new Error("Missing holder.");
    const current = safeArr(eventRow?.scanned);
    const exists = current.some((x) => String(x).toLowerCase() === String(toStore).toLowerCase());
    if (exists) {
      Alert.alert("Already used", "This ticket was already scanned.");
      return { already: true, stored: toStore };
    }
    const next = uniqCI([...current, toStore]);
    const { error } = await supabase.from(EVENTS_TABLE).update({ scanned: next }).eq("id", eventRow.id);
    if (error) throw error;
    setModel((prev) =>
      prev?.event ? { ...prev, event: { ...prev.event, scanned: next } } : prev
    );
    return { already: false, stored: toStore };
  };

  const handleBarcodeScanned = async ({ data }) => {
    const raw = String(data || "").trim();
    if (!raw || scanLockRef.current) return;
    scanLockRef.current = true;
    setLastScanValue(raw);
    setScanBusy(true);
    try {
      if (!eventRow?.id) throw new Error("Missing event.");
      let ticket = null;
      { const { data: row } = await supabase
          .from(TICKETS_TABLE).select("id, event_id, post_id, holder_display, qr_payload")
          .eq("id", raw).maybeSingle();
        if (row?.id) ticket = row; }
      if (!ticket) {
        const { data: row2 } = await supabase
          .from(TICKETS_TABLE).select("id, event_id, post_id, holder_display, qr_payload")
          .eq("qr_payload", raw).maybeSingle();
        if (row2?.id) ticket = row2;
      }
      if (!ticket?.id) { Alert.alert("Invalid ticket", "No ticket found for this QR code."); return; }
      if (String(ticket.event_id) !== String(eventRow.id)) {
        Alert.alert("Wrong event", "This ticket is for a different event."); return;
      }
      const result = await markScanned({ holderDisplay: String(ticket.holder_display || "").trim() });
      if (!result?.already) Alert.alert("Success", `Ticket validated for: ${result.stored}`);
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not validate ticket.");
    } finally {
      setScanBusy(false);
      setTimeout(() => { scanLockRef.current = false; }, 900);
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     UI PIECES
  ══════════════════════════════════════════════════════════════════════ */
  const SelectionBar = ({ listKey, selectedCount }) => {
    if (!selectedCount) return null;
    return (
      <View style={styles.selectionBar}>
        <Text style={styles.selectionText}>{selectedCount} selected</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity style={styles.selectionBtn} onPress={() => selectAll(listKey)}>
            <Text style={styles.selectionBtnText}>Select all</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectionBtn, styles.selectionPrimary]}
            onPress={() => {
              const users =
                listKey === "ticket"
                  ? ticketUsers.filter((u) => selectedTicket.has(u.name) && !!u?.username)
                  : unconfirmedUsers.filter((u) => selectedUnconf.has(u.name) && !!u?.username);
              openDM(users, "Message");
            }}
          >
            <Text style={[styles.selectionBtnText, { color: "#fff" }]}>DM users</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectionBtn, styles.selectionDanger]}
            onPress={() => {
              const users =
                listKey === "ticket"
                  ? ticketUsers.filter((u) => selectedTicket.has(u.name))
                  : unconfirmedUsers.filter((u) => selectedUnconf.has(u.name));
              confirmRemove(users);
            }}
          >
            <Text style={[styles.selectionBtnText, { color: "#fff" }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ── renderUserRow: ticket holders + unconfirmed ── */
  const renderUserRow = (listKey, user, selectedSet) => {
    const displayName = user?.name || "User";
    const username = user?.username ?? null;
    const isExternal = !username;
    const checked = selectedSet.has(displayName);
    const rowKey = user.id?.toString() || displayName;
    const isExpanded = expandedUserInfo.has(rowKey);

    // attendees_info may be a JSONB array or a JSON string (TEXT column)
    const attendeesArr = parseJsonArr(eventRow?.attendees_info);
    const attendeeRec = attendeesArr.find(
      (item) =>
        (username && item?.username === username) ||
        item?.name === displayName
    );
    const buyerInfo = attendeeRec
      ? {
          ...(attendeeRec.age != null ? { age: attendeeRec.age } : {}),
          ...(attendeeRec.gender ? { gender: attendeeRec.gender } : {}),
          ...safeObj(attendeeRec.extra),
        }
      : {};
    const infoFields = Object.entries(buyerInfo).filter(
      ([k]) => k !== "username" && k !== "source" && k !== "response_id"
    );

    return (
      <View key={rowKey}>
        <View style={[styles.memberRow, { borderBottomColor: theme.border }]}>
          {user.avatar_url && !isExternal ? (
            <Image source={{ uri: user.avatar_url }} style={styles.memberAvatar} />
          ) : (
            <View
              style={[
                styles.memberAvatar,
                { backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
              ]}
            >
              <Text style={[styles.memberInitials, { color: theme.text }]}>
                {(displayName || "?")[0]?.toUpperCase() || "?"}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={[styles.memberName, { color: theme.text }]}>{displayName}</Text>
            <TouchableOpacity
              style={styles.infoToggleRow}
              onPress={() =>
                setExpandedUserInfo((prev) => {
                  const next = new Set(prev);
                  next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey);
                  return next;
                })
              }
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 10 }}
            >
              <Text
                style={[
                  styles.memberUsername,
                  { color: isExternal ? "#8c97a8" : theme.text },
                ]}
              >
                {isExternal ? notOnAlbaLabel : `@${username}`}
              </Text>
              <Feather
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={13}
                color="#59A7FF"
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => toggleSelect(listKey, displayName)}
            style={styles.checkboxBtn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <View style={[styles.checkbox, checked && { backgroundColor: "#59A7FF", borderColor: "#59A7FF" }]}>
              {checked && <Feather name="check" size={14} color="#fff" />}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.memberMenuButton, { opacity: isAdmin ? 1 : 0.35 }]}
            onPress={() => openMenu(listKey, user)}
            disabled={!isAdmin}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="more-vertical" size={18} color={theme.subtleText || theme.text} />
          </TouchableOpacity>
        </View>

        {isExpanded && (
          <View
            style={[
              styles.infoPanel,
              { backgroundColor: isDark ? "#1a1f2e" : "#f0f6ff", borderBottomColor: theme.border },
            ]}
          >
            {infoFields.length > 0 ? (
              infoFields.map(([k, v], i) => (
                <Text key={i} style={[styles.infoPanelLine, { color: theme.text }]}>
                  <Text style={styles.infoPanelKey}>{k}: </Text>
                  {String(v ?? "")}
                </Text>
              ))
            ) : (
              <Text style={[styles.infoPanelLine, { color: theme.subtleText || "#8c97a8" }]}>
                {t("no_info_available") || "No info available"}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  const ticketSelectedCount = selectedTicket.size;
  const unconfSelectedCount = selectedUnconf.size;

  if (!fontsLoaded) return null;

  const scannedCount = safeArr(eventRow?.scanned).length;

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t("event_settings_title") || "Event Settings"}
          </Text>
          <View style={{ width: 32 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: 18 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2F91FF" colors={["#2F91FF"]} />
            }
          >
            {/* ── Title ── */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t("event_change_title") || "Change title"}
            </Text>
            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder={postRow?.title || "Event title"}
                placeholderTextColor={theme.subtleText || "#8c97a8"}
                style={[styles.input, { color: theme.text }]}
              />
            </View>

            {/* ── Description ── */}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 10 }]}>
              {t("event_change_description") || "Change description"}
            </Text>
            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={draftDesc}
                onChangeText={setDraftDesc}
                placeholder={postRow?.description || "Event description"}
                placeholderTextColor={theme.subtleText || "#8c97a8"}
                style={[styles.input, { color: theme.text, height: 60 }]}
                multiline
              />
            </View>

            {/* ── All day / Every day / Online ── */}
            <View style={styles.togglesRow}>
              {[
                { label: t("event_all_day") || "All day", value: draftAllDay, onToggle: (next) => { setDraftAllDay(next); if (next) { setDraftTime(""); setDraftEndTime(""); } } },
                { label: t("event_every_day") || "Every day", value: draftEveryDay, onToggle: setDraftEveryDay },
                { label: t("event_online") || "Online", value: draftOnline, onToggle: setDraftOnline },
              ].map(({ label, value, onToggle }) => (
                <TouchableOpacity key={label} style={styles.toggleItem} onPress={() => onToggle(!value)} activeOpacity={0.7}>
                  <Text style={[styles.toggleLabel, { color: theme.subtleText || "#8c97a8" }]}>{label}</Text>
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

            {/* ── Start date/time ── */}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 0 }]}>
              {t("change_date_time") || "Start date and time"}
            </Text>
            <View style={styles.dateTimeRow}>
              <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <TextInput
                  value={draftDate}
                  onChangeText={setDraftDate}
                  placeholder={postRow?.date || "YYYY-MM-DD"}
                  placeholderTextColor={theme.subtleText || "#8c97a8"}
                  style={[styles.pillInput, { color: theme.text }]}
                />
              </View>
              {!draftAllDay && (
                <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                  <TextInput
                    value={draftTime}
                    onChangeText={setDraftTime}
                    placeholder={(postRow?.time || "").toString().slice(0, 5) || "HH:MM"}
                    placeholderTextColor={theme.subtleText || "#8c97a8"}
                    style={[styles.pillInput, { color: theme.text }]}
                  />
                </View>
              )}
            </View>

            {/* ── End date/time ── */}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 10 }]}>
              {t("change_end_date_time") || "End date and time"}
            </Text>
            <View style={styles.dateTimeRow}>
              <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <TextInput
                  value={draftEndDate}
                  onChangeText={setDraftEndDate}
                  placeholder={postRow?.end_date || "YYYY-MM-DD"}
                  placeholderTextColor={theme.subtleText || "#8c97a8"}
                  style={[styles.pillInput, { color: theme.text }]}
                />
              </View>
              {!draftAllDay && (
                <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                  <TextInput
                    value={draftEndTime}
                    onChangeText={setDraftEndTime}
                    placeholder={(postRow?.end_time || "").toString().slice(0, 5) || "HH:MM"}
                    placeholderTextColor={theme.subtleText || "#8c97a8"}
                    style={[styles.pillInput, { color: theme.text }]}
                  />
                </View>
              )}
            </View>

            {/* ── Location ── */}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 10 }]}>
              {t("change_location") || "Change location"}
            </Text>
            <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={draftLocation}
                onChangeText={setDraftLocation}
                placeholder={postRow?.location || "Location"}
                placeholderTextColor={theme.subtleText || "#8c97a8"}
                style={[styles.input, { color: theme.text }]}
              />
            </View>

            {/* ── Media ── */}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 10 }]}>
              {t("event_media") || "Media"}
            </Text>
            <View style={styles.mediaGrid}>
              {draftMedia.map((m, i) => (
                <View key={i} style={styles.mediaThumbnailWrap}>
                  <Image source={{ uri: m.uri }} style={styles.mediaThumbnail} resizeMode="cover" />
                  {m.type === "video" && (
                    <View style={styles.videoOverlay}>
                      <Feather name="play" size={18} color="#fff" />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.mediaRemoveBtn}
                    onPress={() => removeEventMedia(i)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Feather name="x" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={[styles.mediaAddBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
                onPress={pickEventMedia}
                activeOpacity={0.75}
              >
                <Feather name="plus" size={22} color={theme.subtleText || "#8c97a8"} />
              </TouchableOpacity>
            </View>

            {/* ── Save / Cancel ── */}
            {isDirty && (
              <View style={styles.saveRow}>
                <TouchableOpacity
                  style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={onSave}
                  disabled={saving}
                >
                  <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.cancelEditsBtn,
                    { backgroundColor: isDark ? "#111827" : "#EAF5FF", borderColor: theme.border },
                  ]}
                  onPress={onCancelEdits}
                >
                  <Text style={[styles.cancelEditsText, { color: theme.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Purchases active ── */}
            {isAdmin && (
              <TouchableOpacity
                style={[styles.toggleRow, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.7}
                onPress={async () => {
                  if (!eventRow?.id) return;
                  const next = !purchasesActive;
                  setPurchasesActive(next);
                  await supabase.from(EVENTS_TABLE).update({ purchases_active: next }).eq("id", eventRow.id);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleRowLabel, { color: theme.text }]}>
                    {t("event_purchases_active") || "Allow ticket purchases"}
                  </Text>
                  <Text style={[styles.toggleSub, { color: theme.subtleText || "#8c97a8" }]}>
                    {t("event_purchases_active_sub") || "Users can buy tickets for this event"}
                  </Text>
                </View>
                <View style={[styles.toggleTrack, { backgroundColor: purchasesActive ? "#3D8BFF" : (theme.border || "#ccc") }]}>
                  <View style={[styles.toggleThumb, { alignSelf: purchasesActive ? "flex-end" : "flex-start" }]} />
                </View>
              </TouchableOpacity>
            )}

            {/* ── Allow guest accounts ── */}
            {isAdmin && postRow?.id && (
              <TouchableOpacity
                style={[styles.toggleRow, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.7}
                onPress={async () => {
                  if (!postRow?.id) return;
                  const next = !allowGuests;
                  setAllowGuests(next);
                  await supabase.from(POSTS_TABLE).update({ allow_guests: next }).eq("id", postRow.id);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleRowLabel, { color: theme.text }]}>
                    {t("event_allow_guests") || "Allow guest accounts to buy tickets"}
                  </Text>
                  <Text style={[styles.toggleSub, { color: theme.subtleText || "#8c97a8" }]}>
                    {t("event_allow_guests_sub") || "People without an account can get tickets from the web"}
                  </Text>
                </View>
                <View style={[styles.toggleTrack, { backgroundColor: allowGuests ? "#3D8BFF" : (theme.border || "#ccc") }]}>
                  <View style={[styles.toggleThumb, { alignSelf: allowGuests ? "flex-end" : "flex-start" }]} />
                </View>
              </TouchableOpacity>
            )}

            {/* ── Pause / Resume ticket selling ── */}
            {isAdmin && postRow?.id && (
              <TouchableOpacity
                style={[styles.toggleRow, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.7}
                onPress={async () => {
                  const currentActions = safeArr(postRow?.actions);
                  const nextActions = ticketsPaused
                    ? ["tickets", ...currentActions.filter((a) => String(a).toLowerCase() !== "tickets")]
                    : currentActions.filter((a) => String(a).toLowerCase() !== "tickets");
                  setTicketsPaused(!ticketsPaused);
                  const { error } = await supabase
                    .from(POSTS_TABLE).update({ actions: nextActions }).eq("id", postRow.id);
                  if (error) setTicketsPaused(ticketsPaused);
                  else setModel((prev) => prev ? { ...prev, post: { ...prev.post, actions: nextActions } } : prev);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleRowLabel, { color: theme.text }]}>
                    {ticketsPaused
                      ? (t("event_resume_tickets") || "Resume ticket selling")
                      : (t("event_pause_tickets") || "Pause ticket selling")}
                  </Text>
                  <Text style={[styles.toggleSub, { color: theme.subtleText || "#8c97a8" }]}>
                    {ticketsPaused
                      ? (t("event_ticket_resume_sub") || "Ticket button will reappear on the post")
                      : (t("event_ticket_pause_sub") || "Ticket button will be hidden from the post")}
                  </Text>
                </View>
                <View style={[styles.toggleTrack, { backgroundColor: ticketsPaused ? (theme.border || "#ccc") : "#3D8BFF" }]}>
                  <View style={[styles.toggleThumb, { alignSelf: ticketsPaused ? "flex-start" : "flex-end" }]} />
                </View>
              </TouchableOpacity>
            )}

            {/* ── Manually approve ── */}
            {isAdmin && (
              <TouchableOpacity
                style={[styles.toggleRow, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.7}
                onPress={async () => {
                  if (!postRow?.id) return;
                  const next = !manuallyApprove;
                  setManuallyApprove(next);
                  await saveTicketControls({ manually_approve_attendees: next });
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleRowLabel, { color: theme.text }]}>
                    {t("event_manually_approve_buyers") || "Manually approve ticket buyers"}
                  </Text>
                  <Text style={[styles.toggleSub, { color: theme.subtleText || "#8c97a8" }]}>
                    {t("event_approval_info_label") || "Required info to approve buyer"}
                    {postRow?.ticket_approval_info ? `: ${postRow.ticket_approval_info}` : ""}
                  </Text>
                </View>
                <View style={[styles.toggleTrack, { backgroundColor: manuallyApprove ? "#3D8BFF" : (theme.border || "#ccc") }]}>
                  <View style={[styles.toggleThumb, { alignSelf: manuallyApprove ? "flex-end" : "flex-start" }]} />
                </View>
              </TouchableOpacity>
            )}

            {/* ── Fixed ticket count ── */}
            {isAdmin && (
              <TouchableOpacity
                style={[styles.toggleRow, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.7}
                onPress={async () => {
                  if (!postRow?.id) return;
                  const next = !fixedTicketCount;
                  setFixedTicketCount(next);
                  if (!next) await saveTicketControls({ is_ticket_number_fixed: false, ticket_number: null });
                  else await saveTicketControls({ is_ticket_number_fixed: true });
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleRowLabel, { color: theme.text }]}>
                    {t("event_sell_fixed_tickets") || "Sell fixed number of tickets"}
                  </Text>
                  {fixedTicketCount && (
                    <TextInput
                      value={ticketNumber}
                      onChangeText={setTicketNumber}
                      keyboardType="numeric"
                      placeholder={t("event_ticket_how_many") || "How many?"}
                      placeholderTextColor={theme.subtleText || "#8c97a8"}
                      style={[styles.toggleSub, { color: theme.text, marginTop: 4 }]}
                      onEndEditing={async () => {
                        const n = parseInt(ticketNumber, 10);
                        if (Number.isFinite(n) && n > 0 && postRow?.id)
                          await saveTicketControls({ ticket_number: n });
                      }}
                    />
                  )}
                </View>
                <View style={[styles.toggleTrack, { backgroundColor: fixedTicketCount ? "#3D8BFF" : (theme.border || "#ccc") }]}>
                  <View style={[styles.toggleThumb, { alignSelf: fixedTicketCount ? "flex-end" : "flex-start" }]} />
                </View>
              </TouchableOpacity>
            )}

            {/* ══ Pending ticket requests ══ */}
            {isAdmin && manuallyApprove && (
              <View
                style={[
                  styles.toggleRow,
                  { borderColor: theme.border, backgroundColor: theme.card, flexDirection: "column", alignItems: "stretch" },
                ]}
              >
                <TouchableOpacity
                  style={{ flexDirection: "row", alignItems: "center" }}
                  activeOpacity={0.7}
                  onPress={() => setPendingExpanded((v) => !v)}
                >
                  <Text style={[styles.toggleRowLabel, { color: theme.text, flex: 1 }]}>
                    {t("pending_ticket_requests_title") || "Pending ticket requests"}
                    {pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ""}
                  </Text>
                  <Feather
                    name={pendingExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={theme.subtleText || "#8c97a8"}
                  />
                </TouchableOpacity>

                {pendingExpanded && (
                  <View style={{ marginTop: 10 }}>
                    {pendingRequests.length === 0 ? (
                      <Text style={[styles.toggleSub, { color: theme.subtleText || "#8c97a8", paddingVertical: 8 }]}>
                        {t("pending_ticket_requests_empty") || "No pending requests."}
                      </Text>
                    ) : (
                      pendingRequests.map((req, reqIdx) => {
                        const buyerUsername = req?.username || "";
                        const reqRequestId = req?.request_id || null;
                        const info = req?.info || "";
                        const photoUrl = req?.photo_url || null;
                        const attendees = Array.isArray(req?.attendees_to_add) ? req.attendees_to_add : [];
                        const reqKey = req?.request_id || req?.requested_at || `${buyerUsername}-${reqIdx}`;

                        // Primary display: names of the people who need tickets
                        const attendeeNames = attendees
                          .map((a) => a?.name || (a?.username ? `@${a.username}` : ""))
                          .filter(Boolean);
                        const displayName = attendeeNames.length > 0
                          ? attendeeNames.join(", ")
                          : buyerUsername;
                        const displayInitial = (attendeeNames[0] || buyerUsername).charAt(0).toUpperCase();

                        const isExpanded = expandedPendingInfo.has(reqKey);
                        const hasVettingInfo = !!info;
                        const hasAttendeeInfo = attendees.some(
                          (a) => a?.age != null || a?.gender || (a?.extra && Object.keys(a.extra).length > 0)
                        );
                        const hasAnyExpandable = hasVettingInfo || !!photoUrl || hasAttendeeInfo;

                        return (
                          <View key={reqKey}>
                            <View style={[styles.memberRow, { borderBottomColor: theme.border }]}>
                              <View
                                style={[
                                  styles.memberAvatar,
                                  { backgroundColor: "#3D8BFF", alignItems: "center", justifyContent: "center" },
                                ]}
                              >
                                <Text style={{ color: "#fff", fontFamily: "PoppinsBold", fontSize: 14 }}>
                                  {displayInitial}
                                </Text>
                              </View>

                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={[styles.memberName, { color: theme.text }]} numberOfLines={1}>
                                  {displayName}
                                </Text>
                                <TouchableOpacity
                                  style={styles.infoToggleRow}
                                  onPress={() => {
                                    if (!hasAnyExpandable) return;
                                    setExpandedPendingInfo((prev) => {
                                      const next = new Set(prev);
                                      next.has(reqKey) ? next.delete(reqKey) : next.add(reqKey);
                                      return next;
                                    });
                                  }}
                                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 10 }}
                                >
                                  <Text style={[styles.memberUsername, { color: theme.subtleText || "#8c97a8" }]}>
                                    {buyerUsername ? `by @${buyerUsername}` : ""}
                                  </Text>
                                  {hasAnyExpandable && (
                                    <Feather
                                      name={isExpanded ? "chevron-up" : "chevron-down"}
                                      size={13}
                                      color="#59A7FF"
                                      style={{ marginLeft: 4 }}
                                    />
                                  )}
                                </TouchableOpacity>
                              </View>

                              <View style={{ flexDirection: "row", gap: 8 }}>
                                <TouchableOpacity
                                  style={[styles.pendingIconBtn, { backgroundColor: "#2BB673" }]}
                                  onPress={() => approveTicketRequest(reqRequestId, buyerUsername)}
                                >
                                  <Feather name="check" size={16} color="#fff" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.pendingIconBtn, { backgroundColor: "#EF4444" }]}
                                  onPress={() => rejectTicketRequest(reqRequestId, buyerUsername)}
                                >
                                  <Feather name="x" size={16} color="#fff" />
                                </TouchableOpacity>
                              </View>
                            </View>

                            {isExpanded && (
                              <View
                                style={[
                                  styles.infoPanel,
                                  {
                                    backgroundColor: isDark ? "#1a1f2e" : "#f0f6ff",
                                    borderBottomColor: theme.border,
                                  },
                                ]}
                              >
                                {/* Approval text + photo the buyer submitted */}
                                {hasVettingInfo && (
                                  <Text style={[styles.infoPanelLine, { color: theme.text }]}>
                                    {postRow?.ticket_approval_info ? (
                                      <>
                                        <Text style={styles.infoPanelKey}>
                                          {postRow.ticket_approval_info}:{" "}
                                        </Text>
                                        {info}
                                      </>
                                    ) : (
                                      info
                                    )}
                                  </Text>
                                )}
                                {!!photoUrl && (
                                  <TouchableOpacity
                                    activeOpacity={0.85}
                                    onPress={() => setLightboxUri(photoUrl)}
                                    style={{ marginTop: hasVettingInfo ? 8 : 0 }}
                                  >
                                    <Image
                                      source={{ uri: photoUrl }}
                                      style={styles.pendingPhoto}
                                      resizeMode="cover"
                                    />
                                  </TouchableOpacity>
                                )}

                                {/* Required info the buyer filled for each attendee */}
                                {attendees.map((a, ai) => {
                                  const lines = [];
                                  if (a?.name) lines.push(`Name: ${a.name}`);
                                  if (a?.age != null) lines.push(`Age: ${a.age}`);
                                  if (a?.gender) lines.push(`Gender: ${a.gender}`);
                                  if (a?.extra) {
                                    Object.entries(a.extra).forEach(([k, v]) => {
                                      if (v) lines.push(`${k}: ${v}`);
                                    });
                                  }
                                  if (!lines.length) return null;
                                  return (
                                    <View key={ai} style={{ marginTop: 8 }}>
                                      {attendees.length > 1 && (
                                        <Text style={[styles.infoPanelKey, { color: theme.text, marginBottom: 2 }]}>
                                          {a?.name || `Ticket ${ai + 1}`}
                                        </Text>
                                      )}
                                      {lines.map((line, li) => (
                                        <Text key={li} style={[styles.infoPanelLine, { color: theme.text }]}>
                                          {line}
                                        </Text>
                                      ))}
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })
                    )}
                  </View>
                )}
              </View>
            )}

            {/* ══ Google Forms + Export to Excel button row ══ */}
            {isAdmin && (
              <View style={{ marginTop: 14 }}>
                <View style={styles.adminBtnRow}>
                  {/* Google Forms half */}
                  {googleIntegration?.form_name ? (
                    <View
                      style={[
                        styles.adminBtnHalf,
                        { flex: 1, backgroundColor: isDark ? "#1a2e1a" : "#e8f5e9", borderColor: "#2BB673" },
                      ]}
                    >
                      <Feather name="check-circle" size={16} color="#2BB673" style={{ marginTop: 2 }} />
                      <Text style={[styles.adminBtnText, { color: "#2BB673" }]}>
                        {(t("google_form_connected") || "Google Form connected: {name}").replace(
                          "{name}",
                          googleIntegration.form_name
                        )}
                      </Text>
                      {formsSyncing && (
                        <ActivityIndicator size="small" color="#2BB673" style={{ marginLeft: 4 }} />
                      )}
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.adminBtnHalf,
                        {
                          flex: 1,
                          backgroundColor: isDark ? "#111827" : "#fff",
                          borderColor: theme.border,
                          opacity: googleAuthLoading ? 0.6 : 1,
                        },
                      ]}
                      onPress={() => { googlePromptAsync(); }}
                      disabled={googleAuthLoading || !googleRequest}
                      activeOpacity={0.85}
                    >
                      {googleAuthLoading ? (
                        <ActivityIndicator size="small" color="#59A7FF" style={{ marginTop: 2 }} />
                      ) : (
                        <Feather name="link" size={16} color="#59A7FF" style={{ marginTop: 2 }} />
                      )}
                      <Text style={[styles.adminBtnText, { color: "#59A7FF" }]}>
                        {t("integrate_google_forms") || "Connect to Google Forms"}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Export to Excel half */}
                  <TouchableOpacity
                    style={[
                      styles.adminBtnHalf,
                      {
                        flex: 1,
                        alignItems: "center",
                        backgroundColor: isDark ? "#111827" : "#fff",
                        borderColor: theme.border,
                        opacity: exportingExcel ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleExportExcel}
                    disabled={exportingExcel}
                    activeOpacity={0.85}
                  >
                    {exportingExcel ? (
                      <ActivityIndicator size="small" color="#22a84b" />
                    ) : (
                      <Feather name="download" size={16} color="#22a84b" />
                    )}
                    <Text style={[styles.adminBtnText, { color: "#22a84b" }]}>
                      {t("export_to_excel") || "Export to Excel"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Disconnect — below both buttons, left-aligned */}
                {googleIntegration?.form_name && (
                  <TouchableOpacity
                    onPress={disconnectGoogleForm}
                    style={styles.googleFormsDisconnect}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={styles.googleFormsDisconnectText}>
                      {t("disconnect_google_form") || "Disconnect"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ══ Scan ticket QR button ══ */}
            <View style={{ marginTop: 10 }}>
              <TouchableOpacity
                style={[styles.scanBtn, { opacity: isAdmin ? 1 : 0.45, backgroundColor: "#6C63FF" }]}
                onPress={openScanner}
                disabled={!isAdmin}
                activeOpacity={0.9}
              >
                <Feather name="camera" size={16} color="#fff" />
                <Text style={styles.scanBtnText}>{t("event_scan_qr") || "Scan ticket QR"}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.scanMetaText}>
                  {(t("event_scan_scanned") || "{n} scanned").replace("{n}", scannedCount)}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ══ Ticket holders ══ */}
            <View style={styles.listHeaderRow}>
              <Text style={[styles.listTitle, { color: theme.text }]}>
                {t("ticket_holders") || "Ticket holders"}
              </Text>
              <Text style={[styles.listCount, { color: theme.subtleText || theme.text }]}>
                {ticketUsers.length}
              </Text>
            </View>
            <SelectionBar listKey="ticket" selectedCount={ticketSelectedCount} />
            <View style={[styles.membersList, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingBottom: 4 }}>
                {ticketUsers.map((u) => renderUserRow("ticket", u, selectedTicket))}
              </ScrollView>
            </View>
            <TouchableOpacity
              style={styles.dmWholeBtn}
              onPress={() => openDM(ticketUsers.filter((u) => !!u?.username), "DM whole list")}
            >
              <Feather name="message-circle" size={15} color="#fff" />
              <Text style={styles.dmWholeText}>{t("dm_whole_list") || "DM whole list"}</Text>
            </TouchableOpacity>

            {/* ══ Unconfirmed ══ */}
            <View style={[styles.listHeaderRow, { marginTop: 16 }]}>
              <Text style={[styles.listTitle, { color: theme.text }]}>
                {t("unconfirmed") || "Unconfirmed"}
              </Text>
              <Text style={[styles.listCount, { color: theme.subtleText || theme.text }]}>
                {unconfirmedUsers.length}
              </Text>
            </View>
            <SelectionBar listKey="unconf" selectedCount={unconfSelectedCount} />
            <View style={[styles.membersList, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingBottom: 4 }}>
                {unconfirmedUsers.map((u) => renderUserRow("unconf", u, selectedUnconf))}
              </ScrollView>
            </View>
            <TouchableOpacity
              style={styles.dmWholeBtn}
              onPress={() => openDM(unconfirmedUsers.filter((u) => !!u?.username), "DM whole list")}
            >
              <Feather name="message-circle" size={15} color="#fff" />
              <Text style={styles.dmWholeText}>{t("dm_whole_list") || "DM whole list"}</Text>
            </TouchableOpacity>

            {/* ══ Shared the event ══ */}
            <View style={[styles.listHeaderRow, { marginTop: 16 }]}>
              <Text style={[styles.listTitle, { color: theme.text }]}>
                {t("shared_event_list_title") || "Shared the event"}
              </Text>
              <Text style={[styles.listCount, { color: theme.subtleText || theme.text }]}>
                {sharedByUsers.length}
              </Text>
            </View>
            <View style={[styles.membersList, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingBottom: 4 }}>
                {sharedByUsers.length === 0 ? (
                  <Text style={{ fontFamily: "Poppins", fontSize: 13, color: theme.subtleText || theme.text, padding: 12 }}>
                    {t("shared_list_empty") || "Nobody has shared this yet."}
                  </Text>
                ) : (
                  sharedByUsers.map((u) => renderUserRow("shared", u, new Set()))
                )}
              </ScrollView>
            </View>

            {/* ── Invite ── */}
            <TouchableOpacity style={[styles.outlineButton, { marginTop: 14 }]} onPress={onInviteFromPrevious}>
              <Text style={styles.outlineButtonText}>
                {t("invite_previous_event") || "Invite users from previous event"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                if (!inviteGroupPayload) {
                  Alert.alert("Missing group", "This event has no group chat to invite to.");
                  return;
                }
                setShareVisible(true);
              }}
            >
              <Text style={styles.primaryButtonText}>{t("invite_users") || "Invite users"}</Text>
            </TouchableOpacity>

            {/* ── Delete ── */}
            <TouchableOpacity style={styles.deleteButton} onPress={() => setDeleteVisible(true)}>
              <Text style={styles.deleteButtonText}>{t("delete_event") || "Delete event"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── ShareMenu ── */}
      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        inviteGroup={inviteGroupPayload}
        postId={null}
        defaultMessage={defaultInviteMessage}
        onSent={() => {}}
      />

      {/* ══ Google Forms selection modal ══ */}
      <Modal
        visible={formsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFormsModalVisible(false)}
      >
        <View style={styles.formsModalOverlay}>
          <View
            style={[
              styles.formsModalCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.formsModalTitle, { color: theme.text }]}>
              {t("google_forms_modal_title") || "Select a Google Form"}
            </Text>

            {availableForms.length === 0 ? (
              <Text style={[styles.formsModalEmpty, { color: theme.subtleText || "#8c97a8" }]}>
                {t("google_forms_no_forms") || "No Google Forms found in your account"}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
                {availableForms.map((form) => (
                  <TouchableOpacity
                    key={form.id}
                    style={[styles.formRow, { borderBottomColor: theme.border }]}
                    onPress={() => setSelectedFormIdInModal(form.id)}
                    activeOpacity={0.75}
                  >
                    <View
                      style={[
                        styles.formCheckbox,
                        selectedFormIdInModal === form.id && {
                          backgroundColor: "#59A7FF",
                          borderColor: "#59A7FF",
                        },
                      ]}
                    >
                      {selectedFormIdInModal === form.id && (
                        <Feather name="check" size={12} color="#fff" />
                      )}
                    </View>
                    <Text style={[styles.formName, { color: theme.text }]} numberOfLines={2}>
                      {form.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.formsModalBtns}>
              <TouchableOpacity
                style={[styles.formsModalCancelBtn, { borderColor: theme.border }]}
                onPress={() => {
                  setFormsModalVisible(false);
                  setSelectedFormIdInModal(null);
                  tempTokensRef.current = null;
                }}
              >
                <Text style={[styles.formsModalCancelText, { color: theme.text }]}>
                  {t("google_forms_cancel") || "Cancel"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.formsModalSelectBtn,
                  { opacity: selectedFormIdInModal ? 1 : 0.45 },
                ]}
                onPress={selectedFormIdInModal ? connectGoogleForm : undefined}
                disabled={!selectedFormIdInModal}
              >
                <Text style={styles.formsModalSelectText}>
                  {t("google_forms_select") || "Select"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Scanner modal ── */}
      <Modal visible={scanVisible} transparent animationType="slide" onRequestClose={closeScanner}>
        <View style={styles.scanOverlay}>
          <View style={[styles.scanCard, { backgroundColor: isDark ? "#10131a" : "#fff" }]}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: isDark ? "#fff" : "#111" }]}>
                {t("event_scan_title") || "Scan ticket"}
              </Text>
              <TouchableOpacity onPress={closeScanner} hitSlop={10}>
                <Feather name="x" size={22} color={isDark ? "#fff" : "#111"} />
              </TouchableOpacity>
            </View>
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                onBarcodeScanned={scanBusy ? undefined : handleBarcodeScanned}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              />
              <View style={styles.scanFrame} />
              {scanBusy && (
                <View style={styles.scanBusy}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.scanBusyText}>
                    {t("event_scan_validating") || "Validating…"}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.scanHint, { color: isDark ? "#cfd6e6" : "#4a5568" }]}>
              {t("event_scan_hint") || "Point the camera at the QR code."}
            </Text>
            {!!lastScanValue && (
              <Text style={[styles.scanSmall, { color: isDark ? "#9aa7c0" : "#718096" }]} numberOfLines={1}>
                {lastScanValue}
              </Text>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Delete confirm ── */}
      <Modal visible={deleteVisible} transparent animationType="fade" onRequestClose={() => setDeleteVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setDeleteVisible(false)} />
        <View style={[styles.deleteCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.deleteTitle, { color: theme.text }]}>
            {t("delete_event_confirm") || "Are you sure you want to delete this event?"}
          </Text>
          <View style={styles.deleteRow}>
            <TouchableOpacity style={[styles.deleteChoice, { backgroundColor: "#ff4d4f" }]} onPress={deleteEvent}>
              <Text style={styles.deleteChoiceText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#D9EEFF" }]}
              onPress={() => setDeleteVisible(false)}
            >
              <Text style={[styles.deleteChoiceText, { color: "#2F6CA8" }]}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 3-dot menu ── */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
        <View style={[styles.menuCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.menuTitle, { color: theme.text }]} numberOfLines={1}>
            {menuCtx?.user?.name || ""}
          </Text>
          {!!menuCtx?.user?.username && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const user = menuCtx?.user;
                setMenuVisible(false);
                if (user) openDM([user], "DM user");
              }}
            >
              <Text style={[styles.menuText, { color: theme.text }]}>DM user</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              const user = menuCtx?.user;
              setMenuVisible(false);
              if (user) confirmRemove([user]);
            }}
          >
            <Text style={[styles.menuText, { color: "#ff4d4f", fontFamily: "PoppinsBold" }]}>Remove</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuItem, { marginTop: 6 }]} onPress={() => setMenuVisible(false)}>
            <Text style={[styles.menuText, { color: theme.subtleText || theme.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Remove confirm ── */}
      <Modal visible={removeVisible} transparent animationType="fade" onRequestClose={() => setRemoveVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setRemoveVisible(false)} />
        <View style={[styles.deleteCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.deleteTitle, { color: theme.text }]}>
            {t("remove_user_confirm") || "Are you sure you want to remove this user?"}
          </Text>
          <View style={styles.deleteRow}>
            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#ff4d4f" }]}
              onPress={async () => {
                const users = removeCtx?.users || [];
                setRemoveVisible(false);
                setRemoveCtx(null);
                await removeUsers(users);
              }}
            >
              <Text style={styles.deleteChoiceText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deleteChoice, { backgroundColor: "#D9EEFF" }]}
              onPress={() => setRemoveVisible(false)}
            >
              <Text style={[styles.deleteChoiceText, { color: "#2F6CA8" }]}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DMUsersModal visible={dmVisible} onClose={() => setDmVisible(false)} users={dmUsers} title={dmTitle} />

      <Modal visible={!!lightboxUri} transparent animationType="fade" onRequestClose={() => setLightboxUri(null)}>
        <Pressable style={styles.lightboxBackdrop} onPress={() => setLightboxUri(null)}>
          <Image
            source={{ uri: lightboxUri }}
            style={styles.lightboxImage}
            resizeMode="contain"
          />
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: 16 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 4 },
  backButton: { paddingRight: 8, paddingVertical: 4 },
  headerTitle: { flex: 1, fontFamily: "PoppinsBold", fontSize: 18, textAlign: "center" },

  sectionTitle: { fontFamily: "PoppinsBold", fontSize: 14, marginTop: 16, marginBottom: 8 },

  inputWrap: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input: { fontFamily: "Poppins", fontSize: 14 },

  dateTimeRow: { flexDirection: "row", gap: 12 },
  togglesRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 14, marginBottom: 10, width: "100%" },
  toggleItem: { width: "33.33%", alignItems: "center", justifyContent: "flex-start", gap: 6 },
  toggleLabel: { fontFamily: "Poppins", fontSize: 11, textAlign: "center" },
  toggleRowLabel: { fontFamily: "PoppinsBold", fontSize: 14 },
  pill: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pillInput: { fontFamily: "Poppins", fontSize: 14 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  toggleSub: { fontFamily: "Poppins", fontSize: 12, marginTop: 2 },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, padding: 2, justifyContent: "center" },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff" },

  mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  mediaThumbnailWrap: { width: 80, height: 80, borderRadius: 10, overflow: "hidden" },
  mediaThumbnail: { width: 80, height: 80 },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  mediaRemoveBtn: {
    position: "absolute", top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  mediaAddBtn: {
    width: 80, height: 80, borderRadius: 10, borderWidth: 1,
    borderStyle: "dashed", alignItems: "center", justifyContent: "center",
  },

  saveRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 12 },
  saveBtn: { backgroundColor: "#59A7FF", paddingVertical: 10, paddingHorizontal: 26, borderRadius: 10 },
  saveBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },
  cancelEditsBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1 },
  cancelEditsText: { fontFamily: "PoppinsBold", fontSize: 14 },

  /* Google Forms + Excel row */
  adminBtnRow: { flexDirection: "row", gap: 8 },
  adminBtnHalf: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 6,
  },
  adminBtnText: { fontFamily: "PoppinsBold", fontSize: 13, flex: 1 },
  googleFormsDisconnect: { alignSelf: "flex-start", marginTop: 4, marginLeft: 2, paddingVertical: 2 },
  googleFormsDisconnectText: { fontFamily: "Poppins", fontSize: 12, color: "#ff4d4f" },

  /* Scanner */
  scanBtn: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, gap: 10,
  },
  scanBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },
  scanMetaText: { fontFamily: "Poppins", fontSize: 12, color: "#efeefe" },

  listHeaderRow: {
    flexDirection: "row", justifyContent: "space-between",
    marginTop: 14, marginBottom: 6, paddingHorizontal: 2, alignItems: "center",
  },
  listTitle: { fontFamily: "PoppinsBold", fontSize: 14 },
  listCount: { fontFamily: "Poppins", fontSize: 14 },

  selectionBar: {
    backgroundColor: "#D9EEFF", borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10, marginBottom: 8,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  selectionText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#2F6CA8" },
  selectionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#fff" },
  selectionPrimary: { backgroundColor: "#59A7FF" },
  selectionDanger: { backgroundColor: "#ff4d4f" },
  selectionBtnText: { fontFamily: "PoppinsBold", fontSize: 12, color: "#2F6CA8" },

  membersList: { borderWidth: 1, borderRadius: 14, maxHeight: 190, overflow: "hidden" },

  memberRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10, paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  memberInitials: { fontFamily: "PoppinsBold", fontSize: 16 },
  memberName: { fontFamily: "Poppins", fontSize: 15 },
  memberUsername: { fontFamily: "Poppins", fontSize: 13, marginTop: 2 },

  /* Info expand toggle row (username line + chevron) */
  infoToggleRow: { flexDirection: "row", alignItems: "center" },

  /* Info expand panel */
  infoPanel: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 0,
  },
  infoPanelLine: { fontFamily: "Poppins", fontSize: 13, lineHeight: 20 },
  infoPanelKey: { fontFamily: "PoppinsBold" },

  checkboxBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: "#C9D4E2",
    alignItems: "center", justifyContent: "center",
  },
  memberMenuButton: { paddingHorizontal: 4, paddingVertical: 4 },

  pendingIconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  pendingPhoto: { width: "100%", height: 200, borderRadius: 10 },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: { width: "100%", height: "100%" },

  dmWholeBtn: {
    alignSelf: "center", flexDirection: "row", gap: 8,
    backgroundColor: "#59A7FF", paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 10, marginTop: 10,
  },
  dmWholeText: { fontFamily: "PoppinsBold", fontSize: 13, color: "#fff" },

  outlineButton: {
    borderWidth: 1, borderColor: "#59A7FF", borderRadius: 10,
    paddingVertical: 10, alignItems: "center", backgroundColor: "#fff", marginTop: 6,
  },
  outlineButtonText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#59A7FF" },

  primaryButton: { borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#59A7FF", marginTop: 12 },
  primaryButtonText: { fontFamily: "PoppinsBold", fontSize: 15, color: "#fff" },

  deleteButton: { borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#ff4d4f", marginTop: 12, marginBottom: 6 },
  deleteButtonText: { fontFamily: "PoppinsBold", fontSize: 15, color: "#fff" },

  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  menuCard: { position: "absolute", left: 24, right: 24, bottom: 120, borderWidth: 1, borderRadius: 14, padding: 14 },
  menuTitle: { fontFamily: "PoppinsBold", fontSize: 15, marginBottom: 6 },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },

  deleteCard: {
    position: "absolute", left: 24, right: 24, top: "50%",
    transform: [{ translateY: -90 }], borderWidth: 1, borderRadius: 16, padding: 16,
  },
  deleteTitle: { fontFamily: "PoppinsBold", fontSize: 14, textAlign: "center" },
  deleteRow: { flexDirection: "row", gap: 12, marginTop: 14, justifyContent: "center" },
  deleteChoice: { minWidth: 110, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, alignItems: "center" },
  deleteChoiceText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  /* Google Forms modal */
  formsModalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  formsModalCard: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, padding: 18, paddingBottom: 28,
  },
  formsModalTitle: { fontFamily: "PoppinsBold", fontSize: 16, marginBottom: 14 },
  formsModalEmpty: { fontFamily: "Poppins", fontSize: 14, paddingVertical: 20, textAlign: "center" },
  formRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formCheckbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    borderColor: "#C9D4E2", alignItems: "center", justifyContent: "center",
  },
  formName: { fontFamily: "Poppins", fontSize: 14, flex: 1 },
  formsModalBtns: { flexDirection: "row", gap: 12, marginTop: 20, justifyContent: "flex-end" },
  formsModalCancelBtn: {
    paddingVertical: 10, paddingHorizontal: 20,
    borderRadius: 10, borderWidth: 1,
  },
  formsModalCancelText: { fontFamily: "PoppinsBold", fontSize: 14 },
  formsModalSelectBtn: {
    paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 10, backgroundColor: "#59A7FF",
  },
  formsModalSelectText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  /* Scanner modal */
  scanOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  scanCard: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 14, paddingBottom: 18 },
  scanHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  scanTitle: { fontFamily: "PoppinsBold", fontSize: 16 },
  cameraWrap: { height: 360, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
  scanFrame: {
    position: "absolute", left: 34, right: 34, top: 60, bottom: 60,
    borderWidth: 2, borderColor: "rgba(255,255,255,0.75)", borderRadius: 14,
  },
  scanBusy: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.55)", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  scanBusyText: { color: "#fff", fontFamily: "PoppinsBold" },
  scanHint: { marginTop: 10, fontFamily: "Poppins", fontSize: 13, textAlign: "center" },
  scanSmall: { marginTop: 6, fontFamily: "Poppins", fontSize: 12, textAlign: "center" },
});
