import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Dimensions,
  StatusBar,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFonts } from 'expo-font';
import { supabase } from '../lib/supabase';
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";

const { height } = Dimensions.get('window');

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

  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        navigation.getParent()?.reset({
          index: 0,
          routes: [{ name: "App" }],
        });

      }
    })();
  }, [navigation]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? "#222" : "#FFFFFF" }} />;

  const onLogin = async () => {
    if (!identifier || !password) {
      Alert.alert('Missing info', 'Please enter your email/username and password.');
      return;
    }

    setLoading(true);
    try {
      let emailToUse = identifier.trim();

      if (!emailToUse.includes('@')) {
        const { data, error } = await supabase.rpc('get_email_for_username', {
          uname: emailToUse,
        });
        if (error || !data) throw new Error('Invalid username');
        emailToUse = data;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });
      if (error) throw error;

      navigation.getParent()?.reset({
        index: 0,
        routes: [{ name: "App" }],
      });

    } catch (e) {
      Alert.alert('Login failed', e.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  const onForgotPassword = async () => {
    const email = forgotEmail.trim();
    if (!email) {
      Alert.alert('Missing email', 'Please enter your email address.');
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.functions.invoke('forgot-password', {
        body: { email },
      });
      if (error) throw error;
      setForgotDone(true);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not send reset email. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const accent = isDark ? '#FFFFFF' : '#00A9FF';

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isDark ? theme.gray : '#FFFFFF' },
      ]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <Image source={require('../../assets/icon.png')} style={styles.logo} />

      <TextInput
        style={[
          styles.input,
          { borderColor: accent, color: accent },
        ]}
        placeholder="email or username"
        placeholderTextColor={accent}
        autoCapitalize="none"
        value={identifier}
        onChangeText={setIdentifier}
      />

      <TextInput
        style={[
          styles.input,
          { borderColor: accent, color: accent },
        ]}
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
          isDark && {
            backgroundColor: theme.gray,
            borderWidth: 1,
            borderColor: '#FFFFFF',
          },
        ]}
      >
        <Text style={styles.btnText}>
          {loading ? 'Logging in…' : 'log in'}
        </Text>
      </TouchableOpacity>

      <Text style={{ marginTop: 30, color: accent, fontFamily: 'Poppins', }}>
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
                <Text style={[styles.forgotTitle, { color: isDark ? '#FFFFFF' : '#111' }]}>
                  Check your inbox
                </Text>
                <Text style={[styles.forgotCaption, { color: isDark ? '#aaa' : '#555' }]}>
                  If that email is registered with Alba, you'll receive a temporary password shortly. Use it to log in, then change it from Settings.
                </Text>
                <TouchableOpacity
                  style={styles.forgotBtn}
                  onPress={() => setForgotVisible(false)}
                >
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
  );
}

const styles = StyleSheet.create({
  container: {
    height,
    alignItems: 'center',
    paddingHorizontal: 24,
    justifyContent: 'center',
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
  link: {
    fontFamily: 'PoppinsBold',
    fontWeight: '700',
    padding: 5
  },
  forgotLink: {
    fontFamily: 'Poppins',
    fontSize: 13,
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
  forgotTitle: {
    fontFamily: 'PoppinsBold',
    fontSize: 17,
    fontWeight: '700',
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
    fontWeight: '700',
    color: '#fff',
  },
});
