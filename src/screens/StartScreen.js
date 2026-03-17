import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  Image,
  Dimensions,
  StatusBar,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../lib/supabase';
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Linking from 'expo-linking';

// Required for expo-web-browser to close the auth session on redirect
WebBrowser.maybeCompleteAuthSession();

const { height } = Dimensions.get('window');

// Google OAuth Client IDs
const GOOGLE_WEB_CLIENT_ID =
  '1060018833152-f4u66s1ffklf2pphtfmmi23irf2m6mmg.apps.googleusercontent.com';
// iOS OAuth client — bundle ID: host.exp.Exponent (Expo Go testing)
// For production builds, create a separate iOS client with bundle ID com.alba.app
const GOOGLE_IOS_CLIENT_ID = '1060018833152-6inqrhrvjj8e7ld7igvadjfmeikeebfi.apps.googleusercontent.com';
// Android OAuth client — required by expo-auth-session to satisfy its invariant check on
// Android (it throws at mount if androidClientId is absent). The actual sign-in on Android
// goes through handleAndroidGoogleSignIn (Supabase OAuth) — promptAsync is never called.
const GOOGLE_ANDROID_CLIENT_ID = '1060018833152-8viosmmkbi0a2719vu4kbjd774rsb1hq.apps.googleusercontent.com';

