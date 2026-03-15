// screens/PreFaceRecognitionScreen.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { supabase } from "../lib/supabase";
import { useAlbaLanguage } from "../theme/LanguageContext";

export default function PreFaceRecognitionScreen() {
  const navigation = useNavigation();
  const { t } = useAlbaLanguage();

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
    PoppinsBold: require("../../assets/fonts/Poppins-Bold.ttf"),
  });

  const [loading, setLoading] = useState(true);
  const [hasAvatar, setHasAvatar] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const user = data?.user;
        if (!user?.id) {
          navigation.navigate("Start");
          return;
        }

        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("avatar_url, is_verified, username, name")
          .eq("id", user.id)
          .maybeSingle();

        if (profErr) throw profErr;

        if (!mounted) return;

        if (prof?.is_verified) {
          // Already verified → send them back to Community
          navigation.reset({
            index: 0,
            routes: [{ name: "Community" }],
          });
          return;
        }

        setHasAvatar(!!prof?.avatar_url);
      } catch (e) {
        console.warn("PreFaceRecognition load error:", e?.message || e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigation]);

  if (!fontsLoaded) return null;

  const handleBack = () => {
    navigation.goBack();
  };

  const goToProfile = async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const user = data?.user;
      if (!user?.id) {
        navigation.navigate("Start");
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("username, name")
        .eq("id", user.id)
        .maybeSingle();

      let uname =
        prof?.username ||
        user.user_metadata?.username ||
        (user.email ? user.email.split("@")[0] : "");
      uname = String(uname || "").replace(/^@/, "");

      const firstName = prof?.name
        ? prof.name.split(" ")[0]
        : uname || "User";

      navigation.navigate("Profile", {
        username: uname,
        name: firstName,
      });
    } catch (e) {
      console.warn("Go to profile from PreFace error:", e?.message || e);
      navigation.navigate("Start");
    }
  };

  const handlePrimary = () => {
    if (!hasAvatar) {
      goToProfile();
    } else {
      navigation.navigate("FaceRecognition");
    }
  };

  const primaryLabel = hasAvatar
    ? t("verification_pre_button_start")
    : t("verification_pre_button_upload");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        {/* Back arrow */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.content}>
          {/* Simple placeholder icon */}
          <View style={styles.iconCircle}>
            <View style={styles.iconInner} />
          </View>

          <Text style={styles.title}>{t("verification_pre_title")}</Text>

          <Text style={styles.body} numberOfLines={5}>
            {t("verification_pre_body")}
          </Text>

          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={handlePrimary}>
              <Text style={styles.primaryText}>{primaryLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const BLUE = "#4BA8FF";

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BLUE,
  },
  container: {
    flex: 1,
    backgroundColor: BLUE,
  },
  backButton: {
    marginTop: 16,
    marginLeft: 16,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    borderBottomWidth: 0,
  },
  title: {
    fontFamily: "PoppinsBold",
    fontSize: 26,
    color: "#FFFFFF",
    marginBottom: 12,
  },
  body: {
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#FFFFFF",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 32,
  },
  primaryBtn: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    paddingHorizontal: 40,
    paddingVertical: 10,
    marginTop: 8,
  },
  primaryText: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    color: "#FFFFFF",
  },
});
