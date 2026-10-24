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
        for (const g of Object.values(TOOL_GROUPS)) for (const [t] of g.items) { if (t.startsWith('@') || HEAVY.includes(t)) continue; setTool(t); if (S.tool !== t) out.push(t); }
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
      const n0 = await page.evaluate(() => doc.layers.length);
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
