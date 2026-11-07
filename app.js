const APP_VERSION = '5'; // rodoma formoje, kad matytųsi, ar užkrauta naujausia versija
const KEY = 'korteles.v1';
const $ = (id) => document.getElementById(id);

let cards = [];
try { cards = JSON.parse(localStorage.getItem(KEY)) || []; } catch { cards = []; }
let editingId = null;
let viewingId = null;
let wakeLock = null;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cards)); } catch {} };

function resolveFormat(card) {
  if (card.format !== 'auto') return card.format;
  if (/^\d{13}$/.test(card.code)) return 'EAN13';
  if (/^[\x20-\x7e]+$/.test(card.code) && card.code.length <= 40) return 'CODE128';
  return 'QR';
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const list = cards
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'lt'));
  $('list').replaceChildren(...list.map((c) => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.style.background = c.color;
    const name = document.createElement('span');
    name.textContent = c.name;
    const small = document.createElement('small');
    small.textContent = c.notes || c.code;
    b.append(name, small);
    b.onclick = () => openView(c.id);
    return b;
  }));
  $('empty').hidden = cards.length > 0;
}

function drawCode(card) {
  const fmt = resolveFormat(card);
  const canvas = $('viewBarcode');
  const qr = $('viewQr');
  qr.replaceChildren();
  canvas.style.display = 'none';
  if (fmt === 'QR') {
    const q = qrcode(0, 'M');
    q.addData(card.code);
    q.make();
    qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    return;
  }
  canvas.style.display = '';
  try {
    JsBarcode(canvas, card.code, { format: fmt, width: 3, height: 110, displayValue: false, margin: 0 });
  } catch {
    // netinkamas kodas pasirinktam formatui – rodom kaip QR
    canvas.style.display = 'none';
    const q = qrcode(0, 'M');
    q.addData(card.code);
    q.make();
    qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  }
}

async function openView(id) {
  const c = cards.find((x) => x.id === id);
  if (!c) return;
  viewingId = id;
  $('viewName').textContent = c.name;
  $('viewCode').textContent = c.code;
  $('viewNotes').textContent = c.notes || '';
  $('viewCard').style.borderTop = `8px solid ${c.color}`;
  drawCode(c);
  $('view').showModal();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

$('view').addEventListener('close', () => { wakeLock?.release?.().catch(() => {}); wakeLock = null; });
$('viewClose').onclick = () => $('view').close();

function openEdit(id) {
  editingId = id || null;
  const c = cards.find((x) => x.id === id);
  const f = $('form');
  $('editTitle').textContent = c ? 'Redaguoti kortelę' : 'Nauja kortelė';
  f.name.value = c?.name ?? '';
  f.code.value = c?.code ?? '';
  f.format.value = c?.format ?? 'auto';
  f.color.value = c?.color ?? '#2563eb';
  f.notes.value = c?.notes ?? '';
  $('edit').showModal();
}

$('add').onclick = () => openEdit(null);
$('editCancel').onclick = () => $('edit').close();
$('viewEdit').onclick = () => { const id = viewingId; $('view').close(); openEdit(id); };
$('viewDelete').onclick = () => {
  const c = cards.find((x) => x.id === viewingId);
  if (c && confirm(`Ištrinti „${c.name}“?`)) {
    cards = cards.filter((x) => x.id !== viewingId);
    save(); render(); $('view').close();
  }
};

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
  save(); render();
});

$('search').addEventListener('input', render);

$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'korteles.json' });
  a.click();
  URL.revokeObjectURL(url);
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  try {
    const imported = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(imported)) throw new Error();
    const known = new Set(cards.map((c) => c.id));
    cards.push(...imported.filter((c) => c.id && c.name && c.code && !known.has(c.id)));
    save(); render(); $('edit').close();
  } catch { alert('Netinkamas failas'); }
  e.target.value = '';
};

// ---- Nuskaitymas iš nuotraukos ----
const NATIVE_FMT = { qr_code: 'QR', code_128: 'CODE128', ean_13: 'EAN13', ean_8: 'EAN8', upc_a: 'UPC', code_39: 'CODE39' };
const ZX = window.ZXing;
const ZX_FMT = ZX && {
  [ZX.BarcodeFormat.QR_CODE]: 'QR', [ZX.BarcodeFormat.CODE_128]: 'CODE128', [ZX.BarcodeFormat.EAN_13]: 'EAN13',
  [ZX.BarcodeFormat.EAN_8]: 'EAN8', [ZX.BarcodeFormat.UPC_A]: 'UPC', [ZX.BarcodeFormat.CODE_39]: 'CODE39',
};

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
$('scanFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const msg = $('scanMsg');
  msg.textContent = 'Skenuoju…';
  try {
    const found = await scanFile(file);
    if (!found) {
      msg.textContent = 'Brūkšninio kodo nerasta, ieškau numerio tekste… (reikia interneto)';
      let num = null, err = '';
      try { num = await ocrNumber(file); } catch (ex) { err = ` [OCR klaida: ${ex?.message || ex}]`; }
      if (!num) { msg.textContent = `Nei kodo, nei numerio nerasta.${err} Pabandyk ryškesnę nuotrauką arba įvesk ranka.`; return; }
      $('form').code.value = num;
      $('form').format.value = 'auto';
      msg.textContent = `Perskaitytas numeris: ${num}. Patikrink, ar sutampa su kortele.`;
      return;
    }
    $('form').code.value = found.code;
    $('form').format.value = found.format;
    msg.textContent = `Rasta: ${found.code}`;
  } catch (ex) { msg.textContent = `Nepavyko perskaityti paveikslėlio. [${ex?.message || ex}]`; }
};

$('scanMsg').textContent = `v${APP_VERSION}`;
window.addEventListener('error', (e) => { $('scanMsg').textContent = `Klaida: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => { $('scanMsg').textContent = `Klaida: ${e.reason?.message || e.reason}`; });
$('edit').addEventListener('close', () => { $('scanMsg').textContent = `v${APP_VERSION}`; });

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
