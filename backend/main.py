"""Live Studio API.

- /api/story/plot   : المرحلة 1، مهندس الحبكة يبني "كتاب القصة" (شخصيات، رهانات، زرع وحصاد، مفاجأة، نهاية)
- /api/story/write  : المرحلة 2، الكاتب يحوّل الحبكة إلى سرد منطوق مقسّم لمقاطع مع انفعال لكل مقطع
- /api/story/polish : المرحلة 3، ناقد يفحص النص مقابل قائمة جودة ويعيد كتابة الضعيف
- /api/analyze      : تحليل نص جاهز إلى انفعالات وشدة ووقفات
- /api/tts          : صوت عصبي اختياري (ElevenLabs أو OpenAI أو edge-tts)، والمتصفح احتياطي

مزوّد النموذج يتحدد بمتغيرات البيئة:
  ANTHROPIC_API_KEY (+ ANTHROPIC_MODEL, ANTHROPIC_BASE_URL)  أو  OPENAI_API_KEY (+ OPENAI_MODEL)
"""
import io
from collections import OrderedDict
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

app = FastAPI(title='Live', version='0.5.0')
app.add_middleware(CORSMiddleware, allow_origins=[], allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])
ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'

EMOTIONS = ['neutral', 'think', 'sassy', 'serious', 'shock', 'scared', 'sad', 'angry', 'excited', 'laugh', 'scream', 'mocking']
MODES = ['Funny', 'Sassy', 'Serious', 'Furious', 'Freaked Out', 'Mocking']
state = {'mode': 'Funny', 'message': 'Live is ready.', 'connected': False}


# ------------------------------------------------------------------ نماذج الطلبات
class ModeRequest(BaseModel):
    mode: str = Field(min_length=1, max_length=30)


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class PlotRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=6000)
    kind: str = Field(default='story', max_length=30)
    tone: str = Field(default='ساخر وخفيف', max_length=80)
    dialect: str = Field(default='بيضاء', max_length=40)
    length: int = Field(default=16, ge=6, le=40)        # عدد المقاطع المستهدف
    notes: str = Field(default='', max_length=1500)


class WriteRequest(BaseModel):
    bible: Dict[str, Any]
    kind: str = Field(default='story', max_length=30)
    tone: str = Field(default='ساخر وخفيف', max_length=80)
    dialect: str = Field(default='بيضاء', max_length=40)
    length: int = Field(default=16, ge=6, le=40)
    preferences: str = Field(default='', max_length=2500)


class PolishRequest(BaseModel):
    bible: Dict[str, Any]
    segments: List[Dict[str, Any]]
    dialect: str = Field(default='بيضاء', max_length=40)


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    tone: str = Field(default='', max_length=80)


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=700)
    voice: str = Field(default='', max_length=80)
    rate: float = Field(default=1.0, ge=0.5, le=1.6)
    emotion: str = Field(default='neutral', max_length=20)
    intensity: float = Field(default=0.6, ge=0.0, le=1.0)


# ------------------------------------------------------------------ مزوّد النموذج
def provider() -> Optional[str]:
    if os.getenv('ANTHROPIC_API_KEY'):
        return 'anthropic'
    if os.getenv('OPENAI_API_KEY'):
        return 'openai'
    return None


