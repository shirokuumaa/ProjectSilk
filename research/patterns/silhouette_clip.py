"""Silhouette from the item photo with CLIP zero-shot (Mac CPU) vs the AIpparel pattern rules (day 6).

The seller states the type (dress / skirt / top); CLIP chooses the template inside it by comparing
the photo with text prompts (several per template, averaged). Prompts were written once, before
looking at the results, and are not tuned on these 10 items (with 10 items any tuning would overfit).

Models (both MIT): openai/clip-vit-large-patch14 and patrickjohncyh/fashion-clip (ViT-B/32 tuned on
fashion products). Weights from Hugging Face into .envs/hf-mac.

Metrics per photo kind (item photo / photo on the model): top-1 exact, top-1 incl. acceptable
alternative, top-2 contains the label (= a 2-option choice for the seller), and two combinations
with the rules: "rules + CLIP" (2 options: the rule's template and CLIP's top-1 if different).

Usage: HF_HOME=.envs/hf-mac .envs/mac-aipparel/venv-aipparel/bin/python silhouette_clip.py
  -> runs/clip/report.md, runs/clip/scores.json
"""
import json
import time
from pathlib import Path

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

from suggest_template import LABELS, TYPE
from templates import TEMPLATES

HERE = Path(__file__).resolve().parent
INPUTS = HERE / "runs" / "inputs"
OUT = HERE / "runs" / "clip"
MODELS = ["openai/clip-vit-large-patch14", "patrickjohncyh/fashion-clip"]
FRAMES = ["a photo of {}.", "a product photo of {}.", "{}"]
PROMPTS = {
    "dress_fitted": ["a fitted bodycon dress", "a tight sheath dress that hugs the body",
                     "a slim fitted dress with a straight narrow skirt"],
    "dress_aline": ["an A-line dress", "a dress with a slightly flared A-line skirt",
                    "a straight loose shift dress"],
    "dress_flared": ["a dress with a full flared skirt", "a dress with a wide circle skirt",
                     "a fit and flare dress with a very full skirt"],
    "skirt_pencil": ["a pencil skirt", "a straight fitted skirt", "a tight narrow skirt"],
    "skirt_aline": ["an A-line skirt", "a slightly flared trapeze skirt", "a skirt that widens a little towards the hem"],
    "skirt_flared": ["a flared circle skirt", "a full skater skirt", "a full skirt with lots of volume and folds"],
    "top_fitted": ["a tight fitted top", "a slim fit body hugging t-shirt", "a fitted stretch top"],
    "top_loose": ["a loose fitting top", "a relaxed boxy t-shirt", "a straight cut loose blouse"],
}


@torch.no_grad()
def text_embeddings(model, proc, names):
    emb = {}
    for n in names:
        texts = [f.format(p) for p in PROMPTS[n] for f in FRAMES]
        t = model.get_text_features(**proc(text=texts, return_tensors="pt", padding=True))
        t = t / t.norm(dim=-1, keepdim=True)
        m = t.mean(0)
        emb[n] = m / m.norm()
    return emb


