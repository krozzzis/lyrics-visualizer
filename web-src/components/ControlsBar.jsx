import RenderControls from './RenderControls.jsx';
import { formatClock } from '../lib/format.js';

export default function ControlsBar(props) {
  return (
    <div id="controls">
      <span class="timeDisplay">
        {formatClock(props.currentTime())} / {formatClock(props.duration())}
      </span>
      <div class="spacer" />
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
