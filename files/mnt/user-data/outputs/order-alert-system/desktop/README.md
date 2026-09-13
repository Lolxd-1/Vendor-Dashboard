# Desktop wrapper

Wraps the existing dashboard URL in an Electron shell. No dashboard rewrite required.

## Setup

    npm init -y
    npm i -D electron electron-builder
    npm i electron-updater electron-log

Set `"main": "main.js"` in package.json, then:

    DASHBOARD_URL=https://dashboard.yourcompany.com npx electron .

## Wiring the dashboard to the shell

Your existing dashboard code just checks whether the shell is present:

```js
const shell = window.vendorShell;   // undefined in a plain browser

function handleOrder(order) {
  renderOrderCard(order);
  Alert.ring({ escalate: true });
  shell?.notifyNewOrder(order);     // flashes taskbar, raises window
}

acceptBtn.onclick = () => {
  Alert.stop();
  shell?.notifyAcknowledged();
  api.acknowledgeOrder(order.id);
};

// Reconnect AND backfill when the machine wakes. A reconnect alone
// will not replay orders that arrived while the PC was asleep.
shell?.on('power-resume', async () => {
  await reconnectSocket();
  await backfillUnacknowledgedOrders();
});

// Never restart mid-shift
shell?.on('update-ready', () => {
  if (activeOrders.length === 0) shell.installUpdate();
  else pendingUpdate = true;
});
```

## Packaging

`electron-builder` config in package.json:

```json
{
  "build": {
    "appId": "com.yourcompany.vendororders",
    "productName": "Vendor Orders",
    "win": { "target": "nsis", "icon": "assets/icon.ico" },
    "nsis": { "oneClick": false, "perMachine": true, "allowToChangeInstallationDirectory": false },
    "publish": [{ "provider": "generic", "url": "https://releases.yourcompany.com/vendor-orders/" }]
  }
}
```

**Code-sign the installer.** An unsigned build triggers a SmartScreen warning
that tells small business owners your software is dangerous. Most will not
click through it. An OV certificate is a few hundred dollars a year and is
not optional for software you ask vendors to install.

## Assets needed

    assets/icon.png    512x512  app icon
    assets/icon.ico    multi-res Windows icon
    assets/tray.png    32x32    tray icon (will be resized to 16x16)
    assets/badge.png   16x16    taskbar overlay badge for the new-order state
