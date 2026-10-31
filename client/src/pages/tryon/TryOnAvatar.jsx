// client/src/pages/tryon/TryOnAvatar.jsx
//
// Try-on. Работает ПОЛНОСТЬЮ без GPU, без художника и без
// сгенерированного GLB-аватара.
//
// Как это устроено:
//   1. Тело строится прямо из обмеров покупателя — BodyAvatar.jsx.
//      Обхват груди 92 см даёт сечение периметром ровно 92 см. Не «похоже»,
//      а математически точно. Никакого файла аватара не существует и не нужно.
//   2. Вещь грузится как GLB и прижимается к телу — garmentDrape.js.
//      Вершины, провалившиеся внутрь тела, выталкиваются наружу; висящие
//      слишком далеко — подтягиваются. Аналог shrinkwrap, но в браузере.
//   3. Размер считается по размерной сетке товара — fitCalculator.js.
//      Проблемные зоны подсвечиваются кольцами прямо на фигуре.
//
// ВАЖНО: у вещи без model3d всё равно работает вердикт по размеру —
// он считается из чисел, 3D для него не нужен. Страница обязана быть
// полезной, пока у товаров нет GLB. На фигуре такая вещь показывается
// шаблоном своего типа в выбранном размере (utils/garmentTemplates.js).
//
// Что появится позже (сейчас сознательно не сделано):
//   • болванка от художника с морф-таргетами вместо процедурного тела
//   • перенос весов скиннинга → платье двигается вместе с телом
//   • кости подола с пружинами или настоящая ткань на WebGPU
// См. КОНТЕКСТ_ПРОЕКТА.md, раздел «Дорожная карта».

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import AvatarBody from '../../components/AvatarBody';
import BodyStage from '../../components/BodyStage';
import BodyToggle from '../../components/BodyToggle';
import { restoreGeometry, snapshotGeometry } from '../../utils/garmentDrape';
import { useAvatarBody } from '../../utils/avatarBody';
import { seatGarment } from '../../utils/garmentPlacement';
import { accessoryKind } from '../../utils/accessoryKinds';
import { loadBodyProfile, isProfileComplete } from '../../utils/bodyProfileApi';
import { findBestSize, getStressMap, sizeChartOf } from '../../utils/fitCalculator';
import { addToWardrobe, getWardrobe, pruneWardrobe, WARDROBE_EVENT } from '../../utils/wardrobeStorage';
import { brokenModelNote, garmentTypeOf, offFigureReason, templateFor } from '../../utils/garmentTemplates';
import { tintGarment } from '../../utils/garmentColor';
import { printGarment } from '../../utils/fabricPrint';
import {
  pickSizeModel, figureShape, simFitMode,
} from '../../utils/sizeModels';
import styles from './TryOnAvatar.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

const toPublicUrl = (s = '') => {
  const str = String(s || '');
  if (!str) return '';
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('/uploads')) return `${API_BASE}${str}`;
  if (str.startsWith('/static')) return `${API_BASE}/api/ai${str}`;
  return str;
};

// Черновик наряда. Ключ тот же, что был раньше, — старые черновики не теряются.
const SLOTS_KEY = 'avatarOutfitDraft';
const SIZES_KEY = 'avatarChosenSizes';

const SLOTS = [
  { key: 'dress',     label: 'Dress'     },
  { key: 'top',       label: 'Top'       },
  { key: 'bottom',    label: 'Bottom'    },
  { key: 'outerwear', label: 'Outerwear' },
  { key: 'shoes',     label: 'Shoes'     },
  { key: 'accessory', label: 'Accessory' },
];

const EMPTY_SLOTS = SLOTS.reduce((acc, s) => ({ ...acc, [s.key]: null }), {});

/** Платье и «верх + низ» взаимоисключающие: надеть всё сразу нельзя. */
function applySlot(prev, slotKey, itemId) {
  const next = { ...prev, [slotKey]: itemId };
  if (itemId) {
    if (slotKey === 'dress') { next.top = null; next.bottom = null; }
    if (slotKey === 'top' || slotKey === 'bottom') next.dress = null;
  }
  return next;
}

function readSlots() {
  try {
    const j = JSON.parse(localStorage.getItem(SLOTS_KEY) || '{}');
    return {
      ...EMPTY_SLOTS,
      // старый формат: topId / bottomId / shoesId / accessoryId
      top:       j.top       ?? j.topId       ?? null,
      bottom:    j.bottom    ?? j.bottomId    ?? null,
      shoes:     j.shoes     ?? j.shoesId     ?? null,
      accessory: j.accessory ?? j.accessoryId ?? null,
      dress:     j.dress     ?? null,
      outerwear: j.outerwear ?? null,
    };
  } catch {
    return { ...EMPTY_SLOTS };
  }
}

