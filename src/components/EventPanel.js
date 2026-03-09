// EventPanel.js — same aesthetics, new behavior
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const CheckboxRow = ({ label, checked, onToggle, style, theme, isDark }) => (
  <TouchableOpacity
    onPress={onToggle}
    activeOpacity={0.8}
    style={[styles.checkboxRow, style]}
  >
    <View
      style={[
        styles.checkboxBox,
        {
          backgroundColor: isDark ? "#2B2B2B" : "#fff",
          borderColor: isDark ? "#FFFFFF" : "#B8B8B8",
        },
        checked && styles.checkboxBoxChecked,
      ]}
    >
      {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
    </View>
    <Text
      style={[
        styles.checkboxLabel,
        { color: theme.text },
      ]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

export default function EventPanel({ onState }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [enableGroupChat, setEnableGroupChat] = useState(true);
  const [allowTicketing, setAllowTicketing] = useState(true);

  const idRef = useRef(3);
  const [tickets, setTickets] = useState([
    { id: 1, name: "", free: true, cost: "", notes: "" },
    { id: 2, name: "", free: false, cost: "", notes: "" },
  ]);

  const update = (id, patch) =>
    setTickets((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const addRow = () =>
    setTickets((t) => [
      ...t,
      { id: idRef.current++, name: "", free: false, cost: "", notes: "" },
    ]);

  const deleteRow = (id) => setTickets((t) => t.filter((x) => x.id !== id));

  const [requiredBuyerInfo, setRequiredBuyerInfo] = useState("");

  // NEW: extra actions
  const [allowSubgroups, setAllowSubgroups] = useState(false);
  const [allowInvites, setAllowInvites] = useState(false);

  // Emit state upwards
  useEffect(() => {
    onState?.({
      enableGroupChat,
      allowTicketing,
      tickets,
      requiredBuyerInfo,
      allowSubgroups,
      allowInvites,
    });
  }, [
    enableGroupChat,
    allowTicketing,
    tickets,
    requiredBuyerInfo,
    allowSubgroups,
    allowInvites,
    onState,
  ]);

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.backgroundColor },
      ]}
    >
      <CheckboxRow
        label={t("event_checkbox_group_chat")}
        checked={enableGroupChat}
        onToggle={() => setEnableGroupChat((v) => !v)}
        theme={theme}
        isDark={isDark}
      />
      <CheckboxRow
        label={t("event_checkbox_ticketing")}
        checked={allowTicketing}
        onToggle={() => setAllowTicketing((v) => !v)}
        style={{ marginTop: 10 }}
        theme={theme}
        isDark={isDark}
      />

      {allowTicketing && (
        <>
          {tickets.map((ticket, idx) => {
            const costDisabled = ticket.free;

            const ticketPlaceholder =
              idx === 0
                ? t("event_ticket_general")
                : idx === 1
                ? t("event_ticket_vip")
                : t("event_ticket_name");

            return (
              <View key={ticket.id} style={styles.ticketBlock}>
                {/* Row 1: name + free + delete */}
                <View style={styles.ticketRow}>
                  <View
                    style={[
                      styles.ticketNameWrap,
                      {
                        backgroundColor: isDark ? "#2B2B2B" : "#fff",
                        borderColor: isDark ? "#FFFFFF" : "#D9D9D9",
                      },
                    ]}
                  >
                    <TextInput
                      value={ticket.name}
                      onChangeText={(v) => update(ticket.id, { name: v })}
                      placeholder={ticketPlaceholder}
                      placeholderTextColor={isDark ? "#8C96A5" : "#8F8F8F"}
                      style={[styles.ticketName, { color: theme.text }]}
                    />
                  </View>

                  <CheckboxRow
                    label={t("event_free_label")}
                    checked={ticket.free}
                    onToggle={() => {
                      const nextFree = !ticket.free;
                      update(ticket.id, { free: nextFree, cost: nextFree ? "" : ticket.cost });
                    }}
                    style={{ marginLeft: 12, marginRight: 4 }}
                    theme={theme}
                    isDark={isDark}
                  />

                  {idx >= 1 && (
                    <TouchableOpacity
                      onPress={() => deleteRow(ticket.id)}
                      style={styles.deleteBtn}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="close" size={18} color={isDark ? "#D1D5DB" : "#777"} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Row 2: notes (flex) + cost */}
                <View style={styles.notesRow}>
                  <TextInput
                    value={ticket.notes}
                    onChangeText={(v) => update(ticket.id, { notes: v })}
                    placeholder="Notes (optional)"
                    placeholderTextColor={isDark ? "#8C96A5" : "#8F8F8F"}
                    style={[
                      styles.notesInput,
                      {
                        color: theme.text,
                        borderColor: isDark ? "#555" : "#D9D9D9",
                        backgroundColor: isDark ? "#2B2B2B" : "#fff",
                      },
                    ]}
                  />
                  <Text style={[styles.costLabel, { color: theme.text }]}>
                    {t("event_cost_label")}
                  </Text>
                  <View
                    style={[
                      styles.costBox,
                      {
                        borderColor: costDisabled
                          ? isDark ? "#555C69" : "#E0E0E0"
                          : isDark ? "#FFFFFF" : "#CFCFCF",
                      },
                    ]}
                    pointerEvents={costDisabled ? "none" : "auto"}
                  >
                    <TextInput
                      editable={!costDisabled}
                      value={ticket.cost}
                      onChangeText={(v) => update(ticket.id, { cost: v })}
                      keyboardType="numeric"
                      placeholder={costDisabled ? "" : "0"}
                      placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                      style={[
                        styles.costInput,
                        { color: costDisabled ? (isDark ? "#6D7584" : "#BFBFBF") : theme.text },
                      ]}
                    />
                  </View>
                </View>
              </View>
            );
          })}

          {/* Required buyer info */}
          <View style={styles.requiredInfoSection}>
            <Text
              style={[
                styles.requiredInfoTitle,
                { color: theme.text },
              ]}
            >
              {t("event_required_info_title")}
            </Text>
            <View
              style={[
                styles.requiredInfoBox,
                {
                  backgroundColor: isDark ? "#2B2B2B" : "#fff",
                  borderColor: isDark ? "#FFFFFF" : "#D9D9D9",
                },
              ]}
            >
              <TextInput
                value={requiredBuyerInfo}
                onChangeText={setRequiredBuyerInfo}
                placeholder={t("event_required_info_placeholder")}
                placeholderTextColor={isDark ? "#8C96A5" : "#8F8F8F"}
                style={[
                  styles.requiredInfoInput,
                  { color: theme.text },
                ]}
                multiline
              />
            </View>
          </View>

          <TouchableOpacity style={styles.addBtn} onPress={addRow}>
            <Text style={styles.addBtnText}>
              {t("event_add_ticket_button")}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {/* Select actions: ONLY the two new toggles, same look */}
      <Text
        style={[
          styles.actionsTitle,
          { color: theme.text },
        ]}
      >
        {t("event_actions_title")}
      </Text>
      <View style={{ marginTop: 8 }}>
        <CheckboxRow
          label={t("event_action_allow_subgroups")}
          checked={allowSubgroups}
          onToggle={() => setAllowSubgroups((v) => !v)}
          theme={theme}
          isDark={isDark}
        />
        <CheckboxRow
          label={t("event_action_allow_invites")}
          checked={allowInvites}
          onToggle={() => setAllowInvites((v) => !v)}
          style={{ marginTop: 8 }}
          theme={theme}
          isDark={isDark}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  checkboxRow: { flexDirection: "row", alignItems: "center" },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  checkboxBoxChecked: { backgroundColor: "#3D8BFF", borderColor: "#3D8BFF" },
  checkboxLabel: { fontSize: 14, fontFamily: "Poppins" },

  ticketBlock: { marginTop: 12 },
  ticketRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  notesRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  notesInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    fontFamily: "Poppins",
  },
  ticketNameWrap: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    justifyContent: "center",
  },
  ticketName: { fontSize: 14, fontFamily: "Poppins" },

  costLabel: {
    fontSize: 14,
    marginLeft: 6,
    marginRight: 6,
    fontFamily: "Poppins",
  },
  costBox: {
    width: 40,
    height: 34,
    borderBottomWidth: 1,
    justifyContent: "center",
  },
  costInput: {
    fontSize: 14,
    paddingVertical: 4,
    fontFamily: "Poppins",
  },

  deleteBtn: {
    marginLeft: 6,
    justifyContent: "center",
    alignItems: "center",
  },

  requiredInfoSection: { marginTop: 14 },
  requiredInfoTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 6,
    fontFamily: "Poppins",
  },
  requiredInfoBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    justifyContent: "center",
  },
  requiredInfoInput: {
    fontSize: 14,
    fontFamily: "Poppins",
  },

  addBtn: {
    alignSelf: "center",
    backgroundColor: "#59A7FF",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    marginTop: 14,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Poppins",
  },
  actionsTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Poppins",
  },
});
