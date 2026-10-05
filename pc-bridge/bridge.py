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


# ---------- плагины Фотошопа внутри «Проявки»: код читается прямо из папки, куда его ставит Photoshop ----------
# Плагин правят в одном месте (папка UXP), а «Проявка» каждый раз берёт свежую копию отсюда —
# так Фотошоп и «Проявка» всегда работают на одном и том же main.js.
import urllib.request, urllib.error, urllib.parse, re as _re, ipaddress
UXP_DIR = os.path.join(os.environ.get('APPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming'), 'Adobe', 'UXP')
PLUGIN_IDS = ('com.alisa.aiedit', 'com.alisa.sdinpaint')
PLUGIN_FILES = ('index.html', 'main.js', 'manifest.json', 'team-config.json')
def _ver(s): return tuple(int(x) for x in _re.findall(r'\d+', s))
def plugin_dir(pid):
    base = os.path.join(UXP_DIR, 'Plugins', 'External'); best = None
    for n in os.listdir(base) if os.path.isdir(base) else []:
        if (n == pid or n.startswith(pid + '_')) and os.path.isfile(os.path.join(base, n, 'main.js')):
            if best is None or _ver(n) > _ver(best): best = n
    return os.path.join(base, best) if best else None
def plugin_data_dir(pid):
    # PluginsStorage/PHSP/<версия Photoshop>/External/<id>/PluginData — берём ту, где плагин работал последним
    root = os.path.join(UXP_DIR, 'PluginsStorage', 'PHSP'); best = None; bt = -1
    for v in os.listdir(root) if os.path.isdir(root) else []:
        d = os.path.join(root, v, 'External', pid, 'PluginData')
        if os.path.isdir(d):
            t = max([os.path.getmtime(os.path.join(d, f)) for f in os.listdir(d)] + [os.path.getmtime(d)])
            if t > bt: best, bt = d, t
    if not best: best = os.path.join(HERE, 'plugin-data', pid); os.makedirs(best, exist_ok=True)
    return best
def plugin_manifest(pid):
    d = plugin_dir(pid)
    if not d: return None
    files = {f: os.path.getmtime(os.path.join(d, f)) for f in PLUGIN_FILES if os.path.isfile(os.path.join(d, f))}
    ver = ''
    try: ver = json.load(open(os.path.join(d, 'manifest.json'), encoding='utf-8')).get('version', '')
    except Exception: pass
    return {'id': pid, 'dir': os.path.basename(d), 'version': ver, 'files': files, 'mtime': max(files.values()) if files else 0}

# ---------- сеть для плагина: у Фотошопа нет CORS, у браузера есть — запросы к сервисам идут через мост ----------
HOP = {'host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer', 'cookie', 'transfer-encoding'}
def _private(host):  # только явные адреса домашней сети; имена не резолвим — VPN может отдавать «подставные» адреса
    if host.lower() in ('localhost',) or host.lower().endswith('.local'): return True
    try: a = ipaddress.ip_address(host.strip('[]')); return a.is_private or a.is_loopback or a.is_link_local
    except ValueError: return False
def net_proxy(h, body):
    url = urllib.parse.unquote(h.headers.get('X-Proxy-Url') or '')
    method = (h.headers.get('X-Proxy-Method') or 'GET').upper()
    try: hdr = json.loads(urllib.parse.unquote(h.headers.get('X-Proxy-Headers') or '') or '{}')
    except Exception: hdr = {}
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ('http', 'https') or not u.hostname or _private(u.hostname):
        return 400, json.dumps({'error': 'мост не ходит по этому адресу'}, ensure_ascii=False).encode(), 'application/json', ''
    hdr = {k: v for k, v in hdr.items() if k.lower() not in HOP}
    if body is not None and not any(k.lower() == 'content-type' for k in hdr) and h.headers.get('Content-Type') and 'x-proyavka-raw' not in h.headers.get('Content-Type'):
        hdr['Content-Type'] = h.headers.get('Content-Type')
    req = urllib.request.Request(url, data=body if method not in ('GET', 'HEAD') else None, method=method, headers=hdr)
    try:
        r = urllib.request.urlopen(req, timeout=300)
        return r.status, r.read(), r.headers.get('Content-Type') or 'application/octet-stream', r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get('Content-Type') or 'text/plain', url
    except Exception as e:
        return 599, json.dumps({'error': 'нет связи с ' + u.hostname + ': ' + str(getattr(e, 'reason', e))}, ensure_ascii=False).encode(), 'application/json', ''

# ---------- «Выделить объект» на видеокарте: BiRefNet_HR (birefnet/subject.py) ----------
_subj = None
def subject_mod():
    global _subj
    if _subj is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location('proyavka_subject', os.path.join(HERE, 'birefnet', 'subject.py'))
        _subj = importlib.util.module_from_spec(spec); spec.loader.exec_module(_subj)
    return _subj