function readSizes() {
  try { return JSON.parse(localStorage.getItem(SIZES_KEY) || '{}'); }
  catch { return {}; }
}

// ─────────────────────────────────────────────────────────────
//  Размещение вещи на теле
// ─────────────────────────────────────────────────────────────

function disposeTree(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => {
      if (!m) return;
      Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); });
      m.dispose?.();
    });
  });
}

/**
 * Одна вещь на теле: грузит GLB, ставит по росту и прижимает к фигуре.
 */
function Garment({
  url, profile, garmentType, fit, layer, size = null, legs = null, simFigure = null, color = null, print = null,
  accessory = null, onStatus,
}) {
  // тело и его форма — те же, что у AvatarBody в этой сцене
  const avatar = useAvatarBody(profile);
  const { shape } = avatar;
  const groupRef = useRef(null);
  const [root, setRoot] = useState(null);

  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    let loaded = null;

    onStatus?.(url, 'loading');

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!alive) { disposeTree(gltf.scene); return; }
        loaded = gltf.scene;
        // цвет товара вместо макетного и чужих текстур шаблонов; у обуви и аксессуаров — своя текстура
        tintGarment(loaded, accessoryKind(garmentType, accessory) ? null : color);
        printGarment(loaded, print);  // принт — на развёртку выкройки драпировки; шаблоны остаются в цвете
        snapshotGeometry(loaded);
        setRoot(loaded);
        onStatus?.(url, 'ready');
      },
      undefined,
      () => { if (alive) onStatus?.(url, 'error'); },
    );

    return () => {
      alive = false;
      if (loaded) disposeTree(loaded);
      setRoot(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, color, print?.image, print?.tileCm]);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!root || !group || !shape) return;

    // 1. откатываем прошлое прижатие — иначе деформации накапливаются
    restoreGeometry(root);
    group.position.set(0, 0, 0);
    group.quaternion.identity();          // аксессуары поворачиваются к точке тела
    group.scale.set(1, 1, 1);
    group.updateWorldMatrix(true, true);

    // 2. посадка: ткань, просимулированная на фигуре размера, переносится на фигуру
    //    покупателя (складки сохраняются) и только страхуется от провала в тело; шаблоны
    //    и модели продавца ставятся по росту и прижимаются к телу — кроме обуви и
    //    аксессуаров: они твёрдые (utils/garmentPlacement.js, seatGarment)
    seatGarment(group, root, shape, {
      garmentType, fit, layer, size, legs,
      from: simFigure ? figureShape(simFigure, avatar) : null,
      transferOnly: simFitMode() === 'transfer',
      accessory, footLengthCm: profile?.footLength, color,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, garmentType, fit, layer, shape, size, legs, simFigure, accessory, profile?.footLength, color]);

  return <group ref={groupRef}>{root && shape && <primitive object={root} />}</group>;
}

// ─────────────────────────────────────────────────────────────
//  Страница
// ─────────────────────────────────────────────────────────────

