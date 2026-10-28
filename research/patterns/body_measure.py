"""GarmentCode's 26 body measurements, measured on any A-pose body mesh (cm, Y up, +Z front, +X = body's left).

Definitions: GarmentCode docs/Body Measurements GarmentCode.pdf. Their measuring code
(GarmentMeasurements) is GPL, so this is our own implementation of the definitions, checked on
the GarmentCode bodies whose measurements are published (mean_all / mean_female / mean_male):
`python body_measure.py --check`.

Input: vertices (cm), triangles, labels {body, left_arm, right_arm, left_leg, right_leg}
(index arrays, the ggg_body_segmentation.json scheme). Sections reuse scripts/avatar/measure.py
(convex hull girth = tape bridging hollows).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "avatar"))
from measure import Band, hull, perimeter  # noqa: E402

GC_BODIES = HERE / ".envs" / "src" / "GarmentCode" / "assets" / "bodies"
KEYS = ["arm_length", "arm_pose_angle", "armscye_depth", "back_width", "bum_points", "bust", "bust_line",
        "bust_points", "crotch_hip_diff", "head_l", "height", "hip_back_width", "hip_inclination", "hips",
        "hips_line", "leg_circ", "neck_w", "shoulder_incl", "shoulder_w", "underbust", "vert_bust_line",
        "waist", "waist_back_width", "waist_line", "waist_over_bust_line", "wrist"]


# Systematic differences to GarmentCode's own measuring on their 3 mean bodies (python body_measure.py
# --check prints the fit): our tape span between the breasts / buttocks is shorter than their "peak points"
# distance, our bust level is ~2 cm lower (nipple), our shoulder point ~0.6 cm further out, our balance plane
# gives a ~1.4 cm longer back waist. Fitted on mean_all + mean_female; mean_male is the check.
CAL_MUL = {"bust_points": 1.19, "bum_points": 1.50}
CAL_ADD = {"vert_bust_line": -2.0, "waist_over_bust_line": 2.3, "crotch_hip_diff": -1.6, "shoulder_w": -1.3,
           "waist_back_width": -1.4, "back_width": -1.0, "armscye_depth": -0.6}
ARM_D = (12, 30)  # upper arm part (cm from the shoulder point) for the pose angle


def tris_of(F, idx):
    m = np.zeros(F.max() + 1, bool)
    m[idx] = True
    return F[m[F].all(1)]


def back_part(h, z_split):
    """Length of the hull polygon's part behind the coronal plane z = z_split (balance line to balance line)."""
    n = len(h)
    total = 0.0
    for i in range(n):
        a, b = h[i], h[(i + 1) % n]
        za, zb = a[1] - z_split, b[1] - z_split
        if za <= 0 and zb <= 0:
            total += np.linalg.norm(b - a)
        elif za < 0 or zb < 0:
            t = za / (za - zb)
            p = a + (b - a) * t
            total += np.linalg.norm((a if za < 0 else b) - p)
    return total


def profile_length(pts):
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


