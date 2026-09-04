// prototypes/veil-standard-pattern/PatternControls.jsx
// The control rail. Pure presentation - every change goes up through
// `onChange(key, value)`; this file holds no pattern state of its own.

import React from 'react';
import { LATTICES, MODULATIONS, SHAPES, LIMITS } from './pattern-core.js';
import { PRESETS } from './presets.js';

const row = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '5px 0',
};
const label = { fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.62 };
const val = {
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  opacity: 0.9,
  minWidth: 46,
  textAlign: 'right',
};
const groupTitle = {
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  opacity: 0.4,
  margin: '18px 0 6px',
};
const control = {
  width: '100%',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid rgba(128,128,128,.35)',
  borderRadius: 3,
  padding: '5px 6px',
  fontSize: 12,
};

export function Group({ title, children }) {
  return (
    <div>
      <div style={groupTitle}>{title}</div>
      {children}
    </div>
  );
}

export function Slider({ name, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <div style={{ padding: '3px 0' }}>
      <div style={row}>
        <span style={label}>{name}</span>
        <span style={val}>
          {typeof value === 'number' ? Number(value.toFixed(2)) : value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function Select({ name, value, options, onChange }) {
  return (
    <div style={row}>
      <span style={label}>{name}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...control, width: 140 }}
      >
        {options.map((o) => (
          <option
            key={typeof o === 'string' ? o : o.value}
            value={typeof o === 'string' ? o : o.value}
          >
            {typeof o === 'string' ? o : o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ name, value, onChange }) {
  return (
    <label style={{ ...row, cursor: 'pointer' }}>
      <span style={label}>{name}</span>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Stepper({ name, value, min, max, onChange }) {
  const btn = { ...control, width: 28, padding: '2px 0', textAlign: 'center', cursor: 'pointer' };
  return (
    <div style={row}>
      <span style={label}>{name}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={btn} onClick={() => onChange(Math.max(min, value - 1))}>
          -
        </button>
        <span style={{ ...val, minWidth: 22 }}>{value}</span>
        <button style={btn} onClick={() => onChange(Math.min(max, value + 1))}>
          +
        </button>
      </span>
    </div>
  );
}

/** Which extra controls each modulation actually uses. */
const USES = {
  uniform: [],
  linear: ['modAngle', 'gamma'],
  radial: ['centerX', 'centerY', 'gamma'],
  wave: ['modAngle', 'wavelength'],
  bands: ['modAngle', 'steps'],
  noise: ['wavelength', 'seed'],
  checker: ['steps'],
};

export default function PatternControls({ params, onChange, presetId, onPreset }) {
  const p = params;
  const uses = (k) => USES[p.modulation]?.includes(k);

  return (
    <div>
      <Group title="Preset">
        <Select
          name="standard"
          value={presetId || ''}
          options={[
            { value: '', label: 'Custom' },
            ...PRESETS.map((x) => ({ value: x.id, label: x.name })),
          ]}
          onChange={onPreset}
        />
        {presetId ? (
          <div style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.45, marginTop: 4 }}>
            {PRESETS.find((x) => x.id === presetId)?.note}
          </div>
        ) : null}
      </Group>

      <Group title="Run">
        <Stepper
          name="panels across"
          value={p.cols}
          min={1}
          max={24}
          onChange={(v) => onChange('cols', v)}
        />
        <Stepper
          name="panels high"
          value={p.rows}
          min={1}
          max={12}
          onChange={(v) => onChange('rows', v)}
        />
        <Slider
          name="reveal"
          value={p.gap}
          min={0}
          max={40}
          step={1}
          unit="mm"
          onChange={(v) => onChange('gap', v)}
        />
      </Group>

      <Group title="Lattice">
        <Select
          name="family"
          value={p.lattice}
          options={LATTICES}
          onChange={(v) => onChange('lattice', v)}
        />
        <Slider
          name="pitch"
          value={p.pitch}
          min={14}
          max={120}
          step={1}
          unit="mm"
          onChange={(v) => onChange('pitch', v)}
        />
        {p.lattice === 'brick' ? (
          <Slider
            name="row offset"
            value={p.staggerFrac}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange('staggerFrac', v)}
          />
        ) : null}
        <Slider
          name="rotation"
          value={p.latticeAngle}
          min={-90}
          max={90}
          step={1}
          unit="deg"
          onChange={(v) => onChange('latticeAngle', v)}
        />
        <Slider
          name="jitter"
          value={p.jitter}
          min={0}
          max={60}
          step={1}
          unit="%"
          onChange={(v) => onChange('jitter', v)}
        />
      </Group>

      <Group title="Perforation">
        <Select
          name="shape"
          value={p.shape}
          options={SHAPES}
          onChange={(v) => onChange('shape', v)}
        />
        <Slider
          name="min dia"
          value={p.minDia}
          min={LIMITS.minDia}
          max={LIMITS.maxDia}
          step={0.5}
          unit="mm"
          onChange={(v) => onChange('minDia', Math.min(v, p.maxDia))}
        />
        <Slider
          name="max dia"
          value={p.maxDia}
          min={LIMITS.minDia}
          max={LIMITS.maxDia}
          step={0.5}
          unit="mm"
          onChange={(v) => onChange('maxDia', Math.max(v, p.minDia))}
        />
      </Group>

      <Group title="Modulation">
        <Select
          name="driver"
          value={p.modulation}
          options={MODULATIONS}
          onChange={(v) => onChange('modulation', v)}
        />
        {uses('modAngle') ? (
          <Slider
            name="angle"
            value={p.modAngle}
            min={0}
            max={360}
            step={1}
            unit="deg"
            onChange={(v) => onChange('modAngle', v)}
          />
        ) : null}
        {uses('gamma') ? (
          <Slider
            name="gamma"
            value={p.gamma}
            min={0.2}
            max={3}
            step={0.05}
            onChange={(v) => onChange('gamma', v)}
          />
        ) : null}
        {uses('wavelength') ? (
          <Slider
            name="wavelength"
            value={p.wavelength}
            min={100}
            max={4000}
            step={25}
            unit="mm"
            onChange={(v) => onChange('wavelength', v)}
          />
        ) : null}
        {uses('steps') ? (
          <Slider
            name="steps"
            value={p.steps}
            min={2}
            max={12}
            step={1}
            onChange={(v) => onChange('steps', v)}
          />
        ) : null}
        {uses('seed') ? (
          <Slider
            name="seed"
            value={p.seed}
            min={1}
            max={999}
            step={1}
            onChange={(v) => onChange('seed', v)}
          />
        ) : null}
        {uses('centerX') ? (
          <>
            <Slider
              name="centre x"
              value={p.centerX}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onChange('centerX', v)}
            />
            <Slider
              name="centre y"
              value={p.centerY}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onChange('centerY', v)}
            />
          </>
        ) : null}
        {p.modulation === 'uniform' ? null : (
          <Toggle name="invert" value={p.invert} onChange={(v) => onChange('invert', v)} />
        )}
      </Group>

      <Group title="Fabrication">
        <Select
          name="edge rule"
          value={p.seamRule}
          options={[
            { value: 'shrink', label: 'shrink to fit' },
            { value: 'drop', label: 'drop hole' },
            { value: 'allow', label: 'allow overrun' },
          ]}
          onChange={(v) => onChange('seamRule', v)}
        />
        <Slider
          name="edge keep-out"
          value={p.edgeInset}
          min={0}
          max={60}
          step={1}
          unit="mm"
          onChange={(v) => onChange('edgeInset', v)}
        />
        <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.45, marginTop: 6 }}>
          Keep-out defaults to {LIMITS.bendClear}mm (BEND_SNAP_CLEAR) so no perforation lands in a
          fold radius. Holes under {LIMITS.minPerfArea}mm2 face area are never cut.
        </div>
      </Group>
    </div>
  );
}
