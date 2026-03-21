# 📒 BookkeepAI

> A privacy-first, AI-powered bookkeeping assistant built as a Chrome Extension (Manifest V3).

![Version](https://img.shields.io/badge/version-3.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Chrome%20Extension-yellow)
![License](https://img.shields.io/badge/license-MIT-green)
![MV3](https://img.shields.io/badge/Manifest-V3-orange)

---

## ✨ Features

- 💬 **Conversational expense logging** via a persistent Chrome Side Panel
- 📸 **Receipt OCR** — upload a receipt image and Gemini AI extracts all fields automatically
- 🔐 **AES-256-GCM encryption** — all data encrypted locally with your password, never sent to any server
- 🇺🇸 🇨🇦 **IRS & CRA tax categories** — built-in categories for US and Canadian small businesses
- 🗂 **Custom category management** — add, edit, rename, and delete categories; AI uses your custom list automatically
- 📊 **Sortable expense table** — click any column header to sort by Date, Vendor, Category, or Amount
- 📥 **CSV export** — export filtered expenses in current sort order
- 🔍 **Natural language queries** — ask "How much did I spend last month?" and get answers from your real data
- ⚙️ **Bring Your Own Key** — uses your own Gemini API key, stored encrypted locally

---

## 🗂 Project Structure

```
bookkeepai/
├── manifest.json          # Chrome MV3 manifest
├── background.js          # Service worker — side panel registration
├── sidepanel.html         # Full UI (chat, expenses table, settings)
├── bookkeepai.js          # Complete application logic
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── .gitignore
├── CHANGELOG.md
└── README.md
```

---

## 🚀 Installation (Developer Mode)

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/bookkeepai.git
   cd bookkeepai
   ```

2. **Open Chrome** and navigate to `chrome://extensions`

3. **Enable Developer Mode** (toggle in the top-right corner)

4. **Click "Load Unpacked"** and select the `bookkeepai` folder

5. **Click the BookkeepAI icon** in your Chrome toolbar to open the side panel

---

## ⚙️ Setup (First Launch)

1. **Select your region** — US (IRS categories) or Canada (CRA categories)
2. **Enter your Gemini API key** — get a free key at [aistudio.google.com](https://aistudio.google.com)
3. **Create a local password** — used to encrypt all your data with AES-256-GCM
4. Start logging expenses!

> **Note:** Billing must be enabled on your Google Cloud project for the Gemini API to work. The API has a generous free tier once billing is set up.

---

## 🤖 Supported Gemini Models

Change the model anytime in ⚙️ Settings → AI Model:

| Model | Notes |
|---|---|
| `gemini-2.5-flash` | ✅ Default — best price/performance |
| `gemini-2.0-flash` | Stable, widely available |
| `gemini-2.0-flash-lite` | Fastest / cheapest |
| `gemini-1.5-flash` | Older, broader account access |
| `gemini-1.5-pro` | Most capable, higher cost |

---

## 🔒 Privacy & Security

- All expense data is encrypted with **AES-256-GCM** using a key derived from your password via **PBKDF2** (310,000 iterations)
- Your **Gemini API key** is stored encrypted in `chrome.storage.local` — never in plaintext
- **No data leaves your device** except direct API calls to `generativelanguage.googleapis.com`
- There is **no recovery option** if you forget your password — store it safely

---

## 💬 Example Chat Commands

```
"Bought office supplies at Staples for $45.99"
"Lunch meeting at The Keg, $87 including tax"
"How much did I spend on software subscriptions this year?"
"Show me all my expenses from last month"
"What's my total spending for Q1?"
```

---

## 📋 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full version history.

---

## 🛠 Tech Stack

| Component | Technology |
|---|---|
| Extension | Chrome Manifest V3, Side Panel API |
| AI / OCR | Google Gemini API (vision + text) |
| Encryption | Web Crypto API — AES-256-GCM + PBKDF2 |
| Storage | `chrome.storage.local` (encrypted) |
| UI | Vanilla HTML/CSS/JS — zero dependencies |

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request