def _post_json(url: str, headers: Dict[str, str], body: Dict[str, Any], timeout: int = 100) -> Dict[str, Any]:
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', **headers}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def call_llm(system: str, user: str, max_tokens: int = 3500, temperature: float = 0.9) -> str:
    prov = provider()
    if not prov:
        raise HTTPException(503, 'الكتابة بالذكاء الاصطناعي تحتاج مفتاحاً: أضف ANTHROPIC_API_KEY (أو OPENAI_API_KEY) في متغيرات البيئة على Render ثم أعد النشر.')
    try:
        if prov == 'anthropic':
            base = os.getenv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com').rstrip('/')
            data = _post_json(base + '/v1/messages', {
                'x-api-key': os.environ['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01'}, {
                'model': os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
                'max_tokens': max_tokens, 'temperature': temperature,
                'system': system, 'messages': [{'role': 'user', 'content': user}]})
            return ''.join(b.get('text', '') for b in data.get('content', []) if b.get('type') == 'text').strip()
        data = _post_json('https://api.openai.com/v1/responses', {
            'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY']}, {
            'model': os.getenv('OPENAI_MODEL', 'gpt-4.1'), 'instructions': system, 'input': user,
            'max_output_tokens': max_tokens, 'temperature': temperature, 'store': False})
        out = []
        for item in data.get('output', []):
            if item.get('type') == 'message':
                out += [p.get('text', '') for p in item.get('content', []) if p.get('type') == 'output_text']
        return '\n'.join(out).strip()
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            detail = json.loads(exc.read().decode('utf-8')).get('error', {}).get('message', '')
        except Exception:  # noqa: BLE001
            pass
        if exc.code in (401, 403):
            raise HTTPException(502, 'المفتاح مرفوض من مزوّد الذكاء الاصطناعي. تأكد من قيمة المفتاح في Render.')
        if exc.code == 404 or 'model' in detail.lower():
            raise HTTPException(502, 'اسم النموذج غير صحيح أو غير متاح لحسابك. اضبط ANTHROPIC_MODEL (أو OPENAI_MODEL). تفاصيل: ' + detail[:160])
        if exc.code == 429:
            raise HTTPException(502, 'تجاوزت حد الاستخدام أو الرصيد عند المزوّد. انتظر قليلاً أو راجع رصيد حسابك.')
        raise HTTPException(502, f'خطأ من مزوّد الذكاء الاصطناعي ({exc.code}). {detail[:160]}')
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(502, 'تعذّر الاتصال بمزوّد الذكاء الاصطناعي أو انتهت المهلة. جرّب مرة ثانية.')


def extract_json(text: str) -> Any:
    """يستخرج أول كائن/مصفوفة JSON من رد النموذج حتى لو لُفّ بشرح أو بسياج markdown."""
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip(), flags=re.I)
    for opener, closer in (('{', '}'), ('[', ']')):
        start = text.find(opener)
        if start < 0:
            continue
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                esc = (ch == '\\' and not esc)
                if ch == '"' and not esc:
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    raise ValueError('no json')


def llm_json(system: str, user: str, max_tokens: int = 3500, temperature: float = 0.9) -> Any:
    raw = call_llm(system, user, max_tokens, temperature)
    try:
        return extract_json(raw)
    except ValueError:
        fixed = call_llm('أعد المحتوى التالي كـ JSON صالح فقط، بدون أي شرح أو سياج كود، وبدون تغيير المعنى.', raw[:12000], max_tokens, 0)
        try:
            return extract_json(fixed)
        except ValueError:
            raise HTTPException(502, 'رجع النموذج ناتجاً غير مفهوم. جرّب مرة ثانية.')


def clean_segments(items: Any, limit: int = 60) -> List[Dict[str, Any]]:
    if isinstance(items, dict):
        items = items.get('segments') or items.get('script') or []
    out = []
    for it in items if isinstance(items, list) else []:
        if isinstance(it, str):
            it = {'text': it}
        if not isinstance(it, dict):
            continue
        text = re.sub(r'\s+', ' ', str(it.get('text', ''))).strip()
        if not text:
            continue
        emo = str(it.get('emotion', 'neutral')).strip().lower()
        if emo not in EMOTIONS:
            emo = 'neutral'
        try:
            inten = max(0.0, min(1.0, float(it.get('intensity', 0.5))))
        except (TypeError, ValueError):
            inten = 0.5
        try:
            pause = int(max(0, min(2500, int(it.get('pause_ms', 280)))))
        except (TypeError, ValueError):
            pause = 280
        emph = [str(w) for w in (it.get('emphasis') or []) if isinstance(w, (str, int)) and str(w) in text][:4]
        out.append({'text': text[:400], 'emotion': emo, 'intensity': round(inten, 2), 'pause_ms': pause, 'emphasis': emph})
        if len(out) >= limit:
            break
    return out


