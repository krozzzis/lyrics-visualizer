import svgAdd from '@material-symbols/svg-400/outlined/add.svg?raw';
import svgClose from '@material-symbols/svg-400/outlined/close.svg?raw';
import svgContentCut from '@material-symbols/svg-400/outlined/content_cut.svg?raw';
import svgDarkMode from '@material-symbols/svg-400/outlined/dark_mode.svg?raw';
import svgDelete from '@material-symbols/svg-400/outlined/delete.svg?raw';
import svgDownload from '@material-symbols/svg-400/outlined/download.svg?raw';
import svgFastForward from '@material-symbols/svg-400/outlined/fast_forward.svg?raw';
import svgFastRewind from '@material-symbols/svg-400/outlined/fast_rewind.svg?raw';
import svgFlag from '@material-symbols/svg-400/outlined/flag.svg?raw';
import svgGroup from '@material-symbols/svg-400/outlined/group.svg?raw';
import svgLightMode from '@material-symbols/svg-400/outlined/light_mode.svg?raw';
import svgLink from '@material-symbols/svg-400/outlined/link.svg?raw';
import svgMagnet from '@material-symbols/svg-400/outlined/nest_cam_magnet_mount.svg?raw';
import svgMovie from '@material-symbols/svg-400/outlined/movie.svg?raw';
import svgPause from '@material-symbols/svg-400/outlined/pause.svg?raw';
import svgPlayArrow from '@material-symbols/svg-400/outlined/play_arrow.svg?raw';
import svgSettings from '@material-symbols/svg-400/outlined/settings.svg?raw';
import svgSkipNext from '@material-symbols/svg-400/outlined/skip_next.svg?raw';
import svgSkipPrevious from '@material-symbols/svg-400/outlined/skip_previous.svg?raw';
import svgUngroup from '@material-symbols/svg-400/outlined/ungroup.svg?raw';
import svgVolumeOff from '@material-symbols/svg-400/outlined/volume_off.svg?raw';
import svgVolumeUp from '@material-symbols/svg-400/outlined/volume_up.svg?raw';

const ICONS = {
  add: svgAdd,
  close: svgClose,
  content_cut: svgContentCut,
  dark_mode: svgDarkMode,
  delete: svgDelete,
  download: svgDownload,
  fast_forward: svgFastForward,
  fast_rewind: svgFastRewind,
  flag: svgFlag,
  group: svgGroup,
  light_mode: svgLightMode,
  link: svgLink,
  magnet: svgMagnet,
  movie: svgMovie,
  pause: svgPause,
  play_arrow: svgPlayArrow,
  settings: svgSettings,
  skip_next: svgSkipNext,
  skip_previous: svgSkipPrevious,
  ungroup: svgUngroup,
  volume_off: svgVolumeOff,
  volume_up: svgVolumeUp,
};

// Material Symbols (outlined) SVGs, inlined at build time via Vite's `?raw`
// import so the app stays fully offline (no icon-font/CDN fetch) — required
// for the packaged Electron build. `fill` is left unset by the source SVGs,
// so `.mdIcon svg { fill: currentColor }` in styles.css controls color.
function svgFor(name) {
  const svg = ICONS[name];
  if (!svg) throw new Error(`Unknown icon: ${name}`);
  return svg;
}

export default function Icon(props) {
  return <span class={props.class ? `mdIcon ${props.class}` : 'mdIcon'} innerHTML={svgFor(props.name)} />;
}
