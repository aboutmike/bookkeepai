/**
 * firebase-sync.js — BookkeepAI Chrome Extension Firebase Sync
 *
 * Optional module that adds Firebase sync to the Chrome extension.
 * When a user signs in with their BookkeepAI account, expenses logged
 * in the extension are automatically pushed to Firestore so they appear
 * on their mobile PWA.
 *
 * ADD TO sidepanel.html before bookkeepai.js:
 *   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
 *   <script src="firebase-sync.js"></script>
 *
 * NOTE: The Firebase SDK scripts above load from Google's CDN.
 * This is allowed in Chrome extensions — only *your own scripts*
 * must be local. Third-party scripts via <script src=""> are fine
 * as long as they are not in the extension_pages CSP script-src.
 * Update manifest.json content_security_policy to:
 *   "script-src 'self' https://www.gstatic.com; object-src 'self'"
 *
 * SETUP: Use the same FIREBASE_CONFIG from pwa/firebase.js
 */

const FIREBASE_CONFIG_EXT = {
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const ExtSync = (() => {
  let _app, _auth, _db, _user = null;
  let _initialized = false;

  function init() {
    if (_initialized) return;
    try {
      _app  = firebase.initializeApp(FIREBASE_CONFIG_EXT, 'bookkeepai-ext');
      _auth = _app.auth();
      _db   = _app.firestore();
      _initialized = true;
      console.log('[ExtSync] Firebase initialized');
    } catch(e) {
      console.warn('[ExtSync] Firebase init failed:', e.message);
    }
  }

  function isReady() { return _initialized && _user !== null; }

  // ── Auth ──────────────────────────────────────────────────
  async function signIn(email, password) {
    init();
    const cred = await _auth.signInWithEmailAndPassword(email, password);
    _user = cred.user;
    return _user;
  }

  async function signInWithGoogle() {
    init();
    const provider = new firebase.auth.GoogleAuthProvider();
    const cred = await _auth.signInWithPopup(provider);
    _user = cred.user;
    return _user;
  }

  async function signOut() {
    await _auth?.signOut();
    _user = null;
  }

  function currentUser() { return _user; }

  // Restore session on panel open
  function restoreSession(onUser) {
    init();
    _auth.onAuthStateChanged(user => {
      _user = user;
      onUser(user);
    });
  }

  // ── Sync expense up to Firebase ───────────────────────────
  async function pushExpense(expense) {
    if (!isReady()) return false;
    try {
      await _db
        .collection(`expenses/${_user.uid}/items`)
        .doc(expense.id)
        .set({
          ...expense,
          syncedFrom: 'extension',
          updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      return true;
    } catch(e) {
      console.warn('[ExtSync] Push failed:', e.message);
      return false;
    }
  }

  // ── Pull expenses from Firebase ───────────────────────────
  // Used to get expenses logged on mobile that aren't in local storage yet
  async function pullExpenses() {
    if (!isReady()) return [];
    try {
      const snap = await _db
        .collection(`expenses/${_user.uid}/items`)
        .orderBy('createdAt', 'desc')
        .get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
      console.warn('[ExtSync] Pull failed:', e.message);
      return [];
    }
  }

  // ── Merge Firebase expenses into local storage ────────────
  // Adds any mobile-logged expenses that don't exist locally
  async function mergeFromCloud() {
    if (!isReady()) return 0;
    const cloudExpenses = await pullExpenses();
    const localExpenses = await Store.getAll();
    const localIds = new Set(localExpenses.map(e => e.id));
    let added = 0;
    for (const e of cloudExpenses) {
      if (!localIds.has(e.id)) {
        await Store.add({ ...e, source: e.source || 'pwa-camera' });
        added++;
      }
    }
    return added;
  }

  // ── Sync UI ───────────────────────────────────────────────
  function renderSyncUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    function render() {
      const user = currentUser();
      if (user) {
        container.innerHTML = `
          <div style="background:var(--surface2);border:1px solid var(--border);
            border-radius:var(--rs);padding:11px 13px;font-size:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">
              <div>
                <div style="font-weight:600;color:var(--green);">✅ Synced with Mobile</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${user.email}</div>
              </div>
              <button id="ext-sync-now" class="btn btn-ghost btn-sm">Sync Now</button>
            </div>
            <button id="ext-signout" class="btn btn-ghost btn-sm" style="font-size:11px;">
              Disconnect account
            </button>
          </div>`;
        document.getElementById('ext-sync-now')?.addEventListener('click', async () => {
          const toast = window.toast || (() => {});
          toast('Syncing…');
          // Push all local expenses to cloud
          const local = await Store.getAll();
          let pushed = 0;
          for (const e of local) {
            const ok = await pushExpense(e);
            if (ok) pushed++;
          }
          // Pull any mobile-only expenses
          const pulled = await mergeFromCloud();
          toast(`Synced ✅ — ${pushed} pushed, ${pulled} pulled`, 'ok');
          if (pulled > 0 && typeof renderTable === 'function') renderTable();
        });
        document.getElementById('ext-signout')?.addEventListener('click', async () => {
          await signOut();
          render();
          window.toast?.('Disconnected from mobile sync.','');
        });
      } else {
        container.innerHTML = `
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">
            Sign in to sync expenses with your BookkeepAI mobile app.
          </div>
          <div class="fld" style="margin-bottom:8px;">
            <input type="email" id="ext-email" placeholder="Email" style="font-size:12px;" />
          </div>
          <div class="fld" style="margin-bottom:10px;">
            <input type="password" id="ext-pw" placeholder="Password" style="font-size:12px;" />
          </div>
          <div style="display:flex;gap:6px;">
            <button id="ext-signin" class="btn btn-pri btn-sm" style="flex:1;">Sign In</button>
            <button id="ext-google" class="btn btn-ghost btn-sm" style="flex:1;">Google</button>
          </div>`;

        document.getElementById('ext-signin')?.addEventListener('click', async () => {
          const email = document.getElementById('ext-email')?.value.trim();
          const pw    = document.getElementById('ext-pw')?.value;
          if (!email || !pw) { window.toast?.('Fill in email and password.','err'); return; }
          try {
            await signIn(email, pw);
            render();
            const pulled = await mergeFromCloud();
            window.toast?.(`Signed in ✅${pulled > 0 ? ` — ${pulled} mobile expenses synced` : ''}`, 'ok');
            if (pulled > 0 && typeof renderTable === 'function') renderTable();
          } catch(e) { window.toast?.(e.message,'err'); }
        });

        document.getElementById('ext-google')?.addEventListener('click', async () => {
          try {
            await signInWithGoogle();
            render();
            const pulled = await mergeFromCloud();
            window.toast?.(`Signed in ✅${pulled > 0 ? ` — ${pulled} mobile expenses synced` : ''}`, 'ok');
            if (pulled > 0 && typeof renderTable === 'function') renderTable();
          } catch(e) { window.toast?.(e.message,'err'); }
        });
      }
    }

    // Restore session then render
    restoreSession(() => render());
  }

  return {
    init, isReady, signIn, signInWithGoogle, signOut, currentUser,
    restoreSession, pushExpense, pullExpenses, mergeFromCloud, renderSyncUI,
  };
})();

window.ExtSync = ExtSync;
