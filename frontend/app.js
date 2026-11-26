'use strict';
/* ============================================================
   Live Studio
   1) الشخصية (Puppet): مفاصل ووجه تتحكم فيها متغيرات CSS
   2) فهم النص: يحلل كل جملة ويحدد الانفعال (يضحك، يصرخ، يفكر…)
   3) الأداء: يمثّل الانفعال بالجسم + الوجه + الصوت + المؤثرات
   ============================================================ */
const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wait = ms => new Promise(r => setTimeout(r, ms));
const bubble = $('bubble'), statusEl = $('status'), feed = $('feed'), character = $('character');

/* ---------- 1) الشخصية: الرسم والمحرك في rig.js ---------- */
Rig.mount(character);

// بيانات الانفعالات للصوت والواجهة. الوضعية الجسدية لكل انفعال معرّفة داخل rig.js (POSES).
const EMOTIONS = {
  neutral: { label: 'عادي',   emoji: '🙂', vocal: { pitch: 1,    rate: 1    } },
  laugh:   { label: 'يضحك',   emoji: '😂', vocal: { pitch: 1.25, rate: 1.1  }, post: 'ها ها ها ها ها', sfx: 'laugh' },
  scream:  { label: 'يصرخ',   emoji: '😱', vocal: { pitch: 1.8,  rate: 1.25 }, pre: 'آآآآآآه!', sfx: 'scream' },
  shock:   { label: 'يتفاجأ', emoji: '😲', vocal: { pitch: 1.5,  rate: 1.05 }, pre: 'هاااا؟!', sfx: 'shock' },
  angry:   { label: 'يغضب',   emoji: '😡', vocal: { pitch: 0.65, rate: 1.2  }, sfx: 'angry' },
  think:   { label: 'يفكر',   emoji: '🤔', vocal: { pitch: 0.9,  rate: 0.85 }, post: 'ممممم…', sfx: 'think' },
  sad:     { label: 'حزين',   emoji: '😢', vocal: { pitch: 0.75, rate: 0.8  }, post: 'آه…', sfx: 'sad' },
  scared:  { label: 'خايف',   emoji: '😨', vocal: { pitch: 1.6,  rate: 1.2  }, pre: 'أووه!', sfx: 'scared' },
  sassy:   { label: 'ساخر',   emoji: '😏', vocal: { pitch: 1.1,  rate: 0.95 }, sfx: 'sassy' },
  excited: { label: 'متحمس',  emoji: '🤩', vocal: { pitch: 1.3,  rate: 1.2  }, sfx: 'excited' },
  serious: { label: 'جاد',    emoji: '😐', vocal: { pitch: 0.8,  rate: 0.95 } },
  mocking: { label: 'يستهزئ', emoji: '😆', vocal: { pitch: 1.35, rate: 1.1  }, post: 'ها ها', sfx: 'laugh' }
};
let curEmo = 'neutral', beatTimer = null;
function applyPose(name) { curEmo = EMOTIONS[name] ? name : 'neutral'; Rig.pose(curEmo); }
function startBeats() { stopBeats(); Rig.beat(); beatTimer = setInterval(Rig.beat, 750); }
function stopBeats() { clearInterval(beatTimer); beatTimer = null; Rig.rest(); }
function floatFx() { Rig.fx(); }

