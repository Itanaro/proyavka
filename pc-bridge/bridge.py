# -*- coding: utf-8 -*-
"""Мост «Проявка» → Automatic1111.
iPad открывает «Проявку» по HTTPS, а Safari не пускает HTTPS-страницу к обычному http://компьютеру.
Мост слушает домашнюю сеть по HTTPS (свой сертификат) и передаёт запросы в Automatic1111 на этом же компьютере.
Automatic1111 и Photoshop при этом работают как раньше, на http://127.0.0.1:7860.
"""
import os, sys, ssl, socket, secrets, subprocess, http.client, json, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
SD_ROOT = os.path.join(os.path.dirname(HERE), 'stable-diffusion-portable-main')
OPENSSL = os.path.join(SD_ROOT, 'git', 'mingw64', 'bin', 'openssl.exe')  # native build: no MSYS path mangling of '/CN=…'
if not os.path.exists(OPENSSL): OPENSSL = os.path.join(SD_ROOT, 'git', 'usr', 'bin', 'openssl.exe')
UPSTREAM = ('127.0.0.1', 7860)
PORT = 7861
DESKTOP = os.path.join(os.path.expanduser('~'), 'Desktop')

def p(*a): print(*a, flush=True)

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('192.168.0.1', 9)); return s.getsockname()[0]
    except Exception:
        return socket.gethostbyname(socket.gethostname())
    finally: s.close()

def ossl(*args):
    env = dict(os.environ); env['OPENSSL_CONF'] = os.path.join(HERE, 'openssl.cnf'); env['MSYS2_ARG_CONV_EXCL'] = '*'; env['MSYS_NO_PATHCONV'] = '1'
    r = subprocess.run([OPENSSL, *args], cwd=HERE, capture_output=True, text=True, env=env)
    if r.returncode: raise RuntimeError('openssl: ' + (r.stderr or r.stdout))

def ensure_certs(ip):
    host = socket.gethostname()
    with open(os.path.join(HERE, 'openssl.cnf'), 'w', encoding='ascii') as f:
        f.write('[req]\ndistinguished_name=dn\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n'
                '[srv]\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n'
                f'subjectAltName=IP:{ip},DNS:{host},DNS:{host}.local,DNS:localhost,IP:127.0.0.1\n')
    ca_key, ca_crt = os.path.join(HERE, 'rootCA.key'), os.path.join(HERE, 'rootCA.crt')
    if not os.path.exists(ca_crt):
        p('Создаю свой корневой сертификат (один раз)…')
        ossl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'rootCA.key', '-out', 'rootCA.crt', '-days', '3650',
             '-subj', '/CN=Proyavka Home CA', '-extensions', 'ca', '-config', 'openssl.cnf')
        dst = os.path.join(DESKTOP, 'Проявка-сертификат-для-iPad.crt')
        try:
            with open(ca_crt, 'rb') as a, open(dst, 'wb') as b: b.write(a.read())
            p('Сертификат для iPad лежит на рабочем столе: Проявка-сертификат-для-iPad.crt')
        except Exception as e: p('Не смогла положить сертификат на рабочий стол:', e)
    stamp = os.path.join(HERE, 'server.ip')
    old = open(stamp).read().strip() if os.path.exists(stamp) else ''
    if old != ip or not os.path.exists(os.path.join(HERE, 'server.crt')):
        p('Делаю сертификат моста для адреса', ip)
        ossl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=' + ip, '-config', 'openssl.cnf')
        ossl('x509', '-req', '-in', 'server.csr', '-CA', 'rootCA.crt', '-CAkey', 'rootCA.key', '-CAcreateserial', '-out', 'server.crt',
             '-days', '800', '-sha256', '-extfile', 'openssl.cnf', '-extensions', 'srv')
        open(stamp, 'w').write(ip)

def token():
    f = os.path.join(HERE, 'token.txt')
    if not os.path.exists(f): open(f, 'w').write(secrets.token_urlsafe(9))
    return open(f).read().strip()


# ---------- нейросети «Проявки» на компьютере: те же ONNX-модели, что и на iPad, но в памяти ПК ----------
MODEL_PARTS = {'isnet': ('isnet', 4), 'sam_enc': ('msam_enc', 3), 'sam_dec': ('msam_dec', 2), 'migan': ('migan', 3), 'depth': ('depth', 3)}
MODEL_URL = 'https://itanaro.github.io/proyavka/models/{}.{}.wasm'
MODEL_DIR = os.path.join(HERE, 'models')
_sessions = {}; _lock = __import__('threading').Lock()
DT = {'uint8': 'uint8', 'float32': 'float32', 'int32': 'int32', 'int64': 'int64', 'bool': 'bool', 'float16': 'float16', 'int8': 'int8'}
def ort_session(name):
    import onnxruntime as ort, urllib.request
    with _lock:
        if name in _sessions: return _sessions[name]
        if name not in MODEL_PARTS: raise ValueError('нет такой модели: ' + name)
        os.makedirs(MODEL_DIR, exist_ok=True); path = os.path.join(MODEL_DIR, name + '.onnx')
        if not os.path.exists(path):
            stem, n = MODEL_PARTS[name]; p('Скачиваю модель', name, '…'); data = b''
            for i in range(n): data += urllib.request.urlopen(MODEL_URL.format(stem, i), timeout=120).read()
            open(path + '.part', 'wb').write(data); os.replace(path + '.part', path)
        prov = [x for x in ('CUDAExecutionProvider', 'CPUExecutionProvider') if x in ort.get_available_providers()]
        try: s = ort.InferenceSession(path, providers=prov)
        except Exception: s = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        p('Модель', name, 'готова ·', s.get_providers()[0].replace('ExecutionProvider', ''))
        _sessions[name] = s; return s
