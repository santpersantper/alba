import React, { useMemo, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import CommunityEventPost from '../components/CommunityEventPost';
import CommunityAdPost from '../components/CommunityAdPost';
import CommunityArticlePost from '../components/CommunityArticlePost';
import PossibleKnownProfile from '../components/PossibleKnownProfile';

export default function CommunityScreen() {
  const topBarOpacity = useRef(new Animated.Value(1)).current;
  const bottomBarOpacity = useRef(new Animated.Value(1)).current;
  const lastOffset = useRef(0);
  const animationState = useRef('shown');

  const tags = useMemo(
    () => ['For you', 'Local', 'Events', 'Discussions', 'Resources', 'Marketplace'],
    []
  );

  const people = useMemo(
    () => [
      { id: '1', name: 'Amelia Brown', role: 'Community Organizer', mutualCount: 4 },
      { id: '2', name: 'Jonas Lee', role: 'Neighborhood Watch', mutualCount: 2 },
      { id: '3', name: 'Priya Patel', role: 'Volunteer', mutualCount: 6 },
      { id: '4', name: 'Marcus Fields', role: 'Local Business Owner', mutualCount: 1 },
    ],
    []
  );

  const fadeBars = (toValue) => {
    if (animationState.current === toValue) return;
    animationState.current = toValue;
    Animated.parallel([
      Animated.timing(topBarOpacity, {
        toValue: toValue === 'shown' ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(bottomBarOpacity, {
        toValue: toValue === 'shown' ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleScroll = ({ nativeEvent }) => {
    const currentOffset = nativeEvent.contentOffset.y;
    const diff = currentOffset - lastOffset.current;

    if (Math.abs(diff) < 12) {
      return;
    }

    if (diff > 0) {
      fadeBars('hidden');
    } else {
      fadeBars('shown');
    }

    lastOffset.current = currentOffset;
  };

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.topBar, { opacity: topBarOpacity }]}>
        <Text style={styles.heading}>Community</Text>
        <TouchableOpacity style={styles.searchButton} activeOpacity={0.8}>
          <Text style={styles.searchLabel}>Search</Text>
        </TouchableOpacity>
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagList}
        >
          {tags.map((tag) => (
            <View key={tag} style={styles.tagChip}>
              <Text style={styles.tagLabel}>{tag}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.feedSection}>
          <CommunityEventPost
            title="Neighborhood Cleanup Day"
            date="Thu, Sep 12"
            time="9:00 AM"
            location="Riverside Park"
            description="Join neighbors to keep Riverside Park sparkling. Supplies and snacks provided."
            actions={[
              { label: 'Interested' },
              { label: 'Share' },
            ]}
          />

          <CommunityArticlePost
            title="How to prepare for the fall storm season"
            excerpt="City officials shared a checklist to help residents stay safe during storm surges and heavy rainfall expected this fall."
            author="City Herald"
            time="2h ago"
            actions={[
              { label: 'Save' },
              { label: 'Discuss' },
            ]}
          />

          <View style={styles.adPreferenceCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.adPreferenceTitle}>Your ad preferences</Text>
              <Text style={styles.adPreferenceDescription}>
                Tell us what types of community updates you want to see more often.
              </Text>
            </View>
            <TouchableOpacity activeOpacity={0.8} style={styles.adPreferenceButton}>
              <Text style={styles.adPreferenceButtonLabel}>Adjust</Text>
            </TouchableOpacity>
          </View>

          <CommunityAdPost
            title="Boost your local business with Alba"
            description="Reach neighbors who are already looking for services like yours. Build trust with community-first ads."
            ctaLabel="Create ad"
            actions={[{ label: 'Hide' }, { label: 'Why this ad?' }]}
          />

          <CommunityArticlePost
            title="Weekly farmer's market recap"
            excerpt="Check out highlights from the farmer's market and see which vendors will be back next weekend."
            author="Alba Eats"
            time="5h ago"
            actions={[{ label: 'Bookmark' }, { label: 'Share' }]}
          />

          <CommunityEventPost
            title="Sunset yoga on the pier"
            date="Mon, Sep 16"
            time="6:30 PM"
            location="Harborfront Pier"
            description="Wind down with a restorative yoga flow led by certified instructors. Mats available on site."
            actions={[{ label: 'Interested' }, { label: 'Invite' }]}
          />
        </View>

        <View style={styles.peopleSection}>
          <View style={styles.peopleHeader}>
            <Text style={styles.peopleTitle}>People you may know</Text>
            <TouchableOpacity activeOpacity={0.8}>
              <Text style={styles.peopleSeeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {people.map((person) => (
              <PossibleKnownProfile
                key={person.id}
                name={person.name}
                role={person.role}
                mutualCount={person.mutualCount}
              />
            ))}
          </ScrollView>
        </View>

        <View style={{ height: 120 }} />
      </Animated.ScrollView>

      <Animated.View style={[styles.bottomBar, { opacity: bottomBarOpacity }]}>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.bottomLabel}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={[styles.bottomLabel, styles.bottomLabelActive]}>Community</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.bottomLabel}>Profile</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: '#F5F7FA',
    zIndex: 10,
  },
  heading: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1B1D28',
  },
  searchButton: {
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    shadowColor: '#0C1A4B',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    alignSelf: 'flex-start',
  },
  searchLabel: {
    color: '#6F7D95',
    fontSize: 16,
  },
  scrollContent: {
    paddingTop: 140,
    paddingHorizontal: 24,
    paddingBottom: 160,
  },
  tagList: {
    paddingRight: 24,
  },
  tagChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#fff',
    marginRight: 12,
  },
  tagLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1B1D28',
  },
  feedSection: {
    marginTop: 24,
  },
  adPreferenceCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#0C1A4B',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  adPreferenceTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1B1D28',
    marginBottom: 4,
  },
  adPreferenceDescription: {
    fontSize: 14,
    color: '#3B4453',
  },
  adPreferenceButton: {
    backgroundColor: '#00A9FF',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 16,
    marginLeft: 16,
  },
  adPreferenceButtonLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  peopleSection: {
    marginTop: 32,
  },
  peopleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  peopleTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1B1D28',
  },
  peopleSeeAll: {
    fontSize: 14,
    color: '#00A9FF',
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 32,
    paddingVertical: 20,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#0C1A4B',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  bottomLabel: {
    fontSize: 14,
    color: '#6F7D95',
    fontWeight: '600',
  },
  bottomLabelActive: {
    color: '#00A9FF',
  },
});
