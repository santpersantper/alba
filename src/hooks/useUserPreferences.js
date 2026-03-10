// useUserPreferences — persistent storage for premium feature flags.
// Uses AsyncStorage (already in project) following the same pattern as
// alba_theme_mode and alba_language keys in ThemeContext / LanguageContext.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useEffect, useCallback } from "react";

export const PREFS_KEY = "alba_premium_prefs";

const DEFAULT_PREFS = {
  premiumAdFree: false,        // boolean — Ad-Free subscription active
  premiumTravelerMode: false,  // boolean — Traveler Mode subscription active
  travelerModeCity: null,      // string | null — display name e.g. "Tokyo, Japan"
  travelerModeCityCoords: null, // { lat, lng } | null — resolved coordinates
  // ── Diffusion List ──
  premiumDiffusionList: false,   // boolean — Diffusion List feature active
  diffusionRadiusKm: 5,          // number — broadcast radius in km (1–50), default 5
  blockDiffusionMessages: false, // boolean — privacy setting; available to ALL users
  // ── Notifications ──
  notifChatMessages:  true,   // boolean — notify on new DMs
  notifGroupMessages: true,   // boolean — notify on new group messages
  notifDiffusion:     true,   // boolean — notify on diffusion messages
  notifFollowedPosts: true,   // boolean — notify on new posts from followed accounts
  // ── Screen Time (stored locally via AsyncStorage — usage data never sent to backend) ──
  lastWeekTotalMinutes: 0,                  // number — previous week's social media total for week-over-week comparison
  screenTimeGoalReductionPercent: 10,       // number — % reduction per week (5–50), default 10%
  screenTimeGoalDailyMaxMinutes: 180,       // number — daily max in minutes (30–480), default 3h
  streakDays: {                             // boolean map — goal met per weekday this week
    Mon: false, Tue: false, Wed: false,
    Thu: false, Fri: false, Sat: false, Sun: false,
  },
  currentStreakCount: 0,                    // number — consecutive days goal was met
  lastStreakUpdate: null,                   // ISO date string "YYYY-MM-DD" — last evaluation date
};

export function useUserPreferences() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then((raw) => {
      if (raw) {
        try {
          setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch {}
      }
      setLoaded(true);
    });
  }, []);

  const updatePrefs = useCallback(async (partial) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Call reload() when a screen re-focuses to pick up changes made by other screens
  const reload = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {}
  }, []);

  return { prefs, updatePrefs, loaded, reload };
}
