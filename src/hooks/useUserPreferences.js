// useUserPreferences — persistent storage for premium feature flags.
// Storage key is scoped to the logged-in user so switching accounts
// never leaks one user's premium state to another.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";

export const PREFS_KEY = "alba_premium_prefs"; // legacy/fallback key

const DEFAULT_PREFS = {
  premiumAdFree: false,        // boolean — Ad-Free subscription active
  premiumTravelerMode: false,  // boolean — Traveler Mode subscription active
  travelerModeCity: null,      // string | null — display name e.g. "Tokyo, Japan"
  travelerModeCityCoords: null, // { lat, lng } | null — resolved coordinates
  // ── Diffusion List ──
  premiumDiffusionList: false,   // boolean — user paid for next diffusion message
  diffusionRadiusKm: 5,          // number — broadcast radius in km (1–50), default 5
  blockDiffusionMessages: false, // boolean — privacy setting; available to ALL users
  // ── Notifications ──
  notifChatMessages:  true,   // boolean — notify on new DMs
  notifGroupMessages: true,   // boolean — notify on new group messages
  notifDiffusion:     true,   // boolean — notify on diffusion messages
  notifFollowedPosts: true,   // boolean — notify on new posts from followed accounts
  // ── Screen Time (stored locally via AsyncStorage — usage data never sent to backend) ──
  screenTimeNotifsEnabled: true,
  screenTimeWarningMinutes: 10,
  screenTimeNotifHour: 8,
  screenTimeNotifMinute: 0,
  scheduledMorningNotifId: null,
  scheduledWeeklyNotifId: null,
  lastMorningScheduleHour: null,
  lastMorningScheduleMinute: null,
  lastWeeklyScheduleHour: null,
  lastWeeklyScheduleMinute: null,
  lastWeeklyReportDate: null,
  lastWeekTotalMinutes: 0,
  lastWeekDailyTotals: {},
  screenTimeGoalReductionPercent: 10,
  screenTimeGoalDailyMaxMinutes: 180,
  streakDays: {
    Mon: false, Tue: false, Wed: false,
    Thu: false, Fri: false, Sat: false, Sun: false,
  },
  currentStreakCount: 0,
  lastStreakUpdate: null,
  trackingStartDate: null,
  trackingActive: true,
  firstWeekComplete: false,
  firstWeekAverageDailyMinutes: null,
  goalAutoSet: false,
  dailyHistory: [],
};

export function useUserPreferences() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  // Ref so updatePrefs / reload closures always use the current key
  // without needing to be re-created every time the key changes.
  const storageKeyRef = useRef(PREFS_KEY);
  // Prevents reload() from running before the uid lookup has finished
  // and storageKeyRef has been set to the correct user-scoped key.
  const initialLoadDone = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id ?? null;
        const key = uid ? `alba_premium_prefs_${uid}` : PREFS_KEY;
        storageKeyRef.current = key;

        const raw = await AsyncStorage.getItem(key);
        if (mounted && raw) {
          try { setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) }); } catch {}
        }
      } catch {}
      if (mounted) {
        initialLoadDone.current = true;
        setLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const updatePrefs = useCallback(async (partial) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(next));
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    if (!initialLoadDone.current) return;
    try {
      const raw = await AsyncStorage.getItem(storageKeyRef.current);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {}
  }, []);

  return { prefs, updatePrefs, loaded, reload };
}
