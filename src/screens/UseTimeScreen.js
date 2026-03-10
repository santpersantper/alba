import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Image,
  PanResponder,
  Modal,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import Slider from "@react-native-community/slider";
import { useUserPreferences } from "../hooks/useUserPreferences";
import OnboardingOverlay from "../components/OnboardingOverlay";
import { useScreenTime } from "../hooks/useScreenTime";
import { evaluateStreak, evaluateWeekRollover, formatMinutes } from "../utils/streakUtils";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getYesterdayName() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return DAY_NAMES[d.getDay()];
}

function getMotivationalMessage(changePct) {
  if (changePct === null) return "Start tracking your screen time to see your progress! 💪";
  if (changePct < 0) return "You're on your way to meet your goal, keep it up! 💪";
  if (changePct === 0) return "Same as last week. You can do better! 🎯";
  return "You're using more than last week. Let's get back on track 💚";
}

// Format daily max goal for the goals section
function fmtDailyGoal(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `Less than ${h}h a day`;
  return `Less than ${h}h ${m}min a day`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UseTimeScreen() {
  const navigation = useNavigation();
  const { prefs, updatePrefs, loaded } = useUserPreferences();
  const { authorized, usageData, loading, error, requestAuthorization } = useScreenTime();

  // Goal modal state
  const [goalModalType, setGoalModalType] = useState(null); // "weekly" | "daily" | null
  const [editReductionPct, setEditReductionPct] = useState(10);
  const [editDailyMax, setEditDailyMax] = useState(180);

  // Evaluate streak + weekly rollover once per day when data is ready
  useEffect(() => {
    if (!usageData || !loaded) return;
    // On Monday: save last week's total and reset streak circles before evaluating today
    const rollover = evaluateWeekRollover(usageData?.thisWeek?.totalMinutes ?? 0, prefs);
    const effectivePrefs = rollover ? { ...prefs, ...rollover } : prefs;
    const streakUpdates = evaluateStreak(usageData, effectivePrefs);
    const combined = { ...(rollover ?? {}), ...(streakUpdates ?? {}) };
    if (Object.keys(combined).length > 0) updatePrefs(combined);
  }, [usageData, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe-left to go back
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dy) < 10,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) navigation.goBack();
      },
    })
  ).current;

  // ── Computed stats ─────────────────────────────────────────────────────────
  const todayMinutes = usageData?.today?.totalMinutes ?? 0;
  const weekMinutes = usageData?.thisWeek?.totalMinutes ?? 0;
  const yesterdayMinutes = usageData?.dailyTotals?.[getYesterdayName()] ?? 0;
  const lastWeekMinutes = prefs.lastWeekTotalMinutes ?? 0;

  // Week-over-week change (negative = good / reduced)
  const weekChangePct =
    lastWeekMinutes > 0
      ? Math.round(((weekMinutes - lastWeekMinutes) / lastWeekMinutes) * 100)
      : null;

  // Today vs yesterday change (negative = good / reduced)
  const yesterdayChangePct =
    yesterdayMinutes > 0
      ? Math.round(((todayMinutes - yesterdayMinutes) / yesterdayMinutes) * 100)
      : null;

  // Prefs shortcuts
  const streakCount = prefs.currentStreakCount ?? 0;
  const streakDays = prefs.streakDays ?? {};
  const weekGoalDailyMax = prefs.screenTimeGoalDailyMaxMinutes ?? 180;
  const weekGoalReductionPct = prefs.screenTimeGoalReductionPercent ?? 10;

  // ── Goal modal handlers ────────────────────────────────────────────────────
  const openWeeklyModal = () => {
    setEditReductionPct(weekGoalReductionPct);
    setGoalModalType("weekly");
  };

  const openDailyModal = () => {
    setEditDailyMax(weekGoalDailyMax);
    setGoalModalType("daily");
  };

  const handleSaveWeeklyGoal = () => {
    const newPrefs = { ...prefs, screenTimeGoalReductionPercent: editReductionPct };
    const streakUpdates = evaluateStreak(usageData, newPrefs);
    updatePrefs({ screenTimeGoalReductionPercent: editReductionPct, ...(streakUpdates ?? {}) });
    setGoalModalType(null);
  };

  const handleSaveDailyGoal = () => {
    const newPrefs = { ...prefs, screenTimeGoalDailyMaxMinutes: editDailyMax };
    const streakUpdates = evaluateStreak(usageData, newPrefs);
    updatePrefs({ screenTimeGoalDailyMaxMinutes: editDailyMax, ...(streakUpdates ?? {}) });
    setGoalModalType(null);
  };

  // ── Skeleton loading ───────────────────────────────────────────────────────
  const renderSkeleton = () => (
    <View style={{ paddingTop: 24 }}>
      <View style={[styles.skeleton, { height: 96, marginBottom: 20, width: "90%" }]} />
      <View style={[styles.skeleton, { height: 60, marginBottom: 20, width: "70%" }]} />
      <View style={[styles.skeleton, { height: 50, marginBottom: 24 }]} />
      <View style={[styles.skeleton, { height: 140, marginBottom: 14 }]} />
      <View style={[styles.skeleton, { height: 140 }]} />
    </View>
  );

  // ── Auth prompt (replaces data cards) ────────────────────────────────────
  const renderAuthPrompt = () => (
    <View style={[styles.card, { alignItems: "center", paddingVertical: 28, paddingHorizontal: 22 }]}>
      <Feather name="clock" size={40} color="#fff" style={{ marginBottom: 12 }} />
      <Text
        style={[styles.cardLabel, { fontSize: 16, textAlign: "center", marginBottom: 10 }]}
      >
        Allow Alba to track your social media time
      </Text>
      <Text
        style={{
          fontFamily: "Poppins",
          fontSize: 13,
          color: "rgba(255,255,255,0.8)",
          textAlign: "center",
          marginBottom: 22,
          lineHeight: 19,
        }}
      >
        We use Apple's Screen Time framework.{"\n"}Your data never leaves your device.
      </Text>
      <TouchableOpacity
        style={styles.enableBtn}
        onPress={requestAuthorization}
        activeOpacity={0.85}
      >
        <Text style={styles.enableBtnText}>Enable Screen Time</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Per-app time row ───────────────────────────────────────────────────────
  const renderAppRow = (data) => {
    const instMin = data?.apps?.Instagram?.minutes ?? 0;
    const tikMin = data?.apps?.TikTok?.minutes ?? 0;
    const xMin = data?.apps?.X?.minutes ?? 0;
    return (
      <View style={styles.appsRow}>
        <View style={styles.appItem}>
          <Image source={require("../../assets/instagram_white.png")} style={styles.appIcon} />
          <Text style={styles.appTime}>{formatMinutes(instMin)}</Text>
        </View>
        <View style={styles.appItem}>
          <Image source={require("../../assets/tiktok_white.png")} style={styles.appIcon} />
          <Text style={styles.appTime}>{formatMinutes(tikMin)}</Text>
        </View>
        <View style={styles.appItem}>
          <Image source={require("../../assets/twitter_white.png")} style={styles.appIcon} />
          <Text style={styles.appTime}>{formatMinutes(xMin)}</Text>
        </View>
      </View>
    );
  };

  // ── Stat row helper ────────────────────────────────────────────────────────
  const renderStatRow = (changePct, label, useChart = false) => {
    const isUp = changePct !== null && changePct > 0;
    const arrowIcon = isUp
      ? require("../../assets/upward_white.png")
      : require("../../assets/downward_white.png");
    return (
      <View style={styles.statRow}>
        {useChart ? (
          <Image source={require("../../assets/chart_white.png")} style={styles.smallIcon} />
        ) : changePct !== null ? (
          <Image source={arrowIcon} style={styles.smallIcon} />
        ) : (
          <View style={styles.smallIcon} />
        )}
        {!useChart && (
          <Text style={[styles.statNumber, isUp && styles.statNumberUp]}>
            {changePct !== null ? `${Math.abs(changePct).toFixed(2)}%` : "—"}
          </Text>
        )}
        <Text style={styles.statLabel}>
          {useChart ? (
            <>
              <Text style={styles.statBold}>
                {streakCount} straight day{streakCount !== 1 ? "s" : ""}
              </Text>{" "}
              keeping your goal
            </>
          ) : (
            label
          )}
        </Text>
      </View>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={["#00D36F", "#00B249"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
      {...panResponder.panHandlers}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {loading && !usageData ? (
            renderSkeleton()
          ) : (
            <>
              {/* Motivational header */}
              <Text style={styles.bigTitle}>{getMotivationalMessage(weekChangePct)}</Text>

              {/* Stats block */}
              <View style={styles.statsBlock}>
                {renderStatRow(weekChangePct, "since last Friday")}
                {renderStatRow(yesterdayChangePct, "since yesterday")}
                {renderStatRow(null, null, true)}
              </View>

              {/* Error */}
              {!!error && (
                <Text style={styles.errorText}>⚠ {error}</Text>
              )}

              {/* Streak circles Mon–Fri */}
              <View style={styles.daysRow}>
                {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => {
                  const filled = !!streakDays[d];
                  return (
                    <View key={d} style={styles.dayItem}>
                      <View style={[styles.dayCircle, filled && styles.dayCircleFilled]}>
                        {filled && <Feather name="check" size={16} color="#00D36F" />}
                      </View>
                      <Text style={styles.dayLabel}>{d}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Goals */}
              <View style={styles.goalsBlock}>
                <Text style={styles.sectionTitle}>My current goals:</Text>
                <View style={styles.goalRow}>
                  <Text style={styles.goalText}>
                    {weekGoalReductionPct}% reduction per week
                  </Text>
                  <TouchableOpacity
                    onPress={openWeeklyModal}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.changeText}>Change</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.goalRow}>
                  <Text style={styles.goalText}>{fmtDailyGoal(weekGoalDailyMax)}</Text>
                  <TouchableOpacity
                    onPress={openDailyModal}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.changeText}>Change</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Data cards or auth prompt */}
              {authorized === false ? (
                renderAuthPrompt()
              ) : (
                <>
                  {/* Today card */}
                  <View style={styles.card}>
                    <Text style={styles.cardLabel}>Social media time today</Text>
                    <Text style={styles.cardMainTime}>{formatMinutes(todayMinutes)}</Text>
                    {renderAppRow(usageData?.today)}
                  </View>

                  {/* Week card */}
                  <View style={[styles.card, { marginBottom: 32 }]}>
                    <Text style={styles.cardLabel}>Social media time this week</Text>
                    <Text style={styles.cardMainTime}>{formatMinutes(weekMinutes)}</Text>
                    {renderAppRow(usageData?.thisWeek)}
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
        <View style={styles.modalOverlay}>
          <View style={styles.goalModalCard}>
            <Text style={styles.goalModalTitle}>Weekly reduction goal</Text>
            <Text style={styles.goalModalValue}>{editReductionPct}% per week</Text>
            <Slider
              style={{ width: "100%", height: 40, marginVertical: 8 }}
              minimumValue={5}
              maximumValue={50}
              step={5}
              value={editReductionPct}
              onValueChange={(v) => setEditReductionPct(Math.round(v))}
              minimumTrackTintColor="#00B249"
              maximumTrackTintColor="#ddd"
              thumbTintColor="#00B249"
            />
            <View
              style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 20 }}
            >
              <Text style={styles.sliderLabel}>5%</Text>
              <Text style={styles.sliderLabel}>50%</Text>
            </View>
            <View style={styles.goalModalBtns}>
              <TouchableOpacity
                style={styles.goalModalCancelBtn}
                onPress={() => setGoalModalType(null)}
              >
                <Text style={styles.goalModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.goalModalSaveBtn} onPress={handleSaveWeeklyGoal}>
                <Text style={styles.goalModalSaveText}>Save</Text>
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
        <View style={styles.modalOverlay}>
          <View style={styles.goalModalCard}>
            <Text style={styles.goalModalTitle}>Daily maximum</Text>

            {/* Stepper */}
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setEditDailyMax((v) => Math.max(30, v - 15))}
              >
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{formatMinutes(editDailyMax)}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setEditDailyMax((v) => Math.min(480, v + 15))}
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.sliderLabel, { textAlign: "center", marginBottom: 20 }]}>
              30 min – 8 hours, in 15-minute steps
            </Text>

            <View style={styles.goalModalBtns}>
              <TouchableOpacity
                style={styles.goalModalCancelBtn}
                onPress={() => setGoalModalType(null)}
              >
                <Text style={styles.goalModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.goalModalSaveBtn} onPress={handleSaveDailyGoal}>
                <Text style={styles.goalModalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <OnboardingOverlay screenKey="usetime" />
    </LinearGradient>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  bigTitle: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 35,
    color: "#FFFFFF",
    marginTop: 24,
    marginBottom: 20,
  },
  statsBlock: {
    marginBottom: 24,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  statNumber: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 20,
    color: "#FFFFFF",
    marginHorizontal: 4,
  },
  statNumberUp: {
    // subtle warning tint — slightly more transparent on green bg
    opacity: 0.9,
  },
  statLabel: {
    fontFamily: "Poppins",
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: "200",
    marginHorizontal: 10,
    flexShrink: 1,
  },
  statBold: {
    fontFamily: "Poppins",
    fontWeight: "700",
  },
  errorText: {
    fontFamily: "Poppins",
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 12,
  },
  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 26,
    marginTop: 4,
    paddingHorizontal: 10,
  },
  dayItem: {
    alignItems: "center",
  },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  dayCircleFilled: {
    backgroundColor: "#FFFFFF",
  },
  dayLabel: {
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#FFFFFF",
  },
  goalsBlock: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: "Poppins",
    fontSize: 20,
    color: "#FFFFFF",
    marginBottom: 8,
    fontWeight: "700",
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  goalText: {
    flex: 1,
    fontFamily: "Poppins",
    fontSize: 18,
    color: "#FFFFFF",
  },
  changeText: {
    fontFamily: "Poppins",
    fontSize: 18,
    color: "rgba(255,255,255,0.5)",
    marginLeft: 10,
  },
  card: {
    backgroundColor: "rgba(0, 180, 73, 0.95)",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 14,
  },
  cardLabel: {
    fontFamily: "Poppins",
    fontSize: 13,
    color: "#FFFFFF",
    marginBottom: 6,
    fontWeight: "700",
  },
  cardMainTime: {
    fontFamily: "Poppins",
    fontSize: 32,
    color: "#FFFFFF",
    marginBottom: 12,
  },
  appsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  appItem: {
    alignItems: "center",
    flex: 1,
  },
  appTime: {
    marginTop: 4,
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#FFFFFF",
  },
  smallIcon: {
    width: 20,
    height: 20,
    resizeMode: "contain",
  },
  appIcon: {
    width: 28,
    height: 28,
    resizeMode: "contain",
    marginBottom: 2,
  },
  enableBtn: {
    backgroundColor: "#fff",
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
  },
  // ── Modals ─────────────────────────────────────────────────────────────────
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
    color: "#00B249",
    textAlign: "center",
    marginBottom: 4,
  },
  sliderLabel: {
    fontFamily: "Poppins",
    fontSize: 12,
    color: "#999",
  },
  goalModalBtns: {
    flexDirection: "row",
    gap: 10,
  },
  goalModalCancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  goalModalCancelText: {
    fontFamily: "Poppins",
    fontSize: 15,
    color: "#888",
  },
  goalModalSaveBtn: {
    flex: 1,
    backgroundColor: "#00B249",
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
  // Daily max stepper
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
    backgroundColor: "#00B249",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 28,
  },
  stepperValue: {
    fontFamily: "Poppins",
    fontWeight: "700",
    fontSize: 22,
    color: "#1a1a1a",
    minWidth: 90,
    textAlign: "center",
  },
});
