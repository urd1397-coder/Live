'use strict';
/* studio.js — الخط الزمني، التشغيل، كتابة القصة بالذكاء الاصطناعي، تحليل النص، بث التعليقات */
let selSeg = -1, player = { run: 0, playing: false, idx: 0, t0: 0 }, beatTimer = 0, tickRaf = 0, aiReady = false;
const LEAD = { shock: 260, scream: 220, laugh: 180, angry: 120, scared: 140 };   // يتفاعل بوجهه قبل أن ينطق
const segs = () => P.script.segments;
const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const norm = s => ({ text: String(s.text || '').trim(), emotion: Characters.EMOS.includes(s.emotion) ? s.emotion : 'neutral', intensity: clamp(+s.intensity || .5, 0, 1), pause_ms: clamp(Number.isFinite(+s.pause_ms) ? +s.pause_ms : 280, 0, 2500), emphasis: Array.isArray(s.emphasis) ? s.emphasis.filter(w => typeof w === 'string') : [], forced: !!s.forced, voice: typeof s.voice === 'string' ? s.voice : '' });
const voiceOpts = s => ({ voice: s.voice || P.voice.key, rate: P.voice.rate, emotion: s.emotion, intensity: s.intensity, style: !!P.voice.style });

/* ---------- الخط الزمني ---------- */
function renderTimeline() {
  const tr = $('tlTrack'), list = segs(); tr.replaceChildren();
  if (!list.length) { const d = document.createElement('div'); d.className = 'tl-empty'; d.textContent = 'لا توجد مقاطع بعد. اكتب قصة من تبويب «القصة»، أو الصق نصاً وحلّله، أو أضف مقطعاً بزر ＋.'; tr.append(d); }
  let total = 0;
  list.forEach((s, i) => {
    const dur = Analysis.estimate(s, P.voice.rate); total += dur;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'blk' + (i === selSeg ? ' sel' : '') + (player.playing && i === player.idx ? ' now' : ''); b.dataset.e = s.emotion; b.dataset.i = i;
    b.style.width = Math.max(96, Math.round(dur * 46)) + 'px';
    const em = document.createElement('div'); em.className = 'em'; em.append(EMO_META[s.emotion][0] + ' ' + EMO_META[s.emotion][1]); const n = document.createElement('i'); n.textContent = i + 1; em.append(n);
    const t = document.createElement('div'); t.className = 't2'; t.textContent = s.text; if (s.voice) { const vv = Voice.listVoices().find(x => x.key === s.voice); const vb = document.createElement('div'); vb.className = 'vbadge'; vb.textContent = '🎙 ' + (vv ? vv.label : 'صوت مخصص'); b.append(em, vb, t); } else b.append(em, t); tr.append(b);
  });
  $('tlInfo').textContent = list.length ? `${list.length} مقطع · نحو ${fmt(total)}` : '';
  showSegEditor();
}
$('tlTrack').addEventListener('click', e => { const b = e.target.closest('.blk'); if (b) selectSeg(+b.dataset.i); });
function selectSeg(i, o = {}) {
  selSeg = i; document.querySelectorAll('.blk').forEach((b, k) => { b.classList.toggle('sel', k === i); b.classList.toggle('now', player.playing && k === player.idx); });
  showSegEditor(); const b = document.querySelectorAll('.blk')[i]; if (b && o.scroll) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}
