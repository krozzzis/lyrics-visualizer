# lyrics-visualizer

Lyric video visualizer: every subtitle line flows word-by-word along a single
long horizontal line, black text on a white (or transparent) background. The
camera jumps to center the current word/line on each subtitle timestamp — so
the cuts land on the beat, not on an interpolated guess. Play it live in a
browser, or render it offline to a video file with ffmpeg. Both paths share
the exact same layout and drawing code, so what you preview is what you get.

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
word split mode, layout gaps, active/inactive line opacity). Each jump can
also punch in/out via `camera.zoom` — scale animates on the same eased
timeline as the pan, from `zoom.from` at the instant a jump lands to
`zoom.to` once it settles.

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
  blocks (one per subtitle line, active one highlighted), and a playhead.
  Click to seek, drag to pan, scroll/trackpad to pan, ctrl+scroll or the
  `−`/`Fit`/`+` buttons to zoom. Set a BPM in the header to turn on the grid
  and bar-numbered ruler — it's a live override for the preview, independent
  of `timeline.bpm` in the config (set that too if you want it to stick).
- **Keyboard shortcuts** work anywhere on the page except while typing in a
  text field: `Space` play/pause, `←`/`→` seek by one beat (or 5s without a
  BPM), `Home` jump to the start.

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

## Architecture

```
src/subtitles/   .ass / .srt / .vtt  →  unified cues [{ start, end, text, words }]
src/layout.js    cues + canvas ctx   →  word x-positions on one long line
src/camera.js    layout + config     →  jump keyframes, eased camera-x(t)/scale(t)
src/scene.js     drawFrame(ctx, ...) →  the one draw routine both runtimes call
src/config.js    config.yaml         →  validated, path-resolved config object
bin/render.js    Node CLI:  dump | frame | video (drives @napi-rs/canvas + ffmpeg)
bin/serve.js     serves web/dist (built by Vite) + hands cues/config to the browser as JSON
web-src/         SolidJS browser player (Player, Sidebar, Timeline, Stage, ControlsBar)
web/dist/        Vite build output — gitignored, produced by `npm run build`
```

`src/color.js`, `src/layout.js`, `src/camera.js`, `src/scene.js` are plain
CommonJS, `require()`d directly by `bin/render.js` **and** bundled into the
browser build by Vite (`web-src/components/Stage.jsx` imports `src/scene.js`
straight from outside `web-src/`) — one `drawFrame()`, two runtimes, so the
live preview and the ffmpeg render are pixel-identical at the same `t`. Vite
needs `build.commonjsOptions.include` in `vite.config.mjs` to pull `src/**`
into its CJS interop, since that only covers `node_modules` by default.

## License

MIT — see [LICENSE](LICENSE). `example/fonts/DejaVuSans.ttf` is bundled
under its own permissive (Bitstream Vera-derived) license.
