// screens/AdPublisherScreen.js — Ad Publisher Dashboard
/*
 * Tables used:
 *   posts       — id, title, description, date, time, location, user, type="Ad"
 *   ad_stats    — post_id, views, purchases, contacts
 *   profiles    — username
 */
import React, { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import Svg, { Rect, Text as SvgText, Line, G } from "react-native-svg";
import ThemedView from "../theme/ThemedView";
import { useAlbaTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";

const { width: SCREEN_W } = Dimensions.get("window");
const CHART_W = SCREEN_W - 64;
const CHART_H = 180;
const BAR_AREA_H = CHART_H - 36; // bottom 36px reserved for labels

const POSTS_TABLE = "posts";
const POSTS_COLS = "id, title, description, date, time, location, user";
const TABS = ["Overview", "Performance", "My Ads"];

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
              <SvgText
                x={x + barW / 2} y={y - 4}
                fontSize={9} fill={textColor} textAnchor="middle"
              >
                {values[i]}
              </SvgText>
            )}
            <SvgText
              x={x + barW / 2} y={BAR_AREA_H + 16}
              fontSize={9} fill={textColor} textAnchor="middle"
            >
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
  wrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    marginHorizontal: 4,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  value: { fontFamily: "PoppinsBold", fontSize: 22 },
  label: { fontFamily: "Poppins", fontSize: 11, textAlign: "center", marginTop: 2 },
});

