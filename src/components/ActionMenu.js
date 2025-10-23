import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function ActionMenu({ actions = [] }) {
  if (!actions.length) return null;

  return (
    <View style={styles.container}>
      {actions.map((action, index) => (
        <TouchableOpacity
          key={`${action.label}-${index}`}
          onPress={action.onPress}
          style={[styles.actionButton, index > 0 && styles.actionSpacing]}
          activeOpacity={0.75}
        >
          {action.icon}
          <Text style={styles.actionLabel}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: '#E3F1FF',
  },
  actionSpacing: {
    marginLeft: 10,
  },
  actionLabel: {
    fontSize: 14,
    fontFamily: 'Poppins-SemiBold',
    color: '#0F1A2A',
  },
});
