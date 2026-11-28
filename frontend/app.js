'use strict';
/* app.js — حالة المشروع، المسرح، اللوحات (المشهد/الشخصية/النصوص/الصوت)، الحفظ والفتح.
   studio.js: الخط الزمني، التشغيل، كتابة القصة، البث. */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wait = ms => new Promise(r => setTimeout(r, ms));
const EMO_META = {
  neutral: ['🙂', 'عادي'], think: ['🤔', 'يفكر'], sassy: ['😏', 'ساخر'], serious: ['😐', 'جاد'], shock: ['😲', 'يتفاجأ'], scared: ['😨', 'خايف'],
  sad: ['😢', 'حزين'], angry: ['😡', 'يغضب'], excited: ['🤩', 'متحمس'], laugh: ['😂', 'يضحك'], scream: ['😱', 'يصرخ'], mocking: ['😆', 'يستهزئ']
};

/* ---------- حالة المشروع ---------- */
function newProject() {
  const aspect = '9:16';
  return {
    v: 2, kind: 'live-studio-project', name: 'مشروع جديد', aspect, bg: { type: 'preset', preset: 'studio' }, desk: true,
    char: { mode: 'builtin', skin: {}, headphones: true, images: {}, svgText: '', layout: { ...Scene.autoLayout(aspect), flip: false } },
    texts: [{ id: 't' + Date.now(), text: 'LIVE', x: .2, y: .07, size: 6, color: '#ff5bd8', font: 'Cairo', glow: true }],
    caps: { on: true, size: 4.2, y: 82, color: '#ffffff', hl: '#ffd34d', box: true },
    voice: { key: '', rate: 1, style: false },
    script: { segments: [], bible: null, topic: '', kind: 'story', tone: 'ساخر وخفيف', dialect: 'بيضاء', len: 16, notes: '' }
  };
}
let P = newProject(), selText = null;
const A = () => Scene.ASPECTS[P.aspect] || Scene.ASPECTS['9:16'];

/* ---------- تخزين تلقائي (IndexedDB) ---------- */
const DB = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('live-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
};
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { DB.set('autosave', JSON.stringify(P)).catch(() => { try { localStorage.setItem('live-studio-autosave', JSON.stringify({ ...P, char: { ...P.char, images: {} }, bg: P.bg.type === 'image' ? { type: 'preset', preset: 'studio' } : P.bg })); } catch (e) { /* ممتلئ */ } }); }, 700); }
function setStatus(t) { $('status').textContent = t; }

