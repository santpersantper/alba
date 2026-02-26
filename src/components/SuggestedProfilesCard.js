import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function SuggestedProfilesCard({ names = []}) {
  return (
         <View style={styles.peopleSection}>
          <Text style={styles.peopleTitle}>People near you</Text>
          <View style={styles.peopleRow}>
            {names.map((p, i) => (
              <View key={`${p}-${i}`} style={styles.personItem}>
                <View style={styles.personAvatar} />
                <Text style={styles.personName} numberOfLines={1}>{p}</Text>
                <TouchableOpacity style={[styles.followBtn, styles.followingBtn]} activeOpacity={0.8}>
                  <Text style={[styles.followLabel, styles.followingLabel]}>Following</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
  );
}

const styles = StyleSheet.create({
  peopleSection: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#FFFFFF'
  },
  peopleTitle: {
    fontSize: 20,
    padding: 10,
    fontWeight: '800',
    color: '#1B1D28',
    marginBottom: 12,
    fontFamily: 'Poppins'
  },
  peopleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  personItem: {
    alignItems: 'center',
    flex: 1,
  },
  personAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E1E6EF',
    marginBottom: 8,
  },
  personName: {
    fontSize: 14,
    color: '#1B1D28',
    fontWeight: '700',
    marginBottom: 8,
    fontFamily: 'Poppins'
  },
  followBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  followingBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'grey',
  },
  followLabel: {
    fontWeight: '100',
    color: 'grey',
    fontFamily: 'Poppins'
  }
});
