#!/usr/bin/env python3
"""Заглушка облачных нейросетей для автотестов — отвечает как OpenRouter, денег не тратит.

    python3 tests/stub.py [порт]        (по умолчанию 8199; tests/run.py запускает её сам)

Что умеет:
  POST /api/v1/images            — картинка: первая присланная (input_references[0]), слегка подкрашенная,
                                   в пропорции aspect_ratio; в подсказке «REFCOPY» — отдаёт второй реф
                                   (так тест изображает модель, которая вернула кадр рефа)
  POST /api/v1/chat/completions  — арт-директор: JSON с двумя замечаниями
  GET  /api/v1/models            — пара моделей с картинками на выходе
  GET  /api/v1/key               — ключ «or-good» годится, остальные — 401
  /k/test/…                      — мост ПК: ping, промпт плагина SD (/proyavka/sdpreset), Automatic1111 img2img и progress (№112)
  /k/test/files/…                — «Каты на ПК» (№132): настоящий код моста над временной папкой; POST /_catsedit — «правка в Фотошопе»
  GET  /_log                     — что приходило (модель, пропорция, число картинок) — для проверок в тестах
  POST /_reset                   — очистить журнал
"""
import base64, io, json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image

LOG, LOCK = [], threading.Lock()
import importlib.util, os, tempfile, urllib.parse
_spec = importlib.util.spec_from_file_location('bridge', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pc-bridge', 'bridge.py'))
BRIDGE = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(BRIDGE)
BRIDGE.HERE = tempfile.mkdtemp(prefix='pv-cats-'); open(os.path.join(BRIDGE.HERE, 'cats-folder.txt'), 'w').write(os.path.join(BRIDGE.HERE, 'Каты'))
CATS = {'down': False}
SD = {'down': False}   # №115: «Automatic1111 не запущен», пока тест не попросит запуск

def png_b64(img):
    b = io.BytesIO(); img.save(b, 'PNG'); return base64.b64encode(b.getvalue()).decode()

def decode(url):
    raw = base64.b64decode(url.split(',', 1)[1])
    return Image.open(io.BytesIO(raw)).convert('RGBA')

def answer_image(body):
    refs = [r.get('image_url', {}).get('url', '') for r in body.get('input_references', [])]
    ar = body.get('aspect_ratio', '1:1')
    try:
        aw, ah = [float(x) for x in ar.split(':')]
    except ValueError:
        aw, ah = 1, 1
    side = {'1K': 1024, '2K': 2048, '4K': 4096}.get(body.get('resolution') or '1K', 1024)
    k = side / max(aw, ah)
    W, H = max(64, int(aw * k)), max(64, int(ah * k))
    pick = 1 if 'REFCOPY' in body.get('prompt', '') and len(refs) > 1 else 0
    if refs and refs[pick].startswith('data:'):
        img = decode(refs[pick]).resize((W, H))
        tint = Image.new('RGBA', (W, H), (40, 120, 200, 40))   # лёгкий синий: видно, что ответ «от модели»
        img = Image.alpha_composite(img, tint)
    else:
        img = Image.new('RGBA', (W, H), (120, 160, 200, 255))
    return {'data': [{'b64_json': png_b64(img.convert('RGB'))}], 'usage': {'cost': 0.034}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self): self._send(204, {})

    def _files(self):   # the bridge's own «Каты на ПК» functions over a temp folder
        u = urllib.parse.urlsplit(self.path); q = urllib.parse.parse_qs(u.query); rel = (q.get('p') or [''])[0]; act = u.path[len('/k/test'):]
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        if CATS['down']: self.close_connection = True; return self.connection.shutdown(2)
        try:
            if act == '/files/list': return self._send(200, BRIDGE.cats_list(rel))
            if act == '/files/get':
                _, f = BRIDGE.cats_path(rel); data = open(f, 'rb').read()
                self.send_response(200); self.send_header('Content-Type', 'application/octet-stream'); self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Expose-Headers', 'X-Mtime'); self.send_header('X-Mtime', str(BRIDGE._mt(f))); self.send_header('Content-Length', str(len(data)))
                self.end_headers(); self.wfile.write(data); return
            if act == '/files/put':
                code, o = BRIDGE.cats_put(rel, body, int((q.get('base') or ['0'])[0] or 0), (q.get('force') or ['0'])[0] == '1'); return self._send(code, o)
            if act == '/files/mkdir':
                _, d = BRIDGE.cats_path(rel); os.makedirs(d, exist_ok=True); return self._send(200, {'ok': True})
        except FileNotFoundError as e: return self._send(404, {'error': str(e)})
        except ValueError as e: return self._send(400, {'error': str(e)})
        self._send(404, {'error': 'нет такой команды'})

    def _auth(self):
        return 'or-good' in (self.headers.get('Authorization') or '')

    def do_GET(self):
        p = self.path.split('?')[0]
        if p.startswith('/k/test/files/'): return self._files()
        if p == '/_log':
            with LOCK: return self._send(200, LOG)
        if p == '/k/test/bridge/ping': return self._send(200, {'ok': True, 'host': 'stub', 'ml': False})
        if p == '/k/test/proyavka/sdpreset': return self._send(200, {'prompt': 'STUBPROMPT smooth skin', 'neg': 'stub neg'})
        if p == '/k/test/sdapi/v1/sd-models': return self._send(502 if SD['down'] else 200, [{'title': 'stub.safetensors'}] if not SD['down'] else {'error': 'Automatic1111 не запущен на компьютере'})
        if p == '/k/test/sdapi/v1/progress': return self._send(200, {'progress': 0.5, 'state': {'sampling_step': 30, 'sampling_steps': 60, 'job_count': 1}})
        if not self._auth(): return self._send(401, {'error': {'message': 'bad key'}})
        if p in ('/api/v1/key', '/api/v1/auth/key'):
            return self._send(200, {'data': {'label': 'stub', 'limit': 10, 'usage': 0.5}})
        if p == '/api/v1/models':
            return self._send(200, {'data': [
                {'id': 'google/gemini-nano-banana-2.1', 'name': 'Nano Banana 2.1', 'architecture': {'output_modalities': ['image']}},
                {'id': 'bytedance-seed/seedream-5-0-pro', 'name': 'Seedream 5 Pro', 'architecture': {'output_modalities': ['image']}}]})
        self._send(404, {'error': {'message': 'not found'}})

    def do_POST(self):
        if self.path.startswith('/k/test/files/'): return self._files()
        if self.path.startswith('/_catsdown'): CATS['down'] = self.path.endswith('1'); return self._send(200, {'ok': True})
        if self.path.startswith('/_catsedit'):   # «the file was changed on the PC»
            rel = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)['p'][0]; _, f = BRIDGE.cats_path(rel)
            import time as _t; _t.sleep(0.01); os.utime(f, None); return self._send(200, {'mtime': BRIDGE._mt(f)})
        n = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            body = {}
        p = self.path.split('?')[0]
        if p == '/_reset':
            with LOCK: LOG.clear()
            return self._send(200, {'ok': True})
        if p == '/_sddown': SD['down'] = True; return self._send(200, {'ok': True})
        if p == '/_sdup': SD['down'] = False; return self._send(200, {'ok': True})   # №142: «включила Stable пультом»
        if p == '/k/test/proyavka/sdstart':   # №142: like the bridge — never starts Stable, only says whether it is on
            if SD['down']: return self._send(500, {'error': 'Stable выключен — включи его пультом «Stable Diffusion» на рабочем столе (цифра 2)'})
            return self._send(200, {'state': 'running'})
        if p == '/k/test/sdapi/v1/img2img' and SD['down']: return self._send(502, {'error': 'Automatic1111 не запущен на компьютере'})
        if p == '/k/test/sdapi/v1/img2img':   # Automatic1111: the picture back, a bit greener
            with LOCK: LOG.append({'kind': 'sd', 'prompt': body.get('prompt'), 'neg': body.get('negative_prompt'), 'denoise': body.get('denoising_strength'),
                                   'steps': body.get('steps'), 'cfg': body.get('cfg_scale'), 'sampler': body.get('sampler_name'), 'blur': body.get('mask_blur'),
                                   'w': body.get('width'), 'h': body.get('height'), 'model': (body.get('override_settings') or {}).get('sd_model_checkpoint')})
            img = decode(body['init_images'][0]); img = Image.alpha_composite(img, Image.new('RGBA', img.size, (0, 200, 0, 90)))
            return self._send(200, {'images': [png_b64(img.convert('RGB'))]})
        if not self._auth(): return self._send(401, {'error': {'message': 'bad key'}})
        if p == '/api/v1/images':
            if body.get('n', 1) > 1:   # как настоящий Google через OpenRouter
                return self._send(400, {'error': {'message': 'No provider supports the requested parameter(s): n must be 1'}})
            with LOCK: LOG.append({'kind': 'image', 'model': body.get('model'), 'aspect': body.get('aspect_ratio'),
                                   'res': body.get('resolution'), 'refs': len(body.get('input_references', [])),
                                   'prompt': (body.get('prompt') or '')[:200]})
            return self._send(200, answer_image(body))
        if p == '/api/v1/chat/completions':
            with LOCK: LOG.append({'kind': 'chat', 'model': body.get('model')})
            notes = {'summary': 'Заглушка: свет слева, композиция держится.',
                     'notes': [{'x': 0.3, 'y': 0.3, 'r': 0.08, 'kind': 'свет', 'title': 'Тень не туда', 'text': 'проверка'},
                               {'x': 0.7, 'y': 0.6, 'r': 0.06, 'kind': 'стык', 'title': 'Шов', 'text': 'проверка'}]}
            return self._send(200, {'choices': [{'message': {'content': json.dumps(notes, ensure_ascii=False)}}], 'usage': {'cost': 0.002}})
        self._send(404, {'error': {'message': 'not found'}})

def serve(port=8199):
    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8199
    print(f'заглушка на http://127.0.0.1:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