/* ---------- المسرح ---------- */
let K = 1;   // معامل التصغير
function fit() {
  const a = A(), area = $('stageArea'), aw = area.clientWidth - 20, ah = area.clientHeight - 20; if (aw <= 0 || ah <= 0) return;
  K = Math.min(aw / a.w, ah / a.h);
  const wrap = $('stageWrap'), st = $('stage');
  wrap.style.width = Math.floor(a.w * K) + 'px'; wrap.style.height = Math.floor(a.h * K) + 'px';
  st.style.width = a.w + 'px'; st.style.height = a.h + 'px'; st.style.transform = `scale(${K})`;
}
new ResizeObserver(fit).observe($('stageArea'));
function renderBg() { $('lyBg').innerHTML = Scene.bgHTML(P.bg, A().w, A().h); }
function renderProps() { const a = A(), d = Scene.autoLayout(P.aspect).deskTop * a.h; $('lyProps').innerHTML = P.desk ? Scene.propsHTML(a.w, a.h, d) : ''; }
function placeChar() {
  const a = A(), L = P.char.layout, S = L.size * a.w, el = $('lyChar');
  el.className = 'layer charbox'; el.style.cssText = `position:absolute;left:${L.cx * a.w - S / 2}px;top:${L.top * a.h}px;width:${S}px;height:${S}px;transform:${L.flip ? 'scaleX(-1)' : 'none'}`;
}
function applyChar() {
  Characters.init($('lyChar')); placeChar(); const impl = Characters.apply(P.char);
  if (impl && impl.error) setStatus('تعذّر تحميل الشخصية، رجعنا للمدمجة: ' + impl.error);
  const info = Characters.impl && Characters.impl.info; $('svInfo').textContent = info ? 'أجزاء وُجدت: ' + (info.found.join('، ') || 'لا شيء') + (info.faces.length ? ' · تعبيرات: ' + info.faces.join('، ') : '') : '';
}
function fontSize(pct) { return pct / 100 * Math.min(A().w, A().h); }
function renderTexts() {
  const lay = $('lyTexts'), a = A(); lay.replaceChildren();
  for (const t of P.texts) {
    const d = document.createElement('div'); d.className = 'tx' + (t.id === selText ? ' sel' : ''); d.textContent = t.text; d.dataset.id = t.id;
    d.style.cssText = `left:${t.x * a.w}px;top:${t.y * a.h}px;font-size:${fontSize(t.size)}px;color:${t.color};font-family:'${t.font}',Cairo,sans-serif;` + (t.glow ? `text-shadow:0 0 ${fontSize(t.size) * .25}px ${t.color},0 0 ${fontSize(t.size) * .6}px ${t.color}` : 'text-shadow:0 2px 6px #0008');
    lay.append(d); drag(d, e0 => ({ x: t.x, y: t.y }), (s, dx, dy) => { t.x = clamp(s.x + dx / a.w, .02, .98); t.y = clamp(s.y + dy / a.h, .02, .98); d.style.left = t.x * a.w + 'px'; d.style.top = t.y * a.h + 'px'; if (t.id === selText) syncTextCtl(); }, () => { chooseText(t.id); save(); });
  }
}
function renderCapStyle() {
  const c = P.caps, lay = $('lyCaps'); let el = lay.querySelector('.cap');
  if (!el) { el = document.createElement('div'); el.className = 'cap'; lay.append(el); }
  el.className = 'cap' + (c.box ? ' box' : ''); el.style.cssText = `top:${c.y}%;font-size:${fontSize(c.size)}px;color:${c.color};font-family:Cairo,sans-serif;transform:translate(-50%,-50%);display:${c.on ? '' : 'none'}`; el.style.setProperty('--hl', c.hl);
  el.querySelectorAll('.hl').forEach(h => h.style.color = c.hl);
}
function setCaption(text, emph) {
  renderCapStyle(); const el = $('lyCaps').querySelector('.cap'); el.replaceChildren(); if (!text) return;
  const ranges = []; for (const w of (emph || [])) { const i = text.indexOf(w); if (w && i >= 0) ranges.push([i, i + w.length]); }
  ranges.sort((x, y) => x[0] - y[0]); let pos = 0;
  for (const [s, e] of ranges) { if (s < pos) continue; el.append(text.slice(pos, s)); const sp = document.createElement('span'); sp.className = 'hl'; sp.style.color = P.caps.hl; sp.textContent = text.slice(s, e); el.append(sp); pos = e; }
  el.append(text.slice(pos));
}
// سحب عنصر على المسرح بإحداثيات التصميم (يعمل بالماوس واللمس)
function drag(el, start, move, end) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return; e.preventDefault(); el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, s = start(e); let moved = false;
    const mv = ev => { const dx = (ev.clientX - sx) / K, dy = (ev.clientY - sy) / K; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; move(s, dx, dy); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (end) end(moved); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
drag($('lyChar'), () => ({ cx: P.char.layout.cx, top: P.char.layout.top }), (s, dx, dy) => { const L = P.char.layout, a = A(); L.cx = clamp(s.cx + dx / a.w, -.2, 1.2); L.top = clamp(s.top + dy / a.h, -.4, 1); placeChar(); syncLayoutCtl(); }, () => save());

/* ---------- تبويبات ---------- */
function openTab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) openTab(b.dataset.tab); });
const bind = (id, fn, ev = 'input') => { const el = $(id); if (el) el.addEventListener(ev, e => fn(el, e)); };

