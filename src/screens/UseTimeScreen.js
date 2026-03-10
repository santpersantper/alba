import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Switch,
  Modal,
  TextInput,
  Platform,
  Dimensions,
  PanResponder,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import Slider from "@react-native-community/slider";
import { useUserPreferences } from "../hooks/useUserPreferences";
import OnboardingOverlay from "../components/OnboardingOverlay";
import { useScreenTime } from "../hooks/useScreenTime";
import {
  evaluateStreak,
  evaluateWeekRollover,
  mergeDailyHistory,
  getLastSevenDays,
  computeStreakBackground,
  dateNDaysAgo,
  formatMinutes,
} from "../utils/streakUtils";

const { width: SW } = Dimensions.get("window");

// ── Color schemes ─────────────────────────────────────────────────────────────
const SCHEMES = {
  green: {
    bg: ["#00D36F", "#00B249"],
    text: "#fff",
    sub: "rgba(255,255,255,0.75)",
    card: "rgba(0,160,64,0.55)",
    cardBorder: "rgba(255,255,255,0.18)",
    barMet: "rgba(255,255,255,0.92)",
    barMissed: "rgba(255,100,100,0.85)",
    barEmpty: "rgba(255,255,255,0.25)",
    goalLine: "rgba(255,255,255,0.45)",
    circleMetBg: "#fff",
    circleMissedBg: "rgba(255,100,100,0.35)",
    circleEmptyBg: "transparent",
    circleBorder: "rgba(255,255,255,0.75)",
    checkColor: "#00D36F",
    crossColor: "#FF6B6B",
    changeText: "rgba(255,255,255,0.5)",
    divider: "rgba(255,255,255,0.2)",
    switchTrack: { false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.9)" },
    switchThumb: "#00B249",
    modalBtn: "#00B249",
  },
  red: {
    bg: ["#FF5252", "#B71C1C"],
    text: "#fff",
    sub: "rgba(255,255,255,0.75)",
    card: "rgba(160,0,0,0.45)",
    cardBorder: "rgba(255,255,255,0.18)",
    barMet: "rgba(255,255,255,0.5)",
    barMissed: "rgba(255,230,230,0.9)",
    barEmpty: "rgba(255,255,255,0.2)",
    goalLine: "rgba(255,255,255,0.45)",
    circleMetBg: "rgba(255,255,255,0.3)",
    circleMissedBg: "#fff",
    circleEmptyBg: "transparent",
    circleBorder: "rgba(255,255,255,0.75)",
    checkColor: "#FF5252",
    crossColor: "#fff",
    changeText: "rgba(255,255,255,0.5)",
    divider: "rgba(255,255,255,0.2)",
    switchTrack: { false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.8)" },
    switchThumb: "#B71C1C",
    modalBtn: "#FF5252",
  },
  white: {
    bg: ["#ffffff", "#f4f4f4"],
    text: "#1a1a1a",
    sub: "#666",
    card: "#f0f2f5",
    cardBorder: "#e0e0e0",
    barMet: "#00B249",
    barMissed: "#FF5252",
    barEmpty: "#ccc",
    goalLine: "rgba(0,178,73,0.45)",
    circleMetBg: "#00B249",
    circleMissedBg: "rgba(255,82,82,0.15)",
    circleEmptyBg: "transparent",
    circleBorder: "#ccc",
    checkColor: "#fff",
    crossColor: "#FF5252",
    changeText: "#aaa",
    divider: "#e0e0e0",
    switchTrack: { false: "#ddd", true: "#00B249" },
    switchThumb: "#fff",
    modalBtn: "#00B249",
  },
  yellow: {
    bg: ["#FFD740", "#FFA000"],
    text: "#1a1a1a",
    sub: "rgba(0,0,0,0.55)",
    card: "rgba(255,200,0,0.35)",
    cardBorder: "rgba(0,0,0,0.12)",
    barMet: "rgba(0,0,0,0.65)",
    barMissed: "#c62828",
    barEmpty: "rgba(0,0,0,0.18)",
    goalLine: "rgba(0,0,0,0.3)",
    circleMetBg: "#1a1a1a",
    circleMissedBg: "rgba(198,40,40,0.25)",
    circleEmptyBg: "transparent",
    circleBorder: "rgba(0,0,0,0.45)",
    checkColor: "#FFD740",
    crossColor: "#c62828",
    changeText: "rgba(0,0,0,0.35)",
    divider: "rgba(0,0,0,0.12)",
    switchTrack: { false: "rgba(0,0,0,0.2)", true: "rgba(0,0,0,0.5)" },
    switchThumb: "#1a1a1a",
    modalBtn: "#1a1a1a",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDailyGoalText(todayMin, goalMin) {
  if (goalMin == null) return null;
  const diff = goalMin - todayMin;
  if (diff > 0) return `You are ${formatMinutes(diff)} from your daily goal`;
  if (diff < 0) return `You are ${formatMinutes(-diff)} over your daily goal`;
  return "You've hit your daily goal exactly";
}

function getComparisonText(todayMin, compareMin, label) {
  if (compareMin == null || compareMin === 0) return null;
  const diff = todayMin - compareMin;
  const pct = Math.round((Math.abs(diff) / compareMin) * 100);
  if (diff < 0) return `You are ${pct}% below ${label}`;
  if (diff > 0) return `You are ${pct}% above ${label}`;
  return `Same as ${label}`;
}

function getDaysUntilWeekComplete(trackingStartDate) {
  if (!trackingStartDate) return 7;
  const start = new Date(trackingStartDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  const elapsed = Math.floor((today - start) / 86400000);
  return Math.max(0, 7 - elapsed);
}

function getMotivationalTitle(scheme, streakCount, daysLeft) {
  if (daysLeft > 0) {
    return `Building good habits 🎯`;
  }
  switch (scheme) {
    case "green":
      return streakCount >= 7
        ? "You're on fire! 🔥"
        : "Keep the streak going! 💚";
    case "red":
      return "Let's get back on track 💪";
    case "white":
      return "Good recovery! Keep going 💪";
    default:
      return "You're making progress! 🎯";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StreakCircles({ days, cs }) {
  return (
    <View style={cc.daysRow}>
      {days.map((day) => {
        const hasMet = day.metGoal === true;
        const hasMissed = day.metGoal === false;
        const circleBg = hasMet
          ? cs.circleMetBg
          : hasMissed
          ? cs.circleMissedBg
          : cs.circleEmptyBg;
        return (
          <View key={day.date} style={cc.dayItem}>
            <View
              style={[
                cc.dayCircle,
                { backgroundColor: circleBg, borderColor: cs.circleBorder },
              ]}
            >
              {hasMet && (
                <Feather name="check" size={14} color={cs.checkColor} />
              )}
              {hasMissed && (
                <Feather name="x" size={14} color={cs.crossColor} />
              )}
            </View>
            <Text style={[cc.dayLabel, { color: cs.text }]}>
              {day.dayName.slice(0, 2)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const BAR_MAX_H = 80;

function UsageHistogram({ days, dailyGoal, cs }) {
  const maxMin = Math.max(...days.map((d) => d.minutes ?? 0), dailyGoal ?? 0, 1);
  const goalLineBottom = dailyGoal
    ? Math.round((dailyGoal / maxMin) * BAR_MAX_H)
    : null;

  return (
    <View style={cc.histoWrap}>
      {/* Bars */}
      <View style={[cc.histoBars, { height: BAR_MAX_H + 20 }]}>
        {/* Goal line */}
        {goalLineBottom !== null && (
          <View
            style={[
              cc.goalLine,
              { bottom: goalLineBottom + 20, borderColor: cs.goalLine },
            ]}
          />
        )}
        {days.map((day) => {
          const h =
            day.minutes !== null
              ? Math.max(4, Math.round((day.minutes / maxMin) * BAR_MAX_H))
              : 4;
          const barBg =
            day.metGoal === true
              ? cs.barMet
              : day.metGoal === false
              ? cs.barMissed
              : cs.barEmpty;
          return (
            <View key={day.date} style={cc.histoBarCol}>
              {day.minutes !== null && (
                <Text style={[cc.histoVal, { color: cs.sub }]}>
                  {day.minutes < 60
                    ? `${day.minutes}m`
                    : `${Math.floor(day.minutes / 60)}h`}
                </Text>
              )}
              <View
                style={[
                  cc.histoBar,
                  {
                    height: h,
                    backgroundColor: barBg,
                    opacity: day.minutes !== null ? 1 : 0.3,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      {/* Labels */}
      <View style={cc.histoLabels}>
        {days.map((day) => (
          <View key={day.date} style={cc.histoLabelCol}>
            <Text style={[cc.histoLabel, { color: cs.sub }]}>
              {day.dayName.slice(0, 2)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CollapsibleAppList({ label, totalMinutes, appsData, cs }) {
  const [open, setOpen] = useState(true);
  const apps = Object.entries(appsData || {})
    .map(([name, data]) => ({ name, minutes: data?.minutes ?? 0 }))
    .filter((a) => a.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return (
    <View style={[cc.collCard, { backgroundColor: cs.card, borderColor: cs.cardBorder }]}>
      <TouchableOpacity
        style={cc.collHeader}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
      >
        <Text style={[cc.collLabel, { color: cs.text }]}>{label}</Text>
        <View style={cc.collRight}>
          <Text style={[cc.collTotal, { color: cs.text }]}>
            {formatMinutes(totalMinutes)}
          </Text>
          <Feather
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={cs.sub}
            style={{ marginLeft: 6 }}
          />
        </View>
      </TouchableOpacity>
      {open &&
        apps.map((app, i) => (
          <View
            key={app.name}
            style={[
              cc.collRow,
              i < apps.length - 1 && { borderBottomWidth: 1, borderBottomColor: cs.divider },
            ]}
          >
            <Text style={[cc.collAppName, { color: cs.text }]}>{app.name}</Text>
            <Text style={[cc.collAppTime, { color: cs.sub }]}>
              {formatMinutes(app.minutes)}
            </Text>
          </View>
        ))}
      {open && apps.length === 0 && (
        <Text style={[cc.collEmpty, { color: cs.sub }]}>No data yet</Text>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function UseTimeScreen() {
  const navigation = useNavigation();
  const { prefs, updatePrefs, loaded } = useUserPreferences();
  const {
    authorized,
    usageData,
    loading,
    error,
    requestAuthorization,
    startMonitoring,
    stopMonitoring,
  } = useScreenTime();

  // Goal modals
  const [goalModalType, setGoalModalType] = useState(null); // "weekly"|"daily"|null
  const [editReductionPct, setEditReductionPct] = useState(10);
  const [editDailyMax, setEditDailyMax] = useState(180);

  // Deactivation modal
  const [deactivateModalVisible, setDeactivateModalVisible] = useState(false);
  const [reasonAccomplished, setReasonAccomplished] = useState(false);
  const [reasonNoLonger, setReasonNoLonger] = useState(false);
  const [reasonOther, setReasonOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  // ── On authorization: record trackingStartDate ────────────────────────────
  const handleRequestAuthorization = useCallback(async () => {
    const ok = await requestAuthorization();
    if (ok && !prefs.trackingStartDate) {
      const today = new Date().toISOString().slice(0, 10);
      await updatePrefs({ trackingStartDate: today, trackingActive: true });
    }
  }, [requestAuthorization, prefs.trackingStartDate, updatePrefs]);

  // ── Merge usageData into dailyHistory on every poll ───────────────────────
  useEffect(() => {
    if (!usageData || !loaded) return;
    const updated = mergeDailyHistory(prefs.dailyHistory, usageData);
    // Only persist if something changed (avoid infinite loop)
    const prev = JSON.stringify(prefs.dailyHistory);
    if (JSON.stringify(updated) !== prev) {
      updatePrefs({ dailyHistory: updated });
    }
  }, [usageData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check first-week completion and auto-set goal ─────────────────────────
  useEffect(() => {
    if (!loaded || prefs.firstWeekComplete || !prefs.trackingStartDate) return;

    const daysLeft = getDaysUntilWeekComplete(prefs.trackingStartDate);
    if (daysLeft > 0) return;

    // 7 days elapsed — compute average from the first 7 entries
    const history = prefs.dailyHistory || [];
    const firstSevenEntries = history
      .filter((e) => e.date >= prefs.trackingStartDate)
      .slice(0, 7);

    if (firstSevenEntries.length < 7) return; // not enough data yet

    const totalMin = firstSevenEntries.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
    const avgDaily = Math.round(totalMin / 7);
    const reductionPct = prefs.screenTimeGoalReductionPercent ?? 10;
    const autoGoal = Math.max(15, Math.round(avgDaily * (1 - reductionPct / 100)));

    updatePrefs({
      firstWeekComplete: true,
      firstWeekAverageDailyMinutes: avgDaily,
      goalAutoSet: true,
      screenTimeGoalDailyMaxMinutes: autoGoal,
    });
  }, [loaded, prefs.trackingStartDate, prefs.dailyHistory, prefs.firstWeekComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Streak + week rollover evaluation (once per day) ─────────────────────
  useEffect(() => {
    if (!usageData || !loaded) return;
    const rollover = evaluateWeekRollover(
      usageData?.thisWeek?.totalMinutes ?? 0,
      usageData?.dailyTotals ?? {},
      prefs
    );
    const effectivePrefs = rollover ? { ...prefs, ...rollover } : prefs;
    const streakUpdates = evaluateStreak(usageData, effectivePrefs);
    const combined = { ...(rollover ?? {}), ...(streakUpdates ?? {}) };
    if (Object.keys(combined).length > 0) updatePrefs(combined);
  }, [usageData, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swipe-left to go back ─────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dy) < 10,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) navigation.goBack();
      },
    })
  ).current;

  // ── Derived values ────────────────────────────────────────────────────────
  const todayMinutes = usageData?.today?.totalMinutes ?? 0;
  const weekMinutes = usageData?.thisWeek?.totalMinutes ?? 0;
  const dailyGoal = prefs.firstWeekComplete
    ? (prefs.screenTimeGoalDailyMaxMinutes ?? 180)
    : null;
  const streakCount = prefs.currentStreakCount ?? 0;
  const firstWeekComplete = prefs.firstWeekComplete ?? false;
  const trackingActive = prefs.trackingActive !== false;
  const daysLeft = getDaysUntilWeekComplete(prefs.trackingStartDate);

  // Yesterday's data
  const yesterdayStr = dateNDaysAgo(1);
  const yesterdayEntry = (prefs.dailyHistory || []).find((e) => e.date === yesterdayStr);
  const yesterdayMinutes = yesterdayEntry?.minutes ?? null;
  const metYesterday = yesterdayMinutes !== null ? yesterdayMinutes <= (dailyGoal ?? Infinity) : true;

  // 7 days ago
  const sevenDaysAgoStr = dateNDaysAgo(7);
  const sevenDaysAgoEntry = (prefs.dailyHistory || []).find((e) => e.date === sevenDaysAgoStr);
  const sevenDaysAgoMinutes = sevenDaysAgoEntry?.minutes ?? null;
  const sevenDaysAgoDayName = sevenDaysAgoEntry
    ? new Date(sevenDaysAgoStr + "T12:00:00")
        .toLocaleDateString("en-US", { weekday: "long" })
    : "7 days ago";

  // Background scheme
  const scheme = computeStreakBackground({
    streakCount,
    todayMinutes,
    dailyGoal,
    metYesterday,
    firstWeekComplete,
  });
  const cs = SCHEMES[scheme];

  // Last 7 days for circles and histogram
  const lastSevenDays = getLastSevenDays(prefs.dailyHistory, dailyGoal);

  // Comparison sentences
  const vsYesterday = firstWeekComplete
    ? getComparisonText(todayMinutes, yesterdayMinutes, "yesterday")
    : null;
  const vs7Days = firstWeekComplete
    ? getComparisonText(todayMinutes, sevenDaysAgoMinutes, `last ${sevenDaysAgoDayName}`)
    : null;
  const vsGoal = firstWeekComplete ? getDailyGoalText(todayMinutes, dailyGoal) : null;

  // ── Deactivation handlers ─────────────────────────────────────────────────
  const handleToggleTracking = (value) => {
    if (!value) {
      // Toggling OFF — open reason modal
      setReasonAccomplished(false);
      setReasonNoLonger(false);
      setReasonOther(false);
      setOtherText("");
      setDeactivateModalVisible(true);
    } else {
      // Toggling back ON
      startMonitoring();
      updatePrefs({ trackingActive: true });
    }
  };

  const canConfirmDeactivation =
    reasonAccomplished || reasonNoLonger || (reasonOther && otherText.trim().length > 0);

  const handleConfirmDeactivation = async () => {
    await stopMonitoring();
    await updatePrefs({ trackingActive: false });
    setDeactivateModalVisible(false);
  };

  // ── Goal modal helpers ────────────────────────────────────────────────────
  const openWeeklyModal = () => {
    setEditReductionPct(prefs.screenTimeGoalReductionPercent ?? 10);
    setGoalModalType("weekly");
  };
  const openDailyModal = () => {
    setEditDailyMax(prefs.screenTimeGoalDailyMaxMinutes ?? 180);
    setGoalModalType("daily");
  };
  const handleSaveWeeklyGoal = () => {
    const updated = { screenTimeGoalReductionPercent: editReductionPct };
    const streakUpd = evaluateStreak(usageData, { ...prefs, ...updated });
    updatePrefs({ ...updated, ...(streakUpd ?? {}) });
    setGoalModalType(null);
  };
  const handleSaveDailyGoal = () => {
    const updated = { screenTimeGoalDailyMaxMinutes: editDailyMax };
    const streakUpd = evaluateStreak(usageData, { ...prefs, ...updated });
    updatePrefs({ ...updated, ...(streakUpd ?? {}) });
    setGoalModalType(null);
  };

  function fmtDailyGoal(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `Less than ${h}h a day`;
    return `Less than ${h}h ${m}min a day`;
  }

  // ── Skeleton ──────────────────────────────────────────────────────────────
  const renderSkeleton = () => (
    <View style={{ paddingTop: 24 }}>
      {[96, 60, 50, 140, 140].map((h, i) => (
        <View
          key={i}
          style={[s.skeleton, { height: h, marginBottom: i < 4 ? 20 : 0, width: i === 1 ? "70%" : "100%" }]}
        />
      ))}
    </View>
  );

  // ── Auth prompt ───────────────────────────────────────────────────────────
  const renderAuthPrompt = () => (
    <View style={[cc.card, { backgroundColor: cs.card, borderColor: cs.cardBorder, alignItems: "center", paddingVertical: 28 }]}>
      <Feather name="clock" size={40} color={cs.text} style={{ marginBottom: 12 }} />
      <Text style={[cc.cardTitle, { color: cs.text }]}>
        Allow Alba to track your social media time
      </Text>
      <Text style={[cc.cardBody, { color: cs.sub, marginBottom: 22 }]}>
        We use Apple's Screen Time framework on iOS{"\n"}and Usage Access on Android.{"\n"}Your data never leaves your device.
      </Text>
      <TouchableOpacity
        style={[s.enableBtn, { backgroundColor: cs.text }]}
        onPress={handleRequestAuthorization}
        activeOpacity={0.85}
      >
        <Text style={[s.enableBtnText, { color: scheme === "white" || scheme === "yellow" ? "#fff" : cs.card.replace("0.55", "1") }]}>
          Enable Screen Time
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={cs.bg}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={s.gradient}
      {...panResponder.panHandlers}
    >
      <StatusBar barStyle={scheme === "white" ? "dark-content" : "light-content"} />
      <SafeAreaView style={s.safeArea}>
        {/* Top nav row */}
        <View style={s.navRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={24} color={cs.text} />
          </TouchableOpacity>
          <Text style={[s.navTitle, { color: cs.text }]}>Screen Time</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {loading && !usageData ? (
            renderSkeleton()
          ) : (
            <>
              {/* ── Motivational header ── */}
              <Text style={[s.bigTitle, { color: cs.text }]}>
                {getMotivationalTitle(scheme, streakCount, daysLeft)}
              </Text>

              {!!error && (
                <Text style={[s.errorText, { color: cs.sub }]}>⚠ {error}</Text>
              )}

              {/* ── Auth prompt ── */}
              {authorized === false ? (
                renderAuthPrompt()
              ) : (
                <>
                  {/* ── OBSERVATION MODE (first 7 days) ── */}
                  {!firstWeekComplete && (
                    <View style={[cc.card, { backgroundColor: cs.card, borderColor: cs.cardBorder, marginBottom: 18 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                        <Feather name="eye" size={18} color={cs.text} style={{ marginRight: 8 }} />
                        <Text style={[cc.cardTitle, { color: cs.text }]}>Observation period</Text>
                      </View>
                      <Text style={[cc.cardBody, { color: cs.sub }]}>
                        {daysLeft > 0
                          ? `Alba is learning your habits. ${daysLeft} day${daysLeft !== 1 ? "s" : ""} until your personalised goal is set.`
                          : "Computing your first-week baseline…"}
                      </Text>
                    </View>
                  )}

                  {/* ── COMPARISON SENTENCES (post-week-1) ── */}
                  {firstWeekComplete && (vsYesterday || vs7Days || vsGoal) && (
                    <View style={s.comparisonsBlock}>
                      {vsYesterday && (
                        <Text style={[s.compLine, { color: cs.text }]}>
                          {vsYesterday}
                        </Text>
                      )}
                      {vs7Days && (
                        <Text style={[s.compLine, { color: cs.text }]}>
                          {vs7Days}
                        </Text>
                      )}
                      {vsGoal && (
                        <Text style={[s.compLineBold, { color: cs.text }]}>
                          {vsGoal}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* ── 7-DAY STREAK CIRCLES ── */}
                  <StreakCircles days={lastSevenDays} cs={cs} />

                  {/* ── 7-DAY HISTOGRAM ── */}
                  <UsageHistogram days={lastSevenDays} dailyGoal={dailyGoal} cs={cs} />

                  {/* ── GOALS (post-week-1) ── */}
                  {firstWeekComplete && (
                    <View style={s.goalsBlock}>
                      <Text style={[s.sectionTitle, { color: cs.text }]}>My current goals:</Text>
                      <View style={s.goalRow}>
                        <Text style={[s.goalText, { color: cs.text }]}>
                          {prefs.screenTimeGoalReductionPercent ?? 10}% reduction per week
                        </Text>
                        <TouchableOpacity onPress={openWeeklyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={[s.changeText, { color: cs.changeText }]}>Change</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={s.goalRow}>
                        <Text style={[s.goalText, { color: cs.text }]}>
                          {fmtDailyGoal(prefs.screenTimeGoalDailyMaxMinutes ?? 180)}
                        </Text>
                        <TouchableOpacity onPress={openDailyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={[s.changeText, { color: cs.changeText }]}>Change</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* ── COLLAPSIBLE APP LISTS ── */}
                  <CollapsibleAppList
                    label="Social media time today"
                    totalMinutes={todayMinutes}
                    appsData={usageData?.today?.apps}
                    cs={cs}
                  />
                  <CollapsibleAppList
                    label="Social media time this week"
                    totalMinutes={weekMinutes}
                    appsData={usageData?.thisWeek?.apps}
                    cs={cs}
                  />

                  {/* ── DEACTIVATION TOGGLE ── */}
                  <View style={[s.toggleRow, { borderTopColor: cs.divider }]}>
                    <View>
                      <Text style={[s.toggleLabel, { color: cs.text }]}>
                        {trackingActive ? "Tracking active" : "Tracking paused"}
                      </Text>
                      <Text style={[s.toggleSub, { color: cs.sub }]}>
                        {trackingActive
                          ? "Tap to deactivate"
                          : "Tap to re-enable tracking"}
                      </Text>
                    </View>
                    <Switch
                      value={trackingActive}
                      onValueChange={handleToggleTracking}
                      trackColor={cs.switchTrack}
                      thumbColor={cs.switchThumb}
                      ios_backgroundColor={cs.switchTrack.false}
                    />
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* ── Weekly reduction goal modal ── */}
      <Modal
        visible={goalModalType === "weekly"}
        transparent
        animationType="fade"
        onRequestClose={() => setGoalModalType(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.goalModalCard}>
            <Text style={s.goalModalTitle}>Weekly reduction goal</Text>
            <Text style={[s.goalModalValue, { color: cs.modalBtn }]}>
              {editReductionPct}% per week
            </Text>
            <Slider
              style={{ width: "100%", height: 40, marginVertical: 8 }}
              minimumValue={5}
              maximumValue={50}
              step={5}
              value={editReductionPct}
              onValueChange={(v) => setEditReductionPct(Math.round(v))}
              minimumTrackTintColor={cs.modalBtn}
              maximumTrackTintColor="#ddd"
              thumbTintColor={cs.modalBtn}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={s.sliderLabel}>5%</Text>
              <Text style={s.sliderLabel}>50%</Text>
            </View>
            <View style={s.goalModalBtns}>
              <TouchableOpacity style={s.goalModalCancelBtn} onPress={() => setGoalModalType(null)}>
                <Text style={s.goalModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.goalModalSaveBtn, { backgroundColor: cs.modalBtn }]} onPress={handleSaveWeeklyGoal}>
                <Text style={s.goalModalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Daily max goal modal ── */}
      <Modal
        visible={goalModalType === "daily"}
        transparent
        animationType="fade"
        onRequestClose={() => setGoalModalType(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.goalModalCard}>
            <Text style={s.goalModalTitle}>Daily maximum</Text>
            <View style={s.stepperRow}>
              <TouchableOpacity
                style={[s.stepperBtn, { backgroundColor: cs.modalBtn }]}
                onPress={() => setEditDailyMax((v) => Math.max(30, v - 15))}
              >
                <Text style={s.stepperText}>−</Text>
              </TouchableOpacity>
              <Text style={s.stepperValue}>{formatMinutes(editDailyMax)}</Text>
              <TouchableOpacity
                style={[s.stepperBtn, { backgroundColor: cs.modalBtn }]}
                onPress={() => setEditDailyMax((v) => Math.min(480, v + 15))}
              >
                <Text style={s.stepperText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.sliderLabel, { textAlign: "center", marginBottom: 20 }]}>
              30 min – 8 hours, in 15-minute steps
            </Text>
            <View style={s.goalModalBtns}>
              <TouchableOpacity style={s.goalModalCancelBtn} onPress={() => setGoalModalType(null)}>
                <Text style={s.goalModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.goalModalSaveBtn, { backgroundColor: cs.modalBtn }]} onPress={handleSaveDailyGoal}>
                <Text style={s.goalModalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Deactivation reason modal ── */}
      <Modal
        visible={deactivateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeactivateModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.deactivateCard}>
            <Text style={s.deactivateTitle}>Pause tracking?</Text>
            <Text style={s.deactivateSub}>
              Please let us know why you want to stop — it helps us improve Alba.
            </Text>

            {/* Checkbox 1 */}
            <TouchableOpacity
              style={s.checkRow}
              onPress={() => setReasonAccomplished((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={[s.checkbox, reasonAccomplished && s.checkboxChecked]}>
                {reasonAccomplished && <Feather name="check" size={13} color="#fff" />}
              </View>
              <Text style={s.checkLabel}>Already accomplished my goal</Text>
            </TouchableOpacity>

            {/* Checkbox 2 */}
            <TouchableOpacity
              style={s.checkRow}
              onPress={() => setReasonNoLonger((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={[s.checkbox, reasonNoLonger && s.checkboxChecked]}>
                {reasonNoLonger && <Feather name="check" size={13} color="#fff" />}
              </View>
              <Text style={s.checkLabel}>No longer want to reduce screen time</Text>
            </TouchableOpacity>

            {/* Checkbox 3 + optional text */}
            <TouchableOpacity
              style={s.checkRow}
              onPress={() => setReasonOther((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={[s.checkbox, reasonOther && s.checkboxChecked]}>
                {reasonOther && <Feather name="check" size={13} color="#fff" />}
              </View>
              <Text style={s.checkLabel}>Other</Text>
            </TouchableOpacity>
            {reasonOther && (
              <TextInput
                style={s.otherInput}
                placeholder="Tell us more…"
                placeholderTextColor="#aaa"
                value={otherText}
                onChangeText={setOtherText}
                multiline
                maxLength={300}
                textAlignVertical="top"
              />
            )}

            <View style={[s.goalModalBtns, { marginTop: 20 }]}>
              <TouchableOpacity
                style={s.goalModalCancelBtn}
                onPress={() => setDeactivateModalVisible(false)}
              >
                <Text style={s.goalModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.goalModalSaveBtn,
                  { backgroundColor: canConfirmDeactivation ? "#FF5252" : "#eee" },
                ]}
                onPress={canConfirmDeactivation ? handleConfirmDeactivation : undefined}
                activeOpacity={canConfirmDeactivation ? 0.8 : 1}
              >
                <Text
                  style={[
                    s.goalModalSaveText,
                    { color: canConfirmDeactivation ? "#fff" : "#bbb" },
                  ]}
                >
                  Confirm
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <OnboardingOverlay screenKey="usetime" />
    </LinearGradient>
  );
}

// ── Shared card/list styles (cc = component-level) ────────────────────────────
const cc = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 16,
  },
  cardTitle: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 6,
  },
  cardBody: {
    fontFamily: "Poppins",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  dayItem: { alignItems: "center" },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  dayLabel: { fontFamily: "Poppins", fontSize: 12 },
  histoWrap: { marginBottom: 20 },
  histoBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 0,
    position: "relative",
  },
  histoBarCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 20,
  },
  histoVal: { fontFamily: "Poppins", fontSize: 8, marginBottom: 2 },
  histoBar: { width: "65%", borderRadius: 3 },
  histoLabels: { flexDirection: "row" },
  histoLabelCol: { flex: 1, alignItems: "center" },
  histoLabel: { fontFamily: "Poppins", fontSize: 10 },
  goalLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  // Collapsible list
  collCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
  },
  collHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  collLabel: { fontFamily: "Poppins", fontWeight: "700", fontSize: 14, flex: 1 },
  collRight: { flexDirection: "row", alignItems: "center" },
  collTotal: { fontFamily: "Poppins", fontWeight: "700", fontSize: 20 },
  collRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  collAppName: { fontFamily: "Poppins", fontSize: 14 },
  collAppTime: { fontFamily: "Poppins", fontSize: 14 },
  collEmpty: { fontFamily: "Poppins", fontSize: 13, paddingHorizontal: 16, paddingBottom: 12 },
});

// ── Screen-level styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 12 : 4,
    paddingBottom: 4,
  },
  navTitle: { fontFamily: "Poppins", fontWeight: "700", fontSize: 16 },
  scroll: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 32 },
  bigTitle: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 32,
    marginTop: 12,
    marginBottom: 18,
    lineHeight: 40,
  },
  comparisonsBlock: { marginBottom: 20 },
  compLine: {
    fontFamily: "Poppins",
    fontSize: 18,
    fontWeight: "300",
    marginBottom: 4,
  },
  compLineBold: {
    fontFamily: "Poppins",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  errorText: { fontFamily: "Poppins", fontSize: 12, marginBottom: 12 },
  goalsBlock: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: "Poppins",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  goalText: { flex: 1, fontFamily: "Poppins", fontSize: 16 },
  changeText: { fontFamily: "Poppins", fontSize: 16, marginLeft: 10 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    marginTop: 8,
    borderTopWidth: 1,
    marginBottom: 8,
  },
  toggleLabel: { fontFamily: "Poppins", fontWeight: "700", fontSize: 16 },
  toggleSub: { fontFamily: "Poppins", fontSize: 12, marginTop: 2 },
  enableBtn: {
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  enableBtnText: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 15,
    color: "#00B249",
  },
  skeleton: {
    backgroundColor: "rgba(255,255,255,0.4)",
    borderRadius: 12,
    alignSelf: "stretch",
    marginBottom: 20,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  goalModalCard: {
    width: "86%",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 24,
  },
  goalModalTitle: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 18,
    color: "#1a1a1a",
    marginBottom: 6,
    textAlign: "center",
  },
  goalModalValue: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 26,
    textAlign: "center",
    marginBottom: 4,
  },
  sliderLabel: { fontFamily: "Poppins", fontSize: 12, color: "#999" },
  goalModalBtns: { flexDirection: "row", gap: 10 },
  goalModalCancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  goalModalCancelText: { fontFamily: "Poppins", fontSize: 15, color: "#888" },
  goalModalSaveBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  goalModalSaveText: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 15,
    color: "#fff",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginVertical: 16,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: { color: "#fff", fontSize: 24, fontWeight: "700", lineHeight: 28 },
  stepperValue: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 22,
    color: "#1a1a1a",
    minWidth: 90,
    textAlign: "center",
  },
  // Deactivation modal
  deactivateCard: {
    width: "88%",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 24,
  },
  deactivateTitle: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 20,
    color: "#1a1a1a",
    marginBottom: 8,
  },
  deactivateSub: {
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 20,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: "#1a1a1a",
    borderColor: "#1a1a1a",
  },
  checkLabel: {
    fontFamily: "Poppins",
    fontSize: 15,
    color: "#1a1a1a",
    flex: 1,
  },
  otherInput: {
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#1a1a1a",
    minHeight: 72,
    marginBottom: 4,
    marginLeft: 34,
  },
});
