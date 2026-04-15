// components/SharedPostView.js

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

export default function SharedPostView({
  sharePostId,
  sharerUsername,
  originalPostType,
  comment,
  onDeleted,
}) {
  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  // Determine ownership directly — don't rely on prop passed through Post.js
  const [isOwn, setIsOwn] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!alive || !data?.user) return;
        const { data: sharePost } = await supabase
          .from("posts")
          .select("author_id")
          .eq("id", sharePostId)
          .maybeSingle();
        if (alive && sharePost?.author_id === data.user.id) setIsOwn(true);
      } catch {}
    })();
    return () => { alive = false; };
  }, [sharePostId]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dotBtnRef = useRef(null);

  const label = `@${sharerUsername}`;

  const handleDelete = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("delete_share", {
        p_share_post_id: sharePostId,
      });
      if (error) throw error;
      onDeleted?.();
    } catch {
      Alert.alert("", t("share_error") || "Could not delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Feather name="repeat" size={13} color={isDark ? "#7B8CA6" : "#6B7A96"} style={{ marginRight: 6 }} />
        <Text style={[styles.label, { color: isDark ? "#CBD5E0" : "#374151", flex: 1 }]} numberOfLines={1}>
          {label}
        </Text>

        {/* Three-dot — only for the person who shared */}
        {isOwn && (
          <TouchableOpacity
            ref={dotBtnRef}
            onPress={() => {
              dotBtnRef.current?.measure((_fx, _fy, width, height, px, py) => {
                setMenuPos({ top: py + height + 4, right: 8 });
                setMenuOpen(true);
              });
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="more-vertical" size={15} color={isDark ? "#9CA3AF" : "#6B7280"} />
          </TouchableOpacity>
        )}
      </View>

      {/* Comment */}
      {!!comment && (
        <Text style={[styles.comment, { color: isDark ? "#E2E8F0" : "#1F2937" }]}>
          {comment}
        </Text>
      )}

      {/* Dropdown menu */}
      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuCard, { backgroundColor: isDark ? "#333333" : "#FFFFFF", top: menuPos.top, right: menuPos.right }]}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { setMenuOpen(false); setConfirmOpen(true); }}
          >
            <Feather name="trash-2" size={16} color="#d23b3b" style={{ marginRight: 8 }} />
            <Text style={[styles.menuText, { color: "#d23b3b" }]}>
              {t("share_delete_menu") || "Delete share"}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: isDark ? "#1E2330" : "#fff" }]}>
            <Text style={[styles.confirmTitle, { color: theme.text }]}>
              {t("confirm_delete_title") || "Delete this share?"}
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={handleDelete}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmBtnText}>{t("confirm_yes") || "Yes"}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setConfirmOpen(false)}
              >
                <Text style={styles.confirmBtnText}>{t("confirm_no") || "No"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  label: {
    fontFamily: "PoppinsBold",
    fontSize: 11,
  },
  comment: {
    fontFamily: "Poppins",
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  menuBackdrop: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "transparent",
  },
  menuCard: {
    position: "absolute",
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 180,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  menuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  menuText: {
    fontFamily: "Poppins",
    fontSize: 14,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  confirmCard: {
    width: "100%",
    borderRadius: 14,
    padding: 16,
  },
  confirmTitle: {
    fontFamily: "Poppins",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 14,
  },
  confirmRow: {
    flexDirection: "row",
    gap: 10,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  confirmBtnText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
});
