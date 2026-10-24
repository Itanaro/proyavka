// Каркас автотестов: экраны (ПК / iPad), запуск страницы, шаги с проверками, сбор ошибок, отчёт.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const URL = process.env.PROYAVKA_URL || 'http://127.0.0.1:8766/';
const STUB = process.env.PROYAVKA_STUB || 'http://127.0.0.1:8199';
const OUT = process.env.PROYAVKA_TEST_OUT || '/tmp/proyavka-tests';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// экраны: ПК — обычный Chromium (IS_DESK), iPad — UA айпада + касания
const PROFILES = {
  pc1920: { w: 1920, h: 1080, desk: true,  theme: 'night',    title: 'ПК 1920 · Ночь' },
  pc1366: { w: 1366, h: 768,  desk: true,  theme: 'cloud',    title: 'ПК 1366 · Облачко' },
  ipadL:  { w: 1376, h: 1032, desk: false, theme: 'sun',      title: 'iPad альбом · Луч' },
  ipadP:  { w: 1032, h: 1376, desk: false, theme: 'graphite', title: 'iPad портрет · Графит' },
};

// шумы, которые ошибкой не считаем: моста на тестовой машине нет
const BENIGN = [/127\.0\.0\.1:7861/, /ERR_CONNECTION_REFUSED/, /Failed to load resource/, /net::ERR_/, /willReadFrequently/];

async function openProfile(browser, name) {
  const p = PROFILES[name];
  const ctx = await browser.newContext({
    viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1,
    ...(p.desk ? {} : { userAgent: IPAD_UA, hasTouch: true, isMobile: false }),
  });
  await ctx.addInitScript(([theme, stub]) => {
    if (sessionStorage.getItem('pvtest.init')) return;   // только при первом открытии, перезагрузка не сбрасывает
    sessionStorage.setItem('pvtest.init', '1');
    localStorage.setItem('kadr.help', '1');
    localStorage.setItem('proyavka.theme', theme);
    localStorage.setItem('proyavka.gen', JSON.stringify({ provider: 'or', orKey: 'or-good', orBase: stub, nb21: 1 }));
  }, [p.theme, STUB]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('ошибка страницы: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!BENIGN.some(rx => rx.test(t))) errors.push('console: ' + t.slice(0, 300)); } });
  return { page, ctx, errors, profile: p, name };
}

async function waitReady(page) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof homeOn !== 'undefined' && typeof S !== 'undefined' && !document.getElementById('splash'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// перо: синтетические события pointerType 'pen' — одинаково на ПК и iPad (на iPad палец по умолчанию двигает холст)
async function penDrag(page, pts, opt = {}) {
  await page.evaluate(([pts, opt]) => {
    const r = stage.getBoundingClientRect();
    const toClient = ([x, y]) => { const [sx, sy] = toScr(x, y); return [r.left + sx, r.top + sy]; };
    const fire = (type, [x, y], buttons) => oc.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 77, pointerType: 'pen', isPrimary: true,
      clientX: x, clientY: y, pressure: buttons ? (opt.pressure || 0.7) : 0, buttons, button: type === 'pointermove' ? -1 : 0,
      shiftKey: !!opt.shift, altKey: !!opt.alt }));
    const P = pts.map(toClient);
    fire('pointerdown', P[0], 1);
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i];
      for (let k = 1; k <= 6; k++) fire('pointermove', [ax + (bx - ax) * k / 6, ay + (by - ay) * k / 6], 1);
    }
    fire('pointerup', P[P.length - 1], 0);
  }, [pts, opt]);
  await page.waitForTimeout(opt.wait ?? 250);
}

// мышь по-настоящему (Playwright): только для ПК
async function mouseDrag(page, a, b) {
  const [ax, ay, bx, by] = await page.evaluate(([a, b]) => { const r = stage.getBoundingClientRect(); const A = toScr(...a), B = toScr(...b); return [r.left + A[0], r.top + A[1], r.left + B[0], r.top + B[1]]; }, [a, b]);
  await page.mouse.move(ax, ay); await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(ax + (bx - ax) * k / 10, ay + (by - ay) * k / 10);
  await page.mouse.up(); await page.waitForTimeout(200);
}

async function until(page, fn, arg, ms = 15000, what = 'условие') {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); }
  catch (e) { throw new Error(`не дождалась: ${what} (${ms / 1000} с)`); }
}

function check(cond, msg) { if (!cond) throw new Error(msg); }

// прогон шагов на одном экране
async function runSteps(browser, name, steps, only) {
  const T = await openProfile(browser, name);
  const res = { profile: name, title: T.profile.title, steps: [] };
  try { await waitReady(T.page); }
  catch (e) { res.steps.push({ name: 'Запуск страницы', ok: false, err: e.message }); await T.ctx.close(); return res; }
  for (const s of steps) {
    if (s.desk === true && !T.profile.desk) continue;
    if (s.desk === false && T.profile.desk) continue;
    if (only && !s.name.toLowerCase().includes(only) && !s.always) continue;
    const t0 = Date.now(), e0 = T.errors.length;
    let ok = true, err = '';
    try { await s.run(T.page, T); }
    catch (e) { ok = false; err = e.message.split('\n')[0]; }
    const newErr = T.errors.slice(e0);
    if (ok && newErr.length) { ok = false; err = newErr[0]; }
    res.steps.push({ name: s.name, ok, err, ms: Date.now() - t0, errors: newErr });
    if (!ok) { try { await T.page.screenshot({ path: path.join(OUT, `${name}-FAIL-${res.steps.length}.png`) }); } catch (_) {} }
  }
  try { await T.page.screenshot({ path: path.join(OUT, `${name}-final.png`) }); } catch (_) {}
  await T.ctx.close();
  return res;
}

function report(all) {
  let bad = 0, total = 0;
  for (const r of all) {
    console.log(`\n■ ${r.title}`);
    for (const s of r.steps) {
      total++; if (!s.ok) bad++;
      console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.ms != null ? `  (${(s.ms / 1000).toFixed(1)} с)` : ''}${s.ok ? '' : '\n      → ' + s.err}`);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(all, null, 1));
  console.log(`\n${bad ? '✗' : '✓'} Итог: ${total - bad} из ${total} шагов зелёные${bad ? `, упало ${bad}` : ''}.`);
  return bad;
}

module.exports = { chromium, PROFILES, OUT, STUB, runSteps, report, penDrag, mouseDrag, until, check, waitReady };
