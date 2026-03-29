// src/lib/analytics.js — PostHog client
// Set EXPO_PUBLIC_POSTHOG_API_KEY as an EAS secret to enable analytics.
// When the key is absent the client is disabled and all capture() calls are no-ops.
import PostHog from 'posthog-react-native';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

export const posthog = new PostHog(
  POSTHOG_KEY ?? 'placeholder',
  {
    host: 'https://eu.i.posthog.com',
    // Disable if no key is configured (dev builds without the secret)
    disabled: !POSTHOG_KEY,
    persistence: 'file',
    captureAppLifecycleEvents: true,
  }
);
