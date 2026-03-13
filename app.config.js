// app.config.js — replaces app.json so that all secrets are read from
// environment variables at build time, never hardcoded in source control.
//
// LOCAL DEVELOPMENT
//   Create a file named ".env.local" in the project root with:
//     EXPO_PUBLIC_SUPABASE_URL=https://...
//     EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
//     EXPO_PUBLIC_SPOTIFY_CLIENT_ID=...
//     EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
//     EXPO_PUBLIC_API_URL=http://localhost:3000
//     EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN=pk.eyJ...
//
// EAS BUILDS / CI
//   Set the same variables as EAS Secrets:
//     eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "..."

export default {
  expo: {
    name: "Alba",
    slug: "Alba",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: false,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.albaapp.alba",
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              // Reversed iOS OAuth client ID — required for Google Sign-In redirect
              "com.googleusercontent.apps.1060018833152-6inqrhrvjj8e7ld7igvadjfmeikeebfi",
            ],
          },
        ],
        // Suppress App Store encryption export compliance warning
        ITSAppUsesNonExemptEncryption: false,
      },
      // FamilyControls + App Group entitlements — auto-written to ios/Alba/Alba.entitlements
      // by `npx expo prebuild`. No manual Xcode entitlements step needed for the main target.
      entitlements: {
        "com.apple.developer.family-controls": true,
        "com.apple.security.application-groups": ["group.com.alba.app.screentime"],
        "com.apple.developer.in-app-payments": ["merchant.com.alba.app"],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: "com.alba.app",
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    scheme: "alba",
    extra: {
      expoPublic: {
        SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
        // In production use your actual server domain, e.g. https://api.alba.app
        API_URL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000",
        MAPBOX_PUBLIC_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN,
        // AWS Lambda face-verification endpoint — never hardcode the URL in source
        LAMBDA_VERIFY_URL: process.env.EXPO_PUBLIC_LAMBDA_VERIFY_URL,
      },
      "eas": {
        "projectId": "e60b55c9-7893-4d92-a121-0f23c058f513"
      }
    },
    plugins: [
      "expo-font",
      "expo-asset",
      "expo-secure-store",
      "expo-video",
      "expo-web-browser",
      [
        "@stripe/stripe-react-native",
        {
          merchantIdentifier: "merchant.com.alba.app",
          enableGooglePay: true,
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#00A9FF",
          defaultChannel: "default",
          iosDisplayInForeground: true,
        },
      ],
      "./plugins/withScreenTime",
      "./plugins/withAndroidNativeModules",
    ],
  },
};
