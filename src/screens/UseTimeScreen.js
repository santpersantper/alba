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
import AndroidAppSelectorModal from "../components/AndroidAppSelectorModal";
import { useScreenTime } from "../hooks/useScreenTime";
import { useAlbaLanguage } from "../theme/LanguageContext";
import {
  evaluateStreak,
  evaluateWeekRollover,
  mergeDailyHistory,
  getLastSevenDays,
  computeStreakBackground,
  formatMinutes,
} from "../utils/streakUtils";

const { width: SW } = Dimensions.get("window");

// ── iOS mindfulness notification variants (no usage data needed) ──────────────
const IOS_MINDFUL_NOTIFS = [
  { title: "Quick check-in 💚",                    body: "Are you scrolling with purpose right now?" },
  { title: "Protect your screen time streak 🔥",   body: "One good day at a time. You've got this." },
  { title: "Pause & reflect ✨",                    body: "Your screen time goals are worth more than a quick scroll." },
  { title: "Mindful reminder 🧘",                  body: "Take a breath. Put the phone down. The world's still there." },
  { title: "Your screen time streak matters 💪",   body: "Screen time streaks aren't built in a day — but they're broken in minutes. Stay focused." },
  { title: "You're in control 🎯",                 body: "Be the one in charge of your screen time today." },
  { title: "Building a habit 🌱",                  body: "Small screen time choices add up. Every minute offline matters." },
  { title: "Keep it going 🏆",                     body: "Every day under your screen time goal is a win. Are you on track?" },
  { title: "Stay on track ⚡",                     body: "Your discipline brought your screen time streak this far. Don't let a scroll break it." },
  { title: "Less screen, more life 💫",            body: "You've been building great habits. Keep going!" },
  { title: "Halfway check-in ☀️",                  body: "Your best days start with intentional screen time choices. How's today going?" },
  { title: "Progress, not perfection 🌿",          body: "Your screen time goal isn't about perfection — it's about progress. You're doing it." },
  { title: "One decision at a time 🔥",            body: "Keeping your screen time streak alive takes one good decision. Make it now." },
  { title: "Intentional living 💚",                body: "A few mindful minutes offline can go a long way today." },
  { title: "Your habit is real 🙌",                body: "You're building a healthier relationship with your phone. Keep it up." },
  { title: "Check in with yourself 🤔",            body: "How do you feel about your phone use so far today?" },
  { title: "Step away for a bit 🧘",               body: "Even 10 minutes offline can reset your focus. Try it." },
  { title: "You set a screen time goal 🎯",        body: "Today is a chance to hit it. Go for it!" },
  { title: "Mindful moment 🌱",                    body: "Every moment spent mindfully is a step toward your screen time goals." },
  { title: "Streak builder 💪",                    body: "Your screen time streak reflects your discipline. Protect it — you've earned it." },
  { title: "Small wins add up ⚡",                 body: "One more day under your screen time goal is one more day of progress." },
];

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

