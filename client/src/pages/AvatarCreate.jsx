// client/src/pages/AvatarCreate.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// базовый адрес API (для абсолютных URL к /uploads и проверки OFF/PROXY)
const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') =>
  (s && s.startsWith('/uploads') ? `${API_BASE}${s}` : s);

// Набор ракурсов
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

// ───────── utils ─────────
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

  // AI режим (off/proxy/gpu...)
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

  // Шаги: 1 — Capture/Upload, 2 — Measurements, 3 — Review/Generate
  const [step, setStep] = useState(1);

  // Фото по ракурсам: { [key]: { dataUrl, file? } }
  const [shots, setShots] = useState({});
  const [activeKey, setActiveKey] = useState('front');

  // Turnaround video → кадры
  const [turnFrames, setTurnFrames] = useState([]); // [{dataUrl, t}]
  const turnFileRef = useRef(null);

  // Черновик измерений
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

  // Флаг, что мы уже один раз прочитали черновик
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Загрузка из localStorage один раз
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
      // если ошибка парсинга — просто начинаем с нуля
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  // Сохранение в avatarDraft — только после загрузки
  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(
        'avatarDraft',
        JSON.stringify({ shots, m, step, activeKey, turnFrames })
      );
    } catch {
      /* ignore overflow */
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

  // Камера + контур-гайд
  const [useCamera, setUseCamera] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [quality, setQuality] = useState('bad'); // bad|ok|good

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

  // Turnaround video → извлечение кадров
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

  // авто-оценка мерок
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
        // TODO: когда появится /measure/estimate
        alert(
          'GPU-роут ещё не подключён — пока используем stub.'
        );
      }
    } finally {
      setEstimBusy(false);
    }
  };

  // Генерация
  const [job, setJob] = useState(null); // {id, status, previewUrl, glbUrl, message}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const startGeneration = async () => {
    if (!haveRequired && !turnFrames.length) {
      alert(
        'Добавь обязательные ракурсы или загрузи turnaround-видео.'
      );
      return;
    }

    const firstKey = ANGLES.find(
      (a) => shots[a.key]
    )?.key;
    const dataUrlFallback = firstKey
      ? shots[firstKey].dataUrl
      : turnFrames[0]?.dataUrl || null;
    if (!dataUrlFallback) {
      alert('Нет фото для запуска.');
      return;
    }

    try {
      setBusy(true);
      setMsg('Uploading…');

      const fd = new FormData();
      if (aiMode === 'off') {
        fd.append(
          'photo',
          dataURLtoFile(dataUrlFallback, 'avatar.jpg')
        );
      } else {
        ANGLES.forEach((a) => {
          const d = shots[a.key]?.dataUrl;
          if (d)
            fd.append(
              'photos[]',
              dataURLtoFile(d, `${a.key}.jpg`)
            );
        });
        const N = Math.min(12, turnFrames.length);
        for (let i = 0; i < N; i++) {
          const idx = Math.round(
            (turnFrames.length - 1) * (i / (N - 1))
          );
          fd.append(
            'photos[]',
            dataURLtoFile(
              turnFrames[idx].dataUrl,
              `turn_${i}.jpg`
            )
          );
        }
      }
      Object.entries(m).forEach(([k, v]) =>
        fd.append(k, String(v))
      );

      const start = await fetch(
        `${API_BASE}/api/ai/avatar/start`,
        { method: 'POST', body: fd }
      )
        .then((r) => r.json())
        .catch(() => ({}));
      const jobId =
        start.jobId || start.job_id || start.id;
      if (!jobId) {
        alert('Не удалось запустить генерацию');
        setBusy(false);
        return;
      }
      setJob({ id: jobId, status: 'queued' });
      setStep(3);

      let finished = false;
      for (let i = 0; i < 90; i++) {
        await sleep(2000);
        const st = await fetch(
          `${API_BASE}/api/ai/avatar/status/${encodeURIComponent(
            jobId
          )}`
        )
          .then((r) => r.json())
          .catch(() => ({}));
        const preview =
          st.previewUrl ||
          st.preview_url ||
          st.preview ||
          null;
        const glb =
          st.glbUrl || st.glb_url || st.glb || null;
        const status = st.status || 'processing';
        const prog =
          typeof st.progress === 'number'
            ? st.progress
            : null;
        if (prog != null)
          setMsg(`Generating… ${Math.round(prog * 100)}%`);
        setJob((prev) => ({
          ...(prev || {}),
          status,
          previewUrl: preview
            ? toPublicUrl(preview)
            : prev?.previewUrl || null,
          glbUrl: glb
            ? toPublicUrl(glb)
            : prev?.glbUrl || null,
          message: st.message,
        }));
        if (status === 'error') {
          setBusy(false);
          setMsg('Error');
          finished = true;
          break;
        }
        if (status === 'done') {
          setBusy(false);
          setMsg('Done');
          finished = true;
          break;
        }
      }
      if (!finished) {
        setBusy(false);
        setMsg(
          'Timed out — проверь позже в истории задач.'
        );
      }
    } catch (e) {
      console.error(e);
      alert('Avatar generation error');
      setBusy(false);
      setMsg('');
    }
  };

  const openViewer = () => {
    if (job?.glbUrl)
      window.open(
        `/viewer?src=${encodeURIComponent(job.glbUrl)}`,
        '_blank',
        'noopener,noreferrer'
      );
  };

  // 💾 Сохранение финального аватара и переход на Try-On Avatar
  const saveAvatarAndOpenTryOn = () => {
    if (job?.status !== 'done' || !job.glbUrl) return;

    const firstByAngles = ANGLES.map(
      (a) => shots[a.key]?.dataUrl
    ).find(Boolean);
    const preview =
      job.previewUrl ||
      firstByAngles ||
      turnFrames[0]?.dataUrl ||
      '';

    const avatarFinal = {
      id: `avatar-${Date.now()}`,
      name: 'My Avatar',
      preview,
      glb: job.glbUrl,
      createdAt: Date.now(),
    };

    try {
      // для TryOnAvatar (3D)
      localStorage.setItem(
        'avatarFinal',
        JSON.stringify(avatarFinal)
      );

      // опционально: положим и в гардероб, чтобы можно было использовать как item
      localStorage.setItem(
        'wardrobeAvatar',
        JSON.stringify({
          id: avatarFinal.id,
          name: avatarFinal.name,
          image: avatarFinal.preview,
          model3d: avatarFinal.glb,
          addedAt: avatarFinal.createdAt,
        })
      );
    } catch {
      /* ignore quota errors */
    }

    alert('Аватар сохранён. Открываю Avatar Try-On.');
    nav('/tryon/avatar');
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
      <h2>🧍 Generate Avatar</h2>

      {/* STEPPER */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          'Capture/Upload',
          'Measurements',
          'Review/Generate',
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

      {/* STEP 1 */}
      {step === 1 && (
        <section style={card}>
          <h3>Step 1 · Capture / Upload</h3>
          <p style={note}>
            Лучшие результаты: однотонный фон, ровный свет,
            A-pose, камера 2–3 м. AI mode:{' '}
            <strong>{aiMode.toUpperCase()}</strong>
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
            <span
              style={{
                ...note,
                marginLeft: 8,
              }}
            >
              Active angle:{' '}
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
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <strong>{a.label}</strong>
                    {a.required && (
                      <span
                        style={{
                          ...note,
                          fontSize: 12,
                        }}
                      >
                        required
                      </span>
                    )}
                  </div>
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

          {/* Камера с контур-гайдом */}
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

          {/* Turnaround видео */}
          <div style={{ marginTop: 24 }}>
            <h4
              style={{
                margin: '0 0 8px',
              }}
            >
              Turnaround video (optional)
            </h4>
            <p style={note}>
              Загрузите 10–15 секунд видео —
              извлечём ~12–20 кадров.
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
                    Auto-fill required from
                    turnaround
                  </button>
                  <button
                    onClick={() => setTurnFrames([])}
                  >
                    Clear video frames
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
            <button
              disabled={!haveRequired && !turnFrames.length}
              onClick={() => setStep(2)}
            >
              Next: Measurements ▶️
            </button>
          </div>
        </section>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <section style={card}>
          <h3>Step 2 · Measurements</h3>
          <p style={note}>
            Рост обязателен для масштаба. Остальные
            мерки улучшают посадку одежды.
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
              Height (cm)
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
              Chest / Bust (cm)
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
              Waist (cm)
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
              Hips (cm)
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
            <label>
              Style
              <select
                value={m.style}
                onChange={(e) =>
                  setM({
                    ...m,
                    style: e.target.value,
                  })
                }
                style={input}
              >
                <option value="realistic">
                  Realistic
                </option>
                <option value="cartoon">
                  Cartoon
                </option>
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
              В AI-OFF это заглушка; с GPU пойдём по
              keypoints+depth.
            </span>
          </div>

          <div style={{ marginTop: 16 }}>
            <button onClick={() => setStep(1)}>
              ◀️ Back
            </button>{' '}
            <button onClick={() => setStep(3)}>
              Next: Review ▶️
            </button>
          </div>
        </section>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <section style={card}>
          <h3>Step 3 · Review & Generate</h3>
          <p style={note}>
            Photos:{' '}
            <strong>{providedCount}</strong>{' '}
            {ANGLES.filter((a) => shots[a.key])
              .map((a) => a.label)
              .join(', ') || '—'}
            {turnFrames.length
              ? ` · Turnaround frames: ${turnFrames.length}`
              : ''}
          </p>

          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            {ANGLES.filter((a) => shots[a.key]).map(
              (a) => (
                <img
                  key={a.key}
                  src={shots[a.key].dataUrl}
                  alt={a.key}
                  style={{
                    height: 120,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                  }}
                />
              )
            )}
            {turnFrames.slice(0, 6).map((fr, i) => (
              <img
                key={`t${i}`}
                src={fr.dataUrl}
                alt={`t${i}`}
                style={{
                  height: 120,
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                }}
              />
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <button onClick={() => setStep(2)}>
              ◀️ Back
            </button>{' '}
            <button
              onClick={startGeneration}
              disabled={busy}
            >
              Start generation ▶️
            </button>
          </div>

          {busy && (
            <p style={{ marginTop: 8 }}>
              ⏳ {msg || 'Working…'}
            </p>
          )}

          {job?.status === 'done' && (
            <div
              style={{
                marginTop: 16,
                display: 'grid',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {job.previewUrl ? (
                  <img
                    src={job.previewUrl}
                    alt="avatar"
                    style={{
                      height: 180,
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      height: 180,
                      width: 180,
                      display: 'grid',
                      placeItems: 'center',
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      color: '#6b7280',
                    }}
                  >
                    Avatar Preview
                  </div>
                )}
                <div>
                  <div>
                    <strong>GLB:</strong>{' '}
                    {job.glbUrl ? (
                      <a
                        href={job.glbUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {job.glbUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
              <div>
                <button
                  disabled={!job.glbUrl}
                  onClick={openViewer}
                >
                  Open 3D Viewer
                </button>{' '}
                <button
                  disabled={!job.glbUrl}
                  onClick={saveAvatarAndOpenTryOn}
                >
                  Save avatar & open Try-On Avatar
                </button>{' '}
                <button
                  onClick={() => nav('/wardrobe')}
                >
                  Back to Wardrobe
                </button>
              </div>
            </div>
          )}

          {job?.status === 'error' && (
            <p>
              ❌{' '}
              {job.message ||
                'Generation failed. Try other photos.'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}