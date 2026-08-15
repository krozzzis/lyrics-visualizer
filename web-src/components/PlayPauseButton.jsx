export default function PlayPauseButton(props) {
  return (
    <button
      type="button"
      class="playBtn"
      onClick={props.onToggle}
      aria-label={props.playing() ? 'Pause' : 'Play'}
      title={props.playing() ? 'Pause' : 'Play'}
    >
      {props.playing() ? (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <rect x="2.5" y="1.5" width="4" height="13" rx="1.2" />
          <rect x="9.5" y="1.5" width="4" height="13" rx="1.2" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 2.3 L13.2 8 L4 13.7 Z" stroke-linejoin="round" stroke="currentColor" stroke-width="1.4" />
        </svg>
      )}
    </button>
  );
}
