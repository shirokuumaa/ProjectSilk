// client/src/components/PatternStatus.jsx
//
// Статус выкроек товара в «My products» (server/services/patternJobs.js):
// queued — строятся, patterns_ready — готовы (по размерам), failed — причина для продавца.
// У платьев, юбок и топов без силуэта — подсказка выбрать его.

import React from 'react';
import { silhouettesFor } from '../utils/silhouettes';

/** Текст и тон статуса; null — товару выкройки не нужны (пальто, обувь, аксессуары). */
export function patternStatus(product) {
  const p = product?.patterns;
  if (p?.status === 'queued') {
    return { tone: 'warn', text: 'Patterns: drafting… This takes a few minutes per size.' };
  }
  if (p?.status === 'failed') {
    return { tone: 'bad', text: `Patterns failed: ${p.message || 'Could not draft the patterns.'}` };
  }
  if (p?.status === 'patterns_ready') {
    const ok = (p.sizes || []).filter((s) => s.ok).map((s) => s.size);
    const bad = (p.sizes || []).filter((s) => !s.ok);
    const missed = bad.length ? ` Not drafted: ${bad.map((s) => `${s.size} — ${s.error}`).join('; ')}` : '';
    return { tone: bad.length ? 'warn' : 'good', text: `Patterns ready: ${ok.join(', ')}.${missed}` };
  }
  if (!silhouettesFor(product?.garmentType).length) return null;
  if (!product?.silhouette) return { tone: 'muted', text: 'No silhouette — choose one in Edit to draft patterns.' };
  return { tone: 'muted', text: 'Add a size chart to draft patterns.' };
}

export default function PatternStatus({ product }) {
  const s = patternStatus(product);
  if (!s) return null;
  return <div role="status" style={{ ...styles.base, ...styles[s.tone] }}>{s.text}</div>;
}

const styles = {
  base: { fontSize: 12.5, marginTop: 6, padding: '4px 10px', borderRadius: 8, display: 'inline-block', lineHeight: 1.45 },
  good: { color: 'var(--fit-good)', background: 'var(--fit-good-bg)' },
  warn: { color: 'var(--fit-warn)', background: 'var(--fit-warn-bg)' },
  bad: { color: 'var(--fit-bad)', background: 'var(--fit-bad-bg)' },
  muted: { color: 'var(--muted)', background: 'var(--surface-2)' },
};