/* ---------- المقاس ---------- */
for (const [k, v] of Object.entries(Scene.ASPECTS)) $('aspect').add(new Option(k + (v.w > v.h ? ' أفقي' : v.w === v.h ? ' مربع' : ' عمودي'), k));
function setAspect(k) {
  const old = Scene.autoLayout(P.aspect); P.aspect = k; const nw = Scene.autoLayout(k), L = P.char.layout;
  // نحافظ على تموضع المستخدم نسبياً: نحسب إزاحته عن الوضع التلقائي القديم ونطبّقها على الجديد
  L.top = +(nw.top + (L.top - old.top)).toFixed(4); L.size = +(nw.size * (L.size / old.size)).toFixed(4);
  fit(); renderBg(); renderProps(); placeChar(); renderTexts(); renderCapStyle(); syncLayoutCtl(); save();
}
bind('aspect', el => setAspect(el.value), 'change');
bind('chkGuides', el => { $('lyGuides').hidden = !el.checked; }, 'change');

/* ---------- المشهد ---------- */
const presetGrid = $('presetGrid');
for (const [k, v] of Object.entries(Scene.PRESETS)) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'preset'; b.dataset.k = k; b.innerHTML = Scene.PRESETS[k].build(180, 320) + '<span></span>'; b.lastChild.textContent = v.name;
  b.onclick = () => { P.bg = { type: 'preset', preset: k }; renderBg(); syncBgCtl(); save(); }; presetGrid.append(b);
}
function showBgOpt(type) { for (const t of ['preset', 'color', 'gradient', 'image']) $('bg' + t[0].toUpperCase() + t.slice(1)).hidden = t !== type; document.querySelectorAll('#bgTypes button').forEach(b => b.classList.toggle('on', b.dataset.bg === type)); }
$('bgTypes').addEventListener('click', e => {
  const b = e.target.closest('button[data-bg]'); if (!b) return; const t = b.dataset.bg; showBgOpt(t);
  if (t === 'color') P.bg = { type: 'color', c1: $('bgC1').value }; else if (t === 'gradient') P.bg = { type: 'gradient', c1: $('bgG1').value, c2: $('bgG2').value, angle: +$('bgAng').value };
  else if (t === 'preset') P.bg = { type: 'preset', preset: P.bg.preset || 'studio' }; else if (P.bg.type !== 'image') return;
  renderBg(); syncBgCtl(); save();
});
bind('bgC1', el => { P.bg = { type: 'color', c1: el.value }; renderBg(); save(); });
const gradUpdate = () => { P.bg = { type: 'gradient', c1: $('bgG1').value, c2: $('bgG2').value, angle: +$('bgAng').value }; $('bgAngV').textContent = P.bg.angle; renderBg(); save(); };
['bgG1', 'bgG2', 'bgAng'].forEach(id => bind(id, gradUpdate));
$('bgPick').onclick = () => $('bgFile').click();
bind('bgFile', async el => {
  const f = el.files[0]; if (!f) return; try {
    P.bg = { type: 'image', src: await Characters.fileToDataURL(f, 1600), fit: $('bgFit').value, dim: +$('bgDim').value / 100, blur: +$('bgBlur').value }; renderBg(); save();
  } catch (e) { setStatus(e.message); } el.value = '';
}, 'change');
const imgUpdate = () => { if (P.bg.type !== 'image') return; P.bg.fit = $('bgFit').value; P.bg.dim = +$('bgDim').value / 100; P.bg.blur = +$('bgBlur').value; $('bgDimV').textContent = $('bgDim').value; $('bgBlurV').textContent = $('bgBlur').value; renderBg(); save(); };
['bgFit', 'bgDim', 'bgBlur'].forEach(id => bind(id, imgUpdate));
bind('chkDesk', el => { P.desk = el.checked; renderProps(); save(); }, 'change');
function syncBgCtl() {
  showBgOpt(P.bg.type); document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', P.bg.type === 'preset' && b.dataset.k === (P.bg.preset || 'studio')));
  if (P.bg.type === 'color') $('bgC1').value = P.bg.c1 || '#101218';
  if (P.bg.type === 'gradient') { $('bgG1').value = P.bg.c1; $('bgG2').value = P.bg.c2; $('bgAng').value = P.bg.angle; $('bgAngV').textContent = P.bg.angle; }
  if (P.bg.type === 'image') { $('bgFit').value = P.bg.fit || 'cover'; $('bgDim').value = Math.round((P.bg.dim || 0) * 100); $('bgBlur').value = P.bg.blur || 0; $('bgDimV').textContent = $('bgDim').value; $('bgBlurV').textContent = $('bgBlur').value; }
  $('chkDesk').checked = P.desk;
}

