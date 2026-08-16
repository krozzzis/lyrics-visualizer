---
name: run-electron
description: Build, run, and drive the lyrics-visualizer Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, build it, or interact with its UI/menu.
---

lyrics-visualizer's Electron shell (`electron/main.js` + `electron/preload.js`)
embeds the same `src/server.js` express app the CLI (`bin/serve.js`) and
browser preview use — see `CLAUDE.md`. It has no test suite; "run" means
actually launching the app and driving it, per the repo's own verification
bar. For agent/automated use, drive it via the Playwright REPL at
`.claude/skills/run-electron/driver.mjs` under Xvfb — NixOS can't run the
generic-glibc Electron binary `npm install` downloads (no FHS loader), and
Electron's native menu / dialogs aren't DOM, so plain Playwright page clicks
can't reach them either. The driver handles both.

All paths below are relative to the repo root.

## Prerequisites (NixOS / this repo's flake)

`flake.nix`'s `devShells.default` already provides a working, autoPatchelf'd
`electron` on `PATH` plus `ELECTRON_OVERRIDE_DIST_PATH` (pointed at it, so
`npm run electron` — and the driver — use it instead of the broken
npm-downloaded binary). It does NOT provide a display server or tmux, since
those are test-only, not build/run dependencies of the app itself:

```bash
nix build --no-link --print-out-paths nixpkgs#xvfb   # Xvfb binary
nix build --no-link --print-out-paths nixpkgs#tmux    # only if driving interactively
```

`playwright-core` is already a devDependency (`npm install` pulls it).

## Build

```sh
nix develop
npm install
npm run build   # web-src/ → web/dist/ — bin/serve.js and Electron both refuse to start without it
```

## Run (agent path)

```bash
rm -f /tmp/.X99-lock
<xvfb-store-path>/bin/Xvfb :99 -screen 0 1280x800x24 &
disown

nix develop -c bash -c 'export DISPLAY=:99; export PATH="<xvfb-store-path>/bin:$PATH"; node .claude/skills/run-electron/driver.mjs'
```

The very first launch (no `~/.config/lyrics-visualizer/state.json` yet)
blocks on a native "Open Project… / New Project… / Quit" message box before
any window content exists — Playwright cannot see or click it, so `launch`
will hang. Either open the real app once by hand first, or pre-seed the
remembered project so headless launches skip straight to it:

```bash
mkdir -p ~/.config/lyrics-visualizer
echo '{"lastProject":"'"$(pwd)"'/config.yaml"}' > ~/.config/lyrics-visualizer/state.json
```

Wrap in tmux for interactive/iterative use — capture-pane right after a
send-keys in the same shell invocation is unreliable in this environment
(comes back empty); always issue the `capture-pane` as its own, separate
tool call a moment later:

```bash
tmux new-session -d -s ev -x 200 -y 50
tmux send-keys -t ev 'nix develop -c bash -c "export DISPLAY=:99; export PATH=\"<xvfb-store-path>/bin:\$PATH\"; node .claude/skills/run-electron/driver.mjs"' Enter
# -- separate tool call --
tmux capture-pane -t ev -p   # wait for "driver>"
tmux send-keys -t ev 'launch' Enter
# -- separate tool call --
tmux capture-pane -t ev -p   # wait for "launched."
tmux send-keys -t ev 'ss 01-landing' Enter
# -- separate tool call --
tmux capture-pane -t ev -p   # wait for "screenshot:"
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait for windows |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element (via DOM, not coords) |
| `click-text <text>` | click button/link containing text |
| `menu <label>` | click a native menu item by exact label (walks `Menu.getApplicationMenu()` in the main process — this is how you exercise File/Edit/View/Help, since the menu bar is native chrome, not DOM) |
| `stub-dialog <json>` | monkey-patches `electron.dialog.showOpenDialog`/`showMessageBox` in the main process to resolve with the given JSON (e.g. `{"canceled":false,"filePaths":["/abs/path/config.yaml"]}`) — the only way to drive Open/New Project, since Playwright cannot see native OS file pickers |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the renderer page, print JSON (e.g. `eval fetch('/api/render/status').then(r=>r.json())`) |
| `text [css-sel]` | print innerText |
| `url` | print the current window's URL (`http://127.0.0.1:<ephemeral-port>/` — confirms the embedded server is actually serving) |
| `windows` | list windows |
| `quit` | close app, exit |

Example: driving File > Open Project without a real file picker —

```
stub-dialog {"canceled":false,"filePaths":["/abs/path/to/other/config.yaml"]}
menu Open Project…
url
```

## Run (human path)

```sh
npm run electron   # opens a real window; on first run picks Open/New Project
```

## Gotchas

- **`node_modules/.bin/electron` doesn't run on NixOS.** It's a generic
  dynamically-linked binary expecting `/lib64/ld-linux-x86-64.so.2`, which
  doesn't exist outside FHS distros. Always launch via the nixpkgs `electron`
  from `nix develop`'s `PATH` (or set `ELECTRON_OVERRIDE_DIST_PATH`), never
  the raw `node_modules` path — the driver defaults to `electron` on `PATH`
  for exactly this reason (`ELECTRON_BIN` env var overrides it if needed).
- **The menu bar and every `dialog.show*` call are native, not DOM.**
  Regular Playwright `page.click()`/`locator` calls can't reach them at all —
  use the driver's `menu` and `stub-dialog` commands, which operate on the
  main process via `electronApplication.evaluate()`.
- **`pkill -f electron` is too broad here** — this driver's own launch
  command line contains the literal substring `run-electron`, so a pattern
  like that can kill the tmux pane running the driver itself (and, if it's
  tmux's last pane, the tmux server). Match the actual Electron binary path
  instead, or just `quit` from inside the driver.
- **First capture-pane right after send-keys in the same tool call often
  comes back blank** in this environment even though the pane has content a
  moment later — always split send-keys and the confirming capture-pane into
  separate tool calls.

## Troubleshooting

- **Launch hangs ~30s then times out:** either `web/dist` is missing (run
  `npm run build`) or the app is blocked on the native "no remembered
  project" message box — see the state.json pre-seed above.
- **"Missing X server":** forgot Xvfb, or `DISPLAY` isn't exported into the
  `nix develop -c bash -c '...'` invocation.
- **Stale Xvfb lock:** `rm -f /tmp/.X99-lock; pkill Xvfb`.
