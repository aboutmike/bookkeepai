/**
 * app.js — BookkeepAI PWA Application
 *
 * Screens:
 *   auth      → sign-in / sign-up / reset password
 *   paywall   → subscription required screen
 *   chat      → conversational expense logging (same as extension)
 *   camera    → native camera capture → Gemini OCR
 *   expenses  → sortable, filterable expense table
 *   settings  → region, model, API key, categories, billing
 *
 * Data flow:
 *   All reads/writes go through Firebase Firestore (window.FB)
 *   Gemini API calls are made client-side with the user's own key
 *   Subscription status is checked via Firestore (kept in sync by Stripe webhook)
 */

// ═══════════════════════════════════════════════════════════════
//  SHARED CONSTANTS (also used by firebase.js)
// ═══════════════════════════════════════════════════════════════
window.BookkeepAIShared = {
  BUILTIN_CATS: {
    US: ['Advertising & Marketing','Bank Fees & Interest','Business Insurance',
         'Business Meals (50%)','Car & Truck Expenses','Commissions & Fees',
         'Contract Labor','Depreciation','Employee Benefits','Home Office',
         'Legal & Professional Services','Office Supplies & Materials','Rent & Lease',
         'Repairs & Maintenance','Software & Subscriptions','Taxes & Licenses',
         'Travel & Lodging','Utilities','Other Deductible Expense','Non-Deductible / Personal'],
    CA: ['Advertising','Bad Debts','Business Tax, Fees & Licences','Delivery & Freight',
         'Depreciation (CCA)','Insurance','Interest & Bank Charges','Legal & Accounting',
         'Maintenance & Repairs','Management & Admin Fees','Meals & Entertainment (50%)',
         'Motor Vehicle Expenses','Office Expenses','Other Expenses','Rent',
         'Salaries & Wages','Software & Technology','Telephone & Utilities','Travel',
         'Non-Deductible / Personal'],
  },
};

// ═══════════════════════════════════════════════════════════════
//  APP STATE
// ═══════════════════════════════════════════════════════════════
const A = {
  screen:    'auth',    // current screen
  user:      null,      // Firebase user object
  profile:   null,      // Firestore profile
  cats:      [],        // active category list
  expenses:  [],        // live expense list (from Firestore listener)
  hist:      [],        // chat history
  pend:      null,      // pending correction entry
  file:      null,      // attached image { b64, mime, url }
  busy:      false,
  sortCol:   'date',
  sortDir:   'desc',
  apiKey:    null,      // decrypted in-memory API key
  unsubSync: null,      // Firestore listener cleanup
};

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const BUILTIN = window.BookkeepAIShared.BUILTIN_CATS;

let _tt = null;
function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg; el.className = `show ${type}`;
  if (_tt) clearTimeout(_tt);
  _tt = setTimeout(() => { el.className = ''; }, 3500);
}

function esc(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function md(s)   { return esc(s).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }

function fmtMoney(n) {
  const r = A.profile?.region || 'US';
  return new Intl.NumberFormat(r === 'US' ? 'en-US' : 'en-CA', {
    style: 'currency', currency: r === 'US' ? 'USD' : 'CAD', minimumFractionDigits: 2,
  }).format(n || 0);
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  } catch { return s; }
}

function csvQ(s) {
  s = String(s||'');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
}

function dlFile(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function setLoading(btnId, loading, label = '') {
  const btn = $(btnId); if (!btn) return;
  btn.disabled   = loading;
  btn.innerHTML  = loading
    ? '<span class="spinner"></span>'
    : label || btn.dataset.label || btn.textContent;
  if (label && !btn.dataset.label) btn.dataset.label = label;
}

// ═══════════════════════════════════════════════════════════════
//  SCREEN ROUTER
// ═══════════════════════════════════════════════════════════════
function showScreen(name) {
  A.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(`screen-${name}`)?.classList.add('on');
  // Bottom nav active state
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.screen === name);
  });
  if (name === 'expenses') { populateFilters(); renderTable(); }
  if (name === 'settings') { renderSettingsCats(); renderPasswordSection?.(); }
}

