import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import ActionMenu from './ActionMenu';

export default function CommunityEventPost({
  title,
  date,
  time,
  location,
  description,
  image,
  actions,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eventTag}>EVENT</Text>
        <Text style={styles.dateText}>{date}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{time} • {location}</Text>
      <Text style={styles.description}>{description}</Text>
      {image ? <Image source={image} style={styles.image} resizeMode="cover" /> : null}
      <ActionMenu actions={actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 20,
    shadowColor: '#0C1A4B',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  eventTag: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1B1D28',
    letterSpacing: 1,
  },
  dateText: {
    fontSize: 12,
    color: '#6F7D95',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1B1D28',
    marginBottom: 6,
  },
  meta: {
    fontSize: 13,
    color: '#6F7D95',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#3B4453',
    marginBottom: 12,
  },
  image: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    marginBottom: 12,
  },
});
