# scripts/avatar/accessory_anchors.py
#
# Точки крепления аксессуаров на болванке base_avatar.glb (MPFB/MakeHuman, CC0):
#   client/src/data/accessoryAnchors.json — номера вершин, по которым примерка
#   (client/src/utils/accessoryPlacement.js) находит точку и оси на фигуре покупателя.
#
# Точка — не координаты, а набор вершин: морфы фигуры двигают вершины, и точка
# едет вместе с телом. Ищется на нейтральной фигуре по костям скелета (веса кожи)
# и по форме поверхности. Координаты glTF: Y вверх, +Z — вперёд, +X — левая сторона тела.
#
#   ear_lobe_l/r     мочка уха — серьги (низ кластера уха)
#   ear_top_l/r      верх корня уха — дужки очков
#   sellion          переносица (самая глубокая точка спинки носа) — очки
#   crown, head      макушка и все вершины головы — шапка (сечения головы считает примерка)
#   cervicale        шейный позвонок C7 (из калибровки)
#   jugular          яремная вырезка: спереди на средней линии, на 4 см ниже C7 — ниже неё цепочка лежит на груди
#   neck_side_l/r    бок основания шеи (1 см выше C7) — по ним цепочка переходит со спины на грудь
#   neck_front       перед шеи на том же уровне — основание шеи спереди
#   shoulder_top_l/r верх плеча между шеей и плечевой точкой — ремень сумки
#   wrist_l/r        кольцо вершин запястья (часы, браслет); forearm_l/r — кольцо середины предплечья
#                    (вместе — ось руки); wrist_dorsal_l/r — вершина тыльной стороны (циферблат)
#   ring_l/r         кольцо вершин на основной фаланге безымянного пальца (40 % от сустава);
#                    ring_tip_l/r — у следующего сустава (ось пальца); ring_dorsal_l/r — тыльная сторона
#   grip_l/r         основные фаланги четырёх пальцев — ручка сумки в руке
#   heel_l/r, toe_l/r, foot_l/r  пятка, носок, все вершины стопы — обувь
#
# Запуск (окружение research/patterns/.envs/mac):
#   research/patterns/.envs/mac/bin/python scripts/avatar/accessory_anchors.py

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
import glb  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
CALIBRATION = REPO / "client" / "src" / "data" / "avatarCalibration.json"
OUT = REPO / "client" / "src" / "data" / "accessoryAnchors.json"

ARM = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")
JUGULAR_BELOW_C7 = 0.04    # м; у взрослых яремная вырезка на 4–6 см ниже C7 по высоте


def bone_heads(doc, binary, names):
    """Начала костей в позе привязки — из inverseBindMatrices (glTF хранит матрицы по столбцам)."""
    ibm = glb.accessor(doc, binary, doc["skins"][0]["inverseBindMatrices"]).reshape(-1, 4, 4)
    return {n: np.linalg.inv(m.T)[:3, 3] for n, m in zip(names, ibm)}


def dominant_bone(joints, weights, names):
    """Кость с наибольшим весом у каждой вершины."""
    return np.array([names[j[np.argmax(w)]] for j, w in zip(joints, weights)])


def near(P, ids, point, radius):
    """Вершины из ids в пределах radius от point."""
    return ids[np.linalg.norm(P[ids] - point, axis=1) < radius]


def ring(P, ids, centre, axis, half=0.003, rmax=0.05):
    """Вершины из ids в слое толщиной 2·half вокруг плоскости через centre, перпендикулярной axis."""
    axis = axis / np.linalg.norm(axis)
    d = (P[ids] - centre) @ axis
    radial = np.linalg.norm(P[ids] - centre - np.outer(d, axis), axis=1)
    return ids[(np.abs(d) < half) & (radial < rmax)]


def extreme(P, ids, direction, centre=None):
    """Вершина из ids, дальше всех по направлению direction (от centre)."""
    c = np.zeros(3) if centre is None else centre
    return int(ids[np.argmax((P[ids] - c) @ np.asarray(direction, float))])


