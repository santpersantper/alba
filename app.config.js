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
    version: "1.2.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/big_icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.albaapp.alba",
      teamId: "5VQYA86ATB",
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              // Custom app scheme — required for deep links (alba://post/123, etc.)
              "alba",
              // Reversed iOS OAuth client ID — required for Google Sign-In redirect
              "com.googleusercontent.apps.1060018833152-6inqrhrvjj8e7ld7igvadjfmeikeebfi",
            ],
          },
        ],
        // Suppress App Store encryption export compliance warning
        ITSAppUsesNonExemptEncryption: false,
        // Privacy purpose strings — must clearly explain usage with examples
        NSPhotoLibraryUsageDescription:
          "Alba uses your photo library to let you share photos and videos in chats, set your profile picture, and post content to your feed. For example, you can select a photo from your library to use as your profile picture or attach it to a message.",
        NSPhotoLibraryAddUsageDescription:
          "Alba saves photos and videos to your library when you download content shared in the app.",
        NSCameraUsageDescription:
          "Alba uses your camera to let you take photos and videos to share in chats or post to your feed. For example, you can take a selfie to set as your profile picture or record a short video to share with your community.",
        NSMicrophoneUsageDescription:
          "Alba uses your microphone to record audio when you create video posts or send voice messages in chats.",
        NSLocationWhenInUseUsageDescription:
          "Alba uses your location to detect your city during sign-up so your profile shows the right region, and to suggest nearby events and communities. For example, when you create an account, Alba reads your approximate location to pre-fill your city field. Your precise location is never stored or shared with other users.",
      },
      // FamilyControls + App Group entitlements — auto-written to ios/Alba/Alba.entitlements
      // by `npx expo prebuild`. No manual Xcode entitlements step needed for the main target.
      entitlements: {
        "com.apple.developer.family-controls": true,
        "com.apple.security.application-groups": ["group.com.alba.app.screentime"],
        "com.apple.developer.in-app-payments": ["merchant.com.alba.app"],
        "com.apple.developer.applesignin": ["Default"],
        "com.apple.developer.associated-domains": ["applinks:albaappofficial.com", "applinks:www.albaappofficial.com"],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/android-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: "com.alba.app",
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
      // Reversed Android OAuth client ID — required so expo-auth-session can
      // register a custom-scheme redirect handler that Google recognises.
      // This is the Android equivalent of CFBundleURLSchemes on iOS.
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme:
                "com.googleusercontent.apps.1060018833152-8viosmmkbi0a2719vu4kbjd774rsb1hq",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host: "albaappofficial.com", pathPrefix: "/join/group/" },
            { scheme: "https", host: "albaappofficial.com", pathPrefix: "/post/" },
            { scheme: "https", host: "albaappofficial.com", pathPrefix: "/video/" },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
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
      // Allow the Android app to use a larger heap (default ~268MB → ~512MB on most devices).
      // The app's baseline memory (Hermes + Fabric + expo-video + Stripe + notifications +
      // location + screen-time native module) nearly fills the default heap before any UI renders.
      (config) => {
        const { withAndroidManifest } = require("@expo/config-plugins");
        return withAndroidManifest(config, (c) => {
          const app = c.modResults.manifest.application[0];
          app.$["android:largeHeap"] = "true";
          return c;
        });
      },
      "expo-apple-authentication",
      "expo-iap",
      "expo-image",
      "expo-system-ui",
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
      "@sentry/react-native",
    ],
  },
};