def segments_to_script(segs: List[Dict[str, Any]]) -> str:
    label = {'neutral': None, 'think': 'يفكر', 'sassy': 'يسخر', 'serious': 'جاد', 'shock': 'يتفاجأ', 'scared': 'يخاف',
             'sad': 'حزين', 'angry': 'يغضب', 'excited': 'يتحمس', 'laugh': 'يضحك', 'scream': 'يصرخ', 'mocking': 'يستهزئ'}
    lines = []
    for s in segs:
        tag = label.get(s['emotion'])
        lines.append((f'[{tag}] ' if tag else '') + s['text'])
    return '\n\n'.join(lines)


# ------------------------------------------------------------------ تعليمات الكتابة
CRAFT = """You are a master storyteller and script doctor for an Arabic video creator whose animated host narrates to camera.
Your job is plots that grip people. Non-negotiable craft rules:
- Causality: beats connect with "therefore" or "but", never "and then". Every turn is caused by a choice the protagonist makes.
- A specific protagonist who WANTS something concrete, has a FLAW that gets in the way, and faces rising, concrete stakes (name what is lost).
- A hook in the first two sentences that opens a question the audience needs answered. Never open with greetings or "listen to this story".
- Plant and pay off: at least two small concrete details seeded early must return transformed later. The twist must be fair, recontextualizing something already shown, never a random reveal.
- Midpoint reversal that changes what the protagonist wants or believes; a real dark moment where the plan fails; a final choice that shows who they became; a final image that lingers.
- Concrete over abstract: names, objects, numbers, places, sounds. No generic words like "something strange". No moralizing summary at the end.
- Avoid cliches (it was all a dream, everyone was dead, a letter from the past, and they lived happily). Avoid filler laughter, fake shouting and fake excitement in the text itself.
- Never present invented facts about real people as true. Fictional characters get fictional names unless the user supplied a real story and asked to retell it."""

DIALECT_NOTE = ('اكتب بلهجة «{d}» محكية طبيعية كما يحكي إنسان لجمهوره، لا بفصحى جامدة ولا بأمثال محفوظة. '
                'جمل قصيرة تُقال بنفَس واحد، وتنويع في الإيقاع بين القصير والأطول.')

KIND_GUIDE = {
    'story': 'نوع العمل: قصة تُروى بحبكة كاملة (بداية، تصعيد، منتصف يقلب الأمور، لحظة أسوأ، ذروة، نهاية).',
    'commentary': 'نوع العمل: تعليق وتحليل. ابنِه كحجة مشوّقة: فرضية مفاجئة، أدلة محددة تتصاعد، اعتراض مضاد وردّه، خلاصة تغيّر نظرة المشاهد. لا مبالغة ولا اتهامات بلا دليل.',
    'reaction': 'نوع العمل: ردة فعل على مادة قدّمها المستخدم. اتبع تسلسل المادة، وعلّق بصدق عند كل نقطة تحوّل، وأظهر تطور شعور الراوي من الفضول إلى الدهشة أو الاعتراض.'
}

BIBLE_SCHEMA = """{
 "title": "عنوان جذاب قصير",
 "logline": "جملة واحدة: من يريد ماذا، وما الذي يعترض طريقه، وما الثمن",
 "hook": "الجملة الأولى التي ستُحكى (تفتح سؤالاً)",
 "protagonist": {"name": "", "want": "", "flaw": "", "secret": ""},
 "opposition": "القوة أو الشخص الذي يقف في الطريق ولماذا",
 "stakes": "ما الذي سيُخسر تحديداً",
 "setups": [{"plant": "تفصيلة تُزرع مبكراً", "payoff": "كيف تعود لاحقاً بمعنى مختلف"}],
 "beats": [{"act": 1, "what_happens": "", "cause_of_next": "لذلك/لكن...", "narrator_feeling": "neutral|think|sassy|serious|shock|scared|sad|angry|excited|laugh|scream|mocking"}],
 "midpoint_reversal": "",
 "dark_moment": "",
 "twist": "مفاجأة عادلة تعيد تفسير ما سبق",
 "ending_image": "الصورة الأخيرة",
 "motif": "تفصيلة متكررة تربط القصة"
}"""

