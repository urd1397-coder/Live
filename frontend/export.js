'use strict';
/* export.js — تصدير فيديو: يرسم المسرح (خلفية، شخصية، مكتب، نصوص، ترجمة) على canvas ويسجّله بـ MediaRecorder أثناء تشغيل السرد.
   - الصوت يُسجَّل فقط إذا كان من الخادم (يمر عبر WebAudio). صوت المتصفح لا يمكن التقاطه، فيخرج الفيديو صامتاً مع تنبيه.
   - يجب إبقاء التبويب ظاهراً أثناء التسجيل (المتصفح يبطّئ الرسم في الخلفية). */
const Exporter = (() => {
  let running = false, aborted = false;
  const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('تعذّر تحميل صورة')); i.src = src; });
  const svgURL = (svgText) => URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  const nextFrame = () => new Promise(r => requestAnimationFrame(r));
  async function svgToImage(svgText) { const u = svgURL(svgText); try { return await img(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); } }

  // CSS الخاص بالشخصية، يُضمَّن داخل الـ SVG لأن الصورة المسلسلة لا ترى ملف الأنماط
  let rigCss = '';
  function collectCss() {
    if (rigCss) return rigCss; const out = [];
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) if (/rigsvg|#rg-|tearfall|fxpulse|fxshiver/.test(r.cssText)) out.push(r.cssText); }
    return (rigCss = out.join('\n'));
  }
  function serializeChar(el, S) {
    const c = el.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', S); c.setAttribute('height', S); c.style.width = S + 'px'; c.style.height = S + 'px';
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = collectCss(); c.insertBefore(st, c.firstChild);
    return new XMLSerializer().serializeToString(c);
  }

  function bgGradient(ctx, W, H, bg) {
    const a = (Number(bg.angle) || 160) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), L = Math.abs(W * dx) + Math.abs(H * dy);
    const g = ctx.createLinearGradient(W / 2 - dx * L / 2, H / 2 - dy * L / 2, W / 2 + dx * L / 2, H / 2 + dy * L / 2); g.addColorStop(0, bg.c1); g.addColorStop(1, bg.c2); return g;
  }
  async function prepare(W, H) {
    const st = { bgImg: null, props: null, photo: null };
    const bg = P.bg;
    if (bg.type === 'preset') st.bgImg = await svgToImage((Scene.PRESETS[bg.preset] || Scene.PRESETS.studio).build(W, H));
    if (bg.type === 'image') st.photo = await img(bg.src);
    if (P.desk) st.props = await svgToImage(Scene.propsHTML(W, H, Scene.autoLayout(P.aspect).deskTop * H));
    return st;
  }
  function drawBg(ctx, W, H, st) {
    const bg = P.bg; ctx.save();
    if (bg.type === 'color') { ctx.fillStyle = bg.c1; ctx.fillRect(0, 0, W, H); }
    else if (bg.type === 'gradient') { ctx.fillStyle = bgGradient(ctx, W, H, bg); ctx.fillRect(0, 0, W, H); }
    else if (bg.type === 'image' && st.photo) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); const i = st.photo, k = (bg.fit === 'contain' ? Math.min : Math.max)(W / i.naturalWidth, H / i.naturalHeight), w = i.naturalWidth * k, h = i.naturalHeight * k;
      if (bg.blur) ctx.filter = `blur(${Number(bg.blur)}px)`; ctx.drawImage(i, (W - w) / 2, (H - h) / 2, w, h); ctx.filter = 'none';
      if (bg.dim) { ctx.fillStyle = `rgba(0,0,0,${Math.min(.8, Math.max(0, Number(bg.dim)))})`; ctx.fillRect(0, 0, W, H); }
    } else if (st.bgImg) ctx.drawImage(st.bgImg, 0, 0, W, H);
    ctx.restore();
  }
  async function drawChar(ctx, W, H) {
    const L = P.char.layout, S = L.size * W, x = L.cx * W - S / 2, y = L.top * H, host = $('lyChar');
    ctx.save(); ctx.translate(x, y); if (L.flip) { ctx.translate(S, 0); ctx.scale(-1, 1); }
    const spr = host.querySelector('.spr');
    if (spr) {
      const im = spr.querySelector('img'), m = new DOMMatrix(getComputedStyle(spr).transform);
      if (im && im.complete && im.naturalWidth) { ctx.translate(S / 2, S); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); ctx.translate(-S / 2, -S); const k = Math.min(S / im.naturalWidth, S / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; ctx.drawImage(im, (S - w) / 2, S - h, w, h); }
    } else { const svg = host.querySelector('svg'); if (svg) ctx.drawImage(await svgToImage(serializeChar(svg, S)), 0, 0, S, S); }
    ctx.restore();
  }
  function px(pct, W, H) { return pct / 100 * Math.min(W, H); }
  function drawTexts(ctx, W, H) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
    for (const t of P.texts) {
      const s = px(t.size, W, H); ctx.font = `800 ${s}px '${t.font}', Cairo, sans-serif`; ctx.fillStyle = t.color;
      if (t.glow) { ctx.shadowColor = t.color; ctx.shadowBlur = s * .6; ctx.fillText(t.text, t.x * W, t.y * H); ctx.shadowBlur = s * .25; } else { ctx.shadowColor = '#0008'; ctx.shadowBlur = 6; }
      ctx.fillText(t.text, t.x * W, t.y * H);
    }
    ctx.restore();
  }
  function drawCaption(ctx, W, H) {
    const c = P.caps, el = $('lyCaps').querySelector('.cap'); if (!c.on || !el || !el.textContent.trim()) return;
    const text = el.textContent.trim(), hl = new Set([...el.querySelectorAll('.hl')].map(x => x.textContent)), s = px(c.size, W, H), maxW = W * .86 - s;
    ctx.save(); ctx.font = `800 ${s}px Cairo, sans-serif`; ctx.direction = 'rtl'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    const words = text.split(/\s+/), lines = []; let cur = [];
    for (const w of words) { const t = [...cur, w].join(' '); if (cur.length && ctx.measureText(t).width > maxW) { lines.push(cur); cur = [w]; } else cur.push(w); }
    if (cur.length) lines.push(cur);
    const lh = s * 1.5, bh = lines.length * lh + s * .4, cy = c.y / 100 * H, top = cy - bh / 2, bw = Math.min(W * .9, Math.max(...lines.map(l => ctx.measureText(l.join(' ')).width)) + s * 1.2);
    if (c.box) { ctx.fillStyle = 'rgba(0,0,0,.55)'; const r = s * .45, x = (W - bw) / 2; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, top, bw, bh, r) : ctx.rect(x, top, bw, bh); ctx.fill(); }
    ctx.shadowColor = '#000'; ctx.shadowBlur = 6; const sp = ctx.measureText(' ').width;
    lines.forEach((l, i) => {
      let x = W / 2 + ctx.measureText(l.join(' ')).width / 2; const y = top + s * .2 + lh * (i + .5);
      for (const w of l) { ctx.fillStyle = hl.has(w.replace(/[.,!؟?…،:;]/g, '')) || hl.has(w) ? c.hl : c.color; ctx.fillText(w, x, y); x -= ctx.measureText(w).width + sp; }
    });
    ctx.restore();
  }

  function pickMime() {
    for (const [m, ext] of [['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']])
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return { m, ext };
    return null;
  }
  const serverVoice = () => Voice.serverOn && [P.voice.key, ...P.script.segments.map(x => x.voice)].filter((v, i) => i === 0 || v).every(v => !v || v.startsWith('s:'));

  async function run(shortSide) {
    if (running) return; if (!segs().length) { setStatus('لا يوجد نص لتصديره'); return; }
    const mt = pickMime(); if (!mt) { setStatus('متصفحك لا يدعم تسجيل الفيديو. استخدم Chrome.'); return; }
    if (!serverVoice() && !confirm('الصوت الحالي من المتصفح ولا يمكن تسجيله داخل الفيديو، فسيخرج الفيديو بدون صوت.\\nلصوت داخل الفيديو فعّل صوت الخادم (تبويب الصوت). متابعة بدون صوت؟')) return;
    running = true; aborted = false; const btn = $('tExport'); btn.disabled = true;
    try {
      const a = A(), q = shortSide / Math.min(a.w, a.h), cw = Math.round(a.w * q / 2) * 2, ch = Math.round(a.h * q / 2) * 2;
      setStatus('جارٍ التجهيز…'); try { await Promise.all(['800 40px Cairo', '800 40px Tajawal', '800 40px Lalezar'].map(f => document.fonts.load(f))); } catch (e) { /* خطوط غير متاحة */ }
      const st = await prepare(a.w, a.h), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const out = cv.getContext('2d'), bk = document.createElement('canvas'); bk.width = cw; bk.height = ch; const ctx = bk.getContext('2d');  // نرسم على لوحة خلفية ثم ننسخ دفعة واحدة كي لا تُلتقط لقطة نصف مرسومة
      const stream = cv.captureStream(30), as = serverVoice() ? Voice.captureStream() : null; if (as) as.getAudioTracks().forEach(t => stream.addTrack(t));
      const chunks = [], rec = new MediaRecorder(stream, { mimeType: mt.m, videoBitsPerSecond: shortSide >= 1000 ? 8e6 : 5e6 }); rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => rec.onstop = r); stopPlayback(); Voice.unlock(); let drawing = true, frames = 0;
      const draw = async () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); ctx.setTransform(cw / a.w, 0, 0, ch / a.h, 0, 0); drawBg(ctx, a.w, a.h, st); await drawChar(ctx, a.w, a.h); if (st.props) ctx.drawImage(st.props, 0, 0, a.w, a.h); drawTexts(ctx, a.w, a.h); drawCaption(ctx, a.w, a.h); out.drawImage(bk, 0, 0); frames++; };
      if (as) { await Voice.prepare(segs().map(x => ({ text: x.text, opts: voiceOpts(x) })), (n, t) => setStatus(`جارٍ تجهيز الصوت كاملاً قبل التسجيل… ${n}/${t}`), segs().length); if (aborted) { running = false; btn.disabled = false; return; } }
      await draw(); rec.start(500); setStatus('🔴 جارٍ التسجيل… أبقِ هذا التبويب ظاهراً'); await wait(350);
      const loop = (async () => { while (drawing) { try { await draw(); } catch (e) { /* لقطة فاشلة: نكمل */ } await nextFrame(); } })();
      await playFrom(0); await wait(700); drawing = false; await loop; rec.stop(); await stopped; Voice.releaseCapture();
      if (aborted) { setStatus('أُلغي التصدير'); return; }
      const blob = new Blob(chunks, { type: mt.m.split(';')[0] }), url = URL.createObjectURL(blob), l = document.createElement('a'); l.href = url; l.download = safeName(P.name) + '.' + mt.ext; document.body.append(l); l.click(); setTimeout(() => { URL.revokeObjectURL(url); l.remove(); }, 4000);
      setStatus(`تم التصدير: ${cw}×${ch} · ${(blob.size / 1048576).toFixed(1)}MB · ${mt.ext.toUpperCase()}${as ? '' : ' (بدون صوت)'}`);
    } catch (e) { setStatus('فشل التصدير: ' + e.message); Voice.releaseCapture(); }
    finally { running = false; btn.disabled = false; }
  }
  function refreshInfo() {
    const el = $('expInfo'), n = segs().length, ok = serverVoice();
    if (!n) { el.className = 'banner warn'; el.textContent = 'لا يوجد نص بعد. اكتب القصة وحلّلها أولاً من تبويب «القصة».'; }
    else if (ok) { el.className = 'banner ok'; el.textContent = `جاهز: ${n} مقطع. الصوت سيدخل داخل الفيديو.`; }
    else { el.className = 'banner warn'; el.textContent = `${n} مقطع. الصوت الحالي من المتصفح ولا يمكن تسجيله، فسيخرج الفيديو بدون صوت. اختر صوتاً عصبياً (🎙) من تبويب «الصوت» لتسجيله.`; }
  }
  $('tabs').addEventListener('click', e => { if (e.target.closest('[data-tab=export]')) refreshInfo(); });
  $('tStop').addEventListener('click', () => { if (running) aborted = true; });
  $('tExport').onclick = () => run(+$('expQ').value);
  return { run, get running() { return running; } };
})();