/* ---------- مؤثرات صوتية (WebAudio، بدون ملفات) ---------- */
let actx = null;
function ac() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, t0, dur, o = {}) {
  const c = ac(); if (!c) return;
  const osc = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0, gain = o.gain || 0.12;
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.slide) osc.frequency.linearRampToValueAtTime(freq + o.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(c.destination);
  osc.start(t); osc.stop(t + dur + 0.05);
}
const SFX = {
  laugh()   { [0, .14, .28, .42].forEach((t, i) => tone(520 + i * 35, t, .1, { type: 'square', gain: .05 })); },
  scream()  { tone(500, 0, .8, { type: 'sawtooth', gain: .06, slide: 1000 }); tone(520, 0, .8, { type: 'square', gain: .03, slide: 1050 }); },
  shock()   { tone(180, 0, .25, { type: 'triangle', gain: .2 }); tone(150, .02, .4, { type: 'sawtooth', gain: .05 }); },
  think()   { tone(330, 0, .18); tone(392, .22, .18); tone(311, .44, .3); },
  sad()     { tone(392, 0, .3, { type: 'triangle', slide: -30 }); tone(349, .35, .3, { type: 'triangle', slide: -30 }); tone(294, .7, .7, { type: 'triangle', slide: -70 }); },
  angry()   { tone(90, 0, .6, { type: 'sawtooth', gain: .12, slide: -25 }); },
  scared()  { [0, .09, .18, .27, .36].forEach(t => tone(700, t, .07, { gain: .06, slide: 60 })); },
  excited() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .09, .14, { type: 'triangle' })); },
  sassy()   { tone(440, 0, .12, { type: 'triangle' }); tone(554, .14, .25, { type: 'triangle', slide: -120 }); }
};
const sfxOn = () => $('optSfx') ? $('optSfx').checked : true;
const vocalOn = () => $('optVocal') ? $('optVocal').checked : true;
function sfx(name) { if (sfxOn() && SFX[name]) try { SFX[name](); } catch (e) { /* الصوت غير مدعوم */ } }

/* ---------- الكلام ---------- */
const voicePicker = $('voiceSelect'), rateSlider = $('voiceRate');
let selectedVoice = null, runId = 0;