SEGMENT_SCHEMA = """{"segments":[{"text":"جملة أو جملتان تُقالان بنفَس واحد","emotion":"neutral|think|sassy|serious|shock|scared|sad|angry|excited|laugh|scream|mocking","intensity":0.0-1.0,"pause_ms":150-900,"emphasis":["كلمة تُشدَّد"]}]}"""

EMOTION_GUIDE = """Emotion tagging is about the NARRATOR's honest reaction to that line, not the characters'. Most lines are neutral or think (about 60%). Use shock/scared/angry/sad/excited only at real turns with matching intensity. scream and laugh at most once or twice each in the whole piece and only when the moment earns it. Never tag a line laugh because it merely contains a joke word. pause_ms is the silence AFTER the line: short for flow (150-300), long before a reveal (600-900)."""


def story_system(kind: str, dialect: str) -> str:
    return CRAFT + '\n' + KIND_GUIDE.get(kind, KIND_GUIDE['story']) + '\n' + DIALECT_NOTE.format(d=dialect)


# ------------------------------------------------------------------ المسارات
@app.get('/api/state')
def get_state():
    tts = []
    if os.getenv('ELEVENLABS_API_KEY'):
        tts.append('elevenlabs')
    if os.getenv('OPENAI_API_KEY'):
        tts.append('openai')
    try:
        import edge_tts  # noqa: F401
        tts.append('edge')
    except Exception:  # noqa: BLE001
        pass
    return {**state, 'modes': MODES, 'ai_provider': provider(), 'ai_ready': bool(provider()), 'tts': tts,
            'voices': voice_catalog(tts)}


@app.post('/api/mode')
def set_mode(req: ModeRequest):
    if req.mode not in MODES:
        raise HTTPException(status_code=400, detail='Unknown mode')
    state['mode'] = req.mode
    state['message'] = f'Mode switched to {req.mode}.'
    return {'ok': True, **state}


@app.post('/api/story/plot')
def story_plot(req: PlotRequest):
    user = (f'الموضوع أو المادة من المستخدم:\n"""\n{req.topic}\n"""\n\n'
            f'النبرة: {req.tone}\nعدد المقاطع المنطوقة المتوقع لاحقاً: {req.length}\n'
            f'ملاحظات المستخدم: {req.notes or "لا شيء"}\n\n'
            'ابنِ «كتاب القصة» كاملاً قبل الكتابة. اجعل الأفكار غير متوقعة وليست أول ما يخطر، وفكّر في الثمن العاطفي. '
            'beats من 8 إلى 11 نبضة، وsetups لا تقل عن اثنين. '
            'أخرج JSON فقط بهذا الشكل بالضبط:\n' + BIBLE_SCHEMA)
    bible = llm_json(story_system(req.kind, req.dialect), user, 3000, 1.0)
    if not isinstance(bible, dict) or not bible.get('beats'):
        raise HTTPException(502, 'لم تنجح الحبكة. جرّب مرة ثانية أو غيّر الموضوع قليلاً.')
    return {'ok': True, 'bible': bible, 'provider': provider()}


