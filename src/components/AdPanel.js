// AdPanel.js
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const CheckboxRow = ({ label, checked, onToggle, style, theme, isDark }) => (
  <TouchableOpacity onPress={onToggle} activeOpacity={0.8} style={[styles.checkboxRow, style]}>
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

export default function AdPanel({ onState }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

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
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.background }, // bluish overlay, darker in night
      ]}
    >
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
                <View
                  style={[
                    styles.productNameWrap,
                    {
                      backgroundColor: isDark ? "#2B2B2B" : "#fff",
                      borderColor: isDark ? "#555" : "#D9D9D9",
                    },
                  ]}
                >
                  <TextInput
                    value={pr.name}
                    onChangeText={(v) => update(pr.id, { name: v })}
                    placeholder={idx === 0 ? "Pizza marinara" : idx === 1 ? "Marinara + bibita" : t("ad_product_name_placeholder")}
                    placeholderTextColor={isDark ? "#8C96A5" : "#8F8F8F"}
                    style={[styles.productName, { color: theme.text }]}
                  />
                </View>

                {idx >= 1 && (
                  <TouchableOpacity
                    onPress={() => deleteRow(pr.id)}
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
                  value={pr.notes}
                  onChangeText={(v) => update(pr.id, { notes: v })}
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
                  {t("ad_cost_label")}
                </Text>
                <View style={[styles.costLineBox, { borderColor: isDark ? "#FFFFFF" : "#CFCFCF" }]}>
                  <TextInput
                    value={pr.cost}
                    onChangeText={(v) => update(pr.id, { cost: v })}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                    style={[styles.costLineInput, { color: theme.text }]}
                  />
                </View>
              </View>
            </View>
          ))}

          {/* Required buyer info */}
          <View style={styles.requiredInfoSection}>
            <Text
              style={[
                styles.requiredInfoTitle,
                { color: theme.text },
              ]}
            >
              {t("ad_required_info_title")}
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
                placeholder={t("ad_required_info_placeholder")}
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

  productBlock: { marginTop: 12 },
  productRow: { flexDirection: "row", alignItems: "center" },
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
  productNameWrap: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    justifyContent: "center",
  },
  productName: { fontSize: 14, fontFamily: "Poppins" },

  costLabel: {
    fontSize: 14,
    marginLeft: 10,
    marginRight: 6,
    fontFamily: "Poppins",
  },
  costLineBox: {
    width: 40,
    justifyContent: "flex-end",
    borderBottomWidth: 1,
  },
  costLineInput: {
    fontSize: 14,
    paddingVertical: 2,
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
    backgroundColor: "#59A7FF", // keep light blue CTA
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
});
