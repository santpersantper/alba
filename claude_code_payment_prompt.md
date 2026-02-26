# Claude Code Prompt: Apple Pay / Google Pay Ticket Purchase Integration

---

## Context

I'm building **Alba**, a React Native social media app (using Expo or bare React Native — confirm which from the codebase). Users can browse local events in a `CommunityScreen`. When a user taps "Buy Ticket" on an event, a `BuyModal` component opens. This modal currently exists in the codebase but has no payment logic.

I need you to implement a complete, production-ready ticket purchase flow using **Apple Pay** (iOS) and **Google Pay** (Android), powered by **Stripe** as the payment processor. There is no backend yet — you will need to create one.

Read the entire codebase before writing a single line. Understand the existing `BuyModal` component, the `CommunityScreen`, the data shape of an event object, and any existing navigation or state management patterns before touching anything.

---

## Deliverables

Implement all of the following:

### 1. Stripe account setup instructions
At the top of your response, before any code, give me a concise checklist of what I need to do manually in the Stripe dashboard before the code will work:
- Create account / get API keys
- Enable Apple Pay domain verification
- Enable Google Pay in Stripe dashboard
- Any other prerequisite steps

---

### 2. Backend: Node.js + Express payment server

Create a minimal but production-ready backend in a `/server` directory at the project root. It must include:

**`/server/index.js`** — Express server with the following endpoints:

- `POST /create-payment-intent`
  - Accepts: `{ amount, currency, eventId, userId }`
  - Creates a Stripe PaymentIntent
  - Returns: `{ clientSecret }`
  - Amount must be in cents (e.g. €10.00 → 1000)
  - Currency should default to `"eur"`
  - Include idempotency key based on `eventId + userId` to prevent double charges

- `POST /webhook`
  - Handles Stripe webhook events
  - On `payment_intent.succeeded`: log the successful purchase (placeholder for your ticket issuance logic)
  - On `payment_intent.payment_failed`: log the failure
  - Verify webhook signature using `STRIPE_WEBHOOK_SECRET`