function showSegEditor() {
  const s = segs()[selSeg], box = $('segEditor'); box.hidden = !s; if (!s) return;
  if (document.activeElement !== $('segText')) $('segText').value = s.text;
  fillVoiceSelect($('segVoice'), true, s.voice || ''); $('segEmo').value = s.emotion; $('segInt').value = Math.round(s.intensity * 100); $('segIntV').textContent = $('segInt').value; $('segPause').value = s.pause_ms; $('segPauseV').textContent = s.pause_ms;
}
Characters.EMOS.forEach(e => $('segEmo').add(new Option(EMO_META[e][0] + ' ' + EMO_META[e][1], e)));
const cur = () => segs()[selSeg];
const touch = (full) => { if (full) renderTimeline(); else { const b = document.querySelectorAll('.blk')[selSeg], s = cur(); if (b && s) { b.querySelector('.t2').textContent = s.text; } } syncScriptText(); save(); };
bind('segText', el => { const s = cur(); if (s) { s.text = el.value; s.forced = s.forced; touch(false); } });
bind('segEmo', el => { const s = cur(); if (s) { s.emotion = el.value; s.forced = true; touch(true); Characters.pose(s.emotion, s.intensity); Characters.fx(); } }, 'change');
bind('segVoice', el => { const s = cur(); if (s) { s.voice = el.value; touch(true); setStatus(el.value ? 'تغيّر الصوت عند هذا المقطع' : 'عاد للصوت الافتراضي'); } }, 'change');
$('segVoiceFrom').onclick = () => { const s = cur(); if (!s) return; const v = s.voice || ''; segs().slice(selSeg).forEach(x => { x.voice = v; }); touch(true); setStatus(v ? 'طُبّق هذا الصوت من هنا حتى نهاية الفيديو' : 'عاد كل ما بعد هذا المقطع للصوت الافتراضي'); };
bind('segInt', el => { const s = cur(); if (s) { s.intensity = el.value / 100; $('segIntV').textContent = el.value; save(); } });
bind('segPause', el => { const s = cur(); if (s) { s.pause_ms = +el.value; $('segPauseV').textContent = el.value; save(); } });
$('segPreview').onclick = () => { const s = cur(); if (!s) return; Characters.pose(s.emotion, s.intensity); Characters.fx(); setCaption(s.text, s.emphasis); setTimeout(() => { if (!player.playing) { Characters.pose('neutral'); setCaption('', []); } }, 2200); };
$('segPlay').onclick = () => playFrom(selSeg);
$('segAnalyze').onclick = () => { const s = cur(); if (!s) return; const h = segs().slice(0, selSeg).map(x => x.emotion), a = Analysis.analyzeOne(s.text, P.script.tone, h); s.emotion = a.emotion; s.intensity = a.intensity; s.emphasis = a.emphasis; s.forced = false; touch(true); };
$('segSplit').onclick = () => { const s = cur(), ta = $('segText'); if (!s) return; const p = ta.selectionStart; if (p <= 0 || p >= s.text.length) { setStatus('ضع المؤشر داخل النص حيث تريد التقسيم'); return; } const a = s.text.slice(0, p).trim(), b = s.text.slice(p).trim(); if (!a || !b) return; s.text = a; segs().splice(selSeg + 1, 0, norm({ ...s, text: b, emotion: 'neutral', intensity: .4, forced: false })); touch(true); };
$('segUp').onclick = () => { if (selSeg > 0) { const l = segs(); [l[selSeg - 1], l[selSeg]] = [l[selSeg], l[selSeg - 1]]; selSeg--; touch(true); } };
$('segDown').onclick = () => { const l = segs(); if (selSeg >= 0 && selSeg < l.length - 1) { [l[selSeg + 1], l[selSeg]] = [l[selSeg], l[selSeg + 1]]; selSeg++; touch(true); } };
$('segDel').onclick = () => { if (selSeg < 0) return; segs().splice(selSeg, 1); selSeg = Math.min(selSeg, segs().length - 1); touch(true); };
$('tlAdd').onclick = () => { segs().splice(selSeg + 1, 0, norm({ text: 'مقطع جديد', emotion: 'neutral' })); selSeg = selSeg + 1; touch(true); $('segText').focus(); };
function syncScriptText() { if (document.activeElement !== $('scriptText')) $('scriptText').value = Analysis.toText(segs()); }
function setSegments(list, keepSel) { P.script.segments = list.map(norm).filter(s => s.text); if (!keepSel) selSeg = P.script.segments.length ? 0 : -1; renderTimeline(); syncScriptText(); $('fbBox').hidden = !P.script.segments.length; save(); }

