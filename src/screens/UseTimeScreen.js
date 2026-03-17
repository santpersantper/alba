import React, { useState, useEffect, useRef, useCallback } from "react";
import {
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
  RefreshControl,
} from "react-native";
import * as Notifications from "expo-notifications";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import Slider from "@react-native-community/slider";
import { useUserPreferences } from "../hooks/useUserPreferences";
import OnboardingOverlay from "../components/OnboardingOverlay";
import { useScreenTime } from "../hooks/useScreenTime";
import { useAlbaLanguage } from "../theme/LanguageContext";
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

function getDailyGoalText(todayMin, goalMin, t) {
  if (goalMin == null) return null;
  const diff = goalMin - todayMin;
  if (diff > 0) return t("usetime_from_goal").replace("{time}", formatMinutes(diff));
  if (diff < 0) return t("usetime_over_goal").replace("{time}", formatMinutes(-diff));
  return t("usetime_hit_goal");
}

function getComparisonText(todayMin, compareMin, label, t) {
  if (compareMin == null || compareMin === 0) return null;
  const diff = todayMin - compareMin;
  const pct = Math.round((Math.abs(diff) / compareMin) * 100);
  if (diff < 0) return t("usetime_below_label").replace("{pct}", pct).replace("{label}", label);
  if (diff > 0) return t("usetime_above_label").replace("{pct}", pct).replace("{label}", label);
  return t("usetime_same_as").replace("{label}", label);
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

function getMotivationalTitle(scheme, streakCount, daysLeft, t) {
  if (daysLeft > 0) return t("usetime_building_habits");
  switch (scheme) {
    case "green":
      return streakCount >= 7 ? t("usetime_on_fire") : t("usetime_keep_streak");
    case "red":
      return t("usetime_back_on_track");
    case "white":
      return t("usetime_good_recovery");
    default:
      return t("usetime_making_progress");
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

function CollapsibleAppList({ label, totalMinutes, appsData, cs, noDataText = "No data yet" }) {
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
        <Text style={[cc.collEmpty, { color: cs.sub }]}>{noDataText}</Text>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function UseTimeScreen() {
  const navigation = useNavigation();
  const { t, language } = useAlbaLanguage();
  const { prefs, updatePrefs, loaded } = useUserPreferences();
  const {
    authorized,
    usageData,
    loading,
    error,
    requestAuthorization,
    requestAppSelection,
    startMonitoring,
    stopMonitoring,
  } = useScreenTime();

  const [refreshing, setRefreshing] = useState(false);

  // Goal modals
  const [goalModalType, setGoalModalType] = useState(null); // "weekly"|"daily"|null
  const [editReductionPct, setEditReductionPct] = useState(10);
  const [editDailyMax, setEditDailyMax] = useState(180);

  // Reset tracking modal
  const [resetModalVisible, setResetModalVisible] = useState(false);

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

  // ── Change tracked apps (re-opens FamilyActivityPicker) ──────────────────
  const handleChangeApps = useCallback(async () => {
    await requestAppSelection();
  }, [requestAppSelection]);

  // ── Reset all tracking data ───────────────────────────────────────────────
  const handleConfirmReset = useCallback(async () => {
    await stopMonitoring();
    await updatePrefs({
      trackingStartDate: null,
      trackingActive: false,
      firstWeekComplete: false,
      firstWeekAverageDailyMinutes: null,
      goalAutoSet: false,
      dailyHistory: [],
      currentStreakCount: 0,
      lastStreakUpdate: null,
      streakDays: { Mon: false, Tue: false, Wed: false, Thu: false, Fri: false, Sat: false, Sun: false },
      lastWeekTotalMinutes: 0,
      lastWeekDailyTotals: {},
      lastWeeklyReportDate: null,
    });
    setResetModalVisible(false);
  }, [stopMonitoring, updatePrefs]);

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
  // Compute totals from per-app data (sum of deduplicated entries) rather than
  // trusting totalMinutes from the native module, which can be inflated on Android
  // because queryUsageStats may return multiple overlapping records for the same package.
  const todayMinutes = Object.values(usageData?.today?.apps ?? {})
    .reduce((sum, app) => sum + (app?.minutes ?? 0), 0);
  const weekMinutes = Object.values(usageData?.thisWeek?.apps ?? {})
    .reduce((sum, app) => sum + (app?.minutes ?? 0), 0);
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
        .toLocaleDateString(language === "it" ? "it-IT" : "en-US", { weekday: "long" })
    : null;

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
  const yesterdayLabel = t("usetime_yesterday");
  const sevenDaysLabel = sevenDaysAgoDayName
    ? t("usetime_last_day").replace("{day}", sevenDaysAgoDayName)
    : null;
  const vsYesterday = firstWeekComplete
    ? getComparisonText(todayMinutes, yesterdayMinutes, yesterdayLabel, t)
    : null;
  const vs7Days = firstWeekComplete && sevenDaysLabel
    ? getComparisonText(todayMinutes, sevenDaysAgoMinutes, sevenDaysLabel, t)
    : null;
  const vsGoal = firstWeekComplete ? getDailyGoalText(todayMinutes, dailyGoal, t) : null;

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
    if (m === 0) return t("usetime_less_than_h").replace("{h}", h);
    return t("usetime_less_than_hm").replace("{h}", h).replace("{m}", m);
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // ── Screen Time local notifications ──────────────────────────────────────
  // Tracks which notifications have already been sent on the current day
  // to prevent repeat firings on every poll cycle.
  const notifSentRef = useRef({ date: null, warned: false, limitReached: false });

  // Warning + limit-reached notifications (fires on every todayMinutes update)
  useEffect(() => {
    if (!authorized || !dailyGoal || !loaded) return;
    if (prefs.screenTimeNotifsEnabled === false) return;

    const today = new Date().toISOString().slice(0, 10);
    if (notifSentRef.current.date !== today) {
      notifSentRef.current = { date: today, warned: false, limitReached: false };
    }

    const warningThreshold = prefs.screenTimeWarningMinutes ?? 10;
    const minutesLeft = dailyGoal - todayMinutes;

    // Warning: X minutes before the daily limit
    if (
      minutesLeft > 0 &&
      minutesLeft <= warningThreshold &&
      !notifSentRef.current.warned
    ) {
      notifSentRef.current.warned = true;
      Notifications.scheduleNotificationAsync({
        content: {
          title: "⏰ Screen Time Warning",
          body: `Only ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""} left before your daily limit.`,
          data: { type: "screen_time_warning" },
        },
        trigger: null,
      }).catch(() => {});
    }

    // Limit reached
    if (minutesLeft <= 0 && !notifSentRef.current.limitReached) {
      notifSentRef.current.limitReached = true;
      Notifications.scheduleNotificationAsync({
        content: {
          title: "🚫 Daily Limit Reached",
          body: `You've reached your daily screen time goal (${formatMinutes(todayMinutes)} used).`,
          data: { type: "screen_time_limit" },
        },
        trigger: null,
      }).catch(() => {});
    }
  }, [todayMinutes, dailyGoal, authorized, loaded, prefs.screenTimeNotifsEnabled, prefs.screenTimeWarningMinutes]);

  // Morning daily goal notification — fires once per day on app launch
  useEffect(() => {
    if (!authorized || !loaded || !firstWeekComplete) return;
    if (prefs.screenTimeNotifsEnabled === false) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    if (prefs.lastMorningNotifDate === todayStr) return; // already sent today

    updatePrefs({ lastMorningNotifDate: todayStr });

    const goalH = Math.floor((dailyGoal ?? 180) / 60);
    const goalM = (dailyGoal ?? 180) % 60;
    const goalStr = goalM === 0 ? `${goalH}h` : `${goalH}h ${goalM}min`;
    const streak = streakCount;

    let title: string;
    let notifBody: string;

    if (scheme === "green") {
      // On a streak — keep going messages
      const variants = [
        { title: "Keep going strong! 🔥", body: `Keep your scrolling time below ${goalStr} today to extend your ${streak}-day streak.` },
        { title: "Streak on! 💪", body: `${streak} days and counting. Stay under ${goalStr} today to keep it going.` },
        { title: "You're on a roll!", body: `Don't break the streak — stay under ${goalStr} of social media today.` },
      ];
      const pick = variants[streak % variants.length];
      title = pick.title;
      notifBody = pick.body;
    } else {
      // Off streak — restart messages
      const variants = [
        { title: "Time to start again 🌱", body: `Spend less than ${goalStr} on social media today to go back to your goal.` },
        { title: "Fresh start today!", body: `A new day, a new chance. Keep it under ${goalStr} today.` },
        { title: "You've got this 💙", body: `Aim for under ${goalStr} today and start rebuilding your streak.` },
      ];
      const pick = variants[new Date().getDay() % variants.length];
      title = pick.title;
      notifBody = pick.body;
    }

    Notifications.scheduleNotificationAsync({
      content: { title, body: notifBody, data: { type: "screen_time_morning" } },
      trigger: null,
    }).catch(() => {});
  }, [authorized, loaded, firstWeekComplete, prefs.screenTimeNotifsEnabled, prefs.lastMorningNotifDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weekly report notification: fires on Mondays once per week
  useEffect(() => {
    if (!authorized || !loaded || !firstWeekComplete) return;
    if (prefs.screenTimeNotifsEnabled === false) return;

    const today = new Date();
    if (today.getDay() !== 1) return; // 0=Sun, 1=Mon

    const todayStr = today.toISOString().slice(0, 10);
    if (prefs.lastWeeklyReportDate === todayStr) return; // already sent this Monday

    updatePrefs({ lastWeeklyReportDate: todayStr });

    const lastWeekMin = prefs.lastWeekTotalMinutes ?? 0;
    const thisWeekGoalMin = dailyGoal ? dailyGoal * 7 : null;
    const thisWeekGoalH = thisWeekGoalMin ? Math.floor(thisWeekGoalMin / 60) : null;
    const thisWeekGoalM = thisWeekGoalMin ? thisWeekGoalMin % 60 : null;
    const goalStr = thisWeekGoalH !== null
      ? (thisWeekGoalM === 0 ? `${thisWeekGoalH}h` : `${thisWeekGoalH}h ${thisWeekGoalM}min`)
      : null;

    let weekBody: string;
    if (lastWeekMin > 0 && prefs.prevWeekTotalMinutes != null) {
      const prev = prefs.prevWeekTotalMinutes as number;
      const diffPct = prev > 0 ? Math.round(((lastWeekMin - prev) / prev) * 100) : null;
      const direction = diffPct !== null ? (diffPct >= 0 ? `up ${Math.abs(diffPct)}%` : `down ${Math.abs(diffPct)}%`) : null;
      weekBody = direction && goalStr
        ? `Your social media use was ${direction} last week. New goal: ${goalStr} total this week. Keep going!`
        : goalStr
        ? `New goal: ${goalStr} total this week. Keep going!`
        : "Check your weekly screen time summary in the Use Time screen.";
    } else {
      weekBody = goalStr
        ? `New week, new goal: stay under ${goalStr} total. You can do it!`
        : "Check your weekly screen time summary in the Use Time screen.";
    }

    Notifications.scheduleNotificationAsync({
      content: {
        title: "Weekly report 📊",
        body: weekBody,
        data: { type: "screen_time_weekly" },
      },
      trigger: null,
    }).catch(() => {});
  }, [authorized, loaded, firstWeekComplete, prefs.screenTimeNotifsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {t("usetime_allow_track")}
      </Text>
      <Text style={[cc.cardBody, { color: cs.sub, marginBottom: 22 }]}>
        {t("usetime_ios_android")}
      </Text>
      <TouchableOpacity
        style={[s.enableBtn, { backgroundColor: cs.text }]}
        onPress={handleRequestAuthorization}
        activeOpacity={0.85}
      >
        <Text style={[s.enableBtnText, { color: scheme === "white" || scheme === "yellow" ? "#fff" : cs.card.replace("0.55", "1") }]}>
          {t("usetime_enable")}
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
      <SafeAreaView style={s.safeArea} edges={["top"]}>
        {/* Top nav row */}
        <View style={s.navRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={24} color={cs.text} />
          </TouchableOpacity>
          <Text style={[s.navTitle, { color: cs.text }]}>{t("usetime_title")}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.contentContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2F91FF" colors={["#2F91FF"]} />
          }
        >
          {loading && !usageData ? (
            renderSkeleton()
          ) : (
            <>
              {/* ── Motivational header ── */}
              <Text style={[s.bigTitle, { color: cs.text }]}>
                {getMotivationalTitle(scheme, streakCount, daysLeft, t)}
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
                        <Text style={[cc.cardTitle, { color: cs.text }]}>{t("usetime_observation_title")}</Text>
                      </View>
                      <Text style={[cc.cardBody, { color: cs.sub }]}>
                        {daysLeft > 0
                          ? (language === "it"
                              ? t("usetime_observation_days").replace("{n}", daysLeft).replace("{s}", daysLeft !== 1 ? "i" : "o")
                              : t("usetime_observation_days").replace("{n}", daysLeft).replace("{s}", daysLeft !== 1 ? "s" : ""))
                          : t("usetime_observation_computing")}
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
                      <Text style={[s.sectionTitle, { color: cs.text }]}>{t("usetime_my_goals")}</Text>
                      <View style={s.goalRow}>
                        <Text style={[s.goalText, { color: cs.text }]}>
                          {t("usetime_reduction_pct").replace("{n}", prefs.screenTimeGoalReductionPercent ?? 10)}
                        </Text>
                        <TouchableOpacity onPress={openWeeklyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={[s.changeText, { color: cs.changeText }]}>{t("usetime_change")}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={s.goalRow}>
                        <Text style={[s.goalText, { color: cs.text }]}>
                          {fmtDailyGoal(prefs.screenTimeGoalDailyMaxMinutes ?? 180)}
                        </Text>
                        <TouchableOpacity onPress={openDailyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={[s.changeText, { color: cs.changeText }]}>{t("usetime_change")}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* ── Notification settings ── */}
                      <View style={[s.goalRow, { marginTop: 6 }]}>
                        <Text style={[s.goalText, { color: cs.text }]}>Notifications</Text>
                        <Switch
                          value={prefs.screenTimeNotifsEnabled !== false}
                          onValueChange={(v) => updatePrefs({ screenTimeNotifsEnabled: v })}
                          trackColor={cs.switchTrack}
                          thumbColor={cs.switchThumb}
                          ios_backgroundColor={cs.switchTrack.false}
                        />
                      </View>
                      {prefs.screenTimeNotifsEnabled !== false && (
                        <View style={[s.goalRow, { marginTop: 2 }]}>
                          <Text style={[s.goalText, { color: cs.text, flex: 1 }]}>
                            Warn {prefs.screenTimeWarningMinutes ?? 10} min before limit
                          </Text>
                          <TouchableOpacity
                            onPress={() => {
                              const steps = [5, 10, 15, 20, 30];
                              const cur = prefs.screenTimeWarningMinutes ?? 10;
                              const idx = steps.indexOf(cur);
                              const next = steps[(idx + 1) % steps.length];
                              updatePrefs({ screenTimeWarningMinutes: next });
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={[s.changeText, { color: cs.changeText }]}>{t("usetime_change")}</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}

                  {/* ── COLLAPSIBLE APP LISTS ── */}
                  <CollapsibleAppList
                    label={t("usetime_social_today")}
                    totalMinutes={todayMinutes}
                    appsData={usageData?.today?.apps}
                    cs={cs}
                    noDataText={t("usetime_no_data")}
                  />
                  <CollapsibleAppList
                    label={t("usetime_social_week")}
                    totalMinutes={weekMinutes}
                    appsData={usageData?.thisWeek?.apps}
                    cs={cs}
                    noDataText={t("usetime_no_data")}
                  />

                  {/* ── MANAGE TRACKING ── */}
                  {authorized && (
                    <View style={[s.manageRow, { borderTopColor: cs.divider }]}>
                      <TouchableOpacity
                        style={[s.manageBtn, { borderColor: cs.divider }]}
                        onPress={handleChangeApps}
                        activeOpacity={0.75}
                      >
                        <Feather name="list" size={15} color={cs.text} style={{ marginRight: 6 }} />
                        <Text style={[s.manageBtnText, { color: cs.text }]}>Change Apps</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.manageBtn, { borderColor: cs.divider }]}
                        onPress={() => setResetModalVisible(true)}
                        activeOpacity={0.75}
                      >
                        <Feather name="refresh-ccw" size={15} color={cs.text} style={{ marginRight: 6 }} />
                        <Text style={[s.manageBtnText, { color: cs.text }]}>Reset Tracking</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* ── DEACTIVATION TOGGLE ── */}
                  <View style={[s.toggleRow, { borderTopColor: cs.divider }]}>
                    <View>
                      <Text style={[s.toggleLabel, { color: cs.text }]}>
                        {trackingActive ? t("usetime_tracking_active") : t("usetime_tracking_paused")}
                      </Text>
                      <Text style={[s.toggleSub, { color: cs.sub }]}>
                        {trackingActive ? t("usetime_tap_deactivate") : t("usetime_tap_reenable")}
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
            <Text style={s.goalModalTitle}>{t("usetime_weekly_goal_title")}</Text>
            <Text style={[s.goalModalValue, { color: cs.modalBtn }]}>
              {editReductionPct}{t("usetime_per_week")}
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
                <Text style={s.goalModalCancelText}>{t("cancel_button")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.goalModalSaveBtn, { backgroundColor: cs.modalBtn }]} onPress={handleSaveWeeklyGoal}>
                <Text style={s.goalModalSaveText}>{t("settings_save_changes")}</Text>
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
            <Text style={s.goalModalTitle}>{t("usetime_daily_max_title")}</Text>
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
              {t("usetime_steps_hint")}
            </Text>
            <View style={s.goalModalBtns}>
              <TouchableOpacity style={s.goalModalCancelBtn} onPress={() => setGoalModalType(null)}>
                <Text style={s.goalModalCancelText}>{t("cancel_button")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.goalModalSaveBtn, { backgroundColor: cs.modalBtn }]} onPress={handleSaveDailyGoal}>
                <Text style={s.goalModalSaveText}>{t("settings_save_changes")}</Text>
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
            <Text style={s.deactivateTitle}>{t("usetime_pause_title")}</Text>
            <Text style={s.deactivateSub}>
              {t("usetime_pause_sub")}
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
              <Text style={s.checkLabel}>{t("usetime_reason_accomplished")}</Text>
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
              <Text style={s.checkLabel}>{t("usetime_reason_no_longer")}</Text>
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
              <Text style={s.checkLabel}>{t("usetime_reason_other")}</Text>
            </TouchableOpacity>
            {reasonOther && (
              <TextInput
                style={s.otherInput}
                placeholder={t("usetime_other_placeholder")}
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
                <Text style={s.goalModalCancelText}>{t("cancel_button")}</Text>
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
                  {t("usetime_confirm")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Reset tracking confirmation modal ── */}
      <Modal
        visible={resetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setResetModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.deactivateCard}>
            <Text style={s.deactivateTitle}>Reset Tracking?</Text>
            <Text style={s.deactivateSub}>
              This will erase all your usage history, streak, and goals. You'll restart the 7-day observation period.
            </Text>
            <View style={[s.goalModalBtns, { marginTop: 24 }]}>
              <TouchableOpacity style={s.goalModalCancelBtn} onPress={() => setResetModalVisible(false)}>
                <Text style={s.goalModalCancelText}>{t("cancel_button")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.goalModalSaveBtn, { backgroundColor: "#FF5252" }]}
                onPress={handleConfirmReset}
              >
                <Text style={s.goalModalSaveText}>Reset</Text>
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
    fontFamily: "PoppinsBold",
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
  collLabel: { fontFamily: "PoppinsBold", fontSize: 14, flex: 1 },
  collRight: { flexDirection: "row", alignItems: "center" },
  collTotal: { fontFamily: "PoppinsBold", fontSize: 20 },
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
    paddingTop: 4,
    paddingBottom: 4,
  },
  navTitle: { fontFamily: "PoppinsBold", fontSize: 16 },
  scroll: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 32 },
  bigTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 32,
    marginTop: 12,
    marginBottom: 18,
    lineHeight: 40,
  },
  comparisonsBlock: { marginBottom: 20 },
  compLine: {
    fontFamily: "Poppins",
    fontSize: 18,
    marginBottom: 4,
  },
  compLineBold: {
    fontFamily: "PoppinsBold",
    fontSize: 18,
    marginBottom: 4,
  },
  errorText: { fontFamily: "Poppins", fontSize: 12, marginBottom: 12 },
  goalsBlock: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 18,
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
  toggleLabel: { fontFamily: "PoppinsBold", fontSize: 16 },
  toggleSub: { fontFamily: "Poppins", fontSize: 12, marginTop: 2 },
  enableBtn: {
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  enableBtnText: {
    fontFamily: "PoppinsBold",
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
    fontFamily: "PoppinsBold",
    fontSize: 18,
    color: "#1a1a1a",
    marginBottom: 6,
    textAlign: "center",
  },
  goalModalValue: {
    fontFamily: "PoppinsBold",
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
    fontFamily: "PoppinsBold",
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
    fontFamily: "PoppinsBold",
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
    fontFamily: "PoppinsBold",
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
  // Manage tracking buttons
  manageRow: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 16,
    marginTop: 6,
    borderTopWidth: 1,
    marginBottom: 6,
  },
  manageBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
  },
  manageBtnText: {
    fontFamily: "Poppins",
    fontSize: 13,
  },
});
