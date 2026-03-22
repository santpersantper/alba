// streakUtils — helpers for screen-time streak evaluation and daily history management.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Returns "YYYY-MM-DD" for N calendar days ago (0 = today). */
export function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluate whether yesterday's goal was met and update the streak count.
 * Uses COMPLETED-day data (yesterday), not today's in-progress data.
 * No-op if today was already evaluated (lastStreakUpdate === today).
 */
export function evaluateStreak(dailyHistory, prefs) {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (prefs.lastStreakUpdate === todayKey) return null;

  const yesterdayKey = dateNDaysAgo(1);
  const yesterdayEntry = (dailyHistory || []).find((e) => e.date === yesterdayKey);

  // No data for yesterday = first day of tracking or gap; don't penalize
  if (!yesterdayEntry) {
    return { lastStreakUpdate: todayKey };
  }

  const dailyMaxMinutes = prefs.screenTimeGoalDailyMaxMinutes ?? 180;
  const goalMetYesterday = yesterdayEntry.minutes <= dailyMaxMinutes;
  const newStreakCount = goalMetYesterday ? (prefs.currentStreakCount ?? 0) + 1 : 0;

  return {
    currentStreakCount: newStreakCount,
    lastStreakUpdate: todayKey,
  };
}

/**
 * Check if 7 days have elapsed since the last weekly rollover (or since trackingStartDate).
 * If so, auto-reduce the daily goal by the user's weekly reduction % and return prefs updates.
 */
export function evaluateWeekRollover(dailyHistory, prefs) {
  if (!prefs.trackingStartDate) return null;

  const todayKey = new Date().toISOString().slice(0, 10);
  if (prefs.lastWeeklyRolloverDate === todayKey) return null;

  const lastRollover = prefs.lastWeeklyRolloverDate ?? prefs.trackingStartDate;
  const lastDate = new Date(lastRollover + "T12:00:00");
  const today = new Date(todayKey + "T12:00:00");
  const daysSince = Math.round((today - lastDate) / 86400000);

  if (daysSince < 7) return null;

  const reductionPct = prefs.screenTimeGoalReductionPercent ?? 10;
  const currentGoal = prefs.screenTimeGoalDailyMaxMinutes ?? 180;
  const newGoal = Math.max(15, Math.round(currentGoal * (1 - reductionPct / 100)));

  // Sum last 7 days from dailyHistory
  let lastWeekTotal = 0;
  for (let i = 7; i >= 1; i--) {
    const d = dateNDaysAgo(i);
    const entry = (dailyHistory || []).find((e) => e.date === d);
    if (entry) lastWeekTotal += entry.minutes ?? 0;
  }

  return {
    screenTimeGoalDailyMaxMinutes: newGoal,
    lastWeekTotalMinutes: lastWeekTotal,
    prevWeekTotalMinutes: prefs.lastWeekTotalMinutes ?? 0,
    lastWeeklyRolloverDate: todayKey,
  };
}

/**
 * Merge usageData into the stored dailyHistory array.
 * Updates today from live per-app sum; fills past days from dailyTotals.
 * Prunes entries older than 14 days.
 */
export function mergeDailyHistory(currentHistory, usageData) {
  const historyMap = {};
  (currentHistory || []).forEach((e) => { historyMap[e.date] = e.minutes; });

  const todayStr = new Date().toISOString().slice(0, 10);

  // Overwrite today with live per-app sum
  const todayAppsTotal = Object.values(usageData?.today?.apps ?? {})
    .reduce((sum, app) => sum + (app?.minutes ?? 0), 0);
  if (usageData?.today) {
    historyMap[todayStr] = todayAppsTotal;
  }

  // Fill past days from dailyTotals (only if not already stored)
  for (let i = 1; i <= 6; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[d.getDay()];
    const minutes = usageData?.dailyTotals?.[dayName];
    if (minutes !== undefined && historyMap[dateStr] === undefined) {
      historyMap[dateStr] = minutes;
    }
  }

  const cutoffStr = dateNDaysAgo(14);
  return Object.entries(historyMap)
    .filter(([date]) => date >= cutoffStr)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => ({ date, minutes }));
}

/**
 * Build an array of the last 7 calendar days (oldest first) from dailyHistory.
 * Each entry: { date, dayName, minutes, metGoal, isToday }
 */
export function getLastSevenDays(dailyHistory, dailyGoal) {
  const historyMap = {};
  (dailyHistory || []).forEach((e) => { historyMap[e.date] = e.minutes; });

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[d.getDay()];
    const minutes = historyMap[dateStr] ?? null;
    const metGoal = minutes !== null && dailyGoal != null ? minutes <= dailyGoal : null;
    days.push({ date: dateStr, dayName, minutes, metGoal, isToday: i === 0 });
  }
  return days;
}

/**
 * Determine the background color scheme:
 * yellow — first day of tracking, or no goal/start date
 * red    — over daily goal today
 * green  — below or at daily goal today
 */
export function computeStreakBackground({ todayMinutes, dailyGoal, trackingStartDate }) {
  if (!trackingStartDate || dailyGoal == null) return "yellow";
  const isFirstDay = trackingStartDate === new Date().toISOString().slice(0, 10);
  if (isFirstDay) return "yellow";
  return todayMinutes <= dailyGoal ? "green" : "red";
}

/**
 * Format a minute count into a human-readable string.
 */
export function formatMinutes(totalMinutes) {
  if (totalMinutes == null) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m} min`;
}
