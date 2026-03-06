require("dotenv").config();
const Sentry = require("@sentry/node");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "production",
  tracesSampleRate: 0.1,
});

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

// ── Supabase admin client (service-role key — server-side only, never sent to client)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── CORS: only allow requests from known origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin header (native mobile app, curl in dev)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Raw body for Stripe webhook — must come BEFORE express.json()
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ── Rate limiters
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const verifyFaceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please wait before trying again." },
});

// ── Auth middleware
// Verifies the Supabase JWT supplied in the Authorization header.
// Attaches req.user = { id, email } on success.
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  req.user = data.user;
  next();
}

// ── Helper: verify the authenticated user matches the userId in the request body.
// Prevents one user from creating payment intents billed to another user's account.
function assertUserIdMatch(req, res) {
  const { userId } = req.body;
  if (!userId || userId !== req.user.id) {
    res.status(403).json({ error: "userId does not match authenticated session." });
    return false;
  }
  return true;
}

/**
 * POST /create-payment-intent
 * Body: { amount: number (cents), currency: string, eventId: string, userId: string }
 * PCI compliance: card data never touches this server — Stripe handles all tokenization.
 */
app.post("/create-payment-intent", requireAuth, paymentLimiter, async (req, res) => {
  try {
    if (!assertUserIdMatch(req, res)) return;

    const { amount, currency = "eur", eventId } = req.body;

    if (!amount || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount. Must be a positive integer in cents." });
    }
    if (!eventId) {
      return res.status(400).json({ error: "eventId is required." });
    }

    const idempotencyKey = `pi-${String(eventId)}-${String(req.user.id)}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: { eventId: String(eventId), userId: String(req.user.id) },
      },
      { idempotencyKey }
    );

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[/create-payment-intent] error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /create-payment-intent/premium-ad-free
 * Body: { userId: string }
 * Amount: €2.99/month → 299 cents
 */
app.post("/create-payment-intent/premium-ad-free", requireAuth, paymentLimiter, async (req, res) => {
  try {
    if (!assertUserIdMatch(req, res)) return;

    const idempotencyKey = `pi-adFree-${String(req.user.id)}`;
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: 299,
        currency: "eur",
        automatic_payment_methods: { enabled: true },
        metadata: { product: "adFree", userId: String(req.user.id) },
      },
      { idempotencyKey }
    );
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[/create-payment-intent/premium-ad-free] error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /create-payment-intent/premium-traveler
 * Body: { userId: string }
 * Amount: €4.99/month → 499 cents
 */
app.post("/create-payment-intent/premium-traveler", requireAuth, paymentLimiter, async (req, res) => {
  try {
    if (!assertUserIdMatch(req, res)) return;

    const idempotencyKey = `pi-travelerMode-${String(req.user.id)}`;
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: 499,
        currency: "eur",
        automatic_payment_methods: { enabled: true },
        metadata: { product: "travelerMode", userId: String(req.user.id) },
      },
      { idempotencyKey }
    );
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[/create-payment-intent/premium-traveler] error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /create-payment-intent/diffusion-message
 * Body: { userId: string, radiusKm: number }
 * Amount: €1.00 → 100 cents
 */
app.post("/create-payment-intent/diffusion-message", requireAuth, paymentLimiter, async (req, res) => {
  try {
    if (!assertUserIdMatch(req, res)) return;

    const { radiusKm } = req.body;
    const idempotencyKey = `pi-diffusion-${String(req.user.id)}-${Date.now()}`;
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: 100,
        currency: "eur",
        automatic_payment_methods: { enabled: true },
        metadata: {
          product: "diffusionMessage",
          userId: String(req.user.id),
          radiusKm: String(radiusKm ?? 5),
        },
      },
      { idempotencyKey }
    );
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[/create-payment-intent/diffusion-message] error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /verify-face
 * Called by the client after a successful Lambda face-match response.
 * Uses the service-role key to set is_verified=true, so the anon client
 * (and any RLS policy blocking direct updates) cannot be bypassed.
 *
 * Body: { userId: string }
 */
app.post("/verify-face", requireAuth, verifyFaceLimiter, async (req, res) => {
  try {
    if (!assertUserIdMatch(req, res)) return;

    const uid = req.user.id;

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, is_verified, avatar_url")
      .eq("id", uid)
      .maybeSingle();

    if (profileErr) throw profileErr;
    if (!profile) return res.status(404).json({ error: "Profile not found." });
    if (profile.is_verified) return res.json({ ok: true, alreadyVerified: true });

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_verified: true, verified_at: new Date().toISOString() })
      .eq("id", uid);

    if (updateErr) throw updateErr;

    console.log(`[/verify-face] User ${uid} marked as verified.`);
    res.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[/verify-face] error:", err.message);
    res.status(500).json({ error: "Internal server error" });
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
      const product = pi.metadata?.product;
      const userId = pi.metadata?.userId;
      if (product === "adFree") {
        console.log(`[webhook] Ad-Free activated for user ${userId}`);
      } else if (product === "travelerMode") {
        console.log(`[webhook] Traveler Mode activated for user ${userId}`);
      } else if (product === "diffusionMessage") {
        const radiusKm = pi.metadata?.radiusKm;
        console.log(`[webhook] Diffusion message confirmed for user ${userId}, radius ${radiusKm}km`);
      } else {
        console.log("[webhook] payment_intent.succeeded", {
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          eventId: pi.metadata?.eventId,
          userId,
        });
        // TODO: send ticket confirmation email, update purchase status in DB
      }
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
      break;
  }

  res.json({ received: true });
});

// Sentry error handler must be registered after all routes
Sentry.setupExpressErrorHandler(app);

app.listen(PORT, () => {
  console.log(`Alba payment server running on port ${PORT}`);
});