/* ---------- الشخصية ---------- */
function showCharMode() {
  document.querySelectorAll('#charModes button').forEach(b => b.classList.toggle('on', b.dataset.mode === P.char.mode));
  $('cmBuiltin').hidden = P.char.mode !== 'builtin'; $('cmSprite').hidden = P.char.mode !== 'sprite'; $('cmSvg').hidden = P.char.mode !== 'svg';
}
$('charModes').addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (!b) return; P.char.mode = b.dataset.mode; showCharMode(); applyChar(); save(); });
const skinUpdate = () => { P.char.skin = { head: $('skHead').dataset.set ? $('skHead').value : undefined, line: $('skLine').dataset.set ? $('skLine').value : undefined, led: $('skLed').dataset.set ? $('skLed').value : undefined }; if (P.char.mode === 'builtin') Rig.setSkin({ head: P.char.skin.head, line: P.char.skin.line, led: P.char.skin.led }); save(); };
['skHead', 'skLine', 'skLed'].forEach(id => bind(id, el => { el.dataset.set = '1'; skinUpdate(); }));
bind('skHp', el => { P.char.headphones = el.checked; if (P.char.mode === 'builtin') Rig.setHeadphones(el.checked); save(); }, 'change');
$('skReset').onclick = () => { P.char.skin = {}; ['skHead', 'skLine', 'skLed'].forEach(id => delete $(id).dataset.set); $('skHead').value = '#ffffff'; $('skLine').value = '#0b0a14'; $('skLed').value = '#4aa3ff'; Rig.setSkin({ head: null, line: null, led: null }); save(); };

const SLOTS = [...Characters.EMOS, 'talk'];
function renderSlots() {
  const g = $('spGrid'); g.replaceChildren();
  for (const e of SLOTS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'spslot' + (P.char.images[e] ? ' has' : ''); b.dataset.slot = e;
    if (P.char.images[e]) { const im = document.createElement('img'); im.src = P.char.images[e]; im.alt = ''; b.append(im); }
    const sp = document.createElement('span'); sp.textContent = (e === 'talk' ? '👄 ' : (EMO_META[e][0] + ' ')) + Characters.EMO_LABEL[e]; b.append(sp); g.append(b);
  }
}
let slotTarget = null;
$('spGrid').addEventListener('click', e => { const b = e.target.closest('.spslot'); if (!b) return; slotTarget = b.dataset.slot; const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { if (inp.files[0]) await addSprites([[inp.files[0], slotTarget]]); }; inp.click(); });
$('spPickMany').onclick = () => $('spFiles').click();
async function addSprites(pairs) {
  let skipped = 0;
  for (const [file, forced] of pairs) {
    let slot = forced || Characters.guessEmotion(file.name);
    if (!slot) { slot = !P.char.images.neutral ? 'neutral' : null; }
    if (!slot) { skipped++; continue; }
    try { P.char.images[slot] = await Characters.fileToDataURL(file, 1024); } catch (e) { skipped++; }
  }
  P.char.mode = 'sprite'; showCharMode(); renderSlots(); applyChar(); save();
  setStatus(skipped ? `تم رفع الصور. تعذّر تحديد انفعال ${skipped} ملف/ملفات، اضغط الخانة المناسبة لرفعها يدوياً.` : 'تم رفع صور الشخصية');
}
bind('spFiles', async el => { await addSprites([...el.files].map(f => [f, null])); el.value = ''; }, 'change');
$('spClear').onclick = () => { P.char.images = {}; renderSlots(); applyChar(); save(); };
$('svPick').onclick = () => $('svFile').click();
bind('svFile', async el => {
  const f = el.files[0]; if (!f) return; el.value = '';
  try { const text = await f.text(); Characters.sanitizeSvg(text); P.char.svgText = text; P.char.mode = 'svg'; showCharMode(); applyChar(); save(); }
  catch (e) { setStatus('ملف SVG غير صالح: ' + e.message); }
}, 'change');