/* ---------- التشغيل ---------- */
function setPlayBtn() { $('tPlay').textContent = player.playing ? '⏸ إيقاف مؤقت' : '▶ تشغيل'; }
function stopBeats() { clearInterval(beatTimer); beatTimer = 0; }
function stopPlayback() { $('loadOv').hidden = true; player.run++; player.playing = false; Voice.cancel(); stopBeats(); cancelAnimationFrame(tickRaf); Characters.speaking(false); Characters.level(null); setPlayBtn(); document.querySelectorAll('.blk').forEach(b => { b.classList.remove('now'); b.style.removeProperty('--p'); }); }
function tick() {
  if (!player.playing) return; $('tTime').textContent = fmt((performance.now() - player.t0) / 1000);
  const b = document.querySelectorAll('.blk')[player.idx]; if (b) { const s = segs()[player.idx], el = (performance.now() - player.segT0) / 1000; b.style.setProperty('--p', clamp(el / Analysis.estimate(s, P.voice.rate), 0, 1)); }
  tickRaf = requestAnimationFrame(tick);
}
async function playFrom(i) {
  const list = segs(); if (!list.length) { setStatus('لا يوجد نص للتشغيل بعد'); return; }
  stopPlayback(); const id = ++player.run; player.playing = true; player.t0 = performance.now(); Voice.unlock(); setPlayBtn(); tick();
  { const from = clamp(i, 0, list.length - 1), items = list.slice(from).map(x => ({ text: x.text, opts: voiceOpts(x) }));
    const showLoad = (n, t) => { if (id !== player.run) return; $('loadOv').hidden = false; $('loadTxt').textContent = `جارٍ تحميل الفيديو (صوت وصورة)… ${n}/${t}`; $('loadBar').style.width = (t ? n / t * 100 : 0) + '%'; setStatus(`جارٍ التحميل ${n}/${t}`); };
    if (Voice.serverOn && items.length) showLoad(0, items.length);
    const failed = await Voice.prepare(items, showLoad, items.length); $('loadOv').hidden = true;
    if (id !== player.run) return; if (failed) setStatus(`⚠️ تعذّر تجهيز صوت ${failed} مقطع، وسيُقرأ بصوت المتصفح بدلاً منه`); }
  for (let k = clamp(i, 0, list.length - 1); k < list.length; k++) {
    if (id !== player.run) return; player.idx = k; player.segT0 = performance.now(); selectSeg(k, { scroll: true });
    const s = list[k], nxt = list[k + 1]; setStatus(`المقطع ${k + 1} من ${list.length} · ${EMO_META[s.emotion][0]} ${EMO_META[s.emotion][1]}`);
    setCaption(s.text, s.emphasis); Characters.pose(s.emotion, s.intensity); if (s.emotion !== 'neutral' && s.intensity > .55) Characters.fx();
    Voice.prefetch(s.text, voiceOpts(s)); if (nxt) Voice.prefetch(nxt.text, voiceOpts(nxt));   // نبدأ توليد الصوت قبل مهلة التفاعل كي لا يتأخر
    if (LEAD[s.emotion]) { await wait(LEAD[s.emotion]); if (id !== player.run) return; }
    Characters.speaking(true); stopBeats(); Characters.beat(); beatTimer = setInterval(Characters.beat, 800);
    if (list[k + 2]) Voice.prefetch(list[k + 2].text, voiceOpts(list[k + 2]));
    await Voice.speak(s.text, { ...voiceOpts(s), onLevel: v => Characters.level(v) });
    if (id !== player.run) return; Characters.speaking(false); stopBeats(); Characters.rest();
    await wait(s.pause_ms); if (id !== player.run) return;
    const bk = document.querySelectorAll('.blk')[k]; if (bk) bk.style.setProperty('--p', 1);
  }
  if (id === player.run) { stopPlayback(); Characters.pose('neutral'); setCaption('', []); setStatus('انتهى العرض'); }
}
$('tPlay').onclick = () => { if (player.playing) { const at = player.idx; stopPlayback(); selSeg = at; setStatus('متوقف مؤقتاً'); } else playFrom(selSeg >= 0 ? selSeg : 0); };
$('tStop').onclick = () => { stopPlayback(); Characters.pose('neutral'); setCaption('', []); $('tTime').textContent = '0:00'; setStatus('جاهز'); };

