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
