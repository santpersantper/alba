// streakUtils — helpers for screen-time streak evaluation and daily history management.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Returns "YYYY-MM-DD" for N calendar days ago (0 = today). */
export function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluate whether today's goal was met and return the prefs update.
 * No-op if today was already evaluated (lastStreakUpdate === today).
 */
export function evaluateStreak(usageData, prefs) {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (prefs.lastStreakUpdate === todayKey) return null;

  const todayName = DAY_NAMES[new Date().getDay()];
  const todayMinutes = usageData?.today?.totalMinutes ?? 0;
  const dailyMaxMinutes = prefs.screenTimeGoalDailyMaxMinutes ?? 180;
  const goalMet = todayMinutes <= dailyMaxMinutes;

  const newStreakDays = { ...(prefs.streakDays ?? {}), [todayName]: goalMet };
  const newStreakCount = goalMet ? (prefs.currentStreakCount ?? 0) + 1 : 0;

  return {
    streakDays: newStreakDays,
    currentStreakCount: newStreakCount,
    lastStreakUpdate: todayKey,
  };
}

const EMPTY_STREAK_DAYS = {
  Mon: false, Tue: false, Wed: false, Thu: false,
  Fri: false, Sat: false, Sun: false,
};

/**
 * Detect a Monday week-boundary and return prefs updates:
 *   - saves lastWeekTotalMinutes and lastWeekDailyTotals
 *   - resets streakDays / currentStreakCount
 *   - auto-reduces screenTimeGoalDailyMaxMinutes by the reduction % (if goal was auto-set)
 */
export function evaluateWeekRollover(weekMinutes, currentDailyTotals, prefs) {
  if (new Date().getDay() !== 1) return null;

  const lastUpdate = prefs.lastStreakUpdate;
  if (!lastUpdate) return null;

  const getMondayOf = (dateStr) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toDateString();
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  if (getMondayOf(lastUpdate) === getMondayOf(todayStr)) return null;

  const reductionPct = prefs.screenTimeGoalReductionPercent ?? 10;
  const autoReducedGoal =
    prefs.goalAutoSet && prefs.screenTimeGoalDailyMaxMinutes
      ? Math.max(15, Math.round(prefs.screenTimeGoalDailyMaxMinutes * (1 - reductionPct / 100)))
      : null;

  return {
    lastWeekTotalMinutes: weekMinutes ?? 0,
    lastWeekDailyTotals: currentDailyTotals ?? {},
    streakDays: { ...EMPTY_STREAK_DAYS },
    currentStreakCount: 0,
    ...(autoReducedGoal !== null ? { screenTimeGoalDailyMaxMinutes: autoReducedGoal } : {}),
  };
}

/**
 * Merge usageData into the stored dailyHistory array.
 * Updates today from live data; fills past days of the current week if not yet set.
 * Prunes entries older than 14 days.
 * Returns the updated history array (does NOT mutate input).
 */
export function mergeDailyHistory(currentHistory, usageData) {
  const historyMap = {};
  (currentHistory || []).forEach((e) => { historyMap[e.date] = e.minutes; });

  const todayStr = new Date().toISOString().slice(0, 10);

  // Always overwrite today from live data
  if (usageData?.today?.totalMinutes !== undefined) {
    historyMap[todayStr] = usageData.today.totalMinutes;
  }

  // Fill past days of this week from dailyTotals (only if entry absent — historical data wins)
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
 * minutes is null if no data exists for that day.
 * metGoal is null if dailyGoal is null or minutes is null.
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
    const metGoal =
      minutes !== null && dailyGoal !== null ? minutes <= dailyGoal : null;
    days.push({ date: dateStr, dayName, minutes, metGoal, isToday: i === 0 });
  }
  return days;
}

/**
 * Determine the background color scheme.
 * Priority: green > red > white > yellow
 *
 * green  — streak > 2 days AND meeting goal today
 * red    — exceeding goal today
 * white  — missed goal yesterday but meeting it today
 * yellow — everything else (observation period, not enough streak, etc.)
 */
export function computeStreakBackground({
  streakCount,
  todayMinutes,
  dailyGoal,
  metYesterday,
  firstWeekComplete,
}) {
  if (!firstWeekComplete || dailyGoal == null) return "yellow";
  const metToday = todayMinutes <= dailyGoal;
  if (streakCount > 2 && metToday) return "green";
  if (!metToday) return "red";
  if (!metYesterday && metToday) return "white";
  return "yellow";
}

/**
 * Format a minute count into a human-readable string.
 * 0 → "0 min" | 34 → "34 min" | 60 → "1h" | 62 → "1h 2 min"
 */
export function formatMinutes(totalMinutes) {
  if (totalMinutes == null) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m} min`;
}
