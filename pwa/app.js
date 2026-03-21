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
      +'APPROVED CATEGORIES: '+cats+'. Use ONLY these exact names.\n\n'
      +'Be concise, friendly, and always use the provided expense data to answer queries.';
  }

  function ocrprompt() {
    const cats = A.cats.join(', ');
    return 'Analyze this receipt. Return ONLY valid JSON, no markdown:\n'
      +'{"date":"YYYY-MM-DD or null","vendor":"name or null","amount":number_or_null,"tax":number_or_0,'
      +'"category":"one of: '+cats+'","notes":"brief","confidence":0.0,"low_confidence_fields":[]}';
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
    const body = { contents, generationConfig: { temperature: 0.2, maxOutputTokens: 1024 } };
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
    const text  = await callApi([{ role: 'user', content: ocrprompt() }], null, b64, mime);
    const clean = text.replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim();
    try {
      const d = JSON.parse(clean);
      return { ok: true, data: d, needsConfirm: d.confidence < 0.7 || (d.low_confidence_fields?.length > 0) };
    } catch {
      return { ok: false, error: 'Could not parse receipt. Try a clearer image.' };
    }
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
  return `<div class="rcard">
    <div class="rrow"><span class="rl">Date</span><span class="rv">${esc(e.date||'—')}</span></div>
    <div class="rrow"><span class="rl">Vendor</span><span class="rv">${esc(e.vendor||'—')}</span></div>
    <div class="rrow"><span class="rl">Amount</span><span class="rv g">${fmtMoney(e.amount)}</span></div>
    <div class="rrow"><span class="rl">Tax</span><span class="rv">${fmtMoney(e.tax)}</span></div>
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
    ['date','vendor','amount','tax','category'].forEach(f => {
      const el = $(`cf-${f}`);
      if (el) e[f] = (f==='amount'||f==='tax') ? parseFloat(el.value)||0 : el.value.trim();
    });
    e.confidence = 1;
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(e.date)}</td>
      <td style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.vendor)}">${esc(e.vendor)}</td>
      <td><span class="badge" style="font-size:9px;">${esc(e.category)}</span></td>
      <td class="acell">${fmtMoney(e.amount)}</td>
      <td><button class="dbtn" data-id="${e.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.dbtn').forEach(b => {
    b.addEventListener('click', async () => {
      await FB.deleteExpense(b.dataset.id);
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
  const list = sortExpenses(A.expenses);
  const rows = [['Date','Vendor','Category','Amount','Tax','Notes','Source'],
    ...list.map(e=>[e.date,csvQ(e.vendor),csvQ(e.category),(e.amount||0).toFixed(2),(e.tax||0).toFixed(2),csvQ(e.notes),e.source||''])];
  dlFile(rows.map(r=>r.join(',')).join('\n'), 'bookkeepai.csv', 'text/csv');
  toast('CSV exported ✅','ok');
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
