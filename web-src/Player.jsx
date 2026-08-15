import {
  createSignal, createMemo, onMount, onCleanup, Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import Sidebar from './components/Sidebar.jsx';
import Stage, { drawFrame } from './components/Stage.jsx';
import ControlsBar from './components/ControlsBar.jsx';
import Timeline from './components/Timeline.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { activeCueIndexAtTime } from './lib/cueIndex.js';

function isTextEntry(el) {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

// cues are loaded once by App before this component is created, so they're
// a plain (non-signal) prop — genuinely static for this component's whole
// lifetime. config becomes a reactive store here: the settings panel edits
// it live, and Stage/Timeline re-render off the same store.
export default function Player(props) {
  const { cues } = props;
  const [config, setConfig] = createStore(props.config);
  const usingAudio = Boolean(props.config.audio);

  const [currentTime, setCurrentTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [sceneRef, setSceneRef] = createSignal(null);
  const [audioDuration, setAudioDuration] = createSignal(0);
  const [showSettings, setShowSettings] = createSignal(false);

  const fallbackDuration = () => (
    config.output.duration
      ? config.output.duration
      : (cues.length ? cues[cues.length - 1].end + 2 : 0)
  );
  const duration = () => (usingAudio && audioDuration() ? audioDuration() : fallbackDuration());

  const activeCueIndex = createMemo(() => activeCueIndexAtTime(cues, currentTime()));

  const audioEl = new Audio();
  if (usingAudio) {
    audioEl.preload = 'auto';
    audioEl.src = props.config.audio;
    audioEl.addEventListener('loadedmetadata', () => setAudioDuration(audioEl.duration));
    audioEl.addEventListener('play', () => setPlaying(true));
    audioEl.addEventListener('pause', () => setPlaying(false));
    audioEl.addEventListener('ended', () => setPlaying(false));
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
      <Sidebar cues={cues} activeIndex={activeCueIndex} onSeek={seekTo} />
      <div class="main">
        <ControlsBar
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          onToggle={() => (playing() ? pause() : play())}
          onSeek={seekTo}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings((v) => !v)}
        />
        <Stage config={config} cues={cues} onReady={setSceneRef} />
        <Timeline
          config={config}
          cues={cues}
          duration={duration}
          currentTime={currentTime}
          activeIndex={activeCueIndex}
          playing={playing}
          bpm={() => config.timeline.bpm}
          onBpmChange={(v) => setConfig('timeline', 'bpm', v)}
          onSeek={seekTo}
        />
      </div>
      <Show when={showSettings()}>
        <SettingsPanel config={config} setConfig={setConfig} />
      </Show>
    </div>
  );
}
