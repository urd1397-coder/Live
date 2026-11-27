'use strict';
/* character.js — مدير الشخصيات: واجهة موحّدة فوق ثلاثة أنواع
   1) builtin : الشخصية الخطية المدمجة (rig.js) بتخصيص ألوان
   2) sprite  : صورة واحدة أو صورة لكل انفعال (+ صورة "فم مفتوح" اختيارية) مع حركة إجرائية
   3) svg     : ملف SVG جاهز يتبع عقد بسيط (data-live / id) وتُحرَّك أجزاؤه
   الواجهة: apply(cfg) · pose(emo, intensity) · beat() · rest() · speaking(on) · level(v) · fx() */
const Characters = (() => {
  const EMOS = ['neutral', 'think', 'sassy', 'serious', 'shock', 'scared', 'sad', 'angry', 'excited', 'laugh', 'scream', 'mocking'];
  const EMO_LABEL = { neutral: 'عادي', think: 'يفكر', sassy: 'ساخر', serious: 'جاد', shock: 'يتفاجأ', scared: 'خايف', sad: 'حزين', angry: 'يغضب', excited: 'متحمس', laugh: 'يضحك', scream: 'يصرخ', mocking: 'يستهزئ', talk: 'فم مفتوح (أثناء الكلام)' };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let host = null, impl = null, cfg = { mode: 'builtin' }, raf = 0;

  // تخمين الانفعال من اسم الملف: laugh.png / ضحك.png / happy ...
  const NAME_HINTS = [
    ['laugh', /laugh|funny|happy|lol|ضحك|يضحك|مضحك|سعيد/i], ['scream', /scream|shout|yell|صراخ|يصرخ|صرخ/i], ['shock', /shock|surpris|wow|صدم|تفاج|مفاجأ/i],
    ['angry', /angry|furious|mad|rage|غضب|يغضب|غاضب|عصب/i], ['think', /think|idle|hmm|تفكير|يفكر|حيرة/i], ['sad', /sad|cry|حزن|حزين|يبكي|بكاء/i],
    ['scared', /scare|fear|freak|خوف|خايف|خائف|رعب/i], ['sassy', /sass|smirk|ساخر|سخرية|غمز/i], ['excited', /excit|cheer|joy|حماس|متحمس|فرح/i],
    ['serious', /serious|جاد|جدي/i], ['mocking', /mock|tease|استهزاء|يستهزئ/i], ['talk', /talk|speak|open|mouth|كلام|يتكلم|فم/i], ['neutral', /neutral|default|normal|base|عادي|افتراضي/i]
  ];
  function guessEmotion(name) { for (const [e, re] of NAME_HINTS) if (re.test(name)) return e; return null; }

  // تصغير الصورة وتحويلها إلى WebP مع الحفاظ على الشفافية حتى لا يصير المشروع ثقيلاً
  function fileToDataURL(file, maxSide = 1024) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL('image/webp', .92));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('تعذّر قراءة الصورة')); };
      img.src = url;
    });
  }

  /* ---------- زنبرك مشترك ---------- */
  const mkP = (names) => Object.fromEntries(names.map(n => [n, { x: 0, v: 0, t: 0 }]));
  const spring = (p, dt, K = 150, C = 15) => { const a = (p.t - p.x) * K - p.v * C; p.v += a * dt; p.x += p.v * dt; };

  /* ---------- 1) المدمجة ---------- */
  function builtin(c) {
    Rig.mount(host);
    Rig.setSkin(c.skin || {}); Rig.setHeadphones(c.headphones !== false);
    return {
      pose: (e, i) => Rig.pose(e, i), beat: () => Rig.beat(), rest: () => Rig.rest(), speaking: on => Rig.speaking(on),
      level: v => Rig.level(v), fx: () => Rig.fx(), destroy: () => Rig.unmount()
    };
  }

  /* ---------- 2) Sprite ---------- */
  const SPR = {
    neutral: { rot: 0, ty: 0, sx: 1, sy: 1, m: 'idle' }, think: { rot: -4, tx: -12, sy: .99, m: 'sway' }, sassy: { rot: 5, tx: 8, m: 'sway' },
    serious: { sy: .985, m: 'still' }, shock: { sy: 1.07, sx: .97, jump: -60, m: 'idle' }, scared: { sx: .97, ty: 6, m: 'tremble' },
    sad: { ty: 16, sy: .95, rot: 3, m: 'droop' }, angry: { rot: 2, sx: 1.04, sy: .98, m: 'shake' }, excited: { sy: 1.03, m: 'bounce' },
    laugh: { rot: -3, m: 'laugh' }, scream: { sy: 1.06, sx: .96, m: 'shake2' }, mocking: { rot: 6, m: 'laugh' }
  };
  function sprite(c) {
    host.insertAdjacentHTML('beforeend', '<div class="spr"><img class="spr-img" alt="" draggable="false"></div>');
    const wrap = host.querySelector('.spr'), img = wrap.querySelector('img'), imgs = c.images || {};
    const P = mkP(['tx', 'ty', 'rot', 'sx', 'sy']); P.sx.x = P.sx.t = P.sy.x = P.sy.t = 1;
    let emo = 'neutral', inten = 1, speakOn = false, lvl = null, fxPulse = 0, t0 = performance.now(), cur = '', alive = true, nextOpen = 0, open = 0, jump = 0, jumpV = 0;
    const src = e => imgs[e] || imgs.neutral || '';
    function show(e) { const s = (e === 'talk' ? imgs.talk : src(e)) || src('neutral'); if (s !== cur) { cur = s; img.src = s; } }
    show('neutral');
    function pose(e, i) {
      emo = EMOS.includes(e) ? e : 'neutral'; inten = i == null ? 1 : .45 + .55 * clamp(i, 0, 1);
      const S = SPR[emo], k = inten;
      P.rot.t = (S.rot || 0) * k; P.tx.t = (S.tx || 0) * k; P.ty.t = (S.ty || 0) * k; P.sx.t = 1 + ((S.sx || 1) - 1) * k; P.sy.t = 1 + ((S.sy || 1) - 1) * k;
      if (S.jump) jumpV = S.jump * 14 * k;
      fxPulse = 1; show(emo);
    }
    function frame(now) {
      if (!alive || !wrap.isConnected) return;
      const dt = Math.min(.033, (now - t0) / 1000); t0 = now; const T = now / 1000;
      for (const k of Object.keys(P)) spring(P[k], dt);
      jumpV += 1600 * dt * (jump < 0 ? 1 : 0); jump += jumpV * dt; if (jump > 0) { jump = 0; jumpV = 0; }
      const m = SPR[emo].m; let bx = 0, by = Math.sin(T * 1.6) * 3, br = 0, bs = 1;
      if (m === 'laugh') { by = -Math.abs(Math.sin(T * 9)) * 14 * inten; br = Math.sin(T * 9) * 2.5; }
      else if (m === 'bounce') by = -Math.abs(Math.sin(T * 6)) * 16 * inten;
      else if (m === 'shake') bx = Math.sin(T * 38) * 3 * inten;
      else if (m === 'shake2') bx = Math.sin(T * 62) * 3.5 * inten;
      else if (m === 'tremble') bx = Math.sin(T * 55) * 2 * inten;
      else if (m === 'sway') br = Math.sin(T * 1.6) * 2.2;
      else if (m === 'droop') by = 8 + Math.sin(T * 1.1) * 2;
      else if (m === 'still') by = Math.sin(T * 1.2) * 1.2;
      if (speakOn) {
        if (lvl == null && T > nextOpen) { open = Math.random() < .2 ? .1 : rnd(.3, 1); nextOpen = T + rnd(.07, .16); }
        const l = lvl == null ? open : lvl; bs = 1 + .03 * l; by -= 3 * l;
        if (imgs.talk) show(l > .35 ? 'talk' : emo);
      } else if (imgs.talk && cur === imgs.talk) show(emo);
      wrap.style.transform = `translate(${(P.tx.x + bx).toFixed(1)}px,${(P.ty.x + by + jump).toFixed(1)}px) rotate(${(P.rot.x + br).toFixed(2)}deg) scale(${(P.sx.x * bs).toFixed(3)},${(P.sy.x * bs).toFixed(3)})`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      pose, beat() { P.rot.t += rnd(-1.2, 1.2); }, rest() { pose(emo, inten); }, speaking(on) { speakOn = !!on; if (!on) lvl = null; },
      level(v) { lvl = v == null ? null : clamp(v, 0, 1); }, fx() { jumpV = -500; }, destroy() { alive = false; cancelAnimationFrame(raf); wrap.remove(); }
    };
  }

  /* ---------- 3) ملف SVG جاهز ---------- */
  function sanitizeSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('الملف ليس SVG صالحاً');
    doc.querySelectorAll('script,foreignObject,iframe,object,embed,audio,video,style[media],link').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(el => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'xlink:href') && !(v.startsWith('#') || v.startsWith('data:image/'))) el.removeAttribute(a.name);
        else if (/url\(\s*['"]?\s*(https?:|\/\/|javascript:)/i.test(a.value)) el.removeAttribute(a.name);
      }
    });
    doc.querySelectorAll('style').forEach(st => { st.textContent = st.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?\s*(https?:|\/\/)[^)]*\)/gi, 'none'); });
    return new XMLSerializer().serializeToString(root);
  }
  const SVG_POSE = {  // أي جزء ناقص في الملف يُتجاهل. الزوايا بالدرجات، الإزاحة بوحدات الـ viewBox/100
    neutral: {}, think: { hr: -7, aL: 6, aR: 55 }, sassy: { hr: 9, aR: 18 }, serious: { hy: 1 }, shock: { hy: -3, aL: 28, aR: -28, jump: 1 }, scared: { aL: 22, aR: -22, m: 'tremble' },
    sad: { hr: 7, hy: 3 }, angry: { aL: 30, aR: -30, m: 'shake' }, excited: { aL: 40, aR: -40, m: 'bounce' }, laugh: { hr: -8, m: 'laugh' }, scream: { aL: 45, aR: -45, hy: -2, m: 'shake2' }, mocking: { hr: -10, aR: 25, m: 'laugh' }
  };
  function svgChar(c) {
    host.insertAdjacentHTML('beforeend', '<div class="svgchar"></div>');
    const wrap = host.querySelector('.svgchar'); wrap.innerHTML = sanitizeSvg(c.svgText || '');
    const svgEl = wrap.querySelector('svg'); svgEl.removeAttribute('width'); svgEl.removeAttribute('height'); svgEl.style.cssText = 'width:100%;height:100%;overflow:visible';
    const q = k => svgEl.querySelector(`[data-live="${k}"],#live-${k}`);
    const parts = { head: q('head'), body: q('body'), aL: q('arm-l'), aR: q('arm-r'), mouth: q('mouth'), mouthOpen: q('mouth-open'), eyes: q('eyes') };
    const faces = Object.fromEntries(EMOS.map(e => [e, q('face-' + e)]).filter(([, el]) => el));
    const fxs = Object.fromEntries(EMOS.map(e => [e, q('fx-' + e)]).filter(([, el]) => el));
    const piv = {};
    for (const [k, el] of Object.entries(parts)) if (el) {
      const bb = el.getBBox(), pv = (el.getAttribute('data-pivot') || '').split(',').map(Number);
      piv[k] = pv.length === 2 && pv.every(Number.isFinite) ? pv : (k === 'aL' || k === 'aR' ? [bb.x + bb.width / 2, bb.y] : k === 'head' ? [bb.x + bb.width / 2, bb.y + bb.height] : [bb.x + bb.width / 2, bb.y + bb.height / 2]);
    }
    const vb = svgEl.viewBox.baseVal, unit = (vb && vb.height ? vb.height : 600) / 100;
    const P = mkP(['hr', 'hy', 'aL', 'aR', 'by', 'bx', 'br']);
    let emo = 'neutral', inten = 1, speakOn = false, lvl = null, alive = true, t0 = performance.now(), nextOpen = 0, open = 0, nextBlink = 2, blink0 = -9, jump = 0, jumpV = 0;
    const setT = (el, tr) => el && el.setAttribute('transform', tr);
    const rot = (k, a) => `rotate(${a.toFixed(2)} ${piv[k][0]} ${piv[k][1]})`;
    function pose(e, i) {
      emo = EMOS.includes(e) ? e : 'neutral'; inten = i == null ? 1 : .45 + .55 * clamp(i, 0, 1); const S = SVG_POSE[emo] || {};
      P.hr.t = (S.hr || 0) * inten; P.hy.t = (S.hy || 0) * inten * unit; P.aL.t = (S.aL || 0) * inten; P.aR.t = (S.aR || 0) * inten;
      if (S.jump) jumpV = -520 * inten;
      for (const [k, el] of Object.entries(faces)) el.style.display = (k === emo || (!faces[emo] && k === 'neutral')) ? '' : 'none';
      for (const [k, el] of Object.entries(fxs)) el.style.display = k === emo ? '' : 'none';
    }
    function frame(now) {
      if (!alive || !wrap.isConnected) return;
      const dt = Math.min(.033, (now - t0) / 1000); t0 = now; const T = now / 1000;
      for (const k of Object.keys(P)) spring(P[k], dt);
      jumpV += 1700 * dt * (jump < 0 ? 1 : 0); jump += jumpV * dt; if (jump > 0) { jump = 0; jumpV = 0; }
      const m = (SVG_POSE[emo] || {}).m; let bx = 0, by = Math.sin(T * 1.6) * .35 * unit, br = 0, gl = 0;
      if (m === 'laugh') { by = -Math.abs(Math.sin(T * 9)) * 1.2 * unit * inten; br = Math.sin(T * 9) * 2; } else if (m === 'bounce') by = -Math.abs(Math.sin(T * 6)) * 1.4 * unit * inten;
      else if (m === 'shake') bx = Math.sin(T * 38) * .3 * unit * inten; else if (m === 'shake2') bx = Math.sin(T * 62) * .4 * unit * inten; else if (m === 'tremble') bx = Math.sin(T * 55) * .2 * unit * inten;
      if (speakOn) { if (lvl == null && T > nextOpen) { open = Math.random() < .2 ? .1 : rnd(.3, 1); nextOpen = T + rnd(.07, .16); } gl = lvl == null ? open : lvl; }
      const arm = (Math.sin(T * 1.4) * 2) + (speakOn ? Math.sin(T * 3.1) * 6 : 0);
      if (parts.body) setT(parts.body, `translate(${(bx).toFixed(2)} ${(by + jump * .04 * unit).toFixed(2)}) ${rot('body', br)}`);
      else setT(wrap.firstChild, `translate(${bx.toFixed(2)} ${(by + jump * .04 * unit).toFixed(2)})`);
      if (parts.head) setT(parts.head, `translate(0 ${P.hy.x.toFixed(2)}) ${rot('head', P.hr.x + Math.sin(T * .8) * 1.2)}`);
      if (parts.aL) setT(parts.aL, rot('aL', P.aL.x + arm)); if (parts.aR) setT(parts.aR, rot('aR', P.aR.x - arm));
      if (parts.mouthOpen) { parts.mouthOpen.style.display = gl > .3 ? '' : 'none'; if (parts.mouth) parts.mouth.style.display = gl > .3 ? 'none' : ''; }
      else if (parts.mouth) setT(parts.mouth, `translate(${piv.mouth[0]} ${piv.mouth[1]}) scale(1 ${(.35 + .9 * gl).toFixed(2)}) translate(${-piv.mouth[0]} ${-piv.mouth[1]})`);
      if (parts.eyes) { if (T > nextBlink) { blink0 = T; nextBlink = T + rnd(2.5, 5); } const bt = (T - blink0) / .14, sy = bt >= 0 && bt <= 1 ? 1 - .9 * Math.sin(Math.PI * bt) : 1; setT(parts.eyes, `translate(${piv.eyes[0]} ${piv.eyes[1]}) scale(1 ${sy.toFixed(2)}) translate(${-piv.eyes[0]} ${-piv.eyes[1]})`); }
      raf = requestAnimationFrame(frame);
    }
    pose('neutral'); raf = requestAnimationFrame(frame);
    return {
      pose, beat() { P.aL.t += rnd(-8, 8) * inten; P.aR.t += rnd(-8, 8) * inten; }, rest() { pose(emo, inten); }, speaking(on) { speakOn = !!on; if (!on) lvl = null; },
      level(v) { lvl = v == null ? null : clamp(v, 0, 1); }, fx() { jumpV = -420; }, destroy() { alive = false; cancelAnimationFrame(raf); wrap.remove(); },
      info: { found: Object.keys(parts).filter(k => parts[k]), faces: Object.keys(faces) }
    };
  }

  /* ---------- الواجهة العامة ---------- */
  function init(el) { host = el; }
  function apply(c) {
    cfg = c || { mode: 'builtin' };
    if (impl) { try { impl.destroy(); } catch (e) { /* ignore */ } impl = null; }
    host.replaceChildren();
    try {
      impl = cfg.mode === 'sprite' && cfg.images && cfg.images.neutral ? sprite(cfg) : cfg.mode === 'svg' && cfg.svgText ? svgChar(cfg) : builtin(cfg);
    } catch (err) { console.warn(err); host.replaceChildren(); impl = builtin(cfg = { mode: 'builtin' }); impl.error = err.message; }
    return impl;
  }
  const call = (f, ...a) => impl && impl[f] && impl[f](...a);
  return {
    EMOS, EMO_LABEL, guessEmotion, fileToDataURL, sanitizeSvg, init, apply,
    pose: (e, i) => call('pose', e, i), beat: () => call('beat'), rest: () => call('rest'), speaking: on => call('speaking', on),
    level: v => call('level', v), fx: () => call('fx'), get cfg() { return cfg; }, get impl() { return impl; }
  };
})();
