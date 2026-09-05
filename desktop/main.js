/**
 * DropLocker Desktop App (Windows Native)
 * Features:
 * - System Tray integration (sits near clock)
 * - Global Hotkey (Ctrl+Shift+V) to instant-upload from clipboard
 * - Native Windows Toast Notifications
 * - Seamless sync with Cloudflare Backend
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, Notification, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Determine backend URL (local or deployed Cloudflare URL)
const CONFIG_FILE = path.join(app.getPath('userData'), 'droplocker-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { backendUrl: 'http://localhost:8787' };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {}
}

const config = loadConfig();

function getAssetPath(...relativePaths) {
  const packagedPath = path.join(__dirname, ...relativePaths);
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }
  return path.join(__dirname, '..', ...relativePaths);
}

function createWindow() {
  const iconPath = getAssetPath('public', 'icon-512.png');
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 750,
    minWidth: 420,
    minHeight: 500,
    title: 'DropLocker',
    backgroundColor: '#0a0a0f',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  // Load public/index.html
  const indexPath = getAssetPath('public', 'index.html');
  mainWindow.loadFile(indexPath).catch(err => {
    console.error('Failed to load index.html:', err);
  });

  // When closing, minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      showNotification('DropLocker Minimized', 'DropLocker is running in your system tray. Press Ctrl+Shift+V anywhere to quick-upload.');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const iconPath = getAssetPath('public', 'icon-192.png');
  tray = new Tray(iconPath);
  tray.setToolTip('DropLocker — Cross-Device Hub');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open DropLocker',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Upload from Clipboard (Ctrl+Shift+V)',
      click: () => handleClipboardUpload(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: getAssetPath('public', 'icon-192.png'),
    }).show();
  }
}

// Global Clipboard Handler
function handleClipboardUpload() {
  // 1. Check if clipboard contains an image
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const pngBuffer = image.toPNG();
    const base64 = pngBuffer.toString('base64');
    mainWindow.webContents.send('native-clipboard-upload', {
      type: 'image',
      data: base64,
      filename: `Pasted-Image-${Date.now()}.png`,
      mimeType: 'image/png',
    });
    showNotification('DropLocker', 'Uploading image from clipboard...');
    return;
  }

  // 2. Check if clipboard contains text
  const text = clipboard.readText();
  if (text && text.trim().length > 0) {
    mainWindow.webContents.send('native-clipboard-upload', {
      type: 'text',
      text: text.trim(),
      filename: `Snippet-${Date.now()}.txt`,
      mimeType: 'text/plain;charset=utf-8',
    });
    showNotification('DropLocker', 'Uploading text snippet from clipboard...');
    return;
  }

  showNotification('DropLocker', 'Clipboard is empty or unsupported format.');
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Register Global Hotkey: Ctrl+Shift+V
  try {
    const registered = globalShortcut.register('CommandOrControl+Shift+V', () => {
      handleClipboardUpload();
    });
    if (registered) {
      console.log('Global shortcut Ctrl+Shift+V registered successfully.');
    }
  } catch (err) {
    console.warn('Could not register global shortcut:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC handlers for desktop bridge
ipcMain.on('show-notification', (event, { title, body }) => {
  showNotification(title, body);
});
