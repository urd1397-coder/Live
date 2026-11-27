'use strict';
/* analysis.js — محلل النص المحلي (بدون إنترنت). يقرأ السياق لا الكلمة المفردة:
   - نفي («ما خفت») يلغي الانفعال  - تباين (مفاجأة بعد هدوء أقوى)  - تبريد (لا صراخ/ضحك متكرر)
   - عتبات أعلى للانفعالات الكبيرة حتى لا "يمثّل" الراوي بمبالغة
   عند توفر الذكاء الاصطناعي يُستخدم /api/analyze بدلاً منه (أدق)، وهذا الاحتياطي والمحلي للتوجيه اليدوي. */
const Analysis = (() => {
  const NORM = s => s.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  // s = كلمات قوية (٣ نقاط)، w = ضعيفة (١ نقطة) — مطابقة على جزء الكلمة، بأي لهجة
  const LEX_RAW = {
    laugh:   { s: ['ههه', 'قهقه', 'انفجر ضحك', 'مضحك', 'نكتة', 'lol', '😂', '🤣'], w: ['ضحك', 'طريف', 'مسخرة', 'سخيف', 'ظريف', 'هزل', 'كوميد', 'تهريج', 'فضيحة', 'عجيبه'] },
    scream:  { s: ['صرخ', 'صراخ', 'يصيح', 'النجدة', 'نجده', 'ساعدوني', 'انقذوني', 'يا ساتر'], w: ['انفجر', 'كارثه', 'مصيبه', 'يستغيث'] },
    shock:   { s: ['فجاه', 'مفاجاه', 'صدمه', 'مستحيل', 'ما صدق', 'غير معقول', 'لا يصدق', 'ذهول', 'تفاجا', 'ما توقع', 'ما كان متوقع', 'للحظه تجمد', 'تجمد', 'اكتشف'], w: ['غريب', 'عجيب', 'طلع', 'ظهر', 'مصدوم', 'لحظه', 'معقول', 'اتضح', 'تبين'] },
    angry:   { s: ['غضب', 'غاضب', 'عصب', 'مجنون', 'ظلم', 'خيانه', 'كذاب', 'وقح', 'قهر', 'احتيال', 'يكره', 'استفز', 'طرد', 'غبي', 'زباله', 'stupid'], w: ['زعل', 'رفض', 'هدد', 'لعن', 'حقير', 'مشكله', 'سيء', 'سيئ', 'غش', 'سرق'] },
    think:   { s: ['يا ترى', 'تخيل', 'لغز', 'غموض', 'محتار', 'حيره', 'رايكم', 'توقعوا', 'ليش', 'لماذا', 'كيف ممكن'], w: ['كيف', 'سر', 'ربما', 'احتمال', 'يمكن', 'سوال', 'خطه', 'فكره', 'فكر', 'تساءل', 'هل'] },
    sad:     { s: ['حزن', 'حزين', 'بكي', 'بكاء', 'دموع', 'فقد', 'وفاه', 'مات', 'رحل', 'فراق', 'حسره', 'ندم', 'وحيد', 'وحيدا'], w: ['خسر', 'خساره', 'للاسف', 'فشل', 'ضاع', 'انتهي', 'موجع', 'موجعه', 'موجعا', 'مولم', 'يايس', 'تعب', 'غاب'] },
    scared:  { s: ['خوف', 'خايف', 'خائف', 'رعب', 'مرعب', 'مخيف', 'شبح', 'يرتجف', 'ارتجف', 'مطارده', 'قاتل', 'ظلام', 'مرعوب'], w: ['هرب', 'هروب', 'اختبا', 'خطر', 'جريمه', 'صوت غريب', 'يتبعه', 'يتبعني'] },
    sassy:   { s: ['يا سلام', 'بثقه', 'عبقري', 'تحفه', 'يا شيخ', 'مغرور', 'بكل ثقه'], w: ['طبعا', 'اكيد', 'بطل', 'واو', 'ذكي', 'عظمه', 'بصراحه', 'صراحه', 'يعني'] },
    excited: { s: ['رائع', 'مدهش', 'مذهل', 'مبهر', 'فاز', 'فوز', 'نجح', 'نجاح', 'مبروك', 'انتصار', 'جايزه', 'احتفال', 'حماس', 'متحمس', 'احبك', 'love'], w: ['اخيرا', 'ممتاز', 'ربح', 'كسب', 'يلا', 'هيا', 'حب'] },
    serious: { s: ['للاسف الشديد', 'بشكل رسمي', 'الحقيقه ان', 'الخلاصه'], w: ['مهم', 'جدا', 'تحذير', 'انتبهوا', 'لاحظوا', 'السبب'] }
  };
  const NEG = new Set(['ما', 'مو', 'مش', 'لا', 'ليس', 'لم', 'لن', 'بدون', 'غير', 'ماني', 'مب', 'مافي', 'ولا'].map(NORM));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const LEX = {};
  for (const [e, o] of Object.entries(LEX_RAW)) LEX[e] = { s: o.s.map(NORM), w: o.w.map(NORM) };

  // توجيهات المخرج: [يصرخ] (يضحك) *يفكر* ... كل ما يخرج من الذكاء الاصطناعي ومن المستخدم
  const DIRECT_RAW = {
    scream: 'يصرخ|صراخ|صرخه|scream|shout', laugh: 'يضحك|ضحك|ضحكه|laugh', think: 'يفكر|تفكير|يتامل|think|hmm',
    angry: 'يغضب|غضب|غاضب|يعصب|يزعل|angry', sad: 'يبكي|حزين|حزن|يتنهد|sad|cry', shock: 'يتفاجا|صدمه|يصدم|ذهول|shock|gasp',
    scared: 'يخاف|خوف|خايف|يرتجف|مرعوب|scared', mocking: 'يسخر|سخريه|يستهزي|استهزاء|mock', sassy: 'يتباهي|ساخر|يغمز|sassy|smirk',
    excited: 'يحتفل|يتحمس|حماس|متحمس|يقفز|excited|cheer', serious: 'جاد|جدي|serious', neutral: 'عادي|طبيعي|neutral'
  };
  const DIRECT = {};
  for (const [e, p] of Object.entries(DIRECT_RAW)) DIRECT[e] = new RegExp(p);
  function directive(inner) { const t = NORM(inner); for (const e of Object.keys(DIRECT)) if (DIRECT[e].test(t)) return e; return null; }

  const TONE_BIAS = [[/ساخر/, { sassy: 1.2, laugh: .4 }], [/حماس/, { excited: 1.2 }], [/هادئ/, { think: .8 }], [/هجومي/, { angry: .9, sassy: .8 }]];
  const HIGH = new Set(['scream', 'laugh', 'angry', 'excited', 'shock']);
  const THRESH = { scream: 5, laugh: 4, angry: 3.2, excited: 3.2, shock: 3, scared: 3, sad: 3, sassy: 3, mocking: 3.4, think: 2.4, serious: 3 };

  function score(text) {
    const t = NORM(text), tokens = t.split(/\s+/).filter(Boolean), orig = text.split(/\s+/).filter(Boolean);
    const sc = {}, hits = {};
    const bump = (e, v, i) => { sc[e] = (sc[e] || 0) + v; if (i != null && orig[i]) (hits[e] = hits[e] || []).push(orig[i].replace(/[.,!؟?…،:;"«»()]/g, '')); };
    for (const [e, L] of Object.entries(LEX)) {
      for (const [list, pts] of [[L.s, 3], [L.w, 1]]) for (const stem of list) {
        if (!stem) continue;
        if (stem.includes(' ') || /[^؀-ۿ\w]/.test(stem)) { if (t.includes(stem)) bump(e, pts, tokens.findIndex(x => stem.startsWith(x))); continue; }
        for (let i = 0; i < tokens.length; i++) {
          if (!tokens[i].includes(stem)) continue;
          const negated = tokens.slice(Math.max(0, i - 2), i).some(x => NEG.has(x));
          if (!negated) bump(e, pts, i); else bump(e === 'scared' || e === 'sad' || e === 'angry' ? 'sassy' : 'neutral', .4, null);
        }
      }
    }
    const ex = (text.match(/[!！]/g) || []).length, q = /[؟?]\s*$/.test(text.trim());
    if (/ه{3,}|ha ?ha/i.test(t)) bump('laugh', 4);
    if (/(ا{3,}|ي{3,}|و{3,})/.test(t)) bump('scream', 3);
    if (ex >= 2) { bump('scream', 1.2); bump('excited', .8); } else if (ex === 1) { bump('excited', .6); bump('shock', .5); }
    if (q) bump('think', 1.6);
    if (/…|\.\.\./.test(text)) { bump('think', .5); bump('sad', .4); }
    return { sc, hits };
  }

  // تحليل مقطع واحد مع سياق المقاطع السابقة
  function analyzeOne(text, tone, history) {
    const { sc, hits } = score(text);
    for (const [re, b] of TONE_BIAS) if (re.test(tone || '')) { for (const [e, v] of Object.entries(b)) sc[e] = (sc[e] || 0) + v; break; }
    const h = history || [];
    // تباين: صدمة/صراخ بعد مقطعين هادئين أقوى
    if (h.length >= 2 && h.slice(-2).every(e => e === 'neutral' || e === 'think') && (sc.shock || sc.scream)) { sc.shock = (sc.shock || 0) + 1.4; }
    // تبريد: لا تكرر انفعالاً عالياً
    for (const e of HIGH) { const recent = h.slice(-3).filter(x => x === e).length; if (recent >= 1) sc[e] = (sc[e] || 0) * (recent >= 2 ? 0.1 : 0.55); }
    let best = 'neutral', top = 0;
    for (const e of Object.keys(THRESH)) if ((sc[e] || 0) >= THRESH[e] && sc[e] > top) { best = e; top = sc[e]; }
    const intensity = best === 'neutral' ? .3 : Math.max(.3, Math.min(1, (top - THRESH[best] * .5) / 5));
    const emphasis = (hits[best] || []).filter((w, i, a) => w && w.length > 2 && a.indexOf(w) === i).slice(0, 3);
    return { emotion: best, intensity: +intensity.toFixed(2), emphasis };
  }

  function splitSentences(line) {
    const out = [];
    for (const s of line.split(/(?<=[.!؟?…])\s+/)) {
      if (s.length <= 150) { out.push(s); continue; }
      let cur = '';
      for (const part of s.split(/(?<=[،,])\s*/)) { if ((cur + part).length > 125 && cur) { out.push(cur); cur = part; } else cur += (cur ? ' ' : '') + part; }
      if (cur) out.push(cur);
    }
    return out.map(x => x.trim()).filter(Boolean);
  }

  // النص الخام ← مقاطع {text, emotion, intensity, pause_ms, emphasis, forced}
  function parse(raw, tone) {
    const out = [], hist = []; let carry = null, prevBlank = false;
    for (const row of String(raw || '').split(/\n/)) {
      let line = row.trim();
      if (!line) { if (out.length) out[out.length - 1].pause_ms = Math.max(out[out.length - 1].pause_ms, 650); prevBlank = true; continue; }
      let forced = carry; carry = null;
      line = line.replace(/\[([^\]]*)\]|\(([^)]*)\)|\*([^*]*)\*/g, (m, a, b, c) => {
        const emo = directive(a ?? b ?? c ?? ''); if (emo) { forced = emo; return ' '; }
        return a !== undefined ? ' ' : m;   // [عنوان مشهد] لا يُقرأ
      });
      line = line.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s+/g, ' ').trim();
      if (!line || !/[\p{L}\p{N}]/u.test(line)) { if (forced) carry = forced; continue; }
      splitSentences(line).forEach((s, i) => {
        const isForced = i === 0 && !!forced;
        const a = analyzeOne(s, tone, hist);
        const emotion = isForced ? forced : a.emotion;
        const pause = /…$/.test(s) ? 520 : /[؟?]$/.test(s) ? 420 : /!$/.test(s) ? 340 : 260;
        out.push({ text: s.replace(/ه{3,}/g, 'ها ها ها'), emotion, intensity: isForced ? .85 : a.intensity, emphasis: a.emphasis, pause_ms: pause + (emotion === 'shock' || emotion === 'scream' ? 220 : 0), forced: isForced });
        hist.push(emotion);
      });
      prevBlank = false;
    }
    void prevBlank; return out;
  }

  const TAG = { neutral: null, think: 'يفكر', sassy: 'ساخر', serious: 'جاد', shock: 'يتفاجأ', scared: 'يخاف', sad: 'حزين', angry: 'يغضب', excited: 'يتحمس', laugh: 'يضحك', scream: 'يصرخ', mocking: 'يستهزئ' };
  function toText(segs) { return segs.map(s => (TAG[s.emotion] ? `[${TAG[s.emotion]}] ` : '') + s.text).join('\n\n'); }
  // مدة تقديرية للمقطع بالثواني (قبل أن يُقاس الصوت الحقيقي)
  function estimate(seg, rate = 1) { return Math.max(.8, (seg.text.length * 0.062) / rate + (seg.pause_ms || 260) / 1000); }

  return { parse, analyzeOne, toText, estimate, directive, NORM };
})();
if (typeof module !== 'undefined') module.exports = Analysis;
