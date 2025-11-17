import os, sqlite3, pandas as pd, argparse, json

parser = argparse.ArgumentParser()
parser.add_argument("--csv", default="data/products.csv")
parser.add_argument("--db", default="data/products.db")
args = parser.parse_args()

os.makedirs(os.path.dirname(args.db), exist_ok=True)
con = sqlite3.connect(args.db)

with open("db/schema.sql","r",encoding="utf-8") as f:
    con.executescript(f.read())

df = pd.read_csv(args.csv)
# Нормализация колонок, если нужно
want_cols = ["product_id","title","price_usd","sizes","color","style",
             "silhouette","occasion","material","length","image_url","stock"]
for c in want_cols:
    if c not in df.columns: df[c] = None

df[want_cols].to_sql("products", con, if_exists="replace", index=False)
con.commit()
print(f"Loaded {len(df)} rows into {args.db}")