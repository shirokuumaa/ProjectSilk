// client/src/components/MeasurementsPreview.jsx
//
// Живой предпросмотр тела при вводе обмеров + сохранение профиля.
// Тело меняется сразу при изменении цифр — генерация не нужна.
//
// Использование в AvatarCreate (шаг 2):
//   <MeasurementsPreview m={m} onSaved={() => nav('/wardrobe')} />

import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import AvatarBody from './AvatarBody';
import BodyStage from './BodyStage';
import { saveBodyProfile } from '../utils/bodyProfileApi';

export default function MeasurementsPreview({ m, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  // приводим форму AvatarCreate к формату профиля
  const profile = {
    heightCm: Number(m.heightCm) || 170,
    chest: Number(m.chest) || undefined,
    waist: Number(m.waist) || undefined,
    hips: Number(m.hips) || undefined,
    shoulderWidth: Number(m.shoulders) || undefined,
    inseam: Number(m.inseam) || undefined,
    armLength: Number(m.armLength) || undefined,
    skinTone: m.skinTone,
  };

  const filled = ['chest', 'waist', 'hips'].filter((k) => profile[k] != null).length;
  const complete = filled === 3;

  const camY = (profile.heightCm / 100) * 0.5;

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await saveBodyProfile(m);
      if (res?.incomplete) {
        setStatus({
          ok: false,
          text: `Missing measurements: ${res.missing.join(', ')}`,
        });
      } else if (res) {
        setStatus({ ok: true, text: 'Measurements saved' });
        if (typeof onSaved === 'function') setTimeout(onSaved, 700);
      } else {
        setStatus({
          ok: false,
          text: 'Could not save. Make sure you are signed in.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.viewer}>
        <Canvas camera={{ position: [0, camY, 3.0], fov: 42, near: 0.1, far: 100 }}>
          <color attach="background" args={['#f9fafb']} />
          <BodyStage />
          <AvatarBody profile={profile} />
          <gridHelper args={[3, 12, '#e5e7eb', '#f3f4f6']} />
          <OrbitControls
            target={[0, camY, 0]}
            enablePan={false}
            minDistance={1.2}
            maxDistance={5}
          />
        </Canvas>
      </div>

      <div style={s.side}>
        <div style={s.title}>Your body</div>

        <p style={s.note}>
          {profile.chest
            ? `The body is built from your measurements: a ${profile.chest} cm bust gives a body with that bust, to within about a centimetre. Change the numbers and the figure updates at once.`
            : 'The body is built from your measurements. Enter your height, bust, waist and hips, and the figure updates as you type.'}
        </p>

        <div style={s.rows}>
          <Row label="Height" value={profile.heightCm} unit="cm" />
          <Row label="Bust" value={profile.chest} unit="cm" />
          <Row label="Waist" value={profile.waist} unit="cm" />
          <Row label="Hips" value={profile.hips} unit="cm" />
        </div>

        {!complete && (
          <div style={s.warn}>
            Size advice needs all three girths: bust, waist and hips.
            Missing ones are estimated from your height, so the figure is approximate.
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...s.saveBtn,
            background: complete ? '#111827' : '#6b7280',
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save measurements'}
        </button>

        {status && (
          <div style={{ ...s.status, color: status.ok ? '#2f9e44' : '#c92a2a' }}>
            {status.text}
          </div>
        )}

        <p style={s.hint}>
          Measurements are saved as numbers, not as a 3D file, so they load
          instantly and work on any device.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, unit }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <span style={{ ...s.rowValue, color: value ? '#111827' : '#c1c7cf' }}>
        {value ? `${value} ${unit}` : 'not set'}
      </span>
    </div>
  );
}

const s = {
  wrap: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)',
    gap: 20,
    marginTop: 20,
    alignItems: 'start',
  },
  viewer: {
    height: 420,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  side: { display: 'flex', flexDirection: 'column', gap: 12 },
  title: { fontWeight: 600, fontSize: 16 },
  note: { fontSize: 13, color: '#6b7280', lineHeight: 1.6, margin: 0 },
  rows: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: {
    display: 'flex', justifyContent: 'space-between',
    padding: '7px 10px', background: '#f9fafb',
    borderRadius: 8, fontSize: 13,
  },
  rowLabel: { color: '#6b7280' },
  rowValue: { fontWeight: 500 },
  warn: {
    fontSize: 12, color: '#b35309', background: '#fff4e6',
    padding: '9px 11px', borderRadius: 8, lineHeight: 1.5,
  },
  saveBtn: {
    padding: '11px 16px', borderRadius: 10, border: 'none',
    color: '#fff', fontWeight: 600, fontSize: 14,
  },
  status: { fontSize: 13, fontWeight: 500 },
  hint: { fontSize: 12, color: '#9ca3af', lineHeight: 1.5, margin: 0 },
};
