import {
  createSignal, createMemo, onMount, onCleanup,
} from 'solid-js';
import Sidebar from './components/Sidebar.jsx';
import Stage, { drawFrame } from './components/Stage.jsx';
import ControlsBar from './components/ControlsBar.jsx';
import Timeline from './components/Timeline.jsx';
import { activeCueIndexAtTime } from './lib/cueIndex.js';

function isTextEntry(el) {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

// config and cues are loaded once by App before this component is created,
// so they're plain (non-signal) props here — genuinely static for this
// component's whole lifetime.
export default function Player(props) {
  const { config, cues } = props;
  const usingAudio = Boolean(config.audio);

  const [currentTime, setCurrentTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [sceneRef, setSceneRef] = createSignal(null);
  const [audioDuration, setAudioDuration] = createSignal(0);
  // Lifted here (not local to Timeline) so global shortcuts can seek by beat.
  const [bpm, setBpm] = createSignal((config.timeline && config.timeline.bpm) || null);

  let fallbackDuration = cues.length ? cues[cues.length - 1].end + 2 : 0;
  if (config.output.duration) fallbackDuration = config.output.duration;
  const duration = () => (usingAudio && audioDuration() ? audioDuration() : fallbackDuration);

  const activeCueIndex = createMemo(() => activeCueIndexAtTime(cues, currentTime()));

  const audioEl = new Audio();
  if (usingAudio) {
    audioEl.preload = 'auto';
    audioEl.src = config.audio;
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
      if (manualTime >= fallbackDuration) {
        manualTime = fallbackDuration;
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
        const step = bpm() ? 60 / bpm() : 5;
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
        />
        <Stage config={config} cues={cues} onReady={setSceneRef} />
        <Timeline
          config={config}
          cues={cues}
          duration={duration}
          currentTime={currentTime}
          activeIndex={activeCueIndex}
          playing={playing}
          bpm={bpm}
          onBpmChange={setBpm}
          onSeek={seekTo}
        />
      </div>
    </div>
  );
}
