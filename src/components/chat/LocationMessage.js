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
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAlbaTheme } from "../../theme/ThemeContext";
import { useAlbaLanguage } from "../../theme/LanguageContext";

export default function LocationMessage({ id, isMe, time, locationData, onDeleted, failed = false, onRetry, isAdmin = false, onKick, senderUsername, groupId }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [kickVisible, setKickVisible] = useState(false);

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

  const openReport = () => {
    setMenuVisible(false);
    setReportVisible(true);
  };

  const submitReport = () => {
    setReportText("");
    setReportVisible(false);
    Alert.alert("", "Thanks for your report.");
  };

  const openDeleteConfirm = () => {
    setMenuVisible(false);
    setConfirmVisible(true);
  };

  const runDelete = async () => {
    if (!id) { setConfirmVisible(false); return; }
    try {
      setDeleting(true);
      const { error } = await supabase.rpc("delete_chat_message", { p_message_id: id });
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch {
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  const handleRemoveFromGroup = () => {
    setMenuVisible(false);
    setKickVisible(true);
  };

  const alignStyle = isMe ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" };
  const cardBg = theme.gray;

  return (
    <>
      <View style={[styles.row, alignStyle]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={failed ? onRetry : undefined}
          onLongPress={failed ? undefined : () => setMenuVisible(true)}
          delayLongPress={400}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: isDark ? "#2D3748" : "#E0E4EA",
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
        {failed && (
          <Text style={styles.failedCaption}>Message not sent. Tap to retry.</Text>
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
              {t("menu_open_maps") || "Open on Maps"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={openReport}>
            <Text style={[styles.menuText, { color: isDark ? "#E5E7EB" : "#111827" }]}>{t("menu_report") || "Report"}</Text>
          </TouchableOpacity>

          {isAdmin && !isMe && onKick && senderUsername && (
            <TouchableOpacity style={styles.menuItem} onPress={handleRemoveFromGroup}>
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>{t("menu_remove_from_group") || "Remove from group"}</Text>
            </TouchableOpacity>
          )}

          {(isMe || isAdmin) && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={openDeleteConfirm}
            >
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>{t("menu_delete") || "Delete"}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.menuItem, { marginTop: 4 }]}
            onPress={() => setMenuVisible(false)}
          >
            <Text style={[styles.menuText, { color: "#6B7280" }]}>{t("cancel_button") || "Cancel"}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Report modal */}
      <Modal
        visible={reportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.reportCard, { backgroundColor: isDark ? "#1A2030" : "#FFFFFF" }]}>
            <Text style={[styles.reportTitle, { color: isDark ? "#E5E7EB" : "#111827" }]}>{t("report_message_title") || "Report message"}</Text>
            <TextInput
              style={[styles.reportInput, { color: isDark ? "#E5E7EB" : "#111827", borderColor: isDark ? "#2D3748" : "#E5E7EB" }]}
              placeholder={t("report_group_placeholder") || "Tell us what's wrong..."}
              placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
              value={reportText}
              onChangeText={setReportText}
              multiline
            />
            <View style={styles.reportRow}>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: isDark ? "#374151" : "#b0b6c0" }]}
                onPress={() => setReportVisible(false)}
              >
                <Text style={styles.reportBtnText}>{t("cancel_button") || "Cancel"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: "#3D8BFF", opacity: reportText.trim() ? 1 : 0.6 }]}
                onPress={submitReport}
                disabled={!reportText.trim()}
              >
                <Text style={styles.reportBtnText}>{t("submit_button") || "Submit"}</Text>
              </TouchableOpacity>
            </View>
          </View>
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
          <View style={[styles.confirmCard, { backgroundColor: isDark ? "#1A2030" : "#FFFFFF" }]}>
            <Text style={[styles.confirmTitle, { color: isDark ? "#E5E7EB" : "#111827" }]}>
              {t("confirm_delete_message") || "Are you sure you want to delete this message?"}
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
                  <Text style={styles.confirmBtnText}>{t("confirm_yes") || "Yes"}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: isDark ? "#374151" : "#b0b6c0" }]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={styles.confirmBtnText}>{t("confirm_no") || "No"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Remove from group confirm */}
      <Modal
        visible={kickVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setKickVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: isDark ? "#1A2030" : "#FFFFFF" }]}>
            <Text style={[styles.confirmTitle, { color: isDark ? "#E5E7EB" : "#111827" }]}>
              {(t("confirm_remove_user") || "Remove {user} from this group?").replace("{user}", senderUsername)}
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#EF4444" }]}
                onPress={() => { setKickVisible(false); onKick?.(senderUsername); }}
              >
                <Text style={styles.confirmBtnText}>{t("confirm_remove") || "Remove"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: isDark ? "#374151" : "#b0b6c0" }]}
                onPress={() => setKickVisible(false)}
              >
                <Text style={styles.confirmBtnText}>{t("cancel_button") || "Cancel"}</Text>
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
    fontFamily: "PoppinsBold",
    fontSize: 13,
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
  failedCaption: { fontSize: 11, color: "#E05252", fontFamily: "Poppins", marginTop: 2, alignSelf: "flex-end" },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  confirmCard: { width: "100%", borderRadius: 14, padding: 16 },
  confirmTitle: { fontFamily: "Poppins", fontSize: 16, textAlign: "center", marginBottom: 14 },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },

  reportCard: { width: "100%", borderRadius: 14, padding: 16 },
  reportTitle: { fontFamily: "Poppins", fontSize: 16, marginBottom: 10, textAlign: "center" },
  reportInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    minHeight: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Poppins",
    fontSize: 14,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  reportRow: { flexDirection: "row", gap: 10 },
  reportBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  reportBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },

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