function refreshVoices() {
  if (!voicePicker || !('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices().filter(v => /^ar([-_]|$)/i.test(v.lang));
  voicePicker.replaceChildren();
  if (!vs.length) { voicePicker.add(new Option('لا توجد أصوات عربية على الجهاز', '')); return; }
  vs.forEach(v => voicePicker.add(new Option(v.name + ' · ' + v.lang, v.name)));
  selectedVoice = vs[0]; voicePicker.value = vs[0].name;
}
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = refreshVoices; refreshVoices(); }
if (voicePicker) voicePicker.onchange = () => selectedVoice = speechSynthesis.getVoices().find(v => v.name === voicePicker.value) || null;
if (rateSlider) rateSlider.oninput = () => $('rateLabel').textContent = rateSlider.value + '×';

// ينطق نص ويحرك الفم أثناء النطق. يرجع Promise ينتهي بنهاية الكلام (أو بمدة تقديرية لو ما فيه صوت).
function speak(text, vocal, id) {
  return new Promise(resolve => {
    const t0 = Date.now(), minDur = text.length * 45;
    let done = false, guard;
    const finish = () => {
      if (done) return; done = true; clearTimeout(guard);
      Rig.speaking(false); resolve();
    };
    const finishPaced = () => {                     // لا نسمح بالمرور أسرع من سرعة القراءة
      const el = Date.now() - t0;
      if (id !== runId || el >= minDur) finish(); else setTimeout(finish, minDur - el);
    };
    Rig.speaking(true);
    if (!('speechSynthesis' in window)) { setTimeout(finish, text.length * 70); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = selectedVoice?.lang || 'ar-SA';
    if (selectedVoice) u.voice = selectedVoice;
    u.rate = clamp(Number(rateSlider?.value || 1) * (vocal.rate || 1), 0.5, 2);
    u.pitch = clamp(vocal.pitch || 1, 0, 2);
    u.volume = 1;
    u.onend = finishPaced;
    u.onerror = () => { if (id !== runId) finish(); else setTimeout(finish, Math.max(0, text.length * 65 - (Date.now() - t0))); };
    guard = setTimeout(finish, text.length * 180 + 4000);   // لو المحرك علّق
    speechSynthesis.speak(u);
  });
}
function cancelAll() {
  runId++; stopBeats();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  Rig.speaking(false);
}

/* ---------- 2) فهم النص ---------- */
const NORM = s => s.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// s = كلمات قوية (٢ نقطة)، w = كلمات ضعيفة (١ نقطة). تُكتب بأي لهجة؛ المطابقة على جزء الكلمة.
const LEX_RAW = {
  laugh:   { s: ['ههه', 'ها ها', 'ضحك', 'مضحك', 'قهقه', 'نكتة', 'lol', '😂', '🤣'], w: ['طريف', 'مسخرة', 'سخيف', 'ظريف', 'هزل', 'كوميد', 'تهريج', 'فضيحة'] },
  scream:  { s: ['صرخ', 'صراخ', 'يصيح', 'النجدة', 'نجدة', 'ساعدوني', 'انقذوني', 'يا ساتر'], w: ['انفجر', 'كارثة', 'مصيبة'] },
  shock:   { s: ['فجأة', 'مفاجأة', 'صدمة', 'مستحيل', 'معقول', 'ما صدق', 'غير معقول', 'لا يصدق', 'ذهول', 'تفاجأ', 'فاجأ', 'اكتشف', 'ما كان متوقع', 'ما توقع'], w: ['غريب', 'عجيب', 'طلع', 'ظهر', 'مصدوم', 'لحظة', 'يعني كل'] },
  angry:   { s: ['غبي', 'زبالة', 'خرا', 'stupid', 'غضب', 'غاضب', 'عصب', 'مجنون', 'ظلم', 'خيانة', 'كذاب', 'وقح', 'قهر', 'غش', 'سرق', 'احتيال', 'يكره', 'استفز', 'طرد'], w: ['زعل', 'رفض', 'هدد', 'لعن', 'حقير', 'مشكلة', 'سيء', 'سيئ'] },
  think:   { s: ['فكر', 'يا ترى', 'تخيل', 'لغز', 'غموض', 'محتار', 'حيرة', 'رأيكم', 'توقعوا', 'ليش', 'لماذا'], w: ['كيف', 'سر', 'ربما', 'احتمال', 'يمكن', 'سؤال', 'خطة', 'فكرة'] },
  sad:     { s: ['حزن', 'حزين', 'بكى', 'بكاء', 'دموع', 'فقد', 'وفاة', 'مات', 'رحل', 'فراق', 'حسرة', 'ندم', 'وحيد'], w: ['خسر', 'خسارة', 'للأسف', 'فشل', 'ضاع', 'انتهى', 'موجع', 'مؤلم', 'يائس', 'تعب'] },
  scared:  { s: ['خوف', 'خايف', 'خائف', 'رعب', 'مرعب', 'مخيف', 'شبح', 'وحش', 'يرتجف', 'ارتجف', 'مطاردة', 'قاتل', 'ظلام', 'مرعوب'], w: ['هرب', 'هروب', 'اختبأ', 'خطر', 'جريمة', 'صوت غريب'] },
  sassy:   { s: ['يا سلام', 'بثقة', 'عبقري', 'تحفة', 'يا شيخ', 'ما شاء الله عليك', 'مغرور', 'أنا الأفضل'], w: ['طبعا', 'أكيد', 'بطل', 'واو', 'ذكي', 'عظمة', 'بصراحة', 'صراحة'] },
  excited: { s: ['رائع', 'مدهش', 'مذهل', 'مبهر', 'فاز', 'فوز', 'نجح', 'نجاح', 'مبروك', 'انتصار', 'جائزة', 'احتفال', 'يحتفل', 'حماس', 'متحمس', 'احبك', 'love', '❤'], w: ['أخيرا', 'ممتاز', 'ربح', 'كسب', 'يلا', 'هيا', 'حب'] }
};
const mk = list => new RegExp(list.map(x => esc(NORM(x))).join('|'), 'g');
const LEX = {};
for (const [e, o] of Object.entries(LEX_RAW)) LEX[e] = { s: mk(o.s), w: mk(o.w) };

// توجيهات المخرج اليدوية: [يصرخ] (يضحك) *يفكر*
const DIRECT_RAW = {
  scream: 'يصرخ|صراخ|صرخة|scream|shout', laugh: 'يضحك|ضحك|ضحكة|laugh', think: 'يفكر|تفكير|يتأمل|think|hmm',
  angry: 'يغضب|غضب|يعصب|يزعل|angry', sad: 'يبكي|حزين|حزن|يتنهد|sad|cry', shock: 'يتفاجأ|صدمة|يصدم|ذهول|shock|gasp',
  scared: 'يخاف|خوف|يرتجف|مرعوب|scared', serious: 'يجد|جاد|جدي|serious', mocking: 'يسخر|سخرية|يستهزئ|استهزاء|mock', sassy: 'يتباهى|ساخر|يغمز|sassy|smirk', excited: 'يحتفل|يتحمس|حماس|يقفز|excited|cheer'
};
const DIRECT = {};
for (const [e, p] of Object.entries(DIRECT_RAW)) DIRECT[e] = new RegExp(NORM(p));
function directive(inner) {
  const t = NORM(inner);
  for (const e of Object.keys(DIRECT)) if (DIRECT[e].test(t)) return e;
  return null;
}

const TONE_BIAS = [
  [/ساخر/, { sassy: 1, laugh: .5 }], [/حماس/, { excited: 1 }],
  [/هادئ/, { think: .7 }], [/هجومي/, { angry: .8, sassy: .7 }]
];
function toneBias(tone) { for (const [re, b] of TONE_BIAS) if (re.test(tone || '')) return b; return {}; }

function hits(re, t, cap) { const m = t.match(re); return Math.min(m ? m.length : 0, cap); }
function analyze(text, tone) {
  const t = NORM(text), sc = {};
  for (const e of Object.keys(LEX)) sc[e] = hits(LEX[e].s, t, 3) * 2 + hits(LEX[e].w, t, 3);
  const add = (e, v) => sc[e] = (sc[e] || 0) + v;
  if (/ه{3,}/.test(t)) add('laugh', 3);                       // هههههه
  if (/(ا{3,}|ي{3,}|و{3,})/.test(t)) add('scream', 2.5);      // ياااا / آآآ
  const ex = (t.match(/!/g) || []).length;
  if (ex >= 1) { add('excited', .6); add('scream', .6); }
  if (ex >= 2) add('scream', 1);
  if (/[؟?]/.test(t)) add('think', 1.2);
  if (/…|\.\.\./.test(t)) { add('think', .4); add('sad', .3); }
  for (const [e, v] of Object.entries(toneBias(tone))) add(e, v);
  let best = 'neutral', top = 1.5;
  for (const e of Object.keys(EMOTIONS)) if ((sc[e] || 0) > top) { best = e; top = sc[e]; }
  return { emotion: best, scores: sc };
}

/* يحول النص الكامل إلى مقاطع {text, emotion, forced} جاهزة للأداء */
function parseScript(raw, tone) {
  const out = []; let carry = null;
  for (const row of raw.split(/\n+/)) {
    let line = row.trim(); if (!line) continue;
    let forced = carry; carry = null;
    line = line.replace(/\[([^\]]*)\]|\(([^)]*)\)|\*([^*]*)\*/g, (m, a, b, c) => {
      const emo = directive(a ?? b ?? c ?? '');
      if (emo) { forced = emo; return ' '; }
      return a !== undefined ? ' ' : m;                      // [أي عنوان مشهد] ما ينقرأ
    });
    line = line.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/ه{3,}/g, 'ها ها ها').replace(/\s+/g, ' ').trim();
    if (!line || !/[\p{L}\p{N}]/u.test(line)) { if (forced) carry = forced; continue; }
    const sentences = [];
    for (const s of line.split(/(?<=[.!؟?…])\s+/)) {
      if (s.length <= 140) { sentences.push(s); continue; }
      let cur = '';                                          // جمل طويلة جداً: نقسمها عند الفاصلة
      for (const part of s.split(/(?<=[،,])\s*/)) { if ((cur + part).length > 120 && cur) { sentences.push(cur); cur = part; } else cur += (cur ? ' ' : '') + part; }
      if (cur) sentences.push(cur);
    }
    sentences.forEach((s, i) => {
      const emo = (i === 0 && forced) ? forced : analyze(s, tone).emotion;
      out.push({ text: s, emotion: emo, forced: i === 0 && !!forced, pause: /…$/.test(s) ? 550 : 260 });
    });
  }
  return out;
}