**`/server/.env.example`** — with the following variables:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PORT=3000
```

**`/server/package.json`** — with dependencies: `express`, `stripe`, `dotenv`, `cors`

The server must:
- Use environment variables, never hardcode keys
- Include proper error handling on all endpoints (try/catch, meaningful error messages)
- Include CORS headers so the React Native app can reach it in development
- Be deployable to Railway or Render with zero changes (add a `start` script)

---

### 3. React Native frontend

#### 3a. Install required packages

List the exact commands to run:
```bash
npm install @stripe/stripe-react-native
# plus any other required packages
```

Then provide the exact native setup steps:
- For **iOS**: any required `Info.plist` entries, `Podfile` changes, and `pod install` command
- For **Android**: any required `AndroidManifest.xml` entries and `build.gradle` changes
- If using **Expo**: provide the `app.json` / `app.config.js` plugin configuration instead

#### 3b. Stripe provider setup

In the app's root file (likely `App.js` or `_layout.tsx` — check the codebase):
- Wrap the app with `<StripeProvider>` from `@stripe/stripe-react-native`
- Use the **publishable key** (not secret key) from an environment variable via `react-native-dotenv` or `expo-constants`
- Set `merchantIdentifier` to `"merchant.com.alba.app"` for Apple Pay
- Set `urlScheme` for return URL handling if needed

#### 3c. BuyModal — full payment implementation

Rewrite the existing `BuyModal` component to include the complete payment flow. Do not delete any existing UI — add payment logic to what's already there.

The modal must:

**Display (read from the event object passed as a prop):**
- Event name
- Event date
- Venue name
- Ticket price (formatted as `€X.XX`)
- Ticket quantity selector (1–4 tickets, default 1) — update total price dynamically

**Payment flow:**

1. On mount, call `POST /create-payment-intent` with the total amount and event/user IDs. Store the `clientSecret`.

2. Show a **"Pay with Apple Pay / Google Pay"** button using `<PlatformPayButton>` from `@stripe/stripe-react-native`:
   - On iOS: renders as Apple Pay button (native style)
   - On Android: renders as Google Pay button (native style)
   - Use `PlatformPay.isSupported()` to check availability — if not supported, fall back to a standard card input form using `<CardField>` from the same library

3. On button press:
   - Call `confirmPlatformPayPayment` with the `clientSecret`
   - Pass correct payment method params:
     - `applePay: { cartItems: [{ label: eventName, amount: totalAmount, paymentType: PlatformPay.PaymentType.Final }], merchantCountryCode: "IT", currencyCode: "EUR" }`
     - `googlePay: { merchantCountryCode: "IT", currencyCode: "EUR", testEnv: true }`

4. Handle all outcome states explicitly:
   - **Loading state**: show a spinner, disable the button, show "Processing payment..."
   - **Success**: close the modal, show a success toast/alert with "Ticket confirmed! Check your email.", navigate to a `TicketConfirmationScreen` if it exists (check codebase first)
   - **Cancellation** (user dismissed Apple/Google Pay sheet): return to modal silently, no error shown
   - **Error**: show a user-friendly error message inside the modal (not a generic alert) — map common Stripe error codes to readable Italian/English messages:
     - `card_declined` → "Payment declined. Please try a different payment method."
     - `insufficient_funds` → "Insufficient funds."
     - Network error → "Connection error. Please check your internet and try again."

**State management:**
- Use `useState` for: `quantity`, `loading`, `error`, `paymentComplete`
- Do not use any global state library unless one already exists in the codebase

**Props the component must accept:**
```javascript
BuyModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  event: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    date: PropTypes.string.isRequired,
    venue: PropTypes.string.isRequired,
    ticketPrice: PropTypes.number.isRequired, // in euros, e.g. 12.50
  }).isRequired,
  userId: PropTypes.string.isRequired,
}
```

---

### 4. Environment configuration

Create a `/app/.env.example` file:
```
STRIPE_PUBLISHABLE_KEY=pk_test_...
API_URL=http://localhost:3000
```

Explain how to load these in React Native (expo-constants or react-native-dotenv — use whichever is already in the project or recommend expo-constants for Expo projects).

---

### 5. Testing instructions

After implementing everything, provide:

1. **How to run the backend locally**: exact command, what port it runs on
2. **How to test Apple Pay in iOS Simulator**: confirm it requires a physical device, explain how to use Stripe test cards instead via the card fallback
3. **How to test Google Pay on Android**: explain test environment mode
4. **Stripe test card numbers** to use during development:
   - Successful payment: `4242 4242 4242 4242`
   - Declined payment: `4000 0000 0000 9995`
   - Insufficient funds: `4000 0000 0000 9995`
5. **How to test the webhook locally** using the Stripe CLI: exact command

---

## Constraints and requirements

- **Never hardcode API keys or secrets** anywhere in the codebase. If you find any during your read, flag them.
- **Match existing code style**: if the project uses TypeScript, write TypeScript. If it uses functional components and hooks, don't introduce class components. If it uses a specific navigation library (React Navigation, Expo Router), use the same patterns.
- **Do not install unnecessary packages.** Only add what's strictly required.
- **All currency handling must use integers (cents), never floats**, to avoid floating point errors. Convert to display format only at render time.
- **GDPR note**: do not log or store full card details anywhere. Stripe handles this — your backend should only store the PaymentIntent ID and status.
- **PCI compliance**: confirm in a comment that the integration is PCI-compliant because card data never touches the backend (Stripe handles tokenization client-side).
- If you encounter any part of the codebase that conflicts with these instructions (e.g. an existing payment library, a different modal pattern, an existing backend), stop and explain the conflict before proceeding. Do not overwrite existing logic without flagging it first.

---

## File structure expected after implementation

```
/server
  index.js
  package.json
  .env.example

/app (or project root, match existing structure)
  .env.example
  App.js (modified — StripeProvider added)
  components/
    BuyModal.js (modified — full payment logic)
```

---

## Definition of done

The implementation is complete when:
- [ ] A user can open BuyModal on an event with a ticket price
- [ ] The Apple Pay / Google Pay sheet appears natively on the correct platform
- [ ] A successful test payment completes and shows a confirmation
- [ ] A declined payment shows a readable error message inside the modal
- [ ] The backend receives the webhook and logs the result
- [ ] No API keys are hardcoded anywhere
- [ ] The app does not crash on any of the handled error states
