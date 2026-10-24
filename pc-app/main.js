// «Проявка» для ПК: своё окно, свой мост к Automatic1111 и нейросетям, сохранение файлов прямо на диск
const { app, BrowserWindow, nativeTheme, shell, session, dialog, Menu, screen } = require('electron');
const path = require('path'), fs = require('fs'), net = require('net'), { spawn } = require('child_process');

const URL_APP = process.env.PROYAVKA_URL || 'https://itanaro.github.io/proyavka/?pc=1';
const BRIDGE_PORT = 7861;
const exeDir = path.dirname(app.getPath('exe'));
// the app lives next to the bridge: D:\stable-diffusion-portable-main\proyavka-app  ↔  ...\proyavka-bridge
const BRIDGE_DIR = [path.join(exeDir, '..', 'proyavka-bridge'), 'D:\\stable-diffusion-portable-main\\proyavka-bridge'].find(d => fs.existsSync(path.join(d, 'bridge.py')));

// a small log next to the program: what happened at start (to find out why a window did not appear)
const LOG = path.join(exeDir, 'proyavka.log');
function log(...a) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (e) {} }
process.on('uncaughtException', e => log('ошибка:', e && e.stack || e));
log('старт', app.getVersion(), process.versions.electron);
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192'); // big documents: far above Safari's ceiling
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
if (!app.requestSingleInstanceLock()) { log('уже запущена — показываю её окно'); app.quit(); }

