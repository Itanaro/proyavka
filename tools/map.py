#!/usr/bin/env python3
"""Карта index.html: разделы (заголовки /* ==== … */) с номерами строк и функциями внутри.

Запуск из корня репозитория:
    python3 tools/map.py            — разделы и номера строк
    python3 tools/map.py -f         — плюс имена функций в каждом разделе
    python3 tools/map.py слово      — только разделы, где в заголовке или функциях есть «слово»
                                       (русское название инструмента переводится в имя из кода)

Номера строк меняются с каждой правкой, поэтому в docs/MAP.md их нет — там заголовки,
а точное место всегда даёт этот скрипт.
"""
import re, sys

SRC = 'index.html'
HEAD = re.compile(r'^\s*/\*\s*(={4,}|-{4})\s*(.+?)\s*(={4,}|-{4})?\s*(\*/)?\s*$')
HEAD_LOOSE = re.compile(r'^\s*/\*\s*(={4,}|-{4})\s*(.+)$')
FN = re.compile(r'(?:^|[\s;{(])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|'
                r'(?:^|[\s;{])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>')

# русское название инструмента → как он зовётся в коде (имена функций английские)
ALIASES = {
    'градиент': 'grad', 'доводк': 'detail', 'деталь': 'detail', 'реф': 'ref', 'истори': 'hist',
    'островок': 'island', 'смарт': 'smart', 'марионет': 'pup', 'пластик': 'liq', 'кадрир': 'crop',
    'глубин': 'depth', 'свет': 'light', 'дымк': 'haze', 'гармониз': 'harm', 'коррекц': 'adj',
    'кривые': 'curve', 'уровни': 'level', 'карта градиента': 'gmap', 'выборочн': 'selc',
    'обтрав': 'clip', 'маск': 'mask', 'выделен': 'sel', 'лассо': 'lasso', 'палочк': 'wand',
    'кист': 'brush', 'мазок': 'stroke', 'пипетк': 'eye', 'заплатк': 'patch', 'штамп': 'clone',
    'удален': 'removal', 'трансформ': 'xf', 'вкладк': 'tab', 'начало': 'home', 'тем': 'theme',
    'сдать': 'deliver', 'зона': 'safe', 'линейк': 'ruler', 'поз': 'pose', 'арт-директор': 'crit',
    'заметк': 'notes', 'вписать': 'fitInto', 'расширить': 'expand', 'генерац': 'gen',
    'мост': 'bridge', 'облак': 'cloud', 'сохран': 'save', 'автосохран': 'autosave', 'psd': 'psd',
    'размер изображ': 'imageSize', 'размер холста': 'canvasSize', 'отмен': 'hist', 'слой': 'layer',
    'палитр': 'picker', 'справк': 'help', 'клавиш': 'keydown', 'ai edit': 'ae', 'плагин': 'ae',
}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    show_fn = '-f' in sys.argv or bool(args)
    word = ' '.join(args).lower() if args else None
    if word:
        for ru, code in ALIASES.items():
            if word.startswith(ru) or ru.startswith(word):
                print(f'«{word}» в коде ищется как «{code}»'); word = code.lower(); break
    lines = open(SRC, encoding='utf-8').read().split('\n')
    secs = []
    for i, ln in enumerate(lines, 1):
        m = HEAD.match(ln) or HEAD_LOOSE.match(ln)
        if m and len(ln) < 400:
            title = re.sub(r'\s*(={3,}|-{3,})?\s*(\*/)?\s*$', '', m.group(2)).strip()
            level = 1 if m.group(1).startswith('=') else 2
            secs.append([i, level, title, []])
    if not secs:
        print('разделов не найдено'); return
    si = 0
    for i, ln in enumerate(lines, 1):
        while si + 1 < len(secs) and secs[si + 1][0] <= i:
            si += 1
        if i < secs[0][0]:
            continue
        for m in FN.finditer(ln):
            name = m.group(1) or m.group(2)
            if name and name not in secs[si][3]:
                secs[si][3].append(name)
    print(f'{SRC}: {len(lines)} строк, разделов {len(secs)}')
    for ln, level, title, fns in secs:
        hay = (title + ' ' + ' '.join(fns)).lower()
        if word and word not in hay:
            continue
        pad = '' if level == 1 else '    '
        print(f'{ln:>6}  {pad}{title[:110]}')
        if show_fn and fns:
            shown = [f for f in fns if not word or word in f.lower()] if word and word not in title.lower() else fns
            print(f'        {pad}  ' + ', '.join(shown[:40]) + (' …' if len(shown) > 40 else ''))

if __name__ == '__main__':
    main()