function syncLayoutCtl() {
  const L = P.char.layout, auto = Scene.autoLayout(P.aspect);
  $('lySize').value = Math.round(L.size / auto.size * 100); $('lySizeV').textContent = $('lySize').value; $('lyX').value = Math.round(L.cx * 100); $('lyY').value = Math.round(L.top * 100); $('lyFlip').checked = !!L.flip;
}
bind('lySize', el => { const L = P.char.layout, auto = Scene.autoLayout(P.aspect), old = L.size; L.size = +(auto.size * el.value / 100).toFixed(4); L.top += (old - L.size) * .8 * A().w / A().h; $('lySizeV').textContent = el.value; placeChar(); syncLayoutCtl(); save(); });
bind('lyX', el => { P.char.layout.cx = el.value / 100; placeChar(); save(); });
bind('lyY', el => { P.char.layout.top = el.value / 100; placeChar(); save(); });
bind('lyFlip', el => { P.char.layout.flip = el.checked; placeChar(); save(); }, 'change');
$('lyAuto').onclick = () => { const a = Scene.autoLayout(P.aspect); Object.assign(P.char.layout, { cx: .5, top: a.top, size: a.size }); if (!P.desk) { P.char.layout.top = +(1 - a.size * A().w / A().h).toFixed(4); } placeChar(); syncLayoutCtl(); save(); };

function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const safeName = s => (s || 'live').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'live';
function cleanImages(obj) { const out = {}; for (const [k, v] of Object.entries(obj || {})) if (typeof v === 'string' && v.startsWith('data:image/')) out[k] = v; return out; }
$('pkExport').onclick = () => download(safeName(P.name) + '.livechar.json', JSON.stringify({ kind: 'live-character-pack', v: 1, char: { mode: P.char.mode, skin: P.char.skin, headphones: P.char.headphones, images: P.char.images, svgText: P.char.svgText } }));
$('pkImport').onclick = () => $('pkFile').click();
bind('pkFile', async el => {
  const f = el.files[0]; if (!f) return; el.value = '';
  try {
    const d = JSON.parse(await f.text()); if (d.kind !== 'live-character-pack' || !d.char) throw new Error('هذا ليس ملف حزمة شخصية');
    if (d.char.svgText) Characters.sanitizeSvg(d.char.svgText);
    Object.assign(P.char, { mode: ['builtin', 'sprite', 'svg'].includes(d.char.mode) ? d.char.mode : 'builtin', skin: d.char.skin || {}, headphones: d.char.headphones !== false, images: cleanImages(d.char.images), svgText: d.char.svgText || '' });
    syncAll(); applyChar(); save(); setStatus('تم استيراد الشخصية');
  } catch (e) { setStatus('تعذّر الاستيراد: ' + e.message); }
}, 'change');

