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
      <TouchableOpacity onPress={onConnect} style={styles.connectButton} activeOpacity={0.85}>
        <Text style={styles.connectLabel}>Follow</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 188,
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    paddingVertical: 24,
    paddingHorizontal: 18,
    marginRight: 18,
    alignItems: 'center',
    shadowColor: 'rgba(15, 26, 42, 0.16)',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 14,
    backgroundColor: '#E1EEFF',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 16,
    color: '#0F1A2A',
    textAlign: 'center',
  },
  role: {
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    color: '#7088A1',
    marginTop: 6,
    textAlign: 'center',
  },
  mutual: {
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    color: '#7088A1',
    marginTop: 6,
  },
  connectButton: {
    marginTop: 16,
    backgroundColor: '#1A8FE3',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 26,
  },
  connectLabel: {
    color: '#FFFFFF',
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
  },
});
