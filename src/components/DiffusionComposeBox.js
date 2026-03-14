/*
 * DiffusionComposeBox.js
 *
 * Supabase tables used (must be created in Supabase SQL editor):
 *
 *   CREATE TABLE diffusion_messages (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     sender_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 *     sender_name     text,
 *     sender_avatar   text,
 *     text            text,
 *     media_url       text,
 *     media_type      text,        -- 'image' | 'video' | null
 *     radius_km       float,
 *     sender_lat      float,
 *     sender_lng      float,
 *     sent_at         timestamptz DEFAULT now(),
 *     expires_at      timestamptz, -- sent_at + 48h
 *     stripe_payment_intent_id text
 *   );
 *
 *   CREATE TABLE diffusion_message_receipts (
 *     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     message_id    uuid REFERENCES diffusion_messages(id) ON DELETE CASCADE,
 *     recipient_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 *     delivered_at  timestamptz DEFAULT now(),
 *     opened_at     timestamptz,
 *     replied_at    timestamptz
 *   );
 *
 *   ALTER PUBLICATION supabase_realtime ADD TABLE diffusion_message_receipts;
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base-64";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import {
  PlatformPay,
  usePlatformPay,
  useStripe,
} from "@stripe/stripe-react-native";
import Constants from "expo-constants";

// ─── TESTING: set to true to skip Stripe payment for diffusion messages ───
const PAYMENT_BYPASS = false;
// ──────────────────────────────────────────────────────────────────────────

const BLUE = "#0077CC";
const API_URL =
  Constants.expoConfig?.extra?.expoPublic?.API_URL ?? "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function uploadDiffusionMedia({ uri, messageId }) {
  const ext = uri.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
  const isVideo = ["mp4", "mov", "m4v", "webm"].includes(ext);
  const mimeType = isVideo ? "video/mp4" : ext === "png" ? "image/png" : "image/jpeg";
  const key = `diffusion/${messageId}/${Date.now()}.${ext}`;

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = decode(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);

  const { error } = await supabase.storage
    .from("alba-media")
    .upload(key, buffer, { upsert: false, contentType: mimeType });
  if (error) throw error;

  const { data: pub } = supabase.storage.from("alba-media").getPublicUrl(key);
  return { url: pub.publicUrl, type: isVideo ? "video" : "image" };
}

function formatExpiry(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}h ${m}m`;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DiffusionComposeBox({
  currentUserId,
  myUsername,
  prefs,
  navigation,
}) {
  const { isDark } = useAlbaTheme();
  const { isPlatformPaySupported, confirmPlatformPayPayment } = usePlatformPay();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // Sender state
  const [senderMode, setSenderMode] = useState("idle"); // "idle"|"compose"|"confirm"|"stats"
  const [collapsed, setCollapsed] = useState(false);    // collapse stats card
  const [text, setText] = useState("");
  const [media, setMedia] = useState(null); // { uri, type: "image"|"video" }
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [activeMessage, setActiveMessage] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [expiryText, setExpiryText] = useState("");

  // Recipient state
  const [receivedMessages, setReceivedMessages] = useState([]);
  const [myLocation, setMyLocation] = useState(null);

  const channelRef = useRef(null);
  const expiryTimerRef = useRef(null);

  // ── Load data on mount ────────────────────────────────────────────────────

  useEffect(() => {
    if (!currentUserId) return;
    loadData();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
    };
  }, [currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    // Find active sent message (not expired)
    const { data: sent } = await supabase
      .from("diffusion_messages")
      .select("*")
      .eq("sender_id", currentUserId)
      .gt("expires_at", new Date().toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sent) {
      setActiveMessage(sent);
      setSenderMode("stats");
      loadReceipts(sent.id);
      startExpiryTimer(sent.expires_at);
      subscribeReceipts(sent.id);
    } else {
      setSenderMode("compose");
    }

    // Find received messages (not sent by self, not expired)
    const { data: receiptRows } = await supabase
      .from("diffusion_message_receipts")
      .select("*, message:diffusion_messages(*)")
      .eq("recipient_id", currentUserId);

    if (receiptRows) {
      const now = new Date();
      const valid = receiptRows.filter(
        (r) =>
          r.message &&
          new Date(r.message.expires_at) > now &&
          r.message.sender_id !== currentUserId
      );
      setReceivedMessages(valid);

      // Mark unread receipts as opened
      for (const r of valid) {
        if (!r.opened_at) {
          supabase
            .from("diffusion_message_receipts")
            .update({ opened_at: new Date().toISOString() })
            .eq("id", r.id)
            .then(() => {});
        }
      }
    }

    // Get location for distance display on recipient cards
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setMyLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    } catch {}
  };

  const loadReceipts = async (messageId) => {
    const { data } = await supabase
      .from("diffusion_message_receipts")
      .select("*")
      .eq("message_id", messageId);
    setReceipts(data || []);
  };

  const subscribeReceipts = (messageId) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase
      .channel(`diffusion-receipts-${messageId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "diffusion_message_receipts",
          filter: `message_id=eq.${messageId}`,
        },
        () => loadReceipts(messageId)
      )
      .subscribe((status, err) => {
        if (err) console.warn("[DiffusionComposeBox realtime] error:", err.message);
      });
  };

  const startExpiryTimer = (expiresAt) => {
    if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
    setExpiryText(formatExpiry(expiresAt));
    expiryTimerRef.current = setInterval(() => {
      const t = formatExpiry(expiresAt);
      setExpiryText(t);
      if (t === "Expired") {
        clearInterval(expiryTimerRef.current);
        setActiveMessage(null);
        setReceipts([]);
        setSenderMode("compose");
        setCollapsed(false);
      }
    }, 60000);
  };

  // ── Media picker ──────────────────────────────────────────────────────────

  const pickMedia = async (source) => {
    let result;
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required.");
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Photo library access is required.");
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
      });
    }
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setMedia({ uri: asset.uri, type: asset.type === "video" ? "video" : "image" });
    }
  };

  // ── Send flow ─────────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!text.trim() && !media) {
      setSendError("Add a message or media before sending.");
      return;
    }
    if (prefs.premiumTravelerMode) {
      Alert.alert(
        "Traveler Mode Active",
        "Diffusion Lists use your real location and cannot be used while Traveler Mode is active. Disable Traveler Mode in Settings first."
      );
      return;
    }
    setSendError(null);
    setSenderMode("confirm");
  };

  const handleConfirmSend = async () => {
    setSending(true);
    setSendError(null);
    try {
      // 1. Get real device location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted")
        throw new Error("Location permission required to send a Diffusion List message.");
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude: lat, longitude: lng } = loc.coords;

      // 2. Get sender profile info
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", currentUserId)
        .maybeSingle();
      const senderName = profile?.name || myUsername || "Someone";
      const senderAvatar = profile?.avatar_url || null;

      // 3. Process payment via Stripe (€1.00 per message)
      let paymentIntentId = "bypassed-for-testing";
      if (!PAYMENT_BYPASS) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token || "";
        const payRes = await fetch(`${API_URL}/create-payment-intent/diffusion-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ userId: currentUserId, radiusKm: prefs.diffusionRadiusKm }),
        });
        const payJson = await payRes.json();
        if (!payRes.ok || !payJson.clientSecret)
          throw new Error(payJson.error || "Payment setup failed. Please try again.");

        const clientSecret = payJson.clientSecret;
        paymentIntentId = clientSecret.split("_secret_")[0];

        const platformPayAvailable = await isPlatformPaySupported().catch(() => false);
        if (platformPayAvailable) {
          const { error: payError } = await confirmPlatformPayPayment(clientSecret, {
            applePay: {
              cartItems: [{ label: "Diffusion Message", amount: "1.00", paymentType: "Immediate" }],
              merchantCountryCode: "IT",
              currencyCode: "EUR",
            },
            googlePay: { merchantCountryCode: "IT", currencyCode: "EUR", testEnv: true },
          });
          if (payError?.code === "Canceled") { setSenderMode("compose"); return; }
          if (payError) throw new Error("Payment failed. Please try again.");
        } else {
          const { error: initError } = await initPaymentSheet({
            paymentIntentClientSecret: clientSecret,
            merchantDisplayName: "Alba",
          });
          if (initError) throw new Error("Payment setup failed.");
          const { error: presentError } = await presentPaymentSheet();
          if (presentError?.code === "Canceled") { setSenderMode("compose"); return; }
          if (presentError) throw new Error("Payment failed. Please try again.");
        }
      }

      // 4. Insert diffusion_message
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const { data: msgData, error: msgErr } = await supabase
        .from("diffusion_messages")
        .insert({
          sender_id: currentUserId,
          sender_name: senderName,
          sender_avatar: senderAvatar,
          text: text.trim() || null,
          media_url: null,
          media_type: null,
          radius_km: prefs.diffusionRadiusKm,
          sender_lat: lat,
          sender_lng: lng,
          sent_at: new Date().toISOString(),
          expires_at: expiresAt,
          stripe_payment_intent_id: paymentIntentId,
        })
        .select()
        .single();

      if (msgErr) throw msgErr;

      // 5. Upload media after record is created (so we have the ID for the storage key).
      //    If the upload fails, delete the message record to avoid orphaned rows.
      if (media) {
        let uploaded;
        try {
          uploaded = await uploadDiffusionMedia({ uri: media.uri, messageId: msgData.id });
        } catch (uploadErr) {
          // Clean up the orphaned message record before re-throwing
          await supabase.from("diffusion_messages").delete().eq("id", msgData.id).catch(() => {});
          throw uploadErr;
        }
        await supabase
          .from("diffusion_messages")
          .update({ media_url: uploaded.url, media_type: uploaded.type })
          .eq("id", msgData.id);
        msgData.media_url = uploaded.url;
        msgData.media_type = uploaded.type;
      }

      // 6. Find nearby recipients via existing nearby_profiles RPC
      const distMeters = Math.round(prefs.diffusionRadiusKm * 1000);
      const { data: nearby } = await supabase.rpc("nearby_profiles", {
        dist: distMeters,
        lat,
        long: lng,
        search_term: "",
      });

      // 7. Batch-insert receipts (excluding sender)
      if (nearby && nearby.length > 0) {
        const receiptRows = nearby
          .filter((p) => p.id !== currentUserId)
          .map((p) => ({
            message_id: msgData.id,
            recipient_id: p.id,
            delivered_at: new Date().toISOString(),
          }));
        if (receiptRows.length > 0) {
          await supabase.from("diffusion_message_receipts").insert(receiptRows);
        }
      }

      // TODO: push notification to recipients

      setActiveMessage(msgData);
      setSenderMode("stats");
      setCollapsed(false);
      setText("");
      setMedia(null);
      loadReceipts(msgData.id);
      startExpiryTimer(msgData.expires_at);
      subscribeReceipts(msgData.id);
    } catch (e) {
      setSendError(e?.message || "Something went wrong. Please try again.");
      setSenderMode("compose");
    } finally {
      setSending(false);
    }
  };

  // ── Reply ─────────────────────────────────────────────────────────────────

  const handleReply = async (receipt) => {
    const msg = receipt.message;
    if (!msg) return;

    supabase
      .from("diffusion_message_receipts")
      .update({ replied_at: new Date().toISOString() })
      .eq("id", receipt.id)
      .then(() => {});

    // Look up the sender's current username by their UUID
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", msg.sender_id)
      .maybeSingle();

    if (!profile?.username) {
      Alert.alert("Chat unavailable", "User not found.");
      return;
    }

    navigation.navigate("SingleChat", {
      isGroup: false,
      peerName: msg.sender_name || "User",
      username: profile.username,
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasSenderSection = prefs.premiumDiffusionList;
  const hasRecipientSection =
    !prefs.blockDiffusionMessages && receivedMessages.length > 0;

  if (!hasSenderSection && !hasRecipientSection) return null;

  const deliveredCount = receipts.length;
  const openedCount = receipts.filter((r) => r.opened_at).length;
  const repliedCount = receipts.filter((r) => r.replied_at).length;
  const pct = (n) =>
    deliveredCount > 0 ? `${Math.round((n / deliveredCount) * 100)}%` : "0%";

  return (
    <View>
      {/* ── SENDER CARD ── */}
      {hasSenderSection && (
        <View style={styles.senderCard}>

          {/* ── COMPOSE / CONFIRM ── */}
          {(senderMode === "compose" || senderMode === "confirm") && (
            <>
              <View style={styles.titleRow}>
                <Feather name="send" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.cardHeader}>Send a Diffusion List message</Text>
              </View>
              <Text style={styles.cardSubheader}>
                Reaches users within {prefs.diffusionRadiusKm}km · €1.00
              </Text>

              <TextInput
                style={styles.composeInput}
                placeholder="Write your message..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={text}
                onChangeText={setText}
                multiline
              />

              {media ? (
                <View style={styles.mediaThumbnailRow}>
                  <Image source={{ uri: media.uri }} style={styles.mediaThumbnail} />
                  <TouchableOpacity onPress={() => setMedia(null)} style={styles.mediaRemoveBtn}>
                    <Feather name="x" size={14} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.mediaTypeLabel}>
                    {media.type === "video" ? "Video" : "Photo"} attached
                  </Text>
                </View>
              ) : (
                <View style={styles.mediaRow}>
                  <TouchableOpacity onPress={() => pickMedia("camera")} style={styles.mediaBtn}>
                    <Feather name="camera" size={17} color="#fff" />
                    <Text style={styles.mediaBtnText}>Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => pickMedia("gallery")} style={styles.mediaBtn}>
                    <Feather name="image" size={17} color="#fff" />
                    <Text style={styles.mediaBtnText}>Gallery</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!!sendError && <Text style={styles.errorText}>{sendError}</Text>}

              {senderMode === "compose" ? (
                <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
                  <Text style={styles.sendBtnText}>Send</Text>
                </TouchableOpacity>
              ) : (
                <View>
                  <TouchableOpacity
                    style={[styles.sendBtn, { opacity: sending ? 0.6 : 1 }]}
                    onPress={handleConfirmSend}
                    disabled={sending}
                  >
                    {sending ? (
                      <ActivityIndicator color={BLUE} />
                    ) : (
                      <Text style={styles.sendBtnText}>
                        Confirm — charge €1.00 to Apple / Google Pay
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setSenderMode("compose")}
                    style={styles.cancelLink}
                  >
                    <Text style={styles.cancelLinkText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* ── STATS ── */}
          {senderMode === "stats" && activeMessage && (
            <>
              {/* Title row — always visible, chevron toggles collapse */}
              <TouchableOpacity
                style={styles.titleRow}
                onPress={() => setCollapsed((c) => !c)}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Feather name="check-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={[styles.cardHeader, { flex: 1 }]}>Diffusion List Sent</Text>
                <Text style={styles.expiryInline}>Expires in {expiryText}</Text>
                <TouchableOpacity
                  onPress={() => setCollapsed((c) => !c)}
                  style={styles.chevronBtn}
                  hitSlop={8}
                >
                  <Feather
                    name={collapsed ? "chevron-down" : "chevron-up"}
                    size={22}
                    color="#fff"
                  />
                </TouchableOpacity>
              </TouchableOpacity>

              {/* Expanded stats body */}
              {!collapsed && (
                <>
                  {!!activeMessage.text && (
                    <Text style={styles.statsMessageText} numberOfLines={2}>
                      {activeMessage.text}
                    </Text>
                  )}
                  {activeMessage.media_url && (
                    <Image
                      source={{ uri: activeMessage.media_url }}
                      style={styles.statsMediaThumb}
                      resizeMode="cover"
                    />
                  )}

                  <View style={styles.statsRows}>
                    <View style={styles.statLine}>
                      <Feather name="inbox" size={14} color="#fff" style={styles.statIcon} />
                      <Text style={styles.statText}>
                        Delivered to: {deliveredCount} users
                      </Text>
                    </View>
                    <View style={styles.statLine}>
                      <Feather name="eye" size={14} color="#fff" style={styles.statIcon} />
                      <Text style={styles.statText}>
                        Opened by: {openedCount} users ({pct(openedCount)})
                      </Text>
                    </View>
                    <View style={styles.statLine}>
                      <Feather name="message-circle" size={14} color="#fff" style={styles.statIcon} />
                      <Text style={styles.statText}>
                        Replied by: {repliedCount} users ({pct(repliedCount)})
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </>
          )}
        </View>
      )}

      {/* ── RECIPIENT CARDS ── */}
      {hasRecipientSection &&
        receivedMessages.map((r) => {
          const msg = r.message;
          if (!msg) return null;
          const dist =
            myLocation
              ? `${distanceKm(
                  myLocation.lat,
                  myLocation.lng,
                  msg.sender_lat,
                  msg.sender_lng
                ).toFixed(1)} km away`
              : null;

          return (
            <View
              key={r.id}
              style={[
                styles.receivedCard,
                { backgroundColor: isDark ? "#1A3F5C" : "#D6EEFF" },
              ]}
            >
              <View style={styles.titleRow}>
                <Feather name="map-pin" size={15} color={isDark ? "#90D5FF" : "#0077BB"} style={{ marginRight: 6 }} />
                <Text style={[styles.receivedHeader, { color: isDark ? "#90D5FF" : "#0077BB" }]}>
                  From someone nearby
                </Text>
              </View>

              <View style={styles.receivedMeta}>
                {msg.sender_avatar ? (
                  <Image source={{ uri: msg.sender_avatar }} style={styles.receivedAvatar} />
                ) : (
                  <View
                    style={[
                      styles.receivedAvatar,
                      { backgroundColor: BLUE, alignItems: "center", justifyContent: "center" },
                    ]}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                      {(msg.sender_name || "?")[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.receivedName, { color: isDark ? "#fff" : "#111" }]}>
                    {msg.sender_name || "Someone"}
                  </Text>
                  {dist && (
                    <Text style={[styles.receivedDist, { color: isDark ? "#90D5FF" : "#0077BB" }]}>
                      {dist}
                    </Text>
                  )}
                </View>
              </View>

              {!!msg.text && (
                <Text style={[styles.receivedText, { color: isDark ? "#ddd" : "#333" }]}>
                  {msg.text}
                </Text>
              )}
              {msg.media_url && (
                <Image
                  source={{ uri: msg.media_url }}
                  style={styles.receivedMedia}
                  resizeMode="cover"
                />
              )}

              <TouchableOpacity style={styles.replyBtn} onPress={() => handleReply(r)}>
                <Text style={styles.replyBtnText}>Reply</Text>
              </TouchableOpacity>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sender card — full width, no border radius
  senderCard: {
    backgroundColor: BLUE,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardHeader: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
  cardSubheader: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Poppins",
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
    marginLeft: 22,
  },
  chevronBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  expiryInline: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: "Poppins",
    fontSize: 12,
    marginRight: 4,
  },
  // Compose inputs
  composeInput: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 8,
    color: "#fff",
    fontFamily: "Poppins",
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 60,
    textAlignVertical: "top",
    marginTop: 10,
  },
  mediaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  mediaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  mediaBtnText: {
    color: "#fff",
    fontFamily: "Poppins",
    fontSize: 13,
  },
  mediaThumbnailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  mediaThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  mediaRemoveBtn: {
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 12,
    padding: 4,
  },
  mediaTypeLabel: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Poppins",
    fontSize: 12,
  },
  sendBtn: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  sendBtnText: {
    color: BLUE,
    fontFamily: "PoppinsBold",
    fontSize: 14,
  },
  cancelLink: {
    alignItems: "center",
    marginTop: 8,
  },
  cancelLinkText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Poppins",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  errorText: {
    color: "#FFD0D0",
    fontFamily: "Poppins",
    fontSize: 12,
    marginTop: 6,
  },
  // Stats
  statsMessageText: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: "Poppins",
    fontSize: 13,
    marginTop: 8,
    marginLeft: 22,
    marginBottom: 8,
  },
  statsMediaThumb: {
    width: "100%",
    height: 120,
    borderRadius: 8,
    marginBottom: 8,
  },
  statsRows: {
    gap: 6,
    marginTop: 8,
  },
  statLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  statIcon: {
    marginRight: 8,
  },
  statText: {
    color: "#fff",
    fontFamily: "Poppins",
    fontSize: 13,
  },
  // Recipient card — full width
  receivedCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  receivedHeader: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
  },
  receivedMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    marginBottom: 8,
  },
  receivedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  receivedName: {
    fontFamily: "PoppinsBold",
    fontSize: 14,
  },
  receivedDist: {
    fontFamily: "Poppins",
    fontSize: 12,
  },
  receivedText: {
    fontFamily: "Poppins",
    fontSize: 14,
    marginBottom: 8,
  },
  receivedMedia: {
    width: "100%",
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
  },
  replyBtn: {
    backgroundColor: BLUE,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  replyBtnText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 14,
  },
});
