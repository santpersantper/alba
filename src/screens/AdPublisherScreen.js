// screens/AdPublisherScreen.js — Ad Publisher Dashboard
/*
 * Tables used:
 *   posts            — id, title, description, date, time, end_date, end_time,
 *                      location, user, postmediauri, product_types, product_prices,
 *                      product_notes, product_required_info, product_options, labels
 *   ad_stats         — post_id, views, purchases, contacts
 *   ad_purchases     — post_id, buyer_id, buyer_username, product_name, required_info, purchased_at
 *   ad_contacts      — post_id, contacter_id, contacter_username, contacter_avatar, contacted_at
 *   profiles         — username
 *
 * SQL to run in Supabase (one-time setup):
 *
 *   CREATE TABLE IF NOT EXISTS ad_purchases (
 *     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     post_id       uuid NOT NULL,
 *     buyer_id      uuid REFERENCES auth.users(id),
 *     buyer_username text,
 *     product_name  text,
 *     required_info jsonb,
 *     purchased_at  timestamptz DEFAULT now()
 *   );
 *
 *   CREATE TABLE IF NOT EXISTS ad_contacts (
 *     id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     post_id             uuid NOT NULL,
 *     contacter_id        uuid REFERENCES auth.users(id),
 *     contacter_username  text,
 *     contacter_avatar    text,
 *     contacted_at        timestamptz DEFAULT now(),
 *     UNIQUE(post_id, contacter_id)
 *   );
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import Svg, { Rect, Text as SvgText, Line, G } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base-64";
import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { supabase } from "../lib/supabase";

const { width: SCREEN_W } = Dimensions.get("window");
const CHART_W = SCREEN_W - 64;
const CHART_H = 180;
const BAR_AREA_H = CHART_H - 36;

const POSTS_TABLE = "posts";
const POSTS_COLS =
  "id, title, description, date, time, end_date, end_time, location, user, postmediauri, product_types, product_prices, product_notes, product_required_info, product_options, labels";
const POSTS_COLS_BASIC = "id, title, description, date, time, location, user";
const TAB_KEYS = [
  "ad_tab_overview",
  "ad_tab_performance",
  "ad_tab_my_ads",
  "ad_tab_buyers",
];

const isVideoUrl = (url) => {
  if (!url) return false;
  const l = String(url).toLowerCase();
  return l.includes(".mp4") || l.includes(".mov") || l.includes(".m4v");
};

/* ─── Bar chart ─────────────────────────────────────────────────── */
function BarChart({ ads, metric, isDark }) {
  if (!ads || ads.length === 0) return null;
  const items = ads.slice(0, 7);
  const values = items.map((a) => a.stats?.[metric] ?? 0);
  const maxVal = Math.max(...values, 1);
  const barW = Math.max(16, Math.floor((CHART_W - 16) / items.length) - 8);
  const textColor = isDark ? "#aaa" : "#777";
  const barColor =
    metric === "views" ? "#6C63FF" : metric === "purchases" ? "#2BB673" : "#2F91FF";

  return (
    <Svg width={CHART_W} height={CHART_H}>
      <Line
        x1={0} y1={BAR_AREA_H}
        x2={CHART_W} y2={BAR_AREA_H}
        stroke={isDark ? "#444" : "#e0e0e0"}
        strokeWidth={1}
      />
      {items.map((ad, i) => {
        const barH =
          values[i] === 0 ? 2 : Math.max(5, Math.round((values[i] / maxVal) * (BAR_AREA_H - 14)));
        const x = i * (barW + 8) + 4;
        const y = BAR_AREA_H - barH;
        const label = (ad.title || "Ad").slice(0, 5);
        return (
          <G key={ad.id}>
            <Rect x={x} y={y} width={barW} height={barH} rx={4} fill={barColor} opacity={0.9} />
            {values[i] > 0 && (
              <SvgText x={x + barW / 2} y={y - 4} fontSize={9} fill={textColor} textAnchor="middle">
                {values[i]}
              </SvgText>
            )}
            <SvgText x={x + barW / 2} y={BAR_AREA_H + 16} fontSize={9} fill={textColor} textAnchor="middle">
              {label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

/* ─── Stat card (overview) ──────────────────────────────────────── */
function StatCard({ icon, label, value, color, theme }) {
  return (
    <View style={[cardStyles.wrap, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={[cardStyles.iconWrap, { backgroundColor: color + "1a" }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <Text style={[cardStyles.value, { color }]}>{value}</Text>
      <Text style={[cardStyles.label, { color: theme.subtleText || "#8c97a8" }]}>{label}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, alignItems: "center", marginHorizontal: 4 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  value: { fontFamily: "PoppinsBold", fontSize: 22 },
  label: { fontFamily: "Poppins", fontSize: 11, textAlign: "center", marginTop: 2 },
});

/* ─── Main screen ───────────────────────────────────────────────── */
export default function AdPublisherScreen() {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [myUsername, setMyUsername] = useState(null);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  // Performance tab
  const [selectedAdId, setSelectedAdId] = useState(null);
  const [chartMetric, setChartMetric] = useState("purchases");
  const [adPickerVisible, setAdPickerVisible] = useState(false);

  // Edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editAd, setEditAd] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [draftEndTime, setDraftEndTime] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftMedia, setDraftMedia] = useState([]); // [{uri, type, isNew}]
  const [draftProducts, setDraftProducts] = useState([]); // [{name, price, notes}]
  const [saving, setSaving] = useState(false);

  // Delete modal
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  // Buyers & Contacts tab
  const [bcAdId, setBcAdId] = useState(null);
  const [bcLoading, setBcLoading] = useState(false);
  const [buyers, setBuyers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [bcPickerVisible, setBcPickerVisible] = useState(false);

  /* ── auth ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user || !alive) return;
        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();
        if (!alive) return;
        setMyUsername(prof?.username || user.user_metadata?.username || null);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  /* ── load ads ── */
  const loadAds = useCallback(async () => {
    if (!myUsername) return;
    try {
      setLoading(true);
      let data, error;
      ({ data, error } = await supabase
        .from(POSTS_TABLE)
        .select(POSTS_COLS)
        .eq("user", myUsername)
        .eq("type", "Ad")
        .order("date", { ascending: false })
        .order("time", { ascending: false })
        .limit(100));
      if (error) {
        if (error.code === "PGRST204" || error.message?.includes("column") || error.message?.includes("schema")) {
          ({ data, error } = await supabase
            .from(POSTS_TABLE)
            .select(POSTS_COLS_BASIC)
            .eq("user", myUsername)
            .eq("type", "Ad")
            .order("date", { ascending: false })
            .limit(100));
          if (error) throw error;
        } else {
          throw error;
        }
      }
      const adList = data || [];
      let statsMap = {};
      if (adList.length > 0) {
        const ids = adList.map((a) => a.id);
        const { data: stats } = await supabase
          .from("ad_stats")
          .select("post_id, views, purchases, contacts")
          .in("post_id", ids);
        (stats || []).forEach((s) => { statsMap[s.post_id] = s; });
      }
      const enriched = adList.map((a) => ({
        ...a,
        stats: statsMap[a.id] || { views: 0, purchases: 0, contacts: 0 },
      }));
      setAds(enriched);
      setSelectedAdId((prev) => prev || enriched[0]?.id || null);
      setBcAdId((prev) => prev || enriched[0]?.id || null);
    } catch (e) {
      console.warn("[AdPublisher] load error", e);
    } finally {
      setLoading(false);
    }
  }, [myUsername]);

  useFocusEffect(useCallback(() => { loadAds(); }, [loadAds]));
  useEffect(() => { loadAds(); }, [loadAds]);

  /* ── load buyers & contacts ── */
  const loadBuyersContacts = useCallback(async (adId) => {
    if (!adId) return;
    setBcLoading(true);
    try {
      const [{ data: buyerData }, { data: contactData }] = await Promise.all([
        supabase
          .from("ad_purchases")
          .select("id, buyer_username, product_name, required_info, purchased_at")
          .eq("post_id", adId)
          .order("purchased_at", { ascending: false }),
        supabase
          .from("ad_contacts")
          .select("id, contacter_username, contacter_avatar, contacted_at")
          .eq("post_id", adId)
          .order("contacted_at", { ascending: false }),
      ]);
      setBuyers(buyerData || []);
      setContacts(contactData || []);
    } catch (e) {
      console.warn("[AdPublisher] bc load error", e);
    } finally {
      setBcLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 3 && bcAdId) loadBuyersContacts(bcAdId);
  }, [activeTab, bcAdId, loadBuyersContacts]);

  /* ── media upload helper ── */
  const uploadAdMedia = async (localUri, postId) => {
    const ext = localUri.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
    const isVideo = ["mp4", "mov", "m4v"].includes(ext);
    const mimeType = isVideo ? "video/mp4" : ext === "png" ? "image/png" : "image/jpeg";
    const key = `posts/${postId}/media/${Date.now()}.${ext}`;
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

  /* ── edit ── */
  const openEdit = (ad) => {
    setEditAd(ad);
    setDraftTitle(ad.title || "");
    setDraftDesc(ad.description || "");
    setDraftDate(ad.date || "");
    setDraftTime(String(ad.time || "").slice(0, 5));
    setDraftEndDate(ad.end_date || "");
    setDraftEndTime(String(ad.end_time || "").slice(0, 5));
    setDraftLocation(ad.location || "");
    // Media
    const existingMedia = (ad.postmediauri || []).map((uri) => ({
      uri,
      type: isVideoUrl(uri) ? "video" : "image",
      isNew: false,
    }));
    setDraftMedia(existingMedia);
    // Products
    const names = ad.product_types || [];
    const prices = ad.product_prices || [];
    const notes = ad.product_notes || [];
    const prods = names
      .map((name, i) => ({
        name: String(name || "").trim(),
        price: prices[i] != null ? String(prices[i]) : "",
        notes: notes[i] || "",
      }))
      .filter((p) => p.name);
    setDraftProducts(prods);
    setEditVisible(true);
  };

  const pickMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
      allowsMultipleSelection: true,
    });
    if (result.canceled) return;
    const newItems = result.assets.map((a) => ({
      uri: a.uri,
      type: a.type === "video" ? "video" : "image",
      isNew: true,
    }));
    setDraftMedia((prev) => [...prev, ...newItems]);
  };

  const removeMedia = (index) => {
    setDraftMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const addProduct = () => {
    setDraftProducts((prev) => [...prev, { name: "", price: "", notes: "" }]);
  };

  const removeProduct = (index) => {
    setDraftProducts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateProduct = (index, field, value) => {
    setDraftProducts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const saveEdit = async () => {
    if (!editAd) return;
    setSaving(true);
    try {
      // Upload new media
      const finalMedia = [];
      for (const m of draftMedia) {
        if (!m.isNew) {
          finalMedia.push(m.uri);
        } else {
          const url = await uploadAdMedia(m.uri, editAd.id);
          finalMedia.push(url);
        }
      }
      const validProds = draftProducts.filter((p) => String(p.name || "").trim());
      const patch = {
        title: draftTitle,
        description: draftDesc,
        date: draftDate,
        time: draftTime,
        end_date: draftEndDate || null,
        end_time: draftEndTime || null,
        location: draftLocation,
        postmediauri: finalMedia,
        product_types: validProds.map((p) => p.name.trim()),
        product_prices: validProds.map((p) => Number(p.price) || 0),
        product_notes: validProds.map((p) => p.notes),
      };
      const { error } = await supabase.from(POSTS_TABLE).update(patch).eq("id", editAd.id);
      if (error) throw error;
      setAds((prev) => prev.map((a) => a.id === editAd.id ? { ...a, ...patch } : a));
      setEditVisible(false);
    } catch (e) {
      Alert.alert("Error", "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  /* ── delete ── */
  const confirmDelete = (id) => { setDeleteId(id); setDeleteVisible(true); };
  const deleteAd = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from(POSTS_TABLE).delete().eq("id", deleteId);
      if (error) throw error;
      setAds((prev) => {
        const next = prev.filter((a) => a.id !== deleteId);
        if (selectedAdId === deleteId) setSelectedAdId(next[0]?.id || null);
        if (bcAdId === deleteId) setBcAdId(next[0]?.id || null);
        return next;
      });
    } catch {
      Alert.alert("Error", t("ad_error_delete"));
    } finally {
      setDeleteVisible(false);
      setDeleteId(null);
    }
  };

  /* ── computed totals ── */
  const totalViews     = ads.reduce((s, a) => s + (a.stats?.views     ?? 0), 0);
  const totalPurchases = ads.reduce((s, a) => s + (a.stats?.purchases ?? 0), 0);
  const totalContacts  = ads.reduce((s, a) => s + (a.stats?.contacts  ?? 0), 0);
  const selectedAd     = ads.find((a) => a.id === selectedAdId) || ads[0] || null;
  const bcAd           = ads.find((a) => a.id === bcAdId) || ads[0] || null;

  const fmtRate = (num, denom) =>
    denom > 0 ? (num / denom * 100).toFixed(1) + "%" : "—";

  const overallPurchaseRate = fmtRate(totalPurchases, totalViews);
  const overallInquiryRate  = fmtRate(totalContacts,  totalViews);
  const adPurchaseRate = selectedAd
    ? fmtRate(selectedAd.stats?.purchases ?? 0, selectedAd.stats?.views ?? 0) : "—";
  const adInquiryRate  = selectedAd
    ? fmtRate(selectedAd.stats?.contacts  ?? 0, selectedAd.stats?.views ?? 0) : "—";

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#111" : "#fff" }} />;

  /* ════════ OVERVIEW ════════════════════════════════════════════ */
  const renderOverview = () => (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_all_campaigns")}</Text>
      <View style={s.statRow}>
        <StatCard icon="percent"        label={t("ad_stat_buy_rate")}      value={overallPurchaseRate}          color="#2BB673" theme={theme} />
        <StatCard icon="message-circle" label={t("ad_stat_message_rate")}  value={overallInquiryRate}           color="#2F91FF" theme={theme} />
        <StatCard icon="award"          label={t("ad_stat_total_results")} value={totalPurchases + totalContacts} color="#FF9500" theme={theme} />
      </View>

      <View style={[s.summaryRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name="layers" size={15} color={theme.text} />
        <Text style={[s.summaryText, { color: theme.text }]}>
          {ads.length === 1
            ? t("ad_summary_one")
            : t("ad_summary_many").replace("{n}", ads.length)}
        </Text>
      </View>

      {ads.length > 0 && (
        <>
          <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 20 }]}>{t("ad_your_ads")}</Text>
          {ads.slice(0, 3).map((ad) => (
            <TouchableOpacity
              key={ad.id}
              style={[s.miniCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => { setSelectedAdId(ad.id); setActiveTab(1); }}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.miniTitle, { color: theme.text }]} numberOfLines={1}>
                  {ad.title || t("ad_untitled")}
                </Text>
                <Text style={[s.miniMeta, { color: theme.subtleText || "#8c97a8" }]}>
                  {ad.date || t("ad_no_date")}{ad.location ? ` · ${ad.location}` : ""}
                </Text>
              </View>
              <View style={s.miniStats}>
                <Feather name="percent" size={11} color="#2BB673" />
                <Text style={[s.miniStatNum, { color: "#2BB673" }]}> {fmtRate(ad.stats?.purchases ?? 0, ad.stats?.views ?? 0)}</Text>
                <Feather name="message-circle" size={11} color="#2F91FF" style={{ marginLeft: 10 }} />
                <Text style={[s.miniStatNum, { color: "#2F91FF" }]}> {fmtRate(ad.stats?.contacts ?? 0, ad.stats?.views ?? 0)}</Text>
              </View>
              <Feather name="chevron-right" size={15} color={theme.subtleText || "#8c97a8"} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          ))}
          {ads.length > 3 && (
            <TouchableOpacity onPress={() => setActiveTab(2)} style={s.seeAllBtn}>
              <Text style={s.seeAllText}>{t("ad_see_all").replace("{n}", ads.length)}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <TouchableOpacity style={s.createBtn} onPress={() => navigation.navigate("CreatePostScreen")} activeOpacity={0.85}>
        <Feather name="plus" size={16} color="#fff" style={{ marginRight: 8 }} />
        <Text style={s.createBtnText}>{t("ad_create_new")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  /* ════════ PERFORMANCE ════════════════════════════════════════ */
  const renderPerformance = () => {
    if (ads.length === 0) return renderEmpty("bar-chart-2", t("ad_no_performance_title"), t("ad_no_performance_body"));

    return (
      <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_viewing_ad")}</Text>
        <TouchableOpacity
          style={[s.picker, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => setAdPickerVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={[s.pickerText, { color: theme.text }]} numberOfLines={1}>
            {selectedAd?.title || t("ad_select_ad")}
          </Text>
          <Feather name="chevron-down" size={16} color={theme.subtleText || "#8c97a8"} />
        </TouchableOpacity>

        <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 18 }]}>{t("ad_results_label")}</Text>
        <View style={s.kpiGrid}>
          <View style={[s.kpiCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#2BB67318" }]}>
              <Feather name="percent" size={20} color="#2BB673" />
            </View>
            <Text style={[s.kpiValue, { color: "#2BB673" }]}>{adPurchaseRate}</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_stat_buy_rate")}</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>{t("ad_buy_rate_hint")}</Text>
          </View>
          <View style={[s.kpiCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#2F91FF18" }]}>
              <Feather name="message-circle" size={20} color="#2F91FF" />
            </View>
            <Text style={[s.kpiValue, { color: "#2F91FF" }]}>{adInquiryRate}</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_msg_rate_label")}</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>{t("ad_msg_rate_hint")}</Text>
          </View>
          <View style={[s.kpiCard, s.kpiCardLocked, { backgroundColor: isDark ? "#181818" : "#f7f7f7", borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#FF950018" }]}>
              <Feather name="tag" size={20} color="#FF9500" />
            </View>
            <Text style={[s.kpiValue, { color: theme.subtleText || "#bbb" }]}>—</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_cost_per_sale")}</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>{t("ad_cost_per_sale_hint")}</Text>
          </View>
          <View style={[s.kpiCard, s.kpiCardLocked, { backgroundColor: isDark ? "#181818" : "#f7f7f7", borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#FF950018" }]}>
              <Feather name="dollar-sign" size={20} color="#FF9500" />
            </View>
            <Text style={[s.kpiValue, { color: theme.subtleText || "#bbb" }]}>—</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_cost_per_inquiry")}</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>{t("ad_cost_per_inquiry_hint")}</Text>
          </View>
        </View>
        <View style={[s.lockedNote, { borderColor: theme.border, backgroundColor: isDark ? "#181818" : "#fafafa" }]}>
          <Feather name="lock" size={12} color={theme.subtleText || "#8c97a8"} />
          <Text style={[s.lockedNoteText, { color: theme.subtleText || "#8c97a8" }]}>
            {t("ad_locked_cost")}
          </Text>
        </View>

        {ads.length > 1 && (
          <>
            <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 20 }]}>{t("ad_compare_all")}</Text>
            <View style={[s.metricToggle, { backgroundColor: isDark ? "#1a1a1a" : "#f0f0f5", borderColor: theme.border }]}>
              {[
                { key: "purchases", label: t("ad_purchases") },
                { key: "contacts",  label: t("ad_inquiries") },
              ].map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[s.metricBtn, chartMetric === key && s.metricBtnActive]}
                  onPress={() => setChartMetric(key)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.metricBtnText, { color: chartMetric === key ? "#fff" : (theme.subtleText || "#8c97a8") }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[s.chartCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <BarChart ads={ads} metric={chartMetric} isDark={isDark} />
              {ads.every((a) => (a.stats?.[chartMetric] ?? 0) === 0) && (
                <Text style={[s.chartEmpty, { color: theme.subtleText || "#8c97a8" }]}>
                  {t("ad_chart_no_data")}
                </Text>
              )}
            </View>
          </>
        )}

      </ScrollView>
    );
  };

  /* ════════ MY ADS ═════════════════════════════════════════════ */
  const renderMyAds = () => {
    if (ads.length === 0) return renderEmpty("image", t("ad_no_ads_title"), t("ad_no_ads_body"));

    return (
      <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        {ads.map((ad) => (
          <View key={ad.id} style={[s.adCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={s.adCardTop}>
              <View style={{ flex: 1 }}>
                <Text style={[s.adTitle, { color: theme.text }]} numberOfLines={2}>
                  {ad.title || t("ad_untitled")}
                </Text>
                <Text style={[s.adMeta, { color: theme.subtleText || "#8c97a8" }]}>
                  {ad.date || t("ad_no_date")}{ad.location ? ` · ${ad.location}` : ""}
                </Text>
              </View>
              <View style={s.adBtns}>
                <TouchableOpacity
                  style={[s.adBtn, { backgroundColor: isDark ? "#1e2a3a" : "#EBF5FF" }]}
                  onPress={() => openEdit(ad)}
                  activeOpacity={0.85}
                >
                  <Feather name="edit-2" size={14} color="#2F91FF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.adBtn, { backgroundColor: isDark ? "#2a1a1a" : "#FFF0F0" }]}
                  onPress={() => confirmDelete(ad.id)}
                  activeOpacity={0.85}
                >
                  <Feather name="trash-2" size={14} color="#ff4d4f" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={[s.adStatsRow, { borderTopColor: theme.border }]}>
              <View style={s.adStat}>
                <Feather name="percent" size={12} color="#2BB673" />
                <Text style={[s.adStatVal, { color: "#2BB673" }]}> {fmtRate(ad.stats?.purchases ?? 0, ad.stats?.views ?? 0)}</Text>
                <Text style={[s.adStatLbl, { color: theme.subtleText || "#8c97a8" }]}> {t("ad_buy_rate_short")}</Text>
              </View>
              <View style={s.adStat}>
                <Feather name="message-circle" size={12} color="#2F91FF" />
                <Text style={[s.adStatVal, { color: "#2F91FF" }]}> {fmtRate(ad.stats?.contacts ?? 0, ad.stats?.views ?? 0)}</Text>
                <Text style={[s.adStatLbl, { color: theme.subtleText || "#8c97a8" }]}> {t("ad_msg_rate_short")}</Text>
              </View>
              <View style={s.adStat}>
                <Feather name="award" size={12} color="#FF9500" />
                <Text style={[s.adStatVal, { color: "#FF9500" }]}> {(ad.stats?.purchases ?? 0) + (ad.stats?.contacts ?? 0)}</Text>
                <Text style={[s.adStatLbl, { color: theme.subtleText || "#8c97a8" }]}> {t("ad_results_short")}</Text>
              </View>
              <TouchableOpacity
                style={s.viewPerfBtn}
                onPress={() => { setSelectedAdId(ad.id); setActiveTab(1); }}
                activeOpacity={0.8}
              >
                <Text style={s.viewPerfText}>{t("ad_details")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity style={s.createBtn} onPress={() => navigation.navigate("CreatePostScreen")} activeOpacity={0.85}>
          <Feather name="plus" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={s.createBtnText}>{t("ad_create_new")}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  /* ════════ BUYERS & CONTACTS ══════════════════════════════════ */
  const renderBuyersContacts = () => {
    if (ads.length === 0) return renderEmpty("users", "No ads yet", "Create an ad to see buyers and contacts here.");

    const msgUser = (username) => {
      if (!username) return;
      navigation.navigate("SingleChat", { chat: username, isGroup: false });
    };

    const fmtDate = (iso) => {
      if (!iso) return "";
      try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      } catch { return ""; }
    };

    const renderRequiredInfo = (info) => {
      if (!info || typeof info !== "object" || Array.isArray(info)) return null;
      const entries = Object.entries(info).filter(([, v]) => v != null && v !== "");
      if (entries.length === 0) return null;
      return (
        <View style={{ marginTop: 4, gap: 2 }}>
          {entries.map(([k, v]) => (
            <Text key={k} style={[s.bcInfoLine, { color: theme.subtleText || "#8c97a8" }]}>
              <Text style={{ fontFamily: "PoppinsBold", color: theme.text }}>{k}: </Text>
              {String(v)}
            </Text>
          ))}
        </View>
      );
    };

    return (
      <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        {/* Ad picker */}
        <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8" }]}>VIEWING AD</Text>
        <TouchableOpacity
          style={[s.picker, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => setBcPickerVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={[s.pickerText, { color: theme.text }]} numberOfLines={1}>
            {bcAd?.title || "Select ad"}
          </Text>
          <Feather name="chevron-down" size={16} color={theme.subtleText || "#8c97a8"} />
        </TouchableOpacity>

        {bcLoading ? (
          <ActivityIndicator color="#2F91FF" style={{ marginTop: 32 }} />
        ) : (
          <>
            {/* ── Buyers ── */}
            <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 20 }]}>
              BUYERS ({buyers.length})
            </Text>

            {buyers.length === 0 ? (
              <View style={[s.bcEmptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Feather name="shopping-bag" size={24} color={theme.subtleText || "#8c97a8"} />
                <Text style={[s.bcEmptyText, { color: theme.subtleText || "#8c97a8" }]}>
                  No purchases yet
                </Text>
              </View>
            ) : (
              buyers.map((b) => (
                <View key={b.id} style={[s.bcCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={[s.bcAvatar, { backgroundColor: "#2BB67320" }]}>
                    <Feather name="shopping-bag" size={16} color="#2BB673" />
                  </View>
                  <View style={{ flex: 1 }}>
                    {b.product_name ? (
                      <View style={s.bcBadgeRow}>
                        <View style={s.bcProductBadge}>
                          <Text style={s.bcProductBadgeText}>{b.product_name}</Text>
                        </View>
                      </View>
                    ) : null}
                    {renderRequiredInfo(b.required_info)}
                    <Text style={[s.bcDate, { color: theme.subtleText || "#8c97a8" }]}>
                      {fmtDate(b.purchased_at)}
                    </Text>
                  </View>
                  {b.buyer_username ? (
                    <TouchableOpacity
                      style={s.bcMsgBtn}
                      onPress={() => msgUser(b.buyer_username)}
                      activeOpacity={0.85}
                    >
                      <Feather name="message-circle" size={14} color="#fff" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}

            {/* ── Contacts ── */}
            <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 20 }]}>
              CONTACTS ({contacts.length})
            </Text>

            {contacts.length === 0 ? (
              <View style={[s.bcEmptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Feather name="message-circle" size={24} color={theme.subtleText || "#8c97a8"} />
                <Text style={[s.bcEmptyText, { color: theme.subtleText || "#8c97a8" }]}>
                  No contacts yet
                </Text>
              </View>
            ) : (
              contacts.map((c) => (
                <View key={c.id} style={[s.bcCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  {c.contacter_avatar ? (
                    <Image source={{ uri: c.contacter_avatar }} style={[s.bcAvatar, { borderRadius: 20 }]} />
                  ) : (
                    <View style={[s.bcAvatar, { backgroundColor: "#2F91FF20" }]}>
                      <Feather name="user" size={16} color="#2F91FF" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[s.bcUsername, { color: theme.text }]}>
                      {c.contacter_username ? `@${c.contacter_username}` : "Anonymous"}
                    </Text>
                    <Text style={[s.bcDate, { color: theme.subtleText || "#8c97a8" }]}>
                      {fmtDate(c.contacted_at)}
                    </Text>
                  </View>
                  {c.contacter_username ? (
                    <TouchableOpacity
                      style={s.bcMsgBtn}
                      onPress={() => msgUser(c.contacter_username)}
                      activeOpacity={0.85}
                    >
                      <Feather name="message-circle" size={14} color="#fff" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    );
  };

  /* ── empty state helper ── */
  const renderEmpty = (icon, title, body) => (
    <View style={s.emptyContainer}>
      <View style={[s.emptyIconWrap, { backgroundColor: isDark ? "#1a1a1a" : "#f5f5f5" }]}>
        <Feather name={icon} size={36} color={theme.subtleText || "#8c97a8"} />
      </View>
      <Text style={[s.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[s.emptyBody, { color: theme.subtleText || "#8c97a8" }]}>{body}</Text>
      <TouchableOpacity style={s.createBtn} onPress={() => navigation.navigate("CreatePostScreen")} activeOpacity={0.85}>
        <Feather name="plus" size={16} color="#fff" style={{ marginRight: 8 }} />
        <Text style={s.createBtnText}>Create first ad</Text>
      </TouchableOpacity>
    </View>
  );

  /* ════════ JSX ════════════════════════════════════════════════ */
  return (
    <ThemedView style={s.container}>
      <SafeAreaView style={s.safeArea}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: theme.text }]}>{t("ad_dashboard_title")}</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Tab bar */}
        <View style={[s.tabBar, { borderBottomColor: theme.border }]}>
          {TAB_KEYS.map((tabKey, i) => (
            <TouchableOpacity
              key={tabKey}
              style={s.tabItem}
              onPress={() => setActiveTab(i)}
              activeOpacity={0.8}
            >
              <Text style={[s.tabText, { color: activeTab === i ? "#2F91FF" : (theme.subtleText || "#8c97a8") }]}>
                {t(tabKey)}
              </Text>
              {activeTab === i && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color="#2F91FF" size="large" />
            <Text style={[s.loadingText, { color: theme.subtleText || "#8c97a8" }]}>{t("ad_loading")}</Text>
          </View>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            {activeTab === 0 && renderOverview()}
            {activeTab === 1 && renderPerformance()}
            {activeTab === 2 && renderMyAds()}
            {activeTab === 3 && renderBuyersContacts()}
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>

      {/* ── Edit modal (bottom sheet) ── */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <Pressable style={s.backdrop} onPress={() => setEditVisible(false)} />
          <View style={[s.editSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={s.editSheetHandle} />
            <View style={s.editSheetHeader}>
              <Text style={[s.editSheetTitle, { color: theme.text }]}>{t("ad_edit_title")}</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ── Basic fields ── */}
              {[
                { label: t("ad_title_label"),       value: draftTitle,    setter: setDraftTitle,    placeholder: "Ad title",              multiline: false },
                { label: t("ad_description_label"), value: draftDesc,     setter: setDraftDesc,     placeholder: "What's your ad about?", multiline: true  },
                { label: t("ad_date_label"),        value: draftDate,     setter: setDraftDate,     placeholder: "YYYY-MM-DD",            multiline: false },
                { label: t("ad_time_label"),        value: draftTime,     setter: setDraftTime,     placeholder: "HH:MM",                 multiline: false },
                { label: "End date",                value: draftEndDate,  setter: setDraftEndDate,  placeholder: "YYYY-MM-DD (optional)", multiline: false },
                { label: "End time",                value: draftEndTime,  setter: setDraftEndTime,  placeholder: "HH:MM (optional)",      multiline: false },
                { label: t("ad_location_label"),    value: draftLocation, setter: setDraftLocation, placeholder: "Where is it?",          multiline: false },
              ].map(({ label, value, setter, placeholder, multiline }) => (
                <View key={label}>
                  <Text style={[s.editLabel, { color: theme.text }]}>{label}</Text>
                  <View style={[s.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#1a1a1a" : "#f5f6fa" }]}>
                    <TextInput
                      value={value}
                      onChangeText={setter}
                      placeholder={placeholder}
                      placeholderTextColor={theme.subtleText || "#8c97a8"}
                      style={[s.input, { color: theme.text, height: multiline ? 80 : undefined }]}
                      multiline={multiline}
                    />
                  </View>
                </View>
              ))}

              {/* ── Media ── */}
              <Text style={[s.editLabel, { color: theme.text, marginTop: 12 }]}>Media</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {draftMedia.map((m, i) => (
                  <View key={i} style={s.mediaThumbnailWrap}>
                    <Image source={{ uri: m.uri }} style={s.mediaThumbnail} resizeMode="cover" />
                    {m.type === "video" && (
                      <View style={s.videoOverlay}>
                        <Feather name="film" size={14} color="#fff" />
                      </View>
                    )}
                    <TouchableOpacity style={s.mediaRemoveBtn} onPress={() => removeMedia(i)} activeOpacity={0.85}>
                      <Feather name="x" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  style={[s.mediaAddBtn, { backgroundColor: isDark ? "#1a1a1a" : "#f0f0f5", borderColor: theme.border }]}
                  onPress={pickMedia}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={22} color="#2F91FF" />
                  <Text style={[s.mediaAddText, { color: "#2F91FF" }]}>Add</Text>
                </TouchableOpacity>
              </ScrollView>

              {/* ── Products ── */}
              <Text style={[s.editLabel, { color: theme.text, marginTop: 12 }]}>Products</Text>
              {draftProducts.map((prod, i) => (
                <View key={i} style={[s.prodRow, { backgroundColor: isDark ? "#1a1a1a" : "#f8f9fc", borderColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <View style={[s.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#222" : "#fff", marginBottom: 6 }]}>
                      <TextInput
                        value={prod.name}
                        onChangeText={(v) => updateProduct(i, "name", v)}
                        placeholder="Product name"
                        placeholderTextColor={theme.subtleText || "#8c97a8"}
                        style={[s.input, { color: theme.text }]}
                      />
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={[s.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#222" : "#fff", flex: 1 }]}>
                        <TextInput
                          value={prod.price}
                          onChangeText={(v) => updateProduct(i, "price", v)}
                          placeholder="Price €"
                          placeholderTextColor={theme.subtleText || "#8c97a8"}
                          style={[s.input, { color: theme.text }]}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      <View style={[s.inputWrap, { borderColor: theme.border, backgroundColor: isDark ? "#222" : "#fff", flex: 2 }]}>
                        <TextInput
                          value={prod.notes}
                          onChangeText={(v) => updateProduct(i, "notes", v)}
                          placeholder="Notes"
                          placeholderTextColor={theme.subtleText || "#8c97a8"}
                          style={[s.input, { color: theme.text }]}
                        />
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={s.prodRemoveBtn}
                    onPress={() => removeProduct(i)}
                    activeOpacity={0.85}
                  >
                    <Feather name="trash-2" size={14} color="#ff4d4f" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={[s.addProdBtn, { backgroundColor: isDark ? "#1a1a1a" : "#EBF5FF", borderColor: "#2F91FF" }]}
                onPress={addProduct}
                activeOpacity={0.8}
              >
                <Feather name="plus" size={14} color="#2F91FF" />
                <Text style={[s.addProdText, { color: "#2F91FF" }]}>Add product</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.saveBtn, { opacity: saving ? 0.6 : 1, marginTop: 20 }]}
                onPress={saveEdit}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>{t("ad_save_changes")}</Text>
                }
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Ad picker modal (performance tab) ── */}
      <Modal visible={adPickerVisible} transparent animationType="fade" onRequestClose={() => setAdPickerVisible(false)}>
        <Pressable style={s.backdrop} onPress={() => setAdPickerVisible(false)} />
        <View style={[s.pickerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[s.pickerCardTitle, { color: theme.text }]}>{t("ad_select_ad")}</Text>
          <ScrollView>
            {ads.map((ad) => (
              <TouchableOpacity
                key={ad.id}
                style={[s.pickerRow, { borderBottomColor: theme.border },
                  selectedAdId === ad.id && { backgroundColor: isDark ? "#0d1f30" : "#EBF5FF" }
                ]}
                onPress={() => { setSelectedAdId(ad.id); setAdPickerVisible(false); }}
                activeOpacity={0.8}
              >
                <Text style={[s.pickerRowText, { color: theme.text }]} numberOfLines={1}>{ad.title || t("ad_untitled")}</Text>
                {selectedAdId === ad.id && <Feather name="check" size={16} color="#2F91FF" />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Ad picker modal (buyers & contacts tab) ── */}
      <Modal visible={bcPickerVisible} transparent animationType="fade" onRequestClose={() => setBcPickerVisible(false)}>
        <Pressable style={s.backdrop} onPress={() => setBcPickerVisible(false)} />
        <View style={[s.pickerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[s.pickerCardTitle, { color: theme.text }]}>Select ad</Text>
          <ScrollView>
            {ads.map((ad) => (
              <TouchableOpacity
                key={ad.id}
                style={[s.pickerRow, { borderBottomColor: theme.border },
                  bcAdId === ad.id && { backgroundColor: isDark ? "#0d1f30" : "#EBF5FF" }
                ]}
                onPress={() => {
                  setBcAdId(ad.id);
                  setBcPickerVisible(false);
                  loadBuyersContacts(ad.id);
                }}
                activeOpacity={0.8}
              >
                <Text style={[s.pickerRowText, { color: theme.text }]} numberOfLines={1}>{ad.title || t("ad_untitled")}</Text>
                {bcAdId === ad.id && <Feather name="check" size={16} color="#2F91FF" />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Delete confirm ── */}
      <Modal visible={deleteVisible} transparent animationType="fade" onRequestClose={() => setDeleteVisible(false)}>
        <Pressable style={s.backdrop} onPress={() => setDeleteVisible(false)} />
        <View style={[s.deleteCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={s.deleteIconWrap}>
            <Feather name="trash-2" size={28} color="#ff4d4f" />
          </View>
          <Text style={[s.deleteTitle, { color: theme.text }]}>{t("ad_delete_title")}</Text>
          <Text style={[s.deleteBody, { color: theme.subtleText || "#8c97a8" }]}>
            {t("ad_delete_body")}
          </Text>
          <View style={s.deleteRow}>
            <TouchableOpacity style={[s.deleteBtn, { backgroundColor: "#ff4d4f" }]} onPress={deleteAd} activeOpacity={0.9}>
              <Text style={s.deleteBtnText}>{t("ad_delete_confirm")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.deleteBtn, { backgroundColor: isDark ? "#2a2a2a" : "#f0f0f5" }]}
              onPress={() => setDeleteVisible(false)}
              activeOpacity={0.9}
            >
              <Text style={[s.deleteBtnText, { color: theme.text }]}>{t("ad_cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  safeArea:  { flex: 1 },

  /* Header */
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginTop: 4, marginBottom: 2 },
  backBtn:     { paddingRight: 8, paddingVertical: 4 },
  headerTitle: { flex: 1, fontFamily: "PoppinsBold", fontSize: 18, textAlign: "center" },

  /* Tab bar */
  tabBar:      { flexDirection: "row", borderBottomWidth: 1 },
  tabItem:     { flex: 1, alignItems: "center", paddingVertical: 10, position: "relative" },
  tabText:     { fontFamily: "PoppinsBold", fontSize: 11 },
  tabUnderline:{ position: "absolute", bottom: 0, left: 8, right: 8, height: 2, backgroundColor: "#2F91FF", borderRadius: 2 },

  /* Loading */
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { fontFamily: "Poppins", fontSize: 13, marginTop: 12 },

  /* Tab content */
  tabContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },

  /* Section labels */
  sectionLabel: { fontFamily: "PoppinsBold", fontSize: 10, letterSpacing: 1.2, marginBottom: 8 },

  /* Overview - stat row */
  statRow: { flexDirection: "row", marginBottom: 12 },

  /* Overview - summary pill */
  summaryRow:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  summaryText: { fontFamily: "Poppins", fontSize: 14 },

  /* Overview - mini ad cards */
  miniCard:    { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  miniTitle:   { fontFamily: "PoppinsBold", fontSize: 13 },
  miniMeta:    { fontFamily: "Poppins", fontSize: 11, marginTop: 1 },
  miniStats:   { flexDirection: "row", alignItems: "center", marginLeft: 8 },
  miniStatNum: { fontFamily: "PoppinsBold", fontSize: 12 },
  seeAllBtn:   { alignItems: "center", paddingVertical: 8 },
  seeAllText:  { fontFamily: "PoppinsBold", fontSize: 13, color: "#2F91FF" },

  /* Banner */
  banner:     { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, alignItems: "flex-start" },
  bannerText: { flex: 1, fontFamily: "Poppins", fontSize: 12, lineHeight: 18 },

  /* Create button */
  createBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#2F91FF", borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  createBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  /* Empty state */
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIconWrap:  { width: 80, height: 80, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle:     { fontFamily: "PoppinsBold", fontSize: 18, textAlign: "center" },
  emptyBody:      { fontFamily: "Poppins", fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8, marginBottom: 24 },

  /* Performance - ad picker */
  picker:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, padding: 14 },
  pickerText: { fontFamily: "PoppinsBold", fontSize: 14, flex: 1, marginRight: 8 },

  /* KPI cards */
  kpiGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard:       { width: "48%", borderWidth: 1, borderRadius: 14, padding: 10, alignItems: "center" },
  kpiCardLocked: { opacity: 0.65 },
  lockedNote:    { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 6 },
  lockedNoteText:{ fontFamily: "Poppins", fontSize: 11, flex: 1 },
  kpiIconWrap:   { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  kpiValue:      { fontFamily: "PoppinsBold", fontSize: 22 },
  kpiLabel:      { fontFamily: "PoppinsBold", fontSize: 11, textAlign: "center", marginTop: 2 },
  kpiHint:       { fontFamily: "Poppins", fontSize: 10, textAlign: "center", marginTop: 2 },

  /* Metric toggle */
  metricToggle:   { flexDirection: "row", borderRadius: 10, borderWidth: 1, overflow: "hidden", marginBottom: 10 },
  metricBtn:      { flex: 1, paddingVertical: 9, alignItems: "center" },
  metricBtnActive:{ backgroundColor: "#2F91FF" },
  metricBtnText:  { fontFamily: "PoppinsBold", fontSize: 12 },

  /* Chart card */
  chartCard:  { borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "center" },
  chartEmpty: { fontFamily: "Poppins", fontSize: 13, textAlign: "center", marginTop: 12, paddingBottom: 8 },

  /* My Ads - ad cards */
  adCard:    { borderWidth: 1, borderRadius: 14, marginBottom: 10, overflow: "hidden" },
  adCardTop: { flexDirection: "row", alignItems: "flex-start", padding: 14 },
  adTitle:   { fontFamily: "PoppinsBold", fontSize: 14 },
  adMeta:    { fontFamily: "Poppins", fontSize: 12, marginTop: 2 },
  adBtns:    { flexDirection: "row", gap: 8, marginLeft: 10 },
  adBtn:     { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  adStatsRow:{ flexDirection: "row", borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 14, alignItems: "center" },
  adStat:    { flexDirection: "row", alignItems: "center" },
  adStatVal: { fontFamily: "PoppinsBold", fontSize: 12 },
  adStatLbl: { fontFamily: "Poppins", fontSize: 12 },
  viewPerfBtn:  { marginLeft: "auto" },
  viewPerfText: { fontFamily: "PoppinsBold", fontSize: 12, color: "#2F91FF" },

  /* Buyers & Contacts */
  bcCard:       { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, gap: 10 },
  bcAvatar:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  bcUsername:   { fontFamily: "PoppinsBold", fontSize: 13 },
  bcDate:       { fontFamily: "Poppins", fontSize: 11, marginTop: 2 },
  bcInfoLine:   { fontFamily: "Poppins", fontSize: 12 },
  bcBadgeRow:   { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 4 },
  bcProductBadge:    { backgroundColor: "#2BB67318", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  bcProductBadgeText:{ fontFamily: "PoppinsBold", fontSize: 11, color: "#2BB673" },
  bcMsgBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: "#2F91FF", alignItems: "center", justifyContent: "center" },
  bcEmptyCard:  { borderWidth: 1, borderRadius: 12, padding: 20, alignItems: "center", gap: 8, marginBottom: 8 },
  bcEmptyText:  { fontFamily: "Poppins", fontSize: 13, textAlign: "center" },

  /* Edit sheet */
  backdrop:       { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  editSheet:      { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, maxHeight: "92%" },
  editSheetHandle:{ width: 40, height: 4, backgroundColor: "#ccc", borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  editSheetHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  editSheetTitle: { fontFamily: "PoppinsBold", fontSize: 16 },
  editLabel:      { fontFamily: "PoppinsBold", fontSize: 13, marginBottom: 4, marginTop: 12 },
  inputWrap:      { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input:          { fontFamily: "Poppins", fontSize: 14 },
  saveBtn:        { backgroundColor: "#2F91FF", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText:    { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

  /* Media picker */
  mediaThumbnailWrap: { marginRight: 8, position: "relative" },
  mediaThumbnail:     { width: 80, height: 80, borderRadius: 10 },
  videoOverlay:       { position: "absolute", bottom: 4, left: 4, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 4, padding: 3 },
  mediaRemoveBtn:     { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  mediaAddBtn:        { width: 80, height: 80, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  mediaAddText:       { fontFamily: "Poppins", fontSize: 11, marginTop: 2 },

  /* Products editor */
  prodRow:      { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  prodRemoveBtn:{ width: 32, height: 32, borderRadius: 8, backgroundColor: "#ff4d4f18", alignItems: "center", justifyContent: "center", marginTop: 4 },
  addProdBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderStyle: "dashed", borderRadius: 10, paddingVertical: 10, gap: 6, marginBottom: 4 },
  addProdText:  { fontFamily: "PoppinsBold", fontSize: 13 },

  /* Ad picker modal */
  pickerCard:     { position: "absolute", left: 24, right: 24, top: "30%", borderWidth: 1, borderRadius: 16, overflow: "hidden", maxHeight: "50%" },
  pickerCardTitle:{ fontFamily: "PoppinsBold", fontSize: 15, padding: 16, paddingBottom: 8 },
  pickerRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  pickerRowText:  { fontFamily: "Poppins", fontSize: 14, flex: 1, marginRight: 8 },

  /* Delete confirm */
  deleteCard:    { position: "absolute", left: 24, right: 24, top: "50%", transform: [{ translateY: -130 }], borderWidth: 1, borderRadius: 16, padding: 20, alignItems: "center" },
  deleteIconWrap:{ width: 60, height: 60, borderRadius: 16, backgroundColor: "#ff4d4f1a", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  deleteTitle:   { fontFamily: "PoppinsBold", fontSize: 16, textAlign: "center" },
  deleteBody:    { fontFamily: "Poppins", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 6 },
  deleteRow:     { flexDirection: "row", gap: 12, marginTop: 16 },
  deleteBtn:     { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  deleteBtnText: { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },
});
