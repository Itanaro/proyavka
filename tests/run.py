#!/usr/bin/env python3
"""Автотесты Проявки одной командой.

    python3 tests/run.py                 — все экраны (ПК 1920, ПК 1366, iPad альбом, iPad портрет)
    python3 tests/run.py pc1920 ipadL    — только эти экраны
    python3 tests/run.py --only смарт    — только шаги, в названии которых есть «смарт»
    python3 tests/run.py --out /путь     — куда класть отчёт и скриншоты

Сам поднимает сайт (http://127.0.0.1:8766) и заглушку нейросетей (tests/stub.py, :8199),
гоняет tests/smoke.js в Chromium и печатает итог. Код выхода 0 — всё зелёное.
Отчёт: <out>/report.json, скриншоты: <out>/*.png. По умолчанию out — временная папка
вне репозитория (в репозиторий ничего не пишется).
"""
import functools, http.server, os, subprocess, sys, tempfile, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stub

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_PORT, STUB_PORT = 8766, 8199

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()

def main():
    args = sys.argv[1:]
    out = os.environ.get('PROYAVKA_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'proyavka-tests')
    if '--out' in args:
        i = args.index('--out'); out = args[i + 1]; del args[i:i + 2]
    os.makedirs(out, exist_ok=True)
    site = http.server.ThreadingHTTPServer(('127.0.0.1', SITE_PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=site.serve_forever, daemon=True).start()
    stub.serve(STUB_PORT)
    env = dict(os.environ, NODE_PATH='/opt/node22/lib/node_modules', PROYAVKA_TEST_OUT=out,
               PROYAVKA_URL=f'http://127.0.0.1:{SITE_PORT}/', PROYAVKA_STUB=f'http://127.0.0.1:{STUB_PORT}')
    node = '/opt/node22/bin/node' if os.path.exists('/opt/node22/bin/node') else 'node'
    r = subprocess.run([node, os.path.join(ROOT, 'tests', 'smoke.js'), *args], env=env)
    site.shutdown()
    print(f'\nОтчёт и скриншоты: {out}')
    sys.exit(r.returncode)

if __name__ == '__main__':
    main()
