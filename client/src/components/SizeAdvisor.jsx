// client/src/components/SizeAdvisor.jsx
//
// Показывает вердикт по размеру: сравнивает обмеры покупателя с обмерами вещи.
// Два режима:
//   compact — одна строка для карточки товара
//   full    — выбор размера + разбор по каждому обмеру (страница товара, примерка)
//
// Использование:
//   <SizeAdvisor product={product} />
//   <SizeAdvisor product={product} mode="full" onSizeChange={setSize} />

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findBestSize, MEASUREMENT_LABELS } from '../utils/fitCalculator';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';

export default function SizeAdvisor({
  product,
  mode = 'compact',
  onSizeChange,
  initialSize = null,
}) {
  const nav = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState(initialSize);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await loadBodyProfile();
      if (alive) {
        setProfile(p);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const sizeChart = product?.sizeChart || [];
  const isAccessory = product?.garmentType === 'accessory';

  // товар без обмеров — подбор невозможен
  if (isAccessory) return null;

  if (!sizeChart.length) {
    return mode === 'compact' ? null : (
      <div style={s.box}>
        <span style={s.muted}>Продавец не указал обмеры этой вещи</span>
      </div>
    );
  }

  if (loading) {
    return mode === 'compact' ? null : (
      <div style={s.box}><span style={s.muted}>Загружаем ваши обмеры…</span></div>
    );
  }

  // профиль не заполнен — зовём заполнить
  if (!isProfileComplete(profile)) {
    return (
      <div style={mode === 'compact' ? s.compactHint : s.box}>
        <span style={s.muted}>
          {mode === 'compact' ? 'Укажите обмеры →' : 'Чтобы увидеть, подойдёт ли размер, укажите свои обмеры'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); nav('/avatar/create'); }}
          style={s.linkBtn}
        >
          {mode === 'compact' ? 'заполнить' : 'Заполнить обмеры'}
        </button>
      </div>
    );
  }

  const result = findBestSize(profile, sizeChart, chosen);

  const pickSize = (size) => {
    const next = size === chosen ? null : size;
    setChosen(next);
    if (typeof onSizeChange === 'function') onSizeChange(next);
  };

  // ── компактный режим: одна строка в карточке ──
  if (mode === 'compact') {
    const rec = result.recommended;
    if (!rec) return null;

    return (
      <div
        style={{
          ...s.compactHint,
          background: rec.wearable ? '#e6f5ea' : '#fff2e6',
          color: rec.wearable ? '#2b7a3d' : '#b35309',
        }}
        title={result.message}
      >
        {rec.wearable
          ? <>Ваш размер: <b>{rec.size}</b></>
          : <>Может не подойти — ближе всего <b>{rec.size}</b></>}
      </div>
    );
  }

  // ── полный режим ──
  return (
    <div style={s.box}>
      <div style={s.header}>Подбор размера</div>

      <div style={s.sizeRow}>
        {result.all.map((r) => {
          const isChosen = r.size === chosen;
          const isRec = r.size === result.recommended?.size;
          return (
            <button
              key={r.size}
              onClick={() => pickSize(r.size)}
              style={{
                ...s.sizeBtn,
                borderColor: isChosen ? '#111827' : r.color,
                background: isChosen ? '#111827' : '#fff',
                color: isChosen ? '#fff' : '#111827',
                opacity: r.wearable ? 1 : 0.55,
              }}
              title={r.text}
            >
              {r.size}
              {isRec && <span style={s.recDot} title="Рекомендуем">●</span>}
            </button>
          );
        })}
      </div>

      <div
        style={{
          ...s.verdict,
          background: result.shouldWarn ? '#fff4e6' : '#e6f5ea',
          color: result.shouldWarn ? '#b35309' : '#2b7a3d',
        }}
      >
        {result.message}
      </div>

      {/* разбор по обмерам для выбранного (или рекомендованного) размера */}
      {(() => {
        const detail = result.chosen || result.recommended;
        if (!detail) return null;

        return (
          <table style={s.table}>
            <tbody>
              {Object.entries(detail.parts).map(([key, part]) => (
                <tr key={key}>
                  <td style={s.tdLabel}>{MEASUREMENT_LABELS[key] || key}</td>
                  <td style={s.tdBar}>
                    <span style={{ ...s.dot, background: part.color }} />
                    <span style={{ color: part.color, fontWeight: 500 }}>{part.text}</span>
                  </td>
                  <td style={s.tdEase}>
                    {part.ease > 0 ? `+${part.ease}` : part.ease} см
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}

      <div style={s.footnote}>
        Расчёт по вашим обмерам: грудь {profile.chest}, талия {profile.waist}, бёдра {profile.hips} см.
        <button
          onClick={() => nav('/avatar/create')}
          style={{ ...s.linkBtn, marginLeft: 6 }}
        >
          изменить
        </button>
      </div>
    </div>
  );
}

const s = {
  box: {
    border: '1px solid #e5e7eb', borderRadius: 12, padding: 14,
    background: '#fff', margin: '12px 0',
  },
  header: { fontWeight: 600, fontSize: 15, marginBottom: 10 },
  muted: { color: '#6b7280', fontSize: 13 },
  compactHint: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, padding: '4px 8px', borderRadius: 8,
    background: '#f3f4f6', color: '#6b7280', marginTop: 6,
  },
  linkBtn: {
    background: 'none', border: 'none', padding: 0,
    color: '#2563eb', cursor: 'pointer', fontSize: 12,
    textDecoration: 'underline',
  },
  sizeRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  sizeBtn: {
    minWidth: 48, padding: '8px 12px', borderRadius: 8,
    border: '2px solid', cursor: 'pointer', fontWeight: 600,
    fontSize: 14, position: 'relative',
  },
  recDot: { fontSize: 8, marginLeft: 4, verticalAlign: 'super', color: '#2f9e44' },
  verdict: { padding: '10px 12px', borderRadius: 8, fontSize: 14, marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  tdLabel: { padding: '5px 0', color: '#6b7280', width: 80 },
  tdBar: { padding: '5px 0' },
  tdEase: { padding: '5px 0', textAlign: 'right', color: '#6b7280', width: 70 },
  dot: { display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  footnote: { fontSize: 12, color: '#9ca3af', marginTop: 10, lineHeight: 1.5 },
};