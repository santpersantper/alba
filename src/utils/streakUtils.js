// streakUtils — helpers for screen-time streak evaluation.
// Called once per day; if today was already evaluated (lastStreakUpdate === today's date) it is a no-op.
// Returns a partial prefs update object (or null if nothing changed) — caller decides whether to persist.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Evaluate whether today's goal was met and return the prefs update.
 * @param {object} usageData — shape from useScreenTime (today.totalMinutes, dailyTotals, etc.)
 * @param {object} prefs     — current useUserPreferences values
 * @returns {object|null}    — partial prefs to merge, or null if nothing to update
 */
export function evaluateStreak(usageData, prefs) {
  const todayKey = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  if (prefs.lastStreakUpdate === todayKey) return null;   // already evaluated today

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
 * Detect a Monday week-boundary and return prefs updates that:
 *   - save last week's total into lastWeekTotalMinutes (for week-over-week % stat)
 *   - reset streakDays and currentStreakCount for the new week
 *
 * No-op if: today is not Monday, or lastStreakUpdate is already from this week.
 *
 * @param {number} weekMinutes — usageData.thisWeek.totalMinutes from the PREVIOUS week
 * @param {object} prefs       — current useUserPreferences values
 * @returns {object|null}      — partial prefs to merge, or null if nothing to update
 */
export function evaluateWeekRollover(weekMinutes, prefs) {
  // Only fires on Monday (getDay() === 1)
  if (new Date().getDay() !== 1) return null;

  // If there's no previous streak update there's no "last week" to save
  const lastUpdate = prefs.lastStreakUpdate;
  if (!lastUpdate) return null;

  // Calculate the Monday that starts the current week and the one that started
  // the week of the last streak update. If they're the same we already rolled over.
  const getMondayOf = (dateStr) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // shift to Monday
    return d.toDateString();
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  if (getMondayOf(lastUpdate) === getMondayOf(todayStr)) return null; // same week

  return {
    lastWeekTotalMinutes: weekMinutes ?? 0,
    streakDays: { ...EMPTY_STREAK_DAYS },
    currentStreakCount: 0,
  };
}

/**
 * Format a minute count into a human-readable string.
 * 0       → "0 min"
 * 34      → "34 min"
 * 60      → "1h"
 * 62      → "1h 2 min"
 */
export function formatMinutes(totalMinutes) {
  if (totalMinutes == null) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m} min`;
}
