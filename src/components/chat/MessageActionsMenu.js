// components/MessageActionsMenu.js
import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useAlbaTheme } from "../theme/ThemeContext";

export default function MessageActionsMenu({
  visible,
  onClose,
  isSender,
  onPressReport,
  onPressForward,
  onPressDelete,
}) {
  const { theme } = useAlbaTheme();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOuter}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.inner,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <TouchableOpacity style={styles.item} onPress={onPressReport}>
            <Text style={[styles.text, { color: theme.text }]}>Report</Text>
          </TouchableOpacity>

          {isSender && (
            <>
              <TouchableOpacity style={styles.item} onPress={onPressForward}>
                <Text style={[styles.text, { color: theme.text }]}>
                  Forward
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.item} onPress={onPressDelete}>
                <Text
                  style={[
                    styles.text,
                    { color: "#ff4d4f", fontWeight: "600" },
                  ]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[styles.item, { marginTop: 6 }]}
            onPress={onClose}
          >
            <Text
              style={[
                styles.text,
                { color: theme.subtleText || theme.text },
              ]}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOuter: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  inner: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  item: {
    paddingVertical: 8,
  },
  text: {
    fontFamily: "Poppins",
    fontSize: 15,
  },
});
