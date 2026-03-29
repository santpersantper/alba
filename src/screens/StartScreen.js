import React, { useEffect, useRef, useState } from 'react';
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
import { Feather, Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../lib/supabase';
import { useAlbaTheme } from "../theme/ThemeContext";
import { useAlbaLanguage } from "../theme/LanguageContext";
import { posthog } from '../lib/analytics';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { getDeviceId } from '../lib/deviceId';

// Required for expo-web-browser to close the auth session on redirect
WebBrowser.maybeCompleteAuthSession();

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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  // ── New device verification state ─────────────────────────────────────────
  const [deviceOtpVisible, setDeviceOtpVisible] = useState(false);
  const [deviceOtp, setDeviceOtp] = useState('');
  const [verifyingDevice, setVerifyingDevice] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);
  // Stored while waiting for device OTP
  const pendingEmailRef = useRef('');
  const pendingPasswordRef = useRef('');
  const pendingDeviceIdRef = useRef('');
  const pendingUserIdRef = useRef('');

  const [signUpCheckLoading, setSignUpCheckLoading] = useState(false);

  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);

  const [alertConfig, setAlertConfig] = useState(null);
  const showAlert = (title, message) => setAlertConfig({ title, message });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        navigation.getParent()?.reset({ index: 0, routes: [{ name: 'App' }] });
      }
    })();
  }, [navigation]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: isDark ? '#222' : '#FFFFFF' }} />;

  const accent = isDark ? '#FFFFFF' : '#00A9FF';

  // ── Login helpers ─────────────────────────────────────────────────────────

  const resolveEmail = async (raw) => {
    const trimmed = raw.trim();
    if (trimmed.includes('@')) return trimmed;
    const { data, error } = await supabase.rpc('get_email_for_username', {
      uname: trimmed.toLowerCase(),
    });
    if (error || !data) throw new Error('Invalid username');
    return data;
  };

  const completeLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: pendingEmailRef.current,
      password: pendingPasswordRef.current,
    });
    if (error) throw error;
    posthog.capture('user_logged_in', { method: 'email' });
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'App' }] });
  };

  // ── Step 1: tap "Log in" ──────────────────────────────────────────────────

  const onLogin = async () => {
    if (!identifier || !password) {
      showAlert('Missing info', 'Please enter your email/username and password.');
      return;
    }

    setLoading(true);
    try {
      const email = await resolveEmail(identifier);
      const deviceId = await getDeviceId();

      // Check whether this device is known for this account
      const { data, error: checkErr } = await supabase.functions.invoke(
        'send-verification-code',
        { body: { action: 'check_login_device', email, device_id: deviceId } }
      );
      if (checkErr) throw checkErr;

      pendingEmailRef.current = email;
      pendingPasswordRef.current = password;
      pendingDeviceIdRef.current = deviceId ?? '';
      pendingUserIdRef.current = data?.user_id ?? '';

      const status = data?.status ?? 'known';

      if (status === 'new_device') {
        // Unknown device — send OTP before allowing login
        const { data: sendData, error: sendErr } = await supabase.functions.invoke(
          'send-verification-code',
          { body: { action: 'send_login_otp', email } }
        );
        if (sendErr) throw sendErr;
        if (sendData?.error === 'rate_limit') {
          showAlert(t('login_device_ratelimit_title'), `${t('login_device_ratelimit_body')} ${sendData.wait}s.`);
          return;
        }
        setDeviceOtp('');
        setDeviceOtpVisible(true);
        return;
      }

      // Known or first device — log in directly
      await completeLogin();

      if (status === 'first_device' && deviceId) {
        // Register this device in the background (non-blocking)
        supabase.functions.invoke('send-verification-code', {
          body: { action: 'register_device', device_id: deviceId },
        }).catch(() => {});
      }
    } catch (e) {
      showAlert('Login failed', e.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: user entered OTP for new device ───────────────────────────────

  const onDeviceOtpVerify = async () => {
    if (deviceOtp.length < 6) return;
    setVerifyingDevice(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-verification-code', {
        body: {
          action: 'verify_login_otp',
          email: pendingEmailRef.current,
          code: deviceOtp,
          device_id: pendingDeviceIdRef.current,
          user_id: pendingUserIdRef.current || undefined,
        },
      });
      if (error) throw error;

      if (!data?.ok) {
        const reason = data?.reason;
        const msg = reason === 'expired'
          ? t('signup_code_expired_body')
          : t('signup_code_invalid_body');
        showAlert(t('signup_code_invalid_title'), msg);
        return;
      }

      setDeviceOtpVisible(false);
      await completeLogin();
    } catch (e) {
      showAlert('Verification failed', e.message || 'Please try again.');
    } finally {
      setVerifyingDevice(false);
    }
  };

  const onDeviceOtpResend = async () => {
    if (resendingOtp) return;
    setResendingOtp(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-verification-code', {
        body: { action: 'send_login_otp', email: pendingEmailRef.current },
      });
      if (error) throw error;
      if (data?.error === 'rate_limit') {
        showAlert(t('login_device_ratelimit_title'), `${t('login_device_ratelimit_body')} ${data.wait}s.`);
        return;
      }
      showAlert(t('signup_code_resent_title'), t('signup_code_resent_body'));
    } catch (e) {
      showAlert('Error', e.message || 'Could not resend code.');
    } finally {
      setResendingOtp(false);
    }
  };

  // ── Google sign-in ────────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    let settled = false;

    const finish = async (url) => {
      if (settled) return;
      settled = true;
      console.log('[Google] finish() called, url:', url?.substring(0, 80));
      try {
        const codeMatch = url?.match(/[?&]code=([^&#]+)/);
        if (codeMatch?.[1]) {
          console.log('[Google] branch: exchangeCodeForSession');
          const { error } = await supabase.auth.exchangeCodeForSession(codeMatch[1]);
          console.log('[Google] exchangeCodeForSession result — error:', error?.message ?? null);
          if (error) throw error;
          posthog.capture('user_logged_in', { method: 'google' });
          return;
        }
        const fragMatch = url?.match(/#(.+)/);
        if (fragMatch) {
          const params = new URLSearchParams(fragMatch[1]);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          console.log('[Google] branch: setSession, has access_token:', !!access_token, 'has refresh_token:', !!refresh_token);
          if (access_token) {
            const { error } = await supabase.auth.setSession({ access_token, refresh_token: refresh_token || '' });
            console.log('[Google] setSession result — error:', error?.message ?? null);
            if (error) throw error;
            return;
          }
        }
        console.warn('[Google] finish(): no code or token found in URL');
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

      const subscription = Linking.addEventListener('url', ({ url }) => {
        subscription.remove();
        finish(url);
      });

      const result = await WebBrowser.openAuthSessionAsync(data.url, 'alba://');
      console.log('[Google] WebBrowser result type:', result.type, 'settled:', settled);

      if (!settled && result.type === 'success' && result.url && result.url.length > 'alba://'.length) {
        subscription.remove();
        finish(result.url);
      } else if (!settled && result.type !== 'success') {
        console.log('[Google] auth cancelled or failed, result:', result.type);
        subscription.remove();
        settled = true;
        setGoogleLoading(false);
      }
    } catch (e) {
      if (!settled) {
        settled = true;
        showAlert('Google sign in failed', e.message || 'Please try again.');
        setGoogleLoading(false);
      }
    }
  };

  // ── Apple sign-in ─────────────────────────────────────────────────────────

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    try {
      // Generate a random nonce, pass the SHA-256 hash to Apple,
      // and the raw value to Supabase so it can verify the JWT.
      const rawNonce = Array.from(Crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error) throw error;
      posthog.capture('user_logged_in', { method: 'apple' });
      // Auth state change in AppNavigator handles navigation automatically.
    } catch (e) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        showAlert('Apple sign in failed', e.message || 'Please try again.');
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const onSignUpPress = async () => {
    setSignUpCheckLoading(true);
    try {
      const deviceId = await getDeviceId();
      const { data, error } = await supabase.functions.invoke('check-signup-eligibility', {
        body: { device_id: deviceId ?? null },
      });
      if (error) throw error;

      if (!data?.allowed) {
        const reason = data?.reason;
        if (reason === 'device_limit') {
          showAlert(
            'Account limit reached',
            'This device already has 2 Alba accounts. You cannot create another account from this device.'
          );
        } else {
          showAlert(
            'Account limit reached',
            'Too many accounts have been created from your network. You cannot create another account at this time.'
          );
        }
        return;
      }

      navigation.navigate('SignUp');
    } catch {
      // Fail open — let them through if the check errors
      navigation.navigate('SignUp');
    } finally {
      setSignUpCheckLoading(false);
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={[styles.container, { backgroundColor: isDark ? theme.gray : '#FFFFFF' }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

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

        <TouchableOpacity
          onPress={handleGoogleSignIn}
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
              <Text style={[styles.socialIcon, styles.googleG, { color: accent }]}>G</Text>
              <Text style={[styles.googleBtnText, { color: accent }]}>
                continue with google
              </Text>
            </>
          )}
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            onPress={handleAppleSignIn}
            disabled={appleLoading}
            style={[
              styles.googleBtn,
              isDark ? { borderColor: '#FFFFFF' } : { borderColor: '#00A9FF' },
              { opacity: appleLoading ? 0.7 : 1 },
            ]}
          >
            {appleLoading ? (
              <ActivityIndicator color={accent} size="small" />
            ) : (
              <>
                <Ionicons name="logo-apple" size={18} color={accent} style={styles.socialIcon} />
                <Text style={[styles.googleBtnText, { color: accent }]}>
                  continue with apple
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text style={{ marginTop: 24, color: accent, fontFamily: 'Poppins' }}>
          don't have an account?{' '}
          {signUpCheckLoading ? (
            <ActivityIndicator size="small" color={accent} style={{ marginLeft: 4 }} />
          ) : (
            <Text
              style={[styles.link, { color: accent }]}
              onPress={onSignUpPress}
            >
              sign up
            </Text>
          )}
        </Text>

        <TouchableOpacity
          onPress={() => { setForgotEmail(''); setForgotDone(false); setForgotVisible(true); }}
          style={{ marginTop: 14 }}
        >
          <Text style={[styles.forgotLink, { color: accent }]}>forgot your password?</Text>
        </TouchableOpacity>

        {/* ── Alert modal ──────────────────────────────────────────────── */}
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

        {/* ── New device OTP modal ─────────────────────────────────────── */}
        <Modal
          visible={deviceOtpVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDeviceOtpVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.forgotOverlay}
          >
            <View style={[styles.forgotCard, { backgroundColor: isDark ? '#2a2a2a' : '#FFFFFF' }]}>
              <Text style={[styles.forgotTitle, { color: isDark ? '#FFFFFF' : '#111' }]}>
                {t('login_new_device_title')}
              </Text>
              <Text style={[styles.forgotCaption, { color: isDark ? '#aaa' : '#555' }]}>
                {t('login_new_device_body')} {pendingEmailRef.current}.
              </Text>

              <TextInput
                style={[
                  styles.otpInput,
                  {
                    borderColor: isDark ? '#555' : '#d0d7e2',
                    color: isDark ? '#FFFFFF' : '#111',
                    backgroundColor: isDark ? '#1a1a1a' : '#f5f6fa',
                  },
                ]}
                placeholder="000000"
                placeholderTextColor={isDark ? '#666' : '#aaa'}
                keyboardType="number-pad"
                maxLength={6}
                value={deviceOtp}
                onChangeText={(v) => setDeviceOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
                autoFocus
              />

              <View style={styles.forgotRow}>
                <TouchableOpacity
                  style={[styles.forgotBtn, styles.forgotCancelBtn]}
                  onPress={() => setDeviceOtpVisible(false)}
                  disabled={verifyingDevice}
                >
                  <Text style={[styles.forgotBtnText, { color: isDark ? '#aaa' : '#6F7D95' }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.forgotBtn, (verifyingDevice || deviceOtp.length < 6) && { opacity: 0.6 }]}
                  onPress={onDeviceOtpVerify}
                  disabled={verifyingDevice || deviceOtp.length < 6}
                >
                  {verifyingDevice
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.forgotBtnText}>{t('login_new_device_verify_btn')}</Text>}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={onDeviceOtpResend}
                disabled={resendingOtp}
                style={{ marginTop: 14, alignSelf: 'center' }}
              >
                <Text style={[styles.forgotLink, { color: accent, opacity: resendingOtp ? 0.4 : 0.75 }]}>
                  {resendingOtp ? t('signup_code_sending') : t('signup_code_resend')}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── Forgot password modal ────────────────────────────────────── */}
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
    width: '78%',
    justifyContent: 'center',
  },
  socialIcon: {
    position: 'absolute',
    left: 16,
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
  otpInput: {
    height: 56,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: 'Poppins',
    fontSize: 26,
    letterSpacing: 14,
    textAlign: 'center',
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
