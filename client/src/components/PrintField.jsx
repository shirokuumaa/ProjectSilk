// client/src/components/PrintField.jsx
//
// Принт ткани в форме продавца (utils/fabricPrint.js). Однотонная вещь — поле выключено, примерка показывает
// её в основном цвете. Включено — на фото квадрат ткани (сначала в центре вещи; двигается мышью, размер —
// ползунком), из него собирается бесшовная плитка, и повтор в сантиметрах (по умолчанию 10 см).
//
// value: null — однотонная; { blob, url, tileCm } — blob — новая плитка для отправки, url — её превью
// (или уже сохранённая плитка: blob = null). onChange — сеттер состояния (принимает и функцию).

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TILE_CM, MAX_TILE_CM, MIN_TILE_CM, defaultPrintBox, fitPrintBox, imagePixels, loadImage, makePrintTile,
} from '../utils/fabricPrint';

const PHOTO_MAX = 280;      // ширина фото в поле, px
const PREVIEW_REPEAT = 40;  // плитка в превью повтора, px

/** Что не так с принтом перед сохранением; null — всё в порядке или принта нет. */
export function printProblem(print) {
  if (!print) return null;
  const n = Number(print.tileCm);
  if (!(n >= MIN_TILE_CM && n <= MAX_TILE_CM)) return `Print repeat must be between ${MIN_TILE_CM} and ${MAX_TILE_CM} cm.`;
  if (!print.blob && !print.url) return 'The print is still being cut from the photo. Please try again in a moment.';
  return null;
}

