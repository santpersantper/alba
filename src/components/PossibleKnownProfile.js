import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';

export default function PossibleKnownProfile({ name, role, mutualCount, avatar, onConnect }) {
  return (
    <View style={styles.card}>
      {avatar ? <Image source={avatar} style={styles.avatar} resizeMode="cover" /> : <View style={[styles.avatar, styles.placeholder]} />}
      <Text style={styles.name}>{name}</Text>
      {role ? <Text style={styles.role}>{role}</Text> : null}
      {typeof mutualCount === 'number' ? (
        <Text style={styles.mutual}>{mutualCount} mutual connection{mutualCount === 1 ? '' : 's'}</Text>
      ) : null}
      <TouchableOpacity onPress={onConnect} style={styles.connectButton} activeOpacity={0.8}>
        <Text style={styles.connectLabel}>Connect</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 160,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginRight: 16,
    alignItems: 'center',
    shadowColor: '#0C1A4B',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 12,
    backgroundColor: '#E1E6EF',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B1D28',
    textAlign: 'center',
  },
  role: {
    fontSize: 12,
    color: '#6F7D95',
    marginTop: 6,
    textAlign: 'center',
  },
  mutual: {
    fontSize: 12,
    color: '#6F7D95',
    marginTop: 4,
  },
  connectButton: {
    marginTop: 12,
    backgroundColor: '#00A9FF',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  connectLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
