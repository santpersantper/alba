import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import ActionMenu from './ActionMenu';

export default function CommunityEventPost({
  avatar,
  handle,
  timestamp,
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
      <View style={styles.topRow}>
        <View style={styles.profileRow}>
          {avatar ? <Image source={avatar} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarPlaceholder]} />}
          <View style={styles.profileText}>
            <Text style={styles.handle}>{handle} <Text style={styles.posted}>posted an Event</Text></Text>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
        </View>
        <Text style={styles.menuDots}>•••</Text>
      </View>

      <View style={styles.eventMeta}>
        <Text style={styles.eventTitle}>{title}</Text>
        <Text style={styles.eventInfo}>{date} • {time}</Text>
        <Text style={styles.eventLocation}>{location}</Text>
      </View>

      <Text style={styles.description}>{description}</Text>

      {image ? (
        <Image source={image} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]} />
      )}

      <ActionMenu actions={actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 26,
    shadowColor: 'rgba(15, 26, 42, 0.18)',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 4,
    marginBottom: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#D9E6FF',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileText: {
    marginLeft: 14,
    flex: 1,
  },
  handle: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 15,
    color: '#0F1A2A',
  },
  posted: {
    fontFamily: 'Poppins-Regular',
    color: '#0F1A2A',
  },
  timestamp: {
    marginTop: 4,
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    color: '#7088A1',
  },
  menuDots: {
    fontSize: 20,
    color: '#A7B4C5',
    fontFamily: 'Poppins-SemiBold',
    marginLeft: 12,
  },
  eventMeta: {
    marginBottom: 14,
  },
  eventTitle: {
    fontFamily: 'Poppins-Bold',
    fontSize: 20,
    color: '#0F1A2A',
    marginBottom: 4,
  },
  eventInfo: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13,
    color: '#1A8FE3',
  },
  eventLocation: {
    fontFamily: 'Poppins-Regular',
    fontSize: 13,
    color: '#7088A1',
    marginTop: 2,
  },
  description: {
    fontFamily: 'Poppins-Regular',
    fontSize: 14,
    color: '#23405A',
    lineHeight: 20,
    marginBottom: 16,
  },
  image: {
    width: '100%',
    height: 180,
    borderRadius: 22,
    marginBottom: 12,
    backgroundColor: '#DDE9FF',
  },
  imagePlaceholder: {
    borderWidth: 1,
    borderColor: 'rgba(26, 143, 227, 0.25)',
    borderStyle: 'dashed',
  },
});
