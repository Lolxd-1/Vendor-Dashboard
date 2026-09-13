/**
 * main.js — Electron wrapper for the vendor order dashboard.
 *
 * This does NOT rewrite your dashboard. It loads your existing URL in a
 * window where the autoplay policy does not apply, the app launches itself
 * at login, closing hides to tray instead of quitting, and the window pushes
 * itself in front of whatever the vendor is doing when an order arrives.
 *
 * Install:
 *   npm i -D electron electron-builder
 *   npm i electron-updater electron-log
 *
 * Run:      npx electron .
 * Package:  npx electron-builder --win nsis
 */

const {
  app, BrowserWindow, Tray, Menu, ipcMain, shell,
  powerSaveBlocker, powerMonitor, nativeImage, dialog,
} = require('electron');
const path = require('path');

/* ── Configuration ──────────────────────────────────────────────────────── */

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://dashboard.yourcompany.com';
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;

let win = null;
let tray = null;
let sleepBlockerId = null;
let isQuitting = false;

/* ── Single instance ────────────────────────────────────────────────────── */
/* Two copies running means two rings, two sockets, and a confused vendor.  */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // The vendor double-clicked the icon while it was already running.
    // Interpret that as "show me the dashboard".
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

/* ── Window ─────────────────────────────────────────────────────────────── */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,                        // show on ready-to-show to avoid a white flash
    backgroundColor: '#111111',
    title: 'Vendor Orders',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      // ── The two settings that matter for this app ──

      // Explicit, though this is already Electron's default. Audio plays
      // with no user gesture, ever. The entire autoplay problem is gone.
      autoplayPolicy: 'no-user-gesture-required',

      // Without this, a minimised or fully-covered window gets the same
      // timer throttling as a background browser tab: 1 tick per minute.
      backgroundThrottling: false,

      // ── Standard security posture ──
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.loadURL(DASHBOARD_URL);

  win.once('ready-to-show', () => {
    // If launched by Windows at login, start minimised to tray so we don't
    // steal focus from whatever the vendor is doing at 6am.
    const autostarted = process.argv.includes('--autostart');
    if (autostarted) {
      win.hide();
    } else {
      win.show();
    }
  });

  // Closing the window must NOT kill the alerts. Hide to tray instead.
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    win.hide();
    notifyStillRunningOnce();
  });

  // Keep the vendor inside the dashboard. External links open in their
  // real browser rather than replacing the dashboard with a random page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== DASHBOARD_ORIGIN) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // If the renderer crashes or the network dies, recover rather than
  // sitting on a blank screen for the rest of the shift.
  win.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone:', details.reason);
    if (details.reason !== 'clean-exit') win.reload();
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    log('load failed', code, desc);
    setTimeout(() => win.loadURL(DASHBOARD_URL), 5000);
  });
}

/* ── Tray ───────────────────────────────────────────────────────────────── */

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Vendor Orders — running');

  const menu = Menu.buildFromTemplate([
    { label: 'Open dashboard', click: () => { win.show(); win.focus(); } },
    { label: 'Test sound', click: () => win.webContents.send('run-sound-test') },
    { type: 'separator' },
    {
      label: 'Start automatically when Windows starts',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => setAutoLaunch(item.checked),
    },
    { type: 'separator' },
    { label: 'Reload', click: () => win.reload() },
    { label: 'Diagnostics', click: () => win.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Quit — alerts will stop', click: () => confirmQuit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { win.show(); win.focus(); });
}

function confirmQuit() {
  // Quitting means missing orders. Make it deliberate.
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Keep running', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    title: 'Quit Vendor Orders?',
    message: 'You will stop receiving order alerts.',
    detail: 'New orders will not ring on this computer until you open the app again.',
  });
  if (choice === 1) {
    isQuitting = true;
    app.quit();
  }
}

let toldThemOnce = false;
function notifyStillRunningOnce() {
  if (toldThemOnce) return;
  toldThemOnce = true;
  tray.displayBalloon?.({
    title: 'Still listening for orders',
    content: 'Vendor Orders is running in the system tray. Alerts will keep working.',
  });
}

/* ── Bring the window to the human ──────────────────────────────────────── */

