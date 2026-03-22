# 📒 BookkeepAI

> AI-powered bookkeeping for small businesses — snap receipts, log expenses, and prepare for tax season.

![Version](https://img.shields.io/badge/version-3.3.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20iOS%20%7C%20Android-lightgrey)

---

<p align="center">
  <a href="https://bookkeep-ai-c787f.web.app">
    <img src="https://img.shields.io/badge/Open_BookkeepAI_Mobile-Launch_App-6c8ef5?style=for-the-badge" alt="Launch BookkeepAI Mobile" />
  </a>
</p>

---

## What is BookkeepAI?

BookkeepAI is a two-part bookkeeping assistant for small business owners. Log expenses by chatting with AI, scan receipts with your phone camera, and get organized for tax season — without a spreadsheet in sight.

---

## Products

| Product                  | Platform            | Cost         | Data                             |
| ------------------------ | ------------------- | ------------ | -------------------------------- |
| **BookkeepAI Extension** | Chrome (Desktop)    | Free         | Encrypted locally on your device |
| **BookkeepAI Mobile**    | PWA (iOS + Android) | Subscription | Firebase cloud sync              |

Both products share the same backend — expenses logged on mobile sync instantly to the extension and vice versa.

---

## How It Works

1. **Log** — Type an expense in plain English: _"Lunch at Ganh Viet for $39.20"_
2. **Snap** — Photograph a receipt on your phone. AI extracts every line item automatically
3. **Review** — Tap any expense to see the full receipt breakdown — line items, taxes, tip, payment method
4. **Export** — Download a CSV for your accountant, filtered by deductible expenses only

---

## Features

### 📱 BookkeepAI Mobile (PWA)

- 📷 Camera receipt scanning — point, shoot, logged
- 🧾 Full receipt detail — line items, GST/PST/HST, tip, payment method
- ✅ Deductible flag — mark expenses as tax deductible
- 🔄 Real-time sync with Chrome extension
- 📴 Works offline — syncs when back online
- 📥 CSV export — all expenses or deductible only

### 💻 BookkeepAI Extension (Chrome)

- 💬 Conversational expense logging via AI chat
- 📸 Receipt OCR — upload a photo, AI extracts all fields
- 🗂 Custom category management (IRS & CRA tax categories)
- 📊 Sortable expense table
- 📱 Optional sync with BookkeepAI Mobile

---

## Privacy

Your data stays yours.

- **No server-side storage of your expenses** — the Chrome extension stores everything encrypted on your own device using AES-256-GCM
- **Your own AI key** — BookkeepAI uses your own Gemini API key. Your receipts are sent directly from your device to Google — never through our servers
- **Firebase sync is optional** — only enabled when you sign in to BookkeepAI Mobile
- **No ads. No data selling.**

---

## Get Started

### Chrome Extension (Free)

1. Download or clone this repository
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer Mode**
4. Click **Load Unpacked** → select the `extension/` folder
5. Click the 📒 BookkeepAI icon in your toolbar

### BookkeepAI Mobile

1. Open [bookkeep-ai-c787f.web.app](https://bookkeep-ai-c787f.web.app) on your phone
2. Tap **Add to Home Screen** to install it as an app
3. Sign up and complete the one-time purchase
4. Add your Gemini API key in Settings

> Get a free Gemini API key at [aistudio.google.com](https://aistudio.google.com)

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full version history.

---

## License

MIT — see [LICENSE](./LICENSE)
