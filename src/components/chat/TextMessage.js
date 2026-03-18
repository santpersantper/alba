// components/chat/TextMessage.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { supabase } from "../../lib/supabase";
import ShareMenu from "../ShareMenu";
import { useAlbaTheme } from "../../theme/ThemeContext";
import { useAlbaLanguage } from "../../theme/LanguageContext";
import { translateText } from "../../utils/translate";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";

export default function TextMessage({ id, text, time, isMe = false, isAdmin = false, onDeleted, senderName, senderUsername, groupId, onKick, failed = false, onRetry }) {
  const { theme, isDark } = useAlbaTheme();
  const { language, t } = useAlbaLanguage();

  const [menuVisible, setMenuVisible] = useState(false);
  const [translated, setTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [reportVisible, setReportVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

  const openReport = () => {
    setMenuVisible(false);
    setReportVisible(true);
  };

  const submitReport = () => {
    console.log("REPORT text message", { messageId: id, text, reason: reportText });
    setReportText("");
    setReportVisible(false);
    Alert.alert("", "Thanks for your report.");
  };

  const openDeleteConfirm = () => {
    setMenuVisible(false);
    setConfirmVisible(true);
  };

  const runDelete = async () => {
    if (!id) {
      setConfirmVisible(false);
      return;
    }
    try {
      setDeleting(true);
      console.log("[Delete] attempting delete, message id:", id);
      const { error } = await supabase.rpc("delete_chat_message", { p_message_id: id });
      console.log("[Delete] rpc result — error:", error ? error.message : null);
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch (e) {
      console.warn("Text delete failed", e?.message || e);
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  const handleTranslate = async () => {
    if (translated) { setTranslated(false); return; }
    if (!text) return;
    setTranslating(true);
    try {
      const result = await translateText(text, language);
      setTranslatedText(result);
      setTranslated(true);
    } catch {
      setTranslated(false);
    } finally {
      setTranslating(false);
    }
  };

  const openForward = () => {
    setMenuVisible(false);
    setShareVisible(true);
  };

  const openKick = () => {
    setMenuVisible(false);
    Alert.alert(
      "Remove from group",
      `Remove @${senderUsername} from this group?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => onKick?.(senderUsername),
        },
      ]
    );
  };

  // ✅ requested: other people's bubbles use theme.gray on dark mode
  const otherBubbleBg = isDark ? "#363C47" : styles.bubbleOther.backgroundColor;

  if (failed) {
    return (
      <View style={[styles.row, { justifyContent: "flex-end" }]}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onRetry}
          style={{ maxWidth: "78%", alignItems: "flex-end" }}
        >
          <View style={[styles.bubble, styles.bubbleOther, { backgroundColor: isDark ? "#363C47" : styles.bubbleOther.backgroundColor }]}>
            <Text style={[styles.msgText, { color: isDark ? "#fff" : "#1A1F27" }]}>{text}</Text>
          </View>
          <Text style={styles.failedCaption}>Message not sent. Tap to retry.</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <View
        style={[
          styles.row,
          {
            alignItems: "flex-end",
            justifyContent: isMe ? "flex-end" : "flex-start",
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => setMenuVisible(true)}
          delayLongPress={400}
          style={{
            maxWidth: "78%",
            alignItems: isMe ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={[
              styles.bubble,
              isMe ? styles.bubbleMe : styles.bubbleOther,
              !isMe ? { backgroundColor: otherBubbleBg } : null, // ✅ override only for "other" on dark
            ]}
          >
            {!isMe && senderName ? (
              <Text style={[styles.senderName, { color: isDark ? "#A8B4C4" : "#374151" }]}>{senderName}</Text>
            ) : null}
            <Text
              style={[
                styles.msgText,
                isMe ? { color: "#fff" } : { color: isDark ? "#fff" : "#1A1F27" },
              ]}
            >
              {translated && translatedText ? translatedText : text}
            </Text>
          </View>
          <View style={styles.timeLine}>
            <Text style={styles.time}>{time}</Text>
            {!isMe && (
              <TouchableOpacity
                onPress={handleTranslate}
                disabled={translating}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                {translating
                  ? <ActivityIndicator size="small" color="#59A7FF" style={{ width: 14, height: 14 }} />
                  : <MaterialCommunityIcons
                      name="translate"
                      size={14}
                      color={translated ? "#59A7FF" : "#A2AAB4"}
                    />
                }
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* bottom sheet menu */}
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
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={openReport}>
            <Text style={styles.menuText}>Report</Text>
          </TouchableOpacity>

          {isMe && (
            <TouchableOpacity style={styles.menuItem} onPress={openForward}>
              <Text style={styles.menuText}>Forward</Text>
            </TouchableOpacity>
          )}

          {isAdmin && !isMe && onKick && senderUsername && (
            <TouchableOpacity style={styles.menuItem} onPress={openKick}>
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>Remove from group</Text>
            </TouchableOpacity>
          )}

          {(isMe || isAdmin) && (
            <TouchableOpacity style={styles.menuItem} onPress={openDeleteConfirm}>
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

      {/* report modal */}
      <Modal
        visible={reportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>{t("report_message_title")}</Text>
            <TextInput
              style={styles.reportInput}
              placeholder={t("report_group_placeholder")}
              placeholderTextColor="#9CA3AF"
              value={reportText}
              onChangeText={setReportText}
              multiline
            />
            <View style={styles.reportRow}>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setReportVisible(false)}
              >
                <Text style={styles.reportBtnText}>{t("cancel_button")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.reportBtn,
                  { backgroundColor: "#3D8BFF", opacity: reportText.trim() ? 1 : 0.6 },
                ]}
                onPress={submitReport}
                disabled={!reportText.trim()}
              >
                <Text style={styles.reportBtnText}>{t("submit_button")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* delete confirm */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Are you sure you want to delete this message?</Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 },
                ]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Yes</Text>}
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

      {/* forward */}
      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        onSent={() => setShareVisible(false)}
        defaultMessage={text}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 10,
  },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  bubbleMe: { backgroundColor: "#74AEE7", borderTopRightRadius: 4 },
  bubbleOther: { backgroundColor: "#EAEFF4", borderTopLeftRadius: 4 },
  senderName: {
    fontSize: 12,
    fontFamily: "PoppinsBold",
    color: "#374151",
    marginBottom: 3,
    paddingBottom: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  msgText: { fontSize: 14, lineHeight: 20, fontFamily: "Poppins" },
  line1: { width: "100%", flexDirection: "row", alignItems: "flex-end" },
  line2: { width: "100%", marginTop: 3 },
  timeLine: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    gap: 4,
  },
  time: {
    fontSize: 11,
    color: "#A2AAB4",
    fontFamily: "Poppins",
  },
  failedCaption: {
    fontSize: 11,
    color: "#E05252",
    fontFamily: "Poppins",
    marginTop: 3,
  },

  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
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
    backgroundColor: "#FFFFFF",
  },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  reportCard: {
    width: "100%",
    borderRadius: 14,
    padding: 16,
    backgroundColor: "#FFFFFF",
  },
  reportTitle: {
    fontFamily: "Poppins",
    fontSize: 16,
    marginBottom: 10,
    textAlign: "center",
  },
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

  confirmCard: {
    width: "100%",
    borderRadius: 14,
    padding: 16,
    backgroundColor: "#FFFFFF",
  },
  confirmTitle: {
    fontFamily: "Poppins",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 14,
  },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 15 },
});
