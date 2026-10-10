// client/src/pages/WardrobePage.jsx
//
// Rebuilt to match the WARDROBE · AVATAR screen in projectsilk_v11.html.
//
// What the mock has that the old page was missing:
//
//   1. THE THREE TRY-IT-ON MODES — "On my avatar", "On my photo",
//      "In live camera". These are the product. They were nowhere on screen.
//      Camera is accented because it is available, not decoration.
//
//   2. "WORN NOW" IN THE LEFT COLUMN instead of search and filters. A
//      wardrobe holds a handful of items; what matters is what is on the
//      figure right now and in which layer order.
//
//   3. THE FIT BOX in the right column — size letter, verdict, one bar per
//      measurement with the actual ease in centimetres, and a size row where
//      unwearable sizes are dimmed. This is the whole point of the product
//      and it used to be a single small line of text.
//
//   4. MEASUREMENTS STRIP under the stage, and an overflow menu so rare
//      actions (import, export, clear) stop crowding the header.
//
// Everything the old page could do is still here: 2D photo composition,
// AI photo try-on, saved outfits, importing favourites.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import styles from './Wardrobe.module.css';
import GlbViewer from '../components/GlbViewer';
import { getBaseURL } from '../assistant/api';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { findBestSize, getStressMap } from '../utils/fitCalculator';
import {
  getWardrobe, saveWardrobe, clearWardrobe, importFromFavorites, addOutfit,
} from '../utils/wardrobeStorage';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s || '').startsWith('/uploads') ? `${API_BASE}${s}` : s);

const LABELS = { chest: 'Bust', waist: 'Waist', hips: 'Hips' };
const LAYER_NAME = { 1: 'base layer', 2: 'mid layer', 3: 'outer layer' };

