import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import ActionMenu from './ActionMenu';

export default function CommunityAdPost({
  avatar,
  handle,
  timestamp,
  title,
  description,
  image,
  ctaLabel,
  onPressCta,
  actions,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerTop}>
        <View style={styles.profileRow}>
          {avatar ? <Image source={avatar} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarPlaceholder]} />}
          <View style={styles.profileText}>
            <Text style={styles.handle}>{handle} <Text style={styles.posted}>posted an Ad</Text></Text>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
        </View>
        <Text style={styles.menuDots}>•••</Text>
      </View>

      {image ? (
        <Image source={image} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]} />
      )}

      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {ctaLabel ? (
          <TouchableOpacity onPress={onPressCta} style={styles.ctaButton} activeOpacity={0.85}>
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ActionMenu actions={actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F1F3D',
    borderRadius: 26,
    overflow: 'hidden',
    marginBottom: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 22,
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
    backgroundColor: '#405B7F',
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
    color: '#FFFFFF',
  },
  posted: {
    fontFamily: 'Poppins-Regular',
    color: 'rgba(255,255,255,0.85)',
  },
  timestamp: {
    marginTop: 4,
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  menuDots: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'Poppins-SemiBold',
    marginLeft: 12,
  },
  image: {
    width: '100%',
    height: 200,
    backgroundColor: '#213250',
  },
  imagePlaceholder: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderStyle: 'dashed',
  },
  content: {
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  title: {
    fontFamily: 'Poppins-Bold',
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 10,
  },
  description: {
    fontFamily: 'Poppins-Regular',
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
    marginBottom: 18,
  },
  ctaButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  ctaLabel: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
    color: '#0F1F3D',
  },
});
