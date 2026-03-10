import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import {
  PlatformPayButton,
  PlatformPay,
  usePlatformPay,
  useStripe,
} from "@stripe/stripe-react-native";
import Constants from "expo-constants";
import { useAlbaTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";

// ─── TESTING: set to true to skip Stripe and activate features instantly ───
const PAYMENT_BYPASS = false;
// ────────────────────────────────────────────────────────────────────────────

// Read payment server URL — env var takes priority, then Expo config, then dev localhost
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants?.expoConfig?.extra?.expoPublic?.API_URL ??
  "http://localhost:3000";

const mapStripeError = (code) => {
  if (code === "card_declined")
    return "Payment declined. Please try a different payment method.";
  if (code === "insufficient_funds") return "Insufficient funds.";
  return "Connection error. Please check your internet and try again.";
};

export default function PremiumPurchaseModal({
  visible,
  onClose,
  onSuccess,
  featureName,
  description,
  price,
  paymentEndpoint,
  userId,
}) {
  const { theme, isDark } = useAlbaTheme();
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null); // { title, message, onOk }
  const showFeedback = (title, message, onOk) =>
    setFeedback({ title, message, onOk: onOk || null });

  const { isPlatformPaySupported, confirmPlatformPayPayment } = usePlatformPay();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [platformPayAvailable, setPlatformPayAvailable] = useState(false);

  useEffect(() => {
    isPlatformPaySupported()
      .then(setPlatformPayAvailable)
      .catch(() => {});
  }, [isPlatformPaySupported]);

  // Extract numeric price string (e.g. "€2.99/month" → "2.99") for Apple/Google Pay cart item
  const numericPrice = price.replace(/[^0-9.]/g, "");

  const handlePay = async () => {
    if (loading) return;
    if (!userId) {
      showFeedback("Error", "Login required.");
      return;
    }

    // ── Testing bypass: skip Stripe, activate immediately ──
    if (PAYMENT_BYPASS) {
      onSuccess();
      showFeedback("Success", "Feature activated! Enjoy Alba Premium.", onClose);
      return;
    }

    try {
      setLoading(true);

      // 1. Create a PaymentIntent on the backend
      let clientSecret;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token || "";
        const fullUrl = `${API_URL}${paymentEndpoint}`;
        console.log("[Payment] API_URL:", API_URL);
        console.log("[Payment] endpoint:", fullUrl);
        console.log("[Payment] userId:", userId);
        console.log("[Payment] has token:", !!token);
        const res = await fetch(fullUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ userId }),
        });
        console.log("[Payment] server status:", res.status);
        const json = await res.json();
        console.log("[Payment] server response:", JSON.stringify(json));
        if (!res.ok || !json.clientSecret)
          throw new Error(json.error || "Payment setup failed");
        clientSecret = json.clientSecret;
      } catch (e) {
        console.error("[Payment] fetch error:", e.message, e);
        showFeedback(
          "Error",
          `Server error: ${e.message}`
        );
        return;
      }

      // 2. Confirm payment via Apple Pay / Google Pay — or card sheet on unsupported devices
      if (platformPayAvailable) {
        const cartItems = [
          {
            label: featureName,
            amount: numericPrice,
            paymentType: "Immediate",
          },
        ];

        const { error: payError } = await confirmPlatformPayPayment(
          clientSecret,
          {
            applePay: {
              cartItems,
              merchantCountryCode: "IT",
              currencyCode: "EUR",
            },
            googlePay: {
              merchantCountryCode: "IT",
              currencyCode: "EUR",
              testEnv: true,
            },
          }
        );

        if (payError?.code === "Canceled") return; // user dismissed — silent
        if (payError) {
          console.error("[Payment] platformPay error code:", payError.code, "message:", payError.message, "localizedMessage:", payError.localizedMessage);
          showFeedback("Payment failed", `[${payError.code}] ${payError.message || mapStripeError(payError.code)}`);
          return;
        }
      } else {
        // Card fallback via Stripe Payment Sheet
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: "Alba",
        });
        if (initError) {
          console.error("[Payment] initPaymentSheet error code:", initError.code, "message:", initError.message);
          showFeedback("Error", `[${initError.code}] ${initError.message || "Payment setup failed."}`);
          return;
        }
        const { error: presentError } = await presentPaymentSheet();
        if (presentError?.code === "Canceled") return; // user dismissed — silent
        if (presentError) {
          console.error("[Payment] presentPaymentSheet error code:", presentError.code, "message:", presentError.message);
          showFeedback("Payment failed", `[${presentError.code}] ${presentError.message || mapStripeError(presentError.code)}`);
          return;
        }
      }

      // Payment succeeded
      onSuccess();
      showFeedback("Success", "Feature activated! Enjoy Alba Premium.", onClose);
    } catch (e) {
      showFeedback("Error", "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (!loading) onClose();
  };

  return (
    <Modal
      visible={visible || !!feedback}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (feedback) setFeedback(null);
        else handleCancel();
      }}
    >
      <View style={styles.overlay}>
        {feedback ? (
          <View style={[styles.feedbackCard, { backgroundColor: isDark ? theme.gray : theme.background }]}>
            <Text style={[styles.feedbackTitle, { color: theme.text }]}>{feedback.title}</Text>
            <Text style={[styles.feedbackMessage, { color: theme.text }]}>{feedback.message}</Text>
            <TouchableOpacity
              style={[styles.feedbackOkBtn, { backgroundColor: feedback.title === "Success" ? "#4EBCFF" : "#E55353" }]}
              onPress={() => { const cb = feedback.onOk; setFeedback(null); cb?.(); }}
            >
              <Text style={styles.feedbackOkText}>OK</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: isDark ? theme.gray : theme.background }]}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#00A9FF" />
                <Text style={[styles.loadingText, { color: theme.text }]}>Processing…</Text>
              </View>
            ) : (
              <View style={styles.content}>
                <Text style={[styles.featureName, { color: theme.text }]}>{featureName}</Text>
                <Text style={[styles.description, { color: isDark ? "#9CA3AF" : "#6F7D95" }]}>
                  {description}
                </Text>
                <Text style={[styles.price, { color: "#00A9FF" }]}>{price}</Text>
              </View>
            )}

            <View style={styles.bottomRow}>
              {platformPayAvailable ? (
                <PlatformPayButton
                  onPress={handlePay}
                  type="buy"
                  borderRadius={10}
                  style={styles.platformPayBtn}
                />
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.payBtn]}
                  onPress={handlePay}
                  disabled={loading}
                >
                  <Text style={[styles.actionText, { color: "#fff" }]}>Pay</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={handleCancel}
                disabled={loading}
              >
                <Text style={[styles.actionText, { color: isDark ? "#9CA3AF" : "#8A96A3" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "88%",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  content: { paddingBottom: 10 },
  loadingBox: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  loadingText: { marginTop: 8, fontFamily: "Poppins", fontSize: 14 },
  featureName: { fontFamily: "Poppins", fontSize: 18, fontWeight: "700", marginBottom: 6 },
  description: { fontFamily: "Poppins", fontSize: 14, marginBottom: 8 },
  price: { fontFamily: "Poppins", fontSize: 16, fontWeight: "600" },
  bottomRow: { flexDirection: "row", justifyContent: "center", gap: 12, paddingTop: 16 },
  actionBtn: {
    height: 42,
    minWidth: 110,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  payBtn: { backgroundColor: "#4EBCFF", borderColor: "#4EBCFF" },
  platformPayBtn: { minWidth: 110, height: 42 },
  cancelBtn: { backgroundColor: "#FFFFFF", borderColor: "#E3E8EE" },
  actionText: { fontWeight: "700", fontFamily: "Poppins" },
  feedbackCard: {
    width: "78%",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  feedbackTitle: { fontFamily: "Poppins", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  feedbackMessage: { fontFamily: "Poppins", fontSize: 14, textAlign: "center", marginBottom: 18 },
  feedbackOkBtn: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 10,
  },
  feedbackOkText: { color: "#fff", fontFamily: "Poppins", fontWeight: "700", fontSize: 14 },
});
