# 📒 BookkeepAI

> AI-powered bookkeeping for small businesses — available as a Chrome Extension (free) and Mobile PWA (paid).

![Version](https://img.shields.io/badge/version-3.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Products

| Product | Platform | Cost | Data |
|---|---|---|---|
| **BookkeepAI Extension** | Chrome (Desktop) | Free | Local encrypted storage |
| **BookkeepAI Mobile** | PWA (iOS + Android) | Subscription | Firebase cloud sync |

Both products share the same Firebase backend — expenses logged on mobile sync instantly to the extension and vice versa.

---

## Repository Structure

```
bookkeepai/
├── extension/          Chrome MV3 side-panel extension
│   ├── manifest.json
│   ├── bookkeepai.js   Complete application logic
│   ├── sidepanel.html  Full UI
│   ├── background.js
│   └── icons/
│
├── pwa/                Mobile PWA (Firebase Hosting)
│   ├── index.html      Full mobile UI
│   ├── app.js          PWA application logic
│   ├── firebase.js     Firebase Auth + Firestore layer
│   ├── stripe.js       Stripe subscription gate
│   ├── sw.js           Service worker (offline support)
│   ├── manifest.json   PWA web manifest
│   └── icons/
│
├── functions/          Firebase Cloud Functions (Stripe backend)
│   ├── index.js        createCheckoutSession, createPortalSession, stripeWebhook
│   ├── package.json
│   └── .env            ← NOT in Git (secrets)
│
├── firebase.json       Firebase Hosting + Functions config
├── .firebaserc         Firebase project binding
├── .gitignore
├── CHANGELOG.md
├── LICENSE
└── README.md
```

---

## Chrome Extension — Free Tier

### Features
- 💬 Conversational expense logging via AI chat
- 📸 Receipt OCR — upload a photo, AI extracts all fields
- 🔐 AES-256-GCM local encryption
- 🇺🇸 🇨🇦 IRS & CRA tax categories
- 🗂 Custom category management
- 📊 Sortable expense table with CSV export
- 📱 Optional Mobile Sync (requires BookkeepAI Mobile account)

### Installation
1. Clone this repo
2. Go to `chrome://extensions` → Enable Developer Mode
3. Click **Load Unpacked** → select the `extension/` folder
4. Click the BookkeepAI icon in Chrome toolbar

---

## BookkeepAI Mobile — Paid PWA

### Features
- 📷 Camera receipt scanning — point, shoot, logged
- 🔄 Real-time sync with Chrome extension via Firebase
- 💬 Same AI chat interface, optimised for mobile
- 📴 Works offline, syncs when reconnected
- 🔒 Your Gemini API key, your data — full privacy

### Live App
🌐 **[bookkeep-ai-c787f.web.app](https://bookkeep-ai-c787f.web.app)**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension UI | Vanilla HTML/CSS/JS — zero dependencies |
| Mobile UI | Vanilla HTML/CSS/JS — zero dependencies |
| AI / OCR | Google Gemini API (user's own key) |
| Encryption (extension) | Web Crypto API — AES-256-GCM + PBKDF2 |
| Auth | Firebase Authentication |
| Database | Firebase Firestore |
| Payments | Stripe (via Firebase Cloud Functions) |
| Hosting | Firebase Hosting |
| Extension storage | `chrome.storage.local` (encrypted) |

---

## Development Setup

### Prerequisites
- Node.js 20+
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project (see `DEPLOY.md`)
- A Stripe account (see `DEPLOY.md`)

### Deploy PWA + Functions
```bash
firebase login
firebase use bookkeep-ai-c787f
cd functions && npm install && cd ..
firebase deploy --only "functions,hosting"
```

### Load Extension Locally
1. Make changes in `extension/`
2. Go to `chrome://extensions` → click the refresh icon on BookkeepAI

---

## Environment Variables

Create `functions/.env` (never committed to Git):
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full version history.

---

## License

MIT — see [LICENSE](./LICENSE)