/* ---------- النصوص والترجمة ---------- */
function chooseText(id) { selText = id; renderTextList(); renderTexts(); syncTextCtl(); openTab('scene'); }
function renderTextList() {
  const l = $('txtList'); l.replaceChildren();
  for (const t of P.texts) { const b = document.createElement('button'); b.type = 'button'; b.className = t.id === selText ? 'on' : ''; b.textContent = t.text || '(فارغ)'; b.onclick = () => chooseText(t.id); l.append(b); }
  $('txtCtl').hidden = !P.texts.some(t => t.id === selText);
}
const curText = () => P.texts.find(t => t.id === selText);
function syncTextCtl() {
  const t = curText(); if (!t) return; $('txtVal').value = t.text; $('txtColor').value = t.color; $('txtFont').value = t.font; $('txtSize').value = t.size; $('txtSizeV').textContent = t.size; $('txtX').value = Math.round(t.x * 100); $('txtY').value = Math.round(t.y * 100); $('txtGlow').checked = !!t.glow;
}
$('txtAdd').onclick = () => { const t = { id: 't' + Date.now(), text: 'نص جديد', x: .5, y: .5, size: 6, color: '#ffffff', font: 'Cairo', glow: false }; P.texts.push(t); chooseText(t.id); save(); };
bind('txtVal', el => { const t = curText(); if (t) { t.text = el.value; renderTextList(); renderTexts(); save(); } });
bind('txtColor', el => { const t = curText(); if (t) { t.color = el.value; renderTexts(); save(); } });
bind('txtFont', el => { const t = curText(); if (t) { t.font = el.value; renderTexts(); save(); } }, 'change');
bind('txtSize', el => { const t = curText(); if (t) { t.size = +el.value; $('txtSizeV').textContent = el.value; renderTexts(); save(); } });
bind('txtX', el => { const t = curText(); if (t) { t.x = el.value / 100; renderTexts(); save(); } });
bind('txtY', el => { const t = curText(); if (t) { t.y = el.value / 100; renderTexts(); save(); } });
bind('txtGlow', el => { const t = curText(); if (t) { t.glow = el.checked; renderTexts(); save(); } }, 'change');
$('txtDel').onclick = () => { P.texts = P.texts.filter(t => t.id !== selText); selText = null; renderTextList(); renderTexts(); save(); };
const capUpdate = () => { Object.assign(P.caps, { on: $('capOn').checked, size: +$('capSize').value, y: +$('capY').value, color: $('capColor').value, hl: $('capHl').value, box: $('capBox').checked }); renderCapStyle(); save(); };
['capOn', 'capSize', 'capY', 'capColor', 'capHl', 'capBox'].forEach(id => bind(id, capUpdate, id === 'capOn' || id === 'capBox' ? 'change' : 'input'));

