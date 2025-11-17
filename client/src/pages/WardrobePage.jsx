import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Wardrobe.module.css';

import {
  getWardrobe, saveWardrobe,
  removeFromWardrobe, clearWardrobe, importFromFavorites,
  addOutfit
} from '../utils/wardrobeStorage';

// API base so /uploads/... become absolute
const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (s?.startsWith('/uploads') ? `${API_BASE}${s}` : s);

// Colorways palette
const PALETTE = ['#111827','#EF4444','#F59E0B','#10B981','#3B82F6','#8B5CF6','#F472B6','#6B7280','#F3F4F6'];

export default function WardrobePage() {
  const navigate = useNavigate();

  /* ───────── Tabs ───────── */
  const [tab, setTab] = useState('Items'); // Items | Outfits | Try-On

  /* ───────── Filters ───────── */
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [colors, setColors] = useState([]);

  /* ───────── Wardrobe items (LocalStorage) ───────── */
  const [items, setItems] = useState(() =>
    getWardrobe().map(i => ({ ...i, image: toPublicUrl(i.image) }))
  );
  useEffect(() => { saveWardrobe(items); }, [items]);

  const filtered = useMemo(() => {
    let arr = items;
    if (cat !== 'All') arr = arr.filter(i => (i.category || '').toLowerCase() === cat.toLowerCase());
    if (query.trim()) arr = arr.filter(i => (i.name || '').toLowerCase().includes(query.toLowerCase()));
    if (colors.length) arr = arr.filter(i => (i.tint ? colors.includes(i.tint) : true));
    return arr;
  }, [items, cat, query, colors]);

  /* ───────── Quick actions ───────── */
  const fileRef = useRef(null);
  const onImportFav = () => {
    const added = importFromFavorites();
    setItems(getWardrobe().map(i => ({ ...i, image: toPublicUrl(i.image) })));
    alert(added > 0 ? `Imported ${added} item(s) from Favorites` : 'No new items found.');
  };
  const onUploadPhoto = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setStageImg(ev.target.result);
    r.readAsDataURL(f);
  };

  const onClearWardrobe = () => {
    if (!window.confirm('Clear all saved wardrobe items?')) return;
    clearWardrobe(); setItems([]);
  };

  /* ───────── Stage (photo/avatar + layers) ───────── */
  const canvasRef = useRef(null);
  const [stageImg, setStageImg] = useState(null);
  const [zoom, setZoom] = useState(1);

  // Layers worn on stage
  const [layers, setLayers] = useState([]); // {itemId,x,y,scale,rotation,z,flipH,tint,locked,w0,h0}
  const [selected, setSelected] = useState(null); // index

  // Undo/Redo history
  const [history, setHistory] = useState([JSON.stringify([])]);
  const [redo, setRedo] = useState([]);
  const canUndo = history.length > 1;
  const canRedo = redo.length > 0;
  const commit = (next) => {
    setLayers(next);
    setHistory(h => [...h, JSON.stringify(next)]);
    setRedo([]);
  };
  const undo = () => {
    setHistory(h => {
      if (h.length <= 1) return h;
      const prev = h[h.length - 2];
      setRedo(r => [h[h.length - 1], ...r]);
      setLayers(JSON.parse(prev));
      return h.slice(0, -1);
    });
  };
  const redoStep = () => {
    if (!canRedo) return;
    const nx = redo[0];
    setRedo(r => r.slice(1));
    setLayers(JSON.parse(nx));
    setHistory(h => [...h, nx]);
  };

  // Grid / Snap
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(true);
  const SNAP = 10;
  const snapXY = (x, y) => snap ? [Math.round(x / SNAP) * SNAP, Math.round(y / SNAP) * SNAP] : [x, y];

  const fitToScreen = () => setZoom(1);
  const resetStage = () => { setSelected(null); setZoom(1); commit([]); };

  // Wear item centered
  const wearItem = (it) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = toPublicUrl(it.image);
    img.onload = () => {
      const c = canvasRef.current;
      const w = c?.width ? c.width / (window.devicePixelRatio || 1) : 800;
      const h = c?.height ? c.height / (window.devicePixelRatio || 1) : 600;
      const s = Math.min(1, (w * 0.4) / img.width);
      const next = [
        ...layers,
        {
          itemId: it.id,
          x: w / 2 - (img.width * s) / 2,
          y: h / 2 - (img.height * s) / 2,
          scale: s, rotation: 0, z: (layers.length ? Math.max(...layers.map(l => l.z || 0)) + 1 : 1),
          flipH: false, locked: false,
          w0: img.width, h0: img.height
        },
      ];
      commit(next);
      setSelected(next.length - 1);
    };
  };

  /* ───────── Persist stage ───────── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem('wardrobeLayers');
      if (raw) {
        const { stageImg: si, layers: ls } = JSON.parse(raw);
        if (si) setStageImg(si);
        if (Array.isArray(ls)) {
          setLayers(ls);
          setHistory([JSON.stringify(ls)]);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem('wardrobeLayers', JSON.stringify({ stageImg, layers }));
  }, [stageImg, layers]);

  /* ───────── Render stage ───────── */
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // grid (background) when no photo
    if (!stageImg) {
      ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto';
      ctx.fillText('Upload a full-body photo or generate an avatar to start trying on.', 16, 28);
    }

    const drawLayers = () => {
      [...layers].sort((a,b)=> (a.z||0) - (b.z||0)).forEach(l => {
        const it = items.find(x => x.id === l.itemId);
        if (!it) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = toPublicUrl(it.image);
        const s = Math.abs(l.scale || 1);
        const w = (l.w0 || 0) * s, h = (l.h0 || 0) * s;

        img.onload = () => {
          ctx.save();
          ctx.translate(l.x + w / 2, l.y + h / 2);
          ctx.rotate(((l.rotation || 0) * Math.PI) / 180);
          ctx.scale(l.flipH ? -1 : 1, 1);

          if (l.tint) {
            ctx.fillStyle = l.tint;
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillRect(-w/2, -h/2, w, h);
            ctx.globalCompositeOperation = 'destination-atop';
          }
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.restore();
        };
      });
    };

    if (stageImg) {
      const bg = new Image();
      bg.crossOrigin = 'anonymous';
      bg.src = toPublicUrl(stageImg);
      bg.onload = () => {
        const scale = Math.min(W / bg.width, H / bg.height) * zoom;
        const w = bg.width * scale, h = bg.height * scale;
        ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
        drawLayers();
      };
    } else {
      drawLayers();
    }
  }, [stageImg, layers, zoom, items]);

  /* ───────── Selection & drag ───────── */
  const drag = useRef({ on:false, dx:0, dy:0 });
  const handleDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.locked) continue;
      const s = Math.abs(l.scale || 1);
      const w = (l.w0 || 0) * s, h = (l.h0 || 0) * s;
      if (x >= l.x && x <= l.x + w && y >= l.y && y <= l.y + h) {
        setSelected(i);
        drag.current = { on: true, dx: x - l.x, dy: y - l.y };
        return;
      }
    }
    setSelected(null);
  };
  const handleMove = (e) => {
    if (!drag.current.on || selected == null) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const [nx, ny] = snapXY(x - drag.current.dx, y - drag.current.dy);
    setLayers(prev => prev.map((l, i) => i === selected ? { ...l, x: nx, y: ny } : l));
  };
  const handleUp = () => {
    if (drag.current.on) {
      drag.current.on = false;
      commit([...layers]);
    }
  };

  // Wheel: zoom stage or scale selected layer
  const wheelCommitRef = useRef(null);
  const handleWheel = (e) => {
    if (selected == null) { setZoom(z => Math.max(0.2, z + (e.deltaY > 0 ? -0.05 : 0.05))); return; }
    e.preventDefault();
    const next = layers.map((l, i) =>
      i === selected ? { ...l, scale: Math.max(0.1, (l.scale || 1) + (e.deltaY > 0 ? -0.05 : 0.05)) } : l
    );
    setLayers(next);
    clearTimeout(wheelCommitRef.current);
    wheelCommitRef.current = setTimeout(() => commit(next), 250);
  };

  /* ───────── Export / Save / Share ───────── */
  const exportPNG = () => {
    const url = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = 'look.png'; a.click();
  };
  const saveLook = () => {
    const cover = canvasRef.current.toDataURL('image/png');
    const outfit = addOutfit({
      title: `Look ${new Date().toLocaleString()}`,
      cover, layers, createdAt: Date.now()
    });
    alert(`Saved outfit: ${outfit.title}`);
  };
  const sharePNG = async () => {
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const res = await fetch(dataUrl); const blob = await res.blob();
      const file = new File([blob],'look.png',{type:'image/png'});
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'ProjectSilk Look' });
      } else {
        const a = document.createElement('a'); a.href = dataUrl; a.download = 'look.png'; a.click();
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className={styles.page}>
      {/* ───── Header ───── */}
      <div className={styles.header}>
        <div className={styles.tabs}>
          {['Items','Outfits','Try-On'].map(t => (
            <button key={t} className={`${styles.tab} ${tab===t?styles.tabActive:''}`} onClick={()=>setTab(t)}>{t}</button>
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.tab} onClick={onImportFav} title="Add items from Favorites">Import from Favorites</button>
          <button className={styles.tab} disabled title="Coming soon">Import from Orders</button>
          <label className={styles.tab} title="Upload a full-body photo">
            Upload Photo
            <input ref={fileRef} type="file" accept="image/*" onChange={onUploadPhoto} style={{ display: 'none' }} />
          </label>

          <button
            className={styles.tab}
            onClick={() => navigate('/avatar/create')}
            title="Open avatar wizard"
          >
            Generate Avatar
          </button>

          <button className={styles.tab} onClick={onClearWardrobe} title="Clear saved wardrobe">Clear Wardrobe</button>
        </div>
      </div>

      {/* ───── Left filters ───── */}
      <aside className={styles.left}>
        <div className={styles.searchBox} role="search">
          <span className={styles.searchIcon} aria-hidden>🔍</span>
          <input
            className={styles.searchInput}
            placeholder="Search items…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search wardrobe items"
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery('')}
              aria-label="Clear search"
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>

        <div>
          <div style={{fontWeight:600, marginBottom:8}}>Categories</div>
          <div className={styles.chips}>
            {['All','Tops','Bottoms','Dresses','Shoes','Accessories'].map(c =>
              <button key={c} className={`${styles.chip} ${cat===c?styles.chipOn:''}`} onClick={()=>setCat(c)}>{c}</button>
            )}
          </div>
        </div>

        <div>
          <div style={{fontWeight:600, marginBottom:8}}>Colors</div>
          <div className={styles.swatches}>
            {PALETTE.map(hex => (
              <button
                key={hex}
                className={`${styles.swatch} ${colors.includes(hex)?'on':''}`}
                style={{ background: hex }}
                onClick={() => setColors(prev => prev.includes(hex) ? prev.filter(c=>c!==hex) : [...prev, hex])}
                aria-label={`filter ${hex}`}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* ───── Stage ───── */}
      <main className={styles.stageWrap}>
        <div className={styles.toolbar}>
          <button className={styles.toolBtn} onClick={()=>setZoom(z=>z+0.1)} title="Zoom in">＋</button>
          <button className={styles.toolBtn} onClick={()=>setZoom(z=>Math.max(0.2,z-0.1))} title="Zoom out">－</button>
          <button className={styles.toolBtn} onClick={fitToScreen} title="Fit to screen">Fit</button>
          <button className={styles.toolBtn} onClick={resetStage} title="Reset stage">Reset</button>

          <button className={`${styles.toolBtn} ${showGrid?styles.on:''}`} onClick={()=>setShowGrid(v=>!v)} title="Toggle grid">Grid</button>
          <button className={`${styles.toolBtn} ${snap?styles.on:''}`} onClick={()=>setSnap(v=>!v)} title="Snap to grid">Snap</button>
          <button className={styles.toolBtn} onClick={undo} disabled={!canUndo} title="Undo">↶</button>
          <button className={styles.toolBtn} onClick={redoStep} disabled={!canRedo} title="Redo">↷</button>
        </div>

        <div className={styles.canvasBox}>
          <canvas
            ref={canvasRef}
            style={{ width:'100%', height:'100%', cursor: selected!=null ? 'move' : 'default' }}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onWheel={handleWheel}
          />
          {showGrid && <div className={styles.gridOverlay} />}
        </div>
      </main>

      {/* ───── Right panel ───── */}
      <aside className={styles.right}>
        <div className={styles.panelHeader}>
          <strong>Your Wardrobe</strong>
          <div className={styles.chips}>
            <button
              className={styles.chip}
              onClick={() => setItems(getWardrobe().map(i => ({ ...i, image: toPublicUrl(i.image) })))}
            >
              Refresh
            </button>
            <button className={styles.chip} onClick={() => { setItems([]); clearWardrobe(); }}>
              Remove All
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <>
            <p style={{color:'#6b7280', marginBottom:8}}>
              Your wardrobe is empty. Add items from Favorites or product cards.
            </p>
            <button className={styles.chip} onClick={onImportFav}>Import from Favorites</button>
          </>
        ) : (
          filtered.map(it => (
            <div key={it.id} className={styles.card}>
              <img className={styles.thumb} src={toPublicUrl(it.image)} alt={it.name} />
              <div>
                <div className={styles.cardTitle}>{it.name}</div>
                <div style={{color:'#6b7280', fontSize:12}}>
                  {it.category || '—'} {it.price ? `• ${Number(it.price).toLocaleString('en-US')} ₸` : ''}
                </div>
                <div className={styles.cardRow} style={{marginTop:8}}>
                  <button className={styles.chip} onClick={()=>wearItem(it)}>Wear</button>
                  <button className={styles.chip} onClick={()=>alert('Colorways: soon')}>Colorways</button>
                  <button className={styles.chip} onClick={()=>navigate('/tryon/ar')}>AR</button>
                  <button
                    className={styles.chip}
                    onClick={()=>{
                      removeFromWardrobe(it.id);
                      setItems(getWardrobe().map(i=>({ ...i, image: toPublicUrl(i.image) })));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </aside>

      {/* ───── Bottom bar ───── */}
      <div className={styles.bottom}>
        <button className={styles.btn} onClick={() => fileRef.current?.click()} title="Use a photo">Try-On Photo</button>
        <button className={styles.btn} onClick={() => navigate('/tryon/ar')} title="Open AR">Try-On AR</button>
        <button className={styles.btn} onClick={() => navigate('/tryon/avatar')} title="Use avatar">Try-On Avatar</button>
        <button className={`${styles.btn} ${styles.primary}`} onClick={saveLook} title="Save to Outfits">Save Look</button>
        <button className={styles.btn} onClick={sharePNG} title="Share/download">Share</button>
        <button className={styles.btn} onClick={exportPNG} title="Export PNG">Export PNG</button>
        <button className={styles.btn} onClick={() => commit([])} title="Remove layers">Clear Stage</button>
      </div>
    </div>
  );
}