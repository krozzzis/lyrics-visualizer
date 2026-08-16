// REPL driver for the lyrics-visualizer Electron app. Run under xvfb on
// headless Linux (NixOS: no apt-get shared libs — use nixpkgs' pkgs.electron
// instead of the npm-downloaded binary; see SKILL.md).
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

// nixpkgs' electron is autoPatchelf'd for NixOS and put on PATH by
// `nix develop` (see flake.nix devShells.default.packages) — unlike
// node_modules/electron/dist/electron, which is a generic-glibc binary
// NixOS can't run without nix-ld.
const electronBin = process.env.ELECTRON_BIN || 'electron';

let app = null;
let page = null; // the window/page you actually interact with

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: ['--no-sandbox', APP_DIR],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
      timeout: 30_000,
    });
    app.process().stdout.on('data', (d) => process.stdout.write(`[main stdout] ${d}`));
    app.process().stderr.on('data', (d) => process.stdout.write(`[main stderr] ${d}`));
    await new Promise((r) => setTimeout(r, 3_000));
    page = app.windows().find((w) => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
    page.on('console', (m) => console.log('[renderer console]', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('[renderer pageerror]', e.message));
    console.log('launched.', app.windows().length, 'windows:');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  // Stubs electron.dialog's async show* methods (in the MAIN process — this
  // runs inside app.evaluate, sharing the same `electron` module singleton
  // main.js required) so File > Open/New Project can be exercised without a
  // real OS file picker, which Playwright cannot see or click.
  async 'stub-dialog'(argJson) {
    if (!app) return console.log('ERROR: launch first');
    const result = JSON.parse(argJson);
    await app.evaluate(({ dialog }, res) => {
      dialog.__callCount = 0;
      dialog.showOpenDialog = async () => { dialog.__callCount += 1; return res; };
      dialog.showMessageBox = async () => ({ response: 0 });
    }, result);
    console.log('stubbed dialog.showOpenDialog →', argJson);
  },

  async 'dialog-check'() {
    if (!app) return console.log('ERROR: launch first');
    const r = await app.evaluate(({ dialog }) => [dialog.showOpenDialog.toString(), dialog.__callCount]);
    console.log('dialog.showOpenDialog =', r[0], ' callCount=', r[1]);
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`);
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return `OK: ${el.tagName}`;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },

  // Sends a menu click by role/label lookup via the app's Menu, since the
  // menu bar itself is native chrome, not DOM — Playwright can't click it.
  async menu(itemLabel) {
    if (!app) return console.log('ERROR: launch first');
    const r = await app.evaluate(({ Menu }, label) => {
      function find(items) {
        for (const item of items) {
          if (item.label === label) return item;
          if (item.submenu) {
            const found = find(item.submenu.items);
            if (found) return found;
          }
        }
        return null;
      }
      const item = find(Menu.getApplicationMenu().items);
      if (!item) return 'NOT_FOUND';
      item.click();
      return 'OK';
    }, itemLabel);
    console.log('menu', JSON.stringify(itemLabel), '→', r);
  },

  async type(text) { if (page) await page.keyboard.type(text, { delay: 30 }); },
  async press(key) { if (page) await page.keyboard.press(key); },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null,
    ));
  },

  async url() {
    if (!page) return console.log('ERROR: launch first');
    console.log(page.url());
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(() => {}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

// Stop Electron from stealing stdin — use the raw fd.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '— try: help'); return rl.prompt(); }
  try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  return rl.prompt();
});
rl.on('close', async () => { await COMMANDS.quit(); process.exit(0); });

console.log('lyrics-visualizer driver — "help" for commands, "launch" to start');
rl.prompt();