export default function WardrobePage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState('avatar');       // avatar | photo
  const [items, setItems] = useState(() =>
    getWardrobe().map((i) => ({ ...i, image: toPublicUrl(i.image) })));

  // Catalog is the source of truth for size charts: addToWardrobe() does not
  // store sizeChart in localStorage.
  const [catalog, setCatalog] = useState([]);

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [worn, setWorn] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [chosenSize, setChosenSize] = useState(null);

  const [rings, setRings] = useState(true);
  const [back, setBack] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const [stageImg, setStageImg] = useState(null);
  const [layers, setLayers] = useState([]);

  const [aiHuman, setAiHuman] = useState(null);
  const [aiGarment, setAiGarment] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => { saveWardrobe(items); }, [items]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await loadBodyProfile();
      if (alive) { setProfile(p); setProfileLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/products`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (alive) setCatalog(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setCatalog([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Wardrobe items enriched with fresh catalog data, matched by id.
  const view = useMemo(() => {
    const byId = new Map(catalog.map((c) => [String(c._id || c.id), c]));
    return items.map((it) => {
      const c = byId.get(String(it.id));
      if (!c) return it;
      return {
        ...it,
        name: c.name || c.title || it.name,
        price: c.price ?? it.price,
        model3d: c.model3d || it.model3d,
        garmentType: c.garmentType || it.garmentType || guessType(c.category || it.category),
        sizeChart: Array.isArray(c.sizeChart) && c.sizeChart.length ? c.sizeChart : it.sizeChart,
      };
    });
  }, [items, catalog]);

  const ready = isProfileComplete(profile);
  const active = view.find((i) => i.id === activeId) || null;

  // ── fit ──
  const fit = useMemo(() => {
    if (!active?.sizeChart?.length || !ready) return null;
    return findBestSize(profile, active.sizeChart, chosenSize);
  }, [active, profile, chosenSize, ready]);

  const shown = fit?.chosen || fit?.recommended || null;
  const stressMap = useMemo(
    () => (rings && shown ? getStressMap(shown) : null),
    [rings, shown],
  );

  const wornPrice = worn.reduce((sum, w) => sum + Number(w.price || 0), 0);

  /* ───────── wear / take off ───────── */
  const toggleWear = (item) => {
    if (worn.some((w) => w.id === item.id)) {
      setWorn((p) => p.filter((w) => w.id !== item.id));
      if (activeId === item.id) { setActiveId(null); setChosenSize(null); }
      return;
    }

    setActiveId(item.id);
    setChosenSize(null);

    // An item with no 3D model can still be selected: the fit verdict comes
    // from the seller's size chart, geometry is not involved.
    if (!item.model3d) return;

    const type = item.garmentType || guessType(item.category);
    const entry = {
      id: item.id,
      name: item.name,
      price: item.price,
      url: toPublicUrl(item.model3d),
      garmentType: type,
      layer: item.layer || (type === 'outerwear' ? 3 : type === 'top' ? 2 : 1),
      fit: item.fit || 'regular',
    };

    setWorn((prev) => {
      let next = prev.filter((w) => w.garmentType !== type);
      if (type === 'dress') next = next.filter((w) => !['top', 'bottom'].includes(w.garmentType));
      if (['top', 'bottom'].includes(type)) next = next.filter((w) => w.garmentType !== 'dress');
      return [...next, entry].sort((a, b) => a.layer - b.layer);
    });
  };

  const isWorn = (id) => worn.some((w) => w.id === id);

  /* ───────── AI photo try-on ───────── */
  const runPhotoTryOn = async () => {
    if (!aiHuman || !aiGarment) return;
    setAiBusy(true);
    try {
      const fd = new FormData();
      fd.append('human', aiHuman);
      fd.append('garment', aiGarment);
      fd.append('category', 'dresses');
      const res = await axios.post(`${getBaseURL()}/tryon`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        responseType: 'blob',
      });
      setStageImg(URL.createObjectURL(res.data));
    } catch {
      alert('Photo try-on is not connected yet — the /tryon endpoint is not responding.');
    } finally {
      setAiBusy(false);
    }
  };

  /* ───────── 2D canvas ───────── */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;

    c.width = W * dpr;
    c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const drawLayers = () => {
      layers.forEach((l) => {
        const it = items.find((x) => x.id === l.itemId);
        if (!it) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = toPublicUrl(it.image);
        img.onload = () => ctx.drawImage(img, l.x, l.y, img.width * (l.scale || 1), img.height * (l.scale || 1));
      });
    };

    if (stageImg) {
      const bg = new Image();
      bg.crossOrigin = 'anonymous';
      bg.src = stageImg;
      bg.onload = () => {
        const s = Math.min(W / bg.width, H / bg.height);
        ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
        drawLayers();
      };
    } else {
      drawLayers();
    }
  }, [stageImg, layers, items]);

  const refresh = () => setItems(getWardrobe().map((i) => ({ ...i, image: toPublicUrl(i.image) })));

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <div className={styles.page}>
      <div className={styles.app}>

        {/* ── header ── */}
        <header className={styles.ahdr}>
          <div className={styles.alogo}>
            <i />
            ProjectSilk
            <span className={styles.pgt}>Wardrobe</span>
          </div>

          <div className={styles.hdrRight}>
            <button className={styles.gbtn} onClick={() => navigate('/')}>← Shop</button>

            <details className={styles.menu}>
              <summary title="More">···</summary>
              <div className={styles.mpop}>
                <button className={styles.mitem} onClick={() => { importFromFavorites(); refresh(); }}>
                  Import from favourites
                </button>
                <button className={styles.mitem} onClick={() => alert('Export is not wired up yet')}>
                  Export image
                </button>
                <button
                  className={styles.mitem}
                  onClick={() => {
                    if (!window.confirm('Remove every item from your wardrobe?')) return;
                    clearWardrobe(); setItems([]); setWorn([]); setActiveId(null);
                  }}
                >
                  Clear all
                </button>
              </div>
            </details>
          </div>
        </header>

        {/* ── try-it-on modes ── */}
        <div className={styles.modes}>
          <span className={styles.modesLb}>Try it on:</span>

          <button
            className={`${styles.md} ${mode === 'avatar' ? styles.mdOn : ''}`}
            onClick={() => { setMode('avatar'); setStageImg(null); }}
          >
            ◍ On my avatar
          </button>

          <button
            className={`${styles.md} ${mode === 'photo' ? styles.mdOn : ''}`}
            onClick={() => setMode('photo')}
          >
            ▣ On my photo
          </button>

          <button
            className={`${styles.md} ${styles.mdCam}`}
            onClick={() => navigate('/tryon/ar')}
          >
            ◎ In live camera <span className={styles.ex}>↗ opens camera page</span>
          </button>

          <span className={styles.modesRt}>
            Avatar and camera are free · photo has a daily limit
          </span>
        </div>

        <div className={styles.cols}>

          {/* ── left: worn now ── */}
          <aside className={styles.cl}>
            <div className={styles.lbl}>Worn now · {worn.length}</div>

            {worn.length === 0 ? (
              <p className={styles.tiny}>Nothing on the figure yet. Pick an item on the right.</p>
            ) : (
              <>
                {worn.map((w) => (
                  <div key={w.id} className={`${styles.it} ${activeId === w.id ? styles.itOn : ''}`}>
                    <img
                      className={styles.th}
                      src={toPublicUrl(items.find((i) => i.id === w.id)?.image)}
                      alt=""
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.nm}>{w.name}</div>
                      <div className={styles.sb}>{LAYER_NAME[w.layer] || 'base layer'}</div>
                    </div>
                  </div>
                ))}
                <p className={styles.tiny} style={{ margin: '8px 0 0' }}>
                  Layered automatically — tops go over what is worn underneath.
                </p>
              </>
            )}

            <div className={styles.grow} />
            <button className={`${styles.gbtn} ${styles.wide}`} onClick={() => navigate('/')}>
              + Add from shop
            </button>
          </aside>

          {/* ── centre: stage ── */}
          <div className={styles.cc}>
            <div className={styles.stage} ref={stageRef}>

              <div className={styles.sttop}>
                <span className={styles.stH}>
                  {worn.length
                    ? `Wearing ${worn.map((w) => w.name).join(' + ')}`
                    : 'Drag to rotate · scroll to zoom'}
                </span>
                <button className={styles.tl} title="Reset view" onClick={() => setResetKey((k) => k + 1)}>⟲</button>
                <button className={styles.tl} title="Front / back" onClick={() => setBack((b) => !b)}>⇄</button>
                <button className={styles.tl} title="Fullscreen" onClick={toggleFullscreen}>⤢</button>
              </div>

              {mode === 'photo' ? (
                <div className={styles.photoCol}>
                  <label className={`${styles.drop} ${aiHuman ? styles.dropOn : ''}`}>
                    <strong>{aiHuman ? 'Photo of you added' : 'Add a photo of you'}</strong>
                    <small>Full length, plain background, arms away from the body.</small>
                    <input type="file" accept="image/*" hidden onChange={(e) => setAiHuman(e.target.files[0])} />
                  </label>

                  <label className={`${styles.drop} ${aiGarment ? styles.dropOn : ''}`}>
                    <strong>{aiGarment ? 'Garment photo added' : 'Add a garment photo'}</strong>
                    <small>The item laid flat or on a hanger works best.</small>
                    <input type="file" accept="image/*" hidden onChange={(e) => setAiGarment(e.target.files[0])} />
                  </label>

                  <button
                    className={`${styles.gbtn} ${styles.dark}`}
                    onClick={runPhotoTryOn}
                    disabled={aiBusy || !aiHuman || !aiGarment}
                  >
                    {aiBusy ? 'Working…' : 'Try it on'}
                  </button>

                  <span className={styles.quota}>Photo try-on is limited to a few runs a day</span>
                </div>
              ) : ready ? (
                <div className={styles.canvasBox}>
                  <GlbViewer
                    profile={profile}
                    garments={worn}
                    stressMap={stressMap}
                    height="100%"
                    background="#FDFCFB"
                    fill={0.9}
                    back={back}
                    resetKey={String(resetKey)}
                  />
                </div>
              ) : profileLoading ? (
                <span className={styles.tiny}>Loading measurements…</span>
              ) : (
                <div className={styles.stageEmpty}>
                  <strong>Add your measurements</strong>
                  <span className={styles.tiny}>
                    The figure is built from four numbers: height, bust, waist, hips.
                    Without them there is nothing to try clothes on.
                  </span>
                  <button className={`${styles.gbtn} ${styles.dark}`} onClick={() => navigate('/avatar/create')}>
                    Add measurements
                  </button>
                </div>
              )}

              {stageImg && <canvas ref={canvasRef} className={styles.canvasBox} />}

              {mode === 'avatar' && ready && (
                <div className={styles.stbot}>
                  <button
                    className={`${styles.gbtn} ${styles.sm} ${rings ? styles.dark : ''}`}
                    onClick={() => setRings((r) => !r)}
                  >
                    {rings ? 'Fit rings on' : 'Fit rings off'}
                  </button>
                  <span className={styles.tiny} style={{ marginLeft: 'auto' }}>
                    Rings mark where fabric pulls
                  </span>
                </div>
              )}
            </div>

            {ready && (
              <div className={styles.mstrip}>
                <M k="Height" v={profile.heightCm} />
                <M k="Bust" v={profile.chest} />
                <M k="Waist" v={profile.waist} />
                <M k="Hips" v={profile.hips} />
                <button className={styles.ed} onClick={() => navigate('/avatar/create')}>Edit</button>
              </div>
            )}
          </div>

          {/* ── right: fit + wardrobe ── */}
          <aside className={styles.cr}>
            {active && (
              <>
                <div className={styles.lbl}>Fit</div>
                {fit?.all?.length ? (
                  <div className={styles.box} style={{ marginBottom: 16 }}>
                    <div className={styles.vh}>
                      <div>
                        <div className={styles.vsz}>{shown?.size || '—'}</div>
                        <div className={styles.vsb}>{active.name}</div>
                      </div>
                      <span className={`${styles.vbd} ${fit.shouldWarn ? styles.vbdWarn : ''}`}>
                        {shown?.text || ''}
                      </span>
                    </div>

                    {shown && Object.entries(shown.parts).map(([key, part]) => (
                      <div className={styles.bar2} key={key}>
                        <span>{LABELS[key] || key}</span>
                        <span className={styles.trk}>
                          <i className={styles.fl} style={{ width: easeWidth(part.ease), background: part.color }} />
                        </span>
                        <span className={styles.barN}>{part.ease > 0 ? '+' : ''}{part.ease} cm</span>
                      </div>
                    ))}

                    <p className={styles.tiny} style={{ margin: '9px 0 0' }}>{fit.message}</p>

                    <div className={styles.szrow}>
                      {fit.all.map((s) => (
                        <button
                          key={s.size}
                          className={[
                            styles.sz,
                            chosenSize === s.size ? styles.szOn : '',
                            s.wearable ? '' : styles.szDim,
                          ].join(' ')}
                          onClick={() => setChosenSize(s.size === chosenSize ? null : s.size)}
                          title={s.text}
                        >
                          {s.size}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={styles.callout}>
                    {active.name} has no size chart — the seller did not enter the
                    garment measurements, so we cannot check the fit.
                  </div>
                )}
              </>
            )}

            <div className={styles.lbl}>Wardrobe · {view.length}</div>

            {view.length === 0 ? (
              <p className={styles.tiny}>
                Your wardrobe is empty. Use “Wardrobe” on any product card to save items here.
              </p>
            ) : view.map((it) => {
              const on = isWorn(it.id);
              const has3d = !!it.model3d;
              return (
                <div key={it.id} className={`${styles.it} ${activeId === it.id ? styles.itOn : ''}`}>
                  <img className={styles.th} src={toPublicUrl(it.image)} alt="" />
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.nm}>{it.name}</div>
                    <div className={`${styles.sb} ${has3d ? '' : styles.sbWarn}`}>
                      {has3d
                        ? `${Number(it.price || 0).toLocaleString('en-US')} ₸ · ${it.garmentType || guessType(it.category)}`
                        : 'No 3D model yet'}
                    </div>
                    <div className={styles.ac}>
                      <button className={`${styles.gbtn} ${styles.sm}`} onClick={() => toggleWear(it)}>
                        {on ? 'Take off' : has3d ? 'Wear' : 'Check size'}
                      </button>
                      <button
                        className={`${styles.gbtn} ${styles.sm}`}
                        onClick={() => setLayers([...layers, { itemId: it.id, x: 100, y: 100, scale: 0.5 }])}
                        title="Place on the photo"
                      >
                        2D
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className={styles.grow} />
          </aside>
        </div>

        {/* ── footer ── */}
        <div className={styles.foot}>
          <button
            className={styles.gbtn}
            onClick={() => {
              if (!worn.length) return alert('Put something on the figure first');
              addOutfit({ items: worn.map((w) => w.id), createdAt: Date.now() });
              alert('Look saved');
            }}
          >
            Save look
          </button>
          <button
            className={`${styles.gbtn} ${styles.dark}`}
            onClick={() => navigate('/cart')}
            disabled={!worn.length}
          >
            Add to cart{wornPrice ? ` · ${wornPrice.toLocaleString('en-US')} ₸` : ''}
          </button>
        </div>

      </div>
    </div>
  );
}

function M({ k, v }) {
  return (
    <div className={styles.m}>
      <div className={styles.mk}>{k}</div>
      <div className={styles.mv}>{v}<u>cm</u></div>
    </div>
  );
}

/** Bar width: ease from −5 to +20 cm spread across the track. */
function easeWidth(ease) {
  const pct = ((Number(ease) + 5) / 25) * 100;
  return `${Math.max(5, Math.min(100, pct))}%`;
}

function guessType(category = '') {
  const c = String(category).toLowerCase();
  if (c.includes('dress')) return 'dress';
  if (c.includes('bottom') || c.includes('pant') || c.includes('skirt') || c.includes('jean')) return 'bottom';
  if (c.includes('shoe') || c.includes('boot')) return 'shoes';
  if (c.includes('coat') || c.includes('jacket') || c.includes('outer')) return 'outerwear';
  return 'top';
}
