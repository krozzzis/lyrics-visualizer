import {
  createSignal, createEffect, createMemo, onMount, onCleanup, Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import Sidebar from './components/Sidebar.jsx';
import Stage, { drawFrame } from './components/Stage.jsx';
import ControlsBar from './components/ControlsBar.jsx';
import Timeline from './components/Timeline.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { activeCueIndexAtTime } from './lib/cueIndex.js';
import { createResizablePanel } from './lib/resizable.js';
import { wordsFromText } from './lib/words.js';

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
  const usingAudio = Boolean(props.config.audio);

  const [currentTime, setCurrentTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [sceneRef, setSceneRef] = createSignal(null);
  const [audioDuration, setAudioDuration] = createSignal(0);
  const [showSettings, setShowSettings] = createSignal(false);
  const [volume, setVolume] = createSignal(1);
  const [muted, setMuted] = createSignal(false);
  const [snapEnabled, setSnapEnabled] = createSignal(false);

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
        cues: cues.map((c) => ({ start: c.start, end: c.end, text: c.text })),
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
          currentTime={currentTime}
          duration={duration}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings((v) => !v)}
        />
        <Stage config={config} cues={cues} onReady={setSceneRef} />
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
          onSeek={seekTo}
          usingAudio={usingAudio}
          volume={volume}
          onVolumeChange={setVolume}
          muted={muted}
          onToggleMute={() => setMuted((v) => !v)}
          snapEnabled={snapEnabled}
          onToggleSnap={() => setSnapEnabled((v) => !v)}
          onEditText={setCueText}
        />
      </div>
      <Show when={showSettings()}>
        <div class="resizeHandleV" onPointerDown={settingsPanel.onHandlePointerDown} />
        <SettingsPanel config={config} setConfig={setConfig} width={settingsPanel.size} />
      </Show>
    </div>
  );
}
