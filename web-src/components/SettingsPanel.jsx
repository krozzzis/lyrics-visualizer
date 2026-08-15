import { createSignal } from 'solid-js';
import { buildEditablePayload } from '../lib/editableConfig.js';

function toNumber(raw, fallback = 0) {
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
}

function toNullableNumber(raw) {
  if (raw === '') return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

function Section(props) {
  return (
    <div class="settingsSection">
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}

function Row(props) {
  return (
    <label class="settingsRow">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export default function SettingsPanel(props) {
  const { config, setConfig } = props;
  const [saving, setSaving] = createSignal(false);
  const [saveState, setSaveState] = createSignal(null); // null | 'ok' | 'error'
  const [saveMessage, setSaveMessage] = createSignal('');

  async function save() {
    setSaving(true);
    setSaveState(null);
    const body = buildEditablePayload(config);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSaveState('ok');
      setSaveMessage('Saved to config.yaml');
    } catch (err) {
      setSaveState('error');
      setSaveMessage(err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveState(null), 3000);
    }
  }

  return (
    <aside id="settingsPanel">
      <div id="settingsHeader">
        <span>Settings</span>
        <button type="button" class="smallBtn" disabled={saving()} onClick={save}>
          {saving() ? 'Saving…' : 'Save to config.yaml'}
        </button>
      </div>
      {saveState() && (
        <div classList={{ settingsStatus: true, ok: saveState() === 'ok', error: saveState() === 'error' }}>
          {saveMessage()}
        </div>
      )}

      <div id="settingsBody">
        <Section title="Output">
          <Row label="Width (px)">
            <input type="number" step="1" value={config.output.width}
              onInput={(e) => setConfig('output', 'width', toNumber(e.currentTarget.value, config.output.width))} />
          </Row>
          <Row label="Height (px)">
            <input type="number" step="1" value={config.output.height}
              onInput={(e) => setConfig('output', 'height', toNumber(e.currentTarget.value, config.output.height))} />
          </Row>
          <Row label="FPS">
            <input type="number" step="1" value={config.output.fps}
              onInput={(e) => setConfig('output', 'fps', toNumber(e.currentTarget.value, config.output.fps))} />
          </Row>
          <Row label="Duration (s, blank = auto)">
            <input type="number" step="0.1" value={config.output.duration ?? ''} placeholder="auto"
              onInput={(e) => setConfig('output', 'duration', toNullableNumber(e.currentTarget.value))} />
          </Row>
        </Section>

        <Section title="Colors">
          <Row label="Text">
            <div class="colorRow">
              <span class="colorSwatch" style={{ background: config.colors.text }} />
              <input type="text" value={config.colors.text}
                onInput={(e) => setConfig('colors', 'text', e.currentTarget.value)} />
            </div>
          </Row>
          <Row label="Background">
            <div class="colorRow">
              <span class="colorSwatch" style={{ background: config.colors.background }} />
              <input type="text" value={config.colors.background}
                onInput={(e) => setConfig('colors', 'background', e.currentTarget.value)} />
            </div>
          </Row>
        </Section>

        <Section title="Font">
          <Row label="Family">
            <input type="text" value={config.font.family} disabled title="Set via font.path in config.yaml — not editable here" />
          </Row>
          <Row label="Size (px)">
            <input type="number" step="1" value={config.font.size}
              onInput={(e) => setConfig('font', 'size', toNumber(e.currentTarget.value, config.font.size))} />
          </Row>
          <Row label="Weight">
            <select value={config.font.weight} onChange={(e) => setConfig('font', 'weight', e.currentTarget.value)}>
              <option value="normal">normal</option>
              <option value="bold">bold</option>
            </select>
          </Row>
          <Row label="Style">
            <select value={config.font.style} onChange={(e) => setConfig('font', 'style', e.currentTarget.value)}>
              <option value="normal">normal</option>
              <option value="italic">italic</option>
            </select>
          </Row>
        </Section>

        <Section title="Camera">
          <Row label="Anchor">
            <select value={config.camera.anchor} onChange={(e) => setConfig('camera', 'anchor', e.currentTarget.value)}>
              <option value="center">center</option>
              <option value="start">start</option>
            </select>
          </Row>
          <Row label="Jump duration (s)">
            <input type="number" step="0.01" min="0.01" value={config.camera.jumpDuration}
              onInput={(e) => setConfig('camera', 'jumpDuration', toNumber(e.currentTarget.value, config.camera.jumpDuration))} />
          </Row>
          <Row label="Easing">
            <select value={config.camera.easing} onChange={(e) => setConfig('camera', 'easing', e.currentTarget.value)}>
              <option value="easeOutBack">easeOutBack</option>
              <option value="spring">spring</option>
              <option value="linear">linear</option>
            </select>
          </Row>
          <Row label="Overshoot">
            <input type="number" step="0.1" value={config.camera.overshoot}
              onInput={(e) => setConfig('camera', 'overshoot', toNumber(e.currentTarget.value, config.camera.overshoot))} />
          </Row>
          <Row label="Zoom punch enabled">
            <input type="checkbox" checked={config.camera.zoom.enabled}
              onChange={(e) => setConfig('camera', 'zoom', 'enabled', e.currentTarget.checked)} />
          </Row>
          <Row label="Zoom amount (1 = none)">
            <input type="number" step="0.01" min="0.1" max="1" value={config.camera.zoom.amount}
              onInput={(e) => setConfig('camera', 'zoom', 'amount', toNumber(e.currentTarget.value, config.camera.zoom.amount))} />
          </Row>
          <Row label="Zoom out fraction">
            <input type="number" step="0.05" min="0.05" max="0.9" value={config.camera.zoom.outFraction}
              onInput={(e) => setConfig('camera', 'zoom', 'outFraction', toNumber(e.currentTarget.value, config.camera.zoom.outFraction))} />
          </Row>
        </Section>

        <Section title="Word timing">
          <Row label="Split mode">
            <select value={config.word.splitMode} onChange={(e) => setConfig('word', 'splitMode', e.currentTarget.value)}>
              <option value="line">line</option>
              <option value="karaoke">karaoke</option>
              <option value="char-weighted">char-weighted</option>
            </select>
          </Row>
        </Section>

        <Section title="Layout">
          <Row label="Word gap (px)">
            <input type="number" step="1" value={config.layout.wordGap}
              onInput={(e) => setConfig('layout', 'wordGap', toNumber(e.currentTarget.value, config.layout.wordGap))} />
          </Row>
          <Row label="Cue gap (px)">
            <input type="number" step="1" value={config.layout.cueGap}
              onInput={(e) => setConfig('layout', 'cueGap', toNumber(e.currentTarget.value, config.layout.cueGap))} />
          </Row>
        </Section>

        <Section title="Line opacity">
          <Row label="Active">
            <input type="number" step="0.05" min="0" max="1" value={config.style.activeOpacity}
              onInput={(e) => setConfig('style', 'activeOpacity', toNumber(e.currentTarget.value, config.style.activeOpacity))} />
          </Row>
          <Row label="Inactive">
            <input type="number" step="0.05" min="0" max="1" value={config.style.inactiveOpacity}
              onInput={(e) => setConfig('style', 'inactiveOpacity', toNumber(e.currentTarget.value, config.style.inactiveOpacity))} />
          </Row>
        </Section>

        <Section title="Timeline">
          <Row label="BPM (blank = off)">
            <input type="number" step="1" min="1" value={config.timeline.bpm ?? ''} placeholder="—"
              onInput={(e) => setConfig('timeline', 'bpm', toNullableNumber(e.currentTarget.value))} />
          </Row>
          <Row label="Beats per bar">
            <input type="number" step="1" min="1" value={config.timeline.beatsPerBar}
              onInput={(e) => setConfig('timeline', 'beatsPerBar', toNumber(e.currentTarget.value, config.timeline.beatsPerBar))} />
          </Row>
          <Row label="Grid offset (s)">
            <input type="number" step="0.01" value={config.timeline.gridOffset}
              onInput={(e) => setConfig('timeline', 'gridOffset', toNumber(e.currentTarget.value, config.timeline.gridOffset))} />
          </Row>
        </Section>

        <p class="settingsNote">
          Subtitle/audio/font file paths aren't editable here — change them in
          config.yaml directly. Saving rewrites config.yaml without comments.
        </p>
      </div>
    </aside>
  );
}
