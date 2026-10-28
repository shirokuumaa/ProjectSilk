# scripts/avatar/measure.py
#
# Обмеры болванки в сантиметрах. Чистый numpy, без bpy: один и тот же код
# работает в калибровке и в проверочных картинках.
#
# Система координат glTF: Y вверх, X — вбок (+X — левая сторона тела), Z — вперёд.
# Значения морфов: u[i] от −1 до +1 (и дальше, если разрешено):
#   u > 0 → ключ <name>_incr с весом u; u < 0 → <name>_decr с весом −u.

import numpy as np

import config

ARM_BONES = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")

DEFINITIONS = {
    "height": "Top of head to sole, standing in A-pose.",
    "bust": "Horizontal tape at bust-point (nipple) level, arms excluded; tape bridges hollows (convex hull).",
    "waist": "Horizontal torso girth at the natural waist level: where the neutral body is narrowest, kept at the same fraction of the crotch-to-nipple distance (see waistLevel); arms excluded.",
    "hips": "Horizontal girth at the level of maximum buttock prominence: where the neutral body's buttocks protrude furthest back, kept at the same fraction of the crotch-to-nipple distance (see hipLevel); hands excluded.",
    "shoulder": "Back shoulder width: surface distance across the back from left to right shoulder point via the cervicale (C7), tape bridges hollows. Shoulder point = corner of the front silhouette where the shoulder line turns into the arm.",
    "arm_length": "Shoulder point to outer elbow point to outer wrist point (along the straight A-pose arm), averaged over both arms.",
    "inseam": "Crotch point to floor.",
}


def key_weights(u):
    """8 значений морфов → 16 весов ключей в порядке config.KEY_NAMES."""
    u = np.asarray(u, dtype=np.float64)
    k = np.empty(len(u) * 2)
    k[0::2] = np.maximum(u, 0.0)
    k[1::2] = np.maximum(-u, 0.0)
    return k


def hull(points):
    """Выпуклая оболочка 2D-точек (монотонная цепь), против часовой стрелки."""
    p = np.unique(np.round(points, 7), axis=0)
    if len(p) < 3:
        return p
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def half(pts):
        out = []
        for q in pts:
            while len(out) >= 2:
                a, b = out[-2], out[-1]
                if (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) <= 0:
                    out.pop()
                else:
                    break
            out.append(q)
        return out

    lower, upper = half(p), half(p[::-1])
    return np.array(lower[:-1] + upper[:-1])


def perimeter(poly):
    if len(poly) < 2:
        return 0.0
    return float(np.linalg.norm(np.roll(poly, -1, axis=0) - poly, axis=1).sum())


class Band:
    """Треугольники, пересекающие диапазон высот: сечения внутри него считаются быстро."""

    def __init__(self, co, tris, y_lo, y_hi):
        tri_y = co[tris][:, :, 1]
        keep = (tri_y.max(1) >= y_lo) & (tri_y.min(1) <= y_hi)
        self.v = co[tris[keep]]                     # (T, 3, 3)

    def section(self, y):
        """Точки пересечения поверхности с плоскостью Y = y, в проекции (x, z)."""
        out = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            a, b = self.v[:, i], self.v[:, j]
            s = (a[:, 1] - y) * (b[:, 1] - y) < 0
            if s.any():
                t = (y - a[s, 1]) / (b[s, 1] - a[s, 1])
                p = a[s] + (b[s] - a[s]) * t[:, None]
                out.append(p[:, [0, 2]])
        return np.concatenate(out) if out else np.empty((0, 2))

    def girth(self, y):
        h = hull(self.section(y))
        return perimeter(h), h


def scan(band, y_lo, y_hi, pick):
    """Ищем самый широкий (pick=max) или самый узкий (pick=min) обхват в диапазоне высот."""
    best = None
    for step, lo, hi in ((0.005, y_lo, y_hi), (0.0005, None, None)):
        if lo is None:
            lo, hi = max(y_lo, best[1] - 0.005), min(y_hi, best[1] + 0.005)
        for y in np.arange(lo, hi + step / 2, step):
            g, h = band.girth(y)
            if g <= 0:
                continue
            if best is None or (g > best[0] if pick == "max" else g < best[0]):
                best = (g, y, h)
    return best