@app.post('/api/story/write')
def story_write(req: WriteRequest):
    user = ('كتاب القصة المعتمد (التزم به، يمكنك تحسين التفاصيل لكن لا تغيّر البنية):\n'
            + json.dumps(req.bible, ensure_ascii=False)[:9000] +
            f'\n\nالنبرة: {req.tone}. عدد المقاطع: {req.length} تقريباً (كل مقطع جملة أو جملتان).\n'
            + (f'تفضيلات المستخدم من تقييمات سابقة:\n{req.preferences}\n' if req.preferences else '') +
            '\nاحكِ القصة كراوٍ يخاطب الكاميرا. ابدأ بجملة الـ hook مباشرة، وانتهِ بالصورة الأخيرة دون موعظة. '
            'السخرية، إن وُجدت، تعليق ذكي نادر على مفارقة حقيقية وليست نكتة في كل مقطع. اجعل كل مقطع يدفع الحدث أو يكشف معلومة.\n'
            + EMOTION_GUIDE + '\nأخرج JSON فقط بهذا الشكل:\n' + SEGMENT_SCHEMA)
    segs = clean_segments(llm_json(story_system(req.kind, req.dialect), user, 4500, 0.95))
    if len(segs) < 4:
        raise HTTPException(502, 'النص الناتج قصير جداً. جرّب مرة ثانية.')
    return {'ok': True, 'segments': segs, 'script': segments_to_script(segs)}


@app.post('/api/story/polish')
def story_polish(req: PolishRequest):
    draft = json.dumps(clean_segments(req.segments), ensure_ascii=False)
    user = ('كتاب القصة:\n' + json.dumps(req.bible, ensure_ascii=False)[:6000] + '\n\nالمسودة (مقاطع):\n' + draft[:12000] +
            '\n\nأنت محرر قاسٍ. افحص المسودة مقابل هذه القائمة وسجّل كل خلل بدقة: '
            '1) هل الـ hook في أول جملتين يفتح سؤالاً؟ 2) هل كل نقلة سببية (لذلك/لكن)؟ 3) هل تعود التفاصيل المزروعة بمعنى جديد؟ '
            '4) هل المفاجأة عادلة؟ 5) هل الرهانات تتصاعد وتظهر لحظة أسوأ؟ 6) هل النهاية تترك أثراً بلا موعظة؟ '
            '7) هل في النص حشو أو كليشيهات أو ضحك وصراخ مكتوب أو تعابير عامة؟ 8) هل اللهجة ثابتة وطبيعية؟ 9) هل وسوم الانفعال صادقة وغير مبالغ فيها؟ '
            'ثم أعد كتابة المسودة كاملة بعد إصلاح كل الأخلال، مع الحفاظ على ما هو جيد. '
            'أخرج JSON فقط بهذا الشكل: {"issues":["وصف كل خلل وجدته"],"segments":[ ...مقاطع بنفس البنية التالية... ]}\n'
            'بنية المقطع الواحد: {"text":"","emotion":"neutral|think|sassy|serious|shock|scared|sad|angry|excited|laugh|scream|mocking","intensity":0.5,"pause_ms":280,"emphasis":[]}')
    data = llm_json(story_system('story', req.dialect), user, 5000, 0.7)
    segs = clean_segments(data.get('segments') if isinstance(data, dict) else data)
    if len(segs) < 4:
        raise HTTPException(502, 'تعذّرت المراجعة. النص الأصلي يبقى كما هو.')
    issues = [str(i)[:240] for i in (data.get('issues') if isinstance(data, dict) else []) or []][:12]
    return {'ok': True, 'segments': segs, 'script': segments_to_script(segs), 'issues': issues}


@app.post('/api/analyze')
def analyze(req: AnalyzeRequest):
    user = ('حلّل النص التالي وقسّمه إلى مقاطع منطوقة (جملة أو جملتان)، وأعطِ لكل مقطع انفعال الراوي الصادق وشدته ووقفته. '
            'لا تغيّر كلمات النص. يمكنك فقط تقسيمه، وأي وسم بين أقواس مربعة هو توجيه من المستخدم يجب احترامه وحذفه من text.\n'
            f'النبرة العامة: {req.tone or "غير محددة"}\n' + EMOTION_GUIDE +
            '\nانتبه للسياق: مفاجأة بعد تمهيد هادئ أقوى من مفاجأة متتالية، والحزن بعد خسارة حقيقية، والسخرية عند مفارقة فعلية.\n'
            'النص:\n"""\n' + req.text + '\n"""\nأخرج JSON فقط بهذا الشكل:\n' + SEGMENT_SCHEMA)
    segs = clean_segments(llm_json('You are a precise performance director who reads Arabic scripts and decides how an animated narrator should emote.', user, 4500, 0.2))
    if not segs:
        raise HTTPException(502, 'تعذّر تحليل النص.')
    return {'ok': True, 'segments': segs}


