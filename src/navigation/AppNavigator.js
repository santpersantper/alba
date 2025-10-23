import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthNavigator from './AuthNavigator';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator } from 'react-native';
import CommunityScreen from '../screens/CommunityScreen';

const Stack = createNativeStackNavigator();

function MainNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Community" component={CommunityScreen} />
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
