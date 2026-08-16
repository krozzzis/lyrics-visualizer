import Icon from './Icon.jsx';

export default function PlayPauseButton(props) {
  return (
    <button
      type="button"
      class="playBtn"
      onClick={props.onToggle}
      aria-label={props.playing() ? 'Pause' : 'Play'}
      title={props.playing() ? 'Pause' : 'Play'}
    >
      <Icon name={props.playing() ? 'pause' : 'play_arrow'} />
    </button>
  );
}
