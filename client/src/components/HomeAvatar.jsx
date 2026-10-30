// client/src/components/HomeAvatar.jsx
//
// Аватар покупателя на витрине — левая закреплённая колонка. Вещь надевается кнопкой
// «Try on» на карточке в рекомендованном размере; под фигурой — что надето (размер,
// вердикт, крестик), «Take all off», вердикт последней вещи и «Open fitting room».
// Гость без обмеров видит стандартную фигуру и тоже может надевать вещи.
// Одна 3D-сцена на странице, рисуется по требованию (GlbViewer frameloop="demand").

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isProfileComplete } from '../utils/bodyProfileApi';
import { getStressMap } from '../utils/fitCalculator';
import { offFigureReason } from '../utils/garmentTemplates';
import { productGarment } from '../utils/productGarment';
import { addToWardrobe } from '../utils/wardrobeStorage';
import {
  OUTFIT_SLOTS, figureOf, layerOf, readOutfit, recommendedFor, saveOutfit, typeOf, wearInSlots,
} from '../utils/outfit';
import styles from './HomeAvatar.module.css';

const GlbViewer = lazy(() => import('./GlbViewer'));

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);
const idOf = (p) => String(p?._id || p?.id || '');
const EMPTY = Object.fromEntries(OUTFIT_SLOTS.map((k) => [k, null]));

/**
 * Образ витрины: что надето, надеть (в рекомендованном размере), снять.
 * wear() возвращает false и пишет подсказку, если вещь не показать на фигуре.
 */
export function useHomeOutfit(products, profile) {
  const [slots, setSlots] = useState(readOutfit);
  const [note, setNote] = useState('');
  const [lastId, setLastId] = useState(null);
  useEffect(() => saveOutfit(slots), [slots]);

  const figure = figureOf(profile);
  const byId = useMemo(() => new Map((products || []).map((p) => [idOf(p), p])), [products]);
  const worn = useMemo(() => OUTFIT_SLOTS
    .map((slot) => ({ slot, product: byId.get(String(slots[slot])) }))
    .filter((w) => w.product)
    .map((w) => ({ ...w, rec: recommendedFor(w.product, figure) })), [slots, byId, figure]);

  const wear = useCallback((product) => {
    const name = product?.name || product?.title || 'This item';
    const type = typeOf(product);
    const reason = offFigureReason({ ...product, name, garmentType: type });
    if (reason) { setNote(reason); return false; }
    const id = idOf(product);
    addToWardrobe({ ...product, id, image: toPublicUrl(product.image) });   // и в полной примерке
    setSlots((s) => wearInSlots(s, type, id));
    setLastId(id);
    setNote('');
    return true;
  }, []);

  const takeOff = useCallback((slot) => setSlots((s) => ({ ...s, [slot]: null })), []);
  const takeAllOff = useCallback(() => { setSlots({ ...EMPTY }); setNote(''); }, []);
  return { worn, wear, takeOff, takeAllOff, note, setNote, lastId };
}

export default function HomeAvatar({ profile, outfit, dragging = false, onDropProduct }) {
  const { worn, takeOff, takeAllOff, note, lastId } = outfit;
  const own = isProfileComplete(profile);
  const figure = figureOf(profile);
  const [broken, setBroken] = useState([]);   // файлы, которые не загрузились — шаблон вместо них
  const [over, setOver] = useState(false);

  const garments = useMemo(() => worn
    .map((w) => {
      const first = productGarment(w.product, w.rec?.row, { toPublicUrl });
      const g = first.garment && broken.includes(first.garment.url)
        ? productGarment(w.product, w.rec?.row, { toPublicUrl, broken: true }).garment
        : first.garment;
      return g ? { ...g, layer: layerOf(w.slot) } : null;
    })
    .filter(Boolean), [worn, broken]);

  const active = worn.find((w) => idOf(w.product) === lastId) || worn[worn.length - 1] || null;
  const stressMap = active?.rec?.fit ? getStressMap(active.rec.fit) : null;
  const generic = garments.filter((g) => g.template).map((g) => g.name);

  // ── перетаскивание карточки на фигуру ──
  const dropProps = onDropProduct ? {
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setOver(false);
      const id = e.dataTransfer.getData('application/x-product-id') || e.dataTransfer.getData('text/plain');
      if (id) onDropProduct(id);
    },
  } : {};

  return (
    <aside className={styles.panel} aria-label="Your avatar">
      <div className={styles.head}>
        <span className="ui-eyebrow">{own ? 'My avatar' : 'Standard figure'}</span>
        <span className={styles.measures}>
          {figure.heightCm} · {figure.chest} · {figure.waist} · {figure.hips} cm
        </span>
      </div>

      <div
        className={`${styles.stage} ${dragging ? styles.stageReady : ''} ${over ? styles.stageOver : ''}`}
        data-testid="avatar-drop"
        {...dropProps}
      >
        <Suspense fallback={<div className={styles.loading}>Loading your avatar…</div>}>
          <GlbViewer
            profile={figure}
            garments={garments}
            stressMap={stressMap}
            onGarmentError={(url) => setBroken((b) => (b.includes(url) ? b : [...b, url]))}
            height="100%"
            fill={0.92}
            frameloop="demand"
            dpr={[1, 1.5]}
          />
        </Suspense>
        {dragging && <div className={styles.dropHint}>Drop to try it on</div>}
      </div>

      {!own && (
        <div className={styles.guest}>
          <span>This is a standard figure. Add your measurements to see items on your own body and in your size.</span>
          <Link to="/avatar/create" className="ui-btn ui-btn--primary ui-btn--sm">Add your measurements</Link>
        </div>
      )}

      {note && <p className={styles.note} role="status">{note}</p>}

      {worn.length === 0 ? (
        <p className={styles.empty}>Drag an item here or press “Try on” on any item.</p>
      ) : (
        <>
          <ul className={styles.worn} aria-label="Wearing now">
            {worn.map(({ slot, product, rec }) => {
              const name = product.name || product.title;
              return (
                <li key={slot} className={styles.wornItem}>
                  <span className={styles.wornName} title={name}>{name}</span>
                  {rec ? (
                    <span className={`ui-chip ${rec.fit.wearable ? 'ui-chip--good' : 'ui-chip--warn'}`}>
                      {rec.row?.size || rec.fit.size} · {rec.fit.wearable ? 'fits' : 'may not fit'}
                    </span>
                  ) : <span className="ui-chip">no size chart</span>}
                  <button className={styles.remove} onClick={() => takeOff(slot)} aria-label={`Take off ${name}`}>×</button>
                </li>
              );
            })}
          </ul>
          {active?.rec && (
            <p className={`${styles.verdict} ${active.rec.fit.wearable ? '' : styles.verdictWarn}`}>
              {active.product.name || active.product.title}: {active.rec.message}
              {!own && ' (for the standard figure)'}
            </p>
          )}
          {generic.length > 0 && (
            <p className={styles.small}>
              {generic.join(', ')} {generic.length === 1 ? 'is' : 'are'} shown as a generic shape — the real item may look different.
            </p>
          )}
          <button className="ui-btn ui-btn--sm" onClick={takeAllOff}>Take all off</button>
        </>
      )}

      <Link to="/tryon/avatar" className={styles.open}>Open fitting room →</Link>
    </aside>
  );
}
