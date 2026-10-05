// «Проявка» для ПК: своё окно, свой мост к Automatic1111 и нейросетям, сохранение файлов прямо на диск
const { app, BrowserWindow, nativeTheme, shell, session, dialog, Menu } = require('electron');
const path = require('path'), fs = require('fs'), net = require('net'), { spawn } = require('child_process');

const URL_APP = process.env.PROYAVKA_URL || 'https://itanaro.github.io/proyavka/?pc=1';
const BRIDGE_PORT = 7861;
const exeDir = path.dirname(app.getPath('exe'));
// the app lives next to the bridge: D:\stable-diffusion-portable-main\proyavka-app  ↔  ...\proyavka-bridge
const BRIDGE_DIR = [path.join(exeDir, '..', 'proyavka-bridge'), 'D:\\stable-diffusion-portable-main\\proyavka-bridge'].find(d => fs.existsSync(path.join(d, 'bridge.py')));

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192'); // big documents: far above Safari's ceiling
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
if (!app.requestSingleInstanceLock()) { app.quit(); }

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

let win = null;
function createWindow() {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600, height: 1000, show: false, backgroundColor: '#121317', title: 'Проявка',
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { spellcheck: false, backgroundThrottling: false }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('page-title-updated', e => e.preventDefault());
  win.loadURL(URL_APP);
  if (process.env.PROYAVKA_SELFTEST) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    const r = await win.webContents.executeJavaScript('({v:typeof APP_VERSION!=="undefined"&&APP_VERSION, desk:typeof IS_DESK!=="undefined"&&IS_DESK, sd:typeof genCfg!=="undefined"&&genCfg.sdUrl, mem:performance.memory&&performance.memory.jsHeapSizeLimit})');
    console.log('SELFTEST', JSON.stringify(r)); app.quit(); }, 5000));
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#121317;color:#ddd;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center">Нет связи с сайтом «Проявки» и нет сохранённой копии.<br><br><button onclick="location.href=\'' + URL_APP + '\'" style="font:inherit;padding:8px 18px;border-radius:10px">Попробовать ещё</button></div></body>'));
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  // downloads that are not saved through the save dialog of the page: ask where, like any program
  session.defaultSession.on('will-download', (e, item) => {
    const p = dialog.showSaveDialogSync(win, { defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    if (p) item.setSavePath(p); else item.cancel();
  });
  ensureBridge().catch(() => {});
  createWindow();
});
app.on('window-all-closed', () => app.quit());
