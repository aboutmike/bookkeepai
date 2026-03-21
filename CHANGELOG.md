# Changelog

<<<<<<< HEAD
All notable changes to BookkeepAI are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [3.2.0] — 2026-03-21

### Extension
- Added **Mobile Sync** section in ⚙️ Settings
- Firebase REST API sync engine (no external SDK — fully MV3 CSP compliant)
- Email/password sign-in to connect BookkeepAI Mobile account
- Bidirectional sync: push local expenses to Firestore, pull mobile expenses down
- Session persisted in `chrome.storage.local` — stays connected across panel opens
- Sync status display: "Last sync: just now · X pushed · Y pulled"
- Manifest updated to v3.2.0 with Firebase REST API host permissions

### PWA
- Added **Password** section in Settings
- Google-authenticated users can now send a password setup email
- Email users can update their password directly in-app
- Password section auto-shows the correct panel (Google vs email) on load
- Service worker bumped to v3 — forces cache refresh on all devices
- Fixed `renderPasswordSection` scope bug (was inside DOMContentLoaded, unreachable from `showScreen`)

---

## [3.1.1] — 2026-03-21

### PWA
- Fixed subscription redirect loop after Stripe payment
- Used `sessionStorage` bridge to pass payment success across Firebase auth async gap
- `markSubscriptionActive()` now writes to Firestore immediately on return from Stripe
- Fixed `auth/cancelled-popup-request` — removed duplicate Google Sign-In event listeners
- Fixed empty filter dropdowns in Expenses tab — `populateFilters()` now called on tab switch
- Camera button moved into input bar (was floating and overlapping send button)
- Added dedicated 📷 camera button (rear camera) alongside 📎 attach button

### Extension
- Fixed AI financial queries — expenses now sent on every message (removed unreliable keyword regex)
- System prompt rewritten to explicitly instruct AI to use provided expense data context
=======
All notable changes to BookkeepAI are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
>>>>>>> 69390ca81f52d93bfdf22028d9975e52525e45e0

---

## [3.1.0] — 2026-03-20

<<<<<<< HEAD
### Extension
- Added **Category Manager** in Settings — add, edit, rename, delete categories
- Renaming a category auto-updates all existing expenses
- AI uses custom category list automatically
- Sortable expense table — click Date, Vendor, Category, Amount column headers
- CSV export respects current sort order
- PDF export removed from Expenses tab

### PWA
- First working deployment to Firebase Hosting
- Stripe subscription flow functional
- Firebase Auth (email/password + Google Sign-In)
- Real-time Firestore expense sync
=======
### Added
- **Category Manager** in Settings tab — add, edit, rename, and delete expense categories
- Built-in IRS/CRA categories are pre-loaded as a starting point and are fully editable
- Renaming a category automatically updates all existing expenses that used the old name
- AI chatbot now uses the user's custom category list for all expense logging and OCR
- **Sortable expense table** — click Date, Vendor, Category, or Amount column headers to sort
- Sort direction toggles on repeated click (↑ ascending / ↓ descending)
- Amount column defaults to high → low on first click
- CSV export now respects current sort order
- Categories persist encrypted alongside expenses and config

### Changed
- Expense data context is now sent on **every** chat message (previously only on keyword match)
- System prompt explicitly instructs the AI to read from the provided data context — fixes the "I don't have access to your transaction history" response
- System prompt rewritten using string concatenation to avoid backtick escaping bugs in template literals

### Removed
- PDF export button removed from Expenses tab toolbar (per user request)

### Fixed
- AI was refusing to answer financial queries ("How much did I spend last month?") because expense data was only attached on keyword regex match — now always attached
- System prompt backtick over-escaping causing JS syntax error on load
>>>>>>> 69390ca81f52d93bfdf22028d9975e52525e45e0

---

## [3.0.0] — 2026-03-20

<<<<<<< HEAD
### Extension
- Complete ground-up rewrite — single JS bundle, zero inline handlers
- AES-256-GCM encryption via Web Crypto API
- 4-step onboarding wizard
- Gemini AI chat + receipt OCR
- IRS (US) + CRA (CA) tax categories
- Expense table with filters and CSV export
- Settings: region, model, API key, password

### PWA (Initial Build)
- Mobile-first PWA with camera receipt capture
- Firebase Auth + Firestore
- Stripe subscription gate (freemium model)
- Service worker for offline support
- Installable via "Add to Home Screen"
- Real-time expense sync with extension

---

## Roadmap

