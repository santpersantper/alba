import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function ActionMenu({ actions = [] }) {
  if (!actions.length) return null;

  return (
    <View style={styles.container}>
      {actions.map((action, index) => (
        <TouchableOpacity
          key={action.label + index}
          onPress={action.onPress}
          style={styles.actionButton}
          activeOpacity={0.7}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F0F3F7',
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1B1D28',
  },
});