class Body:
    def __init__(self, data, landmarks_pos):
        self.base = data["positions"]
        self.tris = data["triangles"]
        self.deltas = np.stack([data["morphs"][name] for name in config.KEY_NAMES])   # (16, V, 3)
        self.underwear = data.get("underwear")       # маска белья (расстояние до края, м) или None

        names = data["joint_names"]
        arm_joint = np.array([n.split("_")[0] in ARM_BONES for n in names])
        weights = np.zeros((len(self.base), len(names)))
        np.add.at(weights, (np.arange(len(self.base))[:, None], data["joints"]), data["weights"])
        arm_vertex = (weights[:, arm_joint].sum(1) > 0.5)
        self.torso_tris = self.tris[~arm_vertex[self.tris].any(1)]

        # ориентиры: ближайшая вершина GLB к точке из сборки (у шва UV вершины дублируются — берём все копии)
        self.landmarks = {}
        for name, pos in landmarks_pos.items():
            d = np.linalg.norm(self.base - np.array(pos), axis=1)
            self.landmarks[name] = np.flatnonzero(d <= d.min() + 1e-7)

        # уровень естественной талии: самое узкое место нейтральной фигуры,
        # в долях расстояния пах → линия сосков (дальше этот уровень едет вместе с телом)
        crotch_y, nipple_y = self._levels(self.base)
        span = nipple_y - crotch_y
        band = Band(self.base, self.torso_tris, crotch_y, nipple_y)
        _, y, _ = scan(band, crotch_y + 0.40 * span, crotch_y + 0.85 * span, "min")
        self.waist_level = float((y - crotch_y) / span)

        # уровень бёдер: наибольший выступ ягодиц назад у нейтральной фигуры.
        # Не «самый широкий обхват»: в A-позе ноги разведены, и у паха оболочка
        # охватывает разведённые бёдра — у стоящего со сведёнными ногами такого нет.
        levels = np.arange(0.0, 0.6, 0.005)
        backmost = []
        for f in levels:
            p = band.section(crotch_y + f * span)
            p = p[np.abs(p[:, 0]) < 0.10]
            backmost.append(p[:, 1].min() if len(p) else np.inf)
        self.hip_level = float(levels[int(np.argmin(backmost))])

    def _levels(self, co):
        nipple_y = 0.5 * (self.point(co, "nipple_l")[1] + self.point(co, "nipple_r")[1])
        return self.point(co, "crotch")[1], nipple_y

    def coords(self, u):
        k = key_weights(u)
        return self.base + np.tensordot(k, self.deltas, axes=1)

    def point(self, co, name):
        return co[self.landmarks[name]].mean(0)

    def measure(self, u, with_geometry=False):
        co = self.coords(u)
        floor, top = co[:, 1].min(), co[:, 1].max()
        crotch_y, nipple_y = self._levels(co)
        crotch = self.point(co, "crotch")
        span = nipple_y - crotch_y

        torso = Band(co, self.torso_tris, crotch_y, nipple_y + 0.01)
        waist_y = crotch_y + self.waist_level * span
        bust = (*torso.girth(nipple_y), nipple_y)          # (обхват, оболочка, уровень)
        waist = (*torso.girth(waist_y), waist_y)
        hip_y = crotch_y + self.hip_level * span
        hips = (*torso.girth(hip_y), hip_y)

        # плечи по спине: сечение плоскостью через обе плечевые точки и шейную точку C7,
        # лента идёт по спине от правой плечевой точки к левой и перекрывает впадины
        sl, sr = self.point(co, "shoulder_l"), self.point(co, "shoulder_r")
        c7 = self.point(co, "cervicale")
        chord = np.linalg.norm(sl - sr)
        e1 = (sl - sr) / chord
        normal = np.cross(sl - sr, c7 - sr)
        normal /= np.linalg.norm(normal)
        e2 = np.cross(normal, e1)
        if (c7 - sr) @ e2 < 0:
            e2 = -e2
        near = self.tris[(co[self.tris][:, :, 1] > min(sl[1], sr[1]) - 0.12).all(1)]
        d = (co - sr) @ normal
        cut = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            a, b = near[:, i], near[:, j]
            s = d[a] * d[b] < 0
            t = d[a[s]] / (d[a[s]] - d[b[s]])
            cut.append(co[a[s]] + (co[b[s]] - co[a[s]]) * t[:, None])
        cut = np.concatenate(cut) - sr
        flat = np.column_stack([cut @ e1, cut @ e2])
        flat = flat[(flat[:, 0] > 0) & (flat[:, 0] < chord) & (flat[:, 1] > 0)]
        back_hull = hull(np.vstack([flat, [[0.0, 0.0], [chord, 0.0]]]))
        shoulder = perimeter(back_hull) - chord

        arms = {}
        for side, s in (("l", sl), ("r", sr)):
            e, w = self.point(co, f"elbow_{side}"), self.point(co, f"wrist_{side}")
            arms[side] = (np.array([s, e, w]), np.linalg.norm(e - s) + np.linalg.norm(w - e))
        arm = 0.5 * (arms["l"][1] + arms["r"][1])

        result = {
            "height": (top - floor) * 100,
            "bust": bust[0] * 100,
            "waist": waist[0] * 100,
            "hips": hips[0] * 100,
            "shoulder": shoulder * 100,
            "arm_length": arm * 100,
            "inseam": (crotch[1] - floor) * 100,
        }
        if not with_geometry:
            return result

        def ring(h, y):
            return np.column_stack([h[:, 0], np.full(len(h), y), h[:, 1]])

        # задняя дуга плеч без хорды, обратно в 3D
        arc = back_hull[back_hull[:, 1] > 1e-9]
        arc = arc[np.argsort(np.arctan2(arc[:, 1], arc[:, 0] - chord / 2))[::-1]]
        arc = np.vstack([[[0.0, 0.0]], arc, [[chord, 0.0]]])
        geometry = {
            "bust": ring(bust[1], bust[2]),
            "waist": ring(waist[1], waist[2]),
            "hips": ring(hips[1], hips[2]),
            "shoulder": sr + np.outer(arc[:, 0], e1) + np.outer(arc[:, 1], e2),
            "arm_l": arms["l"][0],
            "arm_r": arms["r"][0],
            "inseam": np.array([crotch, [crotch[0], floor, crotch[2]]]),
        }
        return result, geometry, co