// ═══════════════════════════════════════════════════════════════
//  GEMINI
// ═══════════════════════════════════════════════════════════════
const Gemini = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const GC   = ':generateContent';
  const URLS = {
    'gemini-2.5-flash':      BASE+'gemini-2.5-flash'+GC,
    'gemini-2.0-flash':      BASE+'gemini-2.0-flash'+GC,
    'gemini-2.0-flash-lite': BASE+'gemini-2.0-flash-lite'+GC,
    'gemini-1.5-flash':      BASE+'gemini-1.5-flash'+GC,
    'gemini-1.5-pro':        BASE+'gemini-1.5-pro'+GC,
  };
  const DEFAULT = 'gemini-2.5-flash';
  function modelUrl() { return URLS[A.profile?.model || DEFAULT] || URLS[DEFAULT]; }

  function sysprompt() {
    const region = A.profile?.region || 'US';
    const label  = region === 'US' ? 'United States (IRS rules)' : 'Canada (CRA rules)';
    const cats   = A.cats.join(', ');
    const fence  = '```';
    return 'You are BookkeepAI, a bookkeeping assistant for a small business in '+label+'.\n\n'
      +'SCOPE: Only respond to expense logging, tax categorization, and financial queries. Politely decline everything else.\n\n'
      +'ANSWERING FINANCIAL QUERIES:\n'
      +'- Every user message includes a [DATA CONTEXT] block with ALL their recorded expenses.\n'
      +'- You MUST use this data to answer any spending question.\n'
      +'- NEVER say you lack access to transaction history — the data is in every message.\n'
      +'- Filter expenses by date yourself for queries like "last month" or "this year".\n\n'
      +'LOGGING NEW EXPENSES:\n'
      +'Output this block then a short confirmation:\n'
      +fence+'expense_entry\n'
      +'{"date":"YYYY-MM-DD","vendor":"Name","amount":0.00,"tax":0.00,"category":"Category Name","notes":"","confidence":1.0}\n'
      +fence+'\n'
      +'Confidence: 1.0=clear; 0.7-0.99=minor assumption; below 0.7=ask for missing fields.\n\n'
      +'APPROVED CATEGORIES: '+cats+'. Use ONLY these exact names when logging expenses.\n\n'
      +'DEDUCTIBLE FLAG:\n'
      +'- Each expense in the data has a "deductible" field: true or false.\n'
      +'- When asked about tax deductible expenses, ONLY list expenses where deductible === true.\n'
      +'- NEVER infer deductibility from category names — use ONLY the deductible field in the data.\n'
      +'- When displaying expense categories, use the EXACT category string from the data. Never modify or reformat it.\n\n'
      +'Be concise, friendly, and always use the exact data provided to answer queries.';
  }

  function ocrprompt() {
    const cats = A.cats.join(', ');
    return 'You are a receipt scanning assistant. Analyze this receipt image and extract all data.'
      +'\n\nRules:'
      +'\n- Return ONLY a JSON object. No markdown, no code fences, no explanation before or after.'
      +'\n- Use null for any field not visible on the receipt.'
      +'\n- lineItems must be an array even if empty.'
      +'\n- amount = the final total paid (including all taxes and tip).'
      +'\n- tax = total tax amount.'
      +'\n- category must be exactly one of: '+cats+'.'
      +'\n- confidence = 0.0 to 1.0 based on how clearly you can read the receipt.'
      +'\n\nReturn this exact JSON structure with real values substituted:'
      +'\n{"date":"YYYY-MM-DD","vendor":"string","address":"string or null","receiptNumber":"string or null",'
      +'"paymentMethod":"string or null","lineItems":[{"name":"string","qty":1,"unitPrice":0.00,"lineTotal":0.00}],'
      +'"subtotal":0.00,"gst":0.00,"pst":0.00,"hst":0.00,"tip":0.00,'
      +'"amount":0.00,"tax":0.00,"category":"string","notes":"string","confidence":0.9,'
      +'"low_confidence_fields":[]}';
  }

  function parseEntry(text) {
    const m = text.match(/```expense_entry\s*([\s\S]*?)```/);
    if (m) { try { return JSON.parse(m[1].trim()); } catch {} }
    return null;
  }

  async function callApi(messages, system, imgB64, imgMime) {
    const key = A.apiKey;
    if (!key) throw new Error('No API key. Add your Gemini key in Settings.');

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    if (imgB64) {
      const last = contents[contents.length - 1];
      if (last?.role === 'user') {
        last.parts.push({ inlineData: { mimeType: imgMime || 'image/jpeg', data: imgB64 } });
      } else {
        contents.push({ role: 'user', parts: [
          { text: 'Analyze this receipt.' },
          { inlineData: { mimeType: imgMime || 'image/jpeg', data: imgB64 } },
        ]});
      }
    }
    const body = { contents, generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } };
    if (system) body.system_instruction = { parts: [{ text: system }] };

    const res = await fetch(`${modelUrl()}?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error?.message || `HTTP ${res.status}`);
    }
    const d = await res.json();
    const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!t) throw new Error('Empty response from Gemini');
    return t;
  }

  async function chat(userMsg, history, contextData) {
    let msg = userMsg;
    if (contextData) msg = '[DATA CONTEXT]\n' + JSON.stringify(contextData) + '\n\n[QUESTION]\n' + userMsg;
    const msgs = [...(history || []), { role: 'user', content: msg }];
    const text  = await callApi(msgs, sysprompt());
    const entry = parseEntry(text);
    return { text, entry, needsConfirm: !!(entry && entry.confidence < 0.7) };
  }

  async function ocr(b64, mime) {
    const text = await callApi([{ role: 'user', content: ocrprompt() }], null, b64, mime);

    // Try multiple strategies to extract valid JSON from the response
    let d = null;

    // Strategy 1: Direct parse after stripping markdown fences
    try {
      const clean = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      d = JSON.parse(clean);
    } catch {}

    // Strategy 2: Find the first { ... } block in the response
    if (!d) {
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) d = JSON.parse(match[0]);
      } catch {}
    }

    // Strategy 3: Try to extract just the core fields if JSON is malformed
    if (!d) {
      try {
        // Sometimes Gemini adds trailing commas or comments — try to clean those
        const cleaned = text
          .replace(/^[^{]*/,'')        // remove anything before first {
          .replace(/[^}]*$/, '')        // remove anything after last }
          .replace(/,\s*}/g, '}')      // trailing commas before }
          .replace(/,\s*]/g, ']')      // trailing commas before ]
          .trim();
        d = JSON.parse(cleaned);
      } catch {}
    }

    if (!d) {
      console.error('[OCR] All parse strategies failed. Length:', text.length);
      return { ok: false, error: 'Could not read receipt data. Please try again or enter details manually.' };
    }

    // Ensure lineItems is always an array
    if (!Array.isArray(d.lineItems)) d.lineItems = [];

    // Ensure numeric fields are numbers not strings
    ['amount','tax','subtotal','gst','pst','hst','tip'].forEach(f => {
      if (d[f] !== null && d[f] !== undefined) d[f] = parseFloat(d[f]) || 0;
    });
    d.lineItems = d.lineItems.map(li => ({
      ...li,
      qty:       li.qty       ? parseFloat(li.qty)       : null,
      unitPrice: li.unitPrice ? parseFloat(li.unitPrice) : null,
      lineTotal: parseFloat(li.lineTotal) || 0,
    }));

    return {
      ok: true,
      data: d,
      needsConfirm: (d.confidence || 0) < 0.7 || (d.low_confidence_fields?.length > 0),
    };
  }

  return { parseEntry, chat, ocr };
})();

// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════
async function handleAuthReady(user) {
  if (!user) { showScreen('auth'); return; }
  A.user = user;

  // If returning from Stripe checkout, sessionStorage has 'stripe_paid'.
  // Write active status to Firestore NOW that the user is authenticated.
  if (sessionStorage.getItem('stripe_paid') === '1') {
    sessionStorage.removeItem('stripe_paid');
    try {
      await FB.markSubscriptionActive();
    } catch(e) {
      console.warn('Could not write subscription status:', e.message);
    }
  }

  // Check subscription — will pass immediately if we just wrote active above
  const subscribed = await Payments.checkSubscription().catch(() => false);
  if (!subscribed) { showScreen('paywall'); return; }

  // Load profile
  A.profile = await FB.getProfile();
  if (!A.profile) { showScreen('auth'); return; }

  // Load categories
  const storedCats = await FB.getCategories();
  A.cats = storedCats || [...BUILTIN[A.profile.region || 'US']];

  // Load and decrypt API key
  const encKey = await FB.getApiKey();
  if (encKey) {
    // Key stored as plaintext for PWA (user enters it in settings)
    // In a future hardening pass this can be encrypted with a user PIN
    A.apiKey = encKey;
  }

  // Start real-time expense sync
  if (A.unsubSync) A.unsubSync();
  A.unsubSync = FB.subscribeToExpenses(expenses => {
    A.expenses = expenses;
    if (A.screen === 'expenses') renderTable();
  });

  // Populate settings UI
  const regionSel = $('set-region');
  const modelSel  = $('set-model');
  if (regionSel) regionSel.value = A.profile.region || 'US';
  if (modelSel)  modelSel.value  = A.profile.model  || 'gemini-2.5-flash';

  // Show greeting
  $('user-email').textContent = user.email || '';
  // Pre-render password section so it's ready when user opens Settings
  renderPasswordSection();

  showScreen('chat');
  $('msgs').innerHTML = '';
  A.hist = [];
  addMsg('ai',
    `Hello! I'm BookkeepAI, your ${A.profile.region === 'US' ? 'IRS' : 'CRA'} bookkeeping assistant. 📒<br><br>`+
    `<strong>On mobile you can:</strong><br>`+
    `• 📷 Tap the camera button to photograph a receipt<br>`+
    `• 💬 Type an expense description<br>`+
    `• ❓ Ask about your spending<br><br>`+
    `What would you like to do?`
  );
}