class Measurer:
    def __init__(self, V, F, labels):
        self.V, self.F = np.asarray(V, float), np.asarray(F, int)
        L = {k: np.asarray(v, int) for k, v in labels.items()}
        arms = np.concatenate([L["left_arm"], L["right_arm"]])
        keep = np.ones(len(self.V), bool)
        keep[arms] = False
        self.trunk = np.flatnonzero(keep)               # body + legs (+ head), no arms
        self.trunk_tris = tris_of(self.F, self.trunk)
        self.L = L

    @staticmethod
    def _extreme_level(tr, lo, hi, front):
        """Height in [lo, hi] where the trunk reaches furthest forward (front) / backward, |x| in 3..15 cm."""
        p = tr[(tr[:, 1] > lo) & (tr[:, 1] < hi) & (np.abs(tr[:, 0]) > 3) & (np.abs(tr[:, 0]) < 15)]
        z = p[:, 2] if front else -p[:, 2]
        top = np.argsort(z)[-6:]
        return float(p[top, 1].mean())

    # ── sections ──
    def girth(self, y, tris=None):
        band = Band(self.V, self.trunk_tris if tris is None else tris, y - 0.5, y + 0.5)
        return band.girth(y)

    def measure(self):
        import trimesh
        V, L = self.V, self.L
        r = {}
        ymin, ymax = V[:, 1].min(), V[:, 1].max()
        r["height"] = ymax - ymin
        tr = V[self.trunk]

        # underarm: lowest point of each arm's border with the trunk (near the torso)
        def border(arm):
            a = np.zeros(len(V), bool)
            a[L[arm]] = True
            t = self.F[a[self.F].any(1) & ~a[self.F].all(1)]
            b = np.unique(t[a[t]])
            return b[np.abs(V[b, 0]) < 30]
        armpit_y = float(np.mean([V[border(f"{s}_arm"), 1].min() for s in ("left", "right")]))

        # midsagittal cut of the trunk: crotch, back and front centre profiles
        tm = trimesh.Trimesh(V, self.trunk_tris, process=False)
        tm.merge_vertices()                               # glTF meshes are split at UV seams
        cut = tm.section(plane_origin=[0, 0, 0], plane_normal=[1, 0, 0])
        loop = max(cut.discrete, key=len)
        crotch_y = float(loop[:, 1].min())

        def side_peak(lo, hi, sign, z_sign):
            p = tr[(tr[:, 1] > lo) & (tr[:, 1] < hi) & (tr[:, 0] * sign > 3)]
            return p[np.argmax(p[:, 2] * z_sign)]

        # bust level: where the breasts reach furthest forward, within 10 cm under the underarm;
        # bust points: ends of the tape's straight span across the front (longest front hull edge)
        bust_y = self._extreme_level(tr, armpit_y - 10, armpit_y - 1, front=True)
        r["bust"], bust_h = self.girth(bust_y)
        bl, br = _span_points(bust_h, front=True)
        r["bust_points"] = abs(bl[0] - br[0])
        bx = 0.5 * (abs(bl[0]) + abs(br[0]))
        bl = np.array([bl[0], bust_y, bl[1]])

        # underbust: the breast fold — the first local minimum of the breast's front profile below the bust
        ys = np.arange(bust_y, bust_y - 15, -0.25)
        zf = []
        for y in ys:
            p = tr[(np.abs(tr[:, 1] - y) < 0.4) & (np.abs(np.abs(tr[:, 0]) - bx) < 2.0)]
            zf.append(p[:, 2].max() if len(p) else np.nan)
        zf = np.array(zf)
        i = 1
        while i < len(zf) - 1 and not (zf[i] <= zf[i - 1] and zf[i] <= zf[i + 1] and zf[i] < zf[0] - 2):
            i += 1
        underbust_y = ys[i]
        r["underbust"] = self.girth(underbust_y)[0]

        # waist: narrowest trunk girth between 40% and 85% of crotch -> bust
        span = bust_y - crotch_y
        best = None
        for y in np.arange(crotch_y + 0.40 * span, crotch_y + 0.85 * span, 0.25):
            g, h = self.girth(y)
            if best is None or g < best[0]:
                best = (g, y, h)
        r["waist"], waist_y, waist_h = best

        # hips: where the buttocks protrude furthest back; bum points = ends of the tape's span across the back
        hip_y = self._extreme_level(tr, crotch_y, waist_y, front=False)
        r["hips"], hip_h = self.girth(hip_y)
        gl, gr = _span_points(hip_h, front=False)
        r["bum_points"] = abs(gl[0] - gr[0])
        r["hips_line"] = waist_y - hip_y
        r["crotch_hip_diff"] = hip_y - crotch_y
        hw = lambda h: 0.5 * (h[:, 0].max() - h[:, 0].min())
        r["hip_inclination"] = np.degrees(np.arctan2(hw(hip_h) - hw(waist_h), waist_y - hip_y))

        # thigh: thickest section of the left leg below the crotch
        leg_tris = tris_of(self.F, L["left_leg"])
        r["leg_circ"] = max(Band(V, leg_tris, y - 0.5, y + 0.5).girth(y)[0]
                            for y in np.arange(crotch_y - 25, crotch_y - 0.5, 0.5))

        # back parts of the girths, split by the balance line: one coronal plane for the whole body,
        # z = mean of the bust / waist / hip sections' z-centres (on the GarmentCode bodies within 1 cm of
        # the plane that reproduces their numbers)
        zc = lambda h: 0.5 * (h[:, 1].max() + h[:, 1].min())
        z_bal = float(np.mean([zc(bust_h), zc(waist_h), zc(hip_h)]))
        r["back_width"] = back_part(bust_h, z_bal)
        r["waist_back_width"] = back_part(waist_h, z_bal)
        r["hip_back_width"] = back_part(hip_h, z_bal)

        # neck: narrowest trunk section between the underarm + 10 cm and the head
        ys = np.arange(armpit_y + 10, ymax - 12, 0.25)
        half = np.array([np.abs(Band(V, self.trunk_tris, y - 0.3, y + 0.3).section(y)[:, 0]).max() for y in ys])
        neck_y, wn = ys[np.argmin(half)], half.min()

        # front silhouette top contour (all vertices) from the neck outward: neck base point (HPS),
        # shoulder line, shoulder point = corner where the shoulder line turns into the arm
        def contour(sign):
            xs = np.arange(wn, wn + 30, 0.5)
            top = []
            for x in xs:
                p = _cut(V, self.F, 0, sign * x + 0.003)
                top.append(p[p[:, 1] < neck_y, 1].max())
            top = np.array(top)
            k = int(np.argmax(top < neck_y - 1.5))
            xs, top = xs[k:], top[k:]
            # shoulder point: where the contour steepens to 0.6 (31 deg; the shoulder line is ~0.4, the arm ~1)
            # over 2 cm; shoulder slope: line from 1.5 cm outside the neck base to the shoulder point
            loc = np.array([-np.polyfit(xs[max(i - 4, 0):i + 5], top[max(i - 4, 0):i + 5], 1)[0]
                            for i in range(len(xs))])
            c = int(np.argmax((xs > xs[0] + 6) & (np.arange(len(xs)) < len(xs) - 4) & (loc >= 0.6)))
            k = int(np.argmin(np.abs(xs - xs[0] - 1.5)))
            slope = (top[c] - top[k]) / (xs[c] - xs[k])
            return np.array([xs[0], top[0]]), np.array([xs[c], top[c]]), slope
        hL, sL, kL = contour(1)
        hR, sR, kR = contour(-1)
        r["shoulder_w"] = sL[0] + sR[0]
        r["shoulder_incl"] = np.degrees(np.arctan(-0.5 * (kL + kR)))
        sh_y = 0.5 * (sL[1] + sR[1])

        # nape: back centre at the neck base level; head_l: nape to the top of the head
        nape_y = 0.5 * (hL[1] + hR[1])
        mid = _cut(V, self.trunk_tris, 0, 0.01)        # off 0: symmetric meshes have vertices on x = 0
        cy = np.arange(crotch_y, ymax, 1.0)
        cz = []
        for y in cy:
            s = Band(V, self.trunk_tris, y - 0.5, y + 0.5).section(y)
            s = s[np.abs(s[:, 0]) < 3]
            cz.append(0.5 * (s[:, 1].max() + s[:, 1].min()) if len(s) else np.nan)
        cz = np.array(cz)
        ok_ = np.isfinite(cz)
        centre = lambda y: np.interp(y, cy[ok_], cz[ok_])
        bp = _profile(mid, np.arange(waist_y, nape_y + 0.01, 0.5), -1, centre)
        nape = np.array([0.0, nape_y, bp[-1, 0]])
        top_pt = V[np.argmax(V[:, 1])]
        r["head_l"] = float(np.linalg.norm(top_pt - nape))
        r["vert_bust_line"] = nape_y - bust_y

        # neck_w: back part of the neck girth just above the neck base
        _, nh = self.girth(nape_y + 1.0)
        r["neck_w"] = back_part(nh, 0.5 * (nh[np.argmax(nh[:, 0]), 1] + nh[np.argmin(nh[:, 0]), 1]))

        # waist_line: back centre profile (tape over hollows) from the nape down to the waist level
        r["waist_line"] = _open_hull_length(bp, side=-1)

        # front line through the bust point: from the neck base point to the waist, over the bust
        fr = _profile(_cut(V, self.trunk_tris, 0, bl[0]), np.arange(waist_y, hL[1] + 0.01, 0.5), 1, centre)
        dx = abs(bl[0]) - hL[0]
        r["waist_over_bust_line"] = float(np.hypot(_open_hull_length(fr, side=1), dx))
        r["bust_line"] = float(np.hypot(_open_hull_length(fr[fr[:, 1] >= bust_y], side=1), dx))

        r["armscye_depth"] = sh_y - armpit_y

        # arms: centre line from section centroids by distance from the shoulder point; pose angle = upper arm
        # (8-22 cm) below horizontal; wrist = narrowest section perpendicular to the centre line before the
        # hand widens; arm length = shoulder point -> wrist centre
        lens, angles, wrists = [], [], []
        for s, sign, sp in (("left", 1, sL), ("right", -1, sR)):
            A = V[L[f"{s}_arm"]]
            spp = np.array([sign * sp[0], sp[1]])
            sp3 = A[np.argmin(np.linalg.norm(A[:, :2] - spp, axis=1))].copy()
            sp3[:2] = spp
            d = np.linalg.norm(A - sp3, axis=1)            # 3D: elbows may be bent forward
            ds = np.arange(4, d.max() - 1, 1.0)
            has = np.array([((d >= a - 1) & (d < a + 1)).sum() >= 3 for a in ds])
            ds = ds[has]                                    # coarse meshes: 2 cm shells, skip empty ones
            cen = np.array([A[(d >= a - 1) & (d < a + 1)].mean(0) for a in ds])
            up = (ds >= ARM_D[0]) & (ds <= ARM_D[1])
            a3 = np.linalg.svd(cen[up] - cen[up].mean(0))[2][0]
            angles.append(np.degrees(np.arctan2(abs(a3[1]), abs(a3[0]))))
            arm_tris = tris_of(self.F, L[f"{s}_arm"])
            g = np.zeros(len(ds))
            for i in range(2, len(ds) - 2):
                g[i] = _plane_girth(V, arm_tris, cen[i], _unit(cen[i + 2] - cen[i - 2]))
            j = _wrist_index(g, start=int(0.5 * len(ds)))
            wrists.append(g[j])
            lens.append(float(np.linalg.norm(cen[j] - sp3)))
        r["arm_pose_angle"] = float(np.mean(angles))
        r["arm_length"] = float(np.mean(lens))
        r["wrist"] = float(np.mean(wrists))
        aux = dict(z_bal=z_bal, crotch_y=crotch_y, bust_y=bust_y, underbust_y=underbust_y, waist_y=waist_y, hip_y=hip_y,
                   armpit_y=armpit_y, neck_y=neck_y, nape_y=nape_y, shoulder_l=sL.tolist(), hps_l=hL.tolist())
        raw = {k: float(r[k]) for k in KEYS}
        cal = {k: raw[k] * CAL_MUL.get(k, 1.0) + CAL_ADD.get(k, 0.0) for k in KEYS}
        aux["raw"] = raw
        return {k: round(v, 4) for k, v in cal.items()}, aux