/* ---------- القصة بالذكاء الاصطناعي ---------- */
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let d = {}; try { d = await r.json(); } catch (e) { /* ليس JSON */ }
  if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : r.status === 422 ? 'الموضوع قصير جداً، اكتب فكرة أوضح.' : 'خطأ من الخادم (' + r.status + ')'); return d;
}
const params = () => ({ topic: $('topic').value.trim(), kind: P.script.kind, tone: $('tone').value, dialect: $('dialect').value, length: +$('len').value, notes: $('notes').value.trim() });
function storeStory() { Object.assign(P.script, { topic: $('topic').value, tone: $('tone').value, dialect: $('dialect').value, len: +$('len').value, notes: $('notes').value }); save(); }
['topic', 'notes'].forEach(id => bind(id, storeStory)); ['tone', 'dialect'].forEach(id => bind(id, storeStory, 'change')); bind('len', el => { $('lenV').textContent = el.value; storeStory(); });
$('kindBtns').addEventListener('click', e => { const b = e.target.closest('button[data-kind]'); if (!b) return; P.script.kind = b.dataset.kind; document.querySelectorAll('#kindBtns button').forEach(x => x.classList.toggle('on', x === b)); save(); });
function syncStoryCtl() {
  const s = P.script; $('topic').value = s.topic || ''; $('tone').value = s.tone; $('dialect').value = s.dialect; $('len').value = s.len; $('lenV').textContent = s.len; $('notes').value = s.notes || '';
  document.querySelectorAll('#kindBtns button').forEach(x => x.classList.toggle('on', x.dataset.kind === s.kind)); if (s.bible) fillBible(s.bible); syncScriptText(); $('fbBox').hidden = !segs().length;
}
function fillBible(b) {
  $('plotCard').hidden = false; $('bTitle').value = b.title || ''; $('bLogline').value = b.logline || ''; $('bHook').value = b.hook || ''; $('bStakes').value = b.stakes || ''; $('bTwist').value = b.twist || ''; $('bEnding').value = b.ending_image || '';
  $('bBeats').value = (b.beats || []).map(x => typeof x === 'string' ? x : x.what_happens || '').join('\n');
}
function readBible() {
  const b = P.script.bible || {}; Object.assign(b, { title: $('bTitle').value, logline: $('bLogline').value, hook: $('bHook').value, stakes: $('bStakes').value, twist: $('bTwist').value, ending_image: $('bEnding').value });
  const old = b.beats || []; b.beats = $('bBeats').value.split('\n').map(x => x.trim()).filter(Boolean).map((t, i) => ({ ...(typeof old[i] === 'object' ? old[i] : {}), what_happens: t })); P.script.bible = b; return b;
}
const STEPS = [['plot', '① بناء الحبكة والشخصيات'], ['write', '② كتابة السرد'], ['polish', '③ مراجعة المحرر وإصلاح الضعف']];
function progress(state) {
  const box = $('progress'); box.hidden = false; box.replaceChildren();
  for (const [k, label] of STEPS) { const d = document.createElement('div'); const st = state[k] || ''; d.className = st; d.textContent = (st === 'done' ? '✅ ' : st === 'run' ? '⏳ ' : st === 'err' ? '⚠️ ' : '▫️ ') + label + (state[k + 'Msg'] ? ' — ' + state[k + 'Msg'] : ''); box.append(d); }
}
let busy = false;
async function guard(fn) { if (busy) return; busy = true; document.querySelectorAll('#btnFull,#btnPlot,#btnWrite,#btnPolish,#btnAnalyzeAI').forEach(b => b.disabled = true); try { await fn(); } finally { busy = false; applyAiState(); } }
function needTopic() { if (params().topic.length < 2) { setStatus('اكتب الموضوع أولاً'); $('topic').focus(); return true; } return false; }
async function stagePlot(st) { st.plot = 'run'; progress(st); const d = await api('/api/story/plot', params()); P.script.bible = d.bible; fillBible(d.bible); st.plot = 'done'; progress(st); save(); }
async function stageWrite(st) { st.write = 'run'; progress(st); const b = readBible(), d = await api('/api/story/write', { bible: b, kind: P.script.kind, tone: $('tone').value, dialect: $('dialect').value, length: +$('len').value, preferences: prefsText() }); setSegments(d.segments); st.write = 'done'; progress(st); }
async function stagePolish(st) { st.polish = 'run'; progress(st); const d = await api('/api/story/polish', { bible: readBible(), segments: segs().map(({ text, emotion, intensity, pause_ms, emphasis }) => ({ text, emotion, intensity, pause_ms, emphasis })), dialect: $('dialect').value }); setSegments(d.segments); showIssues(d.issues); st.polish = 'done'; progress(st); }
function showIssues(list) { const c = $('issuesCard'), u = $('issuesList'); u.replaceChildren(); (list || []).forEach(t => { const li = document.createElement('li'); li.textContent = t; u.append(li); }); c.hidden = !(list && list.length); }
const fail = (st, k, e) => { st[k] = 'err'; st[k + 'Msg'] = e.message; progress(st); setStatus(e.message); };
$('btnPlot').onclick = () => { if (needTopic()) return; guard(async () => { const st = {}; try { await stagePlot(st); } catch (e) { fail(st, 'plot', e); } }); };
$('btnWrite').onclick = () => guard(async () => { const st = {}; if (!P.script.bible) { setStatus('ابنِ الحبكة أولاً'); return; } try { await stageWrite(st); } catch (e) { fail(st, 'write', e); } });
$('btnPolish').onclick = () => guard(async () => { const st = {}; if (!segs().length) { setStatus('لا يوجد نص للمراجعة'); return; } try { await stagePolish(st); } catch (e) { fail(st, 'polish', e); } });
$('btnFull').onclick = () => { if (needTopic()) return; guard(async () => {
  const st = {}; try { await stagePlot(st); } catch (e) { return fail(st, 'plot', e); }
  try { await stageWrite(st); } catch (e) { return fail(st, 'write', e); }
  try { await stagePolish(st); } catch (e) { st.polish = 'err'; st.polishMsg = 'تعذّرت المراجعة، النص الأول محفوظ: ' + e.message; progress(st); }
  openTab('story'); setStatus('القصة جاهزة، اضغط تشغيل'); }); };
