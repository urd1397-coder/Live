from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title='Live', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

class ModeRequest(BaseModel):
    mode: str

MODES = ['Funny', 'Sassy', 'Serious', 'Furious', 'Freaked Out', 'Mocking']
state = {'mode': 'Funny', 'message': 'Live is ready.', 'connected': False}

@app.get('/')
def health():
    return {'app': 'Live', 'status': 'ok'}

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
