import 'react-native-get-random-values';

import * as Sentry from '@sentry/react-native';
import React from 'react';
import { PostHogProvider } from 'posthog-react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { posthog } from './src/lib/analytics';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__ && !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});

function App() {
  return (
    <PostHogProvider client={posthog} autocapture={{ captureScreens: false }}>
      <AppNavigator />
    </PostHogProvider>
  );
}

export default Sentry.wrap(App);