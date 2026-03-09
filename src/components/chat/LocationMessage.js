// components/chat/LocationMessage.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Linking,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAlbaTheme } from "../../theme/ThemeContext";

export default function LocationMessage({ id, isMe, time, locationData, onDeleted }) {
  const { theme, isDark } = useAlbaTheme();

  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const lat = locationData?.lat;
  const lng = locationData?.lng;
  const address = locationData?.address || "Unknown location";

  const openMaps = () => {
    if (!lat || !lng) return;
    const label = encodeURIComponent(address);
    const url =
      Platform.OS === "ios"
        ? `maps:0,0?q=${label}@${lat},${lng}`
        : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) return Linking.openURL(url);
        // Fallback to Google Maps web
        return Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        );
      })
      .catch(() => {
        Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        );
      });
  };

  const runDelete = async () => {
    if (!id) { setConfirmVisible(false); return; }
    try {
      setDeleting(true);
      const { error } = await supabase.from("messages").delete().eq("id", id);
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch {
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  const alignStyle = isMe ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" };
  const cardBg = theme.gray;

  return (
    <>
      <View style={[styles.row, alignStyle]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => setMenuVisible(true)}
          delayLongPress={400}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderWidth: isDark ? 0 : 1,
                borderColor: isDark ? "transparent" : "#D9E6FF",
              },
            ]}
          >
            <View style={styles.innerRow}>
              <View style={[styles.iconCircle, { backgroundColor: "#4EBCFF22" }]}>
                <Ionicons name="location" size={24} color="#4EBCFF" />
              </View>
              <View style={styles.textCol}>
                <Text
                  style={[styles.addressText, { color: isDark ? "#FFFFFF" : "#111827" }]}
                  numberOfLines={2}
                >
                  {address}
                </Text>
                <TouchableOpacity
                  style={styles.mapsBtn}
                  activeOpacity={0.8}
                  onPress={openMaps}
                >
                  <Text style={styles.mapsBtnText}>Open on Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {!!time && (
          <Text style={[styles.timeText, { color: "#9CA3AF" }]}>{time}</Text>
        )}
      </View>

      {/* Long-press menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        />
        <View style={[styles.menuCard, { backgroundColor: isDark ? "#0F1720" : "#FFFFFF" }]}>
          <TouchableOpacity style={styles.menuItem} onPress={openMaps}>
            <Text style={[styles.menuText, { color: isDark ? "#E5E7EB" : "#111827" }]}>
              Open on Maps
            </Text>
          </TouchableOpacity>

          {isMe && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuVisible(false); setConfirmVisible(true); }}
            >
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>Delete</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.menuItem, { marginTop: 4 }]}
            onPress={() => setMenuVisible(false)}
          >
            <Text style={[styles.menuText, { color: "#6B7280" }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>
              Are you sure you want to delete this message?
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmBtnText}>Yes</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={styles.confirmBtnText}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { maxWidth: "80%", marginTop: 2, marginBottom: 6 },
  card: { borderRadius: 16, padding: 15, minWidth: 220 },
  innerRow: { flexDirection: "row", alignItems: "center" },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  textCol: { flex: 1 },
  addressText: {
    fontFamily: "Poppins",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    lineHeight: 18,
  },
  mapsBtn: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: "#4EBCFF",
    alignSelf: "flex-start",
  },
  mapsBtnText: { fontFamily: "Poppins", fontSize: 12, color: "#FFFFFF" },
  timeText: { marginTop: 2, fontSize: 11, alignSelf: "flex-end", fontFamily: "Poppins" },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  confirmCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  confirmTitle: { fontFamily: "Poppins", fontSize: 16, textAlign: "center", marginBottom: 14 },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "Poppins", fontSize: 15, fontWeight: "600" },

  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  menuCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },
});
