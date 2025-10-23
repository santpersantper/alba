import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import ActionMenu from './ActionMenu';

export default function CommunityArticlePost({
  title,
  excerpt,
  author,
  time,
  image,
  actions,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>By {author} • {time}</Text>
        </View>
        {image ? <Image source={image} style={styles.thumbnail} resizeMode="cover" /> : null}
      </View>
      <Text style={styles.excerpt}>{excerpt}</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1B1D28',
  },
  meta: {
    fontSize: 12,
    color: '#6F7D95',
    marginTop: 4,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 16,
    marginLeft: 12,
  },
  excerpt: {
    fontSize: 14,
    color: '#3B4453',
  },
});
