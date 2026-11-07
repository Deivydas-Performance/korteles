const APP_VERSION = '9'; // rodoma formoje, kad matytųsi, ar užkrauta naujausia versija
const KEY = 'korteles.v1';
const PALETTE = ['#2563eb', '#dc2626', '#15803d', '#7c3aed', '#c2410c', '#0f766e', '#be185d', '#374151'];
const $ = (id) => document.getElementById(id);

let cards = [];
try { cards = JSON.parse(localStorage.getItem(KEY)) || []; } catch { cards = []; }
let editingId = null;
let viewingId = null;
let wakeLock = null;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cards)); } catch {} };

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// Tekstas ant kortelės spalvos: balta arba tamsi, pagal geresnį kontrastą (WCAG formulė).
function textOn(hex) {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0597 ? '#ffffff' : '#111827';
}

function resolveFormat(card) {
  if (card.format !== 'auto') return card.format;
  if (/^\d{13}$/.test(card.code)) return 'EAN13';
  if (/^[\x20-\x7e]+$/.test(card.code) && card.code.length <= 40) return 'CODE128';
  return 'QR';
}

// ---------- Sąrašas ----------
function render() {
  const q = $('search').value.trim().toLowerCase();
  // dažniausiai / neseniai naudotos viršuje, kitos – pagal abėcėlę
  const list = cards
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name, 'lt'));
  $('list').replaceChildren(...list.map((c) => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.style.background = c.color;
    b.style.color = textOn(c.color);
    const name = Object.assign(document.createElement('span'), { className: 'tile__name', textContent: c.name });
    const sub = Object.assign(document.createElement('span'), { className: 'tile__sub', textContent: c.notes || c.code });
    b.append(name, sub);
    b.onclick = () => openView(c.id);
    return b;
  }));
  $('empty').hidden = cards.length > 0;
}

// ---------- Kodo piešimas ----------
function drawQr(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  $('viewQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

// grąžina formatą, kuriuo kodas realiai nupieštas
function drawCode(card) {
  const wanted = resolveFormat(card);
  const canvas = $('viewBarcode');
  $('viewQr').replaceChildren();
  canvas.style.display = 'none';
  if (wanted !== 'QR') {
    try {
      JsBarcode(canvas, card.code, { format: wanted, width: 3, height: 110, displayValue: false, margin: 0 });
      canvas.style.display = '';
      canvas.setAttribute('aria-label', `Brūkšninis kodas ${card.code}`);
      return wanted;
    } catch { /* netinkamas kodas pasirinktam formatui – rodom kaip QR */ }
  }
  drawQr(card.code);
  return 'QR';
}

async function openView(id) {
  const c = cards.find((x) => x.id === id);
  if (!c) return;
  viewingId = id;
  c.lastUsed = Date.now();
  save();
  $('viewName').textContent = c.name;
  $('viewCode').textContent = c.code;
  $('viewNotes').textContent = c.notes || '';
  $('viewNotes').hidden = !c.notes;
  $('viewCard').style.borderTop = `8px solid ${c.color}`;
  const used = drawCode(c);
  const wanted = resolveFormat(c);
  $('viewHint').textContent = used !== wanted
    ? `Kodas netinka formatui ${wanted}, todėl rodomas kaip QR. Pakeisk tipą redaguodamas.`
    : 'Jei nenuskaito, padidink ekrano ryškumą.';
  disarmDelete();
  $('view').showModal();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

$('view').addEventListener('close', () => {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  render(); // atnaujinam eiliškumą (paskutinė naudota – viršuje)
});
$('viewClose').onclick = () => $('view').close();
// palietimas už kortelės ribų uždaro langą
for (const d of ['view', 'edit']) {
  $(d).addEventListener('click', (e) => { if (e.target === $(d)) $(d).close(); });
}

// Ištrynimas dviem paspaudimais: pirmas „užsimoja“, antras ištrina.
let armTimer;
function disarmDelete() {
  clearTimeout(armTimer);
  const b = $('viewDelete');
  b.classList.remove('is-armed');
  b.textContent = 'Ištrinti';
}
$('viewDelete').onclick = () => {
  const b = $('viewDelete');
  if (!b.classList.contains('is-armed')) {
    b.classList.add('is-armed');
    b.textContent = 'Tikrai ištrinti?';
    armTimer = setTimeout(disarmDelete, 3000);
    return;
  }
  const c = cards.find((x) => x.id === viewingId);
  cards = cards.filter((x) => x.id !== viewingId);
  save();
  disarmDelete();
  $('view').close();
  toast(`„${c?.name}“ ištrinta`);
};

// ---------- Redagavimas ----------
function setColor(hex) {
  $('form').color.value = hex;
  for (const el of $('swatches').children) {
    if (el.classList.contains('swatch')) el.setAttribute('aria-pressed', String(el.dataset.color === hex));
  }
  const custom = $('swatches').querySelector('input[type=color]');
  if (custom) custom.value = hex;
}
function buildSwatches() {
  const box = $('swatches');
  for (const hex of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hex;
    b.dataset.color = hex;
    b.setAttribute('aria-label', `Spalva ${hex}`);
    b.onclick = () => setColor(hex);
    box.append(b);
  }
  const custom = Object.assign(document.createElement('input'), { type: 'color', value: PALETTE[0] });
  custom.setAttribute('aria-label', 'Kita spalva');
  custom.oninput = () => setColor(custom.value);
  box.append(custom);
}

function openEdit(id) {
  editingId = id || null;
  const c = cards.find((x) => x.id === id);
  const f = $('form');
  $('editTitle').textContent = c ? 'Redaguoti kortelę' : 'Nauja kortelė';
  f.name.value = c?.name ?? '';
  f.code.value = c?.code ?? '';
  f.format.value = c?.format ?? 'auto';
  f.notes.value = c?.notes ?? '';
  setColor(c?.color ?? PALETTE[0]);
  $('scanMsg').textContent = `v${APP_VERSION}`;
  $('edit').showModal();
}

$('add').onclick = () => openEdit(null);
$('editCancel').onclick = () => $('edit').close();
$('viewEdit').onclick = () => { const id = viewingId; $('view').close(); openEdit(id); };

$('form').addEventListener('submit', () => {
  const f = $('form');
  const data = {
    name: f.name.value.trim(), code: f.code.value.trim(),
    format: f.format.value, color: f.color.value, notes: f.notes.value.trim(),
  };
  if (editingId) {
    cards = cards.map((c) => (c.id === editingId ? { ...c, ...data } : c));
  } else {
    cards.push({ id: uid(), ...data });
  }
  save();
  render();
  toast('Išsaugota');
});

$('search').addEventListener('input', render);

$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'suvalkas.json' });
  a.click();
  URL.revokeObjectURL(url);
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  try {
    const imported = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(imported)) throw new Error();
    const known = new Set(cards.map((c) => c.id));
    const fresh = imported.filter((c) => c.id && c.name && c.code && c.color && !known.has(c.id));
    cards.push(...fresh);
    save(); render(); $('edit').close();
    toast(`Importuota kortelių: ${fresh.length}`);
  } catch { toast('Netinkamas failas'); }
  e.target.value = '';
};

