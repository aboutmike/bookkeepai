/**
 * firebase.js — BookkeepAI Firebase Layer
 *
 * Handles:
 *   • Firebase app initialisation (config injected at deploy time)
 *   • Auth: email/password + Google Sign-In
 *   • Firestore: user profile, expenses, categories CRUD
 *   • Real-time listener for cross-device sync
 *   • Encrypted API key storage (same AES-256-GCM as extension)
 *
 * SETUP INSTRUCTIONS:
 *   1. Go to console.firebase.google.com
 *   2. Create a project called "bookkeepai"
 *   3. Add a Web App — copy the firebaseConfig object
 *   4. Replace the FIREBASE_CONFIG object below with your values
 *   5. Enable Authentication → Email/Password + Google providers
 *   6. Enable Firestore Database → Start in production mode
 *   7. Deploy the security rules in FIRESTORE_RULES below
 */

// ── Firebase Configuration ────────────────────────────────────
// Replace with your project's config from Firebase Console
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAE7U06FviTpOVd3j9sjteG8Z7-0NJHM4A",
  authDomain:        "bookkeep-ai-c787f.firebaseapp.com",
  projectId:         "bookkeep-ai-c787f",
  storageBucket:     "bookkeep-ai-c787f.appspot.com",
  messagingSenderId: "520053189317",
  appId:             "1:520053189317:web:d147ac90405406ace59eac",
};

/*
 * FIRESTORE SECURITY RULES — paste into Firebase Console → Firestore → Rules
 * ─────────────────────────────────────────────────────────────────────────────
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     // Users can only read/write their own data
 *     match /users/{userId}/{document=**} {
 *       allow read, write: if request.auth != null && request.auth.uid == userId;
 *     }
 *     match /expenses/{userId}/items/{expenseId} {
 *       allow read, write: if request.auth != null && request.auth.uid == userId;
 *     }
 *   }
 * }
 */

// ── Firebase SDK (loaded via CDN in index.html) ───────────────
// We reference the global `firebase` object injected by the SDK scripts.

let _app, _auth, _db, _currentUser = null;
let _syncUnsubscribe = null;  // Firestore real-time listener cleanup

// ── Initialise ────────────────────────────────────────────────
function initFirebase() {
  if (_app) return;
  _app  = firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  _db   = firebase.firestore();

  // Enable offline persistence so expenses logged without wifi
  // are queued and synced when connection is restored
  _db.enablePersistence({ synchronizeTabs: true })
    .catch(err => {
      if (err.code === 'failed-precondition') {
        // Multiple tabs open — persistence only in one tab
        console.warn('[Firebase] Persistence unavailable in multiple tabs');
      } else if (err.code === 'unimplemented') {
        console.warn('[Firebase] Persistence not supported in this browser');
      }
    });
}

// ── Auth state observer ───────────────────────────────────────
function onAuthStateChange(callback) {
  initFirebase();
  return _auth.onAuthStateChanged(user => {
    _currentUser = user;
    callback(user);
  });
}