$('btnAnalyzeAI').onclick = () => guard(async () => { const t = $('scriptText').value.trim(); if (!t) return; setStatus('الذكاء الاصطناعي يحلل النص…'); try { const d = await api('/api/analyze', { text: t, tone: $('tone').value }); setSegments(d.segments); setStatus('تم التحليل'); } catch (e) { setStatus(e.message); } });
$('btnAnalyzeLocal').onclick = () => { const t = $('scriptText').value.trim(); if (!t) return; setSegments(Analysis.parse(t, $('tone').value)); setStatus('تم التحليل محلياً'); };
function applyAiState() { for (const id of ['btnFull', 'btnPlot', 'btnWrite', 'btnPolish', 'btnAnalyzeAI']) $(id).disabled = !aiReady; }
$('btnAnalyzeAI').hidden = true;
function setStoryMode(m) { document.querySelectorAll('#storyMode .type').forEach(b => b.classList.toggle('on', b.dataset.sm === m)); $('smOwn').hidden = m !== 'own'; $('smAi').hidden = m !== 'ai'; }
$('storyMode').addEventListener('click', e => { const b = e.target.closest('[data-sm]'); if (b) setStoryMode(b.dataset.sm); });
(async () => { try { const s = await (await fetch('/api/state')).json(); aiReady = !!s.ai_ready; } catch (e) { aiReady = false; }
  const b = $('aiBanner'); b.hidden = false; b.className = aiReady ? 'banner ok' : 'banner warn';
  b.textContent = aiReady ? 'الكاتب الذكي جاهز: حبكة ثم سرد ثم مراجعة.' : 'هذه الميزة تحتاج مفتاح ذكاء اصطناعي. الأسهل والمجاني: مفتاح Gemini من aistudio.google.com/apikey، ضعه في Render باسم GEMINI_API_KEY ثم أعد النشر. حتى ذلك الحين استخدم «عندي نص جاهز».';
  applyAiState(); $('btnAnalyzeAI').hidden = !aiReady; if (aiReady && !segs().length) setStoryMode('ai'); })();

