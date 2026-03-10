// EventPanel.js
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
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
          borderColor: isDark ? "#555" : "#C8C8C8",
        },
        checked && styles.checkboxBoxChecked,
      ]}
    >
      {checked && <Feather name="check" size={12} color="#fff" />}
    </View>
    <Text style={[styles.checkboxLabel, { color: theme.text }]}>{label}</Text>
  </TouchableOpacity>
);

export default function EventPanel({ onState }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const inputBg = isDark ? "#1E1E1E" : "#FAFAFA";
  const borderColor = isDark ? "#444" : "#E0E0E0";

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
    <View style={[styles.panel, { backgroundColor: theme.background }]}>
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
                  <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                    <TextInput
                      value={ticket.name}
                      onChangeText={(v) => update(ticket.id, { name: v })}
                      placeholder={ticketPlaceholder}
                      placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                      style={[styles.input, { color: theme.text }]}
                    />
                  </View>

                  <CheckboxRow
                    label={t("event_free_label")}
                    checked={ticket.free}
                    onToggle={() => {
                      const nextFree = !ticket.free;
                      update(ticket.id, { free: nextFree, cost: nextFree ? "" : ticket.cost });
                    }}
                    style={{ marginLeft: 10 }}
                    theme={theme}
                    isDark={isDark}
                  />

                  {idx >= 1 && (
                    <TouchableOpacity
                      onPress={() => deleteRow(ticket.id)}
                      style={styles.deleteBtn}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Feather name="x" size={16} color={isDark ? "#D1D5DB" : "#999"} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Row 2: notes (flex) + cost */}
                <View style={styles.notesRow}>
                  <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                    <TextInput
                      value={ticket.notes}
                      onChangeText={(v) => update(ticket.id, { notes: v })}
                      placeholder="Notes (optional)"
                      placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                      style={[styles.input, { color: theme.text }]}
                    />
                  </View>
                  <Text style={[styles.costLabel, { color: theme.text }]}>
                    {t("event_cost_label")}
                  </Text>
                  <View
                    style={[
                      styles.costWrap,
                      {
                        borderColor: costDisabled
                          ? isDark ? "#3A3A3A" : "#E8E8E8"
                          : isDark ? "#555" : "#CFCFCF",
                        backgroundColor: costDisabled
                          ? isDark ? "#1A1A1A" : "#F5F5F5"
                          : inputBg,
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
            <Text style={[styles.sectionLabel, { color: isDark ? "#8C96A5" : "#888" }]}>
              {t("event_required_info_title")}
            </Text>
            <View style={[styles.inputWrap, { borderColor, backgroundColor: inputBg }]}>
              <TextInput
                value={requiredBuyerInfo}
                onChangeText={setRequiredBuyerInfo}
                placeholder={t("event_required_info_placeholder")}
                placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                style={[styles.input, { color: theme.text, minHeight: 60, textAlignVertical: "top" }]}
                multiline
              />
            </View>
          </View>

          <TouchableOpacity style={styles.addBtn} onPress={addRow}>
            <Feather name="plus" size={15} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.addBtnText}>{t("event_add_ticket_button")}</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Actions section */}
      <Text style={[styles.sectionLabel, { color: isDark ? "#8C96A5" : "#888", marginTop: 18 }]}>
        {t("event_actions_title")}
      </Text>
      <View>
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
    paddingTop: 14,
    marginTop: 12,
  },

  sectionLabel: {
    fontFamily: "PoppinsBold",
    fontSize: 10,
    marginBottom: 8,
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
  checkboxBoxChecked: { backgroundColor: "#2F91FF", borderColor: "#2F91FF" },
  checkboxLabel: { fontSize: 14, fontFamily: "Poppins" },

  ticketBlock: { marginTop: 10 },
  ticketRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notesRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
  },

  inputWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center",
  },
  input: {
    fontFamily: "Poppins",
    fontSize: 14,
  },

  costLabel: {
    fontSize: 13,
    fontFamily: "Poppins",
    flexShrink: 0,
  },
  costWrap: {
    width: 52,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: "center",
  },
  costInput: {
    fontSize: 14,
    fontFamily: "Poppins",
    width: "100%",
    textAlign: "center",
  },

  deleteBtn: {
    justifyContent: "center",
    alignItems: "center",
    padding: 4,
  },

  requiredInfoSection: { marginTop: 14 },

  addBtn: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    backgroundColor: "#2F91FF",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginTop: 14,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Poppins",
  },
});