// ═══════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════
function addMsg(role, html) {
  const w = document.createElement('div');
  w.className = `msg ${role}`;
  w.innerHTML = `<div class="avatar">${role==='ai'?'🤖':'👤'}</div><div class="bubble">${html}</div>`;
  $('msgs').appendChild(w);
  $('msgs').scrollTop = $('msgs').scrollHeight;
  return w;
}
function showTyping() {
  const w = document.createElement('div');
  w.className = 'msg ai'; w.id = 'typing';
  w.innerHTML = `<div class="avatar">🤖</div><div class="bubble"><div class="dots-anim"><span></span><span></span><span></span></div></div>`;
  $('msgs').appendChild(w);
  $('msgs').scrollTop = $('msgs').scrollHeight;
}
function hideTyping() { $('typing')?.remove(); }

function rcard(e, lc = []) {
  const conf = e.confidence ?? 1;
  const cls  = conf >= 0.9 ? 'g' : conf >= 0.7 ? 'y' : 'r';
  const warn = lc.length ? `<div class="warn-banner">⚠️ Low confidence: ${esc(lc.join(', '))}. Verify below.</div>` : '';

  // Line items section
  let lineItemsHtml = '';
  if (e.lineItems && e.lineItems.length > 0) {
    const rows = e.lineItems.map(li => `
      <div class="rrow" style="font-size:11px;">
        <span class="rl" style="flex:1;">${esc(li.name||'Item')}</span>
        ${li.qty ? `<span style="color:var(--muted);margin-right:8px;">x${li.qty}</span>` : ''}
        ${li.unitPrice ? `<span style="color:var(--muted);margin-right:8px;">${fmtMoney(li.unitPrice)}</span>` : ''}
        <span class="rv">${fmtMoney(li.lineTotal||0)}</span>
      </div>`).join('');
    lineItemsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Line Items</div>
      ${rows}
    </div>`;
  }

  // Tax breakdown — show named taxes if available, else fall back to total tax
  const taxParts = [];
  if (e.gst) taxParts.push(`GST ${fmtMoney(e.gst)}`);
  if (e.pst) taxParts.push(`PST ${fmtMoney(e.pst)}`);
  if (e.hst) taxParts.push(`HST ${fmtMoney(e.hst)}`);
  // If no named taxes but we have a total tax, show it
  if (!taxParts.length && (e.tax || e.tax === 0)) taxParts.push(`Tax ${fmtMoney(e.tax)}`);
  const taxBreakdown = taxParts.join(' · ') || '—';

  return `<div class="rcard">
    <div class="rrow"><span class="rl">Date</span><span class="rv">${esc(e.date||'—')}</span></div>
    <div class="rrow"><span class="rl">Vendor</span><span class="rv">${esc(e.vendor||'—')}</span></div>
    ${e.address ? `<div class="rrow"><span class="rl">Address</span><span class="rv" style="font-size:11px;">${esc(e.address)}</span></div>` : ''}
    ${e.receiptNumber ? `<div class="rrow"><span class="rl">Receipt #</span><span class="rv">${esc(e.receiptNumber)}</span></div>` : ''}
    ${e.paymentMethod ? `<div class="rrow"><span class="rl">Payment</span><span class="rv">${esc(e.paymentMethod)}</span></div>` : ''}
    ${lineItemsHtml}
    ${e.subtotal ? `<div class="rrow"><span class="rl">Subtotal</span><span class="rv">${fmtMoney(e.subtotal)}</span></div>` : ''}
    <div class="rrow"><span class="rl">Tax</span><span class="rv">${taxBreakdown}</span></div>
    ${e.tip ? `<div class="rrow"><span class="rl">Tip</span><span class="rv">${fmtMoney(e.tip)}</span></div>` : ''}
    <div class="rrow"><span class="rl">Total</span><span class="rv g" style="font-size:14px;font-weight:700;">${fmtMoney(e.amount)}</span></div>
    <div class="rrow"><span class="rl">Category</span><span class="rv"><span class="badge">${esc(e.category||'—')}</span></span></div>
    <div class="rrow"><span class="rl">Confidence</span><span class="rv ${cls}">${Math.round(conf*100)}%</span></div>
  </div>${warn}`;
}

async function buildCform(entry, fields) {
  const show = fields.length ? fields : ['date','vendor','amount','tax','category'];
  const rows = show.map(f => {
    if (f === 'category') {
      const opts = A.cats.map(c => `<option value="${esc(c)}"${entry.category===c?' selected':''}>${esc(c)}</option>`).join('');
      return `<div class="fld"><label>${f}</label><select id="cf-${f}">${opts}</select></div>`;
    }
    return `<div class="fld"><label>${f}</label><input type="text" id="cf-${f}" value="${esc(String(entry[f]??''))}" /></div>`;
  }).join('');
  return `<div class="cform" id="cform">
    <strong style="font-size:13px;">✏️ Please verify / correct:</strong>
    <div style="margin-top:8px;">${rows}</div>
    <div class="cform-btns">
      <button class="btn btn-pri btn-sm" id="cf-save">✅ Save Expense</button>
      <button class="btn btn-ghost btn-sm" id="cf-cancel">Cancel</button>
    </div>
  </div>`;
}

function wireCform() {
  $('cf-save')?.addEventListener('click', async () => {
    const e = A.pend; if (!e) return;
    // Update only the editable header fields — preserve ALL rich receipt data
    ['date','vendor','amount','tax','category'].forEach(f => {
      const el = $(`cf-${f}`);
      if (el) e[f] = (f==='amount'||f==='tax') ? parseFloat(el.value)||0 : el.value.trim();
    });
    e.confidence = 1;
    // Rich fields are preserved on the pend object: lineItems, gst, pst, hst,
    // subtotal, tip, paymentMethod, address, receiptNumber
    await saveExpense(e);
    A.pend = null; $('cform')?.remove();
  });
  $('cf-cancel')?.addEventListener('click', () => {
    A.pend = null; $('cform')?.remove();
    addMsg('ai', 'Entry discarded. Ready when you are! 📒');
  });
}

async function saveExpense(e) {
  try {
    const saved = await FB.addExpense({ ...e, source: e.source || 'pwa-chat' });
    toast(`✅ ${saved.vendor} — ${fmtMoney(saved.amount)}`, 'ok');
    addMsg('ai',
      `Expense logged! ✅<br><strong>${esc(saved.vendor)}</strong> · ${fmtMoney(saved.amount)} · ${esc(saved.category)}<br>`+
      `<span style="color:var(--muted);font-size:11px;">${fmtDate(saved.date)}</span>`);
  } catch (err) { toast(`Save failed: ${err.message}`, 'err'); }
}

async function sendMessage() {
  if (A.busy) return;
  const input = $('txt');
  const text  = input?.value.trim() || '';
  const file  = A.file;
  if (!text && !file) return;
  if (!A.apiKey) { toast('Add your Gemini API key in ⚙️ Settings', 'err'); return; }

  A.busy = true; $('send-btn').disabled = true;

  let userHtml = md(text || '📷 Receipt photo');
  if (file) userHtml += `<div style="margin-top:8px;"><img src="${file.url}" style="max-width:200px;max-height:160px;border-radius:10px;display:block;border:1px solid var(--border);" /></div>`;
  addMsg('me', userHtml);

  if (input) { input.value = ''; input.style.height = 'auto'; }
  const f = file; clearFile();
  A.hist.push({ role: 'user', content: text || 'I uploaded a receipt image.' });
  showTyping();

  try {
    if (f) {
      const res = await Gemini.ocr(f.b64, f.mime);
      hideTyping();
      if (!res.ok) {
        addMsg('ai', `⚠️ ${esc(res.error)}`);
      } else {
        const lc   = res.data.low_confidence_fields || [];
        const card = rcard(res.data, lc);
        if (res.needsConfirm) {
          A.pend = res.data;
          const bubble = addMsg('ai', 'Receipt scanned — please verify:').querySelector('.bubble');
          bubble.innerHTML += card + await buildCform(res.data, lc);
          wireCform();
        } else {
          const bubble = addMsg('ai', 'Receipt scanned! ✅').querySelector('.bubble');
          bubble.innerHTML += card;
          await saveExpense({ ...res.data, source: 'pwa-camera' });
        }
      }
    } else {
      const ctx = {
        count:       A.expenses.length,
        totalAmount: A.expenses.reduce((s,e) => s + (e.amount||0), 0).toFixed(2),
        totalTax:    A.expenses.reduce((s,e) => s + (e.tax||0),    0).toFixed(2),
        currentDate: new Date().toISOString().split('T')[0],
        expenses:    A.expenses.map(e => ({
          date: e.date, vendor: e.vendor, amount: e.amount,
          tax: e.tax, category: e.category, notes: e.notes,
          deductible: e.deductible || false,
        })),
      };
      const res = await Gemini.chat(text, A.hist.slice(-10), ctx);
      hideTyping();
      const display = res.text.replace(/```expense_entry[\s\S]*?```/g,'').trim();
      let extra = '';
      if (res.entry) {
        const lc = res.entry.confidence < 0.7 ? ['amount','vendor','date'].filter(k=>!res.entry[k]) : [];
        extra = rcard(res.entry, lc);
        if (res.needsConfirm) { A.pend = res.entry; extra += await buildCform(res.entry, lc); }
        else { await saveExpense(res.entry); }
      }
      addMsg('ai', md(display||'…') + extra);
      if (res.needsConfirm) setTimeout(wireCform, 0);
      A.hist.push({ role: 'assistant', content: res.text });
    }
  } catch (err) {
    hideTyping();
    addMsg('ai', `❌ ${esc(err.message)}`);
  }

  A.busy = false; $('send-btn').disabled = false;
  input?.focus();
}

// ═══════════════════════════════════════════════════════════════
//  CAMERA
// ═══════════════════════════════════════════════════════════════
function clearFile() {
  A.file = null;
  $('att-preview')?.classList.remove('show');
  const thumb = $('att-thumb');
  if (thumb) thumb.src = '';
}

function handleFileSelect(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const url = ev.target.result;
    A.file = { b64: url.split(',')[1], mime: file.type, url };
    const thumb = $('att-thumb');
    if (thumb) { thumb.src = url; $('att-preview').classList.add('show'); }
    // Auto-send if came from camera shortcut
    if (A.screen !== 'chat') showScreen('chat');
  };
  reader.readAsDataURL(file);
}

// ═══════════════════════════════════════════════════════════════
//  EXPENSE TABLE
// ═══════════════════════════════════════════════════════════════
function sortExpenses(list) {
  const { sortCol, sortDir } = A;
  const mul = sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let av, bv;
    if (sortCol === 'date')     { av = a.date||'';     bv = b.date||''; }
    else if (sortCol === 'vendor')   { av = (a.vendor||'').toLowerCase();   bv = (b.vendor||'').toLowerCase(); }
    else if (sortCol === 'category') { av = (a.category||'').toLowerCase(); bv = (b.category||'').toLowerCase(); }
    else if (sortCol === 'amount')   { av = a.amount||0; bv = b.amount||0; }
    else { av = a.date||''; bv = b.date||''; }
    return av < bv ? -mul : av > bv ? mul : 0;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('.th-sort').forEach(th => {
    const col   = th.dataset.col;
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (col === A.sortCol) {
      arrow.textContent = A.sortDir === 'asc' ? ' ↑' : ' ↓';
      th.classList.add('th-active');
    } else {
      arrow.textContent = ' ↕';
      th.classList.remove('th-active');
    }
  });
}

// ── Detail Panel ─────────────────────────────────────────────
function openDetailPanel(e) {
  // Remove any existing panel
  $('detail-panel')?.remove();

  const cats = A.cats;
  const catOpts = cats.map(c =>
    `<option value="${esc(c)}"${e.category===c?' selected':''}>${esc(c)}</option>`
  ).join('');

  // Line items editor
  const renderLineItems = (items) => {
    if (!items || !items.length) return '<p style="font-size:12px;color:var(--muted);">No line items captured.</p>';
    return items.map((li, i) => `
      <div class="li-edit-row" data-idx="${i}">
        <input class="li-inp li-name-inp" type="text" value="${esc(li.name||'')}" placeholder="Item name" data-field="name" data-idx="${i}" />
        <input class="li-inp li-qty-inp"  type="number" value="${li.qty||''}" placeholder="Qty" min="0" step="any" data-field="qty" data-idx="${i}" />
        <input class="li-inp li-price-inp" type="number" value="${li.unitPrice||''}" placeholder="Unit $" min="0" step="0.01" data-field="unitPrice" data-idx="${i}" />
        <input class="li-inp li-total-inp" type="number" value="${li.lineTotal||''}" placeholder="Total" min="0" step="0.01" data-field="lineTotal" data-idx="${i}" />
        <button class="li-del-btn" data-idx="${i}">✕</button>
      </div>`).join('');
  };

  // Tax breakdown display
  const taxParts = [];
  if (e.gst) taxParts.push(`<span class="dp-tax-item">GST <strong>${fmtMoney(e.gst)}</strong></span>`);
  if (e.pst) taxParts.push(`<span class="dp-tax-item">PST <strong>${fmtMoney(e.pst)}</strong></span>`);
  if (e.hst) taxParts.push(`<span class="dp-tax-item">HST <strong>${fmtMoney(e.hst)}</strong></span>`);
  const taxHtml = taxParts.length
    ? `<div class="dp-tax-row">${taxParts.join('')}</div>`
    : `<div class="dp-tax-row"><span class="dp-tax-item">Tax <strong>${fmtMoney(e.tax||0)}</strong></span></div>`;

  const panel = document.createElement('div');
  panel.id = 'detail-panel';
  panel.className = 'detail-panel';
  panel.innerHTML = `
    <div class="dp-overlay"></div>
    <div class="dp-sheet">
      <div class="dp-header">
        <div>
          <div class="dp-title">${esc(e.vendor||'Expense')}</div>
          <div class="dp-subtitle">${fmtDate(e.date)}</div>
        </div>
        <button class="dp-close" id="dp-close">✕</button>
      </div>

      <div class="dp-body">

        <!-- Editable header fields -->
        <div class="dp-section">
          <div class="dp-section-title">Receipt Details</div>
          <div class="dp-field-row">
            <div class="fld" style="flex:1;"><label>Date</label>
              <input type="date" id="dp-date" value="${e.date||''}" /></div>
            <div class="fld" style="flex:1;"><label>Total Amount</label>
              <input type="number" id="dp-amount" value="${e.amount||''}" step="0.01" min="0" /></div>
          </div>
          <div class="fld"><label>Vendor</label>
            <input type="text" id="dp-vendor" value="${esc(e.vendor||'')}" /></div>
          <div class="fld"><label>Category</label>
            <select id="dp-category">${catOpts}</select></div>
          <div class="dp-check-row">
            <label class="dp-check-label">
              <input type="checkbox" id="dp-deductible" ${e.deductible ? 'checked' : ''} />
              <span>Tax deductible expense</span>
            </label>
          </div>
        </div>

        <!-- Read-only receipt info -->
        ${(e.address||e.receiptNumber||e.paymentMethod) ? `
        <div class="dp-section">
          <div class="dp-section-title">Receipt Info</div>
          ${e.address ? `<div class="dp-info-row"><span class="dp-label">Address</span><span class="dp-val">${esc(e.address)}</span></div>` : ''}
          ${e.receiptNumber ? `<div class="dp-info-row"><span class="dp-label">Receipt #</span><span class="dp-val">${esc(e.receiptNumber)}</span></div>` : ''}
          ${e.paymentMethod ? `<div class="dp-info-row"><span class="dp-label">Payment</span><span class="dp-val">${esc(e.paymentMethod)}</span></div>` : ''}
        </div>` : ''}

        <!-- Tax breakdown -->
        <div class="dp-section">
          <div class="dp-section-title">Tax Breakdown</div>
          ${taxHtml}
          ${e.subtotal ? `<div class="dp-info-row"><span class="dp-label">Subtotal</span><span class="dp-val">${fmtMoney(e.subtotal)}</span></div>` : ''}
          ${e.tip ? `<div class="dp-info-row"><span class="dp-label">Tip</span><span class="dp-val">${fmtMoney(e.tip)}</span></div>` : ''}
        </div>

        <!-- Line items -->
        <div class="dp-section">
          <div class="dp-section-title" style="display:flex;justify-content:space-between;align-items:center;">
            Line Items
            <button class="btn btn-ghost btn-sm" id="dp-add-item" style="padding:3px 10px;font-size:11px;">+ Add</button>
          </div>
          <div id="dp-line-items">${renderLineItems(e.lineItems||[])}</div>
        </div>

      </div>

      <div class="dp-footer">
        <button class="btn btn-ghost" id="dp-cancel">Cancel</button>
        <button class="btn btn-pri"   id="dp-save">Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Working copy of line items
  let workingItems = JSON.parse(JSON.stringify(e.lineItems || []));

  // Re-render line items in panel
  function refreshLineItems() {
    $('dp-line-items').innerHTML = workingItems.length
      ? workingItems.map((li, i) => `
        <div class="li-edit-row" data-idx="${i}">
          <input class="li-inp li-name-inp" type="text" value="${esc(li.name||'')}" placeholder="Item name" data-field="name" data-idx="${i}" />
          <input class="li-inp li-qty-inp"  type="number" value="${li.qty||''}" placeholder="Qty" min="0" step="any" data-field="qty" data-idx="${i}" />
          <input class="li-inp li-price-inp" type="number" value="${li.unitPrice||''}" placeholder="Unit $" min="0" step="0.01" data-field="unitPrice" data-idx="${i}" />
          <input class="li-inp li-total-inp" type="number" value="${li.lineTotal||''}" placeholder="Total" min="0" step="0.01" data-field="lineTotal" data-idx="${i}" />
          <button class="li-del-btn" data-idx="${i}">✕</button>
        </div>`).join('')
      : '<p style="font-size:12px;color:var(--muted);">No line items. Tap + Add to add one.</p>';
    wireLineItemEvents();
  }

  function wireLineItemEvents() {
    $('dp-line-items').querySelectorAll('.li-inp').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx   = +inp.dataset.idx;
        const field = inp.dataset.field;
        workingItems[idx] = workingItems[idx] || {};
        workingItems[idx][field] = (field==='name') ? inp.value : (parseFloat(inp.value)||null);
      });
    });
    $('dp-line-items').querySelectorAll('.li-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        workingItems.splice(+btn.dataset.idx, 1);
        refreshLineItems();
      });
    });
  }

  wireLineItemEvents();

  // Add line item
  $('dp-add-item').addEventListener('click', () => {
    workingItems.push({ name:'', qty:null, unitPrice:null, lineTotal:0 });
    refreshLineItems();
  });

  // Close
  function closePanel() { panel.classList.remove('open'); setTimeout(()=>panel.remove(), 300); }
  $('dp-close').addEventListener('click', closePanel);
  $('dp-cancel').addEventListener('click', closePanel);
  panel.querySelector('.dp-overlay').addEventListener('click', closePanel);

  // Save
  $('dp-save').addEventListener('click', async () => {
    const updates = {
      date:       $('dp-date')?.value || e.date,
      vendor:     $('dp-vendor')?.value.trim() || e.vendor,
      amount:     parseFloat($('dp-amount')?.value) || e.amount,
      category:   $('dp-category')?.value || e.category,
      deductible: $('dp-deductible')?.checked || false,
      lineItems:  workingItems.filter(li => li.name || li.lineTotal),
    };
    try {
      await FB.updateExpense(e.id, updates);
      toast('Expense updated ✅', 'ok');
      closePanel();
    } catch(err) { toast('Save failed: ' + err.message, 'err'); }
  });

  // Animate in
  requestAnimationFrame(() => panel.classList.add('open'));
}

async function renderTable() {
  const cat    = $('f-cat')?.value    || '';
  const month  = $('f-month')?.value  || '';
  const year   = $('f-year')?.value   || '';
  const search = $('f-search')?.value || '';

  let filtered = A.expenses;
  if (cat)    filtered = filtered.filter(e => e.category === cat);
  if (month)  filtered = filtered.filter(e => e.date && (new Date(e.date+'T12:00:00').getMonth()+1) === +month);
  if (year)   filtered = filtered.filter(e => e.date && new Date(e.date+'T12:00:00').getFullYear() === +year);
  if (search) { const q = search.toLowerCase(); filtered = filtered.filter(e => (e.vendor||'').toLowerCase().includes(q) || (e.category||'').toLowerCase().includes(q)); }

  const list = sortExpenses(filtered);

  $('s-count').textContent = list.length;
  $('s-total').textContent = fmtMoney(list.reduce((s,e)=>s+(e.amount||0),0));
  $('s-tax').textContent   = fmtMoney(list.reduce((s,e)=>s+(e.tax||0),0));
  updateSortHeaders();

  const tbody = $('tbody');
  const empty = $('empty');
  if (!tbody) return;
  tbody.innerHTML = '';
  empty?.classList.toggle('hidden', list.length > 0);
  if (!list.length) return;

  list.forEach(e => {
    const hasItems = e.lineItems && e.lineItems.length > 0;
    const deductBadge = e.deductible
      ? '<span style="font-size:9px;color:var(--green);margin-left:4px;">✓</span>' : '';

    // Summary row
    const tr = document.createElement('tr');
    tr.className = 'expense-row';
    tr.dataset.id = e.id;
    tr.innerHTML = `
      <td>${fmtDate(e.date)}</td>
      <td style="max-width:75px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.vendor)}">${esc(e.vendor)}</td>
      <td><span class="badge" style="font-size:9px;">${esc(e.category)}</span>${deductBadge}</td>
      <td class="acell">${fmtMoney(e.amount)}</td>
      <td style="white-space:nowrap;">
        ${hasItems ? `<button class="expand-btn" data-id="${e.id}" title="Show line items">▶</button>` : ''}
        <button class="dbtn" data-id="${e.id}">🗑</button>
      </td>`;
    tbody.appendChild(tr);

    // Click row → open detail panel
    tr.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('dbtn') || ev.target.classList.contains('expand-btn')) return;
      openDetailPanel(e);
    });

    // Expand arrow → inline line items
    if (hasItems) {
      tr.querySelector('.expand-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const btn = ev.currentTarget;
        const existingDetail = tbody.querySelector(`tr.line-items-row[data-parent="${e.id}"]`);
        if (existingDetail) {
          existingDetail.remove();
          btn.textContent = '▶';
          btn.style.transform = '';
        } else {
          const detailTr = document.createElement('tr');
          detailTr.className = 'line-items-row';
          detailTr.dataset.parent = e.id;
          const itemRows = e.lineItems.map(li => `
            <div class="li-row">
              <span class="li-name">${esc(li.name||'Item')}</span>
              ${li.qty ? `<span class="li-qty">x${li.qty}</span>` : ''}
              ${li.unitPrice ? `<span class="li-unit">${fmtMoney(li.unitPrice)}</span>` : ''}
              <span class="li-total">${fmtMoney(li.lineTotal||0)}</span>
            </div>`).join('');
          detailTr.innerHTML = `<td colspan="5" style="padding:0 12px 10px 24px;background:var(--surface);">
            <div class="li-container">${itemRows}</div>
          </td>`;
          tr.insertAdjacentElement('afterend', detailTr);
          btn.textContent = '▼';
          btn.style.transform = '';
        }
      });
    }
  });

  tbody.querySelectorAll('.dbtn').forEach(b => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await FB.deleteExpense(b.dataset.id);
      // Also remove any expanded line items row
      tbody.querySelector(`tr.line-items-row[data-parent="${b.dataset.id}"]`)?.remove();
      toast('Deleted', 'ok');
    });
  });
}

function populateFilters() {
  const catSel = $('f-cat');
  if (catSel) {
    catSel.innerHTML = '<option value="">Category</option>' +
      A.cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  const monthSel = $('f-month');
  if (monthSel) {
    monthSel.innerHTML = '<option value="">Month</option>' +
      ['January','February','March','April','May','June','July','August','September','October','November','December']
      .map((m,i) => `<option value="${i+1}">${m}</option>`).join('');
  }
  const y = new Date().getFullYear();
  const yearSel = $('f-year');
  if (yearSel) {
    yearSel.innerHTML = '<option value="">Year</option>' +
      Array.from({length:6},(_,i)=>y-i).map(y=>`<option value="${y}">${y}</option>`).join('');
  }
}

async function exportCSV() {
  if (!A.expenses.length) { toast('No data to export','err'); return; }

  // Show deductible filter modal before exporting
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:60;display:flex;align-items:flex-end;justify-content:center;padding:0;';
  modal.innerHTML = `
    <div style="background:var(--surface);border-top:1px solid var(--border);border-radius:16px 16px 0 0;
      padding:24px 20px 32px;width:100%;max-width:460px;">
      <h3 style="font-size:15px;margin-bottom:8px;">📥 Export CSV</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px;line-height:1.6;">
        Which expenses do you want to export?
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-pri" id="csv-all">Export All Expenses</button>
        <button class="btn btn-ghost" id="csv-deductible">Export Deductible Only</button>
        <button class="btn btn-ghost" id="csv-cancel" style="color:var(--red);">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const doExport = (deductibleOnly) => {
    modal.remove();
    let list = sortExpenses(A.expenses);
    if (deductibleOnly) list = list.filter(e => e.deductible);
    if (!list.length) { toast('No matching expenses to export','err'); return; }
    const rows = [
      ['Date','Vendor','Category','Amount','Tax','Deductible'],
      ...list.map(e => [
        e.date, csvQ(e.vendor), csvQ(e.category),
        (e.amount||0).toFixed(2),
        (e.tax||0).toFixed(2),
        e.deductible ? 'Yes' : 'No',
      ])
    ];
    dlFile(rows.map(r=>r.join(',')).join('\n'), 'bookkeepai.csv', 'text/csv');
    toast(`CSV exported — ${list.length} expense${list.length!==1?'s':''}  ✅`,'ok');
  };

  modal.querySelector('#csv-all').addEventListener('click', () => doExport(false));
  modal.querySelector('#csv-deductible').addEventListener('click', () => doExport(true));
  modal.querySelector('#csv-cancel').addEventListener('click', () => modal.remove());
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════
async function renderSettingsCats() {
  const container = $('cat-manager');
  if (!container) return;

  const rows = A.cats.map((c,i) => `
    <div class="cat-row" data-idx="${i}">
      <span class="cat-name">${esc(c)}</span>
      <div class="cat-actions">
        <button class="cat-btn cat-edit" data-idx="${i}" title="Edit">✏️</button>
        <button class="cat-btn cat-del"  data-idx="${i}" title="Delete">🗑</button>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="cat-list">${rows}</div>
    <div class="cat-add-row">
      <input type="text" id="cat-inp" placeholder="New category name…" maxlength="60" />
      <button class="btn btn-pri btn-sm" id="cat-add">+ Add</button>
    </div>`;

  $('cat-add').addEventListener('click', async () => {
    const val = $('cat-inp').value.trim();
    if (!val) { toast('Enter a name.','err'); return; }
    if (A.cats.includes(val)) { toast('Already exists.','err'); return; }
    A.cats.push(val);
    await FB.saveCategories(A.cats);
    $('cat-inp').value = '';
    toast(`"${val}" added ✅`,'ok');
    await renderSettingsCats();
    populateFilters();
  });
  $('cat-inp').addEventListener('keydown', e => { if(e.key==='Enter') $('cat-add').click(); });

  container.querySelectorAll('.cat-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = +btn.dataset.idx;
      const old = A.cats[idx];
      const row = btn.closest('.cat-row');
      row.innerHTML = `<input type="text" class="cat-edit-input" value="${esc(old)}" maxlength="60" style="flex:1;background:var(--surface2);border:1px solid var(--accent);border-radius:var(--rs);color:var(--text);padding:7px 10px;font-size:13px;font-family:inherit;outline:none;" /><div class="cat-actions"><button class="cat-btn" id="ce-save">✅</button><button class="cat-btn" id="ce-cancel">✕</button></div>`;
      const input = row.querySelector('.cat-edit-input');
      input.focus(); input.select();
      row.querySelector('#ce-save').addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) { toast('Name cannot be empty.','err'); return; }
        if (A.cats.includes(newName) && newName !== old) { toast('Already exists.','err'); return; }
        // Update expenses in Firestore that used the old category
        const toUpdate = A.expenses.filter(e => e.category === old);
        await Promise.all(toUpdate.map(e => FB.updateExpense(e.id, { category: newName })));
        A.cats[idx] = newName;
        await FB.saveCategories(A.cats);
        toast(`Renamed — ${toUpdate.length} expense${toUpdate.length!==1?'s':''} updated ✅`,'ok');
        await renderSettingsCats(); populateFilters();
      });
      input.addEventListener('keydown', e => {
        if(e.key==='Enter') row.querySelector('#ce-save').click();
        if(e.key==='Escape') row.querySelector('#ce-cancel').click();
      });
      row.querySelector('#ce-cancel').addEventListener('click', () => renderSettingsCats());
    });
  });

  container.querySelectorAll('.cat-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx  = +btn.dataset.idx;
      const name = A.cats[idx];
      if (!confirm(`Delete "${name}"?\n\nExisting expenses keep this name in their records.`)) return;
      A.cats.splice(idx, 1);
      await FB.saveCategories(A.cats);
      toast(`"${name}" deleted`,'ok');
      await renderSettingsCats(); populateFilters();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
// Render correct password panel based on how user signed in
// Defined at module level so showScreen() can call it
async function renderPasswordSection() {
  if (!$('pw-google-section')) return;
  const isGoogle = FB.isGoogleUser?.() || false;
  $('pw-google-section').classList.toggle('hidden', !isGoogle);
  $('pw-email-section').classList.toggle('hidden',   isGoogle);
}

document.addEventListener('DOMContentLoaded', async () => {

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] Registered:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  }

  // Init Firebase
  FB.init();

  // Check if Stripe redirected back with ?status=success
  // Store in sessionStorage BEFORE cleaning the URL
  // sessionStorage survives the Firebase auth async delay
  const _sp = new URLSearchParams(window.location.search);
  if (_sp.get('status') === 'success') {
    sessionStorage.setItem('stripe_paid', '1');
    window.history.replaceState({}, '', '/');
    toast('Payment successful! Loading your account… 🎉', 'ok');
  } else if (_sp.get('status') === 'cancelled') {
    window.history.replaceState({}, '', '/');
    toast('Checkout cancelled — no charge was made.', '');
  }

  // Auth state listener
  FB.onAuthStateChange(handleAuthReady);

  // ── Auth screen ──
  $('auth-tabs')?.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('on'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('on'));
      tab.classList.add('on');
      $(`panel-${tab.dataset.panel}`)?.classList.add('on');
    });
  });

  // Sign up
  $('btn-signup')?.addEventListener('click', async () => {
    const email    = $('signup-email').value.trim();
    const password = $('signup-pw').value;
    const region   = $('signup-region').value;
    if (!email || !password) { toast('Fill in all fields.','err'); return; }
    if (password.length < 8)  { toast('Password must be 8+ characters.','err'); return; }
    setLoading('btn-signup', true, 'Create Account');
    try {
      await FB.signUp(email, password, region);
      toast('Account created! Please verify your email, then sign in.','ok');
      // Switch to sign-in tab
      document.querySelector('.auth-tab[data-panel="signin"]')?.click();
    } catch (e) { toast(e.message,'err'); }
    setLoading('btn-signup', false, 'Create Account');
  });

  // Sign in
  $('btn-signin')?.addEventListener('click', async () => {
    const email    = $('signin-email').value.trim();
    const password = $('signin-pw').value;
    if (!email || !password) { toast('Fill in all fields.','err'); return; }
    setLoading('btn-signin', true, 'Sign In');
    try {
      await FB.signIn(email, password);
    } catch (e) { toast(e.message,'err'); }
    setLoading('btn-signin', false, 'Sign In');
  });

  // Google sign-in
  document.querySelectorAll('.btn-google').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await FB.signInWithGoogle(); }
      catch (e) { toast(e.message,'err'); }
    });
  });

  // Forgot password
  $('btn-reset')?.addEventListener('click', async () => {
    const email = $('signin-email').value.trim() || $('reset-email')?.value.trim();
    if (!email) { toast('Enter your email address first.','err'); return; }
    try { await FB.resetPassword(email); toast('Password reset email sent ✅','ok'); }
    catch(e) { toast(e.message,'err'); }
  });

  // Enter key on sign-in
  $('signin-pw')?.addEventListener('keydown', e => { if(e.key==='Enter') $('btn-signin').click(); });

  // ── Paywall screen ──
  $('btn-subscribe')?.addEventListener('click', async () => {
    setLoading('btn-subscribe', true, 'Subscribe');
    try { await Payments.startSubscription(); }
    catch(e) { toast(e.message,'err'); setLoading('btn-subscribe', false, 'Subscribe'); }
  });
  $('btn-signout-paywall')?.addEventListener('click', async () => {
    await FB.signOut(); showScreen('auth');
  });

  // ── Bottom navigation ──
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  // ── Chat ──
  $('txt')?.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} });
  $('txt')?.addEventListener('input', function(){ this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,120)+'px'; });
  $('send-btn')?.addEventListener('click', sendMessage);

  // Camera / file input (with capture="environment" for rear camera on mobile)
  // Gallery / file picker
  $('file-in')?.addEventListener('change', e => {
    handleFileSelect(e.target.files?.[0]);
    e.target.value = '';
  });
  // Camera button — opens rear camera directly on mobile
  $('camera-in')?.addEventListener('change', e => {
    handleFileSelect(e.target.files?.[0]);
    e.target.value = '';
  });
  $('btn-clear-att')?.addEventListener('click', clearFile);

  // ── Expenses ──
  ['f-cat','f-month','f-year','f-search'].forEach(id => {
    $(id)?.addEventListener('change', renderTable);
    $(id)?.addEventListener('input',  renderTable);
  });
  document.querySelectorAll('.th-sort').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (A.sortCol === col) A.sortDir = A.sortDir==='asc'?'desc':'asc';
      else { A.sortCol = col; A.sortDir = col==='amount'?'desc':'asc'; }
      renderTable();
    });
  });
  $('b-csv')?.addEventListener('click', exportCSV);
  $('b-clearall')?.addEventListener('click', () => $('modal-clear').classList.remove('hidden'));
  $('b-mcancel')?.addEventListener('click',  () => $('modal-clear').classList.add('hidden'));
  $('b-mconfirm')?.addEventListener('click', async () => {
    await FB.clearAllExpenses();
    $('modal-clear').classList.add('hidden');
    toast('All expenses cleared.','ok');
  });

  // ── Settings ──
  $('set-region')?.addEventListener('change', async function() {
    A.profile.region = this.value;
    await FB.updateProfile({ region: this.value });
    A.cats = [...BUILTIN[this.value]];
    await FB.saveCategories(A.cats);
    await renderSettingsCats(); populateFilters();
    toast('Region updated — categories reset to defaults.','ok');
  });
  $('set-model')?.addEventListener('change', async function() {
    A.profile.model = this.value;
    await FB.updateProfile({ model: this.value });
    toast(`Model set to ${this.value}`,'ok');
  });
  $('btn-save-apikey')?.addEventListener('click', async () => {
    const k = $('set-apikey').value.trim();
    if (!k) { toast('Enter an API key.','err'); return; }
    A.apiKey = k;
    await FB.saveApiKey(k);
    $('set-apikey').value = '';
    toast('API key saved ✅','ok');
  });
  $('btn-manage-billing')?.addEventListener('click', async () => {
    try { await Payments.manageSubscription(); }
    catch(e) { toast(e.message,'err'); }
  });

  // Send password setup email (for Google users)
  $('btn-send-pw-email')?.addEventListener('click', async () => {
    const user = FB.currentUser();
    if (!user?.email) { toast('No email found.','err'); return; }
    const btn = $('btn-send-pw-email');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await FB.sendPasswordSetEmail(user.email);
      toast(`Password setup email sent to ${user.email} ✅`,'ok');
      btn.textContent = 'Email Sent ✅';
    } catch(e) {
      toast(e.message,'err');
      btn.disabled = false; btn.textContent = 'Send Password Setup Email';
    }
  });

  // Update password (for email users)
  $('btn-update-pw')?.addEventListener('click', async () => {
    const newPw = $('set-pw-new')?.value;
    if (!newPw || newPw.length < 8) { toast('Password must be 8+ characters.','err'); return; }
    try {
      await FB.updatePassword(newPw);
      $('set-pw-new').value = '';
      toast('Password updated ✅','ok');
    } catch(e) {
      // Requires recent sign-in — prompt to sign out and back in
      if (e.code === 'auth/requires-recent-login') {
        toast('Please sign out and sign back in, then try again.','err');
      } else {
        toast(e.message,'err');
      }
    }
  });

  $('btn-signout')?.addEventListener('click', async () => {
    if (A.unsubSync) { A.unsubSync(); A.unsubSync = null; }
    await FB.signOut();
    A.user = null; A.profile = null; A.expenses = []; A.cats = [];
    showScreen('auth');
    toast('Signed out.','');
  });

  // Handle camera shortcut from manifest.json shortcuts
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'camera') {
    // Will trigger after auth completes in handleAuthReady
    window._pendingCameraAction = true;
  }
});