/* ذاكرة الأسلوب: تقييمك يُرسل للكاتب في الكتابات القادمة */
const MEM = 'live-story-style-memory-v2';
const memLoad = () => { try { return JSON.parse(localStorage.getItem(MEM)) || { good: [], bad: [] }; } catch (e) { return { good: [], bad: [] }; } };
function prefsText() { const m = memLoad(), out = []; if (m.good.length) out.push('أعجبني: ' + m.good.slice(-3).join(' | ')); if (m.bad.length) out.push('لم يعجبني، تجنّبه: ' + m.bad.slice(-3).join(' | ')); return out.join('\n'); }
function rate(good) { const sample = segs().slice(0, 4).map(s => s.text).join(' ').slice(0, 220), m = memLoad(); (good ? m.good : m.bad).push(sample); try { localStorage.setItem(MEM, JSON.stringify({ good: m.good.slice(-5), bad: m.bad.slice(-5) })); } catch (e) { /* ممتلئ */ } setStatus(good ? 'شكراً، سأتذكر هذا الأسلوب' : 'سأتجنب هذا الأسلوب في المرة القادمة'); }
$('fbGood').onclick = () => rate(true); $('fbBad').onclick = () => rate(false);

/* ---------- بث: ردود التعليقات ---------- */
const MODES = ['Funny', 'Sassy', 'Serious', 'Furious', 'Freaked Out', 'Mocking'], MODE_EMO = { Funny: 'laugh', Sassy: 'sassy', Serious: 'serious', Furious: 'angry', 'Freaked Out': 'scared', Mocking: 'mocking' };
let liveMode = 'Funny';
MODES.forEach(m => { const b = document.createElement('button'); b.type = 'button'; b.textContent = m; b.className = m === liveMode ? 'on' : ''; b.onclick = () => { liveMode = m; document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b)); Characters.pose(MODE_EMO[m], .8); setStatus('تم تغيير الشخصية: ' + m); fetch('/api/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) }).catch(() => {}); }; $('modes').append(b); });
const REPLIES = { laugh: ['هههه ضحكتني! كمّل.'], scream: ['يا ساتر! خففوا علي شوي!'], angry: ['وصلت الملاحظة. عندك شي مفيد ولا بس تفريغ؟'], think: ['سؤال محترم… خليني أفكر شوي.'], shock: ['لحظة لحظة! هذا اللي كتبته فعلاً؟'], sad: ['خلينا نرجع نرفع المعنويات شوي.'], scared: ['لا تخوفوني! كنت جاي أرتاح.'], excited: ['أخيراً تعليق يرفع المعنويات!'], sassy: ['يا سلام على التعليق… داخل بثقة كأنك دافع إيجار الاستوديو.'], neutral: ['شكراً على التعليق، وصلت الفكرة.'] };
function reactTo(msg) {
  let emo = Analysis.analyzeOne(msg, '', []).emotion, r = REPLIES[emo] || REPLIES.neutral, reply = r[Math.floor(Math.random() * r.length)];
  if (liveMode === 'Furious') { emo = 'angry'; reply = 'يا حبيبي، ' + reply + ' خفّ علينا شوي!'; } else if (liveMode === 'Serious') { emo = 'serious'; reply = 'خلينا نركز: ' + msg.slice(0, 80) + '. نقطة تستحق نقاشاً.'; }
  else if (liveMode === 'Mocking') { emo = 'mocking'; reply = 'واو… ' + msg.slice(0, 80) + '. استغرقت وقتاً طويلاً لتكتب هذه التحفة؟'; } else if (liveMode === 'Freaked Out') emo = 'scared'; else if (emo === 'neutral') emo = 'sassy';
  return { emo, reply };
}
async function handleComment(msg) {
  if (!msg.trim()) return; const { emo, reply } = reactTo(msg.trim()); stopPlayback(); Voice.unlock();
  const it = document.createElement('div'); it.className = 'feeditem'; it.innerHTML = '<div class="viewer"></div><div class="reply"></div><div class="emotion"></div>';
  it.querySelector('.viewer').textContent = '💬 ' + msg; it.querySelector('.reply').textContent = 'Live: ' + reply; it.querySelector('.emotion').textContent = 'ردة الفعل: ' + EMO_META[emo][0] + ' ' + EMO_META[emo][1];
  $('feed').replaceChildren(it); setCaption(reply, []); Characters.pose(emo, .85); Characters.fx(); if (LEAD[emo]) await wait(LEAD[emo]);
  Characters.speaking(true); await Voice.speak(reply, { voice: P.voice.key, rate: P.voice.rate, emotion: emo, intensity: .7, onLevel: v => Characters.level(v) }); Characters.speaking(false); await wait(500); Characters.pose('neutral'); setCaption('', []);
  fetch('/api/chat/mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg }) }).catch(() => {});
}
$('send').onclick = () => { handleComment($('chat').value); $('chat').value = ''; };
$('chat').addEventListener('keydown', e => { if (e.key === 'Enter') $('send').click(); });


/* ---------- كتابة القصة عبر Gemini Chat (نسخ ولصق) ---------- */
function setWay(w) {
  document.querySelectorAll('#aiWay .type').forEach(b => b.classList.toggle('on', b.dataset.way === w));
  $('wayChat').hidden = w !== 'chat'; for (const id of ['btnFull', 'fullHint']) $(id).hidden = w !== 'api'; if (w !== 'api') $('progress').hidden = true;
}
$('aiWay').addEventListener('click', e => { const b = e.target.closest('[data-way]'); if (b) setWay(b.dataset.way); });
$('btnCopyPrompt').onclick = async () => {
  const topic = $('topic').value.trim(); if (topic.length < 2) { setStatus('اكتب الموضوع أولاً'); $('topic').focus(); return; }
  try {
    const r = await (await fetch('/api/story/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, tone: $('tone').value, dialect: $('dialect').value, kind: P.script.kind || 'story', length: +$('len').value, notes: $('notes').value }) })).json();
    if (!r.prompt) throw new Error(r.detail || 'تعذّر');
    try { await navigator.clipboard.writeText(r.prompt); setStatus('✅ نُسخت التعليمات. افتح Gemini والصقها'); }
    catch (e) { $('pasteBack').value = r.prompt; setStatus('انسخ التعليمات من خانة اللصق ثم الصقها في Gemini'); }
  } catch (e) { setStatus('تعذّر: ' + e.message); }
};
$('btnImport').onclick = async () => {
  const raw = $('pasteBack').value.trim(); if (raw.length < 10) { setStatus('الصق رد Gemini أولاً'); return; }
  try {
    const r = await (await fetch('/api/story/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) })).json();
    if (!r.ok) throw new Error(r.detail || 'تعذّر');
    if (r.plain) { $('scriptText').value = r.script; setStoryMode('own'); $('btnAnalyzeLocal').click(); setStatus('لم أجد JSON، عوملت كنص عادي وحُلّل محلياً'); return; }
    setSegments(r.segments); const notes = [...(r.issues || []).map(x => 'أُصلح: ' + x), ...(r.lint || []).map(x => 'تنبيه: ' + x)];
    if (notes.length) { $('issuesCard').hidden = false; $('issuesList').replaceChildren(...notes.map(t => Object.assign(document.createElement('li'), { textContent: t }))); }
    setStatus(`أُدخلت القصة: ${r.segments.length} مقطع. اضغط ▶ تشغيل`);
  } catch (e) { setStatus('تعذّر الإدخال: ' + e.message); }
};
setWay('chat');