@torch.no_grad()
def image_embedding(model, proc, path):
    x = model.get_image_features(**proc(images=Image.open(path).convert("RGB"), return_tensors="pt"))
    return (x / x.norm(dim=-1, keepdim=True))[0]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rules = json.loads((HERE / "runs" / "day6" / "suggestions.json").read_text())
    torch.set_num_threads(8)
    scores, timing = {}, {}
    for mid in MODELS:
        t0 = time.time()
        model, proc = CLIPModel.from_pretrained(mid).eval(), CLIPProcessor.from_pretrained(mid)
        load = time.time() - t0
        per = []
        for item, lab in LABELS.items():
            t = TYPE[item.split("_")[1]]
            names = [n for n, v in TEMPLATES.items() if v["type"] == t]
            temb = text_embeddings(model, proc, names)
            for view in ("item", "model"):
                t1 = time.time()
                im = image_embedding(model, proc, INPUTS / "images" / f"{item}__{view}.png")
                per.append(time.time() - t1)
                logits = torch.stack([im @ temb[n] for n in names]) * 100.0
                p = logits.softmax(0).tolist()
                scores[f"{mid}|{item}|{view}"] = dict(sorted(zip(names, p), key=lambda kv: -kv[1]))
        timing[mid] = (load, sum(per) / len(per))
        print(f"{mid}: load {load:.1f} s, {timing[mid][1]:.2f} s/photo")

    def ok(name, lab, alt=True):
        return name == lab["template"] or (alt and name in lab["alt"])

    lines = ["# Классификатор силуэта по фото вещи: CLIP против правил AIpparel\n",
             "Тип вещи даёт продавец; модель выбирает шаблон внутри типа (платья и юбки — из 3, топы — из 2). "
             "Подсказки (промпты) написаны один раз до прогона и не подбирались под эти 10 вещей.\n",
             "Правила — `suggest_template.py` по выкройке AIpparel «фото вещи + описание» (день 6). "
             "«2 варианта» — продавцу показываем 2 картинки: для CLIP это его топ-2, для «правила + CLIP» — "
             "шаблон правил и топ-1 CLIP (если совпали — один вариант). У топов шаблонов всего 2, поэтому "
             "топ-2 по топам всегда верен; отдельно — платья и юбки (6 вещей).\n",
             "| Способ | Фото | Точно | С допустимой альтернативой | Платья+юбки: точно | 2 варианта: верный среди них | Платья+юбки: 2 варианта |",
             "|---|---|---|---|---|---|---|"]
    rule = {i: rules[f"{i}__item__text_image"]["template"] for i in LABELS}
    ex = sum(ok(rule[i], l, False) for i, l in LABELS.items())
    al = sum(ok(rule[i], l) for i, l in LABELS.items())
    ds = [i for i in LABELS if TYPE[i.split("_")[1]] != "top"]
    exd = sum(ok(rule[i], LABELS[i], False) for i in ds)
    lines.append(f"| Правила AIpparel (день 6) | вещь + описание | {ex}/10 | {al}/10 | {exd}/6 | — | — |")
    for mid in MODELS:
        for view in ("item", "model"):
            top = {i: list(scores[f"{mid}|{i}|{view}"]) for i in LABELS}
            ex = sum(ok(top[i][0], l, False) for i, l in LABELS.items())
            al = sum(ok(top[i][0], l) for i, l in LABELS.items())
            exd = sum(ok(top[i][0], LABELS[i], False) for i in ds)
            t2 = sum(any(ok(n, l) for n in top[i][:2]) for i, l in LABELS.items())
            t2d = sum(any(ok(n, LABELS[i]) for n in top[i][:2]) for i in ds)
            short = mid.split("/")[1]
            name = {"item": "вещь", "model": "на модели"}[view]
            lines.append(f"| CLIP {short} | {name} | {ex}/10 | {al}/10 | {exd}/6 | {t2}/10 | {t2d}/6 |")
            if view == "item":
                both = sum(ok(rule[i], l) or ok(top[i][0], l) for i, l in LABELS.items())
                bothd = sum(ok(rule[i], LABELS[i]) or ok(top[i][0], LABELS[i]) for i in ds)
                agree = sum(rule[i] == top[i][0] for i in LABELS)
                agree_ok = sum(rule[i] == top[i][0] and ok(rule[i], LABELS[i]) for i in LABELS)
                lines.append(f"| правила + CLIP {short} | вещь | совпали {agree}/10, из них верно {agree_ok} | — | — | "
                             f"{both}/10 | {bothd}/6 |")
    lines += ["\n## По вещам (фото вещи)\n",
              "| Вещь | Разметка | Правила | " + " | ".join(f"CLIP {m.split('/')[1]} (вероятности)" for m in MODELS) + " |",
              "|---|---|---|" + "---|" * len(MODELS)]
    for i, l in LABELS.items():
        cells = []
        for mid in MODELS:
            s = scores[f"{mid}|{i}|item"]
            n0 = next(iter(s))
            mark = "✓" if ok(n0, l, False) else ("≈" if ok(n0, l) else "✗")
            cells.append(f"{mark} " + ", ".join(f"{k.split('_')[1]} {v:.2f}" for k, v in s.items()))
        rm = "✓" if ok(rule[i], l, False) else ("≈" if ok(rule[i], l) else "✗")
        lines.append(f"| {i} | {l['template']} | {rule[i]} {rm} | " + " | ".join(cells) + " |")
    lines.append("\nВремя на M3 Max CPU: " + "; ".join(
        f"{m.split('/')[1]} — загрузка {a:.0f} с, {b:.2f} с на фото" for m, (a, b) in timing.items()))
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    (OUT / "scores.json").write_text(json.dumps(scores, indent=1, ensure_ascii=False))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