/* ---------- 3) الأداء ---------- */
// مقطع واحد: الوجه والجسم يتغيران قبل الكلام، وصوت الانفعال يطلع قبل/بعد الجملة حسب نوعه
async function playSegment(seg, id) {
  const E = EMOTIONS[seg.emotion] || EMOTIONS.neutral;
  applyPose(seg.emotion); floatFx(seg.emotion); sfx(E.sfx);
  if (E.pre && vocalOn()) { startBeats(); await speak(E.pre, E.vocal, id); if (id !== runId) return; }
  startBeats();
  await speak(seg.text, E.vocal, id);
  if (id !== runId) return;
  if (E.post && vocalOn()) { await speak(E.post, E.vocal, id); if (id !== runId) return; }
  stopBeats();
  await wait(seg.pause + (seg.emotion === 'shock' || seg.emotion === 'scream' ? 250 : 0));
}
function idle() { stopBeats(); applyPose('neutral'); }

async function performScript(text, tone) {
  cancelAll(); const id = runId;
  const segs = parseScript(text, tone);
  const box = $('narration'); box.hidden = false;
  if (!segs.length) { $('segment').textContent = 'اكتب سيناريو أولاً.'; return; }
  statusEl.textContent = 'يؤدي المشهد…';
  await wait(90);                                            // Chrome يتجاهل speak() بعد cancel() مباشرة
  for (let i = 0; i < segs.length; i++) {
    if (id !== runId) return;
    const s = segs[i], E = EMOTIONS[s.emotion];
    $('segment').textContent = s.text; bubble.textContent = s.text;
    $('progress').textContent = 'المقطع ' + (i + 1) + ' من ' + segs.length + ' · ' + E.emoji + ' ' + E.label + (s.forced ? ' (توجيه)' : '');
    document.querySelectorAll('#reactmap .chip').forEach((c, k) => c.classList.toggle('now', k === i));
    await playSegment(s, id);
  }
  if (id !== runId) return;
  idle(); bubble.textContent = 'خلصنا!'; $('progress').textContent = 'اكتمل السرد الصوتي'; statusEl.textContent = 'جاهز';
  document.querySelectorAll('#reactmap .chip.now').forEach(c => c.classList.remove('now'));
}

