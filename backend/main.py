import json
import os
import urllib.request
import urllib.error
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel, Field

app = FastAPI(title='Live', version='0.4.0')
app.add_middleware(CORSMiddleware, allow_origins=[], allow_methods=['GET','POST'], allow_headers=['Content-Type'])
ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'

class ModeRequest(BaseModel):
    mode: str = Field(min_length=1, max_length=30)
class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
class GenerateRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=1200)
    kind: str = Field(default='story', max_length=30)
    tone: str = Field(default='ساخر وخفيف', max_length=80)
    preferences: str = Field(default='', max_length=1200)

MODES = ['Funny', 'Sassy', 'Serious', 'Furious', 'Freaked Out', 'Mocking']
state = {'mode': 'Funny', 'message': 'Live is ready.', 'connected': False}

@app.get('/')
def home():
    return FileResponse(FRONTEND / 'index.html')
@app.get('/style.css')
def style():
    return FileResponse(FRONTEND / 'style.css')
@app.get('/rig.js')
def rig():
    return FileResponse(FRONTEND / 'rig.js', media_type='application/javascript')
@app.get('/app.js')
def script():
    return FileResponse(FRONTEND / 'app.js', media_type='application/javascript')
@app.get('/api/state')
def get_state():
    return {**state, 'modes': MODES, 'ai_ready': bool(os.getenv('OPENAI_API_KEY'))}
@app.post('/api/mode')
def set_mode(req: ModeRequest):
    if req.mode not in MODES:
        raise HTTPException(status_code=400, detail='Unknown mode')
    state['mode'] = req.mode
    state['message'] = f'Mode switched to {req.mode}.'
    return {'ok': True, **state}

@app.post('/api/generate')
def generate(req: GenerateRequest):
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        raise HTTPException(status_code=503, detail='ميزة الذكاء الاصطناعي تحتاج ضبط OPENAI_API_KEY في Render.')
    kind_names = {'story': 'قصة تُروى', 'commentary': 'تعليق وتحليل', 'reaction': 'ردة فعل'}
    instructions = (
        'أنت كاتب ومخرج لشخصية ستريمر عربية لها شخصية ثابتة: ذكية، ساخرة بخفة، عفوية، وتفهم السياق. '
        'اكتب نصاً عربياً محكياً طبيعياً، لا يبدو كقالب ولا كأنه نكات متتالية. '
        'في القصة ابنِ أحداثاً مترابطة وشخصيات ودوافع وتصعيداً ونتيجة منطقية، ولا تخترع حقائق عن أشخاص حقيقيين. '
        'السخرية تعليق ذكي على المفارقة أو تصرف الشخصية، وليست ضحكاً مستمراً. لا تضع نكتة في كل فقرة، '
        'واجعل معظم السرد طبيعياً، مع لمسات ساخرة قليلة في اللحظات المناسبة. '
        'نوّع الإيقاع: وصف هادئ، فضول، تشويق، دهشة عند وجود سبب، تعاطف عند اللزوم، ثم خاتمة لها معنى. '
        'لا تستخدم صراخاً أو ضحكاً مكتوباً أو مبالغات مصطنعة، ولا تضف "هاها" أو "ممم" كحشو. '
        'اكتب 6 إلى 10 فقرات قصيرة، كل جملة أو فقرة في سطر مستقل عند الحاجة. '
        'ضع توجيهاً اختيارياً قصيراً بين أقواس مربعة في بداية السطر فقط من هذه المجموعة: '
        '[عادي] [ساخر] [يفكر] [يتفاجأ] [جاد] [حزين] [متحمس] [غاضب]. '
        'لا تكتب عناوين مشاهد أو تعليمات إخراجية أو شرحاً قبل النص. أخرج النص النهائي فقط.'
    )
    prompt = (
        f'نوع النص: {kind_names.get(req.kind, "قصة تُروى")}\n'
        f'النبرة المطلوبة: {req.tone}\nالموضوع أو المادة: {req.topic}\n'
        f'ملاحظات التعلّم من تقييمات المستخدم السابقة: {req.preferences or "لا توجد ملاحظات بعد."}\n'
        'حافظ على روح الشخصية الساخرة الهادئة ولا تحوّل كل شيء إلى كوميديا.'
    )
    body = json.dumps({
        'model': os.getenv('OPENAI_MODEL', 'gpt-6.2-astra'),
        'instructions': instructions,
        'input': prompt,
        'max_output_tokens': 1800,
        'store': False
    }).encode('utf-8')
    request = urllib.request.Request(
        'https://api.openai.com/v1/responses',
        data=body,
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode('utf-8'))
        chunks = []
        for item in result.get('output', []):
            if item.get('type') == 'message':
                for part in item.get('content', []):
                    if part.get('type') == 'output_text':
                        chunks.append(part.get('text', ''))
        text = '\n'.join(chunks).strip()
        if not text:
            raise HTTPException(status_code=502, detail='لم يرجع النموذج نصاً صالحاً. جرّب مرة ثانية.')
        return {'ok': True, 'script': text, 'model': result.get('model', 'AI')}
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail='تعذّر الاتصال بخدمة كتابة الذكاء الاصطناعي. تحقق من إعدادات المفتاح والنموذج.')
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=502, detail='تعذّر الاتصال بخدمة الذكاء الاصطناعي حالياً.')

@app.post('/api/chat/mock')
def mock_chat(payload: ChatRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Empty message')
    return {'ok': True, 'mode': state['mode']}

# No social-account credentials or automatic publishing are stored in this prototype.
