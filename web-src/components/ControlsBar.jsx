import { createSignal } from 'solid-js';
import PlayPauseButton from './PlayPauseButton.jsx';
import RenderControls from './RenderControls.jsx';
import { formatClock } from '../lib/format.js';

export default function ControlsBar(props) {
  const [seekValue, setSeekValue] = createSignal('');

  function submitSeek(e) {
    e.preventDefault();
    const t = parseFloat(seekValue());
    if (Number.isFinite(t)) props.onSeek(t);
  }

  return (
    <div id="controls">
      <PlayPauseButton playing={props.playing} onToggle={props.onToggle} />
      <span class="timeDisplay">
        {formatClock(props.currentTime())} / {formatClock(props.duration())}
      </span>
      <div class="spacer" />
      <form class="seekForm" onSubmit={submitSeek}>
        <span>Seek to</span>
        <input
          type="number"
          step="0.1"
          placeholder="seconds"
          value={seekValue()}
          onInput={(e) => setSeekValue(e.currentTarget.value)}
        />
        <button type="submit" class="smallBtn">Go</button>
      </form>
      <RenderControls config={props.config} />
      <button
        type="button"
        class="smallBtn"
        classList={{ active: props.showSettings() }}
        onClick={props.onToggleSettings}
        title="Toggle settings panel"
      >
        Settings
      </button>
    </div>
  );
}
