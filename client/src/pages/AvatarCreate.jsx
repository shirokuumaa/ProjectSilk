// client/src/pages/AvatarCreate.jsx
// ФИНАЛЬНАЯ ВЕРСИЯ: Шаг 2 (обмеры) → прямо в Гардероб
// Шаги 1 (фото) и 3 (генерация) заморожены — нужны GPU

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveBodyProfile, loadBodyProfile } from '../utils/bodyProfileApi';
import MeasurementsPreview from '../components/MeasurementsPreview';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') =>
  (s && s.startsWith('/uploads') ? `${API_BASE}${s}` : s);

const ANGLES = [
  { key: 'front', label: 'Front (A-pose)', required: true },
  { key: 'back', label: 'Back', required: true },
  { key: 'left', label: 'Left', required: true },
  { key: 'right', label: 'Right', required: true },
  { key: 'diagL', label: '45° Left', required: false },
  { key: 'diagR', label: '45° Right', required: false },
  { key: 'face', label: 'Face close-up', required: false },
];

const card = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
};
const input = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
};
const note = { color: '#6b7280', fontSize: 13 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dataURLtoFile(dataUrl, filename = 'image.jpg') {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(body);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], { type: mime, name: filename });
}

function analyzeImageData(id) {
  const { data, width, height } = id;
  const N = width * height;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum +=
      0.2126 * data[i] +
      0.7152 * data[i + 1] +
      0.0722 * data[i + 2];
  }
  const mean = sum / N;
  let varsum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y =
      0.2126 * data[i] +
      0.7152 * data[i + 1] +
      0.0722 * data[i + 2];
    varsum += (y - mean) ** 2;
  }
  const std = Math.sqrt(varsum / N);
  const score =
    (mean >= 60 && mean <= 200 ? 1 : 0) + (std >= 30 ? 1 : 0);
  return {
    level: score === 2 ? 'good' : score === 1 ? 'ok' : 'bad',
    mean,
    std,
  };
}