def subject_state(kind='general'):
    try: return subject_mod().status(MODEL_DIR, kind)
    except Exception as e: return {'status': 'error', 'note': str(e)}

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
            return self.reply(200, json.dumps({'ok': True, 'host': socket.gethostname(), 'ml': True, 'subject': subject_state(), 'matting': subject_state('matting')}, ensure_ascii=False).encode())
        if path.startswith('/proyavka/subject'):
            n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
            try:
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query); size = int((q.get('size') or ['0'])[0]) or None
                return self.reply(200, subject_mod().run(MODEL_DIR, body, size, p, (q.get('kind') or ['general'])[0]), 'image/png')
            except Exception as e:
                p('Выделение объекта — ошибка:', e); return self.reply(500, json.dumps({'error': str(e)}, ensure_ascii=False).encode())
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else None
        if path.startswith('/plugin/'):
            parts = [urllib.parse.unquote(x) for x in path.split('?')[0].split('/')[2:]]
            pid = parts[0] if parts else ''
            if pid not in PLUGIN_IDS: return self.reply(404, b'{}')
            if len(parts) == 2 and parts[1] == 'manifest':
                m = plugin_manifest(pid)
                return self.reply(200 if m else 404, json.dumps(m or {'error': 'плагин не установлен'}, ensure_ascii=False).encode())
            if len(parts) == 3 and parts[1] == 'file' and parts[2] in PLUGIN_FILES:
                d = plugin_dir(pid); f = d and os.path.join(d, parts[2])
                if not f or not os.path.isfile(f): return self.reply(404, b'{}')
                ct = {'html': 'text/html', 'js': 'text/javascript', 'json': 'application/json'}[parts[2].rsplit('.', 1)[1]]
                return self.reply(200, open(f, 'rb').read(), ct + '; charset=utf-8')
            if len(parts) == 3 and parts[1] == 'data' and _re.fullmatch(r'[\w.-]+\.(json|jsonl|txt)', parts[2]):
                f = os.path.join(plugin_data_dir(pid), parts[2])
                if self.command == 'POST':
                    open(f + '.part', 'wb').write(body or b''); os.replace(f + '.part', f); return self.reply(200, b'{"ok":true}')
                if not os.path.isfile(f): return self.reply(404, b'{}')
                return self.reply(200, open(f, 'rb').read(), 'text/plain; charset=utf-8')
            return self.reply(404, b'{}')
        if path == '/net/proxy':
            code, data, ct, final = net_proxy(self, body)
            self.send_response(code); self.cors(); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(data)))
            if code == 599: self.send_header('X-Proxy-Error', '1')
            self.send_header('Access-Control-Expose-Headers', 'X-Proxy-Error'); self.end_headers(); self.wfile.write(data); return
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

# ---------- обновление моста без участия человека: файл поменялся — мост перезапускается сам ----------
WATCH = [os.path.abspath(__file__), os.path.join(HERE, 'birefnet', 'subject.py')]
def _stamp(): return tuple(os.path.getmtime(f) if os.path.exists(f) else 0 for f in WATCH)
def watch_self(srv):
    st = _stamp()
    while True:
        time.sleep(4)
        try: now = _stamp()
        except Exception: continue
        if now == st: continue
        time.sleep(2)  # let the copy finish
        p(time.strftime('%H:%M:%S'), 'Мост обновлён — перезапускаюсь…')
        try: srv.socket.close()  # free the port for the new process (shutdown() would wait on the serving loop)
        except Exception: pass
        log = open(os.path.join(HERE, 'bridge.log'), 'a', encoding='utf-8')
        flags = (0x00000008 | 0x08000000) if os.name == 'nt' else 0  # DETACHED_PROCESS | CREATE_NO_WINDOW
        subprocess.Popen([sys.executable, os.path.abspath(__file__)], cwd=HERE, stdout=log, stderr=log, stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
        os._exit(0)

def main():
    ip = lan_ip(); ensure_certs(ip)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(os.path.join(HERE, 'server.crt'), os.path.join(HERE, 'server.key'))
    srv = Server(('0.0.0.0', PORT), H); srv.socket = ctx.wrap_socket(srv.socket, server_side=True, do_handshake_on_connect=False)  # handshake in the worker thread, a slow client can't stall the rest
    addr = f'https://{ip}:{PORT}{PREFIX}'
    try: open(os.path.join(DESKTOP, 'Проявка-адрес-моста.txt'), 'w', encoding='utf-8').write(addr + '\n')
    except Exception: pass
    p(''); p('Мост «Проявки» работает.'); p('Адрес для «Проявки» на iPad (⚙ → Свой ПК):'); p('   ' + addr); p('')
    p('Это окно не закрывай, пока работаешь с iPad. Automatic1111 тоже должен быть запущен.')
    try:  # the selection model downloads in the background once, so the first «Выделить объект» does not wait for it
        sm = subject_mod()
        __import__('threading').Thread(target=sm.download_all, args=(MODEL_DIR, p), daemon=True).start()
    except Exception as e: p('Модель выделения недоступна:', e)
    __import__('threading').Thread(target=watch_self, args=(srv,), daemon=True).start()
    srv.serve_forever()

if __name__ == '__main__':
    try: main()
    except Exception as e:
        p('Ошибка:', e); input('Нажми Enter, чтобы закрыть…')
