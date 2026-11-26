'use strict';
/* ============================================================
   rig.js — شخصية Live: هيكل SVG بمفاصل + محرك حركة
   - كل جزء (رأس، سماعات، حاجب، عين، فم، ذراع، ساعد، يد) عنصر مستقل
   - الحركة تأتي من "قيم" (params) تلحق قيمها الهدف بتأثير زنبرك، فتطلع الحركة ناعمة وفيها ارتداد
   - API: Rig.mount(el) · Rig.pose(name) · Rig.beat() · Rig.rest() · Rig.speaking(bool) · Rig.fx(name)
   ============================================================ */
const Rig = (() => {
  const UA = 92, FA = 84;                     // طول العضد والساعد
  const SHL = [296, 352], SHR = [304, 352];   // الكتفين
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- الرسم ---------- */
  const HAND = '<g transform="scale(1.25)">' +
    '<g class="hs hs-open"><rect class="skin" x="-14" y="-2" width="28" height="32" rx="12"/><ellipse class="skin" cx="-16" cy="10" rx="7" ry="12" transform="rotate(18 -16 10)"/><path class="fine" d="M-6 20V30M2 20V30M10 20V30"/></g>' +
    '<g class="hs hs-fist"><rect class="skin" x="-15" y="0" width="30" height="28" rx="11"/><path class="fine" d="M-7 4V12M1 4V12M9 4V12"/></g>' +
    '<g class="hs hs-point"><rect class="skin" x="-14" y="-2" width="28" height="26" rx="11"/><rect class="skin" x="-5" y="20" width="11" height="34" rx="5"/></g></g>';
  const arm = id =>
    `<g id="rg-${id}"><g class="limb"><line x1="0" y1="0" x2="0" y2="${UA}"/></g>` +
    `<g id="rg-${id}f"><g class="limb"><line x1="0" y1="0" x2="0" y2="${FA}"/></g><g id="rg-${id}h">${HAND}</g></g></g>`;
  const eye = s =>
    `<g id="rg-eye${s}"><clipPath id="rg-lc${s}"><rect id="rg-lcr${s}" x="-40" y="-40" width="80" height="100"/></clipPath>` +
    '<ellipse class="sclera" rx="25" ry="29"/>' +
    `<g clip-path="url(#rg-lc${s})" class="pupilg"><ellipse class="pupil" rx="12" ry="16"/><circle class="glint" cx="-4" cy="-7" r="3.6"/></g>` +
    '<line class="lidline" x1="-27" y1="0" x2="27" y2="0"/>' +
    '<path class="happy" d="M-24 8Q0 -22 24 8"/><path class="chev" d="M-22 -14L16 2L-22 18"/></g>';
  const brow = s => `<g id="rg-brow${s}"><path class="brow" d="M-26 0Q0 -12 26 0"/></g>`;

  const MARKUP =
`<svg class="rigsvg" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="شخصية Live">
<defs>
 <linearGradient id="rg-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b1c55"/><stop offset="1" stop-color="#0e0b20"/></linearGradient>
 <radialGradient id="rg-head" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e6e5f1"/></radialGradient>
 <filter id="rg-neon" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <clipPath id="rg-mclip"><path id="rg-mclipd" d=""/></clipPath>
</defs>
<rect width="600" height="600" rx="22" fill="url(#rg-bg)"/>
<g opacity=".95" filter="url(#rg-neon)"><rect x="0" y="238" width="120" height="5" fill="#3b8cff"/><rect x="0" y="330" width="86" height="5" fill="#7a5cff"/><rect x="520" y="300" width="80" height="5" fill="#3b8cff"/></g>
<g transform="translate(70 70)" filter="url(#rg-neon)"><circle cx="0" cy="-8" r="7" fill="#ff4d6d"/><text x="16" y="6" font-family="Arial Black,Impact,sans-serif" font-size="36" font-weight="900" fill="none" stroke="#ff6fd8" stroke-width="3">LIVE</text></g>

<g id="rg-body">
 <g class="limb"><line x1="300" y1="300" x2="300" y2="352"/><path d="M300 352V560"/></g>
 <g id="rg-headg">
  <ellipse class="headshape" rx="108" ry="104"/>
  <g id="rg-face">
   ${brow('L')}${brow('R')}${eye('L')}${eye('R')}
   <g clip-path="url(#rg-mclip)"><rect id="rg-teeth" x="-60" y="40" width="120" height="16" fill="#fff"/><ellipse id="rg-tongue" cx="0" cy="80" rx="19" ry="12" fill="#e0687c"/></g>
   <path id="rg-mouth" class="mouth" d=""/>
  </g>
  <g class="hp"><path class="hp-band" d="M-118 -10C-126 -150 126 -150 118 -10"/>
   <rect class="hp-cup" x="-140" y="-40" width="38" height="86" rx="16"/><rect class="hp-cup" x="102" y="-40" width="38" height="86" rx="16"/>
   <g filter="url(#rg-neon)"><rect class="hp-led" x="-134" y="-22" width="6" height="52" rx="3"/><rect class="hp-led" x="128" y="-22" width="6" height="52" rx="3"/></g></g>
 </g>
 ${arm('aL')}${arm('aR')}
</g>

<g id="rg-fx" transform="translate(300 200)">
 <g class="fxg" id="rg-fx-burst"><path d="M-160 -62l32 -16 -8 32z"/><path d="M-170 -100l30 -2 -14 24z"/><path d="M-138 -120l14 -26 12 24z"/></g>
 <g class="fxg" id="rg-fx-sparkle"><path class="star" d="M128 -100q4 -12 16 -16 -12 -4 -16 -16 -4 12 -16 16 12 4 16 16z"/><path class="star" d="M-136 -104q3 -9 12 -12 -9 -3 -12 -12 -3 9 -12 12 9 3 12 12z"/></g>
 <g class="fxg" id="rg-fx-star"><path class="star" d="M132 -92q5 -14 19 -19 -14 -5 -19 -19 -5 14 -19 19 14 5 19 19z"/></g>
 <g class="fxg" id="rg-fx-veins"><path class="red" d="M70 -106q12 6 0 18M98 -106q-12 6 0 18M76 -114q9 -9 18 0M76 -82q9 9 18 0"/></g>
 <g class="fxg" id="rg-fx-bolts"><path class="red" d="M-150 -70l-14 24 16 4 -14 26M150 -70l14 24 -16 4 14 26"/></g>
 <g class="fxg" id="rg-fx-shout"><path class="white" d="M-150 -30l-34 -12M-156 6l-36 0M-150 42l-34 12M150 -30l34 -12M156 6l36 0M150 42l34 12"/></g>
 <g class="fxg" id="rg-fx-bang"><path class="yel" d="M118 -150h16l-4 44h-8z"/><circle class="yel" cx="126" cy="-90" r="7"/></g>
 <g class="fxg" id="rg-fx-sweat"><path class="drop" d="M118 -78q16 24 0 34 -16 -10 0 -34z"/><path class="drop" d="M-126 -40q12 18 0 26 -12 -8 0 -26z"/></g>
 <g class="fxg" id="rg-fx-shiver"><path class="white" d="M-156 -50q-9 12 0 24t0 24t0 24M156 -50q9 12 0 24t0 24t0 24"/></g>
 <g class="fxg" id="rg-fx-tears"><path class="drop tear" d="M-64 28q10 16 0 24 -10 -8 0 -24z"/><path class="drop tear t2" d="M64 28q10 16 0 24 -10 -8 0 -24z"/></g>
 <g class="fxg" id="rg-fx-thought"><circle class="bub" cx="112" cy="-118" r="7"/><circle class="bub" cx="132" cy="-138" r="11"/><ellipse class="bub" cx="172" cy="-172" rx="42" ry="28"/><circle class="dot" cx="152" cy="-172" r="4.5"/><circle class="dot" cx="172" cy="-172" r="4.5"/><circle class="dot" cx="192" cy="-172" r="4.5"/></g>
 <g class="fxg" id="rg-fx-haha"><text class="haha" x="120" y="-100" transform="rotate(12 120 -100)">ha</text><text class="haha" x="150" y="-62" transform="rotate(12 150 -62)">ha</text></g>
</g>

<rect x="-10" y="478" width="620" height="140" fill="#241a3a"/><rect x="-10" y="478" width="620" height="5" fill="#4c3a78"/>
<g filter="url(#rg-neon)"><rect x="90" y="520" width="240" height="14" rx="5" fill="#16122b" stroke="#3b8cff" stroke-width="2"/></g>
<g transform="translate(470 330) rotate(18)"><path d="M0 120L-60 175" stroke="#0b0a14" stroke-width="7" stroke-linecap="round"/><rect x="-22" y="0" width="44" height="125" rx="22" fill="#15141f" stroke="#0b0a14" stroke-width="5"/><rect x="-20" y="62" width="40" height="8" fill="#3b8cff" filter="url(#rg-neon)"/></g>
<g transform="translate(520 428)"><rect x="-28" y="0" width="56" height="52" rx="8" fill="#15141f" stroke="#0b0a14" stroke-width="4"/><path d="M28 12h14a12 12 0 0 1 0 28h-14" fill="none" stroke="#0b0a14" stroke-width="6"/><path d="M-18 14h16v8h-16zM2 14h16v8H2z" fill="#fff"/></g>
</svg>`;

  /* ---------- القيم والزنبرك ---------- */
  const DEF = {
    hy: 0, hr: 0, lean: 0, aL1: 18, aL2: 8, aR1: 18, aR2: 8, wL: 0, wR: 0,
    bY: 0, bR: 0, bC: 8, bYR: 0, bRR: 0,
    wide: 0, lid: -40, lidA: 0, px: 0, py: 0, pr: 1, happy: 0, chev: 0,
    mw: 24, mcl: 46, mcr: 46, mu: 60, ml: 60, mx: 0, teeth: 0, tongue: 0
  };
  const FACE = new Set(['bY', 'bR', 'bC', 'bYR', 'bRR', 'wide', 'lid', 'lidA', 'px', 'py', 'pr', 'happy', 'chev', 'mw', 'mcl', 'mcr', 'mu', 'ml', 'mx', 'teeth', 'tongue']);
  const P = {};
  for (const k of Object.keys(DEF)) P[k] = { x: DEF[k], v: 0, t: DEF[k] };
  for (const k of ['jump', 'pop', 'open']) P[k] = { x: 0, v: 0, t: 0 };
  P.pop.x = 1; P.pop.t = 1;
  const FX_NAMES = ['burst', 'sparkle', 'star', 'veins', 'bolts', 'shout', 'bang', 'sweat', 'shiver', 'tears', 'thought', 'haha'];
  const FXA = {}; for (const n of FX_NAMES) FXA[n] = { x: 0, v: 0, t: 0 };

  // كل انفعال: قيم تتغير عن الوضع الافتراضي + حالة اليدين + نوع الحركة الحية + المؤثرات + شدة الإيماءات
  const O = (o) => o;
  const POSES = {
    neutral: O({ hs: ['open', 'open'], motion: 'idle', fx: [], amp: 28 }),
    laugh:   O({ chev: 1, bY: -6, bC: 3, hr: -8, mw: 40, mcl: 42, mcr: 42, mu: 46, ml: 94, teeth: 1, tongue: 1, aL1: 52, aL2: 78, aR1: 52, aR2: 78, hs: ['point', 'point'], motion: 'laugh', fx: ['burst'], amp: 12 }),
    scream:  O({ wide: 1, pr: .45, bY: -14, bR: -12, bC: 10, mw: 28, mcl: 62, mcr: 62, mu: 30, ml: 100, tongue: 1, hy: -6, aL1: 120, aL2: 38, aR1: 120, aR2: 38, hs: ['open', 'open'], motion: 'scream', fx: ['shout'], amp: 8 }),
    shock:   O({ wide: 1, pr: .5, bY: -16, bR: -8, bC: 12, mw: 15, mcl: 62, mcr: 62, mu: 46, ml: 82, hy: -8, aL1: 72, aL2: 52, aR1: 72, aR2: 52, hs: ['open', 'open'], motion: 'shock', fx: ['bang'], amp: 8, jump: -430 }),
    angry:   O({ lid: -4, lidA: 14, bY: 6, bR: 22, bC: 0, mw: 34, mcl: 70, mcr: 70, mu: 52, ml: 88, teeth: 1, tongue: 1, aL1: 55, aL2: 105, aR1: 55, aR2: 105, hs: ['fist', 'fist'], motion: 'angry', fx: ['veins', 'bolts'], amp: 10 }),
    think:   O({ px: 9, py: -10, bY: -2, bR: 6, bYR: -10, bC: 10, mw: 12, mcl: 60, mcr: 56, mx: -8, hr: -8, aL1: 14, aL2: 8, aR1: 70, aR2: 150, hs: ['open', 'fist'], motion: 'think', fx: ['thought'], amp: 6 }),
    sad:     O({ lid: -14, lidA: -10, bY: -2, bR: -16, mw: 20, mcl: 68, mcr: 68, mu: 52, ml: 52, hr: 7, hy: 10, aL1: 8, aL2: 0, aR1: 8, aR2: 0, hs: ['open', 'open'], motion: 'sad', fx: ['tears'], amp: 8 }),
    scared:  O({ wide: 1, pr: .4, bY: -12, bR: -14, mw: 24, mcl: 66, mcr: 66, mu: 56, ml: 96, tongue: 1, aL1: 112, aL2: 62, aR1: 112, aR2: 62, hs: ['open', 'open'], motion: 'scared', fx: ['sweat', 'shiver'], amp: 6 }),
    sassy:   O({ lid: -3, lidA: 6, bY: -2, bYR: -9, bC: 12, mw: 22, mcl: 54, mcr: 40, mx: 6, hr: 10, aL1: 32, aL2: -105, aR1: 50, aR2: 75, hs: ['fist', 'open'], motion: 'sassy', fx: ['star'], amp: 14 }),
    excited: O({ wide: 1, pr: 1.1, bY: -8, bR: -4, bC: 12, mw: 38, mcl: 44, mcr: 44, mu: 48, ml: 90, teeth: 1, tongue: 1, aL1: 128, aL2: 30, aR1: 128, aR2: 30, hs: ['open', 'open'], motion: 'excited', fx: ['sparkle'], amp: 14 }),
    serious: O({ lid: -2, lidA: 8, bY: 4, bR: 14, bC: 0, mw: 20, mcl: 58, mcr: 58, mu: 58, ml: 58, aL1: 24, aL2: 48, aR1: 24, aR2: 48, wL: -5, wR: 5, hs: ['open', 'open'], motion: 'serious', fx: [], amp: 14 }),
    mocking: O({ happy: 1, bY: -4, bR: -6, bC: 8, mw: 36, mcl: 44, mcr: 50, mu: 46, ml: 86, teeth: 1, tongue: 1, hr: -10, aL1: 20, aL2: 0, aR1: 88, aR2: 22, hs: ['open', 'point'], motion: 'mocking', fx: ['haha'], amp: 12 })
  };

  let root, els = {}, cur = 'neutral', T = 0, last = 0, speakOn = false, nextOpen = 0, nextBlink = 2, blinkT0 = -9, nextLook = 1, motion = 'idle';
  let base = Object.assign({}, DEF);

  function pose(name) {
    const S = POSES[name] || POSES.neutral; cur = POSES[name] ? name : 'neutral';
    base = Object.assign({}, DEF, S);
    for (const k of Object.keys(DEF)) P[k].t = base[k];
    motion = S.motion || 'idle';
    FX_NAMES.forEach(n => FXA[n].t = (S.fx || []).includes(n) ? 1 : 0);
    setHands(S.hs || ['open', 'open']);
    if (S.jump) P.jump.v = S.jump;
    P.pop.v = 6;                                // نبضة صغيرة عند تغيّر الانفعال
  }
  function setHands(hs) {
    for (const [i, side] of ['L', 'R'].entries())
      els['a' + side + 'h'].querySelectorAll('.hs').forEach(g => g.classList.toggle('on', g.classList.contains('hs-' + hs[i])));
  }
  // إيماءات واضحة ومتبادلة مثل مقدم البث في المرجع: يشير بيد، ثم يفتح اليدين، ثم يبدّل الجهة.
  let gestureStep = 0;
  function beat() {
    const j = (POSES[cur] || {}).amp ?? 20;
    const phase = gestureStep++ % 4;
    const patterns = [
      { aL1: 28, aL2: 34, aR1: -8, aR2: 4, wL: -12, wR: 4, hands: ['point', 'open'] },
      { aL1: -8, aL2: 4, aR1: 28, aR2: 34, wL: -4, wR: 12, hands: ['open', 'point'] },
      { aL1: 42, aL2: 18, aR1: 42, aR2: 18, wL: 0, wR: 0, hands: ['open', 'open'] },
      { aL1: 12, aL2: 58, aR1: 12, aR2: 58, wL: 10, wR: -10, hands: ['open', 'open'] }
    ];
    const g = patterns[phase];
    const quiet = cur === 'sad' || cur === 'think';
    for (const k of ['aL1', 'aL2', 'aR1', 'aR2']) {
      const target = quiet ? base[k] + rnd(-j * .35, j * .35) : base[k] + g[k] + rnd(-j * .18, j * .18);
      P[k].t = clamp(target, -140, 175);
    }
    P.hr.t = base.hr + rnd(-5, 5);
    P.wL.t = g.wL + rnd(-5, 5); P.wR.t = g.wR + rnd(-5, 5);
    if (cur !== 'angry' && cur !== 'sad') setHands(g.hands);
  }
  function rest() { for (const k of ['aL1', 'aL2', 'aR1', 'aR2', 'hr', 'wL', 'wR']) P[k].t = base[k]; }
  function speaking(on) { speakOn = !!on; if (!on) P.open.t = 0; }
  function fx() { P.pop.v = 9; }

  /* ---------- محرك الحركة ---------- */
  function spring(p, dt, K, C) { const a = (p.t - p.x) * K - p.v * C; p.v += a * dt; p.x += p.v * dt; }
  function step(dt) {
    for (const k of Object.keys(P)) FACE.has(k) || k === 'open' ? spring(P[k], dt, 260, 32) : spring(P[k], dt, 140, 15);
    for (const n of FX_NAMES) spring(FXA[n], dt, 200, 28);
    if (speakOn && T > nextOpen) { P.open.t = Math.random() < .2 ? .12 : rnd(.35, 1); nextOpen = T + rnd(.07, .15); }
    if (T > nextLook) { if (!speakOn) { P.px.t = base.px + rnd(-4, 4); P.py.t = base.py + rnd(-2, 2); } nextLook = T + rnd(1.2, 3); }
    if (T > nextBlink) { blinkT0 = T; nextBlink = T + rnd(2.5, 5); }
  }
  function live() {                               // حركة مستمرة حسب الانفعال
    const t = T, m = motion, o = { bx: 0, by: Math.sin(t * 1.7) * 2.5, hr: Math.sin(t * .8) * 1.2, lean: 0, jit: 0 };
    switch (m) {
      case 'laugh':   o.by = -Math.abs(Math.sin(t * 9)) * 10; o.hr = Math.sin(t * 9) * 3; o.lean = Math.sin(t * 9) * 2; break;
      case 'scream':  o.bx = Math.sin(t * 70) * 2.5; o.hr = Math.sin(t * 50) * 1.5; break;
      case 'angry':   o.bx = Math.sin(t * 38) * 2.5; o.lean = Math.sin(t * 38) * .8; break;
      case 'scared':  o.bx = Math.sin(t * 55) * 1.8; o.jit = Math.sin(t * 60) * 3; break;
      case 'excited': o.by = -Math.abs(Math.sin(t * 6)) * 14; break;
      case 'mocking': o.by = -Math.abs(Math.sin(t * 7)) * 6; o.hr = Math.sin(t * 7) * 2.5; break;
      case 'sassy':   o.lean = Math.sin(t * 1.8) * 2.5; break;
      case 'think':   o.hr = Math.sin(t * .9) * 2; break;
      case 'sad':     o.by = 8 + Math.sin(t * 1.1) * 2; break;
      case 'serious': o.by = Math.sin(t * 1.2) * 1.5; o.hr = 0; o.lean = Math.sin(t * .65) * .5; break;
    }
    return o;
  }
  const f1 = n => Math.round(n * 10) / 10;
  function mouthD(m) {
    const cy = (m.mcl + m.mcr) / 2, cu = 2 * m.mu - cy, cl = 2 * m.ml - cy;
    return `M${f1(-m.mw + m.mx)} ${f1(m.mcl)}Q${f1(m.mx)} ${f1(cu)} ${f1(m.mw + m.mx)} ${f1(m.mcr)}Q${f1(m.mx)} ${f1(cl)} ${f1(-m.mw + m.mx)} ${f1(m.mcl)}Z`;
  }
  function render() {
    const x = k => P[k].x, o = live();
    // الجسم والرأس
    els.body.setAttribute('transform', `translate(${f1(o.bx)} ${f1(o.by + x('jump'))}) rotate(${f1(x('lean') + o.lean)} 300 500)`);
    els.headg.setAttribute('transform', `translate(300 ${f1(200 + x('hy'))}) rotate(${f1(x('hr') + o.hr)} 0 112)`);
    // الذراعان: عضد، ساعد، رسغ
    const j = o.jit;
    els.aL.setAttribute('transform', `translate(${SHL[0]} ${SHL[1]}) rotate(${f1(x('aL1') + j)})`);
    els.aR.setAttribute('transform', `translate(${SHR[0]} ${SHR[1]}) scale(-1 1) rotate(${f1(x('aR1') - j)})`);
    els.aLf.setAttribute('transform', `translate(0 ${UA}) rotate(${f1(x('aL2'))})`);
    els.aRf.setAttribute('transform', `translate(0 ${UA}) rotate(${f1(x('aR2'))})`);
    els.aLh.setAttribute('transform', `translate(0 ${FA}) rotate(${f1(x('wL'))})`);
    els.aRh.setAttribute('transform', `translate(0 ${FA}) rotate(${f1(x('wR'))})`);
    // الحواجب
    els.browL.setAttribute('transform', `translate(-42 ${f1(-50 + x('bY'))}) rotate(${f1(x('bR'))})`);
    els.browR.setAttribute('transform', `translate(42 ${f1(-50 + x('bY') + x('bYR'))}) scale(-1 1) rotate(${f1(x('bR') + x('bRR'))})`);
    const bd = `M-26 0Q0 ${f1(-2 * x('bC'))} 26 0`;
    els.browL.firstChild.setAttribute('d', bd); els.browR.firstChild.setAttribute('d', bd);
    // العيون (مع رمشة)
    const closed = clamp(x('happy') + x('chev'), 0, 1), bt = (T - blinkT0) / .15;
    const blink = bt >= 0 && bt <= 1 ? Math.sin(Math.PI * bt) * (1 - closed) : 0, sy = 1 - .92 * blink;
    for (const s of ['L', 'R']) {
      const e = els['eye' + s], sgn = s === 'L' ? 1 : -1;
      e.setAttribute('transform', s === 'L' ? `translate(-42 -4) scale(1 ${f1(sy)})` : `translate(42 -4) scale(-1 ${f1(sy)})`);
      const wide = x('wide'), pr = x('pr'), lid = x('lid');
      e.sclera.style.opacity = wide * (1 - closed);
      e.pupilg.style.opacity = 1 - closed;
      e.pupil.setAttribute('rx', f1(12 * pr)); e.pupil.setAttribute('ry', f1(16 * pr));
      e.pupil.setAttribute('cx', f1(sgn * x('px'))); e.pupil.setAttribute('cy', f1(x('py')));
      e.glint.setAttribute('cx', f1(sgn * x('px') - 4)); e.glint.setAttribute('cy', f1(x('py') - 7));
      e.lcr.setAttribute('y', f1(lid)); e.lcr.setAttribute('transform', `rotate(${f1(x('lidA'))} 0 ${f1(lid)})`);
      const showLid = lid > -30 ? 1 - closed : 0;
      e.lidline.style.opacity = showLid; e.lidline.setAttribute('transform', `translate(0 ${f1(lid)}) rotate(${f1(x('lidA'))})`);
      e.happy.style.opacity = x('happy'); e.chev.style.opacity = x('chev');
    }
    // الفم + مزامنة الكلام
    const op = x('open'), m = {
      mw: x('mw') * (1 - .18 * op), mcl: x('mcl'), mcr: x('mcr'), mx: x('mx'), mu: x('mu'), ml: x('ml')
    };
    const isOpen = (x('ml') - x('mu')) > 12;
    if (speakOn || op > .02) {
      m.ml = x('ml') + (isOpen ? (op - .5) * 18 : op * 30);
      m.mu = x('mu') - (isOpen ? 0 : op * 6);
    }
    const d = mouthD(m);
    els.mouth.setAttribute('d', d); els.mclip.setAttribute('d', d);
    els.teeth.setAttribute('y', f1(m.mu - 6)); els.teeth.style.opacity = x('teeth');
    els.tongue.setAttribute('cy', f1(m.ml - 12)); els.tongue.style.opacity = x('tongue') * clamp((m.ml - m.mu) / 30, 0, 1);
    // المؤثرات
    els.fx.setAttribute('transform', `translate(300 ${f1(200 + x('hy'))}) scale(${f1(x('pop'))})`);
    for (const n of FX_NAMES) els.fxg[n].style.opacity = clamp(FXA[n].x, 0, 1);
  }
  function frame(now) {
    const dt = Math.min(.033, (now - last) / 1000); last = now; T += dt;
    step(dt); render(); requestAnimationFrame(frame);
  }

  function mount(container) {
    container.insertAdjacentHTML('beforeend', MARKUP);
    root = container.querySelector('.rigsvg');
    const q = id => root.querySelector('#rg-' + id);
    els = { body: q('body'), headg: q('headg'), mouth: q('mouth'), mclip: q('mclipd'), teeth: q('teeth'), tongue: q('tongue'), fx: q('fx'), fxg: {} };
    for (const n of ['aL', 'aR']) { els[n] = q(n); els[n + 'f'] = q(n + 'f'); els[n + 'h'] = q(n + 'h'); }
    for (const s of ['L', 'R']) {
      els['brow' + s] = q('brow' + s);
      const e = q('eye' + s);
      e.sclera = e.querySelector('.sclera'); e.pupilg = e.querySelector('.pupilg'); e.pupil = e.querySelector('.pupil');
      e.glint = e.querySelector('.glint'); e.lidline = e.querySelector('.lidline'); e.happy = e.querySelector('.happy'); e.chev = e.querySelector('.chev');
      e.lcr = q('lcr' + s); els['eye' + s] = e;
    }
    for (const n of FX_NAMES) els.fxg[n] = q('fx-' + n);
    pose('neutral');
    for (const k of Object.keys(P)) if (k !== 'pop') { P[k].x = P[k].t; P[k].v = 0; }
    last = performance.now(); requestAnimationFrame(frame);
  }
  return { mount, pose, beat, rest, speaking, fx, POSES: Object.keys(POSES) };
})();