def ort_run(name, body):
    import numpy as np, struct
    hl = struct.unpack('<I', body[:4])[0]; head = json.loads(body[4:4 + hl].decode()); off = 4 + hl; feeds = {}
    for k, t in head['feeds'].items():
        n = t['len']; feeds[k] = np.frombuffer(body[off:off + n], dtype=DT[t['type']]).reshape(t['dims']); off += n
    s = ort_session(name); t0 = time.time()
    want = head.get('outputs') or [s.get_outputs()[0].name]  # «Проявке» нужен только главный результат — промежуточные слои сети не гоняем по Wi-Fi
    outs = s.run(want, feeds)
    meta = []; blobs = []
    for nm, v in zip(want, outs):
        v = np.ascontiguousarray(v); typ = str(v.dtype); b = v.tobytes(); meta.append({'name': nm, 'type': typ, 'dims': list(v.shape), 'len': len(b)}); blobs.append(b)
    h = json.dumps({'out': meta, 'ms': round((time.time() - t0) * 1000)}).encode()
    return struct.pack('<I', len(h)) + h + b''.join(blobs)

TOKEN = token()
PREFIX = '/k/' + TOKEN

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, fmt, *a): pass
    def cors(self):
        o = self.headers.get('Origin') or '*'
        self.send_header('Access-Control-Allow-Origin', o); self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers') or 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true'); self.send_header('Access-Control-Max-Age', '600')
    def reply(self, code, body=b'', ctype='application/json'):
        self.send_response(code); self.cors(); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers()
        if body: self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.send_header('Content-Length', '0'); self.end_headers()
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def forward(self):
        if self.path.startswith('/local/config'):  # the PC version of «Проявка» on this same computer learns the bridge address
            if self.client_address[0] in ('127.0.0.1', '::1'):
                return self.reply(200, json.dumps({'base': f'https://127.0.0.1:{PORT}{PREFIX}'}).encode())
            return self.reply(403, b'{}')
        if not self.path.startswith(PREFIX + '/'):
            return self.reply(403, json.dumps({'error': 'нужен адрес с ключом моста'}, ensure_ascii=False).encode())
        path = self.path[len(PREFIX):]
        if path == '/bridge/ping':
            return self.reply(200, json.dumps({'ok': True, 'host': socket.gethostname(), 'ml': True}).encode())
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else None
        if path.startswith('/proyavka/meta/'):
            name = path.rsplit('/', 1)[-1]
            try:
                ss = ort_session(name)
                return self.reply(200, json.dumps({'inputs': [i.name for i in ss.get_inputs()], 'outputs': [o.name for o in ss.get_outputs()], 'ep': ss.get_providers()[0]}).encode())
            except Exception as e:
                return self.reply(500, json.dumps({'error': str(e)}, ensure_ascii=False).encode())
        if path.startswith('/proyavka/ort/'):
            name = path.rsplit('/', 1)[-1]
            try: return self.reply(200, ort_run(name, body or b''), 'application/octet-stream')
            except Exception as e:
                p('Нейросеть', name, '— ошибка:', e); return self.reply(500, json.dumps({'error': str(e)}, ensure_ascii=False).encode())
        t0 = time.time()
        try:
            c = http.client.HTTPConnection(*UPSTREAM, timeout=900)
            c.request(self.command, path, body=body, headers={'Content-Type': self.headers.get('Content-Type', 'application/json')})
            r = c.getresponse(); data = r.read()
            self.reply(r.status, data, r.getheader('Content-Type') or 'application/json')
            if path.startswith('/sdapi/v1/img2img') or path.startswith('/sdapi/v1/txt2img'):
                p(time.strftime('%H:%M:%S'), 'генерация с iPad', path.split('/')[-1], f'{time.time()-t0:.1f} с', r.status)
        except ConnectionRefusedError:
            self.reply(502, json.dumps({'error': 'Automatic1111 не запущен на компьютере'}, ensure_ascii=False).encode())
        except Exception as e:
            self.reply(502, json.dumps({'error': str(e)}, ensure_ascii=False).encode())

class Server(ThreadingHTTPServer):
    daemon_threads = True
    warned = False
    def handle_error(self, request, client_address):
        e = sys.exc_info()[1]
        if isinstance(e, ssl.SSLError) and 'CERTIFICATE_UNKNOWN' in str(e):
            if not Server.warned:
                p('Устройство', client_address[0], 'не доверяет сертификату моста — установи «Проявка-сертификат-для-iPad.crt» на iPad и включи доверие.')
                Server.warned = True
            return
        if isinstance(e, (ConnectionResetError, BrokenPipeError, ssl.SSLError, TimeoutError)): return
        p('Сбой соединения с', client_address[0], '—', e)

def main():
    ip = lan_ip(); ensure_certs(ip)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(os.path.join(HERE, 'server.crt'), os.path.join(HERE, 'server.key'))
    srv = Server(('0.0.0.0', PORT), H); srv.socket = ctx.wrap_socket(srv.socket, server_side=True, do_handshake_on_connect=False)  # handshake in the worker thread, a slow client can't stall the rest
    addr = f'https://{ip}:{PORT}{PREFIX}'
    try: open(os.path.join(DESKTOP, 'Проявка-адрес-моста.txt'), 'w', encoding='utf-8').write(addr + '\n')
    except Exception: pass
    p(''); p('Мост «Проявки» работает.'); p('Адрес для «Проявки» на iPad (⚙ → Свой ПК):'); p('   ' + addr); p('')
    p('Это окно не закрывай, пока работаешь с iPad. Automatic1111 тоже должен быть запущен.')
    srv.serve_forever()

if __name__ == '__main__':
    try: main()
    except Exception as e:
        p('Ошибка:', e); input('Нажми Enter, чтобы закрыть…')