/* ---------- الصوت ---------- */
// يملأ قائمة أصوات مجمّعة حسب اللغة/اللهجة. withDefault: خيار «الصوت الافتراضي للمشروع»
function fillVoiceSelect(sel, withDefault, cur) {
  sel.replaceChildren(); const list = Voice.listVoices(), groups = new Map();
  if (withDefault) sel.add(new Option('↩ الصوت الافتراضي للمشروع', ''));
  list.forEach(v => { if (!groups.has(v.group)) { const g = document.createElement('optgroup'); g.label = v.group; groups.set(v.group, g); sel.append(g); } groups.get(v.group).append(new Option(v.label, v.key)); });
  sel.value = list.some(v => v.key === cur) || (withDefault && !cur) ? (cur || '') : (withDefault ? '' : (list[0] ? list[0].key : ''));
  return list;
}
function fillVoiceChoices() {
  const list = Voice.listVoices(), gsel = $('voiceGroup'), vsel = $('voiceSel'), groups = [...new Set(list.map(v => v.group))];
  gsel.replaceChildren(...groups.map(g => new Option(g, g)));
  const curV = list.find(v => v.key === P.voice.key) || list[0];
  if (!curV) { vsel.replaceChildren(new Option('لا توجد أصوات (ستعمل الحركة بدون صوت)', '')); return list; }
  gsel.value = curV.group; fillGroupVoices(list); vsel.value = curV.key; P.voice.key = vsel.value; return list;
}
function fillGroupVoices(list) { list = list || Voice.listVoices(); const g = $('voiceGroup').value; $('voiceSel').replaceChildren(...list.filter(v => v.group === g).map(v => new Option(v.label, v.key))); }
function refreshVoiceList() {
  const list = fillVoiceChoices();
  if (typeof showSegEditor === 'function') showSegEditor();
  const info = $('voiceInfo');
  if (Voice.serverOn) { info.className = 'banner ok'; info.textContent = 'أصوات عصبية متاحة بلهجات عربية كثيرة ولغات أخرى. اختر اللغة/اللهجة ثم الصوت. صوت المتصفح موجود في آخر قائمة اللغات.'; }
  else if (list.length) { info.className = 'banner warn'; info.textContent = 'الأصوات العصبية غير متاحة الآن، والمتاح فقط أصوات جهازك (جودتها تعتمد على الجهاز). لأصوات عصبية مرخّصة للاستخدام التجاري أضف AZURE_SPEECH_KEY و AZURE_SPEECH_REGION في Render (يوجد مستوى مجاني).'; }
  else { info.className = 'banner warn'; info.textContent = 'جهازك لا يحوي صوتاً عربياً. ثبّت صوتاً عربياً من إعدادات النظام (تحويل النص إلى كلام)، أو فعّل صوت الخادم.'; }
}
bind('voiceGroup', () => { fillGroupVoices(); const v = $('voiceSel').value; if (v) { P.voice.key = v; save(); if (typeof showSegEditor === 'function') showSegEditor(); } }, 'change');
bind('voiceSel', el => { P.voice.key = el.value; save(); }, 'change');
bind('voiceStyle', el => { P.voice.style = el.checked; save(); }, 'change');
bind('rate', el => { P.voice.rate = +el.value; $('rateV').textContent = (+el.value).toFixed(2); save(); });
$('voiceTest').onclick = async () => {
  Voice.unlock(); Characters.pose('neutral'); Characters.speaking(true); const info = $('voiceInfo'); info.className = 'banner'; info.textContent = 'جارٍ تجهيز الصوت…';
  await Voice.speak(Voice.sampleFor(P.voice.key) || 'أهلاً بكم، هذا صوتي في الاستوديو. جرّبوا السرعة التي تناسب القصة.', { voice: P.voice.key, rate: P.voice.rate, onLevel: v => Characters.level(v) }); Characters.speaking(false);
  if (Voice.last.engine === 'server') { info.className = 'banner ok'; info.textContent = '✅ تكلّم بالصوت العصبي المختار.'; }
  else if (Voice.last.engine === 'browser' && /^s:/.test(P.voice.key)) { info.className = 'banner warn'; info.textContent = '⚠️ ' + (Voice.last.error || 'تعذّر الصوت العصبي') + ' (اضغط «فحص الصوت» لمعرفة السبب).'; }
};
$('voiceCheck').onclick = async () => { const o = $('voiceDiag'); o.hidden = false; o.textContent = 'جارٍ الفحص…'; try { const v = P.voice.key.startsWith('s:') ? P.voice.key.slice(2) : 'ar-SY-LaithNeural'; const r = await (await fetch('/api/tts/check?voice=' + encodeURIComponent(v))).json(); o.textContent = Object.entries(r).map(([k, x]) => k + ': ' + x).join('\n'); } catch (e) { o.textContent = 'تعذّر الفحص: ' + e.message; } };
Voice.onWarn = msg => { setStatus('⚠️ ' + msg); const i = $('voiceInfo'); i.className = 'banner warn'; i.textContent = '⚠️ ' + msg; };
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = refreshVoiceList;

