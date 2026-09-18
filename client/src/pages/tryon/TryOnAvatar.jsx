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
// полезной, пока у товаров нет GLB.
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
import { useNavigate } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import BodyAvatar, { getBodyLandmarks } from '../../components/BodyAvatar';
import { drapeGarment } from '../../utils/garmentDrape';
import { loadBodyProfile, isProfileComplete } from '../../utils/bodyProfileApi';
import { findBestSize, getStressMap } from '../../utils/fitCalculator';
import { getWardrobe } from '../../utils/wardrobeStorage';
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

/**
 * Куда садится вещь: верхняя граница и высота, обе в метрах от пола.
 * Считается от реальных обмеров — на высокой фигуре платье длиннее.
 */
function placementFor(garmentType, L) {
  switch (garmentType) {
    case 'dress':     return { top: L.shoulder,        height: L.shoulder - L.knee };
    case 'outerwear': return { top: L.shoulder + 0.02, height: L.shoulder - L.thighTop };
    case 'bottom':    return { top: L.waist,           height: L.waist - L.ankle };
    case 'shoes':     return { top: L.ankle * 1.6,     height: L.ankle * 1.6 };
    case 'accessory': return { top: L.neck + 0.06,     height: 0.14 };
    case 'top':
    default:          return { top: L.shoulder,        height: L.shoulder - L.hips };
  }
}

/** Запомнить исходные вершины, чтобы прижатие можно было пересчитывать. */
function snapshotGeometry(root) {
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    if (pos && !child.geometry.userData.__pristine) {
      child.geometry.userData.__pristine = Float32Array.from(pos.array);
    }
  });
}

/** Вернуть вершины в исходное состояние перед новым прижатием. */
function restoreGeometry(root) {
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    const pristine = child.isMesh && child.geometry?.userData?.__pristine;
    if (pos && pristine) {
      pos.array.set(pristine);
      pos.needsUpdate = true;
      child.geometry.computeVertexNormals();
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
  });
}

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
function Garment({ url, profile, garmentType, fit, layer, onStatus }) {
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
  }, [url]);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!root || !group) return;

    // 1. откатываем прошлое прижатие — иначе деформации накапливаются
    restoreGeometry(root);
    group.position.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    group.updateWorldMatrix(true, true);

    // 2. масштаб по росту фигуры
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (size.y < 1e-6) return;

    const L = getBodyLandmarks(profile);
    const place = placementFor(garmentType, L);
    const scale = place.height / size.y;

    group.scale.setScalar(scale);
    group.position.set(
      -center.x * scale,
      place.top - box.max.y * scale,
      -center.z * scale,
    );
    group.updateWorldMatrix(true, true);

    // 3. прижимаем ткань к телу
    drapeGarment(group, profile, { fit, layer });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, garmentType, fit, layer,
      profile?.heightCm, profile?.chest, profile?.waist,
      profile?.hips, profile?.shoulderWidth]);

  return <group ref={groupRef}>{root && <primitive object={root} />}</group>;
}

// ─────────────────────────────────────────────────────────────
//  Страница
// ─────────────────────────────────────────────────────────────

export default function TryOnAvatar() {
  const nav = useNavigate();

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
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => { if (alive) setCatalog(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  useEffect(() => { localStorage.setItem(SLOTS_KEY, JSON.stringify(slots)); }, [slots]);
  useEffect(() => { localStorage.setItem(SIZES_KEY, JSON.stringify(chosenSizes)); }, [chosenSizes]);

  /** Вещь гардероба + данные товара из каталога. */
  const items = useMemo(() => {
    const byId = new Map();
    catalog.forEach((p) => byId.set(String(p._id || p.id), p));

    return wardrobe.map((w) => {
      const p = byId.get(String(w.id)) || {};
      return {
        id: w.id,
        name: w.name || p.title || 'Item',
        image: toPublicUrl(w.image || p.image),
        category: w.category || p.category || '',
        price: w.price ?? p.price,
        model3d: toPublicUrl(w.model3d || p.model3d || ''),
        garmentType: p.garmentType || 'top',
        layer: typeof p.layer === 'number' ? p.layer : 1,
        sizeChart: Array.isArray(p.sizeChart) ? p.sizeChart : [],
      };
    });
  }, [wardrobe, catalog]);

  const byId = useCallback((id) => items.find((i) => i.id === id) || null, [items]);

  const worn = useMemo(
    () => SLOTS.map((s) => ({ slot: s, item: byId(slots[s.key]) })).filter((x) => x.item),
    [slots, byId],
  );

  const active = byId(activeId) || worn[0]?.item || null;

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
  const fitOf = useCallback((item) => {
    const size = chosenSizes[item.id];
    const row = item.sizeChart.find((s) => s.size === size);
    return row?.fit || 'regular';
  }, [chosenSizes]);

  const toggleItem = (item) => {
    setActiveId(item.id);
    const slotKey = SLOTS.some((s) => s.key === item.garmentType) ? item.garmentType : 'top';
    setSlots((prev) => applySlot(prev, slotKey, prev[slotKey] === item.id ? null : item.id));
  };

  const camY = ((profile?.heightCm || 170) / 100) * 0.52;
  const missing3d = worn.filter((w) => !w.item.model3d).length;

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
            Nothing is generated and nothing is uploaded.
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
          <button
            className={`${styles.btn} ${spin ? styles.btnOn : ''}`}
            onClick={() => setSpin((v) => !v)}
          >
            Spin
          </button>
          <button
            className={`${styles.btn} ${showBody ? '' : styles.btnOn}`}
            onClick={() => setShowBody((v) => !v)}
          >
            {showBody ? 'Hide body' : 'Show body'}
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
              <ambientLight intensity={0.75} />
              <directionalLight intensity={0.95} position={[2, 4, 2]} castShadow />
              <directionalLight intensity={0.25} position={[-2, 2, -2]} />

              {showBody && <BodyAvatar profile={profile} stressMap={stressMap} />}

              {worn
                .filter((w) => w.item.model3d)
                .map((w) => (
                  <Garment
                    key={w.item.id}
                    url={w.item.model3d}
                    profile={profile}
                    garmentType={w.item.garmentType}
                    fit={fitOf(w.item)}
                    layer={w.item.layer}
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
                const item = byId(slots[s.key]);
                return (
                  <div key={s.key} className={`${styles.slot} ${item ? styles.slotFilled : ''}`}>
                    <span className={styles.slotKind}>{s.label}</span>
                    <span className={styles.slotName}>
                      {item ? item.name : <span style={{ color: 'var(--muted-2)' }}>empty</span>}
                    </span>
                    {item && !item.model3d && <span className={styles.no3d}>no 3D</span>}
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

          {missing3d > 0 && (
            <div className={styles.notice}>
              {missing3d === 1 ? 'One item has' : `${missing3d} items have`} no 3D model,
              so they will not appear on the figure. The size verdict still works —
              it comes from the size chart, not from geometry.
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
                  const on = Object.values(slots).includes(item.id);
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
                          {item.model3d ? '' : ' · no 3D model'}
                          {glbStatus[item.model3d] === 'error' ? ' · file failed to load' : ''}
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
                            {on ? 'Take off' : 'Wear'}
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
            The figure is built from your measurements in the browser. Nothing
            about your body leaves this device.
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
          <div className={styles.logo}>
            <i className={styles.logoDot} />
            ProjectSilk
            <span className={styles.pageTag}>Try-on</span>
          </div>
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
