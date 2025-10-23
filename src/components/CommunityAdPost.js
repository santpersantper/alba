import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ActionMenu from './ActionMenu';

export default function CommunityAdPost({ title, description, ctaLabel, onPressCta, actions }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sponsored}>SPONSORED</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {ctaLabel ? (
        <TouchableOpacity onPress={onPressCta} style={styles.ctaButton} activeOpacity={0.8}>
          <Text style={styles.ctaLabel}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <ActionMenu actions={actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0D1F36',
    padding: 20,
    borderRadius: 20,
    marginBottom: 16,
  },
  sponsored: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 16,
  },
  ctaButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  ctaLabel: {
    color: '#0D1F36',
    fontWeight: '600',
    fontSize: 14,
  },
});
