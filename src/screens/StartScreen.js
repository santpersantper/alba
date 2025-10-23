import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, Dimensions, StatusBar, StyleSheet
} from 'react-native';
import { useFonts } from 'expo-font';
import { supabase } from '../lib/supabase';

const { height } = Dimensions.get('window');

export default function StartScreen({ navigation }) {
  const [fontsLoaded] = useFonts({
    Poppins: require('../../assets/fonts/Poppins-Regular.ttf'),    
    PoppinsBold: require('../../assets/fonts/Poppins-Bold.ttf')
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!fontsLoaded) return null;

  const onLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    navigation.reset({ index: 0, routes: [{ name: 'HomePlaceholder' }] });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Image source={require('../../assets/icon.png')} style={styles.logo} />

      <TextInput
        style={styles.input}
        placeholder="email"
        placeholderTextColor="#E6F5FF"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="password"
        placeholderTextColor="#E6F5FF"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity onPress={onLogin} style={styles.nextBtn}>
        <Text style={styles.btnText}>Log in</Text>
      </TouchableOpacity>

      <Text style={{marginTop: 30, color: '#FFFFFF', fontFamily: 'Poppins'}}>
        Don’t have an account?{' '}
        <Text style={styles.link} onPress={() => navigation.navigate('SignUp')}>
          Sign up
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height,
    backgroundColor: '#00A9FF',
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
  brand: {
    fontFamily: 'Poppins',
    fontSize: 44,
    color: '#FFFFFF',
    marginBottom: 36,
  },
  input: {
    width: '78%',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: '#FFFFFF',
    fontFamily: 'Poppins',
    marginBottom: 14,
  },
  link: {
    textDecorationLine: 'none',
    fontFamily: 'PoppinsBold',
    fontWeight: '700',
    color: '#FFFFFF',
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
});
