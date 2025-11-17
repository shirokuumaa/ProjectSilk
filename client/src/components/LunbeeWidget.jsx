import React, { useEffect, useMemo, useState } from "react";
import {
  setBaseURL, getBaseURL, getSessionId,
  searchProducts, addToCart as apiAddToCart,
  getCart as apiGetCart, checkout as apiCheckout,
  compareProducts, getPrefs, setPrefs,
} from "../assistant/api";

// --------- A/B variant from URL ---------
const urlParams = new URLSearchParams(window.location.search);
const abVariant = urlParams.get("ab") || "control";

// --------- helpers ---------
function Price({ value }) {
  if (value === undefined || value === null || isNaN(Number(value))) return "—";
  return `$${Number(value).toFixed(2)}`;
}

// Псевдо-бренд из первого слова title (если нет явного поля brand)
function brandOf(it) {
  const t = String(it?.title || "").trim();
  return t.split(/\s+/)[0] || "GENERIC";
}

// Автоподбор размера по росту (простая эвристика)
function pickSize(avail, height_cm) {
  if (!avail?.length) return null;
  const A = avail.map(s => String(s).trim()).filter(Boolean);

  const alpha = ["XS","S","M","L","XL","XXL","XXXL"];
  if (A.every(s => alpha.includes(s.toUpperCase()))) {
    if (height_cm <= 160 && A.includes("XS")) return "XS";
    if (height_cm <= 166 && A.includes("S"))  return "S";
    if (height_cm <= 172 && A.includes("M"))  return "M";
    if (height_cm <= 178 && A.includes("L"))  return "L";
    if (A.includes("XL")) return "XL";
    return A[0];
  }
  const nums = A.map(s => parseInt(s, 10)).filter(n => !isNaN(n)).sort((a,b)=>a-b);
  if (nums.length === A.length) {
    const series = nums;
    const target = height_cm <= 160 ? series[0]
                  : height_cm <= 166 ? series[Math.min(1, series.length-1)]
                  : height_cm <= 172 ? series[Math.min(2, series.length-1)]
                  : height_cm <= 178 ? series[Math.min(3, series.length-1)]
                  : series[Math.min(4, series.length-1)];
    const best = String(target);
    return A.includes(best) ? best : A[0];
  }
  return A[0];
}

// Отсортировать length по “возрастающей длине”
const lengthRank = { Mini: 0, Knee: 1, Midi: 2, Ankle: 3, Maxi: 4 };

