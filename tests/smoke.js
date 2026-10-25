// Сквозной прогон Проявки: основные функции на ПК- и айпад-экранах.
// Запуск — через tests/run.py (он поднимает сайт и заглушку нейросетей).
// Новая функция редактора → новый шаг сюда (см. tests/README.md).
const { chromium, PROFILES, runSteps, report, penDrag, mouseDrag, until, check } = require('./lib');
const STUB = process.env.PROYAVKA_STUB || 'http://127.0.0.1:8199';

const W = 1200, H = 1600;               // небольшой документ — тесты быстрее, пропорция 3:4 как у ката
const C = [W / 2, H / 2];

// пиксель слоя (по умолчанию активного) в точке документа
const alphaAt = (page, x, y, li) => page.evaluate(([x, y, li]) => { const L = li == null ? AL() : doc.layers[li]; return L.ctx.getImageData(x, y, 1, 1).data[3]; }, [x, y, li]);
const rgbaAt = (page, x, y) => page.evaluate(([x, y]) => [...AL().ctx.getImageData(x, y, 1, 1).data], [x, y]);
const notBusy = page => until(page, () => !document.getElementById('busy') || document.getElementById('busy').hidden || getComputedStyle(document.getElementById('busy')).display === 'none', null, 20000, 'конец «Работаю…»');
const closeDialogs = page => page.evaluate(() => document.querySelectorAll('.scrim').forEach(s => s.remove()));

