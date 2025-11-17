# tools/build_embeddings.py
import json, sqlite3, numpy as np
from sentence_transformers import SentenceTransformer
from pathlib import Path

DB = "data/products.db"
OUT_VECS = "data/embeddings.npy"
OUT_MAP  = "data/id_map.json"

model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

def row_to_text(r):
    parts = [r["title"], r["color"], r["style"], r["silhouette"],
             r["occasion"], r["material"], r["length"]]
    return " | ".join([str(x) for x in parts if x])

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
rows = con.execute("SELECT * FROM products").fetchall()

ids = []
texts = []
for r in rows:
    ids.append(r["product_id"])
    texts.append(row_to_text(r))

emb = model.encode(texts, batch_size=64, convert_to_numpy=True, normalize_embeddings=True)

Path("data").mkdir(parents=True, exist_ok=True)
np.save(OUT_VECS, emb)
with open(OUT_MAP, "w") as f:
    json.dump(ids, f)

print(f"saved {len(ids)} vectors to {OUT_VECS}")