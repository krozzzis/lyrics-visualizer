const {
  app, BrowserWindow, Menu, dialog, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const { createServer } = require('../src/server');

const REPO_ROOT = path.join(__dirname, '..');
const STATE_PATH = path.join(app.getPath('userData'), 'state.json');

let win = null;
let httpServer = null;
let currentConfigPath = null;
// http.Server#close() only stops accepting new connections — it waits for
// every existing (e.g. keep-alive) connection to end before its callback
// fires. The window's page still holds one open to the server it's
// currently showing, and won't drop it until *after* we navigate away —
// which happens after closeCurrentServer() resolves. That's a deadlock, not
// a slow close: tracking and force-closing sockets ourselves is required,
// not an optimization.
const openSockets = new Set();

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    // Best-effort — losing "last project" just means the next launch asks again.
  }
}

function trackSockets(server) {
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
}

function closeCurrentServer() {
  return new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
    for (const socket of openSockets) socket.destroy();
    openSockets.clear();
    return undefined;
  });
}

// Assets a fresh project needs (a font + a subtitle it can already play).
// electron/main.js always sits at <appRoot>/electron/ — in dev, in the
// native Nix package, and in both cross-built resources/app trees alike —
// and every one of those layouts copies example/ in as a sibling of
// electron/ (see flake.nix's appResources), so this needs no app.isPackaged
// branch: REPO_ROOT already *is* the right appRoot in every case.
function bundledExampleDir() {
  return path.join(REPO_ROOT, 'example');
}

function scaffoldProject(dir) {
  const dataDir = path.join(dir, 'data');
  const fontsDir = path.join(dataDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });

  const exampleDir = bundledExampleDir();
  fs.copyFileSync(path.join(exampleDir, 'fonts', 'DejaVuSans.ttf'), path.join(fontsDir, 'DejaVuSans.ttf'));
  fs.copyFileSync(path.join(exampleDir, 'demo.ass'), path.join(dataDir, 'demo.ass'));

  const config = {
    subtitle: './data/demo.ass',
    font: {
      family: 'LyricsFont', path: './data/fonts/DejaVuSans.ttf', size: 64, weight: 'bold', style: 'normal',
    },
    colors: { text: '#000000', background: '#FFFFFF' },
    output: { width: 1920, height: 1080, fps: 30 },
  };
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 100 }), 'utf8');
  return configPath;
}

// closeCurrentServer() only stops new connections — it doesn't kill an
// in-flight renderVideo()/ffmpeg, which would otherwise keep writing into
// the project being switched away from, invisibly.
async function hasActiveRender() {
  if (!httpServer) return false;
  try {
    const { port } = httpServer.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/render/status`);
    const { status } = await res.json();
    return status === 'running';
  } catch {
    return false;
  }
}

async function openProject(configPath) {
  if (await hasActiveRender()) {
    dialog.showErrorBox('Render in progress', 'Wait for the current render to finish before switching projects.');
    return false;
  }

  let expressApp;
  try {
    ({ app: expressApp } = createServer(configPath));
  } catch (err) {
    dialog.showErrorBox('Could not open project', err.message);
    return false;
  }

  await closeCurrentServer();
  httpServer = await new Promise((resolve, reject) => {
    const server = expressApp.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
  trackSockets(httpServer);

  currentConfigPath = configPath;
  writeState({ lastProject: configPath });
  win.setTitle(`${path.basename(path.dirname(configPath))} — Lyrics Visualizer`);

  const { port } = httpServer.address();
  await win.loadURL(`http://127.0.0.1:${port}/`);
  return true;
}

async function newProject() {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for the new project',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return;

  const dir = result.filePaths[0];
  const configPath = path.join(dir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    try {
      scaffoldProject(dir);
    } catch (err) {
      dialog.showErrorBox('Could not create project', err.message);
      return;
    }
  }
  await openProject(configPath);
}

async function openProjectDialog() {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open config.yaml',
    properties: ['openFile'],
    filters: [{ name: 'Lyrics Visualizer config', extensions: ['yaml', 'yml'] }],
  });
  if (result.canceled || !result.filePaths[0]) return;
  await openProject(result.filePaths[0]);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => newProject() },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => openProjectDialog() },
        { type: 'separator' },
        {
          label: 'Show Project Folder',
          click: () => { if (currentConfigPath) shell.showItemInFolder(currentConfigPath); },
        },
        { type: 'separator' },
        {
          label: 'Render Video',
          // Not CmdOrCtrl+R: that's View > Reload's default accelerator
          // (would silently lose the binding), and a reflex key is a bad
          // fit for kicking off a multi-minute ffmpeg render anyway.
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win?.webContents.send('menu:render-video'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Lyrics Visualizer',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'About Lyrics Visualizer',
            message: 'Lyrics Visualizer',
            detail: `Version ${app.getVersion()}`,
          }),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

async function resolveInitialProject() {
  const state = readState();
  if (state.lastProject && fs.existsSync(state.lastProject)) return state.lastProject;
  return null;
}

async function promptForInitialProject() {
  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Open Project…', 'New Project…', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    title: 'Lyrics Visualizer',
    message: 'Open an existing project or start a new one?',
  });
  if (choice.response === 0) await openProjectDialog();
  else if (choice.response === 1) await newProject();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    createWindow();

    // A remembered project whose config.yaml exists but fails to load
    // (subtitle deleted, bad YAML, ...) must still fall through to the
    // picker — not dead-end into app.quit() on every future launch just
    // because openProject() returned false.
    const remembered = await resolveInitialProject();
    const opened = remembered && await openProject(remembered);
    if (!opened) await promptForInitialProject();

    if (!currentConfigPath) app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    if (httpServer) httpServer.close();
  });
}
