/**
 * functions/index.js — BookkeepAI Firebase Cloud Functions
 * Uses modern environment variables (process.env) instead of
 * the deprecated functions.config() API.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp }   = require('firebase-admin/app');
const { getFirestore }    = require('firebase-admin/firestore');
const Stripe              = require('stripe');

initializeApp();

// Keys come from functions/.env file (never committed to Git)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ─────────────────────────────────────────────────────────────
// FUNCTION 1: Create Stripe Checkout Session
// ─────────────────────────────────────────────────────────────
exports.createCheckoutSession = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const { userId, email } = req.body;
    if (!userId || !email) {
      res.status(400).json({ error: 'userId and email are required' });
      return;
    }

    const db      = getFirestore();
    const userRef = db.doc(`users/${userId}/profile/settings`);
    const userSnap = await userRef.get();
    let customerId = userSnap.data()?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { firebaseUid: userId },
      });
      customerId = customer.id;
      await userRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      // Use the known app URL — req.headers.origin can be missing in some requests
      success_url: 'https://bookkeep-ai-c787f.web.app/?status=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://bookkeep-ai-c787f.web.app/?status=cancelled',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('createCheckoutSession error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ─────────────────────────────────────────────────────────────
// FUNCTION 2: Create Stripe Customer Portal Session
// ─────────────────────────────────────────────────────────────
exports.createPortalSession = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId is required' }); return; }

    const db       = getFirestore();
    const userSnap = await db.doc(`users/${userId}/profile/settings`).get();
    const customerId = userSnap.data()?.stripeCustomerId;

    if (!customerId) {
      res.status(400).json({ error: 'No Stripe customer found for this user' });
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: req.headers.origin,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('createPortalSession error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ─────────────────────────────────────────────────────────────
// FUNCTION 3: Stripe Webhook
// ─────────────────────────────────────────────────────────────
exports.stripeWebhook = onRequest(async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
  } catch (err) {
    console.error('Webhook verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const db = getFirestore();

  async function getUid(customerId) {
    const snap = await db.collectionGroup('settings')
      .where('stripeCustomerId', '==', customerId)
      .limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].ref.parent.parent.id;
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const uid = await getUid(sub.customer);
        if (uid) await db.doc(`users/${uid}/profile/settings`)
          .update({ subscriptionStatus: sub.status });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = await getUid(sub.customer);
        if (uid) await db.doc(`users/${uid}/profile/settings`)
          .update({ subscriptionStatus: 'inactive' });
        break;
      }
      default:
        console.log(`Unhandled event: ${event.type}`);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: error.message });
  }
});