const steps = [
  { name: 'Запуск: экран «Начало», нужная версия (ПК / iPad)', always: true, run: async (page, T) => {
      const v = await page.evaluate(() => ({ desk: IS_DESK, ipad: IS_IPAD }));
      check(v.desk === T.profile.desk, `ожидалась ${T.profile.desk ? 'ПК' : 'айпад'}-версия, а включилась ${v.desk ? 'ПК' : 'айпад'}-версия`);
      check(await page.evaluate(() => homeOn && !document.getElementById('home').hidden), 'при первом запуске должен быть экран «Начало»');
  }},

  { name: 'Новый документ', always: true, run: async page => {
      await page.evaluate(([w, h]) => createDoc(w, h, 'Тест'), [W, H]);
      const r = await page.evaluate(() => ({ w: doc.w, h: doc.h, n: doc.layers.length, home: homeOn }));
      check(r.w === W && r.h === H && r.n === 2, `ожидался документ ${W}×${H} с 2 слоями, а вышло ${r.w}×${r.h}, слоёв ${r.n}`);
      check(!r.home, '«Начало» не спряталось');
  }},

  { name: 'Кисть пером, отмена и возврат', run: async page => {
      await page.evaluate(() => { setTool('brush'); setColor('#ff2020'); doc.active = doc.layers.length - 1; layersChanged(); });
      await penDrag(page, [[C[0] - 200, C[1]], [C[0] + 200, C[1]]]);
      check(await alphaAt(page, C[0], C[1]) > 0, 'мазок не лёг на слой');
      await page.evaluate(() => undo()); check(await alphaAt(page, C[0], C[1]) === 0, 'отмена не убрала мазок');
      await page.evaluate(() => redo()); check(await alphaAt(page, C[0], C[1]) > 0, 'возврат не вернул мазок');
  }},

  { name: 'Все инструменты включаются', run: async page => {
      // глубина, тап по объекту и удаление сразу грузят нейросеть и закрывают экран «Работаю…» — их здесь не трогаем
      const HEAVY = ['depth', 'tap', 'remove'];
      const bad = await page.evaluate(HEAVY => { const out = [];
        for (const g of Object.values(TOOL_GROUPS)) for (const [t] of g.items) { if (t.startsWith('@') || HEAVY.includes(t)) continue; setTool(t); if (S.tool !== t) out.push(t); if (xf) xfCancel(); }
        setTool('brush'); return out; }, HEAVY);
      await notBusy(page);
      check(!bad.length, 'не включились: ' + bad.join(', '));
  }},

  { name: 'Прямоугольное выделение пером, снятие', run: async page => {
      await page.evaluate(() => setTool('rect'));
      await penDrag(page, [[200, 300], [700, 900]]);
      const b = await page.evaluate(() => sel && selBBox ? (selBBox() || {}) : null);
      check(b, 'выделение не появилось');
      await page.evaluate(() => deselect()); check(await page.evaluate(() => !sel), 'выделение не снялось');
  }},

  { name: 'Прямоугольное выделение настоящей мышью (ПК)', desk: true, run: async page => {
      await page.evaluate(() => setTool('rect'));
      await mouseDrag(page, [150, 150], [500, 600]);
      check(await page.evaluate(() => !!sel), 'мышью выделение не появилось');
      await page.keyboard.press('Control+KeyD'); await page.waitForTimeout(150);
      check(await page.evaluate(() => !sel), 'Ctrl+D не снял выделение');
  }},

  { name: 'Слои: новый, копия, группа, слить видимые, отмена', run: async page => {
      const n0 = await page.evaluate(() => (window.__n0 = doc.layers.length));
      await page.evaluate(() => { insertLayer(newLayer('Т1'), doc.active + 1); dupLayer(); });
      check(await page.evaluate(() => doc.layers.length) === n0 + 2, 'новый слой или копия не добавились');
      await page.evaluate(() => makeGroup());
      check(await page.evaluate(() => doc.layers.some(isGroup)), 'группа не создалась');
      await page.evaluate(() => mergeVisible());
      const after = await page.evaluate(() => doc.layers.filter(L => !isGroup(L)).length);
      check(after === 1, `после «Слить видимые» ожидался один слой, а их ${after}`);
      await page.evaluate(() => { undo(); undo(); undo(); undo(); });
      check(await page.evaluate(() => doc.layers.length) === n0, 'четыре отмены не вернули слои');
  }},

  { name: 'Корректирующий слой и обтравка', run: async page => {
      await page.evaluate(() => { addAdj('curves'); });
      check(await page.evaluate(() => isAdj(AL())), 'кривые не добавились');
      await page.evaluate(() => { if (typeof adjClose === 'function') adjClose(); toggleClip(AL()); });
      check(await page.evaluate(() => !!AL().clip), 'обтравка не включилась');
      await page.evaluate(() => { undo(); undo(); });
      check(await page.evaluate(() => !doc.layers.some(isAdj)), 'отмена не убрала корректирующий слой');
  }},

  { name: 'Градиент', run: async page => {
      await page.evaluate(() => { insertLayer(newLayer('Градиент'), doc.active + 1); setTool('gradient'); setColor('#2040ff'); });
      await penDrag(page, [[100, C[1]], [W - 100, C[1]]]);
      check(await alphaAt(page, 50, 50) > 0, 'градиент не залил слой');
      await page.evaluate(() => { undo(); undo(); setTool('brush'); });
  }},

  { name: 'Помещённая картинка: кнопки панели трансформа — на ней, Марионетка — на ней', run: async page => {
      const r = await page.evaluate(async () => {
        const n0 = doc.layers.length, base = doc.layers[doc.active];
        const c = mk(300, 200), x = ctx2(c); x.fillStyle = '#20a060'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#fff'; x.fillRect(0, 0, 60, 200);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await placeFile(new File([blob], 'ассет.png', { type: 'image/png' }));
        await new Promise(r => setTimeout(r, 300));
        const out = { xf: !!xf, added: doc.layers.length === n0 + 1 }, placed = doc.layers[doc.active];
        const px = () => { const d = ctx2(xf.float, { willReadFrequently: true }).getImageData(2, 2, 1, 1).data; return d[0]; };
        const before = px(); document.getElementById('xfFlipH').click(); out.flip = px() !== before;
        document.getElementById('xfContain').click(); out.fit = Math.abs(xf.float.width * xf.sx - doc.w) < 2 || Math.abs(xf.float.height * xf.sy - doc.h) < 2;
        document.getElementById('xfPuppet').click(); await new Promise(r => setTimeout(r, 200));
        out.kept = doc.layers.length === n0 + 1 && doc.layers.includes(placed);
        out.onPlaced = !!pup && pup.layer === placed && pup.layer !== base;
        if (pup) pupClose();
        while (doc.layers.length > n0) undo();
        out.back = doc.layers.length === n0;
        return out; });
      for (const [k, v] of Object.entries(r)) check(v, 'помещённая картинка: не так — ' + k);
  }},

  { name: 'Смарт-объект: поместить, без потерь, растрировать, отмена', run: async page => {
      const r = await page.evaluate(async () => {
        const c = mk(400, 300), x = ctx2(c); x.fillStyle = '#e04080'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#fff'; x.fillRect(100, 100, 50, 50);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await placeFile(new File([blob], 'смарт.png', { type: 'image/png' }));
        await new Promise(r => setTimeout(r, 300)); if (xf) xfApply();
        await new Promise(r => setTimeout(r, 200));
        return { smart: !!(AL() && AL().smart), w: AL().smart && AL().smart.src.width };
      });
      check(r.smart, '«Поместить» не создал смарт-объект');
      check(r.w === 400, `оригинал смарта должен быть 400 px, а он ${r.w}`);
      await page.evaluate(() => smartRasterize());
      check(await page.evaluate(() => !AL().smart), 'растрирование не сработало');
      await page.evaluate(() => undo());
      check(await page.evaluate(() => !!AL().smart), 'отмена не вернула смарт-объект');
  }},

  { name: 'PSD: записать и открыть обратно', run: async page => {
      const r = await page.evaluate(async () => {
        const n = doc.layers.length, smarts = doc.layers.filter(L => L.smart).length, name0 = doc.name;
        const buf = psdBuffer();
        await openPsd(new File([buf], 'круг.psd'));
        const back = { n0: n, n1: doc.layers.length, s0: smarts, s1: doc.layers.filter(L => L.smart).length, name: doc.name };
        return back;
      });
      check(r.n1 === r.n0, `слоёв было ${r.n0}, после PSD ${r.n1}`);
      check(r.s1 === r.s0, `смарт-объектов было ${r.s0}, после PSD ${r.s1}`);
      // вернуться на первую вкладку («Тест»)
      await page.evaluate(async () => { const t = TABS.list.find(t => t.doc && t.doc.name === 'Тест'); if (t) await tabSwitch(t); });
      check(await page.evaluate(() => doc.name) === 'Тест', 'не вернулась на вкладку «Тест»');
  }},

  { name: 'Кадрирование холста и отмена', run: async page => {
      await page.evaluate(() => canvasReframe(0, 0, 1000, 1400));
      check(await page.evaluate(() => doc.w === 1000 && doc.h === 1400), 'холст не обрезался');
      await page.evaluate(() => undo());
      check(await page.evaluate(([w, h]) => doc.w === w && doc.h === h, [W, H]), 'отмена не вернула размер');
  }},

  { name: 'ИИ на заглушке: «Реф с позы» → слой', run: async page => {
      await page.request.post(STUB + '/_reset');
      await page.evaluate(() => poseRefOpen());
      await until(page, () => !!aip, null, 5000, 'окно «Реф с позы»');
      await page.evaluate(() => aiGo());
      await until(page, () => doc.layers.some(L => /Реф с позы/.test(L.name)), null, 20000, 'слой «Реф с позы»');
      const log = await (await page.request.get(STUB + '/_log')).json();
      check(log.some(x => x.kind === 'image' && x.refs === 2), 'в модель не ушли кадр и образец стиля (2 картинки)');
      await page.evaluate(() => aip && aiDone());
  }},

  { name: 'ИИ на заглушке: Арт-директор → заметки', run: async page => {
      await page.evaluate(() => artDirector());
      await page.evaluate(() => critRun());
      await until(page, () => crit && !crit.busy && crit.notes && crit.notes.length === 2, null, 20000, 'два замечания арт-директора');
      await page.evaluate(() => { crit = null; const b = document.getElementById('critbar'); if (b) b.hidden = true; requestRender(); });
  }},

  { name: 'Рефы: клик по пустому окну открывает выбор файлов', run: async page => {
      await page.evaluate(() => { while (refsOf().length) refDel(0); refToggle(true); });
      await page.waitForSelector('#refwin .rempty');
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), page.click('#refwin .rempty')]);
      await page.evaluate(() => refToggle(false));
      check(!!fc && fc.isMultiple(), 'выбор файлов не открылся (или без выбора нескольких)');
  }},

  { name: 'Рефы: плитка в полном разрешении экрана, прозрачность сохраняется', run: async page => {
      const r = await page.evaluate(async () => {
        const n0 = refsOf().length;
        const c = mk(1600, 2400), x = ctx2(c); x.fillStyle = '#3050c0'; x.fillRect(400, 0, 800, 2400); // transparent sides
        await refAdd(c, 'Тест-реф'); refUI.t = 200; refToggle(true); await refRender();
        await new Promise(r => setTimeout(r, 600));
        const t = [...document.querySelectorAll('#refwin .rt')].pop(), cv = t && t.querySelector('canvas');
        const out = { tile: !!cv && cv.width >= Math.floor(t.clientWidth * (window.devicePixelRatio || 1)) - 2 && cv.width > 120 };
        const rr = refsOf()[refsOf().length - 1], b = await idbGet(PFX(doc.id) + rr.k); out.png = !!b && b.type === 'image/png';
        refDel(refsOf().length - 1); refUI.t = 110; refToggle(false); out.back = refsOf().length === n0;
        return out; });
      for (const [k, v] of Object.entries(r)) check(v, 'рефы: не так — ' + k);
  }},

  { name: 'Рефы: рамка уходит в Доводку, масштаб держится при смене размера окна', run: async page => {
      const r = await page.evaluate(async () => {
        const n0 = refsOf().length, d0 = detailRefs.length, w0 = refUI.w, h0 = refUI.h;
        const c = mk(1000, 2000), x = ctx2(c); x.fillStyle = '#c04030'; x.fillRect(0, 0, 1000, 2000);
        await refAdd(c, 'Тест-рамка'); refUI.w = 420; refUI.h = 520; refToggle(true);
        refView = { i: refsOf().length - 1, s: 0 }; await refRender(); await new Promise(r => setTimeout(r, 400));
        const out = {}; refView.s *= 3; refView.fitted = false; refView.redraw(); const s1 = refView.s;
        refUI.w = 600; refUI.h = 700; refPlace(); await new Promise(r => setTimeout(r, 400));
        out.zoomKept = Math.abs(refView.s - s1) < 1e-6;
        refView.s = 0; refView.redraw(); await new Promise(r => setTimeout(r, 100));
        refView.toggleFrame(true);
        const v = document.querySelector('#refwin .rv'), rr = v.getBoundingClientRect(), V = refView;
        const at = (ix, iy) => ({ clientX: rr.left + V.x + ix * V.s, clientY: rr.top + V.y + iy * V.s, pointerId: 7, button: 0, bubbles: true, pointerType: 'pen' });
        v.dispatchEvent(new PointerEvent('pointerdown', at(200, 100))); v.dispatchEvent(new PointerEvent('pointermove', at(500, 300)));
        v.dispatchEvent(new PointerEvent('pointermove', at(700, 500))); v.dispatchEvent(new PointerEvent('pointerup', at(700, 500)));
        const rf = refsOf()[refsOf().length - 1]; out.frame = !!rf.crop && Math.abs(rf.crop.w - 500) < 4 && Math.abs(rf.crop.h - 400) < 4;
        out.shown = !document.querySelector('#refwin .rcrop').hidden;
        await refToDetail(refsOf().length - 1); const dr = detailRefs[detailRefs.length - 1];
        out.detail = detailRefs.length === d0 + 1 && Math.abs(dr.width - 500) < 4 && Math.abs(dr.height - 400) < 4;
        detailRefs.length = d0; refView = null; await refRender();
        out.tileMark = !!document.querySelector('#refwin .rt:last-child .rtc');
        refDel(refsOf().length - 1); refUI.w = w0; refUI.h = h0; refToggle(false); out.back = refsOf().length === n0;
        return out; });
      for (const [k, v] of Object.entries(r)) check(v, 'рамка рефа: не так — ' + k);
  }},

  { name: 'Обзор: вся картина, рамкой выбрать место — масштаб возвращается туда; Esc — на место', run: async page => {
      const wait = async () => { await page.waitForFunction(() => viewTweens === 0, null, { timeout: 5000 }); await page.waitForTimeout(50); };
      const v0 = await page.evaluate(() => { setTool('brush'); fitView(); const F = viewFree(), cx = F.L + F.W / 2, cy = F.T + F.H / 2; zoomAt(cx, cy, 4); const q = toScr(300, 400); view.x += cx - q[0]; view.y += cy - q[1]; requestRender(); return { s: view.s, cv: contentVer }; });
      await page.evaluate(() => islandRun('obzor')); await wait();
      check(await page.evaluate(() => !!bird && birdFits()), 'обзор не показал картину целиком');
      await penDrag(page, [[300, 400], [600, 800], [900, 1200]]); await wait();
      const r = await page.evaluate(() => { const F = viewFree(), c = toDoc(F.L + F.W / 2, F.T + F.H / 2); return { bird: !!bird, s: view.s, cx: c[0], cy: c[1], cv: contentVer }; });
      check(!r.bird, 'обзор не закрылся после отпускания');
      check(Math.abs(r.s - v0.s) < 1e-6, 'масштаб не вернулся');
      check(Math.abs(r.cx - 900) < 8 && Math.abs(r.cy - 1200) < 8, `вернулся не туда: ${Math.round(r.cx)}, ${Math.round(r.cy)}`);
      check(r.cv === v0.cv, 'кисть нарисовала мазок во время обзора');
      const before = await page.evaluate(() => JSON.stringify(view));
      await page.evaluate(() => islandRun('obzor')); await wait(); await page.keyboard.press('Escape'); await wait();
      check(await page.evaluate(b => !bird && JSON.stringify(view) === b, before), 'Esc не вернул вид на место');
      await page.evaluate(() => fitView());
  }},

  { name: 'Окна: История со снимком, Рефы', run: async page => {
      await page.evaluate(() => { histToggle(true); histSnap(); refToggle(true); });
      const r = await page.evaluate(() => ({ snaps: (doc.snaps || []).length, refs: !refEl().hidden, hist: !histEl().hidden }));
      check(r.hist, 'панель «История» не открылась');
      check(r.snaps === 1, 'снимок не сделан');
      check(r.refs, 'окно рефов не открылось');
      await page.evaluate(() => { histToggle(false); refToggle(false); });
  }},

  { name: 'Диалоги открываются и закрываются', run: async page => {
      for (const f of ['showHelp', 'appearanceDialog', 'newDocDialog', 'imageSizeDialog', 'canvasSizeDialog', 'deliverDialog']) {
        await page.evaluate(f => window[f](), f); await page.waitForTimeout(150);
        const open = await page.evaluate(() => !!document.querySelector('.scrim, .dlg'));
        check(open, `${f}: окно не появилось`);
        await closeDialogs(page);
      }
  }},

  { name: '«Сдать кат»: проверки по стандарту', run: async page => {
      const r = await page.evaluate(() => deliverChecks());
      check(Array.isArray(r) && r.length >= 5, 'проверок меньше пяти');
      check(r.some(x => x.st === 'warn' || x.st === 'bad'), 'документ 1200×1600 должен получить предупреждение о размере');
  }},

  { name: '«Сдать кат»: стандарт 1500×2000, коррекция впечатана, без папки', run: async page => {
      const r = await page.evaluate(() => deliverChecks().map(x => x.t));
      check(!r.some(t => /папк/i.test(t)), 'осталась старая проверка про папку с коррекцией');
      check(r.some(t => /коррекц/i.test(t)), 'нет проверки «коррекция впечатана»');
      const ok = await page.evaluate(() => { const w = doc.w, h = doc.h; doc.w = 1500; doc.h = 2000; const c = deliverChecks()[0]; doc.w = w; doc.h = h; return c.st; });
      check(ok === 'ok', '1500×2000 должен проходить проверку размера, а вышло: ' + ok);
  }},

  { name: 'Группа «Трансформ и деформация» на левой панели', run: async page => {
      const r = await page.evaluate(() => ({ grp: !!document.querySelector('#rail [data-group="warp"]'), old: !!document.querySelector('#rail [data-tool="transform"]'),
        items: TOOL_GROUPS.warp.items.map(i => i[0]).join(','), tone: TOOL_GROUPS.tone.items.some(i => i[0] === 'liquify') }));
      check(r.grp, 'на левой панели нет новой группы'); check(!r.old, 'отдельная кнопка трансформа осталась');
      check(r.items === 'transform,@puppet,liquify', 'в группе не те инструменты: ' + r.items); check(!r.tone, 'пластика осталась в группе «Тон»');
      const on = await page.evaluate(() => { groupRun('liquify'); const b = document.querySelector('#rail [data-group="warp"]').classList.contains('on'); setTool('brush'); return b; });
      check(on, 'группа не подсветилась при пластике');
  }},

  { name: 'F2 — SD-ретушь выделения, как в Фотошопе (заглушка моста)', run: async page => {
      await page.request.post(STUB + '/_reset');
      await page.evaluate(stub => { genCfg.sdUrl = stub + '/k/test'; BR.base = null; BR.at = Date.now(); doc.active = 0; layersChanged(); applySelPoly([[300, 400], [700, 400], [700, 900], [300, 900]]); }, STUB);
      const n0 = await page.evaluate(() => (window.__n0 = doc.layers.length));
      await page.evaluate(() => closePops()); await page.keyboard.press('F2').catch(() => {});
      await page.waitForTimeout(300); await page.evaluate(() => { if (!sdq && doc.layers.length === window.__n0) sdQuick(); }); // iPad: no F2 — the menu item does the same
      await until(page, n => doc.layers.length > n && !sdq, n0, 20000, 'слой SD-ретуши');
      const r = await page.evaluate(() => { const L = AL(); return { name: L.name, mask: !!L.mask, a: L.ctx.getImageData(500, 600, 1, 1).data[3], out: L.ctx.getImageData(100, 100, 1, 1).data[3], chip: !document.getElementById('sdq') || document.getElementById('sdq').hidden }; });
      const log = (await (await page.request.get(STUB + '/_log')).json()).filter(x => x.kind === 'sd');
      check(log.length === 1, 'в Automatic1111 ушло запросов: ' + log.length);
      const q = log[0];
      check(q.prompt === 'STUBPROMPT smooth skin' && q.neg === 'stub neg', 'промпт не из плагина Фотошопа: ' + q.prompt);
      check(q.denoise === 0.05 && q.steps === 60 && q.cfg === 7 && q.sampler === 'Euler a' && q.blur === 4 && !q.model, 'настройки не как у F2 в Фотошопе: ' + JSON.stringify(q));
      check(r.name.startsWith('SD STUBPROMPT') && r.mask, 'слой не тот: ' + r.name);
      check(r.a > 0 && r.out === 0, 'результат лёг не на место выделения'); check(r.chip, 'плашка прогресса не убралась');
      await page.evaluate(() => { undo(); deselect(); genCfg.sdUrl = ''; });
  }},

  { name: 'Stable не запущен: «Запустить и прогнать» (заглушка моста)', run: async page => {
      await page.request.post(STUB + '/_sddown');
      await page.evaluate(stub => { genCfg.sdUrl = stub + '/k/test'; BR.base = null; BR.local = ''; BR.at = Date.now(); doc.active = 0; layersChanged(); applySelPoly([[300, 400], [700, 400], [700, 900], [300, 900]]); window.__n0 = doc.layers.length; sdQuick(); }, STUB);
      await until(page, () => !!document.querySelector('#toast .tact'), null, 10000, 'кнопка «Запустить и прогнать»');
      check(await page.evaluate(() => document.querySelector('#toast .tact').textContent.includes('Запустить')), 'на кнопке не «Запустить»');
      await page.evaluate(() => document.querySelector('#toast .tact').click());
      await until(page, () => doc.layers.length > window.__n0 && !sdq, null, 30000, 'ретушь после запуска Stable');
      check(await page.evaluate(() => AL().name.startsWith('SD ')), 'после запуска слой SD не лёг');
      await page.evaluate(() => { undo(); deselect(); genCfg.sdUrl = ''; });
  }},

  { name: 'Островок: SD-ретушь третьей кнопкой, выбор значков, добавить / убрать', run: async page => {
      const r = await page.evaluate(() => { const out = {};
        out.third = island.slots[2] === 'sdq' && !!document.querySelector('#island .ib[data-k="sdq"] svg');
        islandMenu(0, 300, 300); out.tiles = document.querySelectorAll('#lyCtx .igrid .it').length; out.icons = document.querySelectorAll('#lyCtx .igrid .it svg').length;
        const add = [...document.querySelectorAll('#lyCtx > button')].find(b => b.textContent.includes('Добавить')); add.click(); out.four = island.slots.length;
        islandMenu(1, 300, 300); [...document.querySelectorAll('#lyCtx > button')].find(b => b.textContent.includes('Убрать эту')).click(); out.back = island.slots.join(',');
        islandMenu(2, 300, 300); [...document.querySelectorAll('#lyCtx .igrid .it')].find(b => b.title === 'Пластика').click(); out.swap = island.slots[2];
        island.slots[2] = 'sdq'; islandSave(); islandBuild(); return out; });
      check(r.third, 'третья кнопка островка — не SD-ретушь'); check(r.tiles >= 20 && r.icons >= r.tiles - 1, 'плитки без значков: ' + r.icons + ' из ' + r.tiles);
      check(r.four === 4, 'кнопка не добавилась'); check(r.back === 'rect,lasso,sdq', 'кнопка не убралась: ' + r.back); check(r.swap === 'liquify', 'значок не заменился');
  }},

  { name: 'Удаление кистью — без затемнения экрана', run: async page => {
      const r = await page.evaluate(() => { const b = () => { const e = document.getElementById('busy'); return !!e && !e.hidden; };
        busyLite = true; busy(true, 'Нейросеть дорисовывает…'); const quiet = !b(); busy(true, 'Загружаю нейросеть удаления… 3 из 28 МБ · тап — отменить'); const dl = b(); busy(false); busyLite = false;
        const c = mk(200, 200), x = ctx2(c); x.fillStyle = '#ff3b30'; x.fillRect(0, 0, 200, 200);
        inpaintPend = { c, r: { x: 500, y: 700, w: 200, h: 200 }, doc, t0: performance.now(), t: 0 }; renderOverlay();
        const [sx, sy] = toScr(600, 800), d = ox.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 1, 1).data[3]; inpaintPendEnd(); renderOverlay();
        return { quiet, dl, mark: d > 0 }; });
      check(r.quiet, 'при удалении кистью экран затемнился'); check(r.dl, 'скачивание модели должно быть видно'); check(r.mark, 'мазок не мерцает на месте, пока считается');
  }},

  { name: 'Темы переключаются', run: async page => {
      const r = await page.evaluate(() => { const out = []; for (const t of ['night', 'cloud', 'sun', 'graphite']) { themeSet(t); out.push(document.documentElement.getAttribute('data-theme') === t); } return out; });
      check(r.every(Boolean), 'не все темы встали');
      await page.evaluate(t => themeSet(t), PROFILES[Object.keys(PROFILES)[0]].theme);
  }},

  { name: 'Меню верхней панели (ПК)', desk: true, run: async page => {
      for (const [btn, menu] of [['bMenu', 'menu'], ['bAI', 'aimenu'], ['bImg', 'imgmenu']]) {
        await page.click('#' + btn); await page.waitForTimeout(150);
        check(await page.evaluate(m => !document.getElementById(m).hidden, menu), `кнопка ${btn} не открыла меню`);
        await page.click('#' + btn); await page.waitForTimeout(100);
        check(await page.evaluate(m => document.getElementById(m).hidden, menu), `повторный клик по ${btn} не закрыл меню`);
      }
  }},

  { name: 'Второй экран (очки): окно, картина, рамка, рефы, Ч/Б', desk: true, run: async page => {
      check(await page.evaluate(() => !!document.querySelector('#imgmenu [data-i="screen2"]')), 'в меню «Изображение» нет пункта «Второй экран»');
      const [pop] = await Promise.all([page.context().waitForEvent('page', { timeout: 15000 }), page.evaluate(() => { closePops(); s2Open(); })]);
      await until(page, () => s2Alive() && s2.key, null, 5000, 'окно второго экрана');
      // картина: центр окна не цвета фона
      const px = () => page.evaluate(() => { const c = s2.cv, d = s2.x.getImageData(c.width / 2 | 0, c.height / 2 | 0, 1, 1).data; return [...d]; });
      const bg = await page.evaluate(() => { const n = parseInt(BG.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; });
      const p0 = await px(); check(p0.slice(0, 3).some((v, i) => Math.abs(v - bg[i]) > 8), 'во втором окне не видно картины');
      // правка в главном окне доходит до второго экрана
      const k0 = await page.evaluate(() => s2.key);
      await page.evaluate(() => { setTool('brush'); setColor('#2050ff'); doc.active = doc.layers.length - 1; layersChanged(); });
      await penDrag(page, [[300, 300], [900, 1300]]);
      await until(page, k => s2.key !== k, k0, 4000, 'обновление второго экрана после мазка');
      await page.evaluate(() => undo());
      // переключатели
      await page.evaluate(() => { s2Act('gray'); s2Act('flip'); });
      check(await page.evaluate(() => s2.cv.style.filter.includes('grayscale') && s2.cv.style.transform.includes('-1')), 'Ч/Б или отражение не включились');
      await page.evaluate(() => { s2Act('gray'); s2Act('flip'); s2Act('refs'); });
      check(await page.evaluate(() => s2Pref.mode === 'refs'), 'не переключилось на рефы');
      await page.evaluate(() => s2Act('pic'));
      // клавиша во втором окне уходит в редактор (B — кисть)
      await page.evaluate(() => setTool('rect'));
      await pop.keyboard.press('KeyB'); await page.waitForTimeout(150);
      check(await page.evaluate(() => S.tool === 'brush'), 'клавиша во втором окне не дошла до редактора');
      await page.evaluate(() => s2Act('close'));
      check(await page.evaluate(() => !s2Alive()), 'второй экран не закрылся');
  }},

  { name: 'Курсоры как в Фотошопе (ПК)', desk: true, run: async page => {
      const r = await page.evaluate(() => { const c = () => stage.style.cursor, out = {};
        setTool('clone'); altDown = true; updateCursor(); out.target = c().includes('svg'); altDown = false; updateCursor(); out.none = c() === 'none';
        setTool('picker'); updateCursor(); out.pick = c().includes('svg');
        rHeld = true; updateCursor(); out.rot = c().includes('svg'); rHeld = false;
        setTool('transform'); updateCursor(); out.move = c().includes('svg');
        setTool('brush'); updateCursor(); return out; });
      for (const [k, v] of Object.entries(r)) check(v, 'курсор не тот: ' + k);
  }},

  { name: 'Курсор пера в воздухе (iPad)', desk: false, run: async page => {
      await page.evaluate(() => { setTool('rect'); if (!hoverCross) hoverCrossToggle(); hover = [300, 300]; renderOverlay(); });
      const a = await page.evaluate(() => { const d = ox.getImageData(Math.round((300 + 8) * dpr), Math.round(300 * dpr), 1, 1).data; return d[3]; });
      await page.evaluate(() => { hoverCrossToggle(); hover = null; renderOverlay(); });
      check(a > 0, 'крестик над холстом не нарисовался');
  }},

  { name: 'Цветовой профиль: sRGB в сохранении, перевод из Adobe RGB', run: async page => {
      const r = await page.evaluate(async () => {
        const s = u => String.fromCharCode(...u), out = {};
        out.self = iccParse(srgbIcc()).srgb;
        const pr = iccParse(agPsd.readPsd(psdBuffer(), { skipLayerImageData: true, skipThumbnail: true }).imageResources.iccProfile);
        out.psd = !!(pr && pr.srgb);
        const c = flatten(0.1);
        out.png = s(new Uint8Array(await (await blobSrgb(await toBlob(c, 'image/png'))).arrayBuffer()).subarray(37, 41)) === 'iCCP';
        out.jpg = s(new Uint8Array(await (await blobSrgb(await toBlob(c, 'image/jpeg', 0.9))).arrayBuffer()).subarray(0, 40)).includes('ICC_PROFILE');
        // a copy of our sRGB profile with Adobe RGB primaries and gamma 2.2 → must be recognised as foreign and converted
        const u = srgbIcc().slice(), v = new DataView(u.buffer), n = v.getUint32(128), tag = {};
        for (let k = 0; k < n; k++) { const o = 132 + k * 12; tag[s(u.subarray(o, o + 4))] = v.getUint32(o + 4); }
        const put = (t, a) => a.forEach((x, i) => v.setInt32(tag[t] + 8 + i * 4, Math.round(x * 65536)));
        put('rXYZ', [0.6097559, 0.3111145, 0.0194702]); put('gXYZ', [0.2052401, 0.6256714, 0.0608902]); put('bXYZ', [0.1492240, 0.0632141, 0.7445396]);
        const ap = iccParse(u); out.foreign = !ap.srgb && !!ap.conv;
        const t = document.createElement('canvas'); t.width = t.height = 2; const x = t.getContext('2d'); x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, 2, 2);
        iccConvertCanvas(t, ap.conv); const d = x.getImageData(0, 0, 1, 1).data; out.grey = Math.abs(d[0] - 128) <= 3 && d[0] === d[1] && d[1] === d[2];
        return out; });
      for (const [k, v] of Object.entries(r)) check(v, 'профиль: не так — ' + k);
  }},

  { name: 'Автосохранение → перезагрузка → документ на месте', run: async page => {
      await page.evaluate(async () => { const t = TABS.list.find(t => t.doc && t.doc.name === 'Тест'); if (t && t.doc !== doc) await tabSwitch(t); });
      const n = await page.evaluate(async () => { await autosave(true); await flushSave(); return doc.layers.length; });
      await page.waitForTimeout(6500);           // защита от падения держится 6 с после старта
      await page.reload({ waitUntil: 'load' });
      await until(page, () => typeof homeOn !== 'undefined' && !document.getElementById('splash'), null, 30000, 'перезапуск страницы');
      await until(page, () => doc && doc.name === 'Тест', null, 15000, 'документ «Тест» после перезагрузки');
      const n1 = await page.evaluate(() => doc.layers.length);
      check(n1 === n, `слоёв было ${n}, после перезагрузки ${n1}`);
  }},
];

(async () => {
  const args = process.argv.slice(2);
  let only = null; const oi = args.indexOf('--only'); if (oi >= 0) { only = (args[oi + 1] || '').toLowerCase(); args.splice(oi, 2); }
  const names = args.length ? args.filter(a => PROFILES[a]) : Object.keys(PROFILES);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const all = [];
  for (const n of names) all.push(await runSteps(browser, n, steps, only));
  await browser.close();
  process.exit(report(all) ? 1 : 0);
})();
