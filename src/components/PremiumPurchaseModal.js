import React, { useEffect, useState, useRef } from "react";
import {
  Modal,
  Platform,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import {
  PlatformPayButton,
  usePlatformPay,
  useStripe,
} from "@stripe/stripe-react-native";
import * as ExpoIAP from "expo-iap";
import { useAlbaTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";

// Product ID must match exactly what was created in App Store Connect
const IAP_PRODUCT_ID = "com.albaapp.alba.adfree.monthly";

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
  const [feedback, setFeedback] = useState(null);
  const showFeedback = (title, message, onOk) =>
    setFeedback({ title, message, onOk: onOk || null });

  // ── Android: Stripe ───────────────────────────────────────────────────────
  const { isPlatformPaySupported, confirmPlatformPayPayment } = usePlatformPay();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [platformPayAvailable, setPlatformPayAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      isPlatformPaySupported().then(setPlatformPayAvailable).catch(() => {});
    }
  }, [isPlatformPaySupported]);

  // ── iOS: StoreKit via expo-iap ────────────────────────────────────────────
  const purchaseListenerRef = useRef(null);
  const errorListenerRef = useRef(null);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    ExpoIAP.initConnection().catch(() => {});

    purchaseListenerRef.current = ExpoIAP.purchaseUpdatedListener(
      async (purchase) => {
        if (!purchase?.transactionReceipt) return;
        try {
          setLoading(true);
          // Finish the transaction with Apple — required or Apple will re-deliver it
          await ExpoIAP.finishTransaction({ purchase, isConsumable: false });
          // Validate server-side and mark premium in Supabase profiles
          await supabase.functions.invoke("verify-apple-iap", {
            body: {
              transactionReceipt: purchase.transactionReceipt,
              productId: purchase.productId,
              userId,
            },
          });
          onSuccess();
          showFeedback(
            "Success",
            "Alba Premium activated! Enjoy an ad-free experience.",
            onClose
          );
        } catch {
          showFeedback(
            "Error",
            "Purchase completed but activation failed. Please tap Restore Purchases."
          );
        } finally {
          setLoading(false);
        }
      }
    );

    errorListenerRef.current = ExpoIAP.purchaseErrorListener((error) => {
      if (error.code === "E_USER_CANCELLED") return;
      setLoading(false);
      showFeedback(
        "Payment failed",
        error.message || "Something went wrong. Please try again."
      );
    });

    return () => {
      purchaseListenerRef.current?.remove();
      errorListenerRef.current?.remove();
      ExpoIAP.endConnection().catch(() => {});
    };
  }, []);

  const handleIOSPurchase = async () => {
    if (loading) return;
    try {
      setLoading(true);
      await ExpoIAP.requestSubscription({ sku: IAP_PRODUCT_ID });
      // Purchase result is delivered via purchaseUpdatedListener above
    } catch (e) {
      if (e.code !== "E_USER_CANCELLED") {
        showFeedback("Error", e.message || "Purchase failed. Please try again.");
      }
      setLoading(false);
    }
  };

  // Apple requires apps to include a restore purchases mechanism
  const handleRestore = async () => {
    if (loading) return;
    try {
      setLoading(true);
      const history = await ExpoIAP.getPurchaseHistory();
      const match = history?.find((p) => p.productId === IAP_PRODUCT_ID);
      if (!match) {
        showFeedback(
          "Nothing to restore",
          "No previous purchase found for this account."
        );
        return;
      }
      await supabase.functions.invoke("verify-apple-iap", {
        body: {
          transactionReceipt: match.transactionReceipt,
          productId: match.productId,
          userId,
        },
      });
      onSuccess();
      showFeedback(
        "Restored",
        "Your purchase has been restored successfully.",
        onClose
      );
    } catch {
      showFeedback("Error", "Could not restore purchases. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Android: Stripe pay ───────────────────────────────────────────────────
  const numericPrice = price.replace(/[^0-9.]/g, "");

  const handleAndroidPay = async () => {
    if (loading) return;
    if (!userId) {
      showFeedback("Error", "Login required.");
      return;
    }
    try {
      setLoading(true);
      const type = paymentEndpoint?.split("/").pop() ?? "";
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "create-payment-intent",
        { body: { type, userId } }
      );
      if (fnError || !fnData?.clientSecret)
        throw new Error(
          fnData?.error || fnError?.message || "Payment setup failed"
        );
      const clientSecret = fnData.clientSecret;

      if (platformPayAvailable) {
        const { error: payError } = await confirmPlatformPayPayment(
          clientSecret,
          {
            googlePay: {
              merchantCountryCode: "IT",
              currencyCode: "EUR",
              testEnv: __DEV__,
            },
          }
        );
        if (payError?.code === "Canceled") return;
        if (payError) {
          showFeedback(
            "Payment failed",
            mapStripeError(payError.code)
          );
          return;
        }
      } else {
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: "Alba",
        });
        if (initError) {
          showFeedback("Error", initError.message || "Payment setup failed.");
          return;
        }
        const { error: presentError } = await presentPaymentSheet();
        if (presentError?.code === "Canceled") return;
        if (presentError) {
          showFeedback(
            "Payment failed",
            presentError.message || mapStripeError(presentError.code)
          );
          return;
        }
      }

      onSuccess();
      showFeedback("Success", "Feature activated! Enjoy Alba Premium.", onClose);
    } catch {
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
          <View
            style={[
              styles.feedbackCard,
              { backgroundColor: isDark ? theme.gray : theme.background },
            ]}
          >
            <Text style={[styles.feedbackTitle, { color: theme.text }]}>
              {feedback.title}
            </Text>
            <Text style={[styles.feedbackMessage, { color: theme.text }]}>
              {feedback.message}
            </Text>
            <TouchableOpacity
              style={[
                styles.feedbackOkBtn,
                {
                  backgroundColor:
                    feedback.title === "Success" || feedback.title === "Restored"
                      ? "#4EBCFF"
                      : "#E55353",
                },
              ]}
              onPress={() => {
                const cb = feedback.onOk;
                setFeedback(null);
                cb?.();
              }}
            >
              <Text style={styles.feedbackOkText}>OK</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? theme.gray : theme.background },
            ]}
          >
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#00A9FF" />
                <Text style={[styles.loadingText, { color: theme.text }]}>
                  Processing…
                </Text>
              </View>
            ) : (
              <View style={styles.content}>
                <Text style={[styles.featureName, { color: theme.text }]}>
                  {featureName}
                </Text>
                <Text
                  style={[
                    styles.description,
                    { color: isDark ? "#9CA3AF" : "#6F7D95" },
                  ]}
                >
                  {description}
                </Text>
                <Text style={[styles.price, { color: "#00A9FF" }]}>{price}</Text>
              </View>
            )}

            <View style={styles.bottomRow}>
              {Platform.OS === "ios" ? (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.payBtn]}
                  onPress={handleIOSPurchase}
                  disabled={loading}
                >
                  <Text style={[styles.actionText, { color: "#fff" }]}>
                    Subscribe
                  </Text>
                </TouchableOpacity>
              ) : platformPayAvailable ? (
                <PlatformPayButton
                  onPress={handleAndroidPay}
                  type="buy"
                  borderRadius={10}
                  style={styles.platformPayBtn}
                />
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.payBtn]}
                  onPress={handleAndroidPay}
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
                <Text
                  style={[
                    styles.actionText,
                    { color: isDark ? "#9CA3AF" : "#8A96A3" },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>

            {/* Apple requires a restore purchases button for all IAP apps */}
            {Platform.OS === "ios" && !loading && (
              <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn}>
                <Text
                  style={[
                    styles.restoreText,
                    { color: isDark ? "#9CA3AF" : "#8A96A3" },
                  ]}
                >
                  Restore Purchases
                </Text>
              </TouchableOpacity>
            )}
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
  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  loadingText: { marginTop: 8, fontFamily: "Poppins", fontSize: 14 },
  featureName: { fontFamily: "PoppinsBold", fontSize: 18, marginBottom: 6 },
  description: { fontFamily: "Poppins", fontSize: 14, marginBottom: 8 },
  price: { fontFamily: "PoppinsBold", fontSize: 16 },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingTop: 16,
  },
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
  actionText: { fontFamily: "PoppinsBold" },
  restoreBtn: { alignSelf: "center", paddingVertical: 10, marginTop: 4 },
  restoreText: { fontFamily: "Poppins", fontSize: 12 },
  feedbackCard: {
    width: "78%",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  feedbackTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    marginBottom: 8,
  },
  feedbackMessage: {
    fontFamily: "Poppins",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 18,
  },
  feedbackOkBtn: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 10,
  },
  feedbackOkText: { color: "#fff", fontFamily: "PoppinsBold", fontSize: 14 },
});
