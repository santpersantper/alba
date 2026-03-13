// EventPanel.js
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const CheckboxRow = ({ label, checked, onToggle, style, theme, isDark }) => (
  <TouchableOpacity onPress={onToggle} activeOpacity={0.8} style={[styles.checkboxRow, style]}>
    <View
      style={[
        styles.checkboxBox,
        { backgroundColor: isDark ? "#2B2B2B" : "#fff", borderColor: isDark ? "#555" : "#C8C8C8" },
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
  const settingsBg = isDark ? "#161616" : "#F2F3F5";

  const [enableGroupChat, setEnableGroupChat] = useState(true);
  const [allowTicketing, setAllowTicketing] = useState(true);
  const [isAgeRestricted, setIsAgeRestricted] = useState(false);

  const ticketIdRef = useRef(3);
  const optionIdRef = useRef(100);

  const [tickets, setTickets] = useState([
    { id: 1, name: "", free: true,  cost: "", settingsOpen: false, notes: "", options: [], requiredInfo: "" },
    { id: 2, name: "", free: false, cost: "", settingsOpen: false, notes: "", options: [], requiredInfo: "" },
  ]);

  const [sameRequiredInfo, setSameRequiredInfo] = useState(false);
  const [allowSubgroups, setAllowSubgroups] = useState(false);
  const [allowInvites, setAllowInvites] = useState(false);

  const updateTicket = (id, patch) =>
    setTickets((ts) => ts.map((tk) => (tk.id === id ? { ...tk, ...patch } : tk)));

  const addTicket = () =>
    setTickets((ts) => [
      ...ts,
      { id: ticketIdRef.current++, name: "", free: false, cost: "", settingsOpen: false, notes: "", options: [], requiredInfo: "" },
    ]);

  const deleteTicket = (id) => setTickets((ts) => ts.filter((tk) => tk.id !== id));

  const addOption = (ticketId) =>
    setTickets((ts) =>
      ts.map((tk) =>
        tk.id === ticketId
          ? { ...tk, options: [...tk.options, { id: optionIdRef.current++, name: "", extraCost: "", free: true }] }
          : tk
      )
    );

  const updateOption = (ticketId, optId, patch) =>
    setTickets((ts) =>
      ts.map((tk) =>
        tk.id === ticketId
          ? { ...tk, options: tk.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) }
          : tk
      )
    );

  const deleteOption = (ticketId, optId) =>
    setTickets((ts) =>
      ts.map((tk) =>
        tk.id === ticketId ? { ...tk, options: tk.options.filter((o) => o.id !== optId) } : tk
      )
    );

  useEffect(() => {
    const firstRI = tickets[0]?.requiredInfo || "";
    const normalizedTickets = tickets.map((tk) => ({
      ...tk,
      requiredInfo: sameRequiredInfo ? firstRI : tk.requiredInfo,
    }));
    onState?.({ enableGroupChat, allowTicketing, isAgeRestricted, tickets: normalizedTickets, allowSubgroups, allowInvites });
  }, [enableGroupChat, allowTicketing, isAgeRestricted, tickets, sameRequiredInfo, allowSubgroups, allowInvites, onState]);

  return (
    <View style={[styles.panel, { backgroundColor: theme.background }]}>
      <CheckboxRow label={t("event_checkbox_group_chat")} checked={enableGroupChat} onToggle={() => setEnableGroupChat((v) => !v)} theme={theme} isDark={isDark} />
      <CheckboxRow label={t("event_checkbox_ticketing")} checked={allowTicketing} onToggle={() => setAllowTicketing((v) => !v)} style={{ marginTop: 10 }} theme={theme} isDark={isDark} />

      {allowTicketing && (
        <>
          <CheckboxRow label="+18 only event" checked={isAgeRestricted} onToggle={() => setIsAgeRestricted((v) => !v)} style={{ marginTop: 10 }} theme={theme} isDark={isDark} />

          {tickets.map((ticket, idx) => {
            const ticketPlaceholder = idx === 0 ? t("event_ticket_general") : idx === 1 ? t("event_ticket_vip") : t("event_ticket_name");
            return (
              <View key={ticket.id} style={styles.ticketBlock}>
                {/* Row 1: name + free + delete */}
                <View style={styles.ticketRow}>
                  <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                    <TextInput
                      value={ticket.name}
                      onChangeText={(v) => updateTicket(ticket.id, { name: v })}
                      placeholder={ticketPlaceholder}
                      placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                      style={[styles.input, { color: theme.text }]}
                    />
                  </View>
                  <CheckboxRow
                    label={t("event_free_label")}
                    checked={ticket.free}
                    onToggle={() => updateTicket(ticket.id, { free: !ticket.free, cost: !ticket.free ? "" : ticket.cost })}
                    style={{ marginLeft: 10 }}
                    theme={theme}
                    isDark={isDark}
                  />
                  {idx >= 1 && (
                    <TouchableOpacity onPress={() => deleteTicket(ticket.id)} style={styles.deleteBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Feather name="x" size={16} color={isDark ? "#D1D5DB" : "#999"} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Row 2: cost (only if not free) */}
                {!ticket.free && (
                  <View style={[styles.costRow]}>
                    <Text style={[styles.costLabel, { color: theme.text }]}>{t("event_cost_label")}</Text>
                    <View style={[styles.costWrap, { borderColor: isDark ? "#555" : "#CFCFCF", backgroundColor: inputBg }]}>
                      <TextInput
                        value={ticket.cost}
                        onChangeText={(v) => updateTicket(ticket.id, { cost: v })}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                        style={[styles.costInput, { color: theme.text }]}
                      />
                    </View>
                  </View>
                )}

                {/* Ticket settings toggle */}
                <TouchableOpacity
                  style={styles.settingsToggle}
                  onPress={() => updateTicket(ticket.id, { settingsOpen: !ticket.settingsOpen })}
                  activeOpacity={0.8}
                >
                  <Feather name="sliders" size={12} color="#2F91FF" style={{ marginRight: 4 }} />
                  <Text style={styles.settingsToggleText}>Ticket settings</Text>
                  <Feather name={ticket.settingsOpen ? "chevron-up" : "chevron-down"} size={13} color="#2F91FF" style={{ marginLeft: 3 }} />
                </TouchableOpacity>

                {ticket.settingsOpen && (
                  <View style={[styles.settingsSection, { borderColor, backgroundColor: settingsBg }]}>
                    {/* Notes */}
                    <Text style={[styles.settingsLabel, { color: isDark ? "#8C96A5" : "#888" }]}>Notes</Text>
                    <View style={[styles.inputWrap, { borderColor, backgroundColor: inputBg }]}>
                      <TextInput
                        value={ticket.notes}
                        onChangeText={(v) => updateTicket(ticket.id, { notes: v })}
                        placeholder="Notes for buyers (optional)"
                        placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                        style={[styles.input, { color: theme.text }]}
                      />
                    </View>

                    {/* Options */}
                    <Text style={[styles.settingsLabel, { color: isDark ? "#8C96A5" : "#888", marginTop: 10 }]}>Options</Text>
                    {ticket.options.map((opt) => (
                      <View key={opt.id} style={styles.optionRow}>
                        <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                          <TextInput
                            value={opt.name}
                            onChangeText={(v) => updateOption(ticket.id, opt.id, { name: v })}
                            placeholder="Option name"
                            placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                            style={[styles.input, { color: theme.text }]}
                          />
                        </View>
                        <CheckboxRow
                          label="Free"
                          checked={opt.free}
                          onToggle={() => updateOption(ticket.id, opt.id, { free: !opt.free, extraCost: !opt.free ? "" : opt.extraCost })}
                          style={{ marginLeft: 8 }}
                          theme={theme}
                          isDark={isDark}
                        />
                        {!opt.free && (
                          <View style={[styles.costWrap, { borderColor: isDark ? "#555" : "#CFCFCF", backgroundColor: inputBg }]}>
                            <TextInput
                              value={opt.extraCost}
                              onChangeText={(v) => updateOption(ticket.id, opt.id, { extraCost: v })}
                              keyboardType="numeric"
                              placeholder="+0"
                              placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                              style={[styles.costInput, { color: theme.text }]}
                            />
                          </View>
                        )}
                        <TouchableOpacity onPress={() => deleteOption(ticket.id, opt.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Feather name="x" size={14} color={isDark ? "#D1D5DB" : "#999"} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity style={styles.addOptionBtn} onPress={() => addOption(ticket.id)}>
                      <Feather name="plus" size={13} color="#2F91FF" />
                      <Text style={styles.addOptionText}>Add option</Text>
                    </TouchableOpacity>

                    {/* Required buyer info — only show on first ticket if sameRequiredInfo */}
                    {(!sameRequiredInfo || idx === 0) && (
                      <>
                        <Text style={[styles.settingsLabel, { color: isDark ? "#8C96A5" : "#888", marginTop: 10 }]}>
                          Required buyer info
                        </Text>
                        <View style={[styles.inputWrap, { borderColor, backgroundColor: inputBg }]}>
                          <TextInput
                            value={ticket.requiredInfo}
                            onChangeText={(v) => updateTicket(ticket.id, { requiredInfo: v })}
                            placeholder={t("event_required_info_placeholder")}
                            placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                            style={[styles.input, { color: theme.text }]}
                          />
                        </View>
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          <CheckboxRow
            label="Same required info for all tickets"
            checked={sameRequiredInfo}
            onToggle={() => setSameRequiredInfo((v) => !v)}
            style={{ marginTop: 12 }}
            theme={theme}
            isDark={isDark}
          />

          <TouchableOpacity style={styles.addBtn} onPress={addTicket}>
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
        <CheckboxRow label={t("event_action_allow_subgroups")} checked={allowSubgroups} onToggle={() => setAllowSubgroups((v) => !v)} theme={theme} isDark={isDark} />
        <CheckboxRow label={t("event_action_allow_invites")} checked={allowInvites} onToggle={() => setAllowInvites((v) => !v)} style={{ marginTop: 8 }} theme={theme} isDark={isDark} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 12, paddingTop: 14, marginTop: 12 },

  sectionLabel: { fontFamily: "PoppinsBold", fontSize: 10, marginBottom: 8 },

  checkboxRow: { flexDirection: "row", alignItems: "center" },
  checkboxBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 8 },
  checkboxBoxChecked: { backgroundColor: "#2F91FF", borderColor: "#2F91FF" },
  checkboxLabel: { fontSize: 14, fontFamily: "Poppins" },

  ticketBlock: { marginTop: 12 },
  ticketRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  costRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },

  inputWrap: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  input: { fontFamily: "Poppins", fontSize: 14 },

  costLabel: { fontSize: 13, fontFamily: "Poppins", flexShrink: 0 },
  costWrap: { width: 52, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 7, alignItems: "center" },
  costInput: { fontSize: 14, fontFamily: "Poppins", width: "100%", textAlign: "center" },

  deleteBtn: { justifyContent: "center", alignItems: "center", padding: 4 },

  settingsToggle: { flexDirection: "row", alignItems: "center", marginTop: 8, alignSelf: "flex-start" },
  settingsToggleText: { color: "#2F91FF", fontFamily: "Poppins", fontSize: 12 },

  settingsSection: { marginTop: 8, borderRadius: 10, borderWidth: 1, padding: 12 },
  settingsLabel: { fontFamily: "PoppinsBold", fontSize: 10, marginBottom: 6 },

  optionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  addOptionBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  addOptionText: { color: "#2F91FF", fontFamily: "Poppins", fontSize: 12 },

  addBtn: {
    flexDirection: "row", alignSelf: "center", alignItems: "center",
    backgroundColor: "#2F91FF", paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 10, marginTop: 14,
  },
  addBtnText: { color: "#fff", fontSize: 14, fontWeight: "600", fontFamily: "Poppins" },
});
