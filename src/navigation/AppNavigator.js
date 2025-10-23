import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthNavigator from './AuthNavigator';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator, TouchableOpacity, Text } from 'react-native';

const Stack = createNativeStackNavigator();

function HomePlaceholder() {
  const onSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e) {
      console.warn('SignOut error:', e?.message || e);
    }
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00A9FF' }}>
      <Text style={{ color: '#fff', marginBottom: 16 }}>Signed in ✅</Text>

      <TouchableOpacity onPress={onSignOut} style={{ backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 }}>
        <Text style={{ color: '#00A9FF' }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

function MainNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomePlaceholder" component={HomePlaceholder} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let unsub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data.session);
      setReady(true);
      unsub = supabase.auth.onAuthStateChange((_event, session) => {
        setSignedIn(!!session);
      }).data.subscription;
    })();
    return () => unsub?.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {signedIn ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
