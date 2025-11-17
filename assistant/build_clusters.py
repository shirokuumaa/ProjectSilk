import os, json
import numpy as np
from pathlib import Path
from sklearn.cluster import KMeans

EMB = Path("data/embeddings.npy")
IDM = Path("data/id_map.json")
OUT = Path("data/kmeans_labels.npy")

def main(k=20):
    if not (EMB.exists() and IDM.exists()):
        print("no embeddings"); return
    X = np.load(str(EMB))
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = km.fit_predict(X)
    np.save(str(OUT), labels)
    print("saved", OUT)

if __name__ == "__main__":
    main()