function DailyProgressBar({ todayMin, goalMin, cs }) {
  if (!goalMin) return null;
  const pct = Math.min(1, todayMin / goalMin);
  const overGoal = todayMin > goalMin;
  const fillColor = overGoal ? cs.barMissed : cs.barMet;
  return (
    <View style={cc.progressWrap}>
      <View style={[cc.progressTrack, { backgroundColor: cs.barEmpty }]}>
        <View style={[cc.progressFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: fillColor }]} />
      </View>
      <View style={cc.progressRow}>
        <Text style={[cc.progressLabel, { color: cs.sub }]}>{formatMinutes(todayMin)}</Text>
        <Text style={[cc.progressLabel, { color: cs.sub }]}>{formatMinutes(goalMin)}</Text>
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
    getInstalledApps,
    setTrackedApps,
    presentReport,
    setReportStyle,
    startMonitoring,
    stopMonitoring,
    refreshUsageData,
  } = useScreenTime();

  const [refreshing, setRefreshing] = useState(false);

  // Goal modals
  const [goalModalType, setGoalModalType] = useState(null); // "weekly"|"daily"|null
  const [editReductionPct, setEditReductionPct] = useState(10);
  const [editDailyMax, setEditDailyMax] = useState(180);

  // Android app selector modal
  const [androidAppSelectorVisible, setAndroidAppSelectorVisible] = useState(false);

  // Reset tracking modal
  const [resetModalVisible, setResetModalVisible] = useState(false);

  // Deactivation modal
  const [deactivateModalVisible, setDeactivateModalVisible] = useState(false);
  const [reasonAccomplished, setReasonAccomplished] = useState(false);
  const [reasonNoLonger, setReasonNoLonger] = useState(false);
  const [reasonOther, setReasonOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  // ── On authorization: record trackingStartDate ────────────────────────────
  // On Android, don't mark appsSelected yet — user still needs to pick apps.
  const handleRequestAuthorization = useCallback(async () => {
    const ok = await requestAuthorization();
    if (ok) {
      const today = new Date().toISOString().slice(0, 10);
      await updatePrefs({
        trackingStartDate: prefs.trackingStartDate || today,
        trackingActive: true,
        ...(Platform.OS !== "android" && { appsSelected: true }),
      });
    }
  }, [requestAuthorization, prefs.trackingStartDate, updatePrefs]);

  // ── Repair inconsistent state: iOS says authorized but prefs never synced ─
  useEffect(() => {
    if (!loaded || authorized !== true) return;
    if (!prefs.trackingStartDate || prefs.trackingActive === false) {
      const today = new Date().toISOString().slice(0, 10);
      updatePrefs({
        trackingStartDate: prefs.trackingStartDate || today,
        trackingActive: true,
      });
    }
  }, [authorized, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Change tracked apps ───────────────────────────────────────────────────
  // Android: open the in-app selector modal.
  // iOS: re-open the native FamilyActivityPicker.
  const handleChangeApps = useCallback(async () => {
    if (Platform.OS === "android") {
      setAndroidAppSelectorVisible(true);
      return;
    }
    const ok = await requestAppSelection();
    if (ok) {
      await updatePrefs({ appsSelected: true });
      await startMonitoring();
      await refreshUsageData();
    }
  }, [requestAppSelection, updatePrefs, startMonitoring, refreshUsageData]);

  // ── Android app selector: confirmed ──────────────────────────────────────
  const handleAndroidAppsConfirmed = useCallback(async (packages) => {
    setAndroidAppSelectorVisible(false);
    await setTrackedApps(packages);
    await updatePrefs({ appsSelected: true });
    await startMonitoring();
    await refreshUsageData();
  }, [setTrackedApps, updatePrefs, startMonitoring, refreshUsageData]);

  // ── Reset all tracking data ───────────────────────────────────────────────
  const handleConfirmReset = useCallback(async () => {
    await stopMonitoring();
    await updatePrefs({
      trackingStartDate: null,
      trackingActive: false,
      appsSelected: false,
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

  // ── Streak + week rollover evaluation (once per day) ─────────────────────
  useEffect(() => {
    if (!loaded) return;
    const rollover = evaluateWeekRollover(prefs.dailyHistory, prefs);
    const effectivePrefs = rollover ? { ...prefs, ...rollover } : prefs;
    const streakUpdates = evaluateStreak(prefs.dailyHistory, effectivePrefs);
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
  const todayMinutes = Object.values(usageData?.today?.apps ?? {})
    .reduce((sum, app) => sum + (app?.minutes ?? 0), 0);
  const dailyGoal = prefs.screenTimeGoalDailyMaxMinutes ?? 180;
  const streakCount = prefs.currentStreakCount ?? 0;
  const trackingActive = prefs.trackingActive !== false;

  // Background scheme
  const scheme = computeStreakBackground({
    todayMinutes,
    dailyGoal,
    trackingStartDate: prefs.trackingStartDate,
  });
  const cs = SCHEMES[scheme];

  // Localized day name abbreviations for histogram labels
  const localDayNames = [
    t("day_sun") || "Sun", t("day_mon") || "Mon", t("day_tue") || "Tue",
    t("day_wed") || "Wed", t("day_thu") || "Thu", t("day_fri") || "Fri",
    t("day_sat") || "Sat",
  ];

  // Last 7 days for histogram (also sent to native report view)
  const lastSevenDays = getLastSevenDays(prefs.dailyHistory, dailyGoal, localDayNames);

  // Week total (Android only)
  const weekMinutes = Object.values(usageData?.thisWeek?.apps ?? {})
    .reduce((sum, app) => sum + (app?.minutes ?? 0), 0);

  // ── Push style/goal/streak config to native report view ──────────────────
  // Placed after derived values so scheme/dailyGoal/streakCount/lastSevenDays
  // are initialized when the deps array is evaluated.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authorized || !loaded) return;
    setReportStyle({
      bgTop:             cs.bg[0],
      bgBottom:          cs.bg[1],
      textColor:         cs.text,
      subColor:          cs.sub,
      barMet:            cs.barMet,
      barMissed:         cs.barMissed,
      barEmpty:          cs.barEmpty,
      goalLine:          cs.goalLine,
      dailyGoalMinutes:  dailyGoal,
      streakCount,
      motivationalTitle: getMotivationalTitle(scheme, streakCount, 0, t),
      noAppsText:        t("native_no_apps")       || "No app usage recorded yet.",
      appsLabel:         t("native_apps_label")    || "Apps",
      streakDayText:     t("usetime_day_singular") || "day streak",
      streakDaysText:    t("usetime_day_plural")   || "days streak",
      streakNoStreakText: t("usetime_no_streak")   || "Start your streak today",
      timeUnitH:         t("time_unit_h")          || "h",
      timeUnitM:         t("time_unit_m")          || "m",
      lastSevenDays: lastSevenDays.map((d) => ({
        dayName: d.dayName,
        minutes: d.minutes ?? null,
        metGoal: d.metGoal ?? null,
      })),
    });
  }, [authorized, loaded, scheme, dailyGoal, streakCount, prefs.dailyHistory]);

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
    updatePrefs({ screenTimeGoalReductionPercent: editReductionPct });
    setGoalModalType(null);
  };
  const handleSaveDailyGoal = () => {
    updatePrefs({ screenTimeGoalDailyMaxMinutes: editDailyMax });
    setGoalModalType(null);
  };

  function fmtDailyGoal(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return t("usetime_less_than_h").replace("{h}", h);
    return t("usetime_less_than_hm").replace("{h}", h).replace("{m}", m);
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshUsageData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshUsageData]);

  // ── Android: threshold notifications at 50%, 90%, 99% of daily goal ────────
  // Tracks which have already fired today to avoid re-sending on every poll.
  const notifSentRef = useRef({ date: null, pct50: false, pct90: false, pct99: false });

  useEffect(() => {
    if (Platform.OS === "ios") return; // iOS uses mindful reminders instead (see below)
    if (!authorized || !dailyGoal || !loaded) return;
    if ((prefs.screenTimeRemindersCount ?? 3) === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    if (notifSentRef.current.date !== today) {
      notifSentRef.current = { date: today, pct50: false, pct90: false, pct99: false };
    }

    const pct = dailyGoal > 0 ? todayMinutes / dailyGoal : 0;

    const send = (title, body, type) => {
      Notifications.scheduleNotificationAsync({
        content: { title, body, data: { type } },
        trigger: null,
      }).catch(() => {});
    };

    if (pct >= 0.5 && !notifSentRef.current.pct50) {
      notifSentRef.current.pct50 = true;
      send(
        t("notif_50pct_title") || "📊 50% of daily goal",
        (t("notif_50pct_body") || "You've used {used} — halfway to your {goal} goal.")
          .replace("{used}", formatMinutes(todayMinutes)).replace("{goal}", formatMinutes(dailyGoal)),
        "screen_time_50"
      );
    }
    if (pct >= 0.9 && !notifSentRef.current.pct90) {
      notifSentRef.current.pct90 = true;
      send(
        t("notif_90pct_title") || "⚠️ 90% of daily goal",
        (t("notif_90pct_body") || "Only {remaining} left before your daily limit.")
          .replace("{remaining}", formatMinutes(dailyGoal - todayMinutes)),
        "screen_time_90"
      );
    }
    if (pct >= 0.99 && !notifSentRef.current.pct99) {
      notifSentRef.current.pct99 = true;
      send(
        t("notif_99pct_title") || "🚫 Daily limit almost reached",
        (t("notif_99pct_body") || "You've used {used} of your {goal} goal.")
          .replace("{used}", formatMinutes(todayMinutes)).replace("{goal}", formatMinutes(dailyGoal)),
        "screen_time_99"
      );
    }
  }, [todayMinutes, dailyGoal, authorized, loaded, prefs.screenTimeRemindersCount]);

  // ── iOS: daily mindfulness reminders (no usage data required) ───────────────
  // Slots: 9 AM, 1 PM, 6:30 PM. Count controlled by prefs.screenTimeRemindersCount.
  // Content rotates on every app open by picking random variants at schedule time.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!authorized || !loaded || !prefs.trackingStartDate) return;

    const cancelPrevious = async () => {
      for (const id of prefs.iOSMindfulNotifIds ?? []) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      }
    };

    const count = prefs.screenTimeRemindersCount ?? 3;

    if (count === 0) {
      cancelPrevious();
      updatePrefs({ iOSMindfulNotifIds: [] });
      return;
    }

    const schedule = async () => {
      await cancelPrevious();

      const allSlots = [
        { hour: 9,  minute: 0  },
        { hour: 13, minute: 0  },
        { hour: 18, minute: 30 },
      ];
      // Use the last `count` slots so single/double reminders land later in the day
      const slots = allSlots.slice(allSlots.length - count);

      // Pick `count` unique random indices
      const indices = [];
      while (indices.length < count) {
        const i = Math.floor(Math.random() * IOS_MINDFUL_NOTIFS.length);
        if (!indices.includes(i)) indices.push(i);
      }

      const ids = await Promise.all(
        slots.map((slot, i) =>
          Notifications.scheduleNotificationAsync({
            content: {
              title: IOS_MINDFUL_NOTIFS[indices[i]].title,
              body:  IOS_MINDFUL_NOTIFS[indices[i]].body,
              data:  { type: "screen_time_mindful" },
            },
            trigger: {
              type:   Notifications.SchedulableTriggerInputTypes.DAILY,
              hour:   slot.hour,
              minute: slot.minute,
            },
          }).catch(() => null)
        )
      );

      updatePrefs({ iOSMindfulNotifIds: ids.filter(Boolean) });
    };

    schedule();
  }, [authorized, loaded, prefs.trackingStartDate, prefs.screenTimeRemindersCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Morning daily goal notification — scheduled as a repeating daily alarm.
  // Rescheduled whenever the app opens with a new day, different time setting, or
  // when notifications are toggled. Content reflects current streak state.
  useEffect(() => {
    if (!authorized || !loaded || !prefs.trackingStartDate) return;

    const notifHour = prefs.screenTimeNotifHour ?? 8;
    const notifMinute = prefs.screenTimeNotifMinute ?? 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    const timeChanged =
      prefs.lastMorningScheduleHour !== notifHour ||
      prefs.lastMorningScheduleMinute !== notifMinute;

    // If disabled, cancel any existing scheduled notification and stop
    if (prefs.screenTimeNotifsEnabled === false) {
      if (prefs.scheduledMorningNotifId) {
        Notifications.cancelScheduledNotificationAsync(prefs.scheduledMorningNotifId).catch(() => {});
        updatePrefs({ scheduledMorningNotifId: null });
      }
      return;
    }

    // Already scheduled today with the same time → nothing to do
    if (
      prefs.lastMorningNotifDate === todayStr &&
      !timeChanged &&
      prefs.scheduledMorningNotifId
    ) return;

    const goalH = Math.floor((dailyGoal ?? 180) / 60);
    const goalM = (dailyGoal ?? 180) % 60;
    const goalStr = goalM === 0 ? `${goalH}h` : `${goalH}h ${goalM}min`;
    const streak = streakCount;

    let title, notifBody;
    if (scheme === "green") {
      const variants = [
        {
          title: t("notif_morning_green_1_title") || "Keep going strong! 🔥",
          body: (t("notif_morning_green_1_body") || "Keep your scrolling time below {goal} today to extend your {streak}-day streak.")
            .replace("{goal}", goalStr).replace("{streak}", streak),
        },
        {
          title: t("notif_morning_green_2_title") || "Streak on! 💪",
          body: (t("notif_morning_green_2_body") || "{streak} days and counting. Stay under {goal} today to keep it going.")
            .replace("{streak}", streak).replace("{goal}", goalStr),
        },
        {
          title: t("notif_morning_green_3_title") || "You're on a roll!",
          body: (t("notif_morning_green_3_body") || "Don't break the streak — stay under {goal} of social media today.")
            .replace("{goal}", goalStr),
        },
      ];
      const pick = variants[streak % variants.length];
      title = pick.title; notifBody = pick.body;
    } else {
      const variants = [
        {
          title: t("notif_morning_reset_1_title") || "Time to start again 🌱",
          body: (t("notif_morning_reset_1_body") || "Spend less than {goal} on social media today to go back to your goal.")
            .replace("{goal}", goalStr),
        },
        {
          title: t("notif_morning_reset_2_title") || "Fresh start today!",
          body: (t("notif_morning_reset_2_body") || "A new day, a new chance. Keep it under {goal} today.")
            .replace("{goal}", goalStr),
        },
        {
          title: t("notif_morning_reset_3_title") || "You've got this 💙",
          body: (t("notif_morning_reset_3_body") || "Aim for under {goal} today and start rebuilding your streak.")
            .replace("{goal}", goalStr),
        },
      ];
      const pick = variants[new Date().getDay() % variants.length];
      title = pick.title; notifBody = pick.body;
    }

    const reschedule = async () => {
      if (prefs.scheduledMorningNotifId) {
        await Notifications.cancelScheduledNotificationAsync(prefs.scheduledMorningNotifId).catch(() => {});
      }
      const id = await Notifications.scheduleNotificationAsync({
        content: { title, body: notifBody, data: { type: "screen_time_morning" } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: notifHour,
          minute: notifMinute,
        },
      });
      updatePrefs({
        scheduledMorningNotifId: id,
        lastMorningNotifDate: todayStr,
        lastMorningScheduleHour: notifHour,
        lastMorningScheduleMinute: notifMinute,
      });
    };
    reschedule().catch(() => {});
  }, [authorized, loaded, prefs.trackingStartDate, prefs.screenTimeNotifsEnabled, prefs.screenTimeNotifHour, prefs.screenTimeNotifMinute, prefs.lastMorningNotifDate, prefs.lastMorningScheduleHour, prefs.lastMorningScheduleMinute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weekly report notification — scheduled as a repeating weekly alarm (Monday).
  // Rescheduled whenever the app opens with new time settings or weekly data.
  useEffect(() => {
    if (!authorized || !loaded || !prefs.trackingStartDate) return;

    const notifHour = prefs.screenTimeNotifHour ?? 8;
    const notifMinute = prefs.screenTimeNotifMinute ?? 0;
    const timeChanged =
      prefs.lastWeeklyScheduleHour !== notifHour ||
      prefs.lastWeeklyScheduleMinute !== notifMinute;

    if (prefs.screenTimeNotifsEnabled === false) {
      if (prefs.scheduledWeeklyNotifId) {
        Notifications.cancelScheduledNotificationAsync(prefs.scheduledWeeklyNotifId).catch(() => {});
        updatePrefs({ scheduledWeeklyNotifId: null });
      }
      return;
    }

    // Already scheduled this week with same time → nothing to do
    if (prefs.scheduledWeeklyNotifId && !timeChanged) return;

    const lastWeekMin = prefs.lastWeekTotalMinutes ?? 0;
    const thisWeekGoalMin = dailyGoal ? dailyGoal * 7 : null;
    const thisWeekGoalH = thisWeekGoalMin ? Math.floor(thisWeekGoalMin / 60) : null;
    const thisWeekGoalM = thisWeekGoalMin ? thisWeekGoalMin % 60 : null;
    const goalStr = thisWeekGoalH !== null
      ? (thisWeekGoalM === 0 ? `${thisWeekGoalH}h` : `${thisWeekGoalH}h ${thisWeekGoalM}min`)
      : null;

    let weekBody;
    if (lastWeekMin > 0 && prefs.prevWeekTotalMinutes != null) {
      const prev = Number(prefs.prevWeekTotalMinutes);
      const diffPct = prev > 0 ? Math.round(((lastWeekMin - prev) / prev) * 100) : null;
      const direction = diffPct !== null
        ? (diffPct >= 0
          ? (t("notif_weekly_direction_up") || "up {pct}%").replace("{pct}", Math.abs(diffPct))
          : (t("notif_weekly_direction_down") || "down {pct}%").replace("{pct}", Math.abs(diffPct)))
        : null;
      weekBody = direction && goalStr
        ? (t("notif_weekly_body_change") || "Your social media use was {direction} last week. New goal: {goal} total this week. Keep going!")
            .replace("{direction}", direction).replace("{goal}", goalStr)
        : goalStr
          ? (t("notif_weekly_body_goal_only") || "New goal: {goal} total this week. Keep going!").replace("{goal}", goalStr)
          : (t("notif_weekly_body_check") || "Check your weekly screen time summary in the Use Time screen.");
    } else {
      weekBody = goalStr
        ? (t("notif_weekly_body_new_week") || "New week, new goal: stay under {goal} total. You can do it!").replace("{goal}", goalStr)
        : (t("notif_weekly_body_check") || "Check your weekly screen time summary in the Use Time screen.");
    }

    const reschedule = async () => {
      if (prefs.scheduledWeeklyNotifId) {
        await Notifications.cancelScheduledNotificationAsync(prefs.scheduledWeeklyNotifId).catch(() => {});
      }
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: t("notif_weekly_title") || "Weekly report 📊",
          body: weekBody,
          data: { type: "screen_time_weekly" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: prefs.trackingStartDate
            ? new Date(prefs.trackingStartDate + "T12:00:00").getDay() + 1
            : 2,
          hour: notifHour,
          minute: notifMinute,
        },
      });
      updatePrefs({
        scheduledWeeklyNotifId: id,
        lastWeeklyScheduleHour: notifHour,
        lastWeeklyScheduleMinute: notifMinute,
      });
    };
    reschedule().catch(() => {});
  }, [authorized, loaded, prefs.trackingStartDate, prefs.screenTimeNotifsEnabled, prefs.screenTimeNotifHour, prefs.screenTimeNotifMinute, prefs.scheduledWeeklyNotifId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Text style={[s.navTitle, { color: cs.text }]} numberOfLines={1} ellipsizeMode="tail">{t("usetime_title")}</Text>
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
              {!!error && (
                <Text style={[s.errorText, { color: cs.sub }]}>⚠ {error}</Text>
              )}

              {/* ── Auth prompt ── */}
              {authorized === false ? (
                renderAuthPrompt()
              ) : authorized === true && !prefs.appsSelected ? (
                <View style={[cc.card, { backgroundColor: cs.card, borderColor: cs.cardBorder, alignItems: "center", paddingVertical: 28 }]}>
                  <Feather name="smartphone" size={40} color={cs.text} style={{ marginBottom: 12 }} />
                  <Text style={[cc.cardTitle, { color: cs.text }]}>
                    {t("usetime_no_apps_title") || "No apps selected"}
                  </Text>
                  <Text style={[cc.cardBody, { color: cs.sub, marginBottom: 22 }]}>
                    {t("usetime_no_apps_body") || "Select the social media apps you want to track to start monitoring your screen time."}
                  </Text>
                  <TouchableOpacity
                    style={[s.enableBtn, { backgroundColor: cs.text }]}
                    onPress={handleChangeApps}
                    activeOpacity={0.85}
                  >
                    <Text style={[s.enableBtnText, { color: scheme === "white" || scheme === "yellow" ? "#fff" : cs.card.replace("0.55", "1") }]}>
                      {t("usetime_select_apps") || "Select apps"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* ── ANDROID-ONLY: motivational header + histogram + app lists ── */}
                  {Platform.OS !== "ios" && (
                    <>
                      {/* Motivational title */}
                      <Text style={[s.bigTitle, { color: cs.text }]}>
                        {getMotivationalTitle(scheme, streakCount, 0, t)}
                      </Text>

                      {/* Streak badge */}
                      <Text style={[s.streakBadge, { color: cs.sub }]}>
                        {streakCount > 0
                          ? `🔥 ${streakCount} ${streakCount === 1 ? t("usetime_day_singular") : t("usetime_day_plural")}`
                          : t("usetime_no_streak")}
                      </Text>

                      {/* Daily progress bar */}
                      <DailyProgressBar todayMin={todayMinutes} goalMin={dailyGoal} cs={cs} />

                      {/* 7-day histogram */}
                      <UsageHistogram days={lastSevenDays} dailyGoal={dailyGoal} cs={cs} />

                      {/* Per-app usage — today */}
                      <CollapsibleAppList
                        label={t("usetime_today") || "Today"}
                        totalMinutes={todayMinutes}
                        appsData={usageData?.today?.apps}
                        cs={cs}
                        noDataText={t("usetime_no_data") || "No data yet"}
                      />

                      {/* Per-app usage — this week */}
                      <CollapsibleAppList
                        label={t("usetime_this_week") || "This week"}
                        totalMinutes={weekMinutes}
                        appsData={usageData?.thisWeek?.apps}
                        cs={cs}
                        noDataText={t("usetime_no_data") || "No data yet"}
                      />
                    </>
                  )}

                  {/* ── GOALS ── */}
                  <View style={s.goalsBlock}>
                    <Text style={[s.sectionTitle, { color: cs.text }]}>{t("usetime_my_goals")}</Text>
                    <View style={s.goalRow}>
                      <Text style={[s.goalText, { color: cs.text }]}>
                        {fmtDailyGoal(prefs.screenTimeGoalDailyMaxMinutes ?? 180)}
                      </Text>
                      <TouchableOpacity onPress={openDailyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={[s.changeText, { color: cs.changeText }]}>{t("usetime_change")}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={s.goalRow}>
                      <Text style={[s.goalText, { color: cs.text }]}>
                        {t("usetime_reduction_pct").replace("{n}", prefs.screenTimeGoalReductionPercent ?? 10)}
                      </Text>
                      <TouchableOpacity onPress={openWeeklyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={[s.changeText, { color: cs.changeText }]}>{t("usetime_change")}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={[s.goalRow, { marginTop: 6 }]}>
                      <Text style={[s.goalText, { color: cs.text }]}>{t("usetime_notifications") || "Notifications"}</Text>
                      <Switch
                        value={prefs.screenTimeNotifsEnabled !== false}
                        onValueChange={(v) => updatePrefs({ screenTimeNotifsEnabled: v })}
                        trackColor={cs.switchTrack}
                        thumbColor={cs.switchThumb}
                        ios_backgroundColor={cs.switchTrack.false}
                      />
                    </View>
                  </View>

                  {/* ── PER-APP DETAILS (native modal) ── */}
                  <TouchableOpacity
                    style={[s.manageBtn, { borderColor: cs.divider, alignSelf: "stretch", justifyContent: "center", marginBottom: 12 }]}
                    onPress={presentReport}
                    activeOpacity={0.75}
                  >
                    <Feather name="bar-chart-2" size={15} color={cs.text} style={{ marginRight: 6 }} />
                    <Text style={[s.manageBtnText, { color: cs.text }]}>{t("usetime_view_per_app") || "View per-app details"}</Text>
                  </TouchableOpacity>

                  {/* ── MANAGE TRACKING ── */}
                  {authorized && (
                    <View style={[s.manageRow, { borderTopColor: cs.divider }]}>
                      <TouchableOpacity
                        style={[s.manageBtn, { borderColor: cs.divider }]}
                        onPress={handleChangeApps}
                        activeOpacity={0.75}
                      >
                        <Feather name="list" size={15} color={cs.text} style={{ marginRight: 6 }} />
                        <Text style={[s.manageBtnText, { color: cs.text }]}>{t("usetime_change_apps") || "Change Apps"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.manageBtn, { borderColor: cs.divider }]}
                        onPress={() => setResetModalVisible(true)}
                        activeOpacity={0.75}
                      >
                        <Feather name="refresh-ccw" size={15} color={cs.text} style={{ marginRight: 6 }} />
                        <Text style={[s.manageBtnText, { color: cs.text }]}>{t("usetime_reset_tracking") || "Reset Tracking"}</Text>
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

      {/* ── Android app selector ── */}
      {Platform.OS === "android" && (
        <AndroidAppSelectorModal
          visible={androidAppSelectorVisible}
          onClose={() => setAndroidAppSelectorVisible(false)}
          onConfirm={handleAndroidAppsConfirmed}
          getInstalledApps={getInstalledApps}
        />
      )}

      {/* ── Weekly reduction goal modal ── */}
      <Modal visible={goalModalType === "weekly"} transparent animationType="fade" onRequestClose={() => setGoalModalType(null)}>
        <View style={s.modalOverlay}>
          <View style={s.goalModalCard}>
            <Text style={s.goalModalTitle}>{t("usetime_weekly_goal_title")}</Text>
            <Text style={[s.goalModalValue, { color: cs.modalBtn }]}>{editReductionPct}{t("usetime_per_week")}</Text>
            <Slider
              style={{ width: "100%", height: 40, marginVertical: 8 }}
              minimumValue={5} maximumValue={50} step={5}
              value={editReductionPct}
              onValueChange={(v) => setEditReductionPct(Math.round(v))}
              minimumTrackTintColor={cs.modalBtn} maximumTrackTintColor="#ddd" thumbTintColor={cs.modalBtn}
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
      <Modal visible={goalModalType === "daily"} transparent animationType="fade" onRequestClose={() => setGoalModalType(null)}>
        <View style={s.modalOverlay}>
          <View style={s.goalModalCard}>
            <Text style={s.goalModalTitle}>{t("usetime_daily_max_title")}</Text>
            <Text style={[s.goalModalValue, { color: cs.modalBtn }]}>{formatMinutes(editDailyMax)}</Text>
            <Slider
              style={{ width: "100%", height: 40, marginVertical: 8 }}
              minimumValue={15} maximumValue={480} step={15}
              value={editDailyMax}
              onValueChange={(v) => setEditDailyMax(Math.round(v))}
              minimumTrackTintColor={cs.modalBtn} maximumTrackTintColor="#ddd" thumbTintColor={cs.modalBtn}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={s.sliderLabel}>15 min</Text>
              <Text style={s.sliderLabel}>8h</Text>
            </View>
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
            <Text style={s.deactivateTitle}>{t("usetime_reset_title") || "Reset Tracking?"}</Text>
            <Text style={s.deactivateSub}>
              {t("usetime_reset_body") || "This will erase all your usage history, streak, and goals. You'll restart the 7-day observation period."}
            </Text>
            <View style={[s.goalModalBtns, { marginTop: 24 }]}>
              <TouchableOpacity style={s.goalModalCancelBtn} onPress={() => setResetModalVisible(false)}>
                <Text style={s.goalModalCancelText}>{t("cancel_button")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.goalModalSaveBtn, { backgroundColor: "#FF5252" }]}
                onPress={handleConfirmReset}
              >
                <Text style={s.goalModalSaveText}>{t("usetime_reset_confirm") || "Reset"}</Text>
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
  progressWrap: { marginBottom: 20 },
  progressTrack: { height: 10, borderRadius: 5, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 5 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  progressLabel: { fontFamily: "Poppins", fontSize: 12 },
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
    fontSize: 28,
    marginTop: 12,
    marginBottom: 18,
    lineHeight: 40,
  },
  streakBadge: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    marginTop: -10,
    marginBottom: 18,
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
  pullToRefreshText: { fontFamily: "Poppins", fontSize: 11, marginTop: 6, marginBottom: 10, textAlign: "center" },
  goalsBlock: { marginTop: 20, marginBottom: 20 },
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
