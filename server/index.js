require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Raw body required for Stripe webhook signature verification — must come BEFORE express.json()
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

/**
 * POST /create-payment-intent
 * Body: { amount: number (cents), currency: string, eventId: string, userId: string }
 * Returns: { clientSecret: string }
 *
 * PCI compliance: card data never touches this server — Stripe handles all tokenization
 * client-side. This endpoint only creates a PaymentIntent and returns its client_secret.
 */
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency = "eur", eventId, userId } = req.body;

    if (!amount || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount. Must be a positive integer in cents." });
    }
    if (!eventId || !userId) {
      return res.status(400).json({ error: "eventId and userId are required." });
    }

    // Idempotency key prevents double charges if the same request is retried
    const idempotencyKey = `pi-${String(eventId)}-${String(userId)}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: { eventId: String(eventId), userId: String(userId) },
      },
      { idempotencyKey }
    );

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("[/create-payment-intent] error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/**
 * POST /webhook
 * Stripe sends signed webhook events here.
 * Verifies the signature using STRIPE_WEBHOOK_SECRET before processing.
 */
app.post("/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[/webhook] signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      console.log("[webhook] payment_intent.succeeded", {
        id: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        eventId: pi.metadata?.eventId,
        userId: pi.metadata?.userId,
      });
      // TODO: send ticket confirmation email, update purchase status in DB
      break;
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      console.error("[webhook] payment_intent.payment_failed", {
        id: pi.id,
        error: pi.last_payment_error?.message,
        eventId: pi.metadata?.eventId,
        userId: pi.metadata?.userId,
      });
      break;
    }
    default:
      // Unhandled event type — safe to ignore
      break;
  }

  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`Alba payment server running on port ${PORT}`);
});
