/**
 * DropLocker Desktop Preload Bridge
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isElectron: true,
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  onNativeClipboardUpload: (callback) => {
    ipcRenderer.on('native-clipboard-upload', (event, data) => callback(data));
  },
});
