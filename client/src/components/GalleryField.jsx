// client/src/components/GalleryField.jsx
//
// Галерея товара в форме продавца: ещё до 8 фото кроме главного (сзади, деталь, на модели).
// value: { saved: ['/uploads/…'] — уже сохранённые, files: [File] — новые }.
// На сервере: файлы — поле gallery, какие сохранённые оставить — galleryKeep (server/utils/productDetails.js).

import React, { useEffect, useMemo, useState } from 'react';

export const MAX_GALLERY = 8;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_MB = 10;

export const galleryFromProduct = (p) => ({ saved: [...(p?.images || [])], files: [] });

/** Фото в FormData; при изменении товара — и список оставленных сохранённых. */
export function appendGallery(fd, value, { editing = false } = {}) {
  (value?.files || []).forEach((f) => fd.append('gallery', f, f.name));
  if (editing) fd.append('galleryKeep', JSON.stringify(value?.saved || []));
}

export default function GalleryField({ value, onChange, toPublicUrl = (s) => s }) {
  const [error, setError] = useState('');
  const saved = useMemo(() => value?.saved || [], [value]);
  const files = useMemo(() => value?.files || [], [value]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const room = MAX_GALLERY - saved.length - files.length;

  const add = (list) => {
    setError('');
    const picked = Array.from(list || []);
    const bad = picked.filter((f) => !IMAGE_TYPES.includes(f.type) || f.size > MAX_IMAGE_MB * 1024 * 1024);
    const good = picked.filter((f) => !bad.includes(f)).slice(0, Math.max(0, room));
    if (bad.length) setError(`Photos must be JPEG, PNG or WebP, up to ${MAX_IMAGE_MB} MB each.`);
    else if (picked.length > good.length) setError(`Up to ${MAX_GALLERY} extra photos.`);
    if (good.length) onChange({ saved, files: [...files, ...good] });
  };

  return (
    <div style={styles.box}>
      <div style={styles.title}>More photos <span style={styles.note}>({saved.length + files.length} of {MAX_GALLERY})</span></div>
      <div style={styles.note}>Back, details, on a model — buyers see them in the gallery.</div>
      <div style={styles.grid}>
        {saved.map((url, i) => (
          <Thumb key={url} src={toPublicUrl(url)} label={`Saved photo ${i + 1}`}
            onRemove={() => onChange({ saved: saved.filter((u) => u !== url), files })} />
        ))}
        {files.map((f, i) => (
          <Thumb key={previews[i]} src={previews[i]} label={`New photo ${f.name}`}
            onRemove={() => onChange({ saved, files: files.filter((x) => x !== f) })} />
        ))}
      </div>
      {room > 0 && (
        <label style={styles.add}>
          + Add photos
          <input
            type="file" multiple accept="image/jpeg,image/png,image/webp"
            aria-label="Add photos to the gallery"
            style={{ display: 'none' }}
            onChange={(e) => { add(e.target.files); e.target.value = ''; }}
          />
        </label>
      )}
      {error && <div role="alert" style={styles.error}>{error}</div>}
    </div>
  );
}

function Thumb({ src, label, onRemove }) {
  return (
    <div style={styles.thumbWrap}>
      <img src={src} alt={label} style={styles.thumb} />
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} style={styles.remove}>×</button>
    </div>
  );
}

const styles = {
  box: { display: 'grid', gap: 8 },
  title: { fontSize: 14, fontWeight: 500, color: 'var(--ink)' },
  note: { fontSize: 13, color: 'var(--muted)', fontWeight: 400 },
  grid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', display: 'block' },
  remove: {
    position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11,
    border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', lineHeight: '18px',
  },
  add: {
    display: 'inline-block', width: 'fit-content', padding: '6px 12px', borderRadius: 8,
    border: '1px dashed var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', fontSize: 13,
  },
  error: { fontSize: 13, color: 'var(--fit-bad)' },
};
