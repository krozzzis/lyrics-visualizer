import RenderControls from './RenderControls.jsx';

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
        Settings
      </button>
    </div>
  );
}