// تجربة سريعة لانفعال واحد (أزرار خريطة التفاعل + أزرار الشخصيات)
function demo(emotion) {
  cancelAll(); const id = runId;
  applyPose(emotion); floatFx(emotion); sfx(EMOTIONS[emotion].sfx); startBeats();
  setTimeout(() => { if (id === runId) idle(); }, 1800);
}

/* ---------- 4) الواجهة ---------- */
let kind = 'story';
document.querySelectorAll('.type').forEach(b => b.onclick = () => {
  kind = b.dataset.type; document.querySelectorAll('.type').forEach(x => x.classList.toggle('active', x === b));
});
document.querySelectorAll('.app-tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.app-tab').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.app-panel').forEach(x => x.hidden = x.id !== b.dataset.panel);
});

function renderMap() {
  const map = $('reactmap'); if (!map) return;
  const segs = parseScript($('script').value, $('tone').value);
  map.replaceChildren();
  segs.forEach(s => {
    const E = EMOTIONS[s.emotion], b = document.createElement('button');
    b.className = 'chip'; b.dataset.e = s.emotion; b.title = s.text;
    b.innerHTML = '<span></span><small></small>';
    b.firstChild.textContent = E.emoji + ' ' + E.label; b.lastChild.textContent = s.text;
    b.onclick = () => demo(s.emotion);
    map.append(b);
  });
}
function showScript(text) {
  $('script').value = text; $('scriptbox').hidden = false; $('narration').hidden = true; renderMap();
}
$('script').addEventListener('input', renderMap);
$('tone').addEventListener('change', renderMap);

function makeScript(topic, type) {
  topic = topic || 'موضوع ممتع نكتشفه معاً';
  if (type === 'story') return 'اسمعوا القصة هذي عن ' + topic + '.\n\nالبداية: كل شيء كان يبدو عادياً، ولا أحد كان يتوقع أن تتحول الأمور بهذا الشكل. بس استنوا شوي… لأن التفاصيل القادمة هي اللي تغيّر القصة.\n\n[يتفاجأ] وفجأة بدأت المفاجآت تظهر واحدة وراء الثانية، وكل ما ظنّوا أن الموضوع انتهى، طلع في شيء جديد!\n\n[يصرخ] يا جماعة، ما كان أحد مصدق اللي شافه!\n\n[يفكر] أما النهاية؟ فهي الجزء اللي لازم تسمعوه للآخر. شو رأيكم، كان ممكن تتصرفوا بطريقة مختلفة؟';
  if (type === 'commentary') return 'خلّونا نحلّل ' + topic + '.\n\nبصراحة، في تفاصيل هنا تستحق الوقفة. خلّونا نفصل اللي صار ونشوف وين كانت المفاجأة.\n\n[يتفاجأ] لحظة، هذا اللي صار فعلاً؟\n\n[يفكر] شو رأيكم أنتم؟';
  return 'يا جماعة خلّونا نشوف ' + topic + '!\n\n[يتفاجأ] أنا مو مستوعب اللي صار بصراحة…\n\n[يضحك] هههه خلّونا نشوف المشهد ونحكم!';
}
$('draft').onclick = () => { showScript(makeScript($('topic').value.trim(), kind)); bubble.textContent = 'جهزت السيناريو. عدّله أو اضغط عرض السرد.'; applyPose('think'); setTimeout(idle, 1200); };
$('copy').onclick = () => navigator.clipboard.writeText($('script').value);

