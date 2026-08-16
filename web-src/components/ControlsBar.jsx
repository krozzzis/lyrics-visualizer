import RenderControls from './RenderControls.jsx';
import Icon from './Icon.jsx';

export default function ControlsBar(props) {
  return (
    <div id="controls">
      <div class="spacer" />
      <RenderControls config={props.config} />
      <button
        type="button"
        class="smallBtn"
        classList={{ active: props.showSettings() }}
        onClick={props.onToggleSettings}
        title="Toggle settings panel"
      >
        <Icon name="settings" />
        Settings
      </button>
    </div>
  );
}