function portOpen(port) {
  return new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 800); });
}
async function ensureBridge() {
  if (!BRIDGE_DIR || await portOpen(BRIDGE_PORT)) return;
  const sd = path.join(BRIDGE_DIR, '..', 'stable-diffusion-portable-main');
  const py = [path.join(sd, 'venv', 'Scripts', 'python.exe'), path.join(sd, 'python', 'python.exe')].find(p => fs.existsSync(p));
  if (!py) return;
  const log = fs.openSync(path.join(BRIDGE_DIR, 'bridge.log'), 'a');
  const child = spawn(py, [path.join(BRIDGE_DIR, 'bridge.py')], { cwd: BRIDGE_DIR, windowsHide: true, detached: true, stdio: ['ignore', log, log], env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  child.unref(); // the bridge keeps serving the iPad after this window is closed
  for (let i = 0; i < 40 && !(await portOpen(BRIDGE_PORT)); i++) await new Promise(r => setTimeout(r, 250));
}

// the bridge uses its own home certificate: trust it only for this one local address
app.on('certificate-error', (event, wc, url, error, cert, cb) => {
  if (url.startsWith('https://127.0.0.1:' + BRIDGE_PORT + '/') && /Proyavka Home CA/.test(cert.issuerName || '')) { event.preventDefault(); cb(true); }
  else cb(false);
});

let win = null, screen2 = null;
// №110 «Второй экран»: окно с картиной встаёт на другой монитор (очки XREAL — экран 1920×1080) во весь экран;
// второго монитора нет — обычное окно рядом. Подключили или сняли очки при открытом окне — переезжает само.
function otherDisplay() {
  if (!win || win.isDestroyed()) return null;
  const main = screen.getDisplayMatching(win.getBounds()), others = screen.getAllDisplays().filter(d => d.id !== main.id);
  return others.find(d => d.size.width === 1920 && d.size.height === 1080) || others[0] || null;
}
function placeScreen2(w) {
  if (!w || w.isDestroyed()) return;
  const d = otherDisplay();
  if (d) { if (w.isFullScreen()) w.setFullScreen(false); w.setBounds(d.bounds); w.setFullScreen(true); log('второй экран: монитор', d.size.width + 'x' + d.size.height); return; }
  if (w.isFullScreen()) w.setFullScreen(false);
  const a = screen.getDisplayMatching(win.getBounds()).workArea;
  w.setBounds({ x: a.x + 80, y: a.y + 80, width: Math.min(1280, a.width - 160), height: Math.min(760, a.height - 160) });
  log('второй экран: второго монитора нет — окно рядом');
}
function createWindow() {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600, height: 1000, show: true, backgroundColor: '#121317', title: 'Проявка',
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { spellcheck: false, backgroundThrottling: false }
  });
  win.maximize();
  // the page tells by this mark that the shell can place the second screen
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' ProyavkaShell/2');
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'proyavka-screen2' && (!url || url === 'about:blank'))
      return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: '#121317', title: 'Проявка — второй экран', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, webPreferences: { spellcheck: false, backgroundThrottling: false } } };
    shell.openExternal(url); return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (w, { frameName }) => {
    if (frameName !== 'proyavka-screen2') return;
    screen2 = w; w.setMenu(null); w.on('page-title-updated', e => e.preventDefault()); w.on('closed', () => { if (screen2 === w) screen2 = null; });
    w.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') { w.setFullScreen(!w.isFullScreen()); e.preventDefault(); } });
    placeScreen2(w);
  });
  win.on('closed', () => { if (screen2 && !screen2.isDestroyed()) screen2.close(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('page-title-updated', e => e.preventDefault());
  // the window shows at once with a «loading» note, then the app replaces it
  const splash = '<body style="background:#121317;color:#cfcfd6;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:22px;margin-bottom:10px;color:#f0b46a">Проявка</div><div id=t>загружаю…</div></div><script>setTimeout(()=>{document.getElementById("t").textContent="загружаю… медленный интернет или VPN — подожди ещё немного"},8000)</script></body>';
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splash)).then(() => { log('окно показано, гружу', URL_APP); win.loadURL(URL_APP); });
  win.webContents.on('did-finish-load', () => log('загружено:', win.webContents.getURL().slice(0, 60)));
  if (process.env.PROYAVKA_SELFTEST) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    const r = await win.webContents.executeJavaScript('({v:typeof APP_VERSION!=="undefined"&&APP_VERSION, desk:typeof IS_DESK!=="undefined"&&IS_DESK, sd:typeof genCfg!=="undefined"&&genCfg.sdUrl, mem:performance.memory&&performance.memory.jsHeapSizeLimit})');
    console.log('SELFTEST', JSON.stringify(r)); app.quit(); }, 5000));
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; log('не загрузилось:', code, desc, url);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#121317;color:#ddd;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center">Нет связи с сайтом «Проявки» и нет сохранённой копии.<br><br><button onclick="location.href=\'' + URL_APP + '\'" style="font:inherit;padding:8px 18px;border-radius:10px">Попробовать ещё</button></div></body>'));
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  log('готово к работе');
  // a proper Windows shortcut on the desktop (made by Windows itself), and one taskbar identity for pinning
  if (process.platform === 'win32') {
    app.setAppUserModelId('Proyavka.App');
    try {
      const lnk = path.join(app.getPath('desktop'), 'Проявка.lnk'), ico = path.join(exeDir, 'icon.ico');
      const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', { target: app.getPath('exe'), cwd: exeDir, icon: fs.existsSync(ico) ? ico : app.getPath('exe'), iconIndex: 0, description: 'Проявка', appUserModelId: 'Proyavka.App' });
      log('ярлык на рабочем столе:', ok ? 'обновлён' : 'не получилось');
    } catch (e) { log('ярлык:', e.message); }
  }
  // downloads that are not saved through the save dialog of the page: ask where, like any program
  session.defaultSession.on('will-download', (e, item) => {
    const p = dialog.showSaveDialogSync(win, { defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    if (p) item.setSavePath(p); else item.cancel();
  });
  ensureBridge().catch(() => {});
  createWindow();
  const replace2 = () => { if (screen2 && !screen2.isDestroyed()) setTimeout(() => placeScreen2(screen2), 900); };
  screen.on('display-added', replace2); screen.on('display-removed', replace2);
});
app.on('window-all-closed', () => app.quit());