const funStorySeeds = [
  { topic: 'موظف حاول يهرب من اجتماع طويل', plot: 'قرر الموظف أن يختفي خمس دقائق، لكن نظام الشركة سجّل خروجه على أنه استقالة رسمية. وبعد سلسلة محاولات لإصلاح الموقف، صار مطلوباً منه تقديم عرض عن «فن الاختفاء» أمام المدير.', twist: 'المفاجأة أن المدير كان يبحث عن طريقة يهرب فيها من الاجتماع نفسه.' },
  { topic: 'روبوت دخل مسابقة طبخ', plot: 'روبوت قرر يثبت أنه شيف، فقرأ الوصفات حرفياً وخلط مقادير كل الوصفات في قدر واحد. بدأ يشرح بثقة علمية، بينما المطبخ صار ساحة تجارب.', twist: 'لما تذوق الحكم الطبق اكتشف أنه فطور وغداء وعشاء… في لقمة واحدة.' },
  { topic: 'قط صار مدير بناية', plot: 'سكان البناية انتخبوا القط مديراً بعد أن كان الوحيد الذي يراقب المشاكل. بدأ بإصدار قرارات غريبة، منع الأصوات بعد منتصف الليل وفرض رسوماً على فتح علب التونة.', twist: 'أول اعتراض رسمي كان من قط آخر، وقدّم الطلب على ورق ممزق.' },
  { topic: 'شخص طلب من الذكاء الاصطناعي تنظيم حياته', plot: 'طلب جدولاً بسيطاً، فصار لديه جدول للنوم وجدول لجدول النوم. حاول الالتزام، وكلما أنجز مهمة ظهرت له ثلاث مهام إضافية.', twist: 'في النهاية حذف التطبيق، فأرسل له إشعاراً: «مهمة حذف التطبيق: مكتملة، مبروك!»' }
];
function makeFunScript(seed) {
  return '🎬 عنوان الحلقة: ' + seed.topic + '\n\n[افتتاحية]\nاسمعوا هذه… ' + seed.topic + '. وأنا من البداية عندي إحساس إن الموضوع ما رح ينتهي بشكل طبيعي.\n\n[المشهد الأول — يتحمس]\n' + seed.plot +
    '\n\n[تصعيد — يصرخ]\nلحظة! يعني كل هذا كان الحل؟ لا، لا، لا!\n\n[يفكر] طيب استنوا… خلونا نشوف كيف وصلت الأمور لهذه المرحلة؟\n\n[الذروة — يتفاجأ]\n' + seed.twist +
    '\n\n[يضحك] هههه! مين كان يتوقع؟\n\n[خاتمة — يفكر]\nأنا عندي أسئلة أكثر من الإجابات، لكن أهم سؤال: لو كنت مكانه، شو كنت عملت؟ اكتبوا رأيكم، ونلتقي بقصة أغرب!';
}
$('funStory').onclick = () => {
  const seed = funStorySeeds[Math.floor(Math.random() * funStorySeeds.length)];
  $('topic').value = seed.topic; showScript(makeFunScript(seed));
  bubble.textContent = 'جهزت قصة كوميدية بتفاعلات جاهزة، عدّلها قبل الأداء.'; demo('laugh');
};

$('perform').onclick = () => { ac(); performScript($('script').value, $('tone').value); };   // ac(): تفعيل الصوت بنقرة المستخدم
$('stop').onclick = () => { cancelAll(); idle(); statusEl.textContent = 'جاهز'; $('progress').textContent = 'تم الإيقاف'; document.querySelectorAll('#reactmap .chip.now').forEach(c => c.classList.remove('now')); };