def _cut(V, tris, axis, value):
    """Points where the surface crosses the plane coordinate[axis] = value (exact, edge interpolation)."""
    d = V[:, axis] - value
    T = tris[(d[tris].min(1) < 0) & (d[tris].max(1) > 0)]
    out = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        a, b = T[:, i], T[:, j]
        s = d[a] * d[b] < 0
        t = d[a[s]] / (d[a[s]] - d[b[s]])
        out.append(V[a[s]] + (V[b[s]] - V[a[s]]) * t[:, None])
    return np.concatenate(out) if out else np.empty((0, 3))


def _profile(P, ys, side, centre=None):
    """For each height in ys: the extreme z (side=+1 front max, -1 back min) of cut points P near it.
    centre(y): z of the body's middle — only points on the requested side of it count (coarse meshes)."""
    if centre is not None:
        P = P[(P[:, 2] - centre(P[:, 1])) * side > 0]
    out = []
    for y in ys:
        p = P[np.abs(P[:, 1] - y) < 0.6]
        if len(p):
            out.append([(p[:, 2] * side).max() * side, y])
    return np.array(out)


def _span_points(h, front):
    """Ends of the longest hull edge on the front (or back) side: where the tape leaves the body to bridge
    between the breasts (or the buttocks). Returns two (x, z) points."""
    n, best = len(h), None
    zc = 0.5 * (h[:, 1].max() + h[:, 1].min())
    for i in range(n):
        a, b = h[i], h[(i + 1) % n]
        if (0.5 * (a[1] + b[1]) - zc) * (1 if front else -1) <= 0 or a[0] * b[0] >= 0:
            continue
        L_ = np.linalg.norm(b - a)
        if best is None or L_ > best[0]:
            best = (L_, a, b)
    a, b = best[1], best[2]
    return (a, b) if a[0] > b[0] else (b, a)