// ---------- Nuskaitymas ----------
const NATIVE_FMT = { qr_code: 'QR', code_128: 'CODE128', ean_13: 'EAN13', ean_8: 'EAN8', upc_a: 'UPC', code_39: 'CODE39' };
const ZX = window.ZXing;
const ZX_FMT = ZX && {
  [ZX.BarcodeFormat.QR_CODE]: 'QR', [ZX.BarcodeFormat.CODE_128]: 'CODE128', [ZX.BarcodeFormat.EAN_13]: 'EAN13',
  [ZX.BarcodeFormat.EAN_8]: 'EAN8', [ZX.BarcodeFormat.UPC_A]: 'UPC', [ZX.BarcodeFormat.CODE_39]: 'CODE39',
};

function applyScan({ code, format }, how) {
  $('form').code.value = code;
  $('form').format.value = format;
  $('scanMsg').textContent = `${how}: ${code}`;
  if (!$('form').name.value) $('form').name.focus(); // belieka įrašyti pavadinimą
}

function loadImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}

async function decodeCanvas(canvas) {
  if ('BarcodeDetector' in window) {
    try {
      const res = await new BarcodeDetector().detect(canvas);
      if (res.length) return { code: res[0].rawValue, format: NATIVE_FMT[res[0].format] || 'auto' };
    } catch {}
  }
  if (ZX) {
    const hints = new Map([[ZX.DecodeHintType.TRY_HARDER, true]]);
    const reader = new ZX.BrowserMultiFormatReader(hints);
    try {
      const r = await reader.decodeFromImageUrl(canvas.toDataURL('image/png'));
      return { code: r.getText(), format: ZX_FMT[r.getBarcodeFormat()] || 'auto' };
    } catch {}
  }
  return null;
}

async function scanFile(file) {
  // bandom kelis dydžius – ekrano nuotraukos dažnai geriau nuskaitomos sumažintos
  for (const side of [1600, 1000, 2400, 600]) {
    const found = await decodeCanvas(await loadImage(file, side));
    if (found) return found;
  }
  return null;
}

// Jei paveikslėlyje nėra brūkšninio kodo, skaitom atspausdintą numerį (OCR, kraunasi tik prireikus).
let ocrWorker = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.append(s);
  });
}
async function ocrNumber(file) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng');
    await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '11' });
  }
  for (const side of [1600, 2400]) {
    const { data } = await ocrWorker.recognize(await loadImage(file, side));
    const runs = (data.text.match(/\d[\d ]{6,}\d/g) || []).map((t) => t.replace(/\s+/g, ''));
    runs.sort((a, b) => b.length - a.length);
    if (runs[0] && runs[0].length >= 8) return runs[0];
  }
  return null;
}

$('scan').onclick = () => $('scanFile').click();
$('scanCam').onclick = () => $('scanCamFile').click();
async function onScanPicked(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const msg = $('scanMsg');
  msg.textContent = 'Skenuoju…';
  try {
    const found = await scanFile(file);
    if (found) { applyScan(found, 'Rasta'); return; }
    msg.textContent = 'Brūkšninio kodo nerasta, ieškau numerio tekste… (reikia interneto)';
    let num = null, err = '';
    try { num = await ocrNumber(file); } catch (ex) { err = ` [OCR klaida: ${ex?.message || ex}]`; }
    if (!num) { msg.textContent = `Nei kodo, nei numerio nerasta.${err} Pabandyk ryškesnę nuotrauką arba įvesk ranka.`; return; }
    applyScan({ code: num, format: 'auto' }, 'Perskaitytas numeris');
    msg.textContent += ' — patikrink, ar sutampa su kortele.';
  } catch (ex) { msg.textContent = `Nepavyko perskaityti paveikslėlio. [${ex?.message || ex}]`; }
}
$('scanFile').onchange = onScanPicked;
$('scanCamFile').onchange = onScanPicked;

// ---------- Paleidimas ----------
window.addEventListener('error', (e) => { $('scanMsg').textContent = `Klaida: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => { $('scanMsg').textContent = `Klaida: ${e.reason?.message || e.reason}`; });

buildSwatches();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