/* ---------- Live: تعليقات المشاهدين ---------- */
const MODES = ['Funny', 'Sassy', 'Serious', 'Furious', 'Freaked Out', 'Mocking'];
const MODE_EMO = { Funny: 'laugh', Sassy: 'sassy', Serious: 'serious', Furious: 'angry', 'Freaked Out': 'scared', Mocking: 'mocking' };
let current = 'Funny';
const modes = $('modes');
MODES.forEach(m => {
  const b = document.createElement('button'); b.textContent = m;
  b.onclick = () => {
    current = m; ac(); demo(MODE_EMO[m]); bubble.textContent = 'تم تغيير الشخصية: ' + m;
    document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('active', x.textContent === m));
    fetch('/api/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) }).catch(() => {});
  };
  modes.append(b);
});

const REPLIES = {
  laugh:   ['أضحك معك ولا على مستوى الثقة بالتعليق؟', 'هههه والله ضحكتني! كمّل كمّل!'],
  scream:  ['يا ساتر! ليش كل هذا الصراخ في التعليقات؟!', 'لحظة لحظة، خففوا علي!'],
  angry:   ['وصل النقد يا ناقد القرن. عندك ملاحظة مفيدة ولا خلصنا من فقرة الصياح؟'],
  think:   ['سؤال محترم… خليني أفكر.'],
  shock:   ['لحظة لحظة! مين وافق على هذا المشهد؟ أنا كنت جاي أعلّق مو أتعالج!'],
  sad:     ['يا حبيبي ليش هالحزن… خلينا نرجع نضحك شوي.'],
  scared:  ['لا تخوفوني! أنا أصلاً كنت جاي أرتاح!'],
  excited: ['أخيراً تعليق يرفع المعنويات… لا تخربها وتطلب أغنية!'],
  sassy:   ['يا سلام على التعليق… داخل علينا بثقة وكأنك دفعت إيجار الاستوديو!'],
  neutral: ['يا سلام على التعليق… داخل علينا بثقة وكأنك دفعت إيجار الاستوديو!']
};
function reactTo(msg) {
  let emotion = analyze(msg).emotion;
  let reply = REPLIES[emotion][Math.floor(Math.random() * REPLIES[emotion].length)];
  if (emotion === 'neutral') emotion = 'sassy';
  if (emotion === 'think') reply += ' ' + msg;
  if (current === 'Furious') { emotion = 'angry'; reply = 'يا حبيبي ' + reply + ' خفّ علينا شوي!'; }
  else if (current === 'Serious') { emotion = 'serious'; reply = 'خلينا نركز: ' + msg + '. هذه نقطة تستحق نقاشاً فعلاً.'; }
  else if (current === 'Mocking') { emotion = 'mocking'; reply = 'واو… ' + msg + '. استغرق منك وقت طويل لتكتب هذه التحفة؟'; }
  else if (current === 'Freaked Out') { emotion = 'scared'; }
  return { emotion, reply };
}
function handleComment(msg) {
  if (!msg.trim() || !feed) return;
  const { emotion, reply } = reactTo(msg);
  bubble.textContent = reply;
  const item = document.createElement('div'); item.className = 'feeditem';
  item.innerHTML = '<div class="viewer"></div><div class="reply"></div><div class="emotion"></div>';
  item.querySelector('.viewer').textContent = '💬 ' + msg;
  item.querySelector('.reply').textContent = 'Live: ' + reply;
  item.querySelector('.emotion').textContent = 'ردة الفعل: ' + EMOTIONS[emotion].emoji + ' ' + EMOTIONS[emotion].label;
  feed.replaceChildren(item); feed.scrollTop = feed.scrollHeight;
  ac(); cancelAll();                                         // يرد بصوته مع التفاعل
  const id = runId;
  playSegment({ text: reply, emotion, pause: 200 }, id).then(() => { if (id === runId) idle(); });
  fetch('/api/chat/mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg }) }).catch(() => {});
}
const send = $('send'), chat = $('chat');
send.onclick = () => { handleComment(chat.value); chat.value = ''; };
chat.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });

fetch('/api/state').then(r => r.json()).then(d => { statusEl.textContent = 'Backend connected · mock reactions active'; current = d.mode || current; })
  .catch(() => { statusEl.textContent = 'جاهز للعرض التجريبي'; });
