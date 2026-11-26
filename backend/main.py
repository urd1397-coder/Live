from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel

app = FastAPI(title='Live', version='0.2.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'

class ModeRequest(BaseModel):
    mode: str

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
        return {'ok': False, 'error': 'Unknown mode', 'modes': MODES}
    state['mode'] = req.mode
    state['message'] = f'Mode switched to {req.mode}.'
    return {'ok': True, **state}

@app.post('/api/chat/mock')
def mock_chat(payload: dict):
    text = str(payload.get('text', '')).strip()[:500]
    if not text:
        return {'ok': False, 'error': 'Empty message'}
    state['message'] = text
    return {'ok': True, 'received': text, 'mode': state['mode']}