export default function PrintField({ photo, value, onChange }) {
  const on = !!value;
  const [img, setImg] = useState(null);       // фото для холста (натуральный размер)
  const [box, setBox] = useState(null);       // квадрат в px фото
  const [shown, setShown] = useState(0);      // ширина фото на экране, px
  const [error, setError] = useState('');
  const built = useRef(null);                 // квадрат, из которого собрана текущая плитка
  const keepSaved = useRef(!!value && !value.blob);   // сохранённая плитка: не пересобирать, пока квадрат не тронут
  const drag = useRef(null);

  // фото → квадрат по умолчанию (новое фото — новая плитка)
  useEffect(() => {
    if (!on || !photo) return undefined;
    let alive = true;
    setError('');
    loadImage(photo)
      .then((im) => {
        if (!alive) return;
        const { data, width, height } = imagePixels(im);
        const b = defaultPrintBox(data, width, height);
        if (keepSaved.current) { keepSaved.current = false; built.current = b; }
        setImg(im);
        setBox(b);
      })
      .catch(() => {
        if (alive) setError('The photo could not be read here. Choose the photo again to cut the print from it.');
      });
    return () => { alive = false; };
  }, [photo, on]);

  // квадрат сдвинули или изменили — плитка собирается после паузы
  useEffect(() => {
    if (!img || !box || box === built.current) return undefined;
    const t = setTimeout(() => {
      built.current = box;
      makePrintTile(img, box)
        .then(({ blob, url }) => onChange((prev) => (prev ? { ...prev, blob, url } : prev)))
        .catch(() => setError('The print tile could not be made from this photo.'));
    }, 250);
    return () => clearTimeout(t);
  }, [img, box, onChange]);

  const toggle = (checked) => {
    keepSaved.current = false;
    built.current = null;
    setImg(null);
    setBox(null);
    onChange(checked ? { blob: null, url: null, tileCm: DEFAULT_TILE_CM } : null);
  };

  const scale = img && shown ? shown / img.naturalWidth : 0;
  const fit = (b) => fitPrintBox(b, img.naturalWidth, img.naturalHeight);

  const startDrag = (e) => {
    if (!box || !scale) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, box };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    setBox(fit({ ...d.box, x: d.box.x + (e.clientX - d.x) / scale, y: d.box.y + (e.clientY - d.y) / scale }));
  };
  const endDrag = () => { drag.current = null; };

  const resize = (size) => {
    const c = { x: box.x + box.size / 2, y: box.y + box.size / 2 };
    setBox(fit({ x: c.x - size / 2, y: c.y - size / 2, size }));
  };
  const recentre = () => {
    const { data, width, height } = imagePixels(img);
    setBox(defaultPrintBox(data, width, height));
  };

  return (
    <div style={styles.wrap}>
      <label style={styles.toggle}>
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        Printed fabric
      </label>
      <span style={styles.note}>
        {on
          ? 'Mark a square of the fabric on the photo — it repeats over the whole item on the try-on figure, the same in every size.'
          : 'Plain item — the try-on figure shows it in the main colour. Tick this for stripes, checks or florals.'}
      </span>

      {on && (
        <div style={styles.body}>
          <div style={styles.photo}>
            <img
              src={photo}
              alt="Product photo with the print square"
              draggable={false}
              style={styles.img}
              onLoad={(e) => setShown(e.currentTarget.clientWidth)}
            />
            {box && scale > 0 && (
              <div
                role="presentation"
                data-testid="print-square"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                  ...styles.square,
                  left: box.x * scale, top: box.y * scale, width: box.size * scale, height: box.size * scale,
                }}
              />
            )}
          </div>

          <div style={styles.controls}>
            {box && img && (
              <>
                <label style={styles.label}>
                  Square size
                  <input
                    type="range"
                    min={8}
                    max={Math.floor(Math.min(img.naturalWidth, img.naturalHeight) / 1.25)}
                    value={box.size}
                    onChange={(e) => resize(Number(e.target.value))}
                    style={{ display: 'block', width: '100%' }}
                  />
                </label>
                <button type="button" onClick={recentre} style={styles.btn}>Centre of the item</button>
              </>
            )}
            <label style={styles.label}>
              One repeat on the fabric, cm
              <input
                type="number"
                min={MIN_TILE_CM}
                max={MAX_TILE_CM}
                step="0.5"
                value={value.tileCm}
                onChange={(e) => {
                  const tileCm = e.target.value;
                  onChange((prev) => (prev ? { ...prev, tileCm } : prev));
                }}
                style={styles.input}
              />
            </label>
            <div style={styles.label}>
              How it repeats
              {value.url ? (
                <div
                  data-testid="print-preview"
                  style={{ ...styles.preview, backgroundImage: `url(${value.url})` }}
                />
              ) : (
                <div style={{ ...styles.preview, ...styles.pending }}>{error ? '' : 'Cutting the print…'}</div>
              )}
            </div>
            {error && <p role="alert" style={styles.error}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'grid', gap: 6 },
  toggle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 },
  note: { fontSize: 13, color: 'var(--muted)' },
  body: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' },
  photo: { position: 'relative', lineHeight: 0, userSelect: 'none' },
  img: {
    display: 'block', maxWidth: PHOTO_MAX, height: 'auto', borderRadius: 8,
    border: '1px solid var(--line)', background: 'var(--surface-3)',
  },
  square: {
    position: 'absolute', boxSizing: 'border-box', border: '2px solid var(--accent)',
    background: 'var(--accent-soft)', opacity: 0.55, cursor: 'move', touchAction: 'none',
  },
  controls: { display: 'grid', gap: 10, minWidth: 200, flex: '1 1 200px' },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)' },
  input: {
    display: 'block', width: '100%', padding: '8px 10px', borderRadius: 8, marginTop: 4,
    border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)',
  },
  btn: {
    justifySelf: 'start', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)',
  },
  preview: {
    width: PREVIEW_REPEAT * 3, height: PREVIEW_REPEAT * 3, marginTop: 4, borderRadius: 8,
    border: '1px solid var(--line)', backgroundRepeat: 'repeat', backgroundSize: `${PREVIEW_REPEAT}px ${PREVIEW_REPEAT}px`,
  },
  pending: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
    fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)',
  },
  error: { margin: 0, fontSize: 13, color: 'var(--fit-bad)' },
};
