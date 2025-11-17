# assistant/train_lgbm.py
"""
Обучение LGBM для второго этапа ранжирования.
Берём события из data/logs/events.jsonl, вытаскиваем товары из SQLite (DB_PATH) или CSV (CSV_PATH),
строим признаки и обучаем модель. Файл сохраняется в LGBM_MODEL (по умолчанию data/lgbm_model.txt).

Фичи (должны совпадать с API):
[ overlap, price, under_budget, liked_color, cos ]

- overlap: пересечение токенов запроса с текстом товара
- price: цена товара
- under_budget: 1, если цена <= budget_usd пользователя (из prefs), иначе 0
- liked_color: 1, если цвет товара в prefs.colors_like, иначе 0
- cos: косинусная близость (через sentence-transformers), если доступен
"""

import os, json, re, sqlite3
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

import numpy as np

# ---- Пути/конфиг
LOG_PATH = Path(os.environ.get("LOG_PATH", "data/logs/events.jsonl"))
DB_PATH  = os.environ.get("DB_PATH", "data/products.db")
CSV_PATH = os.environ.get("CSV_PATH", "data/seed_catalog_dresses.csv")
OUT_PATH = Path(os.environ.get("LGBM_MODEL", "data/lgbm_model.txt"))

# ---- Ленивая загрузка sentence-transformers (необязателен)
class _SemEnc:
    _model = None

    @classmethod
    def encode(cls, text: str) -> Optional[np.ndarray]:
        try:
            if cls._model is None:
                from sentence_transformers import SentenceTransformer
                cls._model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            v = cls._model.encode([text or ""], convert_to_numpy=True, normalize_embeddings=True)[0]
            return v
        except Exception:
            return None

# ---- Данные: SQLite или CSV
def _db_conn() -> Optional[sqlite3.Connection]:
    if not Path(DB_PATH).exists():
        return None
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

_DF = None
def _csv_df():
    global _DF
    if _DF is None:
        try:
            import pandas as pd
            if Path(CSV_PATH).exists():
                _DF = pd.read_csv(CSV_PATH)
            else:
                _DF = None
        except Exception:
            _DF = None
    return _DF

def _fetch_products_by_ids(ids: List[str]) -> List[Dict[str, Any]]:
    ids = [x for x in (ids or []) if x]
    if not ids:
        return []
    con = _db_conn()
    if con:
        qmarks = ",".join(["?"] * len(ids))
        rows = con.execute(
            f"""SELECT product_id,title,price_usd,sizes,color,style,silhouette,occasion,material,length,image_url,stock
                FROM products WHERE product_id IN ({qmarks})""",
            ids
        ).fetchall()
        con.close()
        return [dict(r) for r in rows]

    # CSV фолбэк
    df = _csv_df()
    if df is None:
        return []
    cur = df[df["product_id"].isin(ids)]
    cols = ["product_id","title","price_usd","sizes","color","style","silhouette","occasion","material","length","image_url","stock"]
    for c in cols:
        if c not in cur.columns:
            cur[c] = ""
    # сохранить порядок ids
    order = {pid: i for i, pid in enumerate(ids)}
    recs = cur[cols].to_dict(orient="records")
    return sorted(recs, key=lambda r: order.get(r["product_id"], 10**9))

def _read_prefs_for_session(session_id: Optional[str]) -> Dict[str, Any]:
    if not session_id:
        return {}
    con = _db_conn()
    if not con:
        return {}
    row = con.execute("SELECT json FROM user_prefs WHERE session_id=?", (session_id,)).fetchone()
    con.close()
    if not row:
        return {}
    try:
        return json.loads(row["json"] or "{}")
    except Exception:
        return {}

# ---- Признаки
def _item_text(it: Dict[str, Any]) -> str:
    return " ".join([
        str(it.get("title","")),
        str(it.get("style","")),
        str(it.get("silhouette","")),
        str(it.get("material","")),
        str(it.get("color","")),
        str(it.get("length","")),
    ])

def _extract_features(q: str, it: Dict[str, Any], prefs: Dict[str, Any], enc: _SemEnc) -> List[float]:
    text = _item_text(it).lower()
    tokens = set(re.findall(r"\w+", (q or "").lower()))
    overlap = float(sum(1 for t in tokens if t in text))

    try:
        price = float(it.get("price_usd") or 0.0)
    except Exception:
        price = 0.0

    try:
        budget = float((prefs or {}).get("budget_usd") or 0.0)
    except Exception:
        budget = 0.0
    under_budget = 1.0 if (budget and price and price <= budget) else 0.0

    like = set([str(c).lower() for c in (prefs or {}).get("colors_like") or []])
    col = (it.get("color") or "").lower()
    liked_color = 1.0 if (col in like) else 0.0

    # косинус через энкодер (если доступен)
    cos = 0.0
    try:
        vq = enc.encode(q or "")
        vt = enc.encode(_item_text(it))
        if vq is not None and vt is not None:
            cos = float(vq @ vt)
    except Exception:
        cos = 0.0

    return [overlap, float(price), float(under_budget), float(liked_color), float(cos)]

# ---- Датасет из логов
def _labels_for_event(evt: str) -> float:
    # Жёсткие метки по “силе сигнала”
    if evt == "add_to_cart":
        return 1.0
    if evt == "checkout":
        return 1.1  # чуть сильнее add_to_cart
    if evt in ("compare", "search_click"):
        return 0.6
    if evt in ("similar",):
        return 0.4
    return 0.3

def _iter_samples_from_logs() -> Tuple[List[List[float]], List[float]]:
    X: List[List[float]] = []
    y: List[float] = []
    if not LOG_PATH.exists():
        return X, y

    enc = _SemEnc()
    with LOG_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                j = json.loads(line)
            except Exception:
                continue

            evt = j.get("event")
            if evt not in ("add_to_cart", "checkout", "compare", "similar", "search_click"):
                continue

            meta = j.get("meta") or {}
            q = meta.get("query", "") or ""
            ids = meta.get("ids") or []
            if not ids:
                pid = meta.get("product_id")
                if pid:
                    ids = [pid]
            if not ids:
                continue

            session_id = j.get("session_id")
            prefs = _read_prefs_for_session(session_id)

            items = _fetch_products_by_ids(ids)
            if not items:
                continue

            label = _labels_for_event(evt)
            for it in items:
                feats = _extract_features(q, it, prefs, enc)
                X.append(feats); y.append(label)

    return X, y

def _save_dummy():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        f.write("# dummy lgbm model\n")
    print(f"[train_lgbm] wrote dummy model to {OUT_PATH} (no data or LightGBM unavailable)")

def main():
    # Собираем датасет
    X, y = _iter_samples_from_logs()
    X = np.array(X, dtype=float)
    y = np.array(y, dtype=float)

    if len(y) < 20:
        print(f"[train_lgbm] not enough samples: X={X.shape} y={len(y)} — сгенерируй больше событий и повтори")
        _save_dummy()
        return

    # Обучаем LightGBM
    try:
        import lightgbm as lgb
    except Exception:
        print("[train_lgbm] LightGBM not installed")
        _save_dummy()
        return

    dtrain = lgb.Dataset(X, label=y)
    params = dict(
        objective="regression",
        metric="rmse",
        num_leaves=31,
        learning_rate=0.05,
        feature_pre_filter=False,
        verbosity=-1,
        seed=42,
    )
    mdl = lgb.train(params, dtrain, num_boost_round=200)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    mdl.save_model(str(OUT_PATH))
    print(f"[train_lgbm] saved to {OUT_PATH}; samples: {len(y)}; X={X.shape}")

if __name__ == "__main__":
    main()