def _wrist_index(g, start=1):
    """The narrowest of the narrowings followed by a widening: on a full arm (zara XXL, plus) the elbow is a
    narrowing too, and taking the first one measured the arm to the elbow (35.5 cm, "wrist" 23.6)."""
    found = [j for j in range(max(start, 1), len(g) - 1)
             if g[j] > 5 and g[j] <= g[j - 1] and g[j] <= g[j + 1] and g[j + 1:j + 20].max() > g[j] + 2]
    if found:
        return min(found, key=lambda j: g[j])
    return int(np.argmin(np.where(g > 5, g, np.inf)))


def _unit(v):
    return v / np.linalg.norm(v)


def _open_hull_length(pts, side):
    """Length of the outer (convex) side of a profile: side=+1 front (max z), -1 back (min z). pts: (z, y)."""
    h = hull(pts)
    ytop, ybot = pts[:, 1].max(), pts[:, 1].min()
    # walk the hull and keep the chain on the requested side between the top and bottom points
    n = len(h)
    it, ib = int(np.argmax(h[:, 1])), int(np.argmin(h[:, 1]))
    def chain(a, b):
        out, i = [h[a]], a
        while i != b:
            i = (i + 1) % n
            out.append(h[i])
        return np.array(out)
    c1, c2 = chain(it, ib), chain(ib, it)
    pick = c1 if (c1[:, 0].mean() - c2[:, 0].mean()) * side > 0 else c2
    return profile_length(pick)