def front_profile(P, ids, y0, y1, step=0.002):
    """Самые передние вершины ids по слоям высоты: [(y, вершина)]."""
    out = []
    for y in np.arange(y0, y1, step):
        s = ids[np.abs(P[ids, 1] - y) < step / 2]
        if len(s):
            out.append((y, int(s[np.argmax(P[s, 2])])))
    return out


def find_anchors(body, calibration):
    P = body["positions"]
    names = body["joint_names"]
    doc, binary = body["doc"], body["binary"]
    B = bone_heads(doc, binary, names)
    dom = dominant_bone(body["joints"], body["weights"], names)
    all_ids = np.arange(len(P))
    arm = np.array([d.startswith(ARM) for d in dom])
    head = all_ids[dom == "head"]
    lm = calibration["landmarks"]
    a = {}

    # голова: ухо — вершины головы, выступающие вбок за череп, на высоте от кости head −2 см до +6 см
    skull = np.abs(P[head[(P[head, 1] > B["head"][1] + 0.05) & (P[head, 1] < B["head"][1] + 0.08)], 0]).max()
    for side, sign in (("l", 1), ("r", -1)):
        ear = head[(sign * P[head, 0] > skull - 0.002) & (P[head, 1] > B["head"][1] - 0.02)
                   & (P[head, 1] < B["head"][1] + 0.06)]
        assert 100 < len(ear) < 400, f"ear {side}: {len(ear)} vertices"
        lobe = ear[np.argmin(P[ear, 1])]
        a[f"ear_lobe_{side}"] = near(P, ear, P[lobe], 0.004)
        top = ear[P[ear, 1] > P[ear, 1].max() - 0.006]
        a[f"ear_top_{side}"] = top[np.argsort(sign * P[top, 0])[:4]]       # ближе к черепу — там лежит дужка

    # переносица: самая глубокая точка профиля лица на 1,5–5 см выше кончика носа
    mid = head[(np.abs(P[head, 0]) < 0.004) & (P[head, 2] > B["head"][2] + 0.05)]   # лицо, не затылок
    prof = front_profile(P, mid, B["head"][1] - 0.01, B["head"][1] + 0.09)
    tip_y, tip = max(prof, key=lambda p: P[p[1], 2] if p[0] < B["head"][1] + 0.03 else -1)
    bridge = [p for p in prof if tip_y + 0.015 < p[0] < tip_y + 0.05]
    a["sellion"] = near(P, mid, P[min(bridge, key=lambda p: P[p[1], 2])[1]], 0.004)

    top = head[np.argmax(P[head, 1])]
    a["crown"] = near(P, head, P[top], 0.01)
    a["head"] = head

    # шея: C7 из калибровки; яремная вырезка — передняя точка средней линии на 4 см ниже C7
    a["cervicale"] = np.array(lm["cervicale"])
    c7 = P[lm["cervicale"]].mean(0)
    torso_mid = all_ids[(np.abs(P[:, 0]) < 0.003) & ~arm & (dom != "head")]
    level = torso_mid[np.abs(P[torso_mid, 1] - (c7[1] - JUGULAR_BELOW_C7)) < 0.004]
    a["jugular"] = np.array([extreme(P, level, (0, 0, 1))])
    jug = P[a["jugular"][0]]
    # бок основания шеи: самые боковые вершины шеи на 1 см выше C7 (ниже начинается трапеция:
    # обхват на уровне C7 — 40 см, на 1 см выше — 35 см, на 2 см — 31 см)
    level = all_ids[~arm & (dom != "head") & (np.abs(P[:, 1] - (c7[1] + 0.01)) < 0.004) & (np.abs(P[:, 0]) < 0.075)]
    for side, sign in (("l", 1), ("r", -1)):
        s = level[sign * P[level, 0] > 0]
        a[f"neck_side_{side}"] = np.array([extreme(P, s, (sign, 0, 0))])
    # перед шеи на том же уровне: по нему и бокам шеи — основание шеи (чокер, начало цепочки)
    a["neck_front"] = np.array([extreme(P, level[np.abs(P[level, 0]) < 0.004], (0, 0, 1))])

    # верх плеча: середина между боком шеи и плечевой точкой, самая высокая вершина торса над ней
    below_head = all_ids[dom != "head"]                     # верх плеча у MPFB весит на upperarm
    for side in "lr":
        m = (P[a[f"neck_side_{side}"][0]] + P[lm[f"shoulder_{side}"]].mean(0)) / 2
        col = below_head[np.hypot(P[below_head, 0] - m[0], P[below_head, 2] - m[2]) < 0.015]
        a[f"shoulder_top_{side}"] = np.array([int(col[np.argmax(P[col, 1])])])

    # руки
    for side in "lr":
        own = all_ids[arm & (np.sign(P[:, 0]) == (1 if side == "l" else -1))]
        elbow, wrist = B[f"lowerarm_{side}"], B[f"hand_{side}"]
        forearm = wrist - elbow
        a[f"wrist_{side}"] = ring(P, own, wrist, forearm)
        a[f"forearm_{side}"] = ring(P, own, (elbow + wrist) / 2, forearm, half=0.012, rmax=0.07)   # сетка предплечья редкая
        fingers = B[f"middle_01_{side}"] - wrist
        thumb = B[f"thumb_01_{side}"] - wrist
        # тыльная сторона кисти: правило правой руки (левая — thumb × fingers, правая — наоборот)
        dorsal = np.cross(thumb, fingers) if side == "l" else np.cross(fingers, thumb)
        wc = P[a[f"wrist_{side}"]].mean(0)
        a[f"wrist_dorsal_{side}"] = np.array([extreme(P, a[f"wrist_{side}"], dorsal, wc)])

        r1, r2 = B[f"ring_01_{side}"], B[f"ring_02_{side}"]
        finger = all_ids[dom == f"ring_01_{side}"]
        a[f"ring_{side}"] = ring(P, finger, r1 + 0.4 * (r2 - r1), r2 - r1, half=0.002, rmax=0.015)
        a[f"ring_tip_{side}"] = ring(P, finger, r1 + 0.9 * (r2 - r1), r2 - r1, half=0.002, rmax=0.015)
        rc = P[a[f"ring_{side}"]].mean(0)
        a[f"ring_dorsal_{side}"] = np.array([extreme(P, a[f"ring_{side}"], dorsal, rc)])
        a[f"grip_{side}"] = all_ids[np.isin(dom, [f"{f}_01_{side}" for f in ("index", "middle", "ring", "pinky")])]

    # стопы: пятка и носок — самые задняя и передняя вершины стопы у пола
    for side in "lr":
        foot = all_ids[np.isin(dom, [f"foot_{side}", f"ball_{side}"])]
        low = foot[P[foot, 1] < 0.03]
        a[f"foot_{side}"] = foot
        a[f"heel_{side}"] = near(P, low, P[low[np.argmin(P[low, 2])]], 0.01)
        a[f"toe_{side}"] = near(P, low, P[low[np.argmax(P[low, 2])]], 0.006)
    return {k: sorted(int(i) for i in v) for k, v in a.items()}


def describe(P, anchors):
    """Точки на нейтральной фигуре, см — для проверки глазами."""
    return {k: [round(float(c) * 100, 1) for c in P[v].mean(0)] for k, v in anchors.items() if len(v) < 300}


def main():
    path = config.GLB_PATH if hasattr(config, "GLB_PATH") else REPO / "client" / "public" / "models" / "base_avatar.glb"
    body = glb.load_body(path)
    body["binary"] = glb.read_chunks(path)[1]
    calibration = json.loads(CALIBRATION.read_text())
    anchors = find_anchors(body, calibration)
    P = body["positions"]
    out = {
        "version": 1,
        "generated": date.today().isoformat(),
        "model": Path(path).name,
        "source": "scripts/avatar/accessory_anchors.py",
        "units": "vertex indices of the base mesh; points are vertex means on the buyer's morphed figure",
        "anchors": anchors,
        "neutralCm": describe(P, anchors),
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    for k, v in out["neutralCm"].items():
        print(f"{k:18s} {len(anchors[k]):4d} verts  {v}")
    print(OUT, f"{OUT.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