/* ---------- مزامنة الواجهة مع المشروع ---------- */
function syncAll() {
  $('projName').value = P.name; $('aspect').value = P.aspect; showCharMode(); syncBgCtl(); syncLayoutCtl(); renderSlots(); renderTextList(); if (!selText && P.texts[0]) selText = P.texts[0].id; syncTextCtl();
  $('skHead').value = P.char.skin.head || '#ffffff'; $('skLine').value = P.char.skin.line || '#0b0a14'; $('skLed').value = P.char.skin.led || '#4aa3ff'; $('skHp').checked = P.char.headphones !== false;
  const c = P.caps; $('capOn').checked = c.on; $('capSize').value = c.size; $('capY').value = c.y; $('capColor').value = c.color; $('capHl').value = c.hl; $('capBox').checked = c.box;
  $('voiceStyle').checked = !!P.voice.style; $('rate').value = P.voice.rate; $('rateV').textContent = (+P.voice.rate).toFixed(2); refreshVoiceList();
  if (typeof syncStoryCtl === 'function') syncStoryCtl();
}
function renderAll() { fit(); renderBg(); renderProps(); applyChar(); renderTexts(); renderCapStyle(); setCaption('', []); if (typeof renderTimeline === 'function') renderTimeline(); }

/* ---------- مشروع: جديد / حفظ / فتح ---------- */
bind('projName', el => { P.name = el.value; save(); });
$('btnSave').onclick = () => download(safeName(P.name) + '.livestudio.json', JSON.stringify(P));
$('btnOpen').onclick = () => $('fileOpen').click();
bind('fileOpen', async el => {
  const f = el.files[0]; if (!f) return; el.value = '';
  try { loadProject(JSON.parse(await f.text())); setStatus('تم فتح المشروع'); } catch (e) { setStatus('ملف مشروع غير صالح: ' + e.message); }
}, 'change');
function loadProject(d) {
  if (!d || d.kind !== 'live-studio-project') throw new Error('هذا ليس ملف مشروع Live Studio');
  const base = newProject(); if (d.char && d.char.svgText) Characters.sanitizeSvg(d.char.svgText);
  P = { ...base, ...d, char: { ...base.char, ...(d.char || {}), images: cleanImages(d.char && d.char.images), layout: { ...base.char.layout, ...((d.char || {}).layout || {}) } }, caps: { ...base.caps, ...(d.caps || {}) }, voice: { ...base.voice, ...(d.voice || {}) }, script: { ...base.script, ...(d.script || {}) } };
  if (!Scene.ASPECTS[P.aspect]) P.aspect = '9:16';
  if (P.bg.type === 'image' && !String(P.bg.src || '').startsWith('data:image/')) P.bg = { type: 'preset', preset: 'studio' };
  if (!Array.isArray(P.texts)) P.texts = base.texts; selText = null; stopPlayback && stopPlayback();
  syncAll(); renderAll(); save();
}
$('btnNew').onclick = () => { if (confirm('بدء مشروع جديد؟ لن يُحفظ ما لم تنزّله بزر «حفظ».')) { P = newProject(); selText = null; stopPlayback && stopPlayback(); syncAll(); renderAll(); save(); } };

/* ---------- إقلاع ---------- */
(async function boot() {
  try { const raw = await DB.get('autosave'); if (raw) { const d = JSON.parse(raw); if (d && d.kind === 'live-studio-project') { const base = newProject(); P = { ...base, ...d, char: { ...base.char, ...d.char, images: cleanImages(d.char && d.char.images), layout: { ...base.char.layout, ...((d.char || {}).layout || {}) } }, caps: { ...base.caps, ...d.caps }, voice: { ...base.voice, ...d.voice }, script: { ...base.script, ...d.script } }; if (!Scene.ASPECTS[P.aspect]) P.aspect = '9:16'; } } } catch (e) { /* مشروع جديد */ }
  await Voice.init(); syncAll(); renderAll(); window.addEventListener('resize', fit); setTimeout(fit, 60);
  document.fonts && document.fonts.ready.then(() => { renderTexts(); });
})();
