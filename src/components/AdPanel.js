// AdPanel.js
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const AD_CATEGORIES = [
  "Food & Drink", "Shopping", "Sports", "Music", "Parties",
  "Services", "Science & Tech", "Travel", "Health & Beauty", "Other",
];

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

export default function AdPanel({ onState }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const inputBg = isDark ? "#1E1E1E" : "#FAFAFA";
  const borderColor = isDark ? "#444" : "#E0E0E0";
  const settingsBg = isDark ? "#161616" : "#F2F3F5";

  const [targetInterested, setTargetInterested] = useState(true);
  const [iap, setIap] = useState(true);
  const [selectedLabels, setSelectedLabels] = useState([]);

  const toggleLabel = (label) =>
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );

  const productIdRef = useRef(3);
  const optionIdRef = useRef(100);

  const [products, setProducts] = useState([
    { id: 1, name: "", cost: "", settingsOpen: false, notes: "", options: [], requiredInfo: "" },
    { id: 2, name: "", cost: "", settingsOpen: false, notes: "", options: [], requiredInfo: "" },
  ]);

  const [sameRequiredInfo, setSameRequiredInfo] = useState(false);

  const updateProduct = (id, patch) =>
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addProduct = () =>
    setProducts((ps) => [
      ...ps,
      { id: productIdRef.current++, name: "", cost: "", settingsOpen: false, notes: "", options: [], requiredInfo: "" },
    ]);

  const deleteProduct = (id) => setProducts((ps) => ps.filter((p) => p.id !== id));

  const addOption = (productId) =>
    setProducts((ps) =>
      ps.map((p) =>
        p.id === productId
          ? { ...p, options: [...p.options, { id: optionIdRef.current++, name: "", extraCost: "", free: true }] }
          : p
      )
    );

  const updateOption = (productId, optId, patch) =>
    setProducts((ps) =>
      ps.map((p) =>
        p.id === productId
          ? { ...p, options: p.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) }
          : p
      )
    );

  const deleteOption = (productId, optId) =>
    setProducts((ps) =>
      ps.map((p) =>
        p.id === productId ? { ...p, options: p.options.filter((o) => o.id !== optId) } : p
      )
    );

  useEffect(() => {
    const firstRI = products[0]?.requiredInfo || "";
    const normalizedProducts = products.map((p) => ({
      ...p,
      requiredInfo: sameRequiredInfo ? firstRI : p.requiredInfo,
    }));
    onState?.({ targetInterested, iap, products: normalizedProducts, labels: selectedLabels });
  }, [targetInterested, iap, products, sameRequiredInfo, selectedLabels, onState]);

  return (
    <View style={[styles.panel, { backgroundColor: theme.background }]}>
      <CheckboxRow label={t("ad_checkbox_target_interested")} checked={targetInterested} onToggle={() => setTargetInterested((v) => !v)} theme={theme} isDark={isDark} />
      <CheckboxRow label={t("ad_checkbox_iap")} checked={iap} onToggle={() => setIap((v) => !v)} style={{ marginTop: 10 }} theme={theme} isDark={isDark} />

      {/* Ad categories — determines who sees this ad */}
      <Text style={[styles.sectionLabel, { color: isDark ? "#8C96A5" : "#888", marginTop: 14, marginBottom: 8 }]}>
        Ad categories
      </Text>
      <View style={styles.labelsWrap}>
        {AD_CATEGORIES.map((cat) => {
          const active = selectedLabels.includes(cat);
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => toggleLabel(cat)}
              activeOpacity={0.8}
              style={[
                styles.labelChip,
                { borderColor: active ? "#2F91FF" : (isDark ? "#444" : "#D8D8D8"), backgroundColor: active ? "#2F91FF" : (isDark ? "#2B2B2B" : "#F4F4F4") },
              ]}
            >
              <Text style={[styles.labelChipText, { color: active ? "#fff" : theme.text }]}>{cat}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {iap && (
        <>
          {products.map((pr, idx) => (
            <View key={pr.id} style={styles.productBlock}>
              {/* Row 1: name + delete */}
              <View style={styles.productRow}>
                <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                  <TextInput
                    value={pr.name}
                    onChangeText={(v) => updateProduct(pr.id, { name: v })}
                    placeholder={idx === 0 ? "Pizza marinara" : idx === 1 ? "Marinara + bibita" : t("ad_product_name_placeholder")}
                    placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                    style={[styles.input, { color: theme.text }]}
                  />
                </View>
                {idx >= 1 && (
                  <TouchableOpacity onPress={() => deleteProduct(pr.id)} style={styles.deleteBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Feather name="x" size={16} color={isDark ? "#D1D5DB" : "#999"} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Row 2: cost */}
              <View style={styles.costRow}>
                <Text style={[styles.costLabel, { color: theme.text }]}>{t("ad_cost_label")}</Text>
                <View style={[styles.costWrap, { borderColor: isDark ? "#555" : "#CFCFCF", backgroundColor: inputBg }]}>
                  <TextInput
                    value={pr.cost}
                    onChangeText={(v) => updateProduct(pr.id, { cost: v })}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                    style={[styles.costInput, { color: theme.text }]}
                  />
                </View>
              </View>

              {/* Product settings toggle */}
              <TouchableOpacity
                style={styles.settingsToggle}
                onPress={() => updateProduct(pr.id, { settingsOpen: !pr.settingsOpen })}
                activeOpacity={0.8}
              >
                <Feather name="sliders" size={12} color="#2F91FF" style={{ marginRight: 4 }} />
                <Text style={styles.settingsToggleText}>Product settings</Text>
                <Feather name={pr.settingsOpen ? "chevron-up" : "chevron-down"} size={13} color="#2F91FF" style={{ marginLeft: 3 }} />
              </TouchableOpacity>

              {pr.settingsOpen && (
                <View style={[styles.settingsSection, { borderColor, backgroundColor: settingsBg }]}>
                  {/* Notes */}
                  <Text style={[styles.settingsLabel, { color: isDark ? "#8C96A5" : "#888" }]}>Notes</Text>
                  <View style={[styles.inputWrap, { borderColor, backgroundColor: inputBg }]}>
                    <TextInput
                      value={pr.notes}
                      onChangeText={(v) => updateProduct(pr.id, { notes: v })}
                      placeholder="Notes for buyers (optional)"
                      placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                      style={[styles.input, { color: theme.text }]}
                    />
                  </View>

                  {/* Options */}
                  <Text style={[styles.settingsLabel, { color: isDark ? "#8C96A5" : "#888", marginTop: 10 }]}>Options</Text>
                  {pr.options.map((opt) => (
                    <View key={opt.id} style={styles.optionRow}>
                      <View style={[styles.inputWrap, { flex: 1, borderColor, backgroundColor: inputBg }]}>
                        <TextInput
                          value={opt.name}
                          onChangeText={(v) => updateOption(pr.id, opt.id, { name: v })}
                          placeholder="Option name"
                          placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                          style={[styles.input, { color: theme.text }]}
                        />
                      </View>
                      <CheckboxRow
                        label="Free"
                        checked={opt.free}
                        onToggle={() => updateOption(pr.id, opt.id, { free: !opt.free, extraCost: !opt.free ? "" : opt.extraCost })}
                        style={{ marginLeft: 8 }}
                        theme={theme}
                        isDark={isDark}
                      />
                      {!opt.free && (
                        <View style={[styles.costWrap, { borderColor: isDark ? "#555" : "#CFCFCF", backgroundColor: inputBg }]}>
                          <TextInput
                            value={opt.extraCost}
                            onChangeText={(v) => updateOption(pr.id, opt.id, { extraCost: v })}
                            keyboardType="numeric"
                            placeholder="+0"
                            placeholderTextColor={isDark ? "#8C96A5" : "#BFBFBF"}
                            style={[styles.costInput, { color: theme.text }]}
                          />
                        </View>
                      )}
                      <TouchableOpacity onPress={() => deleteOption(pr.id, opt.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Feather name="x" size={14} color={isDark ? "#D1D5DB" : "#999"} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addOptionBtn} onPress={() => addOption(pr.id)}>
                    <Feather name="plus" size={13} color="#2F91FF" />
                    <Text style={styles.addOptionText}>Add option</Text>
                  </TouchableOpacity>

                  {/* Required buyer info */}
                  {(!sameRequiredInfo || idx === 0) && (
                    <>
                      <Text style={[styles.settingsLabel, { color: isDark ? "#8C96A5" : "#888", marginTop: 10 }]}>
                        Required buyer info
                      </Text>
                      <View style={[styles.inputWrap, { borderColor, backgroundColor: inputBg }]}>
                        <TextInput
                          value={pr.requiredInfo}
                          onChangeText={(v) => updateProduct(pr.id, { requiredInfo: v })}
                          placeholder={t("ad_required_info_placeholder")}
                          placeholderTextColor={isDark ? "#8C96A5" : "#AEAEAE"}
                          style={[styles.input, { color: theme.text }]}
                        />
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          ))}

          <CheckboxRow
            label="Same required info for all products"
            checked={sameRequiredInfo}
            onToggle={() => setSameRequiredInfo((v) => !v)}
            style={{ marginTop: 12 }}
            theme={theme}
            isDark={isDark}
          />

          <TouchableOpacity style={styles.addBtn} onPress={addProduct}>
            <Feather name="plus" size={15} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.addBtnText}>{t("ad_add_product_button")}</Text>
          </TouchableOpacity>
        </>
      )}
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

  productBlock: { marginTop: 12 },
  productRow: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "PoppinsBold" },

  labelsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  labelChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  labelChipText: { fontFamily: "Poppins", fontSize: 12 },
});