/* ─── Main screen ───────────────────────────────────────────────── */
export default function AdPublisherScreen() {
  const navigation = useNavigation();
  const { theme, isDark } = useAlbaTheme();

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
  const [draftLocation, setDraftLocation] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete modal
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

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
      const { data, error } = await supabase
        .from(POSTS_TABLE)
        .select(POSTS_COLS)
        .eq("user", myUsername)
        .eq("type", "Ad")
        .order("date", { ascending: false })
        .order("time", { ascending: false })
        .limit(100);
      if (error) throw error;
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
    } catch (e) {
      console.warn("[AdPublisher] load error", e);
    } finally {
      setLoading(false);
    }
  }, [myUsername]);

  useFocusEffect(useCallback(() => { loadAds(); }, [loadAds]));
  useEffect(() => { loadAds(); }, [loadAds]);

  /* ── edit ── */
  const openEdit = (ad) => {
    setEditAd(ad);
    setDraftTitle(ad.title || "");
    setDraftDesc(ad.description || "");
    setDraftDate(ad.date || "");
    setDraftTime(String(ad.time || "").slice(0, 5));
    setDraftLocation(ad.location || "");
    setEditVisible(true);
  };

  const saveEdit = async () => {
    if (!editAd) return;
    const patch = {};
    if (draftTitle !== (editAd.title || "")) patch.title = draftTitle;
    if (draftDesc !== (editAd.description || "")) patch.description = draftDesc;
    if (draftDate !== (editAd.date || "")) patch.date = draftDate;
    if (draftTime !== String(editAd.time || "").slice(0, 5)) patch.time = draftTime;
    if (draftLocation !== (editAd.location || "")) patch.location = draftLocation;
    if (!Object.keys(patch).length) { setEditVisible(false); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from(POSTS_TABLE).update(patch).eq("id", editAd.id);
      if (error) throw error;
      setAds((prev) => prev.map((a) => a.id === editAd.id ? { ...a, ...patch } : a));
      setEditVisible(false);
    } catch {
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
        return next;
      });
    } catch {
      Alert.alert("Error", "Could not delete ad.");
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

  // Conversion rates (returns "X.X%" or "—" when no views yet)
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
      <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8" }]}>ALL CAMPAIGNS</Text>
      <View style={s.statRow}>
        <StatCard icon="percent"        label="Buy rate"      value={overallPurchaseRate}          color="#2BB673" theme={theme} />
        <StatCard icon="message-circle" label="Message rate"  value={overallInquiryRate}           color="#2F91FF" theme={theme} />
        <StatCard icon="award"          label="Total results" value={totalPurchases + totalContacts} color="#FF9500" theme={theme} />
      </View>

      <View style={[s.summaryRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name="layers" size={15} color={theme.text} />
        <Text style={[s.summaryText, { color: theme.text }]}>
          {"You have "}
          <Text style={s.summaryBold}>{ads.length}</Text>
          {" ad"}{ads.length !== 1 ? "s" : ""}{" active"}
        </Text>
      </View>

      {ads.length > 0 && (
        <>
          <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 20 }]}>YOUR ADS</Text>
          {ads.slice(0, 3).map((ad) => (
            <TouchableOpacity
              key={ad.id}
              style={[s.miniCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => { setSelectedAdId(ad.id); setActiveTab(1); }}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.miniTitle, { color: theme.text }]} numberOfLines={1}>
                  {ad.title || "Untitled ad"}
                </Text>
                <Text style={[s.miniMeta, { color: theme.subtleText || "#8c97a8" }]}>
                  {ad.date || "No date"}{ad.location ? ` · ${ad.location}` : ""}
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
              <Text style={s.seeAllText}>See all {ads.length} ads →</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <View style={[s.banner, { backgroundColor: isDark ? "#0d1f30" : "#EBF5FF", borderColor: "#59A7FF" }]}>
        <Feather name="info" size={14} color="#59A7FF" style={{ marginTop: 1 }} />
        <Text style={[s.bannerText, { color: isDark ? "#b3d9ff" : "#1a4a6e" }]}>
          {"On Alba, your ads reach real people nearby who've opted in — not anonymous strangers. Fewer impressions, much higher intent."}
        </Text>
      </View>

      <TouchableOpacity style={s.createBtn} onPress={() => navigation.navigate("CreatePostScreen")} activeOpacity={0.85}>
        <Feather name="plus" size={16} color="#fff" style={{ marginRight: 8 }} />
        <Text style={s.createBtnText}>Create new ad</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  /* ════════ PERFORMANCE ════════════════════════════════════════ */
  const renderPerformance = () => {
    if (ads.length === 0) return renderEmpty("bar-chart-2", "No performance data yet", "Create your first ad to start tracking views, purchases, and inquiries.");

    return (
      <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        {/* Ad picker */}
        <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8" }]}>VIEWING AD</Text>
        <TouchableOpacity
          style={[s.picker, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => setAdPickerVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={[s.pickerText, { color: theme.text }]} numberOfLines={1}>
            {selectedAd?.title || "Select an ad"}
          </Text>
          <Feather name="chevron-down" size={16} color={theme.subtleText || "#8c97a8"} />
        </TouchableOpacity>

        {/* KPI cards — 2×2 grid */}
        <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 18 }]}>RESULTS</Text>
        <View style={s.kpiGrid}>
          {/* Row 1: conversion rates */}
          <View style={[s.kpiCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#2BB67318" }]}>
              <Feather name="percent" size={20} color="#2BB673" />
            </View>
            <Text style={[s.kpiValue, { color: "#2BB673" }]}>{adPurchaseRate}</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>Buy rate</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>Viewers who purchased</Text>
          </View>
          <View style={[s.kpiCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#2F91FF18" }]}>
              <Feather name="message-circle" size={20} color="#2F91FF" />
            </View>
            <Text style={[s.kpiValue, { color: "#2F91FF" }]}>{adInquiryRate}</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>Message rate</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>Viewers who messaged</Text>
          </View>
          {/* Row 2: cost cards — unlocked once budget tracking is added */}
          <View style={[s.kpiCard, s.kpiCardLocked, { backgroundColor: isDark ? "#181818" : "#f7f7f7", borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#FF950018" }]}>
              <Feather name="tag" size={20} color="#FF9500" />
            </View>
            <Text style={[s.kpiValue, { color: theme.subtleText || "#bbb" }]}>—</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>Cost per sale</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>Spend ÷ purchases</Text>
          </View>
          <View style={[s.kpiCard, s.kpiCardLocked, { backgroundColor: isDark ? "#181818" : "#f7f7f7", borderColor: theme.border }]}>
            <View style={[s.kpiIconWrap, { backgroundColor: "#FF950018" }]}>
              <Feather name="dollar-sign" size={20} color="#FF9500" />
            </View>
            <Text style={[s.kpiValue, { color: theme.subtleText || "#bbb" }]}>—</Text>
            <Text style={[s.kpiLabel, { color: theme.subtleText || "#8c97a8" }]}>Cost per inquiry</Text>
            <Text style={[s.kpiHint,  { color: theme.subtleText || "#8c97a8" }]}>Spend ÷ messages</Text>
          </View>
        </View>
        <View style={[s.lockedNote, { borderColor: theme.border, backgroundColor: isDark ? "#181818" : "#fafafa" }]}>
          <Feather name="lock" size={12} color={theme.subtleText || "#8c97a8"} />
          <Text style={[s.lockedNoteText, { color: theme.subtleText || "#8c97a8" }]}>
            Cost metrics will unlock once budget tracking is added to your campaigns.
          </Text>
        </View>

        {/* Chart comparing all ads */}
        {ads.length > 1 && (
          <>
            <Text style={[s.sectionLabel, { color: theme.subtleText || "#8c97a8", marginTop: 20 }]}>COMPARE ALL ADS</Text>
            <View style={[s.metricToggle, { backgroundColor: isDark ? "#1a1a1a" : "#f0f0f5", borderColor: theme.border }]}>
              {[
                { key: "purchases", label: "Purchases" },
                { key: "contacts",  label: "Inquiries" },
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
                  No data yet — this will fill in as people interact with your ads.
                </Text>
              )}
            </View>
          </>
        )}

        <View style={[s.banner, { backgroundColor: isDark ? "#0d1f30" : "#EBF5FF", borderColor: "#59A7FF", marginTop: 20 }]}>
          <Feather name="info" size={14} color="#59A7FF" style={{ marginTop: 1 }} />
          <Text style={[s.bannerText, { color: isDark ? "#b3d9ff" : "#1a4a6e" }]}>
            {"On Alba, ads reach opted-in users nearby — not the entire internet. Expect lower numbers but significantly higher intent and relevance."}
          </Text>
        </View>
      </ScrollView>
    );
  };

  /* ════════ MY ADS ═════════════════════════════════════════════ */
  const renderMyAds = () => {
    if (ads.length === 0) return renderEmpty("image", "No ads yet", "Create your first campaign to start reaching locals in your area.");

    return (
      <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        {ads.map((ad) => (
          <View key={ad.id} style={[s.adCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={s.adCardTop}>
              <View style={{ flex: 1 }}>
                <Text style={[s.adTitle, { color: theme.text }]} numberOfLines={2}>
                  {ad.title || "Untitled ad"}
                </Text>
                <Text style={[s.adMeta, { color: theme.subtleText || "#8c97a8" }]}>
                  {ad.date || "No date"}{ad.location ? ` · ${ad.location}` : ""}
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
                <Text style={[s.adStatLbl, { color: theme.subtleText || "#8c97a8" }]}> buy rate</Text>
              </View>
              <View style={s.adStat}>
                <Feather name="message-circle" size={12} color="#2F91FF" />
                <Text style={[s.adStatVal, { color: "#2F91FF" }]}> {fmtRate(ad.stats?.contacts ?? 0, ad.stats?.views ?? 0)}</Text>
                <Text style={[s.adStatLbl, { color: theme.subtleText || "#8c97a8" }]}> msg rate</Text>
              </View>
              <View style={s.adStat}>
                <Feather name="award" size={12} color="#FF9500" />
                <Text style={[s.adStatVal, { color: "#FF9500" }]}> {(ad.stats?.purchases ?? 0) + (ad.stats?.contacts ?? 0)}</Text>
                <Text style={[s.adStatLbl, { color: theme.subtleText || "#8c97a8" }]}> results</Text>
              </View>
              <TouchableOpacity
                style={s.viewPerfBtn}
                onPress={() => { setSelectedAdId(ad.id); setActiveTab(1); }}
                activeOpacity={0.8}
              >
                <Text style={s.viewPerfText}>Details →</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity style={s.createBtn} onPress={() => navigation.navigate("CreatePostScreen")} activeOpacity={0.85}>
          <Feather name="plus" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={s.createBtnText}>Create new ad</Text>
        </TouchableOpacity>
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
          <Text style={[s.headerTitle, { color: theme.text }]}>Ad Dashboard</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Tab bar */}
        <View style={[s.tabBar, { borderBottomColor: theme.border }]}>
          {TABS.map((tab, i) => (
            <TouchableOpacity
              key={tab}
              style={s.tabItem}
              onPress={() => setActiveTab(i)}
              activeOpacity={0.8}
            >
              <Text style={[s.tabText, { color: activeTab === i ? "#2F91FF" : (theme.subtleText || "#8c97a8") }]}>
                {tab}
              </Text>
              {activeTab === i && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color="#2F91FF" size="large" />
            <Text style={[s.loadingText, { color: theme.subtleText || "#8c97a8" }]}>Loading your ads…</Text>
          </View>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            {activeTab === 0 && renderOverview()}
            {activeTab === 1 && renderPerformance()}
            {activeTab === 2 && renderMyAds()}
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
              <Text style={[s.editSheetTitle, { color: theme.text }]}>Edit ad</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {[
                { label: "Title",       value: draftTitle,    setter: setDraftTitle,    placeholder: "Ad title",           multiline: false },
                { label: "Description", value: draftDesc,     setter: setDraftDesc,     placeholder: "What's your ad about?", multiline: true  },
                { label: "Date",        value: draftDate,     setter: setDraftDate,     placeholder: "YYYY-MM-DD",         multiline: false },
                { label: "Time",        value: draftTime,     setter: setDraftTime,     placeholder: "HH:MM",              multiline: false },
                { label: "Location",    value: draftLocation, setter: setDraftLocation, placeholder: "Where is it?",       multiline: false },
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
              <TouchableOpacity
                style={[s.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                onPress={saveEdit}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>Save changes</Text>
                }
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Ad picker modal ── */}
      <Modal visible={adPickerVisible} transparent animationType="fade" onRequestClose={() => setAdPickerVisible(false)}>
        <Pressable style={s.backdrop} onPress={() => setAdPickerVisible(false)} />
        <View style={[s.pickerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[s.pickerCardTitle, { color: theme.text }]}>Select an ad</Text>
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
                <Text style={[s.pickerRowText, { color: theme.text }]} numberOfLines={1}>{ad.title || "Untitled ad"}</Text>
                {selectedAdId === ad.id && <Feather name="check" size={16} color="#2F91FF" />}
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
          <Text style={[s.deleteTitle, { color: theme.text }]}>Delete this ad?</Text>
          <Text style={[s.deleteBody, { color: theme.subtleText || "#8c97a8" }]}>
            This will permanently remove the ad and all its stats. This cannot be undone.
          </Text>
          <View style={s.deleteRow}>
            <TouchableOpacity style={[s.deleteBtn, { backgroundColor: "#ff4d4f" }]} onPress={deleteAd} activeOpacity={0.9}>
              <Text style={s.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.deleteBtn, { backgroundColor: isDark ? "#2a2a2a" : "#f0f0f5" }]}
              onPress={() => setDeleteVisible(false)}
              activeOpacity={0.9}
            >
              <Text style={[s.deleteBtnText, { color: theme.text }]}>Cancel</Text>
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
  tabBar:      { flexDirection: "row", borderBottomWidth: 1, marginBottom: 0 },
  tabItem:     { flex: 1, alignItems: "center", paddingVertical: 10, position: "relative" },
  tabText:     { fontFamily: "PoppinsBold", fontSize: 13 },
  tabUnderline:{ position: "absolute", bottom: 0, left: 16, right: 16, height: 2, backgroundColor: "#2F91FF", borderRadius: 2 },

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
  summaryBold: { fontFamily: "PoppinsBold" },

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
  kpiRow:        { flexDirection: "row", gap: 8 },
  kpiGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard:       { width: "48%", borderWidth: 1, borderRadius: 14, padding: 10, alignItems: "center" },
  kpiCardLocked: { opacity: 0.65 },
  lockedNote:    { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 6 },
  lockedNoteText:{ fontFamily: "Poppins", fontSize: 11, flex: 1 },
  kpiIconWrap:{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  kpiValue:   { fontFamily: "PoppinsBold", fontSize: 22 },
  kpiLabel:   { fontFamily: "PoppinsBold", fontSize: 11, textAlign: "center", marginTop: 2 },
  kpiHint:    { fontFamily: "Poppins", fontSize: 10, textAlign: "center", marginTop: 2 },

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

  /* Edit sheet */
  backdrop:       { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  editSheet:      { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, maxHeight: "88%" },
  editSheetHandle:{ width: 40, height: 4, backgroundColor: "#ccc", borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  editSheetHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  editSheetTitle: { fontFamily: "PoppinsBold", fontSize: 16 },
  editLabel:      { fontFamily: "PoppinsBold", fontSize: 13, marginBottom: 4, marginTop: 12 },
  inputWrap:      { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input:          { fontFamily: "Poppins", fontSize: 14 },
  saveBtn:        { backgroundColor: "#2F91FF", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  saveBtnText:    { fontFamily: "PoppinsBold", fontSize: 14, color: "#fff" },

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