// ── Sign up with email/password ───────────────────────────────
async function signUp(email, password, region) {
  initFirebase();
  const cred = await _auth.createUserWithEmailAndPassword(email, password);
  await cred.user.sendEmailVerification();
  // Create user profile in Firestore
  await _db.doc(`users/${cred.user.uid}/profile/settings`).set({
    email:              email,
    region:             region || 'US',
    model:              'gemini-2.5-flash',
    apiKeyEncrypted:    null,
    stripeCustomerId:   null,
    subscriptionStatus: 'inactive',
    createdAt:          firebase.firestore.FieldValue.serverTimestamp(),
  });
  // Seed default categories
  const { BUILTIN_CATS } = window.BookkeepAIShared || {};
  if (BUILTIN_CATS) {
    await _db.doc(`users/${cred.user.uid}/profile/categories`).set({
      list: BUILTIN_CATS[region || 'US'],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  return cred.user;
}

// ── Sign in with email/password ───────────────────────────────
async function signIn(email, password) {
  initFirebase();
  const cred = await _auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

// ── Google Sign-In ────────────────────────────────────────────
async function signInWithGoogle() {
  initFirebase();
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  const cred = await _auth.signInWithPopup(provider);

  // Create profile if first Google sign-in
  const profileRef = _db.doc(`users/${cred.user.uid}/profile/settings`);
  const existing   = await profileRef.get();
  if (!existing.exists) {
    await profileRef.set({
      email:              cred.user.email,
      region:             'US',
      model:              'gemini-2.5-flash',
      apiKeyEncrypted:    null,
      stripeCustomerId:   null,
      subscriptionStatus: 'inactive',
      createdAt:          firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  return cred.user;
}

// ── Password reset ────────────────────────────────────────────
async function resetPassword(email) {
  initFirebase();
  await _auth.sendPasswordResetEmail(email);
}

// Set a password for Google-authenticated users (who have no password yet)
// Uses Firebase's email link / credential linking approach
async function sendPasswordSetEmail(email) {
  initFirebase();
  // Send a password reset email — for Google users this effectively
  // lets them SET a password for the first time
  await _auth.sendPasswordResetEmail(email);
}

// Update password for currently signed-in user
async function updatePassword(newPassword) {
  initFirebase();
  const user = _auth.currentUser;
  if (!user) throw new Error('Not signed in');
  await user.updatePassword(newPassword);
}

// Check if current user signed in with Google (has no password)
function isGoogleUser() {
  const user = _auth.currentUser;
  if (!user) return false;
  return user.providerData.some(p => p.providerId === 'google.com');
}

// ── Sign out ──────────────────────────────────────────────────
async function signOut() {
  if (_syncUnsubscribe) { _syncUnsubscribe(); _syncUnsubscribe = null; }
  await _auth.signOut();
  _currentUser = null;
}

// ── Get current user ──────────────────────────────────────────
function currentUser() { return _currentUser; }
function uid() { return _currentUser?.uid || null; }

// ── User profile ──────────────────────────────────────────────
async function getProfile() {
  const snap = await _db.doc(`users/${uid()}/profile/settings`).get();
  return snap.exists ? snap.data() : null;
}

async function updateProfile(updates) {
  await _db.doc(`users/${uid()}/profile/settings`).update({
    ...updates,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ── API key (encrypted, stored in Firestore) ──────────────────
// We store the encrypted blob — the user's password is the key material.
// The encryption happens client-side using the same CryptoLayer as the extension.

async function saveApiKey(encryptedKey) {
  await updateProfile({ apiKeyEncrypted: encryptedKey });
}

async function getApiKey() {
  const profile = await getProfile();
  return profile?.apiKeyEncrypted || null;
}

// ── Categories ────────────────────────────────────────────────
async function getCategories() {
  const snap = await _db.doc(`users/${uid()}/profile/categories`).get();
  return snap.exists ? (snap.data().list || []) : null;
}

async function saveCategories(list) {
  await _db.doc(`users/${uid()}/profile/categories`).set({
    list,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ── Expenses CRUD ─────────────────────────────────────────────
function expensesRef() {
  return _db.collection(`expenses/${uid()}/items`);
}

async function addExpense(data) {
  const docRef = await expensesRef().add({
    ...data,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    syncedFrom: 'pwa',
  });
  return { id: docRef.id, ...data };
}

async function updateExpense(id, updates) {
  await expensesRef().doc(id).update({
    ...updates,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function deleteExpense(id) {
  await expensesRef().doc(id).delete();
}

async function getAllExpenses() {
  const snap = await expensesRef()
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function queryExpenses({ category, month, year, search } = {}) {
  let list = await getAllExpenses();
  if (category) list = list.filter(e => e.category === category);
  if (month)    list = list.filter(e => {
    const d = e.date ? new Date(e.date + 'T12:00:00') : null;
    return d && (d.getMonth() + 1) === +month;
  });
  if (year)     list = list.filter(e => {
    const d = e.date ? new Date(e.date + 'T12:00:00') : null;
    return d && d.getFullYear() === +year;
  });
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(e =>
      (e.vendor||'').toLowerCase().includes(q) ||
      (e.category||'').toLowerCase().includes(q)
    );
  }
  return list;
}

async function clearAllExpenses() {
  const snap = await expensesRef().get();
  const batch = _db.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

// ── Real-time sync listener ───────────────────────────────────
// Calls `onUpdate(expenses)` whenever Firestore data changes.
// Returns an unsubscribe function.

function subscribeToExpenses(onUpdate) {
  if (!uid()) return () => {};
  if (_syncUnsubscribe) _syncUnsubscribe();

  _syncUnsubscribe = expensesRef()
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      const expenses = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      onUpdate(expenses);
    }, err => {
      console.error('[Firebase] Sync error:', err);
    });

  return _syncUnsubscribe;
}

// ── Subscription status ───────────────────────────────────────
async function getSubscriptionStatus() {
  const profile = await getProfile();
  return profile?.subscriptionStatus || 'inactive';
}

async function isSubscribed() {
  const status = await getSubscriptionStatus();
  return status === 'active' || status === 'trialing';
}

// Immediately mark a user as active after successful Stripe checkout.
// The webhook will also update this, but this ensures no redirect loop
// while waiting for the webhook to fire.
async function markSubscriptionActive() {
  if (!uid()) return;
  await _db.doc(`users/${uid()}/profile/settings`).set(
    { subscriptionStatus: 'active' },
    { merge: true }
  );
}

// ── Chrome extension sync helper ─────────────────────────────
// Called when a signed-in extension user pushes a locally-logged
// expense up to Firebase so it appears on mobile too.

async function syncExpenseFromExtension(expense) {
  // Avoid duplicates by using the local expense ID as the Firestore doc ID
  await expensesRef().doc(expense.id).set({
    ...expense,
    syncedFrom: 'extension',
    updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ── Export public API ─────────────────────────────────────────
window.FB = {
  init:             initFirebase,
  onAuthStateChange,
  signUp,
  signIn,
  signInWithGoogle,
  resetPassword,
  sendPasswordSetEmail,
  updatePassword,
  isGoogleUser,
  signOut,
  currentUser,
  uid,
  getProfile,
  updateProfile,
  saveApiKey,
  getApiKey,
  getCategories,
  saveCategories,
  addExpense,
  updateExpense,
  deleteExpense,
  getAllExpenses,
  queryExpenses,
  clearAllExpenses,
  subscribeToExpenses,
  getSubscriptionStatus,
  isSubscribed,
  markSubscriptionActive,
  syncExpenseFromExtension,
};
