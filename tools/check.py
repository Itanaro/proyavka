#!/usr/bin/env python3
"""Сверка «всё ли записано» — запускать в начале каждого чата и перед каждым push.

    python3 tools/check.py

Проверяет, что одна и та же версия стоит везде:
  index.html (APP_VERSION) · version.json · последний коммит с номером · docs/STATE.md · docs/log/
и что в публичных файлах нет личного (адреса, почта, пути с именем пользователя).
Код выхода 0 — всё сходится, 1 — есть расхождения (они перечислены).
"""
import json, os, re, subprocess, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
problems, notes = [], []

def read(p):
    try:
        return open(p, encoding='utf-8').read()
    except FileNotFoundError:
        problems.append(f'нет файла {p}')
        return ''

# 1. версия в программе
html = read('index.html')
m = re.search(r"const APP_VERSION='([^']*)'", html)
app = m.group(1) if m else ''
num = re.search(r'№(\d+)', app)
N = int(num.group(1)) if num else None
if not N:
    problems.append('в index.html не найден APP_VERSION с номером')

# 2. version.json (по нему айпад и ПК узнают о новой версии)
try:
    vj = json.loads(read('version.json') or '{}').get('v', '')
except ValueError:
    vj = ''
if vj != app:
    problems.append(f'version.json «{vj}» ≠ APP_VERSION «{app}» — плашка «Есть новая версия» не появится')

# 3. последний коммит с номером
try:
    log = subprocess.run(['git', 'log', '--format=%h %s', '-40'], capture_output=True, text=True).stdout.splitlines()
except Exception:
    log = []
last_num = None
for ln in log:
    mm = re.search(r'№(\d+)', ln)
    if mm:
        last_num = int(mm.group(1)); last_line = ln; break
if N and last_num and last_num != N:
    # незакоммиченная правка с новым номером — это нормально, пока идёт работа
    dirty = subprocess.run(['git', 'status', '--porcelain', 'index.html'], capture_output=True, text=True).stdout.strip()
    (notes if dirty and N == last_num + 1 else problems).append(
        f'последний коммит с номером — №{last_num}, а в программе №{N}' + (' (правка ещё не закоммичена)' if dirty else ''))

# 4. docs/STATE.md знает текущую версию
state = read('docs/STATE.md')
sv = re.search(r'Версия: №(\d+)', state)
if N and (not sv or int(sv.group(1)) != N):
    problems.append(f'docs/STATE.md не обновлён: там «Версия: №{sv.group(1) if sv else "?"}», а в программе №{N}')

# 5. журнал: последняя запись = текущий номер
logs = sorted(glob.glob('docs/log/*.md'))
last_entry = None
for p in logs:
    for mm in re.finditer(r'^## №(\d+)', read(p), re.M):
        last_entry = max(last_entry or 0, int(mm.group(1)))
if N and last_entry != N:
    problems.append(f'в docs/log/ последняя запись №{last_entry}, а версия №{N} — запись о правке не сделана')

# 6. личное в публичных файлах (репозиторий открыт)
LEAKS = [
    (r'\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b(?<!\.0\.0)(?!/)', 'адрес Tailscale'),  # не диапазон 100.64.0.0/10
    (r'\b192\.168\.\d{1,3}\.(?!1\b)\d{1,3}\b', 'домашний адрес в сети'),
    (r'[\w.+-]+@(gmail|yandex|mail|icloud|outlook)\.\w+', 'почта'),
    (r'Users\\\\?[A-Z][\w ]+\\\\?AppData', 'путь с именем пользователя Windows'),
    (r'desktop-[0-9a-z]{6,}', 'имя компьютера'),
    (r'(sk|or|AIza)[-_][A-Za-z0-9_-]{20,}', 'похоже на ключ API'),
]
pub = ['CLAUDE.md', 'README.md'] + glob.glob('docs/**/*.md', recursive=True) + \
      [f for d in ('pc-bridge', 'pc-app', 'tools', 'ios') for f in glob.glob(d + '/**/*', recursive=True)
       if os.path.isfile(f) and f.endswith(('.py', '.js', '.bat', '.ps1', '.vbs', '.md', '.json', '.yml', '.swift'))]
for p in pub:
    try:
        t = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    except UnicodeDecodeError:
        t = open(p, encoding='utf-16', errors='ignore').read()
    for rx, what in LEAKS:
        for mm in re.finditer(rx, t):
            line = t.count('\n', 0, mm.start()) + 1
            problems.append(f'{p}:{line} — {what} в публичном файле («{mm.group(0)[:24]}…»); перенеси в claude/proyavka-private.md')

# итог
print(f'Версия в программе: {app or "?"}')
if log:
    print('Последние коммиты:')
    for ln in log[:5]:
        print('   ', ln)
for n in notes:
    print('ℹ', n)
if problems:
    print('\n✗ Расхождения:')
    for p in problems:
        print('  -', p)
    sys.exit(1)
print(f'\n✓ Всё сходится: №{N} в программе, version.json, коммите, STATE и журнале; личного в публичных файлах нет.')