export default function LunbeeWidget() {
  const [baseURL, setBase] = useState(getBaseURL());
  useEffect(() => { setBaseURL(baseURL); }, [baseURL]);

  const sessionId = useMemo(() => getSessionId(), []);

  // --------- prefs ---------
  const [prefs, setPrefsState] = useState({
    height_cm: 170,
    budget_usd: 120,
    colors_like: [],
    colors_avoid: [],
    size_by_brand: {}   // размер по бренду
  });

  useEffect(() => {
    (async () => {
      try {
        const p = await getPrefs(sessionId);
        if (p?.json) setPrefsState(prev => ({ ...prev, ...p.json }));
      } catch {}
    })();
  }, [sessionId]);

  async function savePrefs() {
    try {
      await setPrefs(sessionId, prefs);
      setToast("Предпочтения сохранены");
    } catch {
      setToast("Не удалось сохранить");
    } finally {
      setTimeout(() => setToast(""), 1800);
    }
  }

  // --------- search state ---------
  const [query, setQuery] = useState("");
  const [length, setLength] = useState("Any");
  const [color, setColor] = useState("Any");
  const [priceMax, setPriceMax] = useState("");
  const [limit] = useState(12);
  const [useSemantic, setUseSemantic] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(null); // NEW: семантическая пагинация

  // --------- cart/compare/toast ---------
  const [cart, setCart] = useState([]);
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState([]); // до 2 id
  const [compareData, setCompareData] = useState(null);

  // выбранные размеры по товарам
  const [sizeSel, setSizeSel] = useState({}); // { [product_id]: size }

  // история (топ-5) — привязка к сессии
  const histKey = `lb_hist_${sessionId}`;
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(histKey) || "[]"); } catch { return []; }
  });
  const pushHistory = (q) => {
    const t = (q || "").trim(); if (!t) return;
    const next = [t, ...history.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 5);
    setHistory(next);
    try { localStorage.setItem(histKey, JSON.stringify(next)); } catch {}
  };

  // --------- логирование (включает A/B флаг) ---------
  async function logEvent(payload) {
    try {
      await fetch(`${getBaseURL()}/api/log`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ ab: abVariant, ...payload })
      });
    } catch {}
  }

  // --------- initial load ---------
  useEffect(() => {
    (async () => {
      try {
        const cartData = await apiGetCart(sessionId);
        setCart((cartData.items || []));
        setLoading(true);
        setError("");
        // первичная выдача без семантики (пример), чтобы что-то показать
        const data = await searchProducts({
          query: "",
          filters: { length: "Midi" },
          sort: "relevance",
          limit,
        });
        setItems(data.items || []);
        setTotal(data.total || 0);
        setNextOffset(null);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, baseURL, limit]);

  // Проставляем дефолт-размеры под текущие items (учитываем size_by_brand)
  useEffect(() => {
    const m = {};
    items.forEach(it => {
      const avail = String(it.sizes || "").split(/[,\s]+/).filter(Boolean);
      const b = brandOf(it);
      const brandPref = (prefs.size_by_brand || {})[b];
      m[it.product_id] = brandPref || pickSize(avail, Number(prefs.height_cm || 170));
    });
    setSizeSel(m);
  }, [items, prefs.height_cm, prefs.size_by_brand]);

  async function refreshCart() {
    try { const d = await apiGetCart(sessionId); setCart(d.items || []); }
    catch {}
  }

  function buildFilters() {
    const f = {};
    if (length && length !== "Any") f.length = length;
    if (color && color !== "Any") f.color = color;
    if (priceMax) f.price_max = Number(priceMax);
    if (!f.price_max && prefs?.budget_usd) f.price_max = Number(prefs.budget_usd);
    return f;
  }

  async function doSearch(opts) {
    setLoading(true); setError(""); setCompareData(null);
    try {
      const body = opts || { query, filters: buildFilters(), sort: "relevance", limit };
      let data;
      if (useSemantic && (body.query || "").trim()) {
        // СЕМАНТИКА (первая страница offset=0)
        const r = await fetch(`${getBaseURL()}/api/products/semantic_search`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({
            query: body.query,
            limit: body.limit || limit,
            offset: 0,
            filters: body.filters || {},
            session_id: sessionId
          })
        }).then(r => r.json());
        setItems(r.items || []);
        setTotal(r.total || 0);
        setNextOffset(r.next_offset ?? null);
      } else {
        // Обычный поиск — без пагинации “Показать ещё”
        data = await searchProducts(body);
        setItems(data.items || []); setTotal(data.total || 0);
        setNextOffset(null);
      }
      pushHistory(body.query || "");
      await logEvent({
        event:"search", session_id: sessionId,
        meta:{ query: body.query || "", filters: body.filters || {}, use_semantic: !!(useSemantic && (body.query||"").trim()), total: (data?.total ?? (typeof total==='number'? total:0)) }
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // “Показать ещё” для семантики
  async function loadMore() {
    if (nextOffset === null) return;
    const filters = buildFilters();
    try {
      const r = await fetch(`${getBaseURL()}/api/products/semantic_search`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          query,
          limit,
          offset: nextOffset,
          filters,
          session_id: sessionId
        })
      }).then(x=>x.json());

      setItems(prev => [...prev, ...(r.items || [])]);
      setTotal(r.total || total);
      setNextOffset(r.next_offset ?? null);

      await logEvent({
        event:"search_more", session_id: sessionId,
        meta:{ query, offset: nextOffset, total: r.total }
      });
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function addToCart(product) {
    const avail = String(product.sizes || "").split(/[,\s]+/).filter(Boolean);
    const chosen = sizeSel[product.product_id] || pickSize(avail, Number(prefs.height_cm || 170));
    try {
      const res = await apiAddToCart({ session_id: sessionId, product_id: product.product_id, size: chosen || null, qty: 1 });
      if (res.ok) {
        setToast(`Добавила «${product.title}» в корзину`);
        refreshCart();
        await logEvent({ event:"add_to_cart", session_id: sessionId, meta:{ product_id: product.product_id, size: chosen || null, price: product.price_usd }});
      } else {
        const msg = res.error === "no_db" ? "Корзина недоступна (нет БД)" : "Не получилось добавить";
        setToast(msg);
      }
    } catch { setToast("Ошибка добавления"); }
    finally { setTimeout(() => setToast(""), 1800); }
  }

  // Редирект на страницу заказа после удачного чекаута
  async function checkout() {
    try {
      const r = await apiCheckout({ session_id: sessionId, payment_method: "credit_card" });
      if (r.ok) {
        await logEvent({ event:"checkout_ok", session_id: sessionId, meta:{ order_id: r.order_id, total: r.total_usd }});
        window.location.href = `/orders/${r.order_id}`;
      } else {
        const msg = r.error === "no_db" ? "Оплата недоступна (нет БД)" : (r.error || "Ошибка оплаты/пустая корзина");
        setToast(msg);
      }
    } catch {
      setToast("Ошибка оформления");
    } finally {
      setTimeout(() => setToast(""), 1800);
    }
  }

  function toggleSelect(productId) {
    setCompareData(null);
    setSelected(prev => {
      const has = prev.includes(productId);
      if (has) return prev.filter(x => x !== productId);
      if (prev.length >= 2) return [prev[1], productId];
      return [...prev, productId];
    });
  }

  async function compareNow() {
    if (selected.length !== 2) return;
    try {
      const res = await compareProducts(selected);
      setCompareData(res);
      await logEvent({ event:"compare", session_id: sessionId, meta:{ ids: selected }});
    }
    catch (e) { setError(String(e.message || e)); }
  }

  // Похожие — используем POST; если не доступен, fallback на GET
  async function showSimilar(product) {
    setLoading(true); setError(""); setCompareData(null);
    try {
      let data = await fetch(`${getBaseURL()}/api/products/similar`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ product_id: product.product_id, limit: limit, filters: buildFilters() })
      }).then(r=>r.json());

      if (!data?.items && !data?.total) {
        data = await fetch(`${getBaseURL()}/api/products/similar?product_id=${encodeURIComponent(product.product_id)}&k=${limit}`)
          .then(r=>r.json());
      }
      setItems(data.items || []); setTotal(data.total || (data.items?.length || 0));
      setNextOffset(null); // сброс пагинации, т.к. это уже другой фид
      setToast(`Похожие на «${product.title}»`); setTimeout(()=>setToast(""), 1500);
      await logEvent({ event:"similar", session_id: sessionId, meta:{ product_id: product.product_id, returned: data.items?.length || 0 }});
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // “Похоже, но …”
  async function likeWithMods(baseItem, mods) {
    setLoading(true); setError(""); setCompareData(null);
    try {
      let r = await fetch(`${getBaseURL()}/api/products/like`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ product_id: baseItem.product_id, limit, mods })
      }).then(x=>x.json()).catch(()=>null);

      if (!r || (!r.items && !Array.isArray(r))) {
        const sim = await fetch(`${getBaseURL()}/api/products/similar?product_id=${encodeURIComponent(baseItem.product_id)}&k=${Math.max(24, limit*2)}`)
          .then(x=>x.json());
        let arr = sim.items || [];

        if (mods?.cheaper) {
          const basePrice = Number(baseItem.price_usd || 0);
          arr = arr.filter(x => Number(x.price_usd || 1e12) <= basePrice);
        }
        if (mods?.longer) {
          const baseLen = lengthRank[String(baseItem.length || "Midi")] ?? 2;
          arr = arr.filter(x => (lengthRank[String(x.length)] ?? 2) > baseLen);
        }
        r = { items: arr.slice(0, limit), total: arr.length };
      }

      setItems(r.items || []); setTotal(r.total || (r.items?.length || 0));
      setNextOffset(null);
    } finally {
      setLoading(false);
    }
  }

  async function showLookOfDay() {
    try {
      const d = await fetch(`${getBaseURL()}/api/recs/look_of_day`).then(r=>r.json());
      if (d.main) {
        const bundle = [d.main, ...(d.accessories || [])];
        setItems(bundle);
        setTotal(bundle.length);
        setNextOffset(null);
        setToast("Look of the Day ✨"); setTimeout(()=>setToast(""),1200);
      }
    } catch {}
  }

  const colorsList = [
    "Any","Ivory","Red","Burgundy","Violet","Navy","Brown","Black","White",
    "Beige","Silver","Gold","Emerald","Olive","Sage","Lavender","Lilac",
    "Mint","Mustard","Royal Blue"
  ];

  return (
    <div>
      {/* Шапка + URL */}
      <div style={{display:"grid", gap:8, marginBottom:10}}>
        <div className="chip" style={{display:"inline-flex", gap:8, alignItems:"center"}}>
          <span>Session: {sessionId}</span>
          <span style={{opacity:.6}}>· AB: {abVariant}</span>
        </div>
        <input
          placeholder="Бэкенд URL (http://127.0.0.1:8000)"
          value={baseURL}
          onChange={(e) => setBase(e.target.value)}
        />
      </div>

      {/* История запросов */}
      {history.length > 0 && (
        <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:8}}>
          {history.map(h => (
            <button
              key={h}
              className="ai-btn"
              onClick={() => { setQuery(h); doSearch({ query: h, filters: buildFilters(), sort: "relevance", limit }); }}
              title="Повторить поиск"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      {/* Quick rec: Look of the Day */}
      <div style={{border:"1px solid #e5e7eb", borderRadius:14, padding:12, marginBottom:12}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div className="as-title" style={{fontWeight:600}}>Look of the Day</div>
          <button className="ai-btn" onClick={showLookOfDay}>Показать</button>
        </div>
        <div style={{fontSize:13, opacity:.75, marginTop:6}}>Сейчас 1 основная вещь (+аксессуары, если есть).</div>
      </div>

      {/* Предпочтения */}
      <div style={{display:"grid", gap:8, gridTemplateColumns:"1fr 1fr"}}>
        <div>
          <label className="chip" style={{border:"none", padding:0}}>Рост (см)</label>
          <input type="number"
            value={prefs.height_cm}
            onChange={(e)=>setPrefsState({...prefs, height_cm:Number(e.target.value)||0})}/>
        </div>
        <div>
          <label className="chip" style={{border:"none", padding:0}}>Бюджет ($)</label>
          <input type="number"
            value={prefs.budget_usd}
            onChange={(e)=>setPrefsState({...prefs, budget_usd:Number(e.target.value)||0})}/>
        </div>
        <div style={{gridColumn:"1 / -1"}}>
          <label className="chip" style={{border:"none", padding:0}}>Любимые цвета</label>
          <input
            placeholder="pink, beige"
            value={(prefs.colors_like||[]).join(", ")}
            onChange={(e)=>setPrefsState({
              ...prefs,
              colors_like: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)
            })}
          />
        </div>
        <div style={{gridColumn:"1 / -1"}}>
          <label className="chip" style={{border:"none", padding:0}}>Избегать цветов</label>
          <input
            placeholder="black"
            value={(prefs.colors_avoid||[]).join(", ")}
            onChange={(e)=>setPrefsState({
              ...prefs,
              colors_avoid: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)
            })}
          />
        </div>
        <div style={{gridColumn:"1 / -1"}}>
          <button className="ai-btn" onClick={savePrefs}>💾 Сохранить предпочтения</button>
        </div>
      </div>

      {/* Поиск */}
      <div style={{display:"grid", gap:8, gridTemplateColumns:"1fr 1fr"}}>
        <div style={{gridColumn:"1 / -1"}}>
          <label className="chip" style={{border:"none", padding:0}}>Запрос</label>
          <input
            placeholder="платье, выпускной..."
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
            onKeyDown={(e)=>{ if(e.key==="Enter") doSearch(); }}
          />
        </div>
        <div>
          <label className="chip" style={{border:"none", padding:0}}>Длина</label>
          <select value={length} onChange={(e)=>setLength(e.target.value)}>
            {["Any","Mini","Knee","Midi","Ankle","Maxi"].map(x=><option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className="chip" style={{border:"none", padding:0}}>Цвет</label>
          <select value={color} onChange={(e)=>setColor(e.target.value)}>
            {[
              "Any","Ivory","Red","Burgundy","Violet","Navy","Brown","Black","White",
              "Beige","Silver","Gold","Emerald","Olive","Sage","Lavender","Lilac",
              "Mint","Mustard","Royal Blue"
            ].map(x=><option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className="chip" style={{border:"none", padding:0}}>До цены</label>
          <input placeholder="100" value={priceMax} onChange={(e)=>setPriceMax(e.target.value)} />
        </div>
        <div style={{display:"flex", alignItems:"end", gap:12}}>
          <button className="ai-btn" onClick={()=>doSearch()} disabled={loading}>
            {loading ? "Ищу..." : "Искать"}
          </button>
          <label className="text-sm flex items-center gap-2" style={{fontSize:14}}>
            <input type="checkbox" checked={useSemantic} onChange={e=>setUseSemantic(e.target.checked)} />
            Семантический поиск
          </label>
        </div>
      </div>

      {/* Инфо */}
      <div style={{display:"flex", justifyContent:"space-between", fontSize:13, opacity:.75, marginTop:6}}>
        <div>Найдено: {total}</div>
        <div>К сравнению выбрано: {selected.length}/2</div>
      </div>

      {error && (
        <div style={{border:"1px solid #fecaca", background:"#fef2f2", color:"#991b1b",
                     borderRadius:12, padding:"8px 10px", fontSize:14, marginTop:8}}>{error}</div>
      )}
      {toast && (
        <div style={{position:"fixed", right:16, bottom:16, border:"1px solid #e5e7eb",
                     background:"#fff", borderRadius:12, padding:"8px 12px",
                     boxShadow:"0 10px 20px rgba(0,0,0,.15)"}}>
          {toast}
        </div>
      )}

      {/* Результаты */}
      <div className="as-grid">
        {items.map((it, idx) => {
          const avail = String(it.sizes || "").split(/[,\s]+/).filter(Boolean);
          const b = brandOf(it);
          const brandPref = (prefs.size_by_brand||{})[b];
          const currentSize = sizeSel[it.product_id] || brandPref || pickSize(avail, Number(prefs.height_cm||170));

          const likeColorsLower = (prefs.colors_like || []).map(c => String(c).toLowerCase());
          const isLikedColor = likeColorsLower.includes(String(it.color || "").toLowerCase());

          return (
            <article key={`${it.product_id}-${idx}`} className="as-card">
              <a
                href={`#/product/${encodeURIComponent(it.product_id)}`}
                onClick={async (e)=>{
                  await logEvent({
                    event:"search_click",
                    session_id: sessionId,
                    meta:{ query, product_id: it.product_id, rank: idx+1 }
                  });
                }}
              >
                <img className="as-card__img" src={it.image_url} alt={it.title}/>
              </a>

              <div className="as-card__body">
                <div className="as-title">{it.title}</div>

                <div className="as-meta">
                  {it.length && <span className="chip">{it.length}</span>}
                  {it.color && (
                    <span
                      className="chip"
                      style={{
                        background: isLikedColor ? "#ecfeff" : undefined,
                        borderColor: isLikedColor ? "#06b6d4" : undefined
                      }}
                    >
                      {it.color}
                    </span>
                  )}
                  {it.silhouette && <span className="chip">{it.silhouette}</span>}
                  <span className="chip">id: {it.product_id}</span>
                  <span className="chip">brand: {b}</span>
                </div>

                {/* Размеры в 1 клик (+ запись size_by_brand) */}
                {avail.length > 0 && (
                  <div className="as-row">
                    <label style={{fontSize:12, opacity:.8}}>Размер</label>
                    <select
                      value={currentSize || ""}
                      onChange={(e)=>{
                        const val = e.target.value;
                        setSizeSel(s => ({ ...s, [it.product_id]: val }));
                        const br = brandOf(it);
                        setPrefsState(p => ({ ...p, size_by_brand: { ...(p.size_by_brand||{}), [br]: val }}));
                      }}
                      style={{border:"1px solid #e5e7eb", borderRadius:12, padding:"6px 8px"}}
                    >
                      {avail.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}

                <div className="as-row">
                  <div className="as-price"><Price value={it.price_usd} /></div>
                  <div className="as-actions" style={{display:"flex", flexWrap:"wrap", gap:8}}>
                    <button className="ai-btn" onClick={()=> addToCart(it)}>В корзину</button>
                    <button className="ai-btn" onClick={()=> showSimilar(it)} title="Похожие">Ещё как это</button>

                    {/* NEW: Похоже, но… */}
                    <button
                      className="ai-btn ai-btn--ghost"
                      title="Похоже, но дешевле"
                      onClick={async ()=>{
                        await likeWithMods(it, { cheaper:true });
                        await logEvent({ event:"like_cheaper", session_id: sessionId, meta:{ product_id: it.product_id }});
                      }}>
                      Дешевле
                    </button>

                    <button
                      className="ai-btn ai-btn--ghost"
                      title="Похоже, но длиннее"
                      onClick={async ()=>{
                        await likeWithMods(it, { longer:true });
                        await logEvent({ event:"like_longer", session_id: sessionId, meta:{ product_id: it.product_id }});
                      }}>
                      Длиннее
                    </button>

                    <label className="ai-btn" style={{display:"inline-flex", alignItems:"center", gap:6}}>
                      <input
                        type="checkbox"
                        checked={selected.includes(it.product_id)}
                        onChange={()=> toggleSelect(it.product_id)}
                      />
                      <span style={{fontSize:12}}>Сравнить</span>
                    </label>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Кнопка “Показать ещё” для семантического поиска */}
      {nextOffset !== null && (
        <div style={{display:"flex", justifyContent:"center", marginTop:12}}>
          <button className="ai-btn" onClick={loadMore} disabled={loading}>
            {loading ? "Загружаю..." : "Показать ещё"}
          </button>
        </div>
      )}

      {/* Сравнение */}
      <div style={{border:"1px solid #e5e7eb", borderRadius:14, padding:12, marginTop:12}}>
        <div style={{display:"flex", justifyContent:"space-between"}}>
          <div className="as-title" style={{fontWeight:600}}>Сравнение</div>
          <div style={{fontSize:13, opacity:.75}}>Выбрано: {selected.join(", ") || "—"}</div>
        </div>
        <div style={{marginTop:8, display:"flex", gap:8, alignItems:"center"}}>
          <button className="ai-btn" disabled={selected.length !== 2} onClick={compareNow}>
            Сравнить выбранные (2)
          </button>
          <button className="ai-btn ai-btn--ghost" onClick={()=>setSelected([])}>Сбросить</button>
        </div>

        {compareData && (
          <div style={{marginTop:10, fontSize:14}}>
            {compareData.items?.length >= 2 ? (
              <div style={{display:"grid", gap:10, gridTemplateColumns:"1fr 1fr"}}>
                {compareData.items.slice(0,2).map((p, idx) => (
                  <div key={p.product_id} style={{border:"1px solid #e5e7eb", borderRadius:12, padding:10}}>
                    <div style={{fontWeight:600}}>{idx===0?"A":"B"}) {p.title}</div>
                    <div style={{opacity:.7}}>id: {p.product_id}</div>
                    <div style={{marginTop:6, display:"flex", flexWrap:"wrap", gap:6}}>
                      <span className="chip">Цена: <Price value={p.price_usd} /></span>
                      {p.length && <span className="chip">{p.length}</span>}
                      {p.color && <span className="chip">{p.color}</span>}
                      {p.material && <span className="chip">{p.material}</span>}
                      {p.silhouette && <span className="chip">{p.silhouette}</span>}
                      <span className="chip">Размеры: {String(p.sizes)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>Недостаточно данных для сравнения.</div>
            )}

            <div style={{marginTop:8}}>
              <div style={{fontWeight:600}}>Отличия:</div>
              {compareData.diff_keys?.length ? (
                <ul style={{marginLeft:16, listStyle:"disc"}}>
                  {compareData.diff_keys.map(k => <li key={k}>{k}</li>)}
                </ul>
              ) : (
                <div style={{opacity:.7}}>Почти одинаковые</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Корзина / чекаут */}
      <div style={{border:"1px solid #e5e7eb", borderRadius:14, padding:12, marginTop:12}}>
        <div style={{display:"flex", justifyContent:"space-between"}}>
          <div className="as-title" style={{fontWeight:600}}>Корзина</div>
          <button className="ai-btn ai-btn--ghost" onClick={refreshCart}>Обновить</button>
        </div>
        {(!cart || cart.length === 0) ? (
          <div style={{opacity:.75, fontSize:14, marginTop:6}}>Пусто</div>
        ) : (
          <ul style={{marginTop:8}}>
            {cart.map((c, i) => (
              <li key={i} style={{display:"flex", justifyContent:"space-between", padding:"6px 0", borderTop:i? "1px solid #f3f4f6":"none", fontSize:14}}>
                <span>{c.product_id} · размер {c.size || "-"} · qty {c.qty || 1}</span>
              </li>
            ))}
          </ul>
        )}
        <div style={{marginTop:8}}>
          <button className="ai-btn" onClick={checkout} disabled={!cart || cart.length===0}>Оформить заказ</button>
        </div>
      </div>

      {/* Липкий нижний бар */}
      <div className="ai-sticky">
        <div style={{display:"flex", gap:8}}>
          <button className="ai-btn" onClick={compareNow} disabled={selected.length !== 2}>
            Сравнить выбранные
          </button>
          <button className="ai-btn" onClick={checkout} disabled={!cart || cart.length===0}>
            Оформить заказ
          </button>
        </div>
      </div>
    </div>
  );
}
