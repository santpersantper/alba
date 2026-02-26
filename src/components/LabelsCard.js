import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { useAlbaLanguage } from "../theme/LanguageContext";

const CHIP_GAP = 8; // marginRight between chips
// Estimated widths (chip content + padding, before measurement) used in 2-row computation.
const SEE_ALL_ESTIMATE_W = 96; // "See all" chip
const PLUS_BTN_ESTIMATE_W = 44; // "+" chip
// Total trailing space reserved on row 2 when truncated: "+" + "See all"
const TRAILING_W = (PLUS_BTN_ESTIMATE_W + CHIP_GAP) + (SEE_ALL_ESTIMATE_W + CHIP_GAP);

export default function LabelsCard({
  labels = [],
  colors = [],
  activeLabel,
  onSelect,
  onChangeLabels,
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { t } = useAlbaLanguage();

  // Mutable refs so layout callbacks don't stale-close
  const containerW = useRef(0);
  const chipWidths = useRef({}); // label → measured px width (includes chip padding)
  const [, bump] = useState(0); // increment to force re-render after measurements

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */
  const handleRemove = (label) => {
    const next = labels.filter((l) => l !== label);
    onChangeLabels?.(next);
    if (activeLabel === label) onSelect?.(null);
  };

  const commitAdd = () => {
    let value = draft.trim();
    if (!value) {
      setDraft("");
      setAdding(false);
      return;
    }
    value = value.charAt(0).toUpperCase() + value.slice(1);
    if (!labels.includes(value)) onChangeLabels?.([...labels, value]);
    setDraft("");
    setAdding(false);
  };

  const displayLabel = (label) => {
    if (!label?.length) return label;
    const first = label.charAt(0);
    if (first === first.toLowerCase() && first !== first.toUpperCase())
      return first.toUpperCase() + label.slice(1);
    return label;
  };

  const getLabelDisplay = (label) => {
    switch (label) {
      case "Sports":          return t("label_sports");
      case "Party":           return t("label_parties");
      case "Cultural events": return t("label_cultural");
      case "Music":           return t("label_music");
      case "Science & Tech":  return t("label_science_tech");
      case "Culinary":        return t("label_culinary");
      case "English-speaking":return t("label_english_speaking");
      default:                return displayLabel(label);
    }
  };

  /* ------------------------------------------------------------------ */
  /* 2-row layout computation                                             */
  /* ------------------------------------------------------------------ */
  // Returns the estimated chip width (px) including the right gap.
  const chipW = (label) =>
    (chipWidths.current[label] !== undefined
      ? chipWidths.current[label]
      : label.length * 9 + 44) + CHIP_GAP;

  let visibleLabels = labels;
  let hasMore = false;

  if (!showAll && containerW.current > 0) {
    const cW = containerW.current;

    // Pass 1 — do all labels fit in ≤ 2 rows? (ignoring trailing items; just check raw chips)
    let row = 0;
    let rowW = 0;
    let allFit = true;
    for (const label of labels) {
      const w = chipW(label);
      if (rowW + w > cW) {
        if (row < 1) { row++; rowW = 0; }
        else { allFit = false; break; }
      }
      rowW += w;
    }

    if (!allFit) {
      // Pass 2 — find which labels fit in 2 rows leaving room for "+" + "See all" at end
      row = 0; rowW = 0;
      const result = [];

      for (let i = 0; i < labels.length; i++) {
        const w = chipW(labels[i]);

        // Handle row wrap
        if (rowW + w > cW) {
          if (row < 1) { row++; rowW = 0; }
          else break;
        }

        if (row === 1 && i < labels.length - 1) {
          // On row 2 with more items to come — reserve space for "+" and "See all".
          if (rowW + w + TRAILING_W > cW) break; // chip + trailing won't fit; trailing goes here

          // If the next chip (+ trailing) wouldn't fit, stop after this chip.
          const nw = chipW(labels[i + 1]);
          if (rowW + w + nw + TRAILING_W > cW) {
            result.push(labels[i]);
            rowW += w;
            break;
          }
        }

        result.push(labels[i]);
        rowW += w;
      }

      visibleLabels = result.length > 0 ? result : labels.slice(0, 1);
      hasMore = visibleLabels.length < labels.length;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                               */
  /* ------------------------------------------------------------------ */
  return (
    <View
      style={styles.tagWrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w && w !== containerW.current) {
          containerW.current = w;
          bump((n) => n + 1);
        }
      }}
    >
      {visibleLabels.map((label, i) => {
        const isActive = activeLabel === label;
        const bg = colors[i] || "#2F91FF";
        const shown = getLabelDisplay(label);

        return (
          <TouchableOpacity
            key={`${label}-${i}`}
            activeOpacity={0.85}
            style={[
              styles.tagChip,
              {
                backgroundColor: bg,
                borderColor: isActive ? "#0C1A4B" : "transparent",
              },
            ]}
            onPress={() => onSelect?.(isActive ? null : label)}
            onLayout={(e) => {
              const mw = e.nativeEvent.layout.width;
              if (chipWidths.current[label] !== mw) {
                chipWidths.current[label] = mw;
                bump((n) => n + 1);
              }
            }}
          >
            <Text style={styles.tagLabel} numberOfLines={1}>
              {shown}
            </Text>
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleRemove(label);
              }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.tagLabel}> ×</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      })}

      {/* "+" Add button — always shown, to the left of See all / See less */}
      {adding ? (
        <View style={[styles.tagChip, styles.addChip]}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={commitAdd}
            onBlur={commitAdd}
            placeholder={t("labels_new_label_placeholder")}
            placeholderTextColor="#d0d8e4"
            style={styles.addInput}
            returnKeyType="done"
          />
        </View>
      ) : (
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.tagChip, styles.addChip]}
          onPress={() => setAdding(true)}
        >
          <Text style={styles.addText}>+</Text>
        </TouchableOpacity>
      )}

      {/* See all (truncated) / See less (expanded) */}
      {hasMore && !showAll && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.tagChip, styles.seeAllChip]}
          onPress={() => setShowAll(true)}
        >
          <Text style={styles.seeAllText}>See all</Text>
        </TouchableOpacity>
      )}
      {showAll && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.tagChip, styles.seeAllChip]}
          onPress={() => setShowAll(false)}
        >
          <Text style={styles.seeAllText}>See less</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginRight: CHIP_GAP,
    marginBottom: 8,
  },
  tagLabel: {
    fontSize: 14,
    fontWeight: "100",
    color: "#FFFFFF",
    fontFamily: "Poppins",
  },
  seeAllChip: {
    backgroundColor: "#ecf2ff",
  },
  seeAllText: {
    fontSize: 14,
    color: "#2F91FF",
    fontFamily: "Poppins",
    fontWeight: "500",
  },
  addChip: {
    backgroundColor: "#ecf2ff",
    borderColor: "transparent",
  },
  addText: {
    fontSize: 14,
    color: "#2F91FF",
    fontFamily: "Poppins",
    fontWeight: "500",
  },
  addInput: {
    minWidth: 80,
    padding: 0,
    margin: 0,
    fontSize: 14,
    color: "#111",
    fontFamily: "Poppins",
  },
});