- [ ] Stripe webhook fully configured for subscription status sync
- [ ] Google Sign-In support in extension Mobile Sync
- [ ] Push notifications for expense reminders
- [ ] Tax summary report by category for year-end
- [ ] Import from bank CSV
- [ ] Multi-currency support
- [ ] Recurring expense scheduler
=======
### Added
- Complete ground-up rewrite — v3.0 is the stable, fully working baseline
- Single-file bundle (`bookkeepai.js`) replacing fragile 9-script load chain
- All event handlers wired via `addEventListener` — zero inline `onclick` attributes
- Side Panel API implementation using Chrome MV3
- AES-256-GCM encryption via Web Crypto API with PBKDF2 key derivation (310,000 iterations)
- 4-step onboarding wizard: region → API key → password → launch
- Password strength meter during onboarding
- Lock/unlock screen with encrypted session management
- Gemini AI integration for conversational expense logging
- Receipt OCR via Gemini vision model — extracts date, vendor, amount, tax, category
- Confidence scoring on OCR results — low-confidence fields trigger inline correction form
- IRS category set (20 categories) for US users
- CRA category set (20 categories) for Canadian users
- Expense table with category filter, month filter, year filter, and vendor search
- Summary cards: entry count, total amount, total tax
- CSV export with all filtered expenses
- Clear all expenses modal with confirmation
- Settings: region, AI model, API key, change password
- Toast notification system
- Custom extension icons (16, 32, 48, 128px)

### Fixed
- `manifest.json`: removed invalid `https://www.googleapis.com/` from `optional_permissions`
- CSP: removed remote CDN from `script-src` (MV3 forbids all remote script sources)
- Settings view CSS: `display: block` override was causing settings to bleed into chat view
- Tab system rewritten with `.on` class — no more conflicting `display` rules

---

## [2.0.0] — 2026-03-20

### Added
- Model selector in Settings — switch between Gemini model variants
- Gemini model URL map with 5 model options
- Human-readable error messages for quota, model availability, and API key errors
- Settings view scroll fix

### Changed
- Default model updated from `gemini-2.0-flash` to `gemini-1.5-flash` for broader compatibility
- Model URLs use `-latest` suffix aliases for stable resolution

### Fixed
- Settings tab rendering inside Chat view (CSS `display: block` conflict)
- `<strong>` HTML tags appearing as literal text in error messages
- Model availability errors for accounts without `gemini-2.0-flash` access

---

## [1.1.0] — 2026-03-20

### Added
- Multi-currency engine (`currency.js`) with live exchange rates via open.er-api.com
- Recurring expense scheduler (`recurring.js`) with Chrome alarms API
- Invoice auto-detection content script (`content-script.js`)
- Versioned Google Drive backup (`storage-drive-patch.js`) with 30-day + 12-month retention
- Dual PDF export: jsPDF direct download + native print dialog chooser modal
- Chrome alarms for recurring checks (hourly) and Drive backup (daily)
- System notifications for overdue recurring expenses when panel is closed
- Context menu: "Scan this page", "Log selected text", "Scan image as receipt"
- Scan active tab button in header

### Changed
- `background.js` updated with alarm handlers, context menus, and message relay
- `manifest.json` v1.1 — added `alarms`, `contextMenus`, `notifications`, `<all_urls>`
- `app.js` patched via `app-patch.js` to wire all new modules

### Fixed
- jsPDF CDN removed from CSP (MV3 violation) — replaced with local `lib/` folder loading

---

## [1.0.0] — 2026-03-20

### Added
- Initial release — BookkeepAI MVP
- `manifest.json` Manifest V3 with Side Panel API
- `sidepanel.html` — chat UI, expense table, settings panel, onboarding wizard
- `crypto.js` — AES-256-GCM encryption layer
- `storage.js` — encrypted `chrome.storage.local` manager
- `gemini.js` — Gemini API client with strict bookkeeping system prompt
- `app.js` — main application controller
- `background.js` — service worker
- IRS (US) and CRA (CA) tax category definitions
- Receipt OCR with confidence scoring and interactive correction form
- Bring Your Own Key model — Gemini API key stored encrypted locally
- Password-protected local data vault
- Expense table with filters and CSV export
- PDF report export via browser print dialog

---

## Roadmap (Planned)

- [ ] Google Drive versioned backup (daily snapshots)
- [ ] Recurring expense scheduling
- [ ] Multi-currency support with live exchange rates
- [ ] Invoice auto-detection on active browser tabs
- [ ] Mileage / vehicle expense tracker
- [ ] Tax summary report by category for year-end
- [ ] Import from bank CSV
>>>>>>> 69390ca81f52d93bfdf22028d9975e52525e45e0
