import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAlbaTheme } from '../theme/ThemeContext';

export default function AdQuestionCard({ product }) {
  const { isDark } = useAlbaTheme();

  return (
    <View style={[styles.questionCard, { backgroundColor: isDark ? '#1E2A3A' : '#D9ECFF' }]}>
      <Text style={[styles.questionText, { color: isDark ? '#E0EEFF' : '#1B1D28' }]}>
        Are you interested in seeing ads about
      </Text>
      <Text style={[styles.questionText, styles.questionEmphasis, { color: isDark ? '#FFFFFF' : '#1B1D28' }]}>
        {product}?
      </Text>
      <View style={styles.questionActions}>
        <TouchableOpacity style={styles.questionBtn} activeOpacity={0.8}>
          <Text style={styles.questionBtnLabel}>Yes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.questionBtn, styles.questionBtnOutline, { backgroundColor: isDark ? '#2A3A4A' : '#FFFFFF', borderColor: isDark ? '#3A5A7A' : '#B9D7FF' }]} activeOpacity={0.8}>
          <Text style={[styles.questionBtnLabel, { color: isDark ? '#E0EEFF' : '#1B1D28' }]}>No</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  questionCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  questionText: {
    fontSize: 14,
    fontFamily: 'Poppins',
  },
  questionEmphasis: {
    fontFamily: 'PoppinsBold',
  },
  questionActions: {
    flexDirection: 'row',
    marginTop: 12,
  },
  questionBtn: {
    backgroundColor: '#0D6EFD',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 12,
  },
  questionBtnLabel: {
    color: '#fff',
    fontFamily: 'PoppinsBold',
  },
  questionBtnOutline: {
    borderWidth: 1,
  },
});
