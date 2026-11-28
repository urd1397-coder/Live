'use strict';
/* clips.js — تسجيلات صوت المستخدم لكل مقطع: تسجيل بالمايك أو رفع ملف أو تقسيم تسجيل طويل. تُحفظ في IndexedDB محلياً على جهازه */
const Clips = (() => {
  const mem = new Map(), bufs = new Map();
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('live-clips', 1); r.onupgradeneeded = () => r.result.createObjectStore('clips'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('clips', mode), q = fn(t.objectStore('clips')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function put(blob, id) { id = id || uid(); mem.set(id, blob); bufs.delete(id); try { await tx('readwrite', s => s.put(blob, id)); } catch (e) { /* نبقيه في الذاكرة */ } return id; }
  async function blob(id) { if (mem.has(id)) return mem.get(id); try { const b = await tx('readonly', s => s.get(id)); if (b) mem.set(id, b); return b || null; } catch (e) { return null; } }
  async function del(id) { mem.delete(id); bufs.delete(id); try { await tx('readwrite', s => s.delete(id)); } catch (e) { /* لا شيء */ } }
  // decodeAudioData يحتاج ArrayBuffer: دالة منفصلة لوضوح الكود
  async function decode(b) { const ab = await b.arrayBuffer(), ctx = Voice.audioContext(); return new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)); }
  async function getBuffer(id) {
    if (bufs.has(id)) return bufs.get(id); const b = await blob(id); if (!b) throw new Error('التسجيل غير موجود على هذا الجهاز (ربما سُجّل على جهاز آخر)');
    const buf = await decode(b); bufs.set(id, buf); return buf;
  }
  const toDataURL = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  const fromDataURL = async (url, id) => { const b = await (await fetch(url)).blob(); return put(b, id); };

  /* ---- تسجيل المايك ---- */
  let rec = null;
  async function startRec() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [], mr = new MediaRecorder(stream); rec = { mr, stream, chunks };
    mr.ondataavailable = e => e.data.size && chunks.push(e.data); mr.start(); return true;
  }
  function stopRec() { return new Promise(res => { const r = rec; if (!r) return res(null); r.mr.onstop = () => { r.stream.getTracks().forEach(t => t.stop()); rec = null; res(new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' })); }; r.mr.stop(); }); }

  /* ---- WAV ---- */
  function wavBlob(samples, rate) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  const mono = buf => { const a = buf.getChannelData(0); if (buf.numberOfChannels < 2) return a; const b = buf.getChannelData(1), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = (a[i] + b[i]) / 2; return o; };

  /* ---- تقسيم تسجيل طويل إلى n مقطع حسب فترات الصمت ---- */
  async function split(file, n) {
    const buf = await decode(file), x = mono(buf), rate = buf.sampleRate, fr = Math.round(rate * .02), rms = [];
    for (let i = 0; i + fr <= x.length; i += fr) { let s = 0; for (let j = 0; j < fr; j++) s += x[i + j] * x[i + j]; rms.push(Math.sqrt(s / fr)); }
    const sorted = rms.slice().sort((a, b) => a - b), thr = Math.max(.008, sorted[Math.floor(sorted.length * .92)] * .12);
    let chunks = [], st = -1; rms.forEach((r, i) => { if (r > thr) { if (st < 0) st = i; } else if (st >= 0) { chunks.push([st, i]); st = -1; } }); if (st >= 0) chunks.push([st, rms.length]);
    const bridge = Math.round(.25 / .02), merged = []; chunks.forEach(c => { const l = merged[merged.length - 1]; if (l && c[0] - l[1] <= bridge) l[1] = c[1]; else merged.push(c.slice()); });
    chunks = merged.filter(c => c[1] - c[0] >= 12);
    const found = chunks.length;
    while (chunks.length > n) { let bi = 0, bg = 1e9; for (let i = 0; i < chunks.length - 1; i++) { const g = chunks[i + 1][0] - chunks[i][1]; if (g < bg) { bg = g; bi = i; } } chunks.splice(bi, 2, [chunks[bi][0], chunks[bi + 1][1]]); }
    const pad = Math.round(.12 / .02), out = chunks.map(c => { const a = Math.max(0, c[0] - pad) * fr, b = Math.min(rms.length, c[1] + pad) * fr; return wavBlob(x.slice(a, Math.min(x.length, b)), rate); });
    return { clips: out, found, total: buf.duration };
  }
  return { put, blob, del, buffer: getBuffer, toDataURL, fromDataURL, startRec, stopRec, split, get recording() { return !!rec; } };
})();