def _plane_girth(V, tris, o, n):
    d = (V - o) @ n
    T = tris[(np.abs(d[tris]).min(1) < 2.0)]
    pts = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        a, b = T[:, i], T[:, j]
        s = d[a] * d[b] < 0
        t = d[a[s]] / (d[a[s]] - d[b[s]])
        pts.append(V[a[s]] + (V[b[s]] - V[a[s]]) * t[:, None])
    p = np.concatenate(pts)
    if len(p) < 3:
        return 0.0
    e1 = _unit(np.cross(n, [0, 0, 1.0]) if abs(n[2]) < 0.9 else np.cross(n, [1.0, 0, 0]))
    e2 = np.cross(n, e1)
    q = np.column_stack([(p - o) @ e1, (p - o) @ e2])
    q = q[np.linalg.norm(q, axis=1) < 8]                # this arm only, around the axis
    return perimeter(hull(q)) if len(q) >= 3 else 0.0


def load_gc_body(name):
    import trimesh
    m = trimesh.load(GC_BODIES / f"{name}.obj", process=False)
    seg = json.load(open(GC_BODIES / "ggg_body_segmentation.json"))
    return np.asarray(m.vertices) * 100, np.asarray(m.faces), seg


def check():
    import yaml
    rows = []
    for name in ("mean_all", "mean_female", "mean_male"):
        V, F, seg = load_gc_body(name)
        got, aux = Measurer(V, F, seg).measure()
        ref = yaml.safe_load(open(GC_BODIES / f"{name}.yaml"))["body"]
        rows.append((name, got, ref, aux))
    print(f"{'measure':24s}" + "".join(f"{n:>22s}" for n, *_ in rows))
    for k in KEYS:
        print(f"{k:24s}" + "".join(f"{g[k]:9.2f} /{ref[k]:7.2f}{g[k]-ref[k]:+6.1f}" for _, g, ref, _ in rows))
    print("raw/ref ratio and raw-ref difference, mean over the female-like bodies (mean_all, mean_female):")
    for k in KEYS:
        rr = [(a["raw"][k], ref[k]) for _, _, ref, a in rows[:2]]
        print(f"  {k:24s} x{np.mean([a / b for a, b in rr]):.3f}  {np.mean([a - b for a, b in rr]):+.2f}")
    for n, _, _, aux in rows:
        print(n, {k: (round(v, 1) if isinstance(v, float) else v) for k, v in aux.items()})
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        check()
