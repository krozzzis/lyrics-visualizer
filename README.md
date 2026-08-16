# lyrics-visualizer

Lyric video visualizer: by default every subtitle line flows word-by-word
along a single long horizontal line, black text on a white (or transparent)
background. The camera jumps to center the current word/line on each
subtitle timestamp — so the cuts land on the beat, not on an interpolated
guess. An opt-in stacked mode (`layout.mode: stacked`) groups cue blocks into
logical lines and stacks them vertically instead, with the camera jumping in
Y on a line change; see `config.example.yaml`. Play it live in a browser, or
render it offline to a video file with ffmpeg. Both paths share the exact
same layout and drawing code, so what you preview is what you get.

## Setup

```sh
nix develop     # nodejs + ffmpeg devShell
npm install
npm run build   # builds the browser player (web-src/ → web/dist/)
```

`config.example.yaml` points at a small bundled demo subtitle
(`example/demo.ass`, no copyrighted lyrics, no audio needed), so at this
point `node bin/serve.js -c config.example.yaml` already works — see
[Preview in a browser](#preview-in-a-browser).

## Configure

Copy `config.example.yaml` to `config.yaml` (gitignored) and point it at your
own files. Put your subtitle/audio/font in `data/` — also gitignored, so
your own project's files never end up in git history or get published:

```sh
cp config.example.yaml config.yaml
mkdir -p data
# cp ~/my-song.ass ~/my-song.mp3 data/
```

```yaml
subtitle: ./data/my-song.ass  # .ass (incl. \k karaoke tags), .srt, or .vtt
audio: ./data/my-song.mp3     # optional
font:
  family: LyricsFont
  path: ./fonts/MyFont.ttf    # required — see "Why font.path is required" below
  size: 72
colors:
  text: "#000000"
  background: "#FFFFFF"       # or an 8-digit hex (#RRGGBBAA), or "transparent"
```

See `config.example.yaml` for every field (camera easing/overshoot/zoom,
word split mode, layout gaps, active/inactive line opacity, previous-line/
word fade-out style, text-exit timing/style) — or tune all of
them live from the browser's Settings panel instead of hand-editing YAML;
see below. Every jump also does a two-phase zoom punch via `camera.zoom`:
the view pulls OUT from scale 1 down to `zoom.amount` over the first
`zoom.outFraction` of the jump, then eases back IN to 1.

### Why `font.path` is required

Text position comes from `measureText`, and a headless Node render has no
system font store to fall back on. Requiring a bundled `.ttf`/`.otf` file —
registered under the exact family name from your config, in both the browser
and the CLI — is what keeps the browser preview and the ffmpeg render
pixel-identical. `example/fonts/DejaVuSans.ttf` (Bitstream Vera-derived,
freely licensed) is included so the example config works out of the box.

## Preview in a browser

```sh
npm run build                          # only needed after changing web-src/
node bin/serve.js -c config.yaml -p 8080
```

Open `http://localhost:8080`. Play/pause and the seek bar are driven by the
audio element's clock when `audio` is set (so preview timing matches what
gets muxed into the render), or by a manual clock otherwise.

- **Sidebar** lists every cue with its timecode, highlights the currently
  active one, and clicking a line seeks straight to it.
- **Bottom timeline** is a DAW-style transport: waveform (decoded client-side
  via Web Audio, so no server-side processing), a beat grid, a track of cue
  blocks (one per subtitle fragment, active one highlighted), and a playhead.
  Click to seek, drag to pan, scroll/trackpad to pan, ctrl+scroll or the
  `−`/`Fit`/`+` buttons to zoom. Set a BPM in the header to turn on the grid
  and bar-numbered ruler — it's a live override for the preview, independent
  of `timeline.bpm` in the config (set that too if you want it to stick).
  Drag a block's edge to resize it (its neighbor's shared border is
  highlighted while dragging), drag its body to move it, click to select
  (shift/ctrl-click to multi-select), `Delete`/`Backspace` to remove the
  selection, `✂` to slice the block under the playhead in two, `➕` to insert
  a new block there. Multi-select several blocks and hit `Group` to merge
  them into one logical line for the stacked animation mode (`Ungroup` to
  split them back out) — grouped blocks show a colored bar underneath them,
  a different color per line so adjacent groups stay visually distinct.
