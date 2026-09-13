/**
 * preload.js — the bridge between the dashboard and the Electron shell.
 *
 * Exposes a tiny, explicit API on window.vendorShell. Your dashboard code
 * checks for its existence and degrades gracefully in a plain browser.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vendorShell', {
  isDesktopApp: true,

  // Tell the shell to flash the taskbar and raise the window
  notifyNewOrder: (order) => ipcRenderer.send('order:new', order),
  notifyAcknowledged: () => ipcRenderer.send('order:acknowledged'),

  // Sleep prevention, tied to the vendor's shift
  startShift: () => ipcRenderer.send('shift:start'),
  endShift:   () => ipcRenderer.send('shift:end'),

  getVersion:    () => ipcRenderer.invoke('app:version'),
  setAutoLaunch: (on) => ipcRenderer.invoke('app:autolaunch', on),
  installUpdate: () => ipcRenderer.send('update:install'),

  // Shell -> dashboard events
  on: (channel, handler) => {
    const allowed = [
      'power-suspend', 'power-resume',
      'screen-locked', 'screen-unlocked',
      'run-sound-test', 'update-ready',
    ];
    if (!allowed.includes(channel)) return () => {};
    const wrapped = (_e, ...args) => handler(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
