# app.py — ProjectSilk assistant API
# (SQLite + rerank + prefs + cart + semantic + similar + logs + metrics + look_of_day 2.0 + LGBM rerank + like-this)
import os, json, sqlite3, re
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np

# ---------- Конфиг ----------
DB_PATH    = os.environ.get("DB_PATH", "data/products.db")
CSV_PATH   = os.environ.get("CSV_PATH", "data/seed_catalog_dresses.csv")
USE_RERANK = os.environ.get("USE_RERANK", "1") == "1"  # sentence-transformers rerank
USE_LGBM   = os.environ.get("USE_LGBM", "0") == "1"    # второй этап ранжирования (оффлайн модель)

# ---------- Рерэнкер (ленивая загрузка) ----------
_reranker = None
def get_reranker():
    global _reranker
    if _reranker is None:
        try:
            from sentence_transformers import SentenceTransformer, util
            _reranker = (SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2"), util)
        except Exception:
            _reranker = None
    return _reranker

# ---------- Источник CSV (фолбэк) ----------
_DF = None
def get_csv_df():
    global _DF
    if _DF is None:
        try:
            import pandas as pd
            _DF = pd.read_csv(CSV_PATH)
            for col in ["title","description","silhouette","style","occasion","color","material",
                        "product_id","price_usd","sizes","length","image_url","stock"]:
                if col not in _DF.columns:
                    _DF[col] = ""
        except Exception:
            _DF = None
    return _DF

# ---------- Утилиты ----------
def db() -> Optional[sqlite3.Connection]:
    # если файла БД нет — работаем в CSV-режиме (cart/orders/prefs недоступны)
    if not os.path.exists(DB_PATH):
        return None
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def data_source() -> str:
    return "sqlite" if os.path.exists(DB_PATH) else ("csv" if os.path.exists(CSV_PATH) else "none")

def norm_str(x: Any) -> str:
    return str(x or "").lower()

def length_map(v: str) -> Optional[str]:
    m = {
        "mini":"Mini","мини":"Mini",
        "knee":"Knee","колено":"Knee",
        "midi":"Midi","mid":"Midi","миди":"Midi",
        "ankle":"Ankle","щиколот":"Ankle",
        "maxi":"Maxi","макси":"Maxi","floor":"Maxi"
    }
    vv = norm_str(v).replace("_"," ").strip()
    return m.get(vv)

# === Orders & Carts schema (SQLite) ===
def _ensure_order_schema():
    con = db()
    if not con:
        return
    con.executescript("""
    CREATE TABLE IF NOT EXISTS carts(
        session_id TEXT PRIMARY KEY,
        json TEXT,
        updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS orders(
        order_id TEXT PRIMARY KEY,
        session_id TEXT,
        total_usd REAL,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS order_items(
        order_id TEXT,
        product_id TEXT,
        size TEXT,
        qty INTEGER,
        price_usd REAL
    );
    CREATE TABLE IF NOT EXISTS user_prefs(
        session_id TEXT PRIMARY KEY,
        json TEXT
    );
    """)
    con.commit()

_ensure_order_schema()

def _read_cart(session_id: str) -> dict:
    con = db()
    if not con:
        return {"items": []}
    row = con.execute("SELECT json FROM carts WHERE session_id=?", (session_id,)).fetchone()
    return (json.loads(row[0]) if row and row[0] else {"items": []})

def _write_cart(session_id: str, cart: dict) -> bool:
    con = db()
    if not con:
        return False
    con.execute(
        "INSERT INTO carts(session_id,json,updated_at) VALUES(?,?,datetime('now')) "
        "ON CONFLICT(session_id) DO UPDATE SET json=excluded.json, updated_at=datetime('now')",
        (session_id, json.dumps(cart, ensure_ascii=False))
    )
    con.commit()
    return True

# ---------- Pydantic ----------
class SearchBody(BaseModel):
    query: str = ""
    filters: Dict[str, Any] = {}
    sort: str = "relevance"          # relevance | price_asc | price_desc
    limit: int = 12
    offset: int = 0

class PrefsBody(BaseModel):
    session_id: str
    json: Dict[str, Any]

class AddToCartBody(BaseModel):
    session_id: str
    product_id: str
    size: Optional[str] = None
    qty: int = 1

class CheckoutBody(BaseModel):
    session_id: str
    payment_method: str = "card"

# ---------- FastAPI ----------
app = FastAPI(title="ProjectSilk Assistant API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # сузишь на проде
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================================
#                     Семантика: эмбеддинги + кодирование
# =====================================================================
VEC_PATH = "data/embeddings.npy"
ID_MAP   = "data/id_map.json"

try:
    EMB = np.load(VEC_PATH) if Path(VEC_PATH).exists() else None
    ID2 = json.load(open(ID_MAP, "r", encoding="utf-8")) if Path(ID_MAP).exists() else None
    ID2IDX = {pid:i for i,pid in enumerate(ID2)} if ID2 else {}
except Exception:
    EMB, ID2, ID2IDX = None, None, {}

_sem_model = None
def _get_sem_model():
    global _sem_model
    if _sem_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _sem_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        except Exception:
            _sem_model = None
    return _sem_model

def _encode_text(text: str) -> Optional[np.ndarray]:
    mdl = _get_sem_model()
    if mdl is None: return None
    return mdl.encode([text], convert_to_numpy=True, normalize_embeddings=True)[0]

def _item_to_text(r: dict) -> str:
    return " ".join([
        str(r.get("title","")), str(r.get("style","")), str(r.get("silhouette","")),
        str(r.get("occasion","")), str(r.get("material","")), str(r.get("color","")), str(r.get("length",""))
    ])

def _passes_filters(item: dict, filters: dict) -> bool:
    if not filters: return True
    if "length" in filters and filters["length"] and filters["length"] != "Any":
        if str(item.get("length")) != str(filters["length"]): return False
    if "color" in filters and filters["color"] and filters["color"] != "Any":
        if str(item.get("color")).lower() != str(filters["color"]).lower(): return False
    try:
        if "price_min" in filters and filters["price_min"] is not None:
            if float(item.get("price_usd") or 1e18) < float(filters["price_min"]): return False
        if "price_max" in filters and filters["price_max"] is not None:
            if float(item.get("price_usd") or 0) > float(filters["price_max"]): return False
    except Exception:
        pass
    return True

def _read_prefs(session_id: Optional[str]) -> Dict[str, Any]:
    if not session_id: return {}
    con = db()
    if not con: return {}
    row = con.execute("SELECT json FROM user_prefs WHERE session_id=?", (session_id,)).fetchone()
    try:
        return json.loads(row["json"]) if row else {}
    except Exception:
        return {}

def _soft_score(item: dict, prefs: dict) -> float:
    if not prefs: return 0.0
    s = 0.0
    price = item.get("price_usd")
    if prefs.get("budget_usd") and price:
        try:
            if float(price) <= float(prefs["budget_usd"]):
                s += 0.2
        except Exception:
            pass
    like = set([str(c).lower() for c in (prefs.get("colors_like") or [])])
    avoid= set([str(c).lower() for c in (prefs.get("colors_avoid") or [])])
    col  = (item.get("color") or "").lower()
    if col in like:  s += 0.2
    if col in avoid: s -= 0.3
    return s

def _fetch_products_by_ids(ids: List[str]) -> List[Dict[str, Any]]:
    if not ids: return []
    con = db()
    if con:
        qmarks = ",".join(["?"]*len(ids))
        rows = con.execute(
            f"""SELECT product_id,title,price_usd,sizes,color,style,silhouette,occasion,material,length,image_url,stock
                FROM products WHERE product_id IN ({qmarks})""",
            ids
        ).fetchall()
        order = {pid:i for i,pid in enumerate(ids)}
        return sorted([dict(r) for r in rows], key=lambda r: order.get(r["product_id"], 10**9))
    df = get_csv_df()
    if df is None: return []
    cur = df[df["product_id"].isin(ids)][
        ["product_id","title","price_usd","sizes","color","style","silhouette","occasion","material","length","image_url","stock"]
    ].to_dict(orient="records")
    order = {pid:i for i,pid in enumerate(ids)}
    return sorted(cur, key=lambda r: order.get(r["product_id"], 10**9))

# =====================================================================
#                    Семантический поиск + пагинация
# =====================================================================
def _lgbm_model_load():
    if not USE_LGBM:
        return None
    try:
        import lightgbm as lgb
        mdl_path = os.environ.get("LGBM_MODEL", "data/lgbm_model.txt")
        if os.path.exists(mdl_path):
            return lgb.Booster(model_file=mdl_path)
    except Exception:
        return None
    return None

_LGBM_MODEL = None

def _extract_features_for_lgbm(q: str, it: dict, prefs: dict) -> List[float]:
    text = f"{it.get('title','')} {it.get('style','')} {it.get('silhouette','')} {it.get('material','')} {it.get('color','')}".lower()
    tokens = set(re.findall(r"\w+", (q or "").lower()))
    overlap = sum(1 for t in tokens if t in text)
    price = float(it.get("price_usd") or 0.0)
    budget = float((prefs or {}).get("budget_usd") or 0.0)
    under_budget = 1.0 if (budget and price and price <= budget) else 0.0
    like = set([str(c).lower() for c in (prefs or {}).get("colors_like") or []])
    col = (it.get("color") or "").lower()
    liked_color = 1.0 if (col in like) else 0.0
    try:
        vq = _encode_text(q); vt = _encode_text(_item_to_text(it))
        cos = float((vq @ vt)) if (vq is not None and vt is not None) else 0.0
    except Exception:
        cos = 0.0
    return [overlap, price, under_budget, liked_color, cos]

def _lgbm_rerank(query: str, items: List[dict], session_id: Optional[str]) -> List[dict]:
    global _LGBM_MODEL
    if not USE_LGBM or not items:
        return items
    if _LGBM_MODEL is None:
        _LGBM_MODEL = _lgbm_model_load()
    if _LGBM_MODEL is None:
        return items
    prefs = _read_prefs(session_id)
    X = [ _extract_features_for_lgbm(query, it, prefs) for it in items ]
    scores = _LGBM_MODEL.predict(np.array(X))
    return [it for it,_ in sorted(zip(items, scores), key=lambda z: z[1], reverse=True)]

@app.post("/api/products/semantic_search")
def api_products_semantic_search(body: Dict[str, Any] = Body(...)):
    """
    body = { query, limit, filters, session_id, offset? }
    """
    if EMB is None or ID2 is None:
        return {"items": [], "total": 0, "note": "no_index", "offset": 0, "next_offset": None}

    q = (body or {}).get("query", "").strip()
    limit = int((body or {}).get("limit", 12))
    offset = int((body or {}).get("offset", 0))
    filters = (body or {}).get("filters") or {}
    session_id = (body or {}).get("session_id")

    if not q:
        return {"items": [], "total": int(EMB.shape[0]), "offset": offset, "next_offset": None}

    v = _encode_text(q)
    if v is None:
        return {"items": [], "total": 0, "note": "model_unavailable", "offset": offset, "next_offset": None}

    scores = EMB @ v
    idx = np.argsort(-scores).tolist()
    ids_all = [ID2[i] for i in idx]

    items_all = [it for it in _fetch_products_by_ids(ids_all) if _passes_filters(it, filters)]
    total = len(items_all)

    try:
        items_all = _lgbm_rerank(q, items_all, session_id)
    except Exception:
        pass

    page = items_all[offset: offset + limit]
    next_offset = offset + len(page) if (offset + len(page)) < total else None

    prefs = _read_prefs(session_id)
    if prefs:
        base_order = {it["product_id"]: i for i, it in enumerate(page)}
        page.sort(key=lambda it: (base_order.get(it["product_id"], 10**9) - 0.001 * _soft_score(it, prefs)))

    return {"items": page, "total": int(total), "offset": int(offset), "next_offset": next_offset}

# =====================================================================
#                     Похожие товары
# =====================================================================
@app.post("/api/products/similar")
def api_products_similar_post(body: Dict[str, Any] = Body(...)):
    """
    body = {"product_id":"SEED-1000", "limit":12, "filters": {...}}
    """
    if EMB is None or ID2 is None:
        return {"items": [], "total": 0, "note": "no_index"}

    pid = (body or {}).get("product_id")
    limit = int((body or {}).get("limit", 12))
    filters = (body or {}).get("filters") or {}

    if not pid:
        return {"items": [], "total": int(EMB.shape[0]), "note": "no_pid"}

    if pid in ID2IDX:
        v = EMB[ID2IDX[pid]]
    else:
        con = db()
        itm = None
        if con:
            row = con.execute("SELECT * FROM products WHERE product_id=?", (pid,)).fetchone()
            itm = dict(row) if row else None
        else:
            df = get_csv_df()
            if df is not None:
                r = df[df["product_id"] == pid]
                itm = r.iloc[0].to_dict() if not r.empty else None
        if not itm:
            return {"items": [], "total": int(EMB.shape[0]), "note": "unknown_product"}
        v = _encode_text(_item_to_text(itm))
        if v is None:
            return {"items": [], "total": 0, "note": "model_unavailable"}

    scores = EMB @ v
    if pid in ID2IDX:
        scores[ID2IDX[pid]] = -1e9

    idx = np.argsort(-scores)[: max(limit*5, limit)].tolist()
    ids = [ID2[i] for i in idx]

    items = _fetch_products_by_ids(ids)
    items = [it for it in items if _passes_filters(it, filters)]
    return {"items": items[:limit], "total": int(EMB.shape[0])}

@app.get("/api/products/similar")
def api_products_similar_get(product_id: str = Query(...), k: int = Query(12)):
    return api_products_similar_post({"product_id": product_id, "limit": k})

# =====================================================================
#                     Look of the Day 2.0
# =====================================================================
def _hex_for_color(c: str) -> str:
    m = {
        "ivory":"#FFFFF0","white":"#FFFFFF","black":"#000000","red":"#FF0000","burgundy":"#800020",
        "violet":"#8F00FF","navy":"#000080","brown":"#8B4513","beige":"#F5F5DC","silver":"#C0C0C0",
        "gold":"#D4AF37","emerald":"#50C878","olive":"#808000","sage":"#9CAF88","lavender":"#B57EDC",
        "lilac":"#C8A2C8","mint":"#98FF98","mustard":"#FFDB58","royal blue":"#4169E1"
    }
    return m.get((c or "").lower(), "#888888")

def _complementary(hex_color: str) -> str:
    try:
        r=int(hex_color[1:3],16); g=int(hex_color[3:5],16); b=int(hex_color[5:7],16)
        cr = 255-r; cg = 255-g; cb = 255-b
        return f"#{cr:02X}{cg:02X}{cb:02X}"
    except Exception:
        return "#888888"

@app.get("/api/recs/look_of_day")
def api_recs_look_of_day():
    if EMB is None or ID2 is None:
        return {"main": None, "accessories": [], "note": "no_index"}
    v = _encode_text("elegant minimal neutral dress")
    if v is None:
        return {"main": None, "accessories": [], "note": "model_unavailable"}
    scores = EMB @ v
    order = np.argsort(-scores).tolist()
    day = int(datetime.utcnow().strftime("%j"))
    pick_idx = order[day % max(1, min(30, len(order)))]
    main_list = _fetch_products_by_ids([ID2[pick_idx]])
    if not main_list:
        return {"main": None, "accessories": []}
    main_it = main_list[0]

    accessories = []
    con = db()
    if con:
        rows = con.execute("""
            SELECT product_id,title,price_usd,sizes,color,style,silhouette,occasion,material,length,image_url,stock
            FROM products
            WHERE LOWER(style) LIKE '%access%'
            LIMIT 40
        """).fetchall()
        cand = [dict(r) for r in rows]
        cm_hex = _complementary(_hex_for_color(main_it.get("color")))
        def _rgb(h):
            try: return tuple(int(h[i:i+2],16) for i in (1,3,5))
            except: return (128,128,128)
        cm_rgb = _rgb(cm_hex)
        def _dist(it):
            cc = _hex_for_color(it.get("color"))
            r,g,b = _rgb(cc)
            return (r-cm_rgb[0])**2 + (g-cm_rgb[1])**2 + (b-cm_rgb[2])**2
        accessories = sorted(cand, key=_dist)[:2]

    if not accessories:
        accessories = [
            {"title":"Minimal clutch","image_url":"https://placehold.co/300x200?text=Clutch","price_usd":39.0,"product_id":"ACC-CLUTCH"},
            {"title":"Classic heels","image_url":"https://placehold.co/300x200?text=Heels","price_usd":59.0,"product_id":"ACC-HEELS"},
        ]
    return {"main": main_it, "accessories": accessories}

# =====================================================================
#                     Like this but … (cheaper/longer/shorter/color)
# =====================================================================
@app.post("/api/products/like")
def api_like_this(body: Dict[str, Any] = Body(...)):
    """
    body = {
      "product_id": "SEED-1001",
      "limit": 12,
      "mods": {"cheaper": True, "longer": False, "shorter": True, "color": "Red"}
    }
    """
    if EMB is None or ID2 is None:
        return {"items": [], "total": 0, "note": "no_index_or_pid"}
    pid = (body or {}).get("product_id")
    limit = int((body or {}).get("limit", 12))
    mods = (body or {}).get("mods") or {}
    if not pid:
        return {"items": [], "total": 0, "note": "no_pid"}

    # получаем базовый товар
    con = db()
    base = None
    if con:
        row = con.execute("SELECT * FROM products WHERE product_id=?", (pid,)).fetchone()
        base = dict(row) if row else None
    else:
        df = get_csv_df()
        if df is not None:
            r = df[df["product_id"] == pid]
            base = r.iloc[0].to_dict() if not r.empty else None
    if not base:
        return {"items": [], "total": 0, "note": "unknown_product"}

    # вектор похожести
    if pid in ID2IDX:
        v = EMB[ID2IDX[pid]]
    else:
        v = _encode_text(_item_to_text(base))
        if v is None:
            return {"items": [], "total": 0, "note": "model_unavailable"}

    scores = EMB @ v
    try:
        if pid in ID2IDX:
            scores[ID2IDX[pid]] = -1e9
    except Exception:
        pass

    idx = np.argsort(-scores).tolist()
    ids = [ID2[i] for i in idx]
    items = _fetch_products_by_ids(ids)

    def _len_rank(x):
        order = ["Mini","Knee","Midi","Ankle","Maxi"]
        try: return order.index(str(x or ""))
        except: return 2

    out = []
    for it in items:
        ok = True
        if mods.get("color"):
            ok = ok and (str(it.get("color","")).lower() == str(mods["color"]).lower())
        if mods.get("cheaper"):
            try: ok = ok and (float(it.get("price_usd") or 1e18) <= float(base.get("price_usd") or 0) * 0.9)
            except: pass
        if mods.get("longer"):
            ok = ok and (_len_rank(it.get("length")) > _len_rank(base.get("length")))
        if mods.get("shorter"):
            ok = ok and (_len_rank(it.get("length")) < _len_rank(base.get("length")))
        if ok: out.append(it)
        if len(out) >= limit: break

    return {"items": out, "total": len(out)}

# =====================================================================
#                     Обычный поиск (SQLite/CSV + rerank)
# =====================================================================
def search_sqlite(b: SearchBody) -> Dict[str, Any]:
    con = db()
    if not con: return {"items": [], "total": 0}

    where, params = [], []
    f = b.filters or {}

    if f.get("length"):
        ln = length_map(str(f["length"])) or str(f["length"])
        where.append("length = ?"); params.append(ln)
    if f.get("color"):
        where.append("LOWER(color) = LOWER(?)"); params.append(str(f["color"]))
    if f.get("style"):
        where.append("LOWER(style) LIKE LOWER(?)"); params.append(f"%{f['style']}%")
    if f.get("silhouette"):
        where.append("LOWER(silhouette) LIKE LOWER(?)"); params.append(f"%{f['silhouette']}%")
    if f.get("occasion"):
        where.append("LOWER(occasion) LIKE LOWER(?)"); params.append(f"%{f['occasion']}%")
    if f.get("material"):
        where.append("LOWER(material) LIKE LOWER(?)"); params.append(f"%{f['material']}%")
    if f.get("price_min") is not None:
        where.append("price_usd >= ?"); params.append(float(f["price_min"]))
    if f.get("price_max") is not None:
        where.append("price_usd <= ?"); params.append(float(f["price_max"]))

    wsql = ("WHERE " + " AND ".join(where)) if where else ""
    base_sql = f"""
    SELECT product_id,title,price_usd,sizes,color,style,silhouette,occasion,material,length,image_url,stock
    FROM products
    {wsql}
    LIMIT ? OFFSET ?
    """
    cur = con.execute(base_sql, (*params, max(b.limit*5, b.limit), b.offset))
    rows = [dict(r) for r in cur.fetchall()]

    if b.sort == "price_asc":
        rows.sort(key=lambda r: float(r.get("price_usd") or 0))
    elif b.sort == "price_desc":
        rows.sort(key=lambda r: float(r.get("price_usd") or 0), reverse=True)
    else:
        if b.query:
            tokens = re.findall(r"\w+", b.query.lower())
            def score(r):
                text = " ".join([
                    str(r.get("title","")), str(r.get("description","")),
                    str(r.get("style","")), str(r.get("silhouette","")),
                    str(r.get("occasion","")), str(r.get("material","")),
                    str(r.get("color",""))
                ]).lower()
                return sum(1 for t in tokens if t in text)
            rows.sort(key=score, reverse=True)

    # FIX: 'and' вместо '&&'
    if USE_RERANK and b.sort == "relevance" and b.query and rows:
        rr = get_reranker()
        if rr:
            model, util = rr
            q_emb = model.encode([b.query], normalize_embeddings=True)
            texts = [
                f"{r.get('title','')} {r.get('style','')} {r.get('silhouette','')} {r.get('material','')} {r.get('color','')}"
                for r in rows
            ]
            d_emb = model.encode(texts, normalize_embeddings=True)
            sims = util.cos_sim(q_emb, d_emb).cpu().tolist()[0]
            rows = [r for r,_s in sorted(zip(rows, sims), key=lambda z: z[1], reverse=True)]

    total = con.execute(f"SELECT COUNT(*) FROM products {wsql}", params).fetchone()[0]
    return {"items": rows[:b.limit], "total": int(total)}

def search_csv(b: SearchBody) -> Dict[str, Any]:
    df = get_csv_df()
    if df is None: return {"items": [], "total": 0}

    f = b.filters or {}
    cur = df.copy()

    if f.get("length"):
        ln = length_map(str(f["length"])) or str(f["length"])
        cur = cur[cur["length"].astype(str).str.lower() == str(ln).lower()]
    if f.get("color"):
        cur = cur[cur["color"].astype(str).str.lower() == str(f["color"]).lower()]
    if f.get("style"):
        cur = cur[cur["style"].astype(str).str.contains(str(f["style"]), case=False, na=False)]
    if f.get("silhouette"):
        cur = cur[cur["silhouette"].astype(str).str.contains(str(f["silhouette"]), case=False, na=False)]
    if f.get("occasion"):
        cur = cur[cur["occasion"].astype(str).str.contains(str(f["occasion"]), case=False, na=False)]
    if f.get("material"):
        cur = cur[cur["material"].astype(str).str.contains(str(f["material"]), case=False, na=False)]
    if f.get("price_min") is not None:
        cur = cur[cur["price_usd"].astype(float) >= float(f["price_min"])]
    if f.get("price_max") is not None:
        cur = cur[cur["price_usd"].astype(float) <= float(f["price_max"])]

    if b.query:
        tokens = re.findall(r"\w+", b.query.lower())
        def score_row(row):
            txt = " ".join([
                str(row.get("title","")), str(row.get("description","")),
                str(row.get("style","")), str(row.get("silhouette","")),
                str(row.get("occasion","")), str(row.get("material","")),
                str(row.get("color",""))
            ]).lower()
            return sum(1 for t in tokens if t in txt)
        cur["__score"] = cur.apply(score_row, axis=1)
        cur = cur.sort_values(by="__score", ascending=False)

    if b.sort == "price_asc":
        cur = cur.sort_values(by="price_usd", ascending=True)
    elif b.sort == "price_desc":
        # FIX: ascending=False (а не 'descending')
        cur = cur.sort_values(by="price_usd", ascending=False)

    # Пагинация по offset/limit
    start = int(b.offset or 0)
    end = start + int(b.limit or 12)

    cols = ["product_id","title","price_usd","sizes","color","style","silhouette","occasion","material","length","image_url","stock"]
    total = int(len(cur))
    page = cur.iloc[start:end] if total else cur
    items = page[cols].to_dict(orient="records")
    return {"items": items, "total": total}

# ---------- Обёртки ----------
def get_product(product_id: str) -> Dict[str, Any]:
    con = db()
    if con:
        row = con.execute(
            """SELECT product_id,title,price_usd,sizes,color,style,silhouette,occasion,material,length,image_url,stock
               FROM products WHERE product_id=?""",
            (product_id,)
        ).fetchone()
        return dict(row) if row else {"error": "not_found"}
    df = get_csv_df()
    if df is None: return {"error": "not_found"}
    r = df[df["product_id"] == product_id]
    return r.iloc[0].to_dict() if not r.empty else {"error": "not_found"}

def compare_products(ids: List[str]) -> Dict[str, Any]:
    if not ids: return {"error":"not_found"}
    con = db()
    if con:
        placeholders = ",".join("?" for _ in ids)
        cur = con.execute(
            f"""SELECT product_id,title,price_usd,sizes,color,style,silhouette,occasion,material,length,stock
                FROM products WHERE product_id IN ({placeholders})""",
            ids
        )
        rows = [dict(r) for r in cur.fetchall()]
    else:
        df = get_csv_df()
        if df is None: return {"error":"not_found"}
        rows = df[df["product_id"].isin(ids)][
            ["product_id","title","price_usd","sizes","color","style","silhouette","occasion","material","length","stock"]
        ].to_dict(orient="records")
    if not rows: return {"error":"not_found"}
    features = ["price_usd","style","silhouette","material","length","color","sizes","stock"]
    diff_keys = []
    for k in features:
        vals = set(str(r.get(k)) for r in rows)
        if len(vals) > 1: diff_keys.append(k)
    return {"items": rows, "diff_keys": diff_keys}

# ---------- Логи (ротация + совместимость) ----------
LOG_DIR = Path("data/logs"); LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = LOG_DIR / "events.jsonl"
LEGACY_LOG = Path("data/events.log.jsonl")  # для совместимости

def _rotate_logs_if_needed(max_mb: int = 10):
    try:
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > max_mb * 1024 * 1024:
            ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            LOG_PATH.rename(LOG_DIR / f"events-{ts}.jsonl")
    except Exception:
        pass

def _write_log(ev: dict):
    ev = {"ts": datetime.utcnow().isoformat()+"Z", **(ev or {})}
    _rotate_logs_if_needed()
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    with LEGACY_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")

@app.post("/api/log")
def api_log(ev: dict = Body(...)):
    try:
        _write_log(ev)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/metrics/daily")
def api_metrics_daily():
    if not LOG_PATH.exists():
        return {"days": []}
    agg: Dict[str, Dict[str,int]] = {}
    with LOG_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                j = json.loads(line)
            except Exception:
                continue
            day = (j.get("ts","")[:10]) or "unknown"
            evt = j.get("event","unknown")
            agg.setdefault(day, {})
            agg[day][evt] = agg[day].get(evt, 0) + 1
    days = [{"date": d, "events": agg[d]} for d in sorted(agg.keys())]
    return {"days": days}

# ---------- Endpoints ----------
@app.get("/healthz")
def healthz():
    return {"ok": True, "source": data_source()}

@app.post("/api/products/search")
def api_products_search(b: SearchBody = Body(...)):
    if os.path.exists(DB_PATH): return search_sqlite(b)
    return search_csv(b)

@app.get("/api/product/{product_id}")
def api_get_product(product_id: str):
    return get_product(product_id)

@app.get("/api/compare")
def api_compare(ids: str = Query(..., description="Comma-separated product ids")):
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    return compare_products(id_list)

# ---- CART (SQLite) ----
@app.post("/api/cart/add")
def api_cart_add(body: Dict[str, Any] = Body(...)):
    con = db()
    if not con:
        return {"ok": False, "error": "no_db"}
    sess = (body or {}).get("session_id")
    pid  = (body or {}).get("product_id")
    size = (body or {}).get("size") or ""
    qty  = int((body or {}).get("qty", 1))
    if not (sess and pid and qty>0):
        return {"ok": False, "error": "bad_request"}

    it = get_product(pid)
    if it.get("error"):
        return {"ok": False, "error": "not_found"}
    if (it.get("stock") or 0) <= 0:
        return {"ok": False, "error": "out_of_stock"}

    cart = _read_cart(sess)
    cart.setdefault("items", [])
    cart["items"].append({"product_id": pid, "size": size, "qty": qty})
    if not _write_cart(sess, cart):
        return {"ok": False, "error": "no_db"}

    _write_log({"event":"add_to_cart","session_id":sess, "meta":{"product_id":pid, "size":size, "qty":qty}})
    return {"ok": True, "cart": cart}

@app.get("/api/cart")
def api_cart(session_id: str = Query(...)):
    con = db()
    if not con:
        return {"items": []}
    return _read_cart(session_id)

def _calc_total_usd(items: List[dict]) -> float:
    if not items:
        return 0.0
    ids = [x["product_id"] for x in items]
    products = {it["product_id"]: it for it in _fetch_products_by_ids(ids)}
    tot = 0.0
    for x in items:
        p = products.get(x["product_id"])
        if p:
            try:
                tot += float(p.get("price_usd") or 0.0) * int(x.get("qty",1))
            except Exception:
                pass
    return round(tot, 2)

# ---- CHECKOUT + ORDERS (SQLite) ----
@app.post("/api/checkout")
def api_checkout(body: Dict[str, Any] = Body(...)):
    con = db()
    if not con:
        return {"ok": False, "error": "no_db"}
    sess = (body or {}).get("session_id")
    if not sess:
        return {"ok": False, "error": "no_session"}

    cart = _read_cart(sess)
    items = cart.get("items") or []
    if not items:
        return {"ok": False, "error": "cart_empty"}

    total = _calc_total_usd(items)
    oid = f"ORD-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{str(uuid4())[:6]}"

    con.execute("INSERT INTO orders(order_id,session_id,total_usd,created_at) VALUES(?,?,?,datetime('now'))",
                (oid, sess, total))

    ids = [x["product_id"] for x in items]
    products = {it["product_id"]: it for it in _fetch_products_by_ids(ids)}
    for x in items:
        p = products.get(x["product_id"])
        price = float(p.get("price_usd") or 0.0) if p else 0.0
        con.execute("INSERT INTO order_items(order_id,product_id,size,qty,price_usd) VALUES(?,?,?,?,?)",
                    (oid, x.get("product_id"), x.get("size") or "", int(x.get("qty",1)), price))

    con.execute("DELETE FROM carts WHERE session_id=?", (sess,))
    con.commit()

    _write_log({"event":"checkout","session_id":sess, "meta":{"order_id":oid,"total_usd":total,"count":len(items)}})
    return {"ok": True, "order_id": oid, "total_usd": total, "count": len(items)}

@app.get("/api/orders/{order_id}")
def api_order_get(order_id: str):
    con = db()
    if not con:
        return {"ok": False, "error": "no_db"}
    o = con.execute("SELECT order_id,session_id,total_usd,created_at FROM orders WHERE order_id=?", (order_id,)).fetchone()
    if not o:
        return {"ok": False, "error": "not_found"}
    rows = con.execute("SELECT product_id,size,qty,price_usd FROM order_items WHERE order_id=?", (order_id,)).fetchall()
    return {"ok": True, "order": dict(o), "items": [dict(r) for r in rows]}

@app.get("/api/orders")
def api_orders_list(session_id: str = Query(...)):
    con = db()
    if not con:
        return {"ok": True, "orders": []}
    rows = con.execute("SELECT order_id,total_usd,created_at FROM orders WHERE session_id=? ORDER BY created_at DESC", (session_id,)).fetchall()
    return {"ok": True, "orders": [dict(r) for r in rows]}

@app.get("/api/orders/{order_id}/receipt")
def api_receipt(order_id: str):
    con = db()
    if not con:
        return {"error": "no_db"}
    o = con.execute("SELECT order_id,session_id,total_usd,created_at FROM orders WHERE order_id=?", (order_id,)).fetchone()
    if not o:
        return {"error": "not_found"}
    rows = con.execute("SELECT product_id,size,qty,price_usd FROM order_items WHERE order_id=?", (order_id,)).fetchall()
    lines = [f"Order: {o['order_id']}", f"Created: {o['created_at']}", "Items:"]
    for r in rows:
        lines.append(f"- {r['product_id']} x{r['qty']} size:{r['size'] or '-'} ${r['price_usd']}")
    lines.append(f"TOTAL: ${o['total_usd']}")
    return {"receipt": "\n".join(lines)}

# ---------- Предпочтения ----------
@app.get("/api/prefs")
def get_prefs(session_id: str = Query(...)):
    con = db()
    if not con:
        return {"session_id": session_id, "json": {}}
    row = con.execute("SELECT json FROM user_prefs WHERE session_id=?", (session_id,)).fetchone()
    return {"session_id": session_id, "json": json.loads(row["json"]) if row else {}}

@app.post("/api/prefs/set")
def set_prefs(b: PrefsBody):
    con = db()
    if not con:
        return {"ok": False, "error": "no_db"}
    js = json.dumps(b.json, ensure_ascii=False)
    con.execute("""
        INSERT INTO user_prefs(session_id, json)
        VALUES(?, ?)
        ON CONFLICT(session_id) DO UPDATE SET json=excluded.json
    """, (b.session_id, js))
    con.commit()
    return {"ok": True}

# ---------- LGBM rerank endpoint (debug/тест) ----------
@app.post("/api/rerank/lgbm")
def api_rerank_lgbm(body: Dict[str, Any] = Body(...)):
    """
    body = { "query": "...", "ids": ["p1","p2",...], "session_id": "..." }
    """
    ids = (body or {}).get("ids") or []
    q = (body or {}).get("query") or ""
    session_id = (body or {}).get("session_id")
    items = _fetch_products_by_ids(ids)
    try:
        items2 = _lgbm_rerank(q, items, session_id)
    except Exception:
        items2 = items
    return {"items": items2, "total": len(items2)}