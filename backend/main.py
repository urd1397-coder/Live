from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel, Field

app = FastAPI(title='Live', version='0.3.0')
# Same-origin only: the app is served by this API. Do not expose permissive CORS.
app.add_middleware(CORSMiddleware, allow_origins=[], allow_methods=['GET','POST'], allow_headers=['Content-Type'])

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'

class ModeRequest(BaseModel):
    mode: str = Field(min_length=1, max_length=30)

class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)

MODES = ['Funny', 'Sassy', 'Serious', 'Furious', 'Freaked Out', 'Mocking']
state = {'mode': 'Funny', 'message': 'Live is ready.', 'connected': False}

@app.get('/')
def home():
    return FileResponse(FRONTEND / 'index.html')

@app.get('/style.css')
def style():
    return FileResponse(FRONTEND / 'style.css')

@app.get('/app.js')
def script():
    return FileResponse(FRONTEND / 'app.js', media_type='application/javascript')

@app.get('/api/state')
def get_state():
    return {**state, 'modes': MODES}

@app.post('/api/mode')
def set_mode(req: ModeRequest):
    if req.mode not in MODES:
        raise HTTPException(status_code=400, detail='Unknown mode')
    state['mode'] = req.mode
    state['message'] = f'Mode switched to {req.mode}.'
    return {'ok': True, **state}

@app.post('/api/chat/mock')
def mock_chat(payload: ChatRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Empty message')
    state['message'] = text
    return {'ok': True, 'received': text, 'mode': state['mode']}

# Publishing/account connection is intentionally absent. No autonomous posting,
# OAuth credentials, account tokens, or upload permissions are stored in this prototype.
