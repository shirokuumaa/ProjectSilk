// client/src/pages/AvatarCreateMode1Test.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

// ✅ публичный URL для:
// - /uploads/...  (Node напрямую)
// - /static/...   (FastAPI через Node proxy: /api/ai/static/...)
const toPublicUrl = (s = '') => {
  if (!s) return '';
  const str = String(s);
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('/uploads')) return `${API_BASE}${str}`;
  if (str.startsWith('/static')) return `${API_BASE}/api/ai${str}`;
  return str;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function AvatarCreateMode1Test() {
  const nav = useNavigate();

  // ✅ NEW: target (AI_MODE / GPU_URL / enabled)
  const [target, setTarget] = useState(null); // {AI_MODE, AI_ENABLED, GPU_URL}
  const [aiOnline, setAiOnline] = useState(null); // null|true|false (для UI)
  const [features, setFeatures] = useState(null);
  const [hint, setHint] = useState('');

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const pushLog = (s) => setLog((p) => [`${new Date().toLocaleTimeString()} · ${s}`, ...p]);

  const [bodyUrl, setBodyUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [rigUrl, setRigUrl] = useState('');
  const [exportUrl, setExportUrl] = useState('');
  const [localUrl, setLocalUrl] = useState(''); // ✅ persisted local /uploads url

  // ✅ 1) читаем /api/ai/__target (чтобы AI_MODE=off не выглядел как "сломалось")
  useEffect(() => {
    let aborted = false;

    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/ai/__target`);
        const j = await r.json().catch(() => null);

        if (aborted) return;

        if (!r.ok || !j) {
          setTarget(null);
          setAiOnline(false);
          setHint('API /api/ai/__target недоступен');
          return;
        }

        setTarget(j);

        // если AI выключен — это НЕ ошибка, просто режим OFF
        if (String(j.AI_MODE || '').toLowerCase() === 'off' || j.AI_ENABLED === false) {
          setAiOnline(false);
          setFeatures(null);
          setHint('AI_MODE=off — GPU выключен (это нормально).');
          return;
        }

        // AI включен → попробуем features
        setAiOnline(true);
        setHint('');
      } catch {
        if (aborted) return;
        setTarget(null);
        setAiOnline(false);
        setHint('AI target check failed');
      }
    })();

    return () => {
      aborted = true;
    };
  }, []);

  // ✅ 2) features only if AI enabled
  useEffect(() => {
    let aborted = false;

    (async () => {
      if (!target?.AI_ENABLED) return;
      try {
        const r = await fetch(`${API_BASE}/api/ai/features`);
        if (aborted) return;

        if (!r.ok) {
          setAiOnline(false);
          setFeatures(null);
          setHint(`AI включен, но /features вернул ${r.status}`);
          return;
        }

        const f = await r.json();
        setFeatures(f);
        setAiOnline(true);

        if (f?.tryon_avatar !== true) {
          setHint('GPU: tryon_avatar=false (pipeline выключен)');
        } else if (f?.avatar_mode1?.export !== true) {
          setHint('GPU: avatar_mode1.export=false');
        } else {
          setHint('');
        }
      } catch {
        if (aborted) return;
        setAiOnline(false);
        setFeatures(null);
        setHint('AI features request failed');
      }
    })();

    return () => {
      aborted = true;
    };
  }, [target?.AI_ENABLED]);

  const canRun = useMemo(() => {
    if (!target?.AI_ENABLED) return false;
    // даже если features не пришёл, мы можем попробовать (но лучше когда tryon_avatar=true)
    if (!features) return true;
    return features.tryon_avatar === true;
  }, [target?.AI_ENABLED, features]);

  const pollJobUntilDone = async (id, { timeoutMs = 90000 } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const j = await fetch(`${API_BASE}/api/ai/avatar/job/${encodeURIComponent(id)}`).then((r) => r.json());
      if (j?.status === 'done') return j;
      if (j?.status === 'error') return j;
      await sleep(800);
    }
    return { status: 'error', error: { message: 'timeout' } };
  };

  /**
   * ✅ Persist:
   * Node должен иметь POST /api/avatar/persist
   * body: { url: "/static/mesh/xxx.obj" } или { url: "https://..." }
   * response: { localUrl: "/uploads/avatars/xxx.obj" }
   */
  const persistExportToLocal = async (export_url) => {
    pushLog('POST /api/avatar/persist  (save to /uploads/avatars)');
    const r = await fetch(`${API_BASE}/api/avatar/persist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: export_url }),
    });

    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      const msg = j?.message || `persist failed (${r.status})`;
      throw new Error(msg);
    }

    if (!j?.localUrl) throw new Error('persist failed: no localUrl in response');
    return j.localUrl; // "/uploads/avatars/xxx.obj"
  };

  const runPipeline = async () => {
    // ✅ AI_MODE=off — честно запрещаем
    if (!target?.AI_ENABLED) {
      alert('AI_MODE=off. Включи AI_MODE=proxy и GPU_URL, затем перезапусти server.');
      return;
    }

    if (!canRun) {
      alert('AI пока не готов (offline или tryon_avatar выключен).');
      return;
    }

    setBusy(true);
    setBodyUrl('');
    setJobId('');
    setRigUrl('');
    setExportUrl('');
    setLocalUrl('');
    pushLog('Start: mode1 test pipeline');

    try {
      // 1) body
      pushLog('POST /avatar/body/anny');
      const body = await fetch(`${API_BASE}/api/ai/avatar/body/anny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then((r) => r.json());

      const body_mesh_url = body?.body_mesh_url;
      if (!body_mesh_url) throw new Error('No body_mesh_url returned');
      setBodyUrl(toPublicUrl(body_mesh_url));
      pushLog(`body_mesh_url = ${body_mesh_url}`);

      // 2) rig (job)
      pushLog('POST /avatar/rig (create job)');
      const rigStart = await fetch(`${API_BASE}/api/ai/avatar/rig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_mesh_url }),
      }).then((r) => r.json());

      const jid = rigStart?.job_id;
      if (!jid) throw new Error('No job_id returned from /avatar/rig');
      setJobId(jid);
      pushLog(`job_id = ${jid}`);

      // 3) poll job
      pushLog('Polling /avatar/job/{job_id} ...');
      const job = await pollJobUntilDone(jid, { timeoutMs: 90000 });

      if (job?.status === 'error') {
        pushLog(`JOB ERROR: ${job?.error?.message || job?.error || 'unknown error'}`);
        throw new Error(job?.error?.message || job?.error || 'job error');
      }

      const rigged_mesh_url = job?.result?.rigged_mesh_url;
      if (!rigged_mesh_url) throw new Error('No rigged_mesh_url in job result');
      setRigUrl(toPublicUrl(rigged_mesh_url));
      pushLog(`rigged_mesh_url = ${rigged_mesh_url}`);

      // 4) export
      pushLog('POST /avatar/export');
      const exp = await fetch(`${API_BASE}/api/ai/avatar/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rigged_mesh_url }),
      }).then((r) => r.json());

      const export_url = exp?.export_url;
      if (!export_url) throw new Error('No export_url returned from /avatar/export');
      setExportUrl(toPublicUrl(export_url));
      pushLog(`export_url = ${export_url}`);

      // 5) persist to Node uploads (чтобы pod можно было выключить)
      const persistedLocal = await persistExportToLocal(export_url);
      setLocalUrl(toPublicUrl(persistedLocal));
      pushLog(`localUrl = ${persistedLocal}`);

      // 6) save avatarFinal (✅ сохраняем ЛОКАЛЬНУЮ модель!)
      const avatarFinal = {
        id: `avatar-${Date.now()}`,
        name: 'My Avatar (mode1 test)',
        preview: '',
        model: persistedLocal, // "/uploads/avatars/xxx.obj"
        createdAt: Date.now(),
        meta: {
          source: 'mode1-test',
          body_mesh_url,
          rigged_mesh_url,
          export_url,
          persistedLocal,
        },
      };

      localStorage.setItem('avatarFinal', JSON.stringify(avatarFinal));
      localStorage.setItem(
        'wardrobeAvatar',
        JSON.stringify({
          id: avatarFinal.id,
          name: avatarFinal.name,
          image: avatarFinal.preview,
          model3d: avatarFinal.model,
          addedAt: avatarFinal.createdAt,
        })
      );

      pushLog('Saved localStorage.avatarFinal ✅');
      pushLog('Navigate → /tryon/avatar');
      nav('/tryon/avatar');
    } catch (e) {
      console.error(e);
      alert(`Mode1 test failed: ${e?.message || e}`);
      pushLog(`FAIL: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const modeLabel = target?.AI_MODE ? String(target.AI_MODE).toUpperCase() : '—';
  const gpuLabel = target?.GPU_URL ? String(target.GPU_URL) : '—';

  return (
    <div style={{ padding: 24, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>🧪 AvatarCreate — Mode1 Test</h2>

      <div style={{ color: '#6b7280', fontSize: 13 }}>
        Делает:
        <b> body → rig(job) → poll → export → persist (/uploads) → save avatarFinal → go TryOn</b>.
        Основной AvatarCreate не трогаем.
      </div>

      <div style={{ fontSize: 13, color: '#374151' }}>
        <div><b>AI_MODE:</b> {modeLabel}</div>
        <div><b>GPU_URL:</b> {gpuLabel}</div>

        {aiOnline === null && <div>Проверяем AI…</div>}
        {aiOnline === true && (
          <div style={{ color: '#059669' }}>
            🟢 AI enabled {features?.tryon_avatar === true ? '• tryon_avatar:on' : features ? '• tryon_avatar:off' : '• features:unknown'}
          </div>
        )}
        {aiOnline === false && (
          <div style={{ color: '#b45309' }}>
            🟠 AI not enabled / offline
          </div>
        )}
        {hint && <div style={{ color: '#6b7280' }}>{hint}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => nav('/avatar/create')}
          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}
        >
          ← Back to main AvatarCreate
        </button>

        <button
          onClick={runPipeline}
          disabled={busy || !canRun}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            background: busy || !canRun ? '#f3f4f6' : '#111827',
            color: busy || !canRun ? '#6b7280' : '#fff',
            cursor: busy || !canRun ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Running…' : 'Run body → rig → export → persist'}
        </button>

        <button
          onClick={() => nav('/tryon/avatar')}
          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}
        >
          Open TryOnAvatar →
        </button>
      </div>

      <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151' }}>
        <div>
          <b>body_mesh_url:</b> {bodyUrl ? <a href={bodyUrl} target="_blank" rel="noreferrer">open</a> : '—'}
        </div>
        <div><b>job_id:</b> {jobId || '—'}</div>
        <div>
          <b>rigged_mesh_url:</b> {rigUrl ? <a href={rigUrl} target="_blank" rel="noreferrer">open</a> : '—'}
        </div>
        <div>
          <b>export_url:</b> {exportUrl ? <a href={exportUrl} target="_blank" rel="noreferrer">open</a> : '—'}
        </div>
        <div>
          <b>localUrl (persisted):</b> {localUrl ? <a href={localUrl} target="_blank" rel="noreferrer">open</a> : '—'}
        </div>
      </div>

      <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Logs</div>
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#111827' }}>
          {log.length === 0 ? (
            <div style={{ color: '#6b7280' }}>No logs yet.</div>
          ) : (
            log.map((l, i) => (
              <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #f3f4f6' }}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}