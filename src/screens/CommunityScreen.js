import React, { useMemo, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import CommunityEventPost from '../components/CommunityEventPost';
import CommunityAdPost from '../components/CommunityAdPost';
import CommunityArticlePost from '../components/CommunityArticlePost';
import PossibleKnownProfile from '../components/PossibleKnownProfile';

const TOP_OPTIONS = [
  { label: 'Messages', active: true },
  { label: 'Profile', active: false },
  { label: 'Settings', active: false },
];

const BOTTOM_OPTIONS = [
  { label: 'Feed', active: false },
  { label: 'Community', active: true },
];

export default function CommunityScreen() {
  const [fontsLoaded] = useFonts({
    'Poppins-Regular': require('../../assets/fonts/Poppins-Regular.ttf'),
    'Poppins-Medium': require('../../assets/fonts/Poppins-Medium.ttf'),
    'Poppins-SemiBold': require('../../assets/fonts/Poppins-SemiBold.ttf'),
    'Poppins-Bold': require('../../assets/fonts/Poppins-Bold.ttf'),
  });

  const topBarOpacity = useRef(new Animated.Value(1)).current;
  const bottomBarOpacity = useRef(new Animated.Value(1)).current;
  const lastOffset = useRef(0);
  const animationState = useRef('shown');

  const tags = useMemo(
    () => [
      'For you',
      'Local',
      'Events',
      'Discussions',
      'Resources',
      'Marketplace',
    ],
    []
  );

  const people = useMemo(
    () => [
      { id: '1', name: 'Lucio Rossi', role: 'Musician', mutualCount: 3 },
      { id: '2', name: 'Cesare Bolo', role: 'Community Planner', mutualCount: 2 },
      { id: '3', name: 'Stefano Russo', role: 'Event Producer', mutualCount: 1 },
      { id: '4', name: 'Giulia Marini', role: 'Local Guide', mutualCount: 4 },
    ],
    []
  );

  const feedItems = useMemo(
    () => [
      {
        id: 'event-1',
        type: 'event',
        data: {
          handle: '@areacanemilano',
          timestamp: 'Oct 17, 2024, Parco Sempione 20154 Milano MI',
          title: 'Dog Adoption Day',
          date: 'Sun, Oct 20',
          time: '9:30 AM',
          location: 'Parco Sempione, Milano',
          description:
            'Do you love dogs? Then come to Parco Sempione this Sunday and make a new friend! Associazione Area Cani Milano is hosting a day full of games and cuddles.',
          image: { uri: 'https://images.unsplash.com/photo-1525253086316-d0c936c814f8?auto=format&fit=crop&w=1100&q=80' },
          actions: [
            { label: 'Buy tickets' },
            { label: 'Join event chat' },
            { label: 'Share' },
          ],
        },
      },
      {
        id: 'article-1',
        type: 'article',
        data: {
          handle: '@milanotoday',
          timestamp: 'Oct 17, 2024',
          title: 'Mancano 350 autisti, "rivoluzione" Atm: nuovi turni e case a prezzi calmierati',
          excerpt:
            "L'avvio di un tavolo di confronto tra azienda e sindacati porta nuove soluzioni per gli autisti: più flessibilità sugli orari e nuovi alloggi dedicati.",
          image: { uri: 'https://images.unsplash.com/photo-1518458028785-8fbcd101ebb9?auto=format&fit=crop&w=1100&q=80' },
          actions: [
            { label: 'Discuss' },
            { label: 'Share' },
            { label: 'Save' },
          ],
        },
      },
      {
        id: 'event-2',
        type: 'event',
        data: {
          handle: '@creaproduzioni',
          timestamp: 'Oct 18, 2024, Viale Molise 62, 20137 Milano MI',
          title: "Le Cannibale all'Ex Macello - Closing",
          date: 'Fri, Oct 18',
          time: '10:00 PM',
          location: 'Viale Molise 62, Milano',
          description: "The final Le Cannibale party at Ex Macello. Let's close the season together!",
          image: { uri: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1100&q=80' },
          actions: [
            { label: 'Buy tickets' },
            { label: 'Join event chat' },
            { label: 'Share' },
          ],
        },
      },
      {
        id: 'ad-1',
        type: 'ad',
        data: {
          handle: '@dicepeople',
          timestamp: 'Promoted • Oct 18, 2024',
          title: 'Marinara o Sagra del Cannone?',
          description:
            'Vota il tuo gusto preferito e ricevi una box di pizza gratuita al prossimo evento in streaming con i nostri pizzaioli resident.',
          image: { uri: 'https://images.unsplash.com/photo-1601925260485-259fabfaae24?auto=format&fit=crop&w=1100&q=80' },
          ctaLabel: 'Learn more',
          actions: [
            { label: 'Hide ad' },
            { label: 'Why this ad?' },
            { label: 'Save' },
          ],
        },
      },
      {
        id: 'article-2',
        type: 'article',
        data: {
          handle: '@communityvoltanica',
          timestamp: 'Oct 18, 2024',
          title: 'Would you be interested in receiving ads about pizza al trancio?',
          excerpt:
            'Your ad preferences help us suggest tastier deals from local restaurants. Update your picks to customise the flavours appearing in your feed.',
          image: { uri: 'https://images.unsplash.com/photo-1600891964093-05b2198f2a3f?auto=format&fit=crop&w=1100&q=80' },
          actions: [
            { label: 'Discuss' },
            { label: 'Share' },
            { label: 'Save' },
          ],
        },
      },
      {
        id: 'event-3',
        type: 'event',
        data: {
          handle: '@fueraroom',
          timestamp: 'Oct 18, 2024, Viale Toscana 31, 20136 Milano MI',
          title: 'Fuera - Live at Santeria Toscana 31',
          date: 'Fri, Nov 01',
          time: '9:00 PM',
          location: 'Santeria Toscana 31',
          description:
            'Ci vediamo lì! Stiamo tornando a Milano per il tour autunnale, con nuovi brani e tanti ospiti sul palco.',
          image: { uri: 'https://images.unsplash.com/photo-1518972559570-1ecb0a3c76e0?auto=format&fit=crop&w=1100&q=80' },
          actions: [
            { label: 'Buy tickets' },
            { label: 'Join event chat' },
            { label: 'Share' },
          ],
        },
      },
    ],
    []
  );

  const fadeBars = (nextState) => {
    if (animationState.current === nextState) return;
    animationState.current = nextState;
    Animated.parallel([
      Animated.timing(topBarOpacity, {
        toValue: nextState === 'shown' ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(bottomBarOpacity, {
        toValue: nextState === 'shown' ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleScroll = ({ nativeEvent }) => {
    const currentOffset = nativeEvent.contentOffset.y;
    const diff = currentOffset - lastOffset.current;

    if (currentOffset <= 0) {
      fadeBars('shown');
      lastOffset.current = 0;
      return;
    }

    if (Math.abs(diff) < 6) {
      lastOffset.current = currentOffset;
      return;
    }

    if (diff > 0) {
      fadeBars('hidden');
    } else {
      fadeBars('shown');
    }

    lastOffset.current = currentOffset;
  };

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Animated.View style={[styles.topBar, { opacity: topBarOpacity }]}>
        <View style={styles.topOptionsRow}>
          {TOP_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.label}
              style={[styles.topOptionButton, option.active && styles.topOptionButtonActive]}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.topOptionLabel, option.active && styles.topOptionLabelActive]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.heading}>Community</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.searchButton}>
            <Text style={styles.searchLabel}>Search</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagList}
        >
          {tags.map((tag, index) => (
            <View
              key={tag}
              style={[styles.tagChip, index === 0 && styles.tagChipActive]}
            >
              <Text
                style={[styles.tagLabel, index === 0 && styles.tagLabelActive]}
              >
                {tag}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.feedSection}>
          {feedItems.map((item) => {
            if (item.type === 'event') {
              return <CommunityEventPost key={item.id} {...item.data} />;
            }
            if (item.type === 'article') {
              return <CommunityArticlePost key={item.id} {...item.data} />;
            }
            return <CommunityAdPost key={item.id} {...item.data} />;
          })}
        </View>

        <View style={styles.adPreferenceCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.adPreferenceTitle}>Your ad preferences</Text>
            <Text style={styles.adPreferenceDescription}>
              Tell us what types of community updates you want to see more often.
            </Text>
          </View>
          <TouchableOpacity activeOpacity={0.85} style={styles.adPreferenceButton}>
            <Text style={styles.adPreferenceButtonLabel}>Adjust</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.peopleSection}>
          <View style={styles.peopleHeader}>
            <Text style={styles.peopleTitle}>People you may know</Text>
            <TouchableOpacity activeOpacity={0.85}>
              <Text style={styles.peopleSeeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peopleList}
          >
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

        <View style={styles.bottomSpacer} />
      </Animated.ScrollView>

      <Animated.View style={[styles.bottomBar, { opacity: bottomBarOpacity }]}>
        {BOTTOM_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.label}
            style={styles.bottomItem}
            activeOpacity={0.9}
          >
            <Text
              style={[styles.bottomLabel, option.active && styles.bottomLabelActive]}
            >
              {option.label}
            </Text>
            {option.active ? <View style={styles.bottomIndicator} /> : null}
          </TouchableOpacity>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F7FF',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 58,
    paddingBottom: 22,
    paddingHorizontal: 24,
    backgroundColor: '#F9FBFF',
    shadowColor: 'rgba(15, 26, 42, 0.15)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 8,
    zIndex: 20,
  },
  topOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 26,
  },
  topOptionButton: {
    flex: 1,
    marginHorizontal: 6,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  topOptionButtonActive: {
    backgroundColor: '#E3F1FF',
  },
  topOptionLabel: {
    fontFamily: 'Poppins-Medium',
    fontSize: 14,
    color: '#7A90AA',
  },
  topOptionLabelActive: {
    color: '#0F1A2A',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: {
    fontFamily: 'Poppins-Bold',
    fontSize: 30,
    color: '#0F1A2A',
  },
  searchButton: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 20,
    backgroundColor: '#E9F2FF',
  },
  searchLabel: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
    color: '#1A8FE3',
  },
  scrollContent: {
    paddingTop: 220,
    paddingHorizontal: 24,
    paddingBottom: 220,
  },
  tagList: {
    paddingRight: 24,
  },
  tagChip: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: '#E9F2FF',
    marginRight: 12,
  },
  tagChipActive: {
    backgroundColor: '#1A8FE3',
  },
  tagLabel: {
    fontFamily: 'Poppins-Medium',
    fontSize: 14,
    color: '#1A8FE3',
  },
  tagLabelActive: {
    color: '#FFFFFF',
  },
  feedSection: {
    marginTop: 30,
  },
  adPreferenceCard: {
    marginTop: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    paddingVertical: 26,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: 'rgba(15, 26, 42, 0.14)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 4,
  },
  adPreferenceTitle: {
    fontFamily: 'Poppins-Bold',
    fontSize: 18,
    color: '#0F1A2A',
    marginBottom: 6,
  },
  adPreferenceDescription: {
    fontFamily: 'Poppins-Regular',
    fontSize: 14,
    color: '#23405A',
    lineHeight: 20,
  },
  adPreferenceButton: {
    marginLeft: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    backgroundColor: '#1A8FE3',
  },
  adPreferenceButtonLabel: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  peopleSection: {
    marginTop: 32,
  },
  peopleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  peopleTitle: {
    fontFamily: 'Poppins-Bold',
    fontSize: 20,
    color: '#0F1A2A',
  },
  peopleSeeAll: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
    color: '#1A8FE3',
  },
  peopleList: {
    paddingRight: 24,
  },
  bottomSpacer: {
    height: 140,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 36,
    paddingVertical: 22,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowColor: 'rgba(15, 26, 42, 0.18)',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomItem: {
    alignItems: 'center',
    flex: 1,
  },
  bottomLabel: {
    fontFamily: 'Poppins-Medium',
    fontSize: 14,
    color: '#7A90AA',
  },
  bottomLabelActive: {
    color: '#1A8FE3',
  },
  bottomIndicator: {
    marginTop: 8,
    height: 4,
    borderRadius: 2,
    width: 26,
    backgroundColor: '#1A8FE3',
  },
});
