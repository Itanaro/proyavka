#!/usr/bin/env python3
"""Выпуск версии: номер и подпись ставятся везде одинаково.

    python3 tools/release.py 110 "что сделано коротко"

1. APP_VERSION в index.html  → 'ГГГГ-ММ-ДД · №110 что сделано коротко' (дата — сегодня по Москве)
2. version.json              → то же самое
Перед этим проверяет, что в docs/log/ есть «## №110», в шапке docs/STATE.md — «№110»,
в docs/HISTORY.md — строка «- №110». Если чего-то нет — ничего не меняет и говорит, что дописать.
В конце запускает tools/check.py.
Коммит и push делаешь сам после этого: git add -A && git commit -m "№110: …" && git push
"""
import datetime, json, os, re, subprocess, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
if len(sys.argv) < 3 or not sys.argv[1].isdigit():
    print(__doc__); sys.exit(2)
N, words = int(sys.argv[1]), ' '.join(sys.argv[2:]).strip()
msk = datetime.timezone(datetime.timedelta(hours=3))
today = datetime.datetime.now(msk).strftime('%Y-%m-%d')
ver = f'{today} · №{N} {words}'

html = open('index.html', encoding='utf-8').read()
old = re.search(r"const APP_VERSION='([^']*)'", html)
prev = int(re.search(r'№(\d+)', old.group(1)).group(1))
if N not in (prev, prev + 1):
    print(f'Сейчас №{prev}; следующий номер — №{prev + 1}, а не №{N}.'); sys.exit(1)

# сначала записи — без них версию не трогаем
missing = []
if not any(re.search(rf'^## №{N}\b', open(p, encoding='utf-8').read(), re.M) for p in glob.glob('docs/log/*.md')):
    missing.append(f'запись «## №{N} — …» в конце последнего файла docs/log/')
if not re.search(rf'Версия: №{N}\b', open('docs/STATE.md', encoding='utf-8').read()):
    missing.append(f'обновить шапку docs/STATE.md (версия №{N}, что проверить вживую)')
if not re.search(rf'^- №{N}\b', open('docs/HISTORY.md', encoding='utf-8').read(), re.M):
    missing.append(f'строка «- №{N} …» в docs/HISTORY.md')
if missing:
    print(f'Версия №{N} не выпущена — сначала допиши:')
    for m in missing:
        print('  -', m)
    sys.exit(1)

html = re.sub(r"const APP_VERSION='[^']*'", lambda m: f"const APP_VERSION='{ver}'", html, count=1)
open('index.html', 'w', encoding='utf-8').write(html)
open('version.json', 'w', encoding='utf-8').write(json.dumps({'v': ver}, ensure_ascii=False))
print('APP_VERSION и version.json →', ver, '\n')
sys.exit(subprocess.run([sys.executable, 'tools/check.py']).returncode)
