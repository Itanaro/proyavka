# -*- coding: utf-8 -*-
"""«Выделить объект» на видеокарте ПК: BiRefNet_HR (MIT, github.com/ZhengPeng7/BiRefNet), 2048×2048.
Самая сильная открытая модель «главного объекта» на сегодня: волосы, прозрачная ткань, тонкие детали.
Работает в Python портативного SD (torch + CUDA уже есть), веса (~420 МБ) скачиваются один раз в models/."""
import os, sys, io, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = 'BiRefNet_HR-general-epoch_130.pth'
URLS = ['https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/' + WEIGHTS]
SIZE = 2048
STATE = {'status': 'not-loaded', 'note': ''}
_lock = threading.Lock(); _dl_lock = threading.Lock()
_model = None; _dev = None


def _path(models_dir):
    return os.path.join(models_dir, WEIGHTS)


def download(models_dir, log=print):
    """Background download; status goes to STATE so «Проявка» can show it."""
    with _dl_lock:
        f = _path(models_dir)
        if os.path.exists(f): return True
        os.makedirs(models_dir, exist_ok=True)
        for url in URLS:
            try:
                STATE.update(status='downloading', note='0%'); log('Скачиваю модель выделения BiRefNet_HR (~420 МБ)…')
                r = urllib.request.urlopen(url, timeout=60); total = int(r.headers.get('Content-Length') or 0); got = 0; part = f + '.part'
                with open(part, 'wb') as o:
                    while True:
                        b = r.read(1 << 20)
                        if not b: break
                        o.write(b); got += len(b)
                        if total: STATE['note'] = f'{got * 100 // total}%'
                if total and got != total: raise IOError(f'скачалось {got} из {total} байт')
                os.replace(part, f); STATE.update(status='not-loaded', note=''); log('Модель выделения скачана.'); return True
            except Exception as e:
                STATE.update(status='error', note='не скачалась: ' + str(e)); log('Модель выделения не скачалась:', e)
        return False


def _load(models_dir, log=print):
    global _model, _dev
    if _model is not None: return _model
    import torch
    f = _path(models_dir)
    if not os.path.exists(f):
        if not download(models_dir, log): raise RuntimeError(STATE['note'] or 'нет весов модели')
    STATE.update(status='loading', note='')
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
    from models.birefnet import BiRefNet
    m = BiRefNet(bb_pretrained=False)
    missing, unexpected = m.load_state_dict(sd, strict=False)
    missing = [k for k in missing if not k.endswith('num_batches_tracked')]
    if missing or unexpected:
        raise RuntimeError(f'веса не совпали с моделью: нет {len(missing)} ({missing[:3]}), лишних {len(unexpected)} ({unexpected[:3]})')
    _dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    m.eval().to(_dev); _model = m
    STATE.update(status='ready', note='GPU' if _dev == 'cuda' else 'CPU')
    log('Модель выделения готова ·', STATE['note'])
    return m


def run(models_dir, img_bytes, size=None, log=print):
    """image bytes (png/jpg) → grayscale PNG of the same size: white = the main object."""
    import torch, numpy as np
    import torch.nn.functional as F
    from PIL import Image
    with _lock:
        m = _load(models_dir, log)
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
                    y = F.interpolate(y, size=(H, W), mode='bilinear', align_corners=False)[0, 0]
                    out = (y.clamp(0, 1) * 255).round().byte().cpu().numpy()
                break
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                if i == len(sizes) - 1: raise RuntimeError('не хватило видеопамяти — закрой лишнее в Automatic1111 и повтори')
                log('Выделение: мало видеопамяти, считаю в 1024')
            finally:
                if _dev == 'cuda': torch.cuda.empty_cache()   # give memory back to Automatic1111 right away
        buf = io.BytesIO(); Image.fromarray(out, 'L').save(buf, 'PNG', compress_level=1)
        log(time.strftime('%H:%M:%S'), f'выделение объекта {W}×{H} · {S}px · {time.time() - t0:.1f} с')
        return buf.getvalue()