- **Config markers** (`🚩` button in the timeline header) place a dot one row
  below the cue blocks — a point where `camera`/`colors`/`style` locally
  override the global config from there on, cumulatively, until the next
  marker touches the same field. Drag a dot to move it, click to select it
  and open its own panel (in the same right-hand slot as Settings), `Delete`/
  `Backspace` or the panel's Delete button to remove it. Every field in the
  marker panel starts unchecked (inherited from whatever's in effect just
  before it); check a field to pin it to a specific value from that point on.
  Only `camera`/`colors`/`style` are overridable this way — `layout`/`font`/
  `output` stay global, since they feed the single word-layout pass shared by
  the whole timeline. Markers live in `config-markers.json` next to
  `config.yaml` (gitignored, auto-created) and save immediately on every
  edit, like cue edits — no separate Save step, and both the browser preview
  and `bin/render.js` resolve them identically.
- **Keyboard shortcuts** work anywhere on the page except while typing in a
  text field: `Space` play/pause, `←`/`→` seek by one beat (or 5s without a
  BPM), `Home` jump to the start.
- **Settings panel** (top-right "Settings" button) edits every tunable field
  — output size/fps/duration, colors, font size/weight/style, camera
  timing/easing/zoom, word split mode, layout gaps, line opacity, fade-out
  (previous line/word dissolve) style/granularity/delay, text-exit
  (cue-end disappearance) timing/style, timeline —
  live against the running preview. `subtitle`/`audio`/`font.path` aren't
  editable here (that needs a file-upload flow this project doesn't have);
  edit those directly in `config.yaml`. "Save to config.yaml" writes your
  changes back to the file the server was started with, merged onto its
  current on-disk content — **this drops the file's comments** (js-yaml's
  writer doesn't preserve them) and won't be reflected in `/api/data` until
  you restart `bin/serve.js`, though the CLI renderer picks it up immediately
  since it reads the file fresh on every run.

For active UI development with hot reload, run the Vite dev server alongside
the API/asset server it proxies to:

```sh
node bin/serve.js -c config.yaml -p 8080   # terminal 1: API + assets
npm run dev                                # terminal 2: http://localhost:5173
```

## Render to video

```sh
node bin/render.js video -c config.yaml -o output.mp4
```

- Duration: explicit `--duration <seconds>`, else `output.duration` in the
  config, else the audio file's duration, else last cue's end + 2s.
- Transparent/translucent `colors.background` requires a `.mov` (ProRes 4444)
  output path. `.mp4`/H.264 has no alpha channel, and this project's
  ffmpeg/libvpx-vp9 build round-trips WebM/VP9 alpha as fully opaque
  (verified, not a guess) — both are refused rather than silently flattened.
- Audio, if configured, is muxed into the output automatically.

Other commands:

```sh
node bin/render.js dump -c config.yaml            # parsed cues as JSON
node bin/render.js frame -c config.yaml -t 65.5    # single PNG at t=65.5s
```

## How the camera decides where to jump (`word.splitMode`)

- `line` (default): one jump per subtitle cue, exactly on its start time —
  always on-beat, since it's real data straight from the subtitle file.
- `karaoke`: jumps per word, using ASS `\k`/`\kf` timing tags where a cue has
  them; cues without tags fall back to line-level.
- `char-weighted`: jumps per word using timing synthesized by splitting each
  cue's duration proportionally to word length. This is an approximation and
  can land slightly off the beat — opt in only if you don't have real
  word-level timing and want the word-by-word look anyway.

## Desktop app (Electron)

The same browser preview, packaged as a desktop app — no terminal, no manually
started server. It embeds `src/server.js` directly (not as a subprocess) and
rebuilds it on a fresh local port whenever you switch projects.

```sh
nix develop
npm install
npm run build      # web-src/ → web/dist/, same as the browser preview
npm run electron   # opens the app
```

- **File > New Project…** — pick an empty (or new) folder; it's scaffolded
  with a `config.yaml`, a copy of the bundled demo font/subtitle so it's
  playable immediately, and a `data/` folder to drop your own files into.
- **File > Open Project…** (`Ctrl/Cmd+O`) — pick any project's `config.yaml`.
- **File > Render Video** (`Ctrl/Cmd+R`) — same server-side render as the
  browser's Render button.
- The rest of File/Edit/View/Window/Help are standard app menu items
  (reload, zoom, dev tools, undo/redo/cut/copy/paste in text fields, quit).

The app remembers your last-opened project (`config.yaml`'s path, in
Electron's per-OS userData dir) and reopens straight to it next launch.

### Building and packaging via Nix

```sh
nix build .#lyrics-visualizer          # or just .#  — builds + runs on this OS
./result/bin/lyrics-visualizer
```

That's a real, runnable package for the OS you built it on (Linux or macOS —
nixpkgs' own `electron`, wrapped with `ffmpeg` on `PATH`; no npm-downloaded
Electron binary involved, which matters on NixOS since that one can't run
without `nix-ld`).

Cross-platform packages are also available, built entirely from a Nix
derivation graph (no `electron-builder`, which wants network access at build
time and doesn't fit the Nix sandbox):

```sh
nix build .#lyrics-visualizer-windows-x64
nix build .#lyrics-visualizer-macos-x64
nix build .#lyrics-visualizer-macos-arm64
```

These are **not** cross-compiled in the traditional sense — Electron ships
official prebuilt binaries per platform, so "porting" the app means fetching
that platform's Electron zip plus its matching prebuilt `@napi-rs/canvas`
native module (also prebuilt per-platform, via napi-rs — no compiler needed
either way) and assembling the app's JS/assets around them, all as ordinary
Nix fixed-output fetches. Concretely: everything is pure JS and identical
across platforms *except* `@napi-rs/canvas`'s native `.node` binary, which
its own `js-binding.js` already picks by `process.platform`/`process.arch`
at runtime — so swapping just that one file (plus the Electron binary
itself) is enough.

What that buys you, honestly:

- **Windows** — buildable and structurally complete (`lyrics-visualizer.exe`
  next to a real `resources/app` with the right native canvas binary), but
  built and only ever inspected from Linux — **not launched or tested**.
- **macOS** (`x64`/`arm64`) — same idea (`Lyrics Visualizer.app`), and
  additionally **unsigned**: Gatekeeper will refuse to open it on a real Mac
  without the user right-clicking → Open (or `xattr -cr` on the `.app`) to
  bypass the quarantine flag. Proper code signing/notarization needs Apple's
  toolchain and a developer certificate, neither of which is available here.
- **ffmpeg is not bundled** for either cross target (only the native Nix
  package wraps one via `PATH`) — ffmpeg's own official Windows/macOS static
  builds aren't Nix packages with a hash this repo can pin and verify from
  here, so **Render Video will fail on these two builds** until the target
  machine has `ffmpeg` on `PATH` itself. Live preview and everything else
  works.

## Architecture

```
src/subtitles/   .ass / .srt / .vtt  →  unified cues [{ start, end, text, words }]
src/lines.js     cues (+ lineId)     →  logical lines (groups of fragment cues)
src/layout.js    cues + canvas ctx   →  word positions — one long line, or (layout.mode:
                                        stacked) rows per logical line stacked vertically
src/camera.js    layout + config     →  jump keyframes, eased camera-x(t)/y(t)/scale(t)
src/scene.js     drawFrame(ctx, ...) →  the one draw routine both runtimes call
src/config.js    config.yaml         →  validated, path-resolved config object
src/configMarkers.js  config + config-markers.json  →  camera/colors/style resolved at time t
src/server.js    createServer(configPath) → express app (serves web/dist + the /api/* routes)
bin/render.js    Node CLI:  dump | frame | video (drives @napi-rs/canvas + ffmpeg)
bin/serve.js     thin CLI wrapper: src/server.js + app.listen(port)
electron/        desktop shell: embeds src/server.js directly (no subprocess), native menu,
                  Open/New Project (rebuilds the server + reloads the window per project)
web-src/         SolidJS browser player (Player, Sidebar, Timeline, Stage, ControlsBar, MarkerPanel)
web/dist/        Vite build output — gitignored, produced by `npm run build`
```

`src/color.js`, `src/lines.js`, `src/layout.js`, `src/camera.js`, `src/scene.js`,
`src/configMarkers.js` are plain
CommonJS, `require()`d directly by `bin/render.js` **and** bundled into the
browser build by Vite (`web-src/components/Stage.jsx` imports `src/scene.js`
straight from outside `web-src/`) — one `drawFrame()`, two runtimes, so the
live preview and the ffmpeg render are pixel-identical at the same `t`. Vite
needs `build.commonjsOptions.include` in `vite.config.mjs` to pull `src/**`
into its CJS interop, since that only covers `node_modules` by default.

## License

MIT — see [LICENSE](LICENSE). `example/fonts/DejaVuSans.ttf` is bundled
under its own permissive (Bitstream Vera-derived) license.