@app.post('/api/chat/mock')
def mock_chat(payload: ChatRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Empty message')
    return {'ok': True, 'mode': state['mode']}


# ------------------------------------------------------------------ الصوت
# اسم قصير -> صوت edge (للتوافق مع المشاريع القديمة)
EDGE_VOICES = {'male': 'ar-SA-HamedNeural', 'female': 'ar-SA-ZariyahNeural', 'eg-male': 'ar-EG-ShakirNeural',
               'eg-female': 'ar-EG-SalmaNeural', 'sy-male': 'ar-SY-LaithNeural', 'ae-male': 'ar-AE-HamdanNeural'}

# (مجموعة، نص تجربة، [(المعرّف، الاسم)])
_AR_SAMPLE = 'أهلاً بكم، هذا صوتي في الاستوديو. جرّبوا السرعة التي تناسب القصة.'
VOICE_GROUPS = [
    ('العربية · الخليج', _AR_SAMPLE, [
        ('ar-SA-HamedNeural', 'سعودي · ذكر'), ('ar-SA-ZariyahNeural', 'سعودية · أنثى'),
        ('ar-AE-HamdanNeural', 'إماراتي · ذكر'), ('ar-AE-FatimaNeural', 'إماراتية · أنثى'),
        ('ar-KW-FahedNeural', 'كويتي · ذكر'), ('ar-KW-NouraNeural', 'كويتية · أنثى'),
        ('ar-QA-MoazNeural', 'قطري · ذكر'), ('ar-QA-AmalNeural', 'قطرية · أنثى'),
        ('ar-BH-AliNeural', 'بحريني · ذكر'), ('ar-BH-LailaNeural', 'بحرينية · أنثى'),
        ('ar-OM-AbdullahNeural', 'عماني · ذكر'), ('ar-OM-AyshaNeural', 'عمانية · أنثى'),
        ('ar-YE-SalehNeural', 'يمني · ذكر'), ('ar-YE-MaryamNeural', 'يمنية · أنثى')]),
    ('العربية · الشام والعراق', _AR_SAMPLE, [
        ('ar-SY-LaithNeural', 'سوري · ذكر'), ('ar-SY-AmanyNeural', 'سورية · أنثى'),
        ('ar-LB-RamiNeural', 'لبناني · ذكر'), ('ar-LB-LaylaNeural', 'لبنانية · أنثى'),
        ('ar-JO-TaimNeural', 'أردني · ذكر'), ('ar-JO-SanaNeural', 'أردنية · أنثى'),
        ('ar-IQ-BasselNeural', 'عراقي · ذكر'), ('ar-IQ-RanaNeural', 'عراقية · أنثى')]),
    ('العربية · مصر والمغرب العربي', _AR_SAMPLE, [
        ('ar-EG-ShakirNeural', 'مصري · ذكر'), ('ar-EG-SalmaNeural', 'مصرية · أنثى'),
        ('ar-LY-OmarNeural', 'ليبي · ذكر'), ('ar-LY-ImanNeural', 'ليبية · أنثى'),
        ('ar-TN-HediNeural', 'تونسي · ذكر'), ('ar-TN-ReemNeural', 'تونسية · أنثى'),
        ('ar-DZ-IsmaelNeural', 'جزائري · ذكر'), ('ar-DZ-AminaNeural', 'جزائرية · أنثى'),
        ('ar-MA-JamalNeural', 'مغربي · ذكر'), ('ar-MA-MounaNeural', 'مغربية · أنثى')]),
    ('English', 'Hello everyone, this is my voice in the studio. Let us tell a story.', [
        ('en-US-GuyNeural', 'US · male'), ('en-US-AriaNeural', 'US · female'),
        ('en-GB-RyanNeural', 'UK · male'), ('en-GB-SoniaNeural', 'UK · female')]),
    ('Français', 'Bonjour à tous, voici ma voix dans le studio. Racontons une histoire.', [
        ('fr-FR-HenriNeural', 'homme'), ('fr-FR-DeniseNeural', 'femme')]),
    ('Español', 'Hola a todos, esta es mi voz en el estudio. Contemos una historia.', [
        ('es-ES-AlvaroNeural', 'hombre'), ('es-ES-ElviraNeural', 'mujer')]),
    ('Deutsch', 'Hallo zusammen, das ist meine Stimme im Studio. Erzählen wir eine Geschichte.', [
        ('de-DE-ConradNeural', 'Mann'), ('de-DE-KatjaNeural', 'Frau')]),
    ('Türkçe', 'Herkese merhaba, bu stüdyodaki sesim. Bir hikâye anlatalım.', [
        ('tr-TR-AhmetNeural', 'erkek'), ('tr-TR-EmelNeural', 'kadın')]),
    ('اردو', 'سب کو سلام، یہ اسٹوڈیو میں میری آواز ہے۔ آئیے کہانی سنائیں۔', [
        ('ur-PK-AsadNeural', 'مرد'), ('ur-PK-UzmaNeural', 'عورت')]),
    ('فارسی', 'سلام به همه، این صدای من در استودیو است. بیایید یک داستان تعریف کنیم.', [
        ('fa-IR-FaridNeural', 'مرد'), ('fa-IR-DilaraNeural', 'زن')]),
    ('हिन्दी', 'सभी को नमस्कार, यह स्टूडियो में मेरी आवाज़ है। चलिए एक कहानी सुनाते हैं।', [
        ('hi-IN-MadhurNeural', 'पुरुष'), ('hi-IN-SwaraNeural', 'महिला')]),
    ('Bahasa Indonesia', 'Halo semuanya, ini suara saya di studio. Mari kita bercerita.', [
        ('id-ID-ArdiNeural', 'pria'), ('id-ID-GadisNeural', 'wanita')]),
    ('Русский', 'Всем привет, это мой голос в студии. Давайте расскажем историю.', [
        ('ru-RU-DmitryNeural', 'мужской'), ('ru-RU-SvetlanaNeural', 'женский')]),
    ('Italiano', 'Ciao a tutti, questa è la mia voce nello studio. Raccontiamo una storia.', [
        ('it-IT-DiegoNeural', 'uomo'), ('it-IT-ElsaNeural', 'donna')]),
    ('Português', 'Olá a todos, esta é a minha voz no estúdio. Vamos contar uma história.', [
        ('pt-BR-AntonioNeural', 'homem'), ('pt-BR-FranciscaNeural', 'mulher')]),
    ('日本語 / 한국어 / 中文', '大家好，这是我在录音室里的声音。', [
        ('ja-JP-KeitaNeural', '日本語 · 男性'), ('ja-JP-NanamiNeural', '日本語 · 女性'),
        ('ko-KR-InJoonNeural', '한국어 · 남성'), ('ko-KR-SunHiNeural', '한국어 · 여성'),
        ('zh-CN-YunxiNeural', '中文 · 男'), ('zh-CN-XiaoxiaoNeural', '中文 · 女')]),
]
_VOICE_RE = re.compile(r'^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$')


def voice_catalog(tts: List[str]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if 'elevenlabs' in tts:
        out.append({'key': 'eleven', 'label': 'صوتك في ElevenLabs', 'group': 'ElevenLabs', 'sample': _AR_SAMPLE})
    if 'edge' in tts:
        for group, sample, voices in VOICE_GROUPS:
            for key, label in voices:
                out.append({'key': key, 'label': label, 'group': group, 'sample': sample})
    return out


# تلوين الأداء: (تغيير السرعة %، تغيير الطبقة Hz) عند شدة كاملة. تغييرات صغيرة كي يبقى الصوت طبيعياً
EMO_PROSODY = {'excited': (10, 6), 'sad': (-14, -6), 'angry': (8, -2), 'scared': (12, 8), 'shock': (6, 6), 'think': (-10, -2),
               'serious': (-6, -5), 'laugh': (6, 4), 'scream': (12, 8), 'sassy': (-4, 3), 'mocking': (3, 5), 'neutral': (0, 0)}
_tts_cache: 'OrderedDict[tuple, bytes]' = OrderedDict()


def _http_bytes(url: str, headers: Dict[str, str], body: Dict[str, Any]) -> bytes:
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', **headers}, method='POST')
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


@app.post('/api/tts')
async def tts(req: TtsRequest):
    text = re.sub(r'\s+', ' ', req.text).strip()
    use_default = req.voice in ('', 'eleven')
    try:
        if use_default and os.getenv('ELEVENLABS_API_KEY') and os.getenv('ELEVENLABS_VOICE_ID'):
            audio = _http_bytes(
                f"https://api.elevenlabs.io/v1/text-to-speech/{os.environ['ELEVENLABS_VOICE_ID']}?output_format=mp3_44100_128",
                {'xi-api-key': os.environ['ELEVENLABS_API_KEY']},
                {'text': text, 'model_id': os.getenv('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
                 'voice_settings': {'stability': 0.45, 'similarity_boost': 0.8, 'style': 0.25}})
            return Response(audio, media_type='audio/mpeg')
        if req.voice == '' and os.getenv('OPENAI_API_KEY') and os.getenv('TTS_PROVIDER', '') == 'openai':
            audio = _http_bytes('https://api.openai.com/v1/audio/speech', {'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY']},
                                {'model': os.getenv('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'), 'voice': 'onyx', 'input': text,
                                 'speed': req.rate, 'response_format': 'mp3',
                                 'instructions': 'تحدث بالعربية بأسلوب راوٍ طبيعي هادئ، بدون مبالغة تمثيلية.'})
            return Response(audio, media_type='audio/mpeg')
        try:
            import edge_tts
        except Exception:  # noqa: BLE001
            raise HTTPException(501, 'لا يوجد مزوّد صوت على الخادم. سيُستخدم صوت المتصفح.')
        voice = EDGE_VOICES.get(req.voice) or (req.voice if _VOICE_RE.match(req.voice) else EDGE_VOICES['male'])
        dr, dp = EMO_PROSODY.get(req.emotion, (0, 0)); k = 0.4 + 0.6 * req.intensity
        pct = int(round((req.rate - 1) * 100 + dr * k)); hz = int(round(dp * k))
        key = (text, voice, pct, hz)
        if key in _tts_cache:
            _tts_cache.move_to_end(key)
            return Response(_tts_cache[key], media_type='audio/mpeg')
        buf = io.BytesIO()
        async for chunk in edge_tts.Communicate(text, voice, rate=f'{pct:+d}%', pitch=f'{hz:+d}Hz').stream():
            if chunk['type'] == 'audio':
                buf.write(chunk['data'])
        if not buf.getvalue():
            raise HTTPException(502, 'لم يرجع مزوّد الصوت أي صوت.')
        _tts_cache[key] = buf.getvalue()
        while len(_tts_cache) > 120:
            _tts_cache.popitem(last=False)
        return Response(buf.getvalue(), media_type='audio/mpeg')
    except HTTPException:
        raise
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(502, 'تعذّر الاتصال بمزوّد الصوت.')
    except Exception:  # noqa: BLE001
        raise HTTPException(502, 'فشل توليد الصوت على الخادم.')


# ------------------------------------------------------------------ الواجهة
@app.get('/')
def home():
    return FileResponse(FRONTEND / 'index.html', headers={'Cache-Control': 'no-cache'})


app.mount('/', StaticFiles(directory=str(FRONTEND)), name='frontend')
