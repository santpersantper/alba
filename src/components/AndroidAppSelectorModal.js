import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAlbaTheme } from "../theme/ThemeContext";

/**
 * AndroidAppSelectorModal
 *
 * Shows a searchable list of all user-installed apps with checkboxes.
 * On confirm, calls onConfirm(selectedPackageNames: string[]).
 *
 * Props:
 *   visible          - boolean
 *   onClose          - () => void   (called on cancel or dismiss)
 *   onConfirm        - (packages: string[]) => void
 *   getInstalledApps - async () => Array<{ packageName, label }>
 */
export default function AndroidAppSelectorModal({
  visible,
  onClose,
  onConfirm,
  getInstalledApps,
  initialSelected = [],
}) {
  const { theme, isDark } = useAlbaTheme();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set(initialSelected));

  // Fetch installed apps when modal opens
  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setSelected(new Set(initialSelected));
    setLoading(true);
    getInstalledApps()
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.label.toLowerCase().includes(q));
  }, [apps, search]);

  const toggleApp = useCallback((pkg) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });
  }, []);

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
  };

  const renderItem = ({ item }) => {
    const checked = selected.has(item.packageName);
    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: isDark ? "#2a2a2a" : "#f0f0f0" }]}
        onPress={() => toggleApp(item.packageName)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.checkbox,
          checked
            ? { backgroundColor: "#2F91FF", borderColor: "#2F91FF" }
            : { backgroundColor: "transparent", borderColor: isDark ? "#555" : "#ccc" },
        ]}>
          {checked && <Feather name="check" size={13} color="#fff" />}
        </View>
        <Text style={[styles.appLabel, { color: theme.text }]} numberOfLines={1}>
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: isDark ? "#2a2a2a" : "#e8e8e8" }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.text }]}>Select apps to track</Text>
          <Text style={[styles.count, { color: "#2F91FF" }]}>{selected.size}</Text>
        </View>

        {/* Search */}
        <View style={[styles.searchWrap, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}>
          <Feather name="search" size={16} color={isDark ? "#888" : "#aaa"} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search apps…"
            placeholderTextColor={isDark ? "#555" : "#bbb"}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>

        {/* List */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#2F91FF" />
            <Text style={[styles.loadingText, { color: isDark ? "#888" : "#aaa" }]}>Loading apps…</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.packageName}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16 }}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: isDark ? "#666" : "#bbb" }]}>No apps found</Text>
            }
          />
        )}

        {/* Confirm button */}
        <View style={[styles.footer, { borderTopColor: isDark ? "#2a2a2a" : "#e8e8e8", backgroundColor: theme.background }]}>
          <TouchableOpacity
            style={[styles.confirmBtn, selected.size === 0 && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={selected.size === 0}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmText}>
              {selected.size === 0
                ? "Select at least one app"
                : `Confirm (${selected.size} app${selected.size === 1 ? "" : "s"})`}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontFamily: "PoppinsBold", fontSize: 16, flex: 1, textAlign: "center", marginHorizontal: 8 },
  count: { fontFamily: "PoppinsBold", fontSize: 15, minWidth: 22, textAlign: "right" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 14,
    marginVertical: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, fontFamily: "Poppins", fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  appLabel: { fontFamily: "Poppins", fontSize: 14, flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontFamily: "Poppins", fontSize: 14 },
  empty: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", marginTop: 40 },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  confirmBtn: {
    backgroundColor: "#2F91FF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmBtnDisabled: { backgroundColor: "#9DC5F7" },
  confirmText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
});