export default function AvatarCreate() {
  const nav = useNavigate();

  const [aiMode, setAiMode] = useState('off');
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch(
          `${API_BASE}/api/ai/__target`
        ).then((r) => r.json());
        setAiMode(String(j?.AI_MODE || 'off').toLowerCase());
      } catch {
        setAiMode('off');
      }
    })();
  }, []);

  const [step, setStep] = useState(1);
  const [shots, setShots] = useState({});
  const [activeKey, setActiveKey] = useState('front');
  const [turnFrames, setTurnFrames] = useState([]);
  const turnFileRef = useRef(null);

  const [m, setM] = useState({
    heightCm: 170,
    chest: '',
    waist: '',
    hips: '',
    shoulders: '',
    inseam: '',
    shoe: '',
    bodyType: 'regular',
    skinTone: '#f1c27d',
    hair: 'straight_mid',
    style: 'realistic',
  });

  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await loadBodyProfile();
      if (!saved) return;
      setM((prev) => ({
        ...prev,
        heightCm: saved.heightCm ?? prev.heightCm,
        chest: saved.chest ?? prev.chest,
        waist: saved.waist ?? prev.waist,
        hips: saved.hips ?? prev.hips,
        shoulders: saved.shoulderWidth ?? prev.shoulders,
        inseam: saved.inseam ?? prev.inseam,
        skinTone: saved.skinTone ?? prev.skinTone,
        hair: saved.hairStyle ?? prev.hair,
      }));
    })();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('avatarDraft');
      if (raw) {
        const d = JSON.parse(raw);
        if (d.shots) setShots(d.shots);
        if (d.m) setM(d.m);
        if (d.step) setStep(d.step);
        if (d.activeKey) setActiveKey(d.activeKey);
        if (d.turnFrames) setTurnFrames(d.turnFrames);
      }
    } catch {
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(
        'avatarDraft',
        JSON.stringify({ shots, m, step, activeKey, turnFrames })
      );
    } catch {
    }
  }, [draftLoaded, shots, m, step, activeKey, turnFrames]);

  const clearDraft = () => {
    try {
      localStorage.removeItem('avatarDraft');
    } catch {}
    setShots({});
    setTurnFrames([]);
    setStep(1);
    setActiveKey('front');
  };

  const [useCamera, setUseCamera] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [quality, setQuality] = useState('bad');

  useEffect(() => {
    let stop = false;
    const start = async () => {
      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        if (stop) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const tick = () => {
          if (!videoRef.current || stop) return;
          const v = videoRef.current;
          if (v.videoWidth > 0 && v.videoHeight > 0) {
            const cw = Math.floor(v.videoWidth * 0.5);
            const ch = Math.floor(v.videoHeight * 0.7);
            const sx = Math.floor((v.videoWidth - cw) / 2);
            const sy = Math.floor((v.videoHeight - ch) / 2);
            const c = document.createElement('canvas');
            c.width = cw;
            c.height = ch;
            const ctx = c.getContext('2d');
            ctx.drawImage(v, sx, sy, cw, ch, 0, 0, cw, ch);
            const id = ctx.getImageData(0, 0, cw, ch);
            setQuality(analyzeImageData(id).level);
          }
          if (!stop) setTimeout(tick, 600);
        };
        tick();
      } catch {
        alert('Камера недоступна. Используй загрузку фото.');
        setUseCamera(false);
      }
    };
    if (useCamera) start();
    return () => {
      stop = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [useCamera]);

  const captureFromCamera = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    setShots((prev) => ({
      ...prev,
      [activeKey]: { dataUrl },
    }));
  };

  const onPickFile = () => fileRef.current?.click();

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) =>
      setShots((prev) => ({
        ...prev,
        [activeKey]: {
          dataUrl: ev.target.result,
          file: f,
        },
      }));
    r.readAsDataURL(f);
    e.target.value = '';
  };

  const removeShot = (key) =>
    setShots((prev) => {
      const nx = { ...prev };
      delete nx[key];
      return nx;
    });

  const haveRequired = useMemo(
    () =>
      ANGLES.filter((a) => a.required).every(
        (a) => !!shots[a.key]
      ),
    [shots]
  );
  const providedCount = Object.keys(shots).length;

  const onPickVideo = () => turnFileRef.current?.click();

  const onVideoFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.playsInline = true;
      await new Promise((res) => {
        v.onloadedmetadata = res;
      });
      const duration = v.duration || 12;
      const count = Math.min(
        20,
        Math.max(12, Math.round(duration))
      );
      const step = duration / count;
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      const frames = [];
      for (let i = 0; i < count; i++) {
        v.currentTime = Math.min(
          duration - 0.05,
          i * step
        );
        await new Promise((res) => (v.onseeked = res));
        ctx.drawImage(v, 0, 0);
        frames.push({
          dataUrl: c.toDataURL('image/jpeg', 0.9),
          t: v.currentTime,
        });
        await sleep(20);
      }
      setTurnFrames(frames);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const autoFillFromTurn = () => {
    if (!turnFrames.length) return;
    const pick = (r) =>
      turnFrames[
        Math.min(
          turnFrames.length - 1,
          Math.max(
            0,
            Math.round(
              (turnFrames.length - 1) * r
            )
          )
        )
      ];
    setShots((prev) => ({
      ...prev,
      front: { dataUrl: pick(0.0)?.dataUrl },
      right: { dataUrl: pick(0.25)?.dataUrl },
      back: { dataUrl: pick(0.5)?.dataUrl },
      left: { dataUrl: pick(0.75)?.dataUrl },
    }));
  };

  const [estimBusy, setEstimBusy] = useState(false);

  const estimateFromPhotos = async () => {
    setEstimBusy(true);
    try {
      if (aiMode === 'off') {
        const h = Number(m.heightCm) || 170;
        const k =
          m.bodyType === 'slim'
            ? 0.92
            : m.bodyType === 'curvy'
            ? 1.08
            : 1.0;
        setM((prev) => ({
          ...prev,
          chest: Math.round(h * 0.53 * k),
          waist: Math.round(h * 0.38 * k),
          hips: Math.round(h * 0.55 * k),
          shoulders: Math.round(h * 0.24 * k),
          inseam: Math.round(h * 0.46),
        }));
        alert(
          'Stub-оценка от роста/типа тела. С GPU заменим на фотометрическую оценку.'
        );
      } else {
        alert(
          'GPU-роут ещё не подключён — пока используем stub.'
        );
      }
    } finally {
      setEstimBusy(false);
    }
  };

  const frameColor =
    quality === 'good'
      ? '#10B981'
      : quality === 'ok'
      ? '#F59E0B'
      : '#EF4444';

  return (
    <div
      style={{ padding: 24, display: 'grid', gap: 16 }}
    >
      <h2>🧍 Create Your Body Profile</h2>

      {/* STEPPER */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          'Photos (optional)',
          'Your Measurements',
        ].map((t, i) => (
          <div
            key={t}
            style={{
              padding: '6px 10px',
              border: '1px solid #e5e7eb',
              borderRadius: 999,
              background:
                step === i + 1 ? '#111827' : '#fff',
              color:
                step === i + 1 ? '#fff' : '#111827',
            }}
          >
            {i + 1}. {t}
          </div>
        ))}
      </div>

      {/* STEP 1 — PHOTOS (OPTIONAL) */}
      {step === 1 && (
        <section style={card}>
          <h3>Step 1 · Photos (Optional)</h3>
          <p style={note}>
            ℹ️ Фото нужны только если хочешь узнать свои обмеры автоматически.
            Можешь их пропустить и ввести обмеры вручную на Шаге 2.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
              margin: '8px 0 16px',
            }}
          >
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <input
                type="checkbox"
                checked={useCamera}
                onChange={(e) =>
                  setUseCamera(e.target.checked)
                }
              />
              Use camera
            </label>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(e) =>
                  setShowGuides(e.target.checked)
                }
                disabled={!useCamera}
              />
              Guides overlay
            </label>
            <button
              onClick={onPickFile}
              disabled={useCamera}
            >
              Upload photo
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              style={{ display: 'none' }}
            />
            <span style={note}>
              Ракурс:{' '}
              <strong>
                {
                  ANGLES.find(
                    (a) => a.key === activeKey
                  )?.label
                }
              </strong>
            </span>
          </div>

          {/* Грид ракурсов */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fill, minmax(170px,1fr))',
              gap: 12,
            }}
          >
            {ANGLES.map((a) => {
              const shot = shots[a.key];
              const active = activeKey === a.key;
              return (
                <div
                  key={a.key}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: 10,
                    background: '#fff',
                  }}
                >
                  <strong>{a.label}</strong>
                  <div
                    onClick={() => setActiveKey(a.key)}
                    style={{
                      cursor: 'pointer',
                      height: 180,
                      border:
                        '1px dashed #d1d5db',
                      borderRadius: 8,
                      display: 'grid',
                      placeItems: 'center',
                      overflow: 'hidden',
                      outline: active
                        ? '2px solid #111827'
                        : 'none',
                      marginTop: 8,
                    }}
                  >
                    {shot ? (
                      <img
                        src={shot.dataUrl}
                        alt={a.label}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <span style={note}>
                        No photo
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    {useCamera ? (
                      <button
                        onClick={captureFromCamera}
                      >
                        Capture
                      </button>
                    ) : (
                      <button onClick={onPickFile}>
                        Upload
                      </button>
                    )}
                    {shot && (
                      <button
                        onClick={() =>
                          removeShot(a.key)
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {useCamera && (
            <div
              style={{
                marginTop: 16,
                position: 'relative',
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{
                  width: '100%',
                  maxHeight: 420,
                  background: '#000',
                  borderRadius: 12,
                  border: `3px solid ${frameColor}`,
                }}
              />
              {showGuides && (
                <div
                  aria-hidden
                  style={{
                    pointerEvents: 'none',
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 100 56"
                    style={{
                      position: 'absolute',
                      inset: 0,
                    }}
                  >
                    <rect
                      x="30"
                      y="4"
                      width="40"
                      height="48"
                      fill="none"
                      stroke={frameColor}
                      strokeWidth="0.8"
                      strokeDasharray="2 2"
                      rx="2"
                    />
                    <path
                      d="M50 10 C48 10,46 12,46 14 L46 22 L40 26 L38 24 L35 25 L39 30 L46 26 L46 34 L42 44 L44 46 L50 40 L56 46 L58 44 L54 34 L54 26 L61 30 L65 25 L62 24 L60 26 L54 22 L54 14 C54 12,52 10,50 10 Z"
                      fill="none"
                      stroke="#ffffffaa"
                      strokeWidth="0.7"
                    />
                  </svg>
                </div>
              )}
              <div
                style={{
                  ...note,
                  marginTop: 8,
                }}
              >
                Frame quality:{' '}
                <strong style={{ color: frameColor }}>
                  {quality.toUpperCase()}
                </strong>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <h4>Turnaround video (optional)</h4>
            <p style={note}>
              Загрузите 10–15 сек видео
            </p>
            <button onClick={onPickVideo}>
              Upload video
            </button>
            <input
              ref={turnFileRef}
              type="file"
              accept="video/*"
              onChange={onVideoFile}
              style={{ display: 'none' }}
            />
            {turnFrames.length > 0 && (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(120px,1fr))',
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {turnFrames.map((fr, i) => (
                    <img
                      key={i}
                      src={fr.dataUrl}
                      alt={`frame ${i}`}
                      style={{
                        width: '100%',
                        height: 100,
                        objectFit: 'cover',
                        borderRadius: 6,
                        border:
                          '1px solid #e5e7eb',
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <button onClick={autoFillFromTurn}>
                    Auto-fill from video
                  </button>
                  <button
                    onClick={() => setTurnFrames([])}
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <button onClick={clearDraft}>
              Clear draft
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setStep(2)}>
              Next: Measurements ▶️
            </button>
          </div>
        </section>
      )}

      {/* STEP 2 — MEASUREMENTS (REQUIRED) */}
      {step === 2 && (
        <section style={card}>
          <h3>Step 2 · Your Measurements</h3>
          <p style={note}>
            ✅ Главное: введи обмеры и нажми "Сохранить обмеры" → твоё тело готово!
          </p>
          <div
            style={{
              display: 'grid',
              gap: 12,
              maxWidth: 820,
              gridTemplateColumns:
                'repeat(auto-fit, minmax(220px,1fr))',
            }}
          >
            <label>
              Height (cm) <span style={{ color: 'red' }}>*</span>
              <input
                type="number"
                min="120"
                max="230"
                value={m.heightCm}
                onChange={(e) =>
                  setM({
                    ...m,
                    heightCm: Number(e.target.value),
                  })
                }
                style={input}
              />
            </label>
            <label>
              Chest / Bust (cm) <span style={{ color: 'red' }}>*</span>
              <input
                type="number"
                value={m.chest}
                onChange={(e) =>
                  setM({
                    ...m,
                    chest: e.target.value,
                  })
                }
                style={input}
              />
            </label>
            <label>
              Waist (cm) <span style={{ color: 'red' }}>*</span>
              <input
                type="number"
                value={m.waist}
                onChange={(e) =>
                  setM({
                    ...m,
                    waist: e.target.value,
                  })
                }
                style={input}
              />
            </label>
            <label>
              Hips (cm) <span style={{ color: 'red' }}>*</span>
              <input
                type="number"
                value={m.hips}
                onChange={(e) =>
                  setM({
                    ...m,
                    hips: e.target.value,
                  })
                }
                style={input}
              />
            </label>
            <label>
              Shoulder width (cm)
              <input
                type="number"
                value={m.shoulders}
                onChange={(e) =>
                  setM({
                    ...m,
                    shoulders: e.target.value,
                  })
                }
                style={input}
              />
            </label>
            <label>
              Inseam (cm)
              <input
                type="number"
                value={m.inseam}
                onChange={(e) =>
                  setM({
                    ...m,
                    inseam: e.target.value,
                  })
                }
                style={input}
              />
            </label>
            <label>
              Shoe size
              <input
                type="text"
                value={m.shoe}
                onChange={(e) =>
                  setM({
                    ...m,
                    shoe: e.target.value,
                  })
                }
                style={input}
              />
            </label>
            <label>
              Body type
              <select
                value={m.bodyType}
                onChange={(e) =>
                  setM({
                    ...m,
                    bodyType: e.target.value,
                  })
                }
                style={input}
              >
                <option value="slim">Slim</option>
                <option value="regular">Regular</option>
                <option value="curvy">Curvy</option>
              </select>
            </label>
            <label>
              Skin tone
              <input
                type="color"
                value={m.skinTone}
                onChange={(e) =>
                  setM({
                    ...m,
                    skinTone: e.target.value,
                  })
                }
                style={{ ...input, height: 40 }}
              />
            </label>
            <label>
              Hair
              <select
                value={m.hair}
                onChange={(e) =>
                  setM({
                    ...m,
                    hair: e.target.value,
                  })
                }
                style={input}
              >
                <option value="straight_short">
                  Straight short
                </option>
                <option value="straight_mid">
                  Straight mid
                </option>
                <option value="wavy_long">
                  Wavy long
                </option>
                <option value="curly">Curly</option>
              </select>
            </label>
          </div>

          <div
            style={{
              marginTop: 12,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={estimateFromPhotos}
              disabled={estimBusy}
            >
              {estimBusy
                ? 'Estimating…'
                : 'Auto-estimate from photos'}
            </button>
            <span style={note}>
              (Если загрузил фото на Шаге 1)
            </span>
          </div>

          {/* Живой предпросмотр тела */}
          <MeasurementsPreview m={m} onSaved={() => nav('/wardrobe')} />

          <div style={{ marginTop: 16 }}>
            <button onClick={() => setStep(1)}>
              ◀️ Back to photos
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

