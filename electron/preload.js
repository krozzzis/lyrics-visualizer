const { contextBridge, ipcRenderer } = require('electron');

// Narrow, one-directional bridge: main → renderer menu commands only. The
// renderer never gets ipcRenderer/require access (contextIsolation +
// nodeIntegration: false), so this is the entire surface Electron adds on
// top of what the plain-browser build already does against /api/*.
contextBridge.exposeInMainWorld('electronAPI', {
  onRenderVideo: (cb) => ipcRenderer.on('menu:render-video', () => cb()),
});
