// useScreenTime — bridges AlbaScreenTimeModule (iOS native) with a React hook.
// On Android or when the native module is unavailable, returns mock data in development
// and an "unauthorized / not supported" state in production.
//
// Data shape (matches what AlbaScreenTimeModule writes to shared UserDefaults):
// {
//   lastUpdated: ISO string,
//   today: { totalMinutes: number, apps: { Instagram: {minutes}, TikTok: {minutes}, X: {minutes} } },
//   thisWeek: { totalMinutes: number, apps: { ... } },
//   dailyTotals: { Mon: number, Tue: number, Wed: number, Thu: number, Fri: number, Sat: number, Sun: number }
// }

import { useState, useEffect, useRef, useCallback } from "react";
import { NativeModules, Platform, AppState } from "react-native";

// ── Mock data used on Android / simulator without entitlements ──────────────
const MOCK_DATA = {
  lastUpdated: new Date().toISOString(),
  today: {
    totalMinutes: 119,
    apps: {
      Instagram: { minutes: 62, bundleId: "com.burbn.instagram" },
      TikTok: { minutes: 34, bundleId: "com.zhiliaoapp.musically" },
      X: { minutes: 23, bundleId: "com.atebits.Tweetie2" },
    },
  },
  thisWeek: {
    totalMinutes: 359,
    apps: {
      Instagram: { minutes: 182 },
      TikTok: { minutes: 122 },
      X: { minutes: 55 },
    },
  },
  dailyTotals: { Mon: 85, Tue: 72, Wed: 68, Thu: 71, Fri: 0, Sat: 0, Sun: 0 },
};

// ── Availability checks ──────────────────────────────────────────────────────
const AlbaScreenTimeModule = NativeModules.AlbaScreenTimeModule ?? null;
// Available on both iOS (AlbaScreenTimeModule.swift) and Android (AlbaScreenTimeModule.kt)
const IS_NATIVE_AVAILABLE = AlbaScreenTimeModule !== null;

export function useScreenTime() {
  const [authorized, setAuthorized] = useState(null); // null = unknown, true/false = known
  const [usageData, setUsageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollingRef = useRef(null);

  // ── Refresh usage data from native module ──────────────────────────────────
  // Calls refreshReport() which triggers the AlbaDeviceActivityReport extension
  // to write fresh per-app data to shared UserDefaults, then reads the result.
  // Falls back to getUsageData() (cheap read) if refreshReport is unavailable.
  const refreshUsageData = useCallback(async () => {
    if (!IS_NATIVE_AVAILABLE) {
      setUsageData({ ...MOCK_DATA, lastUpdated: new Date().toISOString() });
      return;
    }
    try {
      const method = AlbaScreenTimeModule.refreshReport ?? AlbaScreenTimeModule.getUsageData;
      const raw = await method.call(AlbaScreenTimeModule);
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      setUsageData(data);
    } catch (e) {
      setError(e?.message ?? "Failed to read usage data");
    }
  }, []);

  // ── Start 60-second polling interval ──────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      refreshUsageData();
    }, 60_000);
  }, [refreshUsageData]);

  // ── Start DeviceActivity monitoring (midnight → 23:59) ───────────────────
  const startMonitoring = useCallback(async () => {
    if (!IS_NATIVE_AVAILABLE) return;
    try {
      await AlbaScreenTimeModule.startMonitoring({
        startHour: 0,
        startMinute: 0,
        endHour: 23,
        endMinute: 59,
      });
    } catch (e) {
      setError(e?.message ?? "Failed to start monitoring");
    }
  }, []);

  // ── Stop monitoring ────────────────────────────────────────────────────────
  const stopMonitoring = useCallback(async () => {
    if (!IS_NATIVE_AVAILABLE) return;
    try {
      await AlbaScreenTimeModule.stopMonitoring();
    } catch (e) {
      setError(e?.message ?? "Failed to stop monitoring");
    }
  }, []);

  // ── Re-open FamilyActivityPicker to change tracked apps ───────────────────
  const requestAppSelection = useCallback(async () => {
    if (!IS_NATIVE_AVAILABLE) return true; // no-op on mock path
    try {
      await AlbaScreenTimeModule.requestAppSelection();
      return true;
    } catch (e) {
      setError(e?.message ?? "App selection failed");
      return false;
    }
  }, []);

  // ── Request FamilyControls authorization ─────────────────────────────────
  const requestAuthorization = useCallback(async () => {
    if (!IS_NATIVE_AVAILABLE) {
      // Mock: in dev, immediately grant authorization
      setAuthorized(true);
      setUsageData({ ...MOCK_DATA, lastUpdated: new Date().toISOString() });
      return true;
    }
    try {
      setLoading(true);
      await AlbaScreenTimeModule.requestAuthorization();
      // On iOS the authorization dialog is synchronous — granted by the time we resume.
      // On Android the native call opens Settings and resolves immediately; the AppState
      // listener in the mount effect handles re-checking when the user returns.
      if (Platform.OS !== "android") {
        setAuthorized(true);
        await startMonitoring();
        await refreshUsageData();
        startPolling();
      }
      return true;
    } catch (e) {
      setError(e?.message ?? "Authorization failed");
      setAuthorized(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [startMonitoring, refreshUsageData, startPolling]);

  // ── Mount: check authorization status ────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      // No native module available at all (e.g. bare JS bundle without native build)
      if (!IS_NATIVE_AVAILABLE) {
        if (__DEV__) {
          // Development: show mock data so the screen is testable
          setAuthorized(true);
          setUsageData({ ...MOCK_DATA, lastUpdated: new Date().toISOString() });
        } else {
          setAuthorized(false);
        }
        setLoading(false);
        return;
      }

      try {
        const result = await AlbaScreenTimeModule.getAuthorizationStatus();
        const isAuth = result?.authorized === true;
        if (!mounted) return;
        setAuthorized(isAuth);
        if (isAuth) {
          await refreshUsageData();
          startPolling();
        }
      } catch (e) {
        if (mounted) setError(e?.message ?? "Failed to get authorization status");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    checkAuth();

    // On Android, requestAuthorization() opens the OS Settings screen.
    // Re-check when the app comes back to the foreground so the UI updates
    // immediately after the user grants Usage Access.
    let appStateSub = null;
    if (Platform.OS === "android" && IS_NATIVE_AVAILABLE) {
      appStateSub = AppState.addEventListener("change", (nextState) => {
        if (nextState === "active" && mounted) {
          checkAuth();
        }
      });
    }

    return () => {
      mounted = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (appStateSub) appStateSub.remove();
    };
  }, [refreshUsageData, startPolling]);

  return {
    authorized,
    usageData,
    requestAuthorization,
    requestAppSelection,
    startMonitoring,
    stopMonitoring,
    refreshUsageData,
    loading,
    error,
  };
}
