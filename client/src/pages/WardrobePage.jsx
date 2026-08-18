import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Wardrobe.module.css';
import GlbViewer from '../components/GlbViewer';
import SizeAdvisor from '../components/SizeAdvisor';
import axios from 'axios';
import { getBaseURL } from '../assistant/api';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { findBestSize, getStressMap } from '../utils/fitCalculator';

import {
  getWardrobe,
  saveWardrobe,
  clearWardrobe,
  importFromFavorites,
  addOutfit,
} from '../utils/wardrobeStorage';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') =>
  s?.startsWith('/uploads') ? `${API_BASE}${s}` : s;

export default function WardrobePage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState('Items');
  const [items, setItems] = useState(() => getWardrobe().map((i) => ({ ...i, image: toPublicUrl(i.image) })));
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');

  // ── профиль тела: аватар строится из обмеров, файл не нужен ──
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // ── примеряемые вещи в 3D ──
  const [worn3d, setWorn3d] = useState([]);      // [{ id, name, url, garmentType, layer, product }]
  const [activeProduct, setActiveProduct] = useState(null); // для панели подбора размера

  // Зоны натяжения: где вещи не хватает ткани на этом теле
  const stressMap = useMemo(() => {
    if (!activeProduct?.sizeChart?.length || !profile) return null;
    const fit = findBestSize(profile, activeProduct.sizeChart);
    return fit.recommended ? getStressMap(fit.recommended) : null;
  }, [activeProduct, profile]);

  const canvasRef = useRef(null);
  const [stageImg, setStageImg] = useState(null);
  const [layers, setLayers] = useState([]);
  const [zoom, setZoom] = useState(1);

  // 🌟 AI Try-On Photo
  const [isTryOnMode, setIsTryOnMode] = useState(false);
  const [tryOnHuman, setTryOnHuman] = useState(null);
  const [tryOnGarment, setTryOnGarment] = useState(null);
  const [tryOnCategory, setTryOnCategory] = useState('upper_body');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    saveWardrobe(items);
  }, [items]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await loadBodyProfile();
      if (alive) {
        setProfile(p);
        setProfileLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    let arr = items;
    if (cat !== 'All') arr = arr.filter((i) => (i.category || '').toLowerCase() === cat.toLowerCase());
    if (query.trim()) arr = arr.filter((i) => (i.name || '').toLowerCase().includes(query.toLowerCase()));
    return arr;
  }, [items, cat, query]);

  /* ───────── Примерка в 3D ───────── */
  const wearIn3D = (item) => {
    const modelUrl = item.model3d ? toPublicUrl(item.model3d) : null;

    if (!modelUrl) {
      alert(
        `У «${item.name}» нет 3D-модели.\n\n` +
        'Продавец должен загрузить .glb в панели товара, ' +
        'либо сгенерировать модель из фото.'
      );
      return;
    }

    // уже надето — снимаем
    if (worn3d.some((w) => w.id === item.id)) {
      setWorn3d((prev) => prev.filter((w) => w.id !== item.id));
      if (activeProduct?.id === item.id) setActiveProduct(null);
      return;
    }

    const type = item.garmentType || guessType(item.category);
    const entry = {
      id: item.id,
      name: item.name,
      url: modelUrl,
      garmentType: type,
      layer: item.layer || (type === 'outerwear' ? 3 : type === 'top' ? 2 : 1),
      product: item,
    };

    // один предмет на слой: платье снимает верх и низ
    setWorn3d((prev) => {
      let next = prev.filter((w) => w.garmentType !== type);
      if (type === 'dress') next = next.filter((w) => !['top', 'bottom'].includes(w.garmentType));
      if (['top', 'bottom'].includes(type)) next = next.filter((w) => w.garmentType !== 'dress');
      return [...next, entry];
    });

    setActiveProduct(item);
  };

  const isWorn = (id) => worn3d.some((w) => w.id === id);

  /* ───────── AI Generation (Try-On Photo) ───────── */
  const handleGenerateAI = async () => {
    if (!tryOnHuman || !tryOnGarment) {
      alert('Please upload both Human and Garment photos first!');
      return;
    }

    setIsGenerating(true);

    try {
      const formData = new FormData();
      formData.append('human', tryOnHuman);
      formData.append('garment', tryOnGarment);
      formData.append('category', tryOnCategory);

      const response = await axios.post(`${getBaseURL()}/tryon`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        responseType: 'blob',
      });

      const imageUrl = URL.createObjectURL(response.data);
      setStageImg(imageUrl);
    } catch (error) {
      console.error('AI Error:', error);
      alert(
        'Try-On Photo пока не подключён: эндпоинт /tryon не отвечает.\n' +
        'Эта функция отложена — используйте примерку на аватаре.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  /* ───────── Canvas Rendering (2D режим) ───────── */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!stageImg) {
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, W, H);
    }

    const drawLayers = () => {
      [...layers].forEach((l) => {
        const it = items.find((x) => x.id === l.itemId);
        if (!it) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = toPublicUrl(it.image);
        img.onload = () => {
          const s = l.scale || 1;
          ctx.drawImage(img, l.x, l.y, img.width * s, img.height * s);
        };
      });
    };

    if (stageImg) {
      const bg = new Image();
      bg.crossOrigin = 'anonymous';
      bg.src = stageImg;
      bg.onload = () => {
        const scale = Math.min(W / bg.width, H / bg.height) * zoom;
        const w = bg.width * scale;
        const h = bg.height * scale;
        ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
        drawLayers();
      };
    } else {
      drawLayers();
    }
  }, [stageImg, layers, zoom, items]);

  const onImportFav = () => {
    const added = importFromFavorites();
    setItems(getWardrobe().map((i) => ({ ...i, image: toPublicUrl(i.image) })));
    alert(added > 0 ? `Imported ${added} items` : 'No new items');
  };

  const onClearWardrobe = () => {
    if (window.confirm('Clear all?')) {
      clearWardrobe();
      setItems([]);
      setWorn3d([]);
    }
  };

  const showBody = !stageImg && !profileLoading;

  return (
    <div className={styles.page}>

      <div className={styles.header}>
        <div className={styles.tabs}>
          {['Items', 'Outfits', 'Try-On'].map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className={styles.actions}>
          <button className={styles.tab} onClick={onImportFav}>Import Favorites</button>
          <button className={styles.tab} onClick={() => navigate('/avatar/create')}>
            {isProfileComplete(profile) ? 'Изменить обмеры' : 'Указать обмеры'}
          </button>
          <button className={styles.tab} onClick={onClearWardrobe}>Clear</button>
        </div>
      </div>

      <aside className={styles.left}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input className={styles.searchInput} placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Categories</div>
          <div className={styles.chips}>
            {['All', 'Tops', 'Bottoms', 'Dresses', 'Shoes'].map(c => (
              <button key={c} className={`${styles.chip} ${cat === c ? styles.chipOn : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
        </div>

        {/* Подбор размера для последней надетой вещи */}
        {activeProduct && (
          <div style={{ marginTop: 16 }}>
            <SizeAdvisor product={activeProduct} mode="full" />
          </div>
        )}
      </aside>

      <main className={styles.stageWrap}>

        <div className={styles.toolbar}>
          <button className={styles.toolBtn} onClick={() => setZoom(z => z + 0.1)}>+</button>
          <button className={styles.toolBtn} onClick={() => setZoom(z => Math.max(0.2, z - 0.1))}>-</button>
          <button className={styles.toolBtn} onClick={() => { setStageImg(null); setWorn3d([]); setActiveProduct(null); }}>Clear</button>
        </div>

        <div className={styles.canvasBox}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />

          {/* 3D-примерка: тело строится из обмеров покупателя */}
          {showBody && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
              {isProfileComplete(profile) ? (
                <GlbViewer
                  profile={profile}
                  garments={worn3d}
                  stressMap={stressMap}
                  height="100%"
                />
              ) : (
                <div style={{
                  height: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12,
                  background: '#fafafa',
                }}>
                  <div style={{ fontSize: 15, color: '#374151', textAlign: 'center', maxWidth: 320 }}>
                    Чтобы примерить вещь на своё тело, укажите обмеры —
                    рост, грудь, талию и бёдра.
                  </div>
                  <button
                    className={styles.btn}
                    onClick={() => navigate('/avatar/create')}
                    style={{ background: '#111827', color: '#fff' }}
                  >
                    Указать обмеры
                  </button>
                </div>
              )}
            </div>
          )}

          {/* что надето */}
          {showBody && worn3d.length > 0 && (
            <div style={{
              position: 'absolute', top: 12, left: 12, zIndex: 20,
              background: 'rgba(255,255,255,0.95)', padding: '8px 12px',
              borderRadius: 10, fontSize: 13, border: '1px solid #e5e7eb',
            }}>
              <b>Надето:</b> {worn3d.map(w => w.name).join(' + ')}
            </div>
          )}

          {isTryOnMode && (
            <div style={{
              position: 'absolute',
              bottom: 20,
              left: 20,
              background: 'rgba(255, 255, 255, 0.95)',
              padding: '16px',
              borderRadius: '16px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              width: '240px',
              zIndex: 100,
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', margin: 0 }}>✨ AI Try-On</h3>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                cursor: 'pointer', padding: '8px', border: '1px dashed #ccc', borderRadius: '8px'
              }}>
                {tryOnHuman ? '✅ Human Loaded' : '📸 Upload Human'}
                <input type="file" accept="image/*" hidden onChange={(e) => setTryOnHuman(e.target.files[0])} />
              </label>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                cursor: 'pointer', padding: '8px', border: '1px dashed #ccc', borderRadius: '8px'
              }}>
                {tryOnGarment ? '✅ Garment Loaded' : '👗 Upload Garment'}
                <input type="file" accept="image/*" hidden onChange={(e) => setTryOnGarment(e.target.files[0])} />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>Category:</label>
                <select
                  value={tryOnCategory}
                  onChange={(e) => setTryOnCategory(e.target.value)}
                  style={{ padding: '8px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '13px', outline: 'none' }}
                >
                  <option value="upper_body">Верх (Tops)</option>
                  <option value="lower_body">Низ (Bottoms)</option>
                  <option value="dresses">Платья (Dresses)</option>
                </select>
              </div>

              <button
                onClick={handleGenerateAI}
                disabled={isGenerating || !tryOnHuman || !tryOnGarment}
                style={{
                  background: isGenerating ? '#9ca3af' : '#7c3aed',
                  color: 'white', border: 'none', padding: '10px',
                  borderRadius: '8px', fontWeight: 'bold',
                  cursor: isGenerating ? 'not-allowed' : 'pointer', marginTop: '4px'
                }}
              >
                {isGenerating ? '⏳ Generating...' : '🚀 GENERATE'}
              </button>

              <button
                onClick={() => setIsTryOnMode(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '12px', color: '#6b7280', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Cancel
              </button>
            </div>
          )}

        </div>
      </main>

      <aside className={styles.right}>
        <div className={styles.panelHeader}>
          <strong>Your Wardrobe</strong>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: '#6b7280' }}>
            Гардероб пуст. Добавьте вещи кнопкой «👗 Add» в каталоге.
          </div>
        )}
        {filtered.map(it => {
          const worn = isWorn(it.id);
          const has3d = !!it.model3d;
          return (
            <div key={it.id} className={styles.card}>
              <img className={styles.thumb} src={toPublicUrl(it.image)} alt={it.name} />
              <div>
                <div className={styles.cardTitle}>{it.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                  <button
                    className={styles.chip}
                    style={{
                      fontSize: 11,
                      background: worn ? '#111827' : undefined,
                      color: worn ? '#fff' : undefined,
                      opacity: has3d ? 1 : 0.5,
                    }}
                    onClick={() => wearIn3D(it)}
                    title={has3d ? 'Примерить на аватар' : 'Нет 3D-модели'}
                  >
                    {worn ? '✓ Снять' : '🧍 Примерить'}
                  </button>
                  <button
                    className={styles.chip}
                    style={{ fontSize: 11 }}
                    onClick={() => setLayers([...layers, { itemId: it.id, x: 100, y: 100, scale: 0.5 }])}
                    title="Наложить на фото (2D)"
                  >
                    2D
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </aside>

      <div className={styles.bottom}>
        <button
          className={`${styles.btn} ${isTryOnMode ? styles.primary : ''}`}
          onClick={() => setIsTryOnMode(!isTryOnMode)}
        >
          {isTryOnMode ? '❌ Close AI Mode' : '✨ Try-On Photo (AI)'}
        </button>

        <button className={styles.btn} onClick={() => {
          if (!worn3d.length) return alert('Сначала примерьте вещи');
          addOutfit({ items: worn3d.map(w => w.id), createdAt: Date.now() });
          alert('Образ сохранён');
        }}>Save Look</button>

        <button className={styles.btn} onClick={() => alert('Export function here')}>Export PNG</button>
      </div>

    </div>
  );
}

/** Тип вещи по категории, если продавец не указал garmentType */
function guessType(category = '') {
  const c = String(category).toLowerCase();
  if (c.includes('dress')) return 'dress';
  if (c.includes('bottom') || c.includes('pant') || c.includes('skirt') || c.includes('jean')) return 'bottom';
  if (c.includes('shoe') || c.includes('boot')) return 'shoes';
  if (c.includes('coat') || c.includes('jacket') || c.includes('outer')) return 'outerwear';
  return 'top';
}
