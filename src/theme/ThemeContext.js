// theme/ThemeContext.js — DROP-IN (restores your palette + fixes mode updates)
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { lightTheme, darkTheme } from "./theme";

const ThemeContext = createContext({
  theme: lightTheme,
  isDark: false,
  mode: "auto",
  setMode: () => {},
});

const STORAGE_KEY = "alba_theme_mode";

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [mode, setModeState] = useState("auto"); // "auto" | "light" | "dark"
  const [loaded, setLoaded] = useState(false);

  // load saved mode
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === "auto" || saved === "light" || saved === "dark") {
          setModeState(saved);
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // persist mode
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode, loaded]);

  const resolvedScheme =
    mode === "auto" ? systemScheme : mode; // "light" | "dark" | null

  const isDark = resolvedScheme === "dark";
  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark]);

  const setMode = useCallbackSafe((next) => {
    // accept "system" as alias of "auto" (in case any screen uses it)
    const normalized = next === "system" ? "auto" : next;
    if (normalized !== "auto" && normalized !== "light" && normalized !== "dark") return;
    setModeState(normalized);
  });

  if (!loaded) return null;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark,
        mode,
        setMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

// tiny helper to avoid re-creating function identity via inline callback
function useCallbackSafe(fn) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return React.useCallback(fn, []);
}

export function useAlbaTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAlbaTheme must be used within a ThemeProvider");
  return ctx;
}
