// AdPanel.js
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

export default function AdPanel({ onState }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const inputBg = isDark ? "#1E1E1E" : "#FAFAFA";
  const borderColor = isDark ? "#444" : "#E0E0E0";

  const [targetInterested, setTargetInterested] = useState(true);
  const [iap, setIap] = useState(true);

  const idRef = useRef(3);
  const [products, setProducts] = useState([
    { id: 1, name: "", cost: "", notes: "" },
    { id: 2, name: "", cost: "", notes: "" },
  ]);

  const update = (id, patch) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const addRow = () =>
    setProducts((p) => [
      ...p,
      { id: idRef.current++, name: "", cost: "", notes: "" },
    ]);

  const deleteRow = (id) => setProducts((p) => p.filter((x) => x.id !== id));

  const [requiredBuyerInfo, setRequiredBuyerInfo] = useState("");

  // Emit state upwards
  useEffect(() => {
    onState?.({ targetInterested, iap, products, requiredBuyerInfo });
  }, [targetInterested, iap, products, requiredBuyerInfo, onState]);

  return (
    <View style={[styles.panel, { backgroundColor: theme.background }]}>
      <CheckboxRow
        label={t("ad_checkbox_target_interested")}
        checked={targetInterested}
        onToggle={() => setTargetInterested((v) => !v)}
        theme={theme}
        isDark={isDark}
      />
      <CheckboxRow
        label={t("ad_checkbox_iap")}
        checked={iap}
        onToggle={() => setIap((v) => !v)}
        style={{ marginTop: 10 }}
        theme={theme}
        isDark={isDark}
      />

      {iap && (
        <>
          {products.map((pr, idx) => (
            <View key={pr.id} style={styles.productBlock}>
              {/* Row 1: name + delete */}
              <View style={styles.productRow}>
                <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                  <TextInput
                    value={pr.name}
                    onChangeText={(v) => update(pr.id, { name: v })}
                    placeholder={idx === 0 ? "Pizza marinara" : idx === 1 ? "Marinara + bibita" : t("ad_product_name_placeholder")}
                    placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                    style={[styles.input, { color: theme.text }]}
                  />
                </View>

                {idx >= 1 && (
                  <TouchableOpacity
                    onPress={() => deleteRow(pr.id)}
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
                    value={pr.notes}
                    onChangeText={(v) => update(pr.id, { notes: v })}
                    placeholder="Notes (optional)"
                    placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                    style={[styles.input, { color: theme.text }]}
                  />
                </View>
                <Text style={[styles.costLabel, { color: theme.text }]}>
                  {t("ad_cost_label")}
                </Text>
                <View style={[styles.costWrap, { borderColor: isDark ? "#555" : "#CFCFCF", backgroundColor: inputBg }]}>
                  <TextInput
                    value={pr.cost}
                    onChangeText={(v) => update(pr.id, { cost: v })}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                    style={[styles.costInput, { color: theme.text }]}
                  />
                </View>
              </View>
            </View>
          ))}

          {/* Required buyer info */}
          <View style={styles.requiredInfoSection}>
            <Text style={[styles.sectionLabel, { color: isDark ? "#8C96A5" : "#888" }]}>
              {t("ad_required_info_title")}
            </Text>
            <View style={[styles.inputWrap, { borderColor, backgroundColor: inputBg }]}>
              <TextInput
                value={requiredBuyerInfo}
                onChangeText={setRequiredBuyerInfo}
                placeholder={t("ad_required_info_placeholder")}
                placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                style={[styles.input, { color: theme.text, minHeight: 60, textAlignVertical: "top" }]}
                multiline
              />
            </View>
          </View>

          <TouchableOpacity style={styles.addBtn} onPress={addRow}>
            <Feather name="plus" size={15} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.addBtnText}>{t("ad_add_product_button")}</Text>
          </TouchableOpacity>
        </>
      )}
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

  productBlock: { marginTop: 10 },
  productRow: { flexDirection: "row", alignItems: "center", gap: 8 },
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
