import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Wardrobe.module.css';
import GlbViewer from '../components/GlbViewer';
import axios from 'axios';
import { getBaseURL } from '../assistant/api'; 

import {
  getWardrobe,
  saveWardrobe,
  removeFromWardrobe,
  clearWardrobe,
  importFromFavorites,
  addOutfit,
} from '../utils/wardrobeStorage';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') =>
  s?.startsWith('/uploads') ? `${API_BASE}${s}` : s;

function loadAvatarInfo() {
  try {
    const rawFinal = localStorage.getItem('avatarFinal');
    if (rawFinal) {
      const metaRaw = JSON.parse(rawFinal);
      const glb = metaRaw.glb ? toPublicUrl(metaRaw.glb) : null;
      return { url: glb, meta: { ...metaRaw, glb } };
    }
    const rawWardrobe = localStorage.getItem('wardrobeAvatar');
    if (rawWardrobe) {
      const old = JSON.parse(rawWardrobe);
      const glb = old.model3d ? toPublicUrl(old.model3d) : null;
      return { url: glb, meta: { id: old.id, preview: old.image ? toPublicUrl(old.image) : '', glb } };
    }
    // ИСПРАВЛЕНИЕ: Возвращаем локальный путь к файлу в папке public
    return { url: '/uploads/stub/avatar.glb', meta: null };
  } catch {
    // ИСПРАВЛЕНИЕ: То же самое для блока ошибки
    return { url: '/uploads/stub/avatar.glb', meta: null };
  }
}

const PALETTE = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#F472B6', '#6B7280', '#F3F4F6'];

