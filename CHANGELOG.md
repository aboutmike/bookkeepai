# Changelog

All notable changes to BookkeepAI are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [3.3.0] — 2026-03-22

### PWA
- **Itemized receipt capture** — Gemini OCR now extracts full receipt details:
  - Individual line items with name, quantity, unit price, line total
  - Tax breakdown: GST, PST, HST captured as separate fields
  - Subtotal, tip, payment method, store address, receipt/transaction number
- **Slide-up detail panel** — tap any expense row to open a full receipt view:
  - Editable fields: date, vendor, category, total amount
  - Tax breakdown display (GST/PST/HST)
  - Line items editor — add, edit, delete individual items
  - Deductible checkbox — flag expense as tax deductible
- **Expand arrow** on expense rows with line items — click ▶ to show/hide inline
- **Deductible flag** — ✓ green badge on deductible expense rows in table
- **CSV export modal** — prompts user to export all expenses or deductible only
  - Output columns: Date, Vendor, Category, Amount, Tax, Deductible (Yes/No)
- Robust multi-strategy JSON parser for OCR responses (handles markdown fences, trailing commas, partial responses)
- OCR prompt rewritten with valid JSON example template — eliminates unquoted placeholder values
- `maxOutputTokens` increased from 1024 → 2048 for full receipt extraction
- `wireCform` fix — correction form now preserves all rich receipt fields (lineItems, gst, pst, hst, subtotal, tip, paymentMethod, address, receiptNumber)
- Service worker bumped to v8

---

## [3.2.0] — 2026-03-21

### Extension
- Added **Mobile Sync** section in ⚙️ Settings
- Firebase REST API sync engine (no external SDK — fully MV3 CSP compliant)
- Email/password sign-in to connect BookkeepAI Mobile account
- Bidirectional sync: push local → Firestore, pull mobile-only → local
- Fixed duplicate expense bug — `Store.add()` now preserves incoming Firestore ID
- `syncAll()` only pushes/pulls genuinely missing expenses (idempotent)
- Session persisted in `chrome.storage.local` — stays connected across panel opens
- Manifest updated to v3.2.0 with Firebase REST API host permissions

### PWA
- Added **Password** section in Settings
- Google-authenticated users can send a password setup email to set a password
- Email users can update password directly in-app
- `renderPasswordSection` moved to module scope (was unreachable from `showScreen`)
- Service worker bumped to v3

---

## [3.1.1] — 2026-03-21

### PWA
- Fixed subscription redirect loop after Stripe payment
- `sessionStorage` bridge preserves payment success flag across Firebase auth async gap
- `markSubscriptionActive()` writes active status to Firestore immediately on Stripe return
- Fixed `auth/cancelled-popup-request` — removed duplicate Google Sign-In listeners
- Fixed empty filter dropdowns — `populateFilters()` now called on every Expenses tab switch
- Camera FAB removed — 📷 camera button now lives in the input bar alongside 📎 attach
- Floating button no longer overlaps the send button

### Extension
- Fixed AI financial queries — expense data sent on every chat message (not just keyword matches)
- System prompt explicitly instructs AI to read from `[DATA CONTEXT]` block in every message

---

## [3.1.0] — 2026-03-20

### Extension
- **Category Manager** in Settings — add, edit, rename, delete categories
- Renaming auto-updates all existing expenses that used the old name
- AI uses custom category list automatically in all prompts
- **Sortable expense table** — click Date, Vendor, Category, Amount headers to sort
- CSV export respects current sort order
- PDF export removed from Expenses tab

### PWA
- First working deployment to Firebase Hosting
- Stripe subscription checkout flow functional
- Firebase Auth (email/password + Google Sign-In)
- Real-time Firestore expense sync
- Category manager synced across devices

---

## [3.0.0] — 2026-03-20

### Extension
- Complete ground-up rewrite — single JS bundle, zero inline event handlers
- AES-256-GCM encryption via Web Crypto API (PBKDF2, 310,000 iterations)
- 4-step onboarding wizard: region → API key → password → launch
- Password strength meter
- Gemini AI conversational expense logging
- Receipt OCR via Gemini vision
- Confidence scoring — low-confidence fields trigger correction form
- IRS (US) + CRA (CA) tax categories
- Expense table with filters and CSV export
- Settings: region, model, API key, password change

### PWA (Initial Build)
- Mobile-first PWA — installable via "Add to Home Screen"
- Native camera button (rear camera) for receipt scanning
- Firebase Auth + Firestore cloud sync
- Stripe subscription gate (freemium — extension free, PWA paid)
- Service worker for offline support and caching

---

## Roadmap

- [ ] Stripe webhook fully configured for real-time subscription status sync
- [ ] Google Sign-In support in Chrome extension Mobile Sync
- [ ] Push notifications for expense reminders
- [ ] Tax summary report by category for year-end filing
- [ ] Import expenses from bank CSV
- [ ] Multi-currency support with live exchange rates
- [ ] Recurring expense scheduler
