/**
 * stripe.js — BookkeepAI Stripe Integration
 *
 * Handles:
 *   • Subscription status gate (block PWA if not subscribed)
 *   • Redirect to Stripe Checkout for new subscriptions
 *   • Redirect to Stripe Customer Portal for manage/cancel
 *   • Webhook documentation for your backend
 *
 * SETUP INSTRUCTIONS:
 *   1. Create a Stripe account at stripe.com
 *   2. In Stripe Dashboard → Products → Create a product:
 *      Name: "BookkeepAI Mobile"
 *      Price: $X/month recurring
 *      Copy the Price ID (starts with price_)
 *   3. Replace STRIPE_PUBLISHABLE_KEY and PRICE_ID below
 *   4. Deploy the webhook handler (see WEBHOOK SETUP below)
 *   5. Add your webhook endpoint in Stripe Dashboard → Webhooks
 *
 * ARCHITECTURE NOTE:
 *   Stripe Checkout requires a server-side session creation for security.
 *   We use Firebase Cloud Functions as the backend.
 *   See CLOUD_FUNCTION_CODE below for the exact function to deploy.
 */

// ── Configuration ─────────────────────────────────────────────
// Replace with your actual Stripe keys
const STRIPE_CONFIG = {
  publishableKey: 'pk_test_51TDDkAKtJzTfO2xMTiYdCLDFqeTsttix3RXQnomxbyaA4TEFnNX3OWvEoS4y9h2HffcNUbYKHMpdFV9Qqu0bky75000yyeui2I',
  // Use pk_test_... for testing
  priceId:        'price_1TDDs0KtJzTfO2xM2y0CInNo',
  // Your Firebase Cloud Function URL (set after deploying)
  checkoutFnUrl:  'https://us-central1-bookkeep-ai-c787f.cloudfunctions.net/createCheckoutSession',
  portalFnUrl:    'https://us-central1-bookkeep-ai-c787f.cloudfunctions.net/createPortalSession',
};

/*
 * ═══════════════════════════════════════════════════════════════
 * FIREBASE CLOUD FUNCTION CODE
 * Deploy this to Firebase Functions (functions/index.js)
 * Run: firebase deploy --only functions
 * ═══════════════════════════════════════════════════════════════
 *
 * const functions = require('firebase-functions');
 * const admin     = require('firebase-admin');
 * const stripe    = require('stripe')(functions.config().stripe.secret_key);
 *
 * admin.initializeApp();
 *
 * // Create Stripe Checkout Session
 * exports.createCheckoutSession = functions.https.onRequest(async (req, res) => {
 *   res.set('Access-Control-Allow-Origin', '*');
 *   if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
 *
 *   const { userId, email } = req.body;
 *
 *   // Get or create Stripe customer
 *   const userRef  = admin.firestore().doc(`users/${userId}/profile/settings`);
 *   const userSnap = await userRef.get();
 *   let customerId = userSnap.data()?.stripeCustomerId;
 *
 *   if (!customerId) {
 *     const customer = await stripe.customers.create({ email, metadata: { firebaseUid: userId } });
 *     customerId = customer.id;
 *     await userRef.update({ stripeCustomerId: customerId });
 *   }
 *
 *   const session = await stripe.checkout.sessions.create({
 *     customer:    customerId,
 *     mode:        'subscription',
 *     line_items:  [{ price: 'price_YOUR_PRICE_ID', quantity: 1 }],
 *     success_url: `${req.headers.origin}/?session_id={CHECKOUT_SESSION_ID}&status=success`,
 *     cancel_url:  `${req.headers.origin}/?status=cancelled`,
 *   });
 *
 *   res.json({ url: session.url });
 * });
 *
 * // Create Stripe Customer Portal Session (manage/cancel)
 * exports.createPortalSession = functions.https.onRequest(async (req, res) => {
 *   res.set('Access-Control-Allow-Origin', '*');
 *   if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
 *
 *   const { userId } = req.body;
 *   const userSnap   = await admin.firestore().doc(`users/${userId}/profile/settings`).get();
 *   const customerId = userSnap.data()?.stripeCustomerId;
 *
 *   const session = await stripe.billingPortal.sessions.create({
 *     customer:   customerId,
 *     return_url: req.headers.origin,
 *   });
 *
 *   res.json({ url: session.url });
 * });
 *
 * // Stripe Webhook — keep subscription status in sync
 * exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
 *   const sig     = req.headers['stripe-signature'];
 *   const secret  = functions.config().stripe.webhook_secret;
 *   let event;
 *   try { event = stripe.webhooks.constructEvent(req.rawBody, sig, secret); }
 *   catch (err) { res.status(400).send(`Webhook Error: ${err.message}`); return; }
 *
 *   const getUid = async (customerId) => {
 *     const snap = await admin.firestore()
 *       .collectionGroup('settings')
 *       .where('stripeCustomerId', '==', customerId).limit(1).get();
 *     return snap.empty ? null : snap.docs[0].ref.parent.parent.id;
 *   };
 *
 *   switch (event.type) {
 *     case 'customer.subscription.created':
 *     case 'customer.subscription.updated': {
 *       const sub = event.data.object;
 *       const uid = await getUid(sub.customer);
 *       if (uid) await admin.firestore()
 *         .doc(`users/${uid}/profile/settings`)
 *         .update({ subscriptionStatus: sub.status });
 *       break;
 *     }
 *     case 'customer.subscription.deleted': {
 *       const sub = event.data.object;
 *       const uid = await getUid(sub.customer);
 *       if (uid) await admin.firestore()
 *         .doc(`users/${uid}/profile/settings`)
 *         .update({ subscriptionStatus: 'inactive' });
 *       break;
 *     }
 *   }
 *   res.json({ received: true });
 * });
 */

