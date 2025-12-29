// client/src/pages/tryon/TryOnAvatar.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// ✅ viewer (умеет OBJ + GLB)
import MeshViewer from '../../components/MeshViewer';

import { getWardrobe } from '../../utils/wardrobeStorage';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

// ✅ публичные URL:
// - /uploads/... (Node)
// - /static/...  (FastAPI через Node proxy: /api/ai/static/...)
const toPublicUrl = (s = '') => {
  if (!s) return '';
  const str = String(s);

  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('/uploads')) return `${API_BASE}${str}`;
  if (str.startsWith('/static')) return `${API_BASE}/api/ai${str}`;

  return str;
};

const SLOTS_KEY = 'avatarOutfitDraft';

const EMPTY_SLOT_IDS = {
  topId: null,
  bottomId: null,
  shoesId: null,
  accessoryId: null,
};

function loadAvatarMeta() {
  try {
    const rawFinal = localStorage.getItem('avatarFinal');
    if (rawFinal) {
      const a = JSON.parse(rawFinal);

      // поддержка разных вариантов полей
      const modelUrl =
        a.glb || a.obj || a.export_url || a.exportUrl || a.model || a.model_url || '';

      return {
        ...a,
        preview: a.preview ? toPublicUrl(a.preview) : '',
        model: modelUrl ? toPublicUrl(modelUrl) : '',
      };
    }

    const rawWardrobe = localStorage.getItem('wardrobeAvatar');
    if (rawWardrobe) {
      const b = JSON.parse(rawWardrobe);
      return {
        id: b.id,
        name: b.name,
        preview: b.image ? toPublicUrl(b.image) : '',
        model: b.model3d ? toPublicUrl(b.model3d) : '',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function loadSlotIds() {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (!raw) return { ...EMPTY_SLOT_IDS };
    const j = JSON.parse(raw);
    return {
      topId: j.topId ?? null,
      bottomId: j.bottomId ?? null,
      shoesId: j.shoesId ?? null,
      accessoryId: j.accessoryId ?? null,
    };
  } catch {
    return { ...EMPTY_SLOT_IDS };
  }
}

function saveSlotIds(slots) {
  localStorage.setItem(
    SLOTS_KEY,
    JSON.stringify({
      topId: slots.topId ?? null,
      bottomId: slots.bottomId ?? null,
      shoesId: slots.shoesId ?? null,
      accessoryId: slots.accessoryId ?? null,
    }),
  );
}

export default function TryOnAvatar() {
  const nav = useNavigate();

  const [avatar, setAvatar] = useState(null);     // { preview, model, ... }
  const [wardrobe, setWardrobe] = useState([]);   // items from wardrobe
  const [slotIds, setSlotIds] = useState(() => loadSlotIds());
  const [selectedId, setSelectedId] = useState(null);

  // AI status
  const [aiOnline, setAiOnline] = useState(null);   // null | true | false
  const [aiFeatures, setAiFeatures] = useState(null);
  const [aiHint, setAiHint] = useState('');

  const refreshAll = () => {
    setAvatar(loadAvatarMeta());
    setWardrobe(
      getWardrobe().map((i) => ({
        ...i,
        image: toPublicUrl(i.image),
      })),
    );
    setSlotIds(loadSlotIds());
  };

  // initial load
  useEffect(() => {
    refreshAll();
  }, []);

  // ✅ авто-refresh когда меняется localStorage (avatarFinal) или когда вкладку снова открыли
  useEffect(() => {
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === 'avatarFinal' || e.key === 'wardrobeAvatar' || e.key === SLOTS_KEY) {
        refreshAll();
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };

    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // save slots on change
  useEffect(() => {
    saveSlotIds(slotIds);
  }, [slotIds]);

  // AI features check
  useEffect(() => {
    let aborted = false;

    (async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(`${API_BASE}/api/ai/features`, { signal: ctl.signal });
        clearTimeout(t);

        if (aborted) return;

        if (!r.ok) {
          setAiOnline(false);
          setAiFeatures(null);
          setAiHint('AI offline');
          return;
        }

        const f = await r.json();
        setAiFeatures(f);
        setAiOnline(true);

        if (f?.tryon_avatar !== true) {
          setAiHint('TryOnAvatar pipeline выключен на GPU (tryon_avatar:false).');
        } else if (f?.avatar_mode1?.export !== true) {
          setAiHint('Avatar export сейчас выключен (avatar_mode1.export:false).');
        } else {
          setAiHint('');
        }
      } catch {
        if (aborted) return;
        setAiOnline(false);
        setAiFeatures(null);
        setAiHint('AI offline');
      }
    })();

    return () => {
      aborted = true;
    };
  }, []);

  const resolveItem = (id) => wardrobe.find((x) => x.id === id) || null;

  const slots = useMemo(
    () => ({
      top: resolveItem(slotIds.topId),
      bottom: resolveItem(slotIds.bottomId),
      shoes: resolveItem(slotIds.shoesId),
      accessory: resolveItem(slotIds.accessoryId),
    }),
    [slotIds, wardrobe],
  );

  const hasOutfit = slots.top || slots.bottom || slots.shoes || slots.accessory;

  const updateSlot = (slotKey, item) => {
    setSlotIds((prev) => {
      const next = { ...prev, [slotKey]: item ? item.id : null };
      saveSlotIds(next);
      return next;
    });
    setSelectedId(item?.id || null);
  };

  const clearSlots = () => {
    setSlotIds({ ...EMPTY_SLOT_IDS });
    saveSlotIds(EMPTY_SLOT_IDS);
    setSelectedId(null);
  };

  // model can be OBJ or GLB
  const avatarModelUrl = avatar?.model ? avatar.model : toPublicUrl('/uploads/stub/avatar.glb');

  const SLOT_LABELS = {
    topId: 'Top',
    bottomId: 'Bottom',
    shoesId: 'Shoes',
    accessoryId: 'Accessory',
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 420px)',
        background: '#f3f4f6',
      }}
    >
      {/* Left: Avatar viewer */}
      <main
        style={{
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 4,
          }}
        >
          <button
            onClick={() => nav('/wardrobe')}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ← Wardrobe
          </button>

          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Avatar Try-On (3D)</h2>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Сейчас это “черновик” (выбор слотов). Позже GPU будет собирать одетого 3D-аватара.
            </div>

            <div style={{ marginTop: 6, fontSize: 12 }}>
              {aiOnline === null && <span>Проверяем AI…</span>}
              {aiOnline === true && (
                <span style={{ color: '#059669' }}>
                  🟢 AI online
                  {aiFeatures?.tryon_avatar === true ? ' • tryon_avatar:on' : ' • tryon_avatar:off'}
                </span>
              )}
              {aiOnline === false && <span style={{ color: '#b45309' }}>🟠 AI offline</span>}
              {aiHint && <span style={{ color: '#6b7280' }}> — {aiHint}</span>}
            </div>
          </div>

          <button
            onClick={refreshAll}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            Refresh
          </button>
        </div>

        {/* no avatar */}
        {!avatar && (
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              background: '#fff',
              fontSize: 13,
              color: '#374151',
            }}
          >
            <b>Аватар не найден.</b> Создай аватар, чтобы тут показывался твой 3D (OBJ/GLB).
            <div style={{ marginTop: 8 }}>
              <button
                // ✅ FIX: правильный route
                onClick={() => nav('/avatar/create')}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '1px solid #e5e7eb',
                  background: '#f9fafb',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Go to Avatar Create
              </button>
            </div>
          </div>
        )}

        {/* viewer */}
        <div
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #e5e7eb',
            background: '#e5e7eb',
          }}
        >
          <MeshViewer url={avatarModelUrl} height={520} background="#e5e7eb" />
        </div>

        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Model URL:{' '}
          <a href={avatarModelUrl} target="_blank" rel="noreferrer">
            open
          </a>
        </div>

        {/* outfit summary */}
        <div
          style={{
            marginTop: 4,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            background: '#fff',
            fontSize: 13,
            color: '#374151',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Outfit draft (avatar)</div>
            {!hasOutfit ? (
              <div style={{ color: '#6b7280' }}>
                Выбери вещи справа и назначь их в слоты Top/Bottom/Shoes/Accessory — черновик сохранится локально.
              </div>
            ) : (
              <div style={{ color: '#4b5563' }}>
                {slots.top && (
                  <span>
                    <b>Top:</b> {slots.top.name}{' '}
                  </span>
                )}
                {slots.bottom && (
                  <span>
                    • <b>Bottom:</b> {slots.bottom.name}{' '}
                  </span>
                )}
                {slots.shoes && (
                  <span>
                    • <b>Shoes:</b> {slots.shoes.name}{' '}
                  </span>
                )}
                {slots.accessory && (
                  <span>
                    • <b>Accessory:</b> {slots.accessory.name}
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={clearSlots}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #e5e7eb',
              background: '#f9fafb',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            Clear slots
          </button>
        </div>
      </main>

      {/* Right: wardrobe */}
      <aside
        style={{
          padding: 20,
          borderLeft: '1px solid #e5e7eb',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <strong>Avatar Outfit Builder</strong>
          <button
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid #e5e7eb',
              background: '#f9fafb',
              cursor: 'pointer',
              fontSize: 12,
            }}
            onClick={refreshAll}
          >
            Refresh
          </button>
        </div>

        {/* slots */}
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            padding: 10,
            display: 'grid',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#4b5563', marginBottom: 4 }}>
            Outfit slots
          </div>

          {Object.entries(SLOT_LABELS).map(([slotKey, label]) => {
            const item =
              slotKey === 'topId'
                ? slots.top
                : slotKey === 'bottomId'
                ? slots.bottom
                : slotKey === 'shoesId'
                ? slots.shoes
                : slots.accessory;

            return (
              <div
                key={slotKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 6,
                  borderRadius: 8,
                  background: '#f9fafb',
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: '1px solid #e5e7eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    background: '#fff',
                  }}
                >
                  {label[0]}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{item ? item.name : 'Не выбрано'}</div>
                </div>

                {item && (
                  <button
                    onClick={() => updateSlot(slotKey, null)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: '1px solid #e5e7eb',
                      background: '#fff',
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* wardrobe list */}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#4b5563', margin: '4px 0' }}>
          Your Wardrobe
        </div>

        {wardrobe.length === 0 ? (
          <p style={{ fontSize: 14, color: '#6b7280' }}>
            Гардероб пуст. Добавь вещи с карточек товара или из избранного,
            затем назначь их в слоты выше.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: 8,
              overflow: 'auto',
              paddingRight: 4,
              maxHeight: 'calc(100vh - 260px)',
            }}
          >
            {wardrobe.map((it) => (
              <div
                key={it.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '56px 1fr',
                  gap: 8,
                  padding: 8,
                  borderRadius: 10,
                  border: selectedId === it.id ? '2px solid #111827' : '1px solid #e5e7eb',
                  background: '#fff',
                }}
              >
                <img
                  src={toPublicUrl(it.image)}
                  alt={it.name}
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: 'cover',
                    borderRadius: 8,
                    background: '#e5e7eb',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{it.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {it.category || '—'}
                    {it.price ? ` • ${Number(it.price).toLocaleString('en-US')} ₸` : ''}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    <button
                      onClick={() => updateSlot('topId', it)}
                      style={{
                        padding: '3px 7px',
                        borderRadius: 999,
                        border: '1px solid #e5e7eb',
                        background: slotIds.topId === it.id ? '#111827' : '#f9fafb',
                        color: slotIds.topId === it.id ? '#fff' : '#111827',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Top
                    </button>
                    <button
                      onClick={() => updateSlot('bottomId', it)}
                      style={{
                        padding: '3px 7px',
                        borderRadius: 999,
                        border: '1px solid #e5e7eb',
                        background: slotIds.bottomId === it.id ? '#111827' : '#f9fafb',
                        color: slotIds.bottomId === it.id ? '#fff' : '#111827',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Bottom
                    </button>
                    <button
                      onClick={() => updateSlot('shoesId', it)}
                      style={{
                        padding: '3px 7px',
                        borderRadius: 999,
                        border: '1px solid #e5e7eb',
                        background: slotIds.shoesId === it.id ? '#111827' : '#f9fafb',
                        color: slotIds.shoesId === it.id ? '#fff' : '#111827',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Shoes
                    </button>
                    <button
                      onClick={() => updateSlot('accessoryId', it)}
                      style={{
                        padding: '3px 7px',
                        borderRadius: 999,
                        border: '1px solid #e5e7eb',
                        background: slotIds.accessoryId === it.id ? '#111827' : '#f9fafb',
                        color: slotIds.accessoryId === it.id ? '#fff' : '#111827',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Accessory
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 'auto', fontSize: 11, color: '#9ca3af' }}>
          Черновик наряда хранится только на этом устройстве.
          Позже GPU-сервер будет брать выбранные слоты и создавать «одетый» 3D-аватар.
        </div>
      </aside>
    </div>
  );
}