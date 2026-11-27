'use strict';
/* voice.js — محرك الصوت
   - صوت عصبي من الخادم (/api/tts) عند توفره، مع تحميل مسبق للمقطع التالي وحركة فم من شدة الصوت الحقيقية
   - بديل: صوت المتصفح بنبرة طبيعية. لا "ها ها" ولا "آآآه" منطوقة ولا تشويه للطبقة: التعبير يأتي من الوجه والجسد
   - الإيقاع: تغيّر طفيف جداً في السرعة/الطبقة حسب الانفعال والشدة (±8%) والوقفات من المحلل */
const Voice = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const DELTA = {  // [سرعة, طبقة] نسب صغيرة جداً
    excited: [.06, .06], sad: [-.1, -.05], angry: [.05, -.05], scared: [.07, .06], shock: [.03, .05], think: [-.06, 0], serious: [-.04, -.04],
    laugh: [.04, .04], scream: [.06, .06], sassy: [-.03, .02], mocking: [.02, .04], neutral: [0, 0]
  };
  let caps = { tts: [] }, actx = null, analyser = null, runId = 0, cur = null, lastWarn = '', last = { engine: '', error: '' };
  const cache = new Map();

  async function init() { try { caps = await (await fetch('/api/state')).json(); } catch (e) { caps = { tts: [] }; } return caps; }
  function ctx() { if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); analyser = actx.createAnalyser(); analyser.fftSize = 512; analyser.connect(actx.destination); } return actx; }
  function unlock() { const c = ctx(); if (c && c.state === 'suspended') c.resume(); }
  const serverOn = () => caps.tts && caps.tts.length > 0;
  const api = { onWarn: null };
  function warn(msg) { last.error = msg; if (msg !== lastWarn) { lastWarn = msg; api.onWarn && api.onWarn(msg); } }

  // أصوات المتصفح: العربية أولاً ثم بقية اللغات
  function browserVoices() {
    if (!('speechSynthesis' in window)) return [];
    const all = speechSynthesis.getVoices(), isAr = v => /^ar([-_]|$)/i.test(v.lang);
    return all.slice().sort((a, b) => isAr(b) - isAr(a)).map(v => ({ key: 'b:' + v.name, label: v.name + ' · ' + v.lang, group: isAr(v) ? 'صوت المتصفح (عربي)' : 'صوت المتصفح (لغات أخرى)', kind: 'browser', lang: v.lang }));
  }
  function listVoices() {
    const list = [];
    if (serverOn()) (caps.voices || []).forEach(v => list.push({ key: 's:' + v.key, label: v.label, group: '🎙️ ' + v.group + ' — صوت عصبي', kind: 'server', sample: v.sample }));
    return list.concat(browserVoices());
  }
  const sampleFor = key => { const v = listVoices().find(x => x.key === key); return v && v.sample; };

  /* ---------- صوت الخادم ---------- */
  function keyOf(text, o) { return [o.voice || '', o.rate || 1, o.emotion || '', Math.round((o.intensity == null ? .6 : o.intensity) * 4), text].join('|'); }
  function prefetch(text, o = {}) {
    if (!serverOn() || !(o.voice || '').startsWith('s:') && o.voice) return null;
    const c = ctx(); if (!c) return null; const key = keyOf(text, o);
    if (!cache.has(key)) {
      const p = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: (o.voice || '').replace(/^s:/, ''), rate: o.rate || 1, emotion: o.emotion || 'neutral', intensity: o.intensity == null ? .6 : o.intensity }) })
        .then(async r => { if (!r.ok) { let d = ''; try { d = (await r.json()).detail || ''; } catch (e) { /* no body */ } throw new Error(d || ('خطأ ' + r.status)); } return r.arrayBuffer(); })
        .then(b => new Promise((res, rej) => c.decodeAudioData(b, res, rej)))
        .then(buf => buf);
      p.catch(() => { cache.delete(key); });
      cache.set(key, p); if (cache.size > 80) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  async function speakServer(text, o, id) {
    const buf = await prefetch(text, o);
    if (id !== runId) return { dur: 0 };
    last.engine = 'server'; last.error = ''; lastWarn = ''; const c = ctx(), src = c.createBufferSource(); src.buffer = buf; src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize); let smooth = 0, raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length); smooth += (clamp(rms * 5.5, 0, 1) - smooth) * .5; o.onLevel && o.onLevel(smooth); raf = requestAnimationFrame(tick);
    };
    return new Promise(res => {
      const done = () => { cancelAnimationFrame(raf); cur = null; o.onLevel && o.onLevel(0); res({ dur: buf.duration }); };
      src.onended = done; cur = { stop: () => { try { src.onended = null; src.stop(); } catch (e) { /* already stopped */ } done(); } };
      src.start(); tick();
    });
  }

  /* ---------- صوت المتصفح ---------- */
  function speakBrowser(text, o, id) {
    return new Promise(resolve => {
      const t0 = Date.now(), minDur = text.length * 48; let finished = false, guard, ticker, lastBoundary = 0, pulse = 0;
      const finish = () => { if (finished) return; finished = true; clearTimeout(guard); clearInterval(ticker); cur = null; o.onLevel && o.onLevel(0); resolve({ dur: (Date.now() - t0) / 1000 }); };
      const paced = () => { const el = Date.now() - t0; if (id !== runId || el >= minDur) finish(); else setTimeout(finish, minDur - el); };
      // مزامنة فم: نبضة عند كل كلمة إن وفّرها المحرك، وإلا تذبذب إيقاعي يشبه المقاطع
      ticker = setInterval(() => {
        const now = Date.now(), fresh = now - lastBoundary < 450; pulse *= .72;
        const synthetic = Math.abs(Math.sin(now / 1000 * 11)) * (.45 + .5 * Math.abs(Math.sin(now / 1000 * 2.3)));
        o.onLevel && o.onLevel(clamp(fresh ? Math.max(pulse, synthetic * .5) : synthetic, 0, 1));
      }, 40);
      cur = { stop: () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); finish(); } };
      if (!('speechSynthesis' in window)) { guard = setTimeout(finish, text.length * 68); return; }
      const u = new SpeechSynthesisUtterance(text), voices = speechSynthesis.getVoices(), name = (o.voice || '').replace(/^b:/, '');
      const v = voices.find(x => x.name === name) || voices.find(x => /^ar([-_]|$)/i.test(x.lang));
      u.lang = v ? v.lang : 'ar-SA'; if (v) u.voice = v;
      const d = DELTA[o.emotion] || DELTA.neutral, k = .4 + .6 * clamp(o.intensity == null ? .6 : o.intensity, 0, 1);
      u.rate = clamp((o.rate || 1) * (1 + d[0] * k), .6, 1.6); u.pitch = clamp(1 + d[1] * k, .85, 1.2);
      u.onboundary = () => { lastBoundary = Date.now(); pulse = 1; };
      u.onend = paced; u.onerror = () => { if (id !== runId) finish(); else setTimeout(finish, Math.max(0, text.length * 65 - (Date.now() - t0))); };
      guard = setTimeout(finish, text.length * 180 + 4000);
      speechSynthesis.speak(u);
    });
  }

  async function speak(text, o = {}) {
    cancel(false); const id = ++runId; text = (text || '').trim(); if (!text) return { dur: 0 };
    if (serverOn() && (!o.voice || o.voice.startsWith('s:'))) {
      try { return await speakServer(text, o, id); } catch (e) { if (id !== runId) return { dur: 0 }; warn(String(e.message || e).slice(0, 200) + ' — استُخدم صوت المتصفح بدلاً منه.'); }   // سقطنا إلى المتصفح
    }
    last.engine = 'browser';
    return speakBrowser(text, o, id);
  }
  function cancel(bump = true) { if (bump) runId++; if (cur) cur.stop(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  // تجهيز مسبق: يولّد الصوت لعدة مقاطع بالتوازي المحدود. يُرجع وعداً يتحقق عند جاهزية أول `need` مقطع، ويكمل الباقي بالخلفية
  function prepare(items, onProgress, need) {
    const total = items.length; need = Math.min(need || 1, total); let next = 0, done = 0;
    return new Promise(resolve => {
      if (!total || !serverOn()) return resolve();
      let fired = false;
      const tick = () => { done++; onProgress && onProgress(done, total); if (!fired && done >= need) { fired = true; resolve(); } };
      const worker = async () => { while (next < total) { const it = items[next++]; try { const pr = prefetch(it.text, it.opts); if (pr) await pr; } catch (e) { /* يُعالج وقت التشغيل */ } tick(); } };
      worker(); worker();
    });
  }

  // التقاط الصوت للتصدير: صوت الخادم فقط يمر عبر WebAudio فيمكن تسجيله
  let recDest = null;
  function captureStream() { const c = ctx(); if (!c) return null; if (!recDest) { recDest = c.createMediaStreamDestination(); analyser.connect(recDest); } return recDest.stream; }
  function releaseCapture() { if (recDest) { try { analyser.disconnect(recDest); } catch (e) { /* ok */ } recDest = null; } }

  return Object.assign(api, { init, unlock, listVoices, sampleFor, speak, prefetch, prepare, cancel, captureStream, releaseCapture, get caps() { return caps; }, get serverOn() { return serverOn(); }, get last() { return last; } });
})();
