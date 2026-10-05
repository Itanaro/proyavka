# -*- coding: utf-8 -*-
"""Нейросети выделения на видеокарте ПК: BiRefNet_HR (MIT, github.com/ZhengPeng7/BiRefNet), 2048×2048.
general — «Выделить объект»: волосы, прозрачная ткань, тонкие детали.
matting — «Удалить фон с мягким краем»: та же сеть, обученная на альфа-каналах (полупрозрачность волос и ткани).
Работает в Python портативного SD (torch + CUDA уже есть), веса (~420 МБ каждая) скачиваются один раз в models/."""
import os, sys, io, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REL = 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/'
VARIANTS = {'general': 'BiRefNet_HR-general-epoch_130.pth', 'matting': 'BiRefNet_HR-matting-epoch_135.pth'}
WEIGHTS = VARIANTS['general']   # kept for the bridge's older status check
SIZE = 2048
STATE = {k: {'status': 'not-loaded', 'note': ''} for k in VARIANTS}
_lock = threading.Lock(); _dl_lock = threading.Lock()
_models = {}; _dev = None


def _path(models_dir, kind='general'):
    return os.path.join(models_dir, VARIANTS[kind])


def status(models_dir, kind='general'):
    st = dict(STATE[kind])
    if st['status'] == 'not-loaded' and not os.path.exists(_path(models_dir, kind)): st['status'] = 'no-weights'
    return st


def download(models_dir, log=print, kind='general'):
    """Background download; status goes to STATE so «Проявка» can show it."""
    with _dl_lock:
        f = _path(models_dir, kind); S = STATE[kind]
        if os.path.exists(f): return True
        os.makedirs(models_dir, exist_ok=True)
        try:
            S.update(status='downloading', note='0%'); log('Скачиваю модель', kind, '(~420 МБ)…')
            r = urllib.request.urlopen(REL + VARIANTS[kind], timeout=60); total = int(r.headers.get('Content-Length') or 0); got = 0; part = f + '.part'
            with open(part, 'wb') as o:
                while True:
                    b = r.read(1 << 20)
                    if not b: break
                    o.write(b); got += len(b)
                    if total: S['note'] = f'{got * 100 // total}%'
            if total and got != total: raise IOError(f'скачалось {got} из {total} байт')
            os.replace(part, f); S.update(status='not-loaded', note=''); log('Модель', kind, 'скачана.'); return True
        except Exception as e:
            S.update(status='error', note='не скачалась: ' + str(e)); log('Модель', kind, 'не скачалась:', e)
        return False


def download_all(models_dir, log=print):
    for k in VARIANTS: download(models_dir, log, k)


def _load(models_dir, log=print, kind='general'):
    global _dev
    if kind in _models: return _models[kind]
    import torch
    f = _path(models_dir, kind); S = STATE[kind]
    if not os.path.exists(f):
        if not download(models_dir, log, kind): raise RuntimeError(S['note'] or 'нет весов модели')
    S.update(status='loading', note='')
    sd = torch.load(f, map_location='cpu', weights_only=True)
    if isinstance(sd, dict) and 'state_dict' in sd and isinstance(sd['state_dict'], dict): sd = sd['state_dict']
    def clean(k):  # same as utils.check_state_dict in the original repo
        n = 0
        for pre in ('module.', '_orig_mod.'):
            if k[n:].startswith(pre): n += len(pre)
        return k[n:]
    sd = {clean(k): v for k, v in sd.items()}
    # BatchNorm layers exist only when the model was trained with batch > 1 — follow the weights
    os.environ['BIREFNET_BS'] = '4' if any('.bn_in.' in k or k.endswith('bn.weight') for k in sd) else '1'
    if HERE not in sys.path: sys.path.insert(0, HERE)
    # the modules read the config at import time: a second variant with another batch setting needs a fresh import
    for name in [n for n in list(sys.modules) if n == 'config' or n == 'models' or n.startswith('models.')]:
        del sys.modules[name]
    from models.birefnet import BiRefNet
    m = BiRefNet(bb_pretrained=False)
    missing, unexpected = m.load_state_dict(sd, strict=False)
    missing = [k for k in missing if not k.endswith('num_batches_tracked')]
    if missing or unexpected:
        S.update(status='error', note='веса не совпали с моделью')
        raise RuntimeError(f'веса не совпали с моделью: нет {len(missing)} ({missing[:3]}), лишних {len(unexpected)} ({unexpected[:3]})')
    _dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    m.eval().to(_dev); _models[kind] = m
    S.update(status='ready', note='GPU' if _dev == 'cuda' else 'CPU')
    log('Модель', kind, 'готова ·', S['note'])
    return m


def run(models_dir, img_bytes, size=None, log=print, kind='general'):
    """image bytes (png/jpg) → grayscale PNG of the same size: white = the main object (matting: true soft alpha)."""
    import torch, numpy as np
    import torch.nn.functional as F
    from PIL import Image
    if kind not in VARIANTS: kind = 'general'
    with _lock:
        m = _load(models_dir, log, kind)
        im = Image.open(io.BytesIO(img_bytes)).convert('RGB'); W, H = im.size
        a = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float().div(255).unsqueeze(0)
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1); std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
        t0 = time.time(); sizes = [size or SIZE] if _dev == 'cuda' else [1024]
        if _dev == 'cuda' and sizes[0] > 1024: sizes.append(1024)   # out of video memory (SD is loaded too) → a smaller pass
        for i, S in enumerate(sizes):
            try:
                x = F.interpolate(a, size=(S, S), mode='bilinear', align_corners=False)
                x = ((x - mean) / std).to(_dev)
                with torch.no_grad():
                    if _dev == 'cuda':
                        with torch.autocast('cuda', dtype=torch.float16):
                            y = m(x)[-1]
                    else:
                        y = m(x)[-1]
                    y = torch.sigmoid(y.float())
                    y = F.interpolate(y, size=(H, W), mode='bicubic' if kind == 'matting' else 'bilinear', align_corners=False)[0, 0]
                    out = (y.clamp(0, 1) * 255).round().byte().cpu().numpy()
                break
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                if i == len(sizes) - 1: raise RuntimeError('не хватило видеопамяти — закрой лишнее в Automatic1111 и повтори')
                log('Выделение: мало видеопамяти, считаю в 1024')
            finally:
                if _dev == 'cuda': torch.cuda.empty_cache()   # give memory back to Automatic1111 right away
        buf = io.BytesIO(); Image.fromarray(out, 'L').save(buf, 'PNG', compress_level=1)
        log(time.strftime('%H:%M:%S'), f'{kind} {W}×{H} · {S}px · {time.time() - t0:.1f} с')
        return buf.getvalue()