// ── Load Stripe.js ────────────────────────────────────────────
let _stripe = null;

function loadStripe() {
  return new Promise((resolve, reject) => {
    if (_stripe) { resolve(_stripe); return; }
    if (window.Stripe) { _stripe = Stripe(STRIPE_CONFIG.publishableKey); resolve(_stripe); return; }
    const s    = document.createElement('script');
    s.src      = 'https://js.stripe.com/v3/';
    s.onload   = () => { _stripe = Stripe(STRIPE_CONFIG.publishableKey); resolve(_stripe); };
    s.onerror  = () => reject(new Error('Failed to load Stripe.js'));
    document.head.appendChild(s);
  });
}

// ── Redirect to Stripe Checkout ───────────────────────────────
async function startSubscription() {
  const user = window.FB?.currentUser();
  if (!user) throw new Error('Must be signed in to subscribe');

  await loadStripe();

  const resp = await fetch(STRIPE_CONFIG.checkoutFnUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userId: user.uid, email: user.email }),
  });

  if (!resp.ok) throw new Error('Failed to create checkout session');
  const { url } = await resp.json();
  window.location.href = url;
}

// ── Redirect to Customer Portal (manage / cancel) ─────────────
async function manageSubscription() {
  const user = window.FB?.currentUser();
  if (!user) throw new Error('Must be signed in');

  const resp = await fetch(STRIPE_CONFIG.portalFnUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userId: user.uid }),
  });

  if (!resp.ok) throw new Error('Failed to open billing portal');
  const { url } = await resp.json();
  window.location.href = url;
}

// ── Handle redirect back from Stripe ─────────────────────────
// Called on app load to check if user just completed checkout
async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');

  if (status === 'success') {
    // Clean up URL
    window.history.replaceState({}, '', '/');
    // Firestore will have been updated by the webhook already,
    // but we optimistically show success immediately
    return 'success';
  }
  if (status === 'cancelled') {
    window.history.replaceState({}, '', '/');
    return 'cancelled';
  }
  return null;
}

// ── Subscription gate ─────────────────────────────────────────
// Returns true if the user has an active subscription.
// Checks Firestore — updated in real-time by Stripe webhooks.
async function checkSubscription() {
  if (!window.FB) return false;
  return window.FB.isSubscribed();
}

// ── Export ────────────────────────────────────────────────────
window.Payments = {
  startSubscription,
  manageSubscription,
  handleStripeReturn,
  checkSubscription,
  config: STRIPE_CONFIG,
};
