# Changelog

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

---

## [3.1.0] — 2026-03-20

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

---

## [3.0.0] — 2026-03-20

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