export default function WardrobePage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState('Items'); 
  const [items, setItems] = useState(() => getWardrobe().map((i) => ({ ...i, image: toPublicUrl(i.image) })));
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [colors, setColors] = useState([]);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarMeta, setAvatarMeta] = useState(null);

  const canvasRef = useRef(null);
  const [stageImg, setStageImg] = useState(null); 
  const [layers, setLayers] = useState([]); 
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState(null);

  // 🌟 AI Try-On Logic
  const [isTryOnMode, setIsTryOnMode] = useState(false); 
  const [tryOnHuman, setTryOnHuman] = useState(null);    
  const [tryOnGarment, setTryOnGarment] = useState(null);
  const [tryOnCategory, setTryOnCategory] = useState('upper_body');
  const [isGenerating, setIsGenerating] = useState(false); 

  useEffect(() => {
    saveWardrobe(items);
  }, [items]);

  useEffect(() => {
    const { url, meta } = loadAvatarInfo();
    setAvatarUrl(url);
    setAvatarMeta(meta);
  }, []);

  const filtered = useMemo(() => {
    let arr = items;
    if (cat !== 'All') arr = arr.filter((i) => (i.category || '').toLowerCase() === cat.toLowerCase());
    if (query.trim()) arr = arr.filter((i) => (i.name || '').toLowerCase().includes(query.toLowerCase()));
    if (colors.length) arr = arr.filter((i) => (i.tint ? colors.includes(i.tint) : true));
    return arr;
  }, [items, cat, query, colors]);

  /* ───────── AI Generation Function ───────── */
  const handleGenerateAI = async () => {
    if (!tryOnHuman || !tryOnGarment) {
      alert("Please upload both Human and Garment photos first!");
      return;
    }
    
    setIsGenerating(true);
    
    try {
      const formData = new FormData();
      formData.append("human", tryOnHuman);
      formData.append("garment", tryOnGarment);
      formData.append("category", tryOnCategory);

      const response = await axios.post(`${getBaseURL()}/tryon`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "blob",
      });

      const imageUrl = URL.createObjectURL(response.data);
      setStageImg(imageUrl); 
      
    } catch (error) {
      console.error("AI Error:", error);
      alert("Connection failed. Check if Lightning AI server is running!");
    } finally {
      setIsGenerating(false);
    }
  };

  /* ───────── Canvas Rendering ───────── */
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
      if (!avatarUrl) { 
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Upload a photo or generate avatar', W/2, H/2);
      }
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
             ctx.drawImage(img, l.x, l.y, img.width*s, img.height*s);
        }
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
  }, [stageImg, layers, zoom, items, avatarUrl]);

  const onImportFav = () => {
    const added = importFromFavorites();
    setItems(getWardrobe().map((i) => ({ ...i, image: toPublicUrl(i.image) })));
    alert(added > 0 ? `Imported ${added} items` : 'No new items');
  };

  const onClearWardrobe = () => {
    if (window.confirm('Clear all?')) {
      clearWardrobe();
      setItems([]);
    }
  };
  
  const onUploadPhotoStandard = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      const r = new FileReader();
      r.onload = (ev) => setStageImg(ev.target.result);
      r.readAsDataURL(f);
    }
  };

  return (
    <div className={styles.page}>
      
      <div className={styles.header}>
        <div className={styles.tabs}>
          {['Items', 'Outfits', 'Try-On'].map(t => (
            <button key={t} className={`${styles.tab} ${tab===t ? styles.tabActive : ''}`} onClick={()=>setTab(t)}>{t}</button>
          ))}
        </div>
        <div className={styles.actions}>
          <button className={styles.tab} onClick={onImportFav}>Import Favorites</button>
          <button className={styles.tab} onClick={() => navigate('/avatar/create')}>Generate Avatar</button>
          <button className={styles.tab} onClick={onClearWardrobe}>Clear</button>
        </div>
      </div>

      <aside className={styles.left}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input className={styles.searchInput} placeholder="Search..." value={query} onChange={e=>setQuery(e.target.value)} />
        </div>
        <div>
           <div style={{fontWeight:600, marginBottom:8}}>Categories</div>
           <div className={styles.chips}>
             {['All','Tops','Bottoms','Dresses','Shoes'].map(c => (
               <button key={c} className={`${styles.chip} ${cat===c?styles.chipOn:''}`} onClick={()=>setCat(c)}>{c}</button>
             ))}
           </div>
        </div>
      </aside>

      <main className={styles.stageWrap}>
        
        <div className={styles.toolbar}>
          <button className={styles.toolBtn} onClick={()=>setZoom(z=>z+0.1)}>+</button>
          <button className={styles.toolBtn} onClick={()=>setZoom(z=>Math.max(0.2, z-0.1))}>-</button>
          <button className={styles.toolBtn} onClick={()=>setStageImg(null)}>Clear</button>
        </div>

        <div className={styles.canvasBox}>
          <canvas ref={canvasRef} style={{width:'100%', height:'100%'}} />

          {/* ИСПРАВЛЕНИЕ: zIndex позволяет взаимодействовать с 3D моделью */}
          {!stageImg && avatarUrl && (
             <div style={{position:'absolute', inset:0, zIndex: 10}}>
                <GlbViewer url={avatarUrl} height="100%" />
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
              <h3 style={{fontSize:'14px', fontWeight:'bold', margin:0}}>✨ AI Try-On</h3>
              
              <label style={{
                 display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', 
                 cursor:'pointer', padding:'8px', border:'1px dashed #ccc', borderRadius:'8px'
              }}>
                 {tryOnHuman ? '✅ Human Loaded' : '📸 Upload Human'}
                 <input type="file" accept="image/*" hidden onChange={(e)=>setTryOnHuman(e.target.files[0])} />
                 {tryOnHuman && <img src={URL.createObjectURL(tryOnHuman)} style={{width:30, height:30, borderRadius:4, objectFit:'cover'}} />}
              </label>

              <label style={{
                 display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', 
                 cursor:'pointer', padding:'8px', border:'1px dashed #ccc', borderRadius:'8px'
              }}>
                 {tryOnGarment ? '✅ Garment Loaded' : '👗 Upload Garment'}
                 <input type="file" accept="image/*" hidden onChange={(e)=>setTryOnGarment(e.target.files[0])} />
                 {tryOnGarment && <img src={URL.createObjectURL(tryOnGarment)} style={{width:30, height:30, borderRadius:4, objectFit:'cover'}} />}
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>Category:</label>
                <select 
                  value={tryOnCategory} 
                  onChange={(e) => setTryOnCategory(e.target.value)}
                  style={{
                    padding: '8px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '13px', outline: 'none'
                  }}
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
                  color: 'white',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  marginTop: '4px'
                }}
              >
                {isGenerating ? '⏳ Generating...' : '🚀 GENERATE'}
              </button>

              <button 
                onClick={()=>setIsTryOnMode(false)}
                style={{background:'transparent', border:'none', fontSize:'12px', color:'#6b7280', cursor:'pointer', textDecoration:'underline'}}
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
         {filtered.map(it => (
            <div key={it.id} className={styles.card}>
               <img className={styles.thumb} src={toPublicUrl(it.image)} />
               <div>
                  <div className={styles.cardTitle}>{it.name}</div>
                  <button 
                    className={styles.chip} 
                    style={{marginTop:5, fontSize:11}}
                    onClick={() => {
                        if(isTryOnMode) {
                           alert("For AI mode, please upload garment file manually for now!");
                        } else {
                           setLayers([...layers, { itemId: it.id, x: 100, y: 100, scale: 0.5 }]);
                        }
                    }}
                  >
                    Wear
                  </button>
               </div>
            </div>
         ))}
      </aside>

      <div className={styles.bottom}>
        <button 
           className={`${styles.btn} ${isTryOnMode ? styles.primary : ''}`}
           onClick={() => setIsTryOnMode(!isTryOnMode)}
        >
          {isTryOnMode ? '❌ Close AI Mode' : '✨ Try-On Photo (AI)'}
        </button>

        <button className={styles.btn} onClick={() => alert("Save function here")}>Save Look</button>
        <button className={styles.btn} onClick={() => alert("Export function here")}>Export PNG</button>
      </div>

    </div>
  );
}