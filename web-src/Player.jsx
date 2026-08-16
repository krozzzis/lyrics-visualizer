import {
  createSignal, createEffect, createMemo, onMount, onCleanup, Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import Sidebar from './components/Sidebar.jsx';
import Stage, { drawFrame } from './components/Stage.jsx';
import ControlsBar from './components/ControlsBar.jsx';
import Timeline from './components/Timeline.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import MarkerPanel from './components/MarkerPanel.jsx';
import { activeCueIndexAtTime, EPSILON as CUE_TIME_EPSILON } from './lib/cueIndex.js';
import { createResizablePanel } from './lib/resizable.js';
import { wordsFromText } from './lib/words.js';
import { snapToGrid } from './lib/snap.js';

function isTextEntry(el) {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

// cues and config both become reactive Solid stores here: cues are edited
// from the timeline/sidebar (resize, text edit, slice) and config from the
// settings panel, and Stage/Timeline re-render off the same stores — Stage's
// prepareScene() effect (Stage.jsx) already re-runs on any store field it
// actually reads, the same mechanism that already drives it for config.
export default function Player(props) {
  const [cues, setCues] = createStore(props.cues);
  const [config, setConfig] = createStore(props.config);
  const [markers, setMarkers] = createStore(props.configMarkers || []);
  const usingAudio = Boolean(props.config.audio);

  const [currentTime, setCurrentTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [sceneRef, setSceneRef] = createSignal(null);
  const [audioDuration, setAudioDuration] = createSignal(0);
  const [showSettings, setShowSettings] = createSignal(false);
  const [volume, setVolume] = createSignal(1);
  const [muted, setMuted] = createSignal(false);
  const [snapEnabled, setSnapEnabled] = createSignal(false);
  const [linkResize, setLinkResize] = createSignal(false);
  const [selectedIndices, setSelectedIndices] = createSignal(new Set());
  let selectionAnchor = null; // last plain/ctrl-clicked index, for shift-range selects
  const [selectedMarkerId, setSelectedMarkerId] = createSignal(null);

  const sidebarPanel = createResizablePanel('sidebar', {
    defaultSize: 300, min: 200, max: 520, axis: 'x',
  });
  const settingsPanel = createResizablePanel('settings', {
    defaultSize: 320, min: 240, max: 560, axis: 'x', invert: true,
  });
  const timelinePanel = createResizablePanel('timeline', {
    defaultSize: 220, min: 140, max: 480, axis: 'y', invert: true,
  });

  const fallbackDuration = () => (
    config.output.duration
      ? config.output.duration
      : (cues.length ? cues[cues.length - 1].end + 2 : 0)
  );
  const duration = () => (usingAudio && audioDuration() ? audioDuration() : fallbackDuration());

  const activeCueIndex = createMemo(() => activeCueIndexAtTime(cues, currentTime()));

  // Cue edits (text, and later resize/slice) apply to the local store
  // immediately — Stage/Timeline pick them up reactively — and persist to
  // the native cue file right away rather than requiring an explicit Save
  // step like the settings panel does: unlike config (a batch of unrelated
  // tweaks), each cue edit is already a single, deliberate, complete action.
  async function persistCues() {
    try {
      const body = JSON.stringify({
        cues: cues.map((c) => ({
          start: c.start, end: c.end, text: c.text, lineId: c.lineId,
        })),
      });
      const res = await fetch('/api/cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save cue edit:', err);
    }
  }

  function setCueText(index, text) {
    setCues(index, 'text', text);
    setCues(index, 'words', wordsFromText(text));
    persistCues();
  }

  // Splits the cue under the playhead into two at the current time, dividing
  // its words proportionally to where the cut falls (mirrors the char-
  // weighted timing synthesis in src/word-timing.js) rather than duplicating
  // the whole line into both halves. No-op off a cue or on a single-word
  // cue, where there's nothing meaningful to divide.
  function sliceAtCursor() {
    const t = currentTime();
    const idx = cues.findIndex((c) => t > c.start && t < c.end);
    if (idx < 0) return;
    const cue = cues[idx];
    if (cue.words.length < 2) return;

    const frac = (t - cue.start) / (cue.end - cue.start);
    const splitAt = Math.min(cue.words.length - 1, Math.max(1, Math.round(frac * cue.words.length)));
    const firstWords = cue.words.slice(0, splitAt).map((w) => ({ text: w.text }));
    const secondWords = cue.words.slice(splitAt).map((w) => ({ text: w.text }));

    setCues([
      ...cues.slice(0, idx),
      {
        start: cue.start, end: t, text: firstWords.map((w) => w.text).join(' '), words: firstWords, lineId: cue.lineId,
      },
      {
        start: t, end: cue.end, text: secondWords.map((w) => w.text).join(' '), words: secondWords, lineId: cue.lineId,
      },
      ...cues.slice(idx + 1),
    ]);
    clearSelection(); // indices past idx have shifted
    persistCues();
  }

  function clearSelection() {
    setSelectedIndices(new Set());
    selectionAnchor = null;
  }

  // Plain click selects just this cue; shift-click extends/shrinks a
  // contiguous range from the last anchor; ctrl/cmd-click toggles this cue
  // in the existing selection (and becomes the new anchor, matching typical
  // file-manager selection conventions). index === null clears the selection
  // (background click).
  function selectCue(index, opts = {}) {
    if (index == null) { clearSelection(); return; }
    if (opts.shiftKey && selectionAnchor != null) {
      const [lo, hi] = selectionAnchor <= index ? [selectionAnchor, index] : [index, selectionAnchor];
      const next = new Set();
      for (let i = lo; i <= hi; i += 1) next.add(i);
      setSelectedIndices(next);
      return;
    }
    if (opts.ctrlKey) {
      const next = new Set(selectedIndices());
      if (next.has(index)) next.delete(index); else next.add(index);
      setSelectedIndices(next);
      selectionAnchor = index;
      return;
    }
    setSelectedIndices(new Set([index]));
    selectionAnchor = index;
  }

  function deleteSelectedCues() {
    const sel = selectedIndices();
    if (sel.size === 0) return;
    setCues(cues.filter((_, i) => !sel.has(i)));
    clearSelection();
    persistCues();
  }

  let lineIdCounter = 0;

  // Groups every selected cue into one logical line (two-level subtitle
  // system: cue blocks are fragments, lines are what actually flows on
  // screen in the stacked-line layout). Re-grouping a cue that already
  // belongs to another line just moves it to this one. No-op under two
  // cues, since a "line" of one is just an ungrouped cue.
  function groupSelected() {
    const sel = selectedIndices();
    if (sel.size < 2) return;
    lineIdCounter += 1;
    const lineId = `line-${Date.now()}-${lineIdCounter}`;
    for (const i of sel) setCues(i, 'lineId', lineId);
    persistCues();
  }

  function ungroupSelected() {
    const sel = selectedIndices();
    if (sel.size === 0) return;
    for (const i of sel) setCues(i, 'lineId', undefined);
    persistCues();
  }

  const MIN_CUE_DURATION = 0.05;
  const NEW_CUE_DURATION = 1;
  const EDGE_EPSILON = 0.001; // tolerance for "two blocks share a border"

  // Inserts a new, empty cue at the playhead — for the gaps sliceAtCursor
  // can't reach, since that only splits an existing cue. No-op if the
  // playhead is inside an existing cue (there's nothing to insert there;
  // slice it instead) or if the gap at the playhead is too small to hold
  // even a minimum-duration cue. Returns the new cue's index (for the
  // caller to immediately open it for text editing), or -1 if it no-op'd.
  function addCueAtCursor() {
    const t = currentTime();
    // Nudge forward by the same tolerance activeCueIndexAtTime uses: a seek
    // to a cue's exact start (e.g. via the "next line" button) can read back
    // a hair before it, which would otherwise misclassify the playhead as
    // sitting in the gap just before that cue rather than inside it.
    const tEff = t + CUE_TIME_EPSILON;
    let idx = cues.findIndex((c) => c.start > tEff);
    if (idx < 0) idx = cues.length;
    const prev = cues[idx - 1];
    const next = cues[idx];
    if (prev && tEff < prev.end) return -1;
    const lower = prev ? prev.end : 0;
    const upper = next ? next.start : duration();
    if (upper - lower < MIN_CUE_DURATION) return -1;

    const tl = config.timeline || {};
    const rawStart = snapEnabled() ? snapToGrid(t, tl.bpm, tl.beatsPerBar, tl.gridOffset || 0) : t;
    const start = Math.max(lower, Math.min(upper - MIN_CUE_DURATION, rawStart));
    const end = Math.min(upper, start + NEW_CUE_DURATION);

    setCues([...cues.slice(0, idx), { start, end, text: '', words: [] }, ...cues.slice(idx)]);
    setSelectedIndices(new Set([idx]));
    selectionAnchor = idx;
    persistCues();
    return idx;
  }

  // Drags a cue's start or end edge to rawTime (snapped first, if enabled),
  // clamped so it can never shrink past MIN_CUE_DURATION or overlap a
  // neighbor. With linkResize on, if the dragged edge currently sits exactly
  // on a neighbor's opposite edge (within EDGE_EPSILON), that neighbor's
  // edge is dragged along with it — otherwise the neighbor is untouched and
  // the shared-border clamp just prevents crossing into it, same as if
  // linking were off. Called continuously during a drag; not persisted here
  // (see commitCueEdit) so a drag doesn't flood the server with saves.
  function resizeCueEdge(index, edge, rawTime) {
    const tl = config.timeline || {};
    const t = snapEnabled() ? snapToGrid(rawTime, tl.bpm, tl.beatsPerBar, tl.gridOffset || 0) : rawTime;
    const cue = cues[index];

    if (edge === 'end') {
      const next = cues[index + 1];
      const linked = linkResize() && next && Math.abs(cue.end - next.start) < EDGE_EPSILON;
      const upper = linked ? next.end - MIN_CUE_DURATION : (next ? next.start : duration());
      const clamped = Math.min(upper, Math.max(cue.start + MIN_CUE_DURATION, t));
      setCues(index, 'end', clamped);
      if (linked) setCues(index + 1, 'start', clamped);
    } else {
      const prev = cues[index - 1];
      const linked = linkResize() && prev && Math.abs(cue.start - prev.end) < EDGE_EPSILON;
      const lower = linked ? prev.start + MIN_CUE_DURATION : (prev ? prev.end : 0);
      const clamped = Math.max(lower, Math.min(cue.end - MIN_CUE_DURATION, t));
      setCues(index, 'start', clamped);
      if (linked) setCues(index - 1, 'end', clamped);
    }
  }

  // Drags a whole cue to a new position, keeping its duration fixed. rawStart
  // is the cue's would-be start under the pointer (snapped first, if
  // enabled); clamped so it can't cross into a neighbor. Same
  // continuous-during-drag / commit-on-release split as resizeCueEdge.
  function moveCueTo(index, rawStart) {
    const tl = config.timeline || {};
    const cue = cues[index];
    const dur = cue.end - cue.start;
    const start = snapEnabled() ? snapToGrid(rawStart, tl.bpm, tl.beatsPerBar, tl.gridOffset || 0) : rawStart;
    const prev = cues[index - 1];
    const next = cues[index + 1];
    const lower = prev ? prev.end : 0;
    const upper = (next ? next.start : duration()) - dur;
    const clamped = Math.max(lower, Math.min(upper, start));
    setCues(index, 'start', clamped);
    setCues(index, 'end', clamped + dur);
  }

  function commitCueEdit() {
    persistCues();
  }

  // Config markers: points on the timeline (drawn as a dot below the cue
  // blocks) where camera/colors/style locally override the global config
  // from that point on — see src/configMarkers.js. Persisted immediately on
  // every mutation, like cues and the settings panel: each add/move/delete/
  // override edit is already a single, deliberate, complete action, not a
  // batch of unrelated tweaks.
  async function persistMarkers() {
    try {
      const body = JSON.stringify({
        markers: markers.map((m) => ({ id: m.id, time: m.time, overrides: m.overrides })),
      });
      const res = await fetch('/api/markers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save marker edit:', err);
    }
  }

  let markerIdCounter = 0;

  // New markers start with empty overrides — not a snapshot of the current
  // camera/colors/style — so later global settings edits keep affecting the
  // timeline right up to the next field a marker actually touches. A
  // snapshot would silently freeze every field at that instant, which reads
  // as "settings stopped working" the next time someone tweaks the panel.
  function addMarkerAtCursor() {
    markerIdCounter += 1;
    const id = `marker-${Date.now()}-${markerIdCounter}`;
    const time = currentTime();
    setMarkers([...markers, { id, time, overrides: {} }]);
    setSelectedMarkerId(id);
    persistMarkers();
    return id;
  }

  function markerIndex(id) {
    return markers.findIndex((m) => m.id === id);
  }

  // Continuous during a drag (see resizeCueEdge/moveCueTo above) — not
  // persisted here so a drag doesn't flood the server with saves.
  function moveMarkerTo(id, rawTime) {
    const tl = config.timeline || {};
    const t = snapEnabled() ? snapToGrid(rawTime, tl.bpm, tl.beatsPerBar, tl.gridOffset || 0) : rawTime;
    const i = markerIndex(id);
    if (i < 0) return;
    setMarkers(i, 'time', Math.max(0, Math.min(duration(), t)));
  }

  function commitMarkerMove() {
    persistMarkers();
  }

  // Direct numeric time entry from the marker panel — exact, unlike a
  // pointer drag, so it deliberately skips the snap-to-grid a drag applies.
  function setMarkerTime(id, rawTime) {
    const i = markerIndex(id);
    if (i < 0 || !Number.isFinite(rawTime)) return;
    setMarkers(i, 'time', Math.max(0, Math.min(duration(), rawTime)));
    persistMarkers();
  }

  function deleteMarker(id) {
    const i = markerIndex(id);
    if (i < 0) return;
    // Clear the selection *before* removing the marker from the store: the
    // marker panel reads markers[markerIndex(selectedMarkerId())] reactively,
    // and Solid's store updates apply (and re-render dependents) synchronously
    // per call — removing the marker first would momentarily leave the panel
    // pointed at an id no longer in the array and crash on `undefined.id`.
    if (selectedMarkerId() === id) setSelectedMarkerId(null);
    setMarkers(markers.filter((m) => m.id !== id));
    persistMarkers();
  }

  function selectMarker(id) {
    setSelectedMarkerId(id);
    if (id != null) clearSelection(); // marker and cue selection are mutually exclusive
  }

  // Sets (or clears, when value is undefined) one field inside a marker's
  // overrides, at any depth — e.g. setMarkerOverride(id, ['camera', 'jumpDuration'], 0.4)
  // or setMarkerOverride(id, ['camera', 'zoom', 'amount'], undefined) to stop
  // overriding it and fall back to whatever the next-earlier marker (or the
  // global config) says. Empty objects left behind by a clear are pruned so
  // overrides never accumulates stale `{}` shells.
  function deepSet(obj, path, value) {
    const [key, ...rest] = path;
    const next = { ...obj };
    if (rest.length === 0) {
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    }
    const child = deepSet(obj[key] || {}, rest, value);
    if (Object.keys(child).length === 0) delete next[key];
    else next[key] = child;
    return next;
  }

  function setMarkerOverride(id, path, value) {
    const i = markerIndex(id);
    if (i < 0) return;
    const next = deepSet(markers[i].overrides || {}, path, value);
    // Solid's store setter merges plain objects at a path rather than
    // replacing them (keys absent from `next` — e.g. a field just cleared —
    // are otherwise left untouched instead of removed), so a bare
    // setMarkers(i, 'overrides', next) would silently fail to ever clear a
    // field. reconcile() forces an actual replace/diff instead of a merge.
    setMarkers(i, 'overrides', reconcile(next));
    persistMarkers();
  }

  const audioEl = new Audio();
  if (usingAudio) {
    audioEl.preload = 'auto';
    audioEl.src = props.config.audio;
    audioEl.volume = volume();
    audioEl.addEventListener('loadedmetadata', () => setAudioDuration(audioEl.duration));
    audioEl.addEventListener('play', () => setPlaying(true));
    audioEl.addEventListener('pause', () => setPlaying(false));
    audioEl.addEventListener('ended', () => setPlaying(false));
    createEffect(() => { audioEl.volume = muted() ? 0 : volume(); });
  }

  // Manual clock used only when there's no audio track to drive playback.
  let manualTime = 0;
  let manualPlaying = false;
  let lastTs = 0;

  function play() {
    if (usingAudio) audioEl.play();
    else { manualPlaying = true; lastTs = performance.now(); setPlaying(true); }
  }

  function pause() {
    if (usingAudio) audioEl.pause();
    else { manualPlaying = false; setPlaying(false); }
  }

  function seekTo(t) {
    const clamped = Math.max(0, Math.min(duration(), t));
    if (usingAudio) audioEl.currentTime = clamped;
    else manualTime = clamped;
    // Update the signal immediately rather than waiting for the next RAF
    // tick to read it back from the audio element: keeps the UI (sidebar,
    // timeline playhead) in lockstep with a seek, and makes back-to-back
    // programmatic seeks (e.g. repeated arrow-key presses) accumulate
    // correctly instead of all reading the same stale currentTime().
    setCurrentTime(clamped);
  }

  let raf;
  function tick(ts) {
    if (!usingAudio && manualPlaying) {
      manualTime += (ts - lastTs) / 1000;
      lastTs = ts;
      if (manualTime >= fallbackDuration()) {
        manualTime = fallbackDuration();
        manualPlaying = false;
        setPlaying(false);
      }
    }

    setCurrentTime(usingAudio ? audioEl.currentTime : manualTime);

    const ref = sceneRef();
    if (ref) drawFrame(ref.ctx, config.output, config, ref.scene, currentTime());

    raf = requestAnimationFrame(tick);
  }

  onMount(() => { raf = requestAnimationFrame(tick); });
  onCleanup(() => cancelAnimationFrame(raf));

  // Global, DAW-style transport shortcuts — work no matter what has focus on
  // the page (canvas, sidebar row, a button…), except while actually typing
  // into a text field, where Space/arrows must behave normally.
  onMount(() => {
    function onKeyDown(e) {
      if (isTextEntry(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (playing()) pause(); else play();
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const step = config.timeline.bpm ? 60 / config.timeline.bpm : 5;
        seekTo(currentTime() + (e.code === 'ArrowRight' ? step : -step));
      } else if (e.code === 'Home') {
        e.preventDefault();
        seekTo(0);
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        sliceAtCursor();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedMarkerId() != null) {
          e.preventDefault();
          deleteMarker(selectedMarkerId());
        } else if (selectedIndices().size > 0) {
          e.preventDefault();
          deleteSelectedCues();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <div id="app">
      <Sidebar
        cues={cues}
        activeIndex={activeCueIndex}
        onSeek={seekTo}
        width={sidebarPanel.size}
        onEditText={setCueText}
      />
      <div class="resizeHandleV" onPointerDown={sidebarPanel.onHandlePointerDown} />
      <div class="main">
        <ControlsBar
          config={config}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings((v) => !v)}
        />
        <Stage config={config} cues={cues} markers={markers} onReady={setSceneRef} />
        <div class="resizeHandleH" onPointerDown={timelinePanel.onHandlePointerDown} />
        <Timeline
          height={timelinePanel.size}
          config={config}
          cues={cues}
          duration={duration}
          currentTime={currentTime}
          activeIndex={activeCueIndex}
          playing={playing}
          onToggle={() => (playing() ? pause() : play())}
          bpm={() => config.timeline.bpm}
          onBpmChange={(v) => setConfig('timeline', 'bpm', v)}
          onBeatsPerBarChange={(v) => setConfig('timeline', 'beatsPerBar', v)}
          onSeek={seekTo}
          usingAudio={usingAudio}
          volume={volume}
          onVolumeChange={setVolume}
          muted={muted}
          onToggleMute={() => setMuted((v) => !v)}
          snapEnabled={snapEnabled}
          onToggleSnap={() => setSnapEnabled((v) => !v)}
          onEditText={setCueText}
          onSlice={sliceAtCursor}
          onAddCue={addCueAtCursor}
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          linkResize={linkResize}
          onToggleLinkResize={() => setLinkResize((v) => !v)}
          onResizeCue={resizeCueEdge}
          onResizeCommit={commitCueEdit}
          onMoveCue={moveCueTo}
          onMoveCommit={commitCueEdit}
          selectedIndices={selectedIndices}
          onSelectCue={selectCue}
          markers={markers}
          onAddMarker={addMarkerAtCursor}
          onMoveMarker={moveMarkerTo}
          onMoveMarkerCommit={commitMarkerMove}
          selectedMarkerId={selectedMarkerId}
          onSelectMarker={selectMarker}
        />
      </div>
      {/* Marker overrides and global settings both live in the right-hand
          panel slot; selecting a marker takes priority so its per-field
          local overrides are never edited side-by-side with (and easily
          confused for) the global config. */}
      <Show
        when={selectedMarkerId() != null}
        fallback={(
          <Show when={showSettings()}>
            <div class="resizeHandleV" onPointerDown={settingsPanel.onHandlePointerDown} />
            <SettingsPanel config={config} setConfig={setConfig} width={settingsPanel.size} />
          </Show>
        )}
      >
        <div class="resizeHandleV" onPointerDown={settingsPanel.onHandlePointerDown} />
        <MarkerPanel
          marker={markers[markerIndex(selectedMarkerId())]}
          config={config}
          markers={markers}
          onSetOverride={(path, value) => setMarkerOverride(selectedMarkerId(), path, value)}
          onSetTime={(t) => setMarkerTime(selectedMarkerId(), t)}
          onDelete={() => deleteMarker(selectedMarkerId())}
          onClose={() => setSelectedMarkerId(null)}
          width={settingsPanel.size}
        />
      </Show>
    </div>
  );
}