function alertForOrder(order) {
  if (!win) return;

  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();

  // 'screen-saver' is the highest level — above full-screen apps and most
  // other always-on-top windows. Drop it after 10s so the vendor isn't
  // stuck with a window they can't get behind.
  win.setAlwaysOnTop(true, 'screen-saver');
  setTimeout(() => { try { win.setAlwaysOnTop(false); } catch (_) {} }, 10_000);

  // Taskbar icon flashes orange until the window gets focus. Unobtrusive
  // but very hard to miss out of the corner of your eye.
  win.flashFrame(true);

  // Windows taskbar overlay badge
  if (process.platform === 'win32') {
    const badge = nativeImage.createFromPath(path.join(__dirname, 'assets', 'badge.png'));
    win.setOverlayIcon(badge, `New order ${order?.number ?? ''}`);
  }

  log('alerted for order', order?.id);
}

function clearOrderAlert() {
  if (!win) return;
  win.flashFrame(false);
  if (process.platform === 'win32') win.setOverlayIcon(null, '');
}

/* ── Sleep prevention ───────────────────────────────────────────────────── */

function startShift() {
  if (sleepBlockerId !== null) return;
  // 'prevent-display-sleep' is the strong one: keeps the screen on and by
  // extension keeps the machine awake. 'prevent-app-suspension' is weaker
  // and lets the display sleep, which is fine if you only need the sound.
  sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  log('shift started, sleep blocked');
}

function endShift() {
  if (sleepBlockerId === null) return;
  powerSaveBlocker.stop(sleepBlockerId);
  sleepBlockerId = null;
  log('shift ended, sleep allowed');
}

/* ── Power events — the reconnect trigger people forget ─────────────────── */

function wirePowerMonitor() {
  powerMonitor.on('suspend', () => {
    log('machine suspending');
    win?.webContents.send('power-suspend');
  });

  powerMonitor.on('resume', () => {
    log('machine resumed');
    // The socket is dead and orders may have arrived while asleep. The
    // renderer must reconnect AND backfill unacknowledged orders — a
    // reconnect alone will not replay what it missed.
    win?.webContents.send('power-resume');
  });

  powerMonitor.on('lock-screen', () => win?.webContents.send('screen-locked'));
  powerMonitor.on('unlock-screen', () => win?.webContents.send('screen-unlocked'));
}

/* ── Auto launch ────────────────────────────────────────────────────────── */

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
    args: ['--autostart'],
  });
  log('auto-launch set to', enabled);
}

/* ── IPC from the dashboard ─────────────────────────────────────────────── */

function wireIpc() {
  ipcMain.on('order:new', (_e, order) => alertForOrder(order));
  ipcMain.on('order:acknowledged', () => clearOrderAlert());
  ipcMain.on('shift:start', () => startShift());
  ipcMain.on('shift:end', () => endShift());
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:autolaunch', (_e, enabled) => {
    if (typeof enabled === 'boolean') setAutoLaunch(enabled);
    return app.getLoginItemSettings().openAtLogin;
  });
}

/* ── Auto update ────────────────────────────────────────────────────────── */
/* Without this you will have vendors stuck on an 18-month-old build and    */
/* no way to reach them. Set it up on day one.                              */

function wireAutoUpdate() {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    log('electron-updater not installed, skipping');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    // Never restart mid-shift. Tell the renderer; let it choose a quiet
    // moment (no active orders) and then call quitAndInstall.
    win?.webContents.send('update-ready');
  });

  ipcMain.on('update:install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify().catch(err => log('update check failed', err.message));
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

/* ── Logging ────────────────────────────────────────────────────────────── */

function log(...args) {
  try {
    require('electron-log').info(...args);
  } catch (_) {
    console.log('[main]', ...args);
  }
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  createWindow();
  createTray();
  wireIpc();
  wirePowerMonitor();
  wireAutoUpdate();

  // Default to launching at login unless the vendor has turned it off.
  if (!app.getLoginItemSettings().wasOpenedAtLogin && app.getLoginItemSettings().openAtLogin === false) {
    setAutoLaunch(true);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Do NOT quit when all windows are closed — that is the whole point of the tray.
app.on('window-all-closed', (e) => { e.preventDefault?.(); });

app.on('before-quit', () => { isQuitting = true; endShift(); });
