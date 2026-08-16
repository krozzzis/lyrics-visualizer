# lyrics-visualizer

Lyric video visualizer: subtitle lines flow word-by-word along one long
horizontal line; the camera jumps to center the current word/line on each
subtitle timestamp. Renders live in a browser (Solid.js) or offline to a
video file via ffmpeg — both paths share the same layout/draw code
(`src/scene.js`, `src/layout.js`, `src/camera.js`, `src/color.js`,
`src/configMarkers.js`, `src/fade.js`) so the preview and the rendered
output are pixel-identical. See `README.md` for user-facing setup/config
docs.

Config is not fully global: `camera`/`colors`/`style`/`layout` can be
locally overridden from a point in time onward via config markers
(`src/configMarkers.js`, `config-markers.json` next to `config.yaml`) —
`font`/`output` stay global (font feeds the single glyph-measurement pass
`computeLayout` depends on; output is the render target itself).
`resolveConfigAt(config, sortedMarkers, t)` is the one place that resolution
happens; `buildKeyframes` (src/camera.js) resolves `camera.anchor` per-cue,
`computeLayout` (src/layout.js) resolves `layout.*` per-cue/per-row —
including segmenting the cue list wherever `layout.mode` itself changes, so
flow and stacked runs can be spliced together — and `drawFrame`
(src/scene.js) resolves the rest per-frame or (colors/style/row-visibility)
per-cue via `perCueStyle`. If you add a new config field that should be
markerable, it must go through this resolver, not be read straight off
`config` in a per-frame/per-cue/per-row code path.

## Architecture

- `src/` — framework-free CommonJS, shared between the Node CLI and (via
  Vite's CJS interop, see `vite.config.mjs`) the browser bundle. Never add a
  browser- or Node-only API here without checking both consumers.
- `bin/render.js` — CLI: `dump` (print parsed cues), `frame` (single PNG),
  `video` (full ffmpeg render). Uses `@napi-rs/canvas` for a headless
  CanvasRenderingContext2D.
- `bin/serve.js` — dev server: serves `web/dist`, `GET /api/data` (config +
  cues + config markers for the browser), `POST /api/config` (persist
  settings-panel edits to the YAML file this server was started with,
  autosaved on a debounce — no explicit Save step), `POST /api/markers`
  (persist config-marker add/move/delete/override edits to
  `config-markers.json`, immediately — like `POST /api/cues`),
  `POST /api/render` + `GET /api/render/status` +
  `GET /api/render/download` (server-side render triggered from the browser,
  sharing `src/render.js` with the CLI's `video` command).
- `web-src/` — Solid.js browser player, built by Vite into `web/dist`
  (gitignored; `bin/serve.js` refuses to start without it).
- Config precedence: `config.yaml` on disk is the source of truth, but the
  browser's settings-panel store can have live unsaved edits. `/api/render`
  merges those onto the server's in-memory config for that render only,
  without touching the file — never make a render (or anything else)
  silently fall back to stale/disk-only config when the user is looking at
  something different on screen.

## Commands

```sh
nix develop            # nodejs_22 + ffmpeg devShell — everything below assumes this
npm install
npm run build           # web-src/ → web/dist/ (required before bin/serve.js will start)
node bin/serve.js -c config.yaml -p 8080   # dev server: browser preview + render API
npm run dev              # vite dev server with HMR; proxies /api and /assets to :8080
                          # (needs bin/serve.js already running on :8080)
node bin/render.js video -c config.yaml -o out.mp4   # CLI render, no browser involved
```

There's no test suite. "Verified" in this codebase means: built, run against
the real dev server, and exercised through an actual browser (Playwright) or
`curl` — not just "it typechecks" or "the diff looks right". A UI change
that was only read, not clicked through, is not verified.

## Workflow

- **Commit and verify each logical step separately** — don't batch multiple
  distinct changes (e.g. "add feature A" and "add feature B") into one
  commit, even within a single session/request. Build, exercise the change
  for real (browser/curl, not just a syntax check), *then* commit, then move
  to the next step. This applies by default for any multi-step task, not
  only when explicitly asked per-request.
- Prefer catching real bugs by actually running the code over reasoning
  about it: e.g. the `/api/render` backpressure path only showed a hang (dead
  ffmpeg spawn leaving a `drain` wait that never resolves) once a real
  1920×1080 render was run — small test renders never hit it because tiny
  PNGs never exceed stdin's buffer.
- When restarting `bin/serve.js` after a source change, check for an
  already-running instance on the port first (`ss -ltnp | grep 8080`) —
  this project's dev server caches config/cues in memory at startup, so a
  stale process silently serves outdated values instead of erroring.
- In `web-src/`, a bare `setStore(path..., someObject)` **merges** `someObject`
  onto the existing value at that path — keys absent from the new object are
  left untouched, not removed. Any store write meant to *clear/shrink* a
  nested object (not just add/overwrite keys) needs
  `setStore(path..., reconcile(someObject))` (from `solid-js/store`) to force
  an actual replace. Found via Player.jsx's marker-override "clear" checkbox
  silently no-op'ing — confirmed by logging the store's value immediately
  after the `setStore` call, not by reasoning about the diff.