export default function TryOnAvatar() {
  const nav = useNavigate();
  // «Try on» с карточки или страницы товара: /tryon/avatar?sku=<id> — эту вещь надеть сразу
  const [searchParams] = useSearchParams();
  const pendingSku = useRef(searchParams.get('sku') || null);

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [wardrobe, setWardrobe] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [slots, setSlots] = useState(readSlots);
  const [chosenSizes, setChosenSizes] = useState(readSizes);
  const [activeId, setActiveId] = useState(null);
  const [showBody, setShowBody] = useState(true);
  const [spin, setSpin] = useState(false);
  const [glbStatus, setGlbStatus] = useState({});

  // ── обмеры ──
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await loadBodyProfile();
      if (alive) { setProfile(p); setLoadingProfile(false); }
    })();
    return () => { alive = false; };
  }, []);

  // ── гардероб + каталог (за sizeChart, model3d, garmentType) ──
  const refresh = useCallback(() => {
    setWardrobe(getWardrobe());
    setSlots(readSlots());
  }, []);

  useEffect(() => {
    refresh();
    let alive = true;
    fetch(`${API_BASE}/api/products`)
      .then((r) => (r.ok ? r.json() : null)) // ошибка ≠ пустой каталог: гардероб не чистим
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        setCatalog(list);
        pruneWardrobe(list); // удалённые продавцом товары — из гардероба
        // вещь из ?sku= — в гардероб (если её там нет); нет такого товара — ничего не надеваем
        const sku = pendingSku.current;
        const product = sku && list.find((p) => String(p._id || p.id) === sku);
        if (product) addToWardrobe({ ...product, id: sku, image: toPublicUrl(product.image) });
        else pendingSku.current = null;
        setWardrobe(getWardrobe());
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    // после входа гардероб приходит с сервера позже, чем открылась страница
    window.addEventListener(WARDROBE_EVENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener(WARDROBE_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => { localStorage.setItem(SLOTS_KEY, JSON.stringify(slots)); }, [slots]);
  useEffect(() => { localStorage.setItem(SIZES_KEY, JSON.stringify(chosenSizes)); }, [chosenSizes]);

  /** Вещь гардероба + данные товара из каталога. */
  const items = useMemo(() => {
    const byId = new Map();
    catalog.forEach((p) => byId.set(String(p._id || p.id), p));

    return wardrobe.map((w) => {
      const p = byId.get(String(w.id)) || {};
      const category = w.category || p.category || '';
      const item = {
        id: w.id,
        name: w.name || p.title || 'Item',
        image: toPublicUrl(w.image || p.image),
        category,
        price: w.price ?? p.price,
        model3d: toPublicUrl(w.model3d || p.model3d || ''),
        garmentType: garmentTypeOf({ garmentType: p.garmentType, category }), // null — тип не задан
        layer: typeof p.layer === 'number' ? p.layer : 1,
        sizeChart: sizeChartOf(p), // с тянучестью ткани товара
        legs: p.legs || null,
        sizeModels: p.sizeModels || null,   // ткань, просимулированная по размерам
        color: p.color || null,             // основной цвет с фото товара
        print: p.print ? { ...p.print, image: toPublicUrl(p.print.image) } : null,   // принт ткани
        accessory: p.accessory || null,     // вид и размеры аксессуара или обуви — точка на теле и масштаб
      };
      // без своей 3D-модели — шаблон того же типа в размере покупателя
      const template = templateFor(item);
      return { ...item, template, garmentUrl: item.model3d || template?.url || '' };
    });
  }, [wardrobe, catalog]);

  const byId = useCallback((id) => items.find((i) => i.id === id) || null, [items]);
  // в слоте из старого черновика может лежать вещь, которую не показать (без типа,
  // пальто без модели) — на фигуре её нет
  const wornById = useCallback((id) => {
    const item = byId(id);
    return item && !offFigureReason(item) ? item : null;
  }, [byId]);

  const worn = useMemo(
    () => SLOTS.map((s) => ({ slot: s, item: wornById(slots[s.key]) })).filter((x) => x.item),
    [slots, wornById],
  );

  const active = byId(activeId) || worn[0]?.item || null;

  // вещь из ?sku= — надеть, как только пришёл каталог (до него тип вещи неизвестен)
  useEffect(() => {
    const sku = pendingSku.current;
    if (!sku || !catalog.length) return;
    const item = items.find((i) => String(i.id) === sku);
    if (!item) return;
    pendingSku.current = null;
    setActiveId(item.id);
    // вещь, которую не показать на фигуре, не надевается — в панели её размер и пояснение
    if (!offFigureReason(item)) setSlots((prev) => applySlot(prev, item.garmentType, item.id));
  }, [items, catalog]);

  // ── вердикт по размеру ──
  const fitResult = useMemo(() => {
    if (!active?.sizeChart?.length || !isProfileComplete(profile)) return null;
    return findBestSize(profile, active.sizeChart, chosenSizes[active.id] || null);
  }, [active, profile, chosenSizes]);

  const stressMap = useMemo(() => {
    if (!fitResult) return null;
    const target = fitResult.chosen || fitResult.recommended;
    return target ? getStressMap(target) : null;
  }, [fitResult]);

  /** Крой выбранного размера — от него зависит зазор при прижатии. */
  // обмеры размера, в котором вещь показана: выбранный покупателем или рекомендованный
  const sizeRowOf = useCallback((item) => {
    if (!item.sizeChart?.length || !isProfileComplete(profile)) return null;
    const result = findBestSize(profile, item.sizeChart, chosenSizes[item.id] || null);
    const name = (result.chosen || result.recommended)?.size;
    return item.sizeChart.find((s) => s.size === name) || null;
  }, [profile, chosenSizes]);

  const fitOf = useCallback((item) => {
    const size = chosenSizes[item.id];
    const row = item.sizeChart.find((s) => s.size === size);
    return row?.fit || 'regular';
  }, [chosenSizes]);

  /**
   * Что надеть: модель размера, своя модель продавца или шаблон. Файл модели не загрузился —
   * шаблон того же типа (note — пояснение покупателю); без шаблона вещи на фигуре нет (url '').
   */
  const sourceOf = (item) => {
    const size = sizeRowOf(item);
    const model = pickSizeModel(item, size);   // модель надеваемого размера или ближайшего
    const own = model ? model.model3d : item.garmentUrl;
    const base = { size, url: own, simFigure: model?.body || null, legs: item.template ? item.template.legs : item.legs };
    if (glbStatus[own] !== 'error') return base;
    const template = templateFor(item, { ignoreModel: true });
    const note = brokenModelNote(item.name, template);
    return template
      ? { ...base, url: template.url, simFigure: null, legs: template.legs, note }
      : { ...base, url: '', note };
  };

  const toggleItem = (item) => {
    setActiveId(item.id);
    // вещь, которую не показать на фигуре (без типа; пальто, обувь, аксессуар без модели),
    // не надевается невидимкой: только размер и пояснение в панели
    if (offFigureReason(item)) return;
    const slotKey = item.garmentType;
    setSlots((prev) => applySlot(prev, slotKey, prev[slotKey] === item.id ? null : item.id));
  };

  const camY = ((profile?.heightCm || 170) / 100) * 0.52;
  const generic = worn.filter((w) => w.item.template);

  // ── экраны без данных ──
  if (loadingProfile) {
    return (
      <Shell nav={nav}>
        <div className={styles.empty}><span className={styles.emptyText}>Loading measurements…</span></div>
      </Shell>
    );
  }

  if (!isProfileComplete(profile)) {
    return (
      <Shell nav={nav}>
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>Add your measurements</span>
          <span className={styles.emptyText}>
            The figure is built from four numbers: height, bust, waist, hips.
            No photos are needed.
          </span>
          <button className={`${styles.btn} ${styles.btnDark}`} onClick={() => nav('/avatar/create')}>
            Add measurements
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      nav={nav}
      actions={
        <>
          {/* первой и заметной: убрать тело должно быть легко найти */}
          <BodyToggle shown={showBody} onToggle={() => setShowBody((v) => !v)} />
          <button
            className={`${styles.btn} ${spin ? styles.btnOn : ''}`}
            onClick={() => setSpin((v) => !v)}
          >
            Spin
          </button>
          <button className={styles.btn} onClick={() => setSlots({ ...EMPTY_SLOTS })}>
            Take all off
          </button>
        </>
      }
    >
      <div className={styles.body}>
        {/* ── сцена ── */}
        <section className={styles.stage}>
          <div className={styles.canvasWrap}>
            <Canvas
              shadows
              dpr={[1, 2]}
              camera={{ position: [0, camY, 3.1], fov: 42, near: 0.1, far: 100 }}
            >
              <color attach="background" args={['#FBFAF8']} />
              <BodyStage shadows />

              {showBody && (
                <AvatarBody
                  profile={profile}
                  stressMap={stressMap}
                />
              )}

              {worn
                .map((w) => ({ item: w.item, src: sourceOf(w.item) }))
                .filter(({ src }) => src.url)
                .map(({ item, src }) => (
                  <Garment
                    key={item.id}
                    url={src.url}
                    profile={profile}
                    garmentType={item.garmentType}
                    fit={fitOf(item)}
                    layer={item.layer}
                    size={src.size}
                    legs={src.legs}
                    simFigure={src.simFigure}
                    color={item.color}
                    print={item.print}
                    accessory={item.accessory}
                    onStatus={(url, st) => setGlbStatus((s) => ({ ...s, [url]: st }))}
                  />
                ))}

              <gridHelper args={[3, 12, '#E4E1DC', '#EDEAE5']} />
              <OrbitControls
                target={[0, camY, 0]}
                enablePan={false}
                minDistance={1.2}
                maxDistance={5}
                autoRotate={spin}
                autoRotateSpeed={1.4}
              />
            </Canvas>
          </div>

          {fitResult && (
            <div
              className={`${styles.verdict} ${
                fitResult.shouldWarn ? styles.verdictWarn : styles.verdictGood
              }`}
            >
              {fitResult.message}
            </div>
          )}

          <div className={styles.stageFoot}>
            <span className={styles.measure}>
              {profile.heightCm} · {profile.chest} · {profile.waist} · {profile.hips} cm
            </span>
            <button className={`${styles.btn} ${styles.btnSm}`} onClick={() => nav('/avatar/create')}>
              Edit measurements
            </button>
            <button className={`${styles.btn} ${styles.btnSm}`} onClick={() => nav('/tryon/ar')}>
              Open camera
            </button>
          </div>
        </section>

        {/* ── правая панель ── */}
        <aside className={styles.side}>
          <div>
            <div className={styles.sectionLabel}>Worn now</div>
            <div className={styles.slots} style={{ marginTop: 8 }}>
              {SLOTS.map((s) => {
                const item = wornById(slots[s.key]);
                return (
                  <div key={s.key} className={`${styles.slot} ${item ? styles.slotFilled : ''}`}>
                    <span className={styles.slotKind}>{s.label}</span>
                    <span className={styles.slotName}>
                      {item ? item.name : <span style={{ color: 'var(--muted-2)' }}>empty</span>}
                    </span>
                    {item && !item.model3d && item.template && (
                      <span className={styles.no3d}>generic shape</span>
                    )}
                    {item && (
                      <button
                        className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => setSlots((p) => applySlot(p, s.key, null))}
                      >
                        Take off
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {active && offFigureReason(active) && (
            <div className={styles.notice}>{offFigureReason(active)}</div>
          )}

          {worn.map((w) => sourceOf(w.item).note).filter(Boolean).map((note) => (
            <div key={note} className={styles.notice}>{note}</div>
          ))}

          {generic.length > 0 && (
            <div className={styles.notice}>
              {generic.map((w) => w.item.name).join(', ')}
              {generic.length === 1 ? ' has' : ' have'} no 3D model yet, so{' '}
              {generic.length === 1 ? `it is shown as a generic ${generic[0].item.template.label}` : 'they are shown as generic shapes'}{' '}
              in your size. The fit follows the seller’s size chart; the real item may look different.
            </div>
          )}

          <div>
            <div className={styles.sectionLabel}>Wardrobe</div>
            {items.length === 0 ? (
              <div className={styles.empty} style={{ margin: '10px 0' }}>
                <span className={styles.emptyTitle}>Your wardrobe is empty</span>
                <span className={styles.emptyText}>
                  Save items from any product card and they will show up here.
                </span>
                <button className={`${styles.btn} ${styles.btnDark}`} onClick={() => nav('/')}>
                  Go to shop
                </button>
              </div>
            ) : (
              <div className={styles.list} style={{ marginTop: 8 }}>
                {items.map((item) => {
                  const on = worn.some((w) => w.item.id === item.id);
                  const best = item.sizeChart.length && isProfileComplete(profile)
                    ? findBestSize(profile, item.sizeChart).recommended?.size
                    : null;

                  return (
                    <div
                      key={item.id}
                      className={`${styles.item} ${activeId === item.id ? styles.itemActive : ''}`}
                    >
                      <img className={styles.thumb} src={item.image} alt="" />
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.itemName}>{item.name}</div>
                        <div className={styles.itemMeta}>
                          {item.category || '—'}
                          {!item.garmentType ? ' · type not set' : item.model3d ? '' : item.template ? ` · no 3D model, shown as a generic ${item.template.label}` : ' · no 3D model, not shown on the figure'}
                          {glbStatus[item.garmentUrl] === 'error' ? ' · file failed to load' : ''}
                        </div>

                        {item.sizeChart.length > 0 && (
                          <div className={styles.sizes}>
                            {item.sizeChart.map((row) => (
                              <button
                                key={row.size}
                                className={[
                                  styles.sizeChip,
                                  chosenSizes[item.id] === row.size ? styles.sizeChipOn : '',
                                  best === row.size && chosenSizes[item.id] !== row.size
                                    ? styles.sizeChipBest : '',
                                ].join(' ')}
                                onClick={() => {
                                  setActiveId(item.id);
                                  setChosenSizes((s) => ({ ...s, [item.id]: row.size }));
                                }}
                              >
                                {row.size}
                              </button>
                            ))}
                          </div>
                        )}

                        <div style={{ marginTop: 8 }}>
                          <button
                            className={`${styles.btn} ${styles.btnSm} ${on ? styles.btnOn : ''}`}
                            onClick={() => toggleItem(item)}
                          >
                            {on ? 'Take off' : offFigureReason(item) ? 'Check size' : 'Wear'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className={styles.hint} style={{ marginTop: 'auto' }}>
            The figure is built from your measurements in the browser. The numbers
            are saved to your account so they work on any device; no photos are needed.
          </p>
        </aside>
      </div>
    </Shell>
  );
}

/** Общая рамка страницы: шапка + полотно. */
function Shell({ nav, actions, children }) {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          {/* над страницей — шапка магазина; здесь название страницы, не логотип */}
          <h1 className={styles.logo}>
            <i className={styles.logoDot} />
            Try-on
          </h1>
          <div className={styles.headerRight}>
            {actions}
            <button className={styles.btn} onClick={() => nav('/wardrobe')}>
              ← Wardrobe
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