export default function StartScreen({ navigation }) {
  const { theme, isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require('../../assets/fonts/Poppins-Regular.ttf'),
    PoppinsBold: require('../../assets/fonts/Poppins-Bold.ttf'),
  });

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);

  const [alertConfig, setAlertConfig] = useState(null);
  const showAlert = (title, message) => setAlertConfig({ title, message });

  // Google OAuth via expo-auth-session → signInWithIdToken
  // NOTE: iosClientId is intentionally omitted. When set, expo-auth-session uses the native
  // iOS Google client and the resulting ID token has the iOS client ID as its `aud` claim.
  // Supabase validates `aud` against its configured web client ID → "Unacceptable audience"
  // error. Omitting iosClientId forces the PKCE/browser flow on iOS so the token always
  // carries the web client ID as audience, which matches Supabase's setting.
  // androidClientId is still required to satisfy expo-auth-session's invariant on Android
  // (promptAsync is never called on Android — Android routes to handleAndroidGoogleSignIn).
  const [_request, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        navigation.getParent()?.reset({ index: 0, routes: [{ name: 'App' }] });
      }
    })();
  }, [navigation]);

  // Handle Google OAuth response
  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = response.authentication?.idToken;
      const accessToken = response.authentication?.accessToken;
      if (!idToken) {
        showAlert('Google sign in failed', 'No ID token received. Please try again.');
        setGoogleLoading(false);
        return;
      }
      (async () => {
        try {
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
            access_token: accessToken,
          });
          if (error) throw error;
          // AppNavigator's onAuthStateChange handles navigation.
          // For new Google users, ProfileSetupModal will appear automatically.
        } catch (e) {
          showAlert('Google sign in failed', e.message || 'Please try again.');
        } finally {
          setGoogleLoading(false);
        }
      })();
    } else if (response.type === 'error') {
      showAlert('Google sign in failed', response.error?.message || 'Please try again.');
      setGoogleLoading(false);
    } else if (response.type === 'dismiss' || response.type === 'cancel') {
      setGoogleLoading(false);
    }
  }, [response]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? '#222' : '#FFFFFF' }} />;

  const onLogin = async () => {
    if (!identifier || !password) {
      showAlert('Missing info', 'Please enter your email/username and password.');
      return;
    }

    setLoading(true);
    try {
      let emailToUse = identifier.trim();

      if (!emailToUse.includes('@')) {
        // Username lookup is case-insensitive; password remains case-sensitive
        const { data, error } = await supabase.rpc('get_email_for_username', {
          uname: emailToUse.toLowerCase(),
        });
        if (error || !data) throw new Error('Invalid username');
        emailToUse = data;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });
      if (error) throw error;

      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'App' }] });
    } catch (e) {
      showAlert('Login failed', e.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  // Android: Google blocks Android-type OAuth clients in browser flows (Error 400).
  // Use Supabase's OAuth flow instead. Note: openAuthSessionAsync on Android sometimes
  // returns just 'alba://' (bare scheme, no params) because the Chrome Custom Tab closes
  // when the Android intent system intercepts the deep link. We use Linking.addEventListener
  // as the primary URL capture and fall back to openAuthSessionAsync's return value.
  const handleAndroidGoogleSignIn = async () => {
    setGoogleLoading(true);
    let settled = false;

    const finish = async (url) => {
      if (settled) return;
      settled = true;
      try {
        // PKCE flow: code in query string (?code= or &code=)
        const codeMatch = url?.match(/[?&]code=([^&#]+)/);
        if (codeMatch?.[1]) {
          const { error } = await supabase.auth.exchangeCodeForSession(codeMatch[1]);
          if (error) throw error;
          return; // onAuthStateChange in AppNavigator handles navigation
        }
        // Implicit flow fallback: tokens in hash fragment
        const fragMatch = url?.match(/#(.+)/);
        if (fragMatch) {
          const params = new URLSearchParams(fragMatch[1]);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token) {
            const { error } = await supabase.auth.setSession({ access_token, refresh_token: refresh_token || '' });
            if (error) throw error;
            return;
          }
        }
        throw new Error('Authentication failed. Please try again.');
      } catch (e) {
        showAlert('Google sign in failed', e.message || 'Please try again.');
      } finally {
        setGoogleLoading(false);
      }
    };

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'alba://', skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL received');

      // Primary: listen for the deep link via Linking (more reliable on Android)
      const subscription = Linking.addEventListener('url', ({ url }) => {
        subscription.remove();
        finish(url);
      });

      const result = await WebBrowser.openAuthSessionAsync(data.url, 'alba://');

      // Fallback: if Linking didn't fire but openAuthSessionAsync captured the full URL
      if (!settled && result.type === 'success' && result.url && result.url.length > 'alba://'.length) {
        subscription.remove();
        finish(result.url);
      } else if (!settled && result.type !== 'success') {
        // User cancelled
        subscription.remove();
        settled = true;
        setGoogleLoading(false);
      }
      // If already settled by the Linking listener, do nothing
    } catch (e) {
      if (!settled) {
        settled = true;
        showAlert('Google sign in failed', e.message || 'Please try again.');
        setGoogleLoading(false);
      }
    }
  };

  const onGoogleSignIn = () => {
    if (Platform.OS === 'android') {
      handleAndroidGoogleSignIn();
    } else {
      setGoogleLoading(true);
      promptAsync();
    }
  };

  const onForgotPassword = async () => {
    const email = forgotEmail.trim();
    if (!email) {
      showAlert('Missing email', 'Please enter your email address.');
      return;
    }
    setForgotLoading(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server error (${res.status})${text ? ': ' + text : ''}`);
      }
      setForgotDone(true);
    } catch (e) {
      showAlert('Error', e?.message || 'Could not send reset email. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const accent = isDark ? '#FFFFFF' : '#00A9FF';

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <View
      style={[
        styles.container,
        { backgroundColor: isDark ? theme.gray : '#FFFFFF' },
      ]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {navigation.canGoBack() && (
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={8}>
          <Feather name="chevron-left" size={26} color={accent} />
        </TouchableOpacity>
      )}

      <Image source={require('../../assets/icon.png')} style={styles.logo} />

      <TextInput
        style={[styles.input, { borderColor: accent, color: accent }]}
        placeholder="email or username"
        placeholderTextColor={accent}
        autoCapitalize="none"
        value={identifier}
        onChangeText={setIdentifier}
      />

      <TextInput
        style={[styles.input, { borderColor: accent, color: accent }]}
        placeholder="password"
        placeholderTextColor={accent}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity
        onPress={onLogin}
        disabled={loading}
        style={[
          styles.nextBtn,
          isDark && { backgroundColor: theme.gray, borderWidth: 1, borderColor: '#FFFFFF' },
        ]}
      >
        <Text style={styles.btnText}>
          {loading ? 'logging in…' : 'log in'}
        </Text>
      </TouchableOpacity>

      {/* Google Sign-In */}
      <TouchableOpacity
        onPress={onGoogleSignIn}
        disabled={googleLoading}
        style={[
          styles.googleBtn,
          isDark ? { borderColor: '#FFFFFF' } : { borderColor: '#00A9FF' },
          { opacity: googleLoading ? 0.7 : 1 },
        ]}
      >
        {googleLoading ? (
          <ActivityIndicator color={accent} size="small" />
        ) : (
          <>
            <Text style={[styles.googleG, { color: accent }]}>G</Text>
            <Text style={[styles.googleBtnText, { color: accent }]}>
              continue with google
            </Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={{ marginTop: 24, color: accent, fontFamily: 'Poppins' }}>
        don't have an account?{' '}
        <Text
          style={[styles.link, { color: accent }]}
          onPress={() => navigation.navigate('SignUp')}
        >
          sign up
        </Text>
      </Text>

      <TouchableOpacity
        onPress={() => { setForgotEmail(''); setForgotDone(false); setForgotVisible(true); }}
        style={{ marginTop: 14 }}
      >
        <Text style={[styles.forgotLink, { color: accent }]}>forgot your password?</Text>
      </TouchableOpacity>

      {/* Alba-native alert modal */}
      <Modal
        visible={!!alertConfig}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertConfig(null)}
      >
        <View style={styles.alertOverlay}>
          <View style={[styles.alertCard, { backgroundColor: isDark ? '#2a2a2a' : '#FFFFFF' }]}>
            <Text style={[styles.alertTitle, { color: isDark ? '#FFFFFF' : '#111' }]}>
              {alertConfig?.title}
            </Text>
            <Text style={[styles.alertBody, { color: isDark ? '#aaa' : '#555' }]}>
              {alertConfig?.message}
            </Text>
            <TouchableOpacity style={styles.alertBtn} onPress={() => setAlertConfig(null)}>
              <Text style={styles.alertBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={forgotVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.forgotOverlay}
        >
          <View style={[styles.forgotCard, { backgroundColor: isDark ? '#2a2a2a' : '#FFFFFF' }]}>
            {forgotDone ? (
              <>
                <TouchableOpacity
                  onPress={() => setForgotVisible(false)}
                  style={styles.forgotCloseBtn}
                  hitSlop={8}
                >
                  <Feather name="x" size={20} color={isDark ? '#aaa' : '#6F7D95'} />
                </TouchableOpacity>
                <Text style={[styles.forgotTitle, { color: isDark ? '#FFFFFF' : '#111' }]}>
                  Check your inbox
                </Text>
                <Text style={[styles.forgotCaption, { color: isDark ? '#aaa' : '#555' }]}>
                  If that email is registered with Alba, you'll receive a temporary password shortly. Use it to log in, then change it from Settings.
                </Text>
                <TouchableOpacity style={styles.forgotBtn} onPress={() => setForgotVisible(false)}>
                  <Text style={styles.forgotBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.forgotTitle, { color: isDark ? '#FFFFFF' : '#111' }]}>
                  Reset your password
                </Text>
                <Text style={[styles.forgotCaption, { color: isDark ? '#aaa' : '#555' }]}>
                  Enter the email address associated with your Alba account. We'll send you a temporary password you can use to log back in.
                </Text>
                <TextInput
                  style={[
                    styles.forgotInput,
                    {
                      borderColor: isDark ? '#555' : '#d0d7e2',
                      color: isDark ? '#FFFFFF' : '#111',
                      backgroundColor: isDark ? '#1a1a1a' : '#f5f6fa',
                    },
                  ]}
                  placeholder="your email"
                  placeholderTextColor={isDark ? '#888' : '#9fa5b3'}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  editable={!forgotLoading}
                />
                <View style={styles.forgotRow}>
                  <TouchableOpacity
                    style={[styles.forgotBtn, styles.forgotCancelBtn]}
                    onPress={() => setForgotVisible(false)}
                    disabled={forgotLoading}
                  >
                    <Text style={[styles.forgotBtnText, { color: isDark ? '#aaa' : '#6F7D95' }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.forgotBtn, { opacity: forgotLoading ? 0.6 : 1 }]}
                    onPress={onForgotPassword}
                    disabled={forgotLoading}
                  >
                    {forgotLoading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.forgotBtnText}>Send</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    height,
    alignItems: 'center',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  backBtn: {
    position: 'absolute',
    top: 48,
    left: 24,
  },
  logo: {
    width: 96,
    height: 96,
    resizeMode: 'contain',
    marginBottom: 16,
  },
  input: {
    width: '78%',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: 'Poppins',
    marginBottom: 14,
  },
  nextBtn: {
    backgroundColor: '#00A9FF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
    marginTop: 20,
  },
  btnText: {
    color: '#FFFFFF',
    fontFamily: 'Poppins',
    fontSize: 16,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 28,
    marginTop: 14,
    gap: 8,
    width: '78%',
    justifyContent: 'center',
  },
  googleG: {
    fontFamily: 'PoppinsBold',
    fontSize: 16,
  },
  googleBtnText: {
    fontFamily: 'Poppins',
    fontSize: 15,
  },
  link: {
    fontFamily: 'PoppinsBold',
    padding: 5,
  },
  forgotLink: {
    fontFamily: 'Poppins',
    fontSize: 13,
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  alertCard: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    elevation: 6,
    alignItems: 'center',
  },
  alertTitle: {
    fontFamily: 'PoppinsBold',
    fontSize: 17,
    marginBottom: 10,
    textAlign: 'center',
  },
  alertBody: {
    fontFamily: 'Poppins',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  alertBtn: {
    backgroundColor: '#00A9FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 40,
  },
  alertBtnText: {
    fontFamily: 'PoppinsBold',
    fontSize: 14,
    color: '#fff',
  },
  forgotOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  forgotCard: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    elevation: 6,
  },
  forgotCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 1,
  },
  forgotTitle: {
    fontFamily: 'PoppinsBold',
    fontSize: 17,
    marginBottom: 10,
  },
  forgotCaption: {
    fontFamily: 'Poppins',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 18,
  },
  forgotInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: 'Poppins',
    fontSize: 14,
    marginBottom: 18,
  },
  forgotRow: {
    flexDirection: 'row',
    gap: 10,
  },
  forgotBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00A9FF',
  },
  forgotCancelBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#d0d7e2',
  },
  forgotBtnText: {
    fontFamily: 'PoppinsBold',
    fontSize: 14,
    color: '#fff',
  },
});
