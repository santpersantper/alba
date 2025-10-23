import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Image, ActivityIndicator, Alert
} from 'react-native';
import { useFonts } from 'expo-font';
import { supabase } from '../lib/supabase';
import Constants from 'expo-constants';
import { useSpotifyAuth, fetchTopArtists } from '../lib/spotify';

const SPOTIFY_CLIENT_ID =
  process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ??
  Constants.expoConfig?.extra?.expoPublic?.SPOTIFY_CLIENT_ID;

console.log('SPOTIFY clientId =>', SPOTIFY_CLIENT_ID); // should print a long string

const { height } = Dimensions.get('window');

export default function SignUpScreen({ navigation }) {
  const scrollRef = useRef(null);

  const fallbackSpotifyAuth = useMemo(() => ({
    request: null,
    response: null,
    promptAsync: () => {
      Alert.alert(
        'Spotify unavailable',
        'Spotify integration is not configured. Please contact support.'
      );
    },
  }), []);

  const { request, response, promptAsync } = SPOTIFY_CLIENT_ID
    ? useSpotifyAuth(SPOTIFY_CLIENT_ID)
    : fallbackSpotifyAuth;
  // page 1
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');           
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [city, setCity] = useState('');

  // page 2
  const [music, setMusic] = useState('');
  const [spotify, setSpotify] = useState(''); 
  const [spotifyConnected, setSpotifyConnected] = useState(false);

  // page 3
  const [movies, setMovies] = useState('');
  const [letterboxd, setLetterboxd] = useState('');

  // page 4
  const [books, setBooks] = useState('');
  const [goodreads, setGoodreads] = useState(''); 

  const [submitting, setSubmitting] = useState(false);

  const [fontsLoaded] = useFonts({
    Poppins: require('../../assets/fonts/Poppins-Regular.ttf'),
    PoppinsBold: require('../../assets/fonts/Poppins-Bold.ttf')
  });
  if (!fontsLoaded) return null;

  const scrollNext = (index) => {
    scrollRef.current?.scrollTo({ y: height * (index + 1), animated: true });
  };

  const validate = () => {
    if (!name || !username || !email || !password) {
      Alert.alert('Missing info', 'Name, username, email, and password are required.');
      return false;
    }
    if (username.length < 3) {
      Alert.alert('Username too short', 'Use at least 3 characters.');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Use at least 6 characters.');
      return false;
    }
    return true;
  };

  const handleFinish = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      // 1) Create Supabase auth user
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, username } },
      });
      if (signUpErr) throw signUpErr;

      const user = signUp.user;
      if (!user?.id) throw new Error('No user id returned from Supabase signUp');

      // 2) Insert profile row (id must equal auth.uid())
      const profile = {
      id: user.id,
      username,
      name,
      age: age ? Number(age) : null,
      gender,
      city,
      preferences: { music, spotify, movies, letterboxd, books, goodreads },
    };

    const { error: upsertErr } = await supabase
      .from('profiles')
      .upsert(profile, { onConflict: 'id' }); // ← avoids duplicate PK error
    if (upsertErr) throw upsertErr;


      // 3) Navigate to main app (session persisted by Supabase client)
      navigation.reset({ index: 0, routes: [{ name: 'HomePlaceholder' }] });
    } catch (e) {
      console.error('SIGNUP/PROFILE ERROR:', e);
      Alert.alert('Sign up failed', e.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (response?.type === 'success' && response.params?.access_token) {
        try {
          const top = await fetchTopArtists(response.params.access_token, 5);
          const names = top.map(t => t.name).join(', ');
          setSpotify(names);
          setSpotifyConnected(true);
          Alert.alert('Spotify connected', `Top artists: ${names}`);
        } catch (e) {
          Alert.alert('Spotify error', e.message);
        }
      }
    })();
  }, [response]);



  const Logo = () => (
    <Image source={require('../../assets/icon.png')} style={styles.logo} />
  );

  return (
    <ScrollView ref={scrollRef} pagingEnabled scrollEnabled={false} showsVerticalScrollIndicator={false}>
      {/* PAGE 1 */}
      <View style={styles.page}>
        <Logo />

        <TextInput style={styles.input} placeholder="First name" placeholderTextColor="#fff" value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#fff" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" /> {/* ✅ */}
        <TextInput style={styles.input} placeholder="@username" placeholderTextColor="#fff" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#fff" secureTextEntry value={password} onChangeText={setPassword} />
        <TextInput style={styles.input} placeholder="Age" placeholderTextColor="#fff" keyboardType="numeric" value={age} onChangeText={setAge} />
        <TextInput style={styles.input} placeholder="Gender" placeholderTextColor="#fff" value={gender} onChangeText={setGender} />
        <TextInput style={styles.input} placeholder="City" placeholderTextColor="#fff" value={city} onChangeText={setCity} />

        <TouchableOpacity style={styles.nextBtn} onPress={() => scrollNext(0)}>
          <Text style={styles.btnText}>Next</Text>
        </TouchableOpacity>
      </View>

      {/* PAGE 2 */}
      <View style={styles.page}>
        <Logo />

        <Text style={styles.question}>What are your favorite artists/music genres?</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Write them here..."
          placeholderTextColor="#fff"
          multiline
          value={music}
          onChangeText={setMusic}
        />
        <Text   
        style={styles.nextBtn}
        disabled={!request}
        onPress={() => promptAsync({ useProxy: true })}>
            {spotifyConnected ? 'Spotify Connected' : 'Connect to Spotify'}
        </Text>

        <TouchableOpacity style={styles.nextBtn} onPress={() => scrollNext(1)}>
          <Text style={styles.btnText}>Next</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => scrollNext(1)}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* PAGE 3 */}
      <View style={styles.page}>
        <Logo />

        <Text style={styles.question}>What are your favorite movies/TV shows?</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Write them here..."
          placeholderTextColor="#fff"
          multiline
          value={movies}
          onChangeText={setMovies}
        />
        <TextInput
          style={styles.input}
          placeholder="Link your Letterboxd account with Alba"
          placeholderTextColor="#fff"
          value={letterboxd}
          onChangeText={setLetterboxd}
          autoCapitalize="none"
        />

        <TouchableOpacity 
        style={styles.nextBtn}         
        onPress={handleFinish} 
        disabled={submitting}> {/* ✅ call handleFinish */}
          {submitting ? <ActivityIndicator /> : <Text style={styles.btnText}>Finish</Text>}
        </TouchableOpacity>
        <TouchableOpacity disabled={submitting} onPress={handleFinish}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}


const styles = StyleSheet.create({
  page: {
    height,
    backgroundColor: '#00A9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 30,
    resizeMode: 'contain',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#fff',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    color: '#fff',
    marginBottom: 15,
    fontFamily: 'Poppins',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  question: {
    color: '#fff',
    fontFamily: 'Poppins',
    fontSize: 16,
    marginBottom: 10,
    textAlign: 'center',
  },
  nextBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
    marginTop: 20,
  },
  btnText: {
    color: '#00A9FF',
    fontFamily: 'Poppins',
    fontSize: 16,
  },
  skipText: {
    color: '#fff',
    fontFamily: 'Poppins',
    fontSize: 14,
    marginTop: 10,
    textDecorationLine: 'underline',
  },
});
