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

function closeCurrentServer() {
  return new Promise((resolve) => {
    if (httpServer) httpServer.close(() => resolve());
    else resolve();
  });
}

// Assets a fresh project needs (a font + a subtitle it can already play) —
// bundled next to the app in dev, or under resourcesPath once packaged (see
// flake.nix's electron-app derivation, which copies example/ alongside).
function bundledExampleDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'example') : path.join(REPO_ROOT, 'example');
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

async function openProject(configPath) {
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
          accelerator: 'CmdOrCtrl+R',
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

    const remembered = await resolveInitialProject();
    if (remembered) await openProject(remembered);
    else await promptForInitialProject();

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
