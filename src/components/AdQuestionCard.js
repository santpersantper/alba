import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';

export default function AdQuestionCard({product}) {
  return (

    <View style={styles.questionCard}>
        <Text style={styles.questionText}>Are you interested in receiving ads about</Text>
        <Text style={[styles.questionText, styles.questionEmphasis]}>{product}?</Text>
        <View style={styles.questionActions}>
            <TouchableOpacity style={styles.questionBtn} activeOpacity={0.8}>
            <Text style={styles.questionBtnLabel}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.questionBtn, styles.questionBtnOutline]} activeOpacity={0.8}>
            <Text style={[styles.questionBtnLabel, styles.questionBtnOutlineLabel]}>No</Text>
            </TouchableOpacity>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
    questionCard: {
    backgroundColor: '#D9ECFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  questionText: {
    fontSize: 14,
    color: '#1B1D28',
    fontWeight: '100',
    fontFamily: 'Poppins'
  },
  questionEmphasis: {
    fontWeight: '800',
    fontFamily: 'Poppins'
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
    fontWeight: '700',
    fontFamily: 'Poppins'
  },
  questionBtnOutline: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B9D7FF',
  },
  questionBtnOutlineLabel: {
    color: '#1B1D28',
  }
});
