"""NOT WORKING (17.10.2026): kept as is, see README "Неделя 2, дни 8–9". Garments explode or slide off.

Pre-sewing: wrap the flat panels around the body, weld the seams, relax to the pattern's edge lengths.

Pure numpy (runs inside Blender and in plain Python). The same idea as GarmentCode's simulator: the
initial mesh is already sewn (stitched boundary points are one vertex) and the rest lengths come from
the flat pattern. Blender cloth has no per-edge rest lengths — it takes the starting shape as rest — so
we first relax the welded mesh until its edges have their flat lengths (body pushes the cloth out), and
Blender starts from that shape: sewn, unstrained, outside the body.

  verts, faces: flat-placed panels (GarmentCode cm, Y up), panel id per vertex, stitch pairs (va, vb)
  body: vertices (cm) + labels {body, left_arm, right_arm, left_leg, right_leg}

wrap()   — torso/skirt panels onto an ellipse around the body section at each height (front/back
           by the panel's side, angle from the flat x / the panel width at that height; above the
           armhole the width is frozen, so shoulder seams land on the upper chest / back and close over
           the shoulder); sleeves onto a circle around the upper-arm axis.
weld()   — union of stitched vertices -> new indices, faces, unique edges with flat rest lengths.
relax()  — Jacobi edge-length projection + push-out from the body (callback), a few hundred iterations.
"""
import numpy as np


def weld(n, faces, pairs):
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    root = np.array([find(i) for i in range(n)])
    uniq, new = np.unique(root, return_inverse=True)
    return new, len(uniq)


def edges_with_rest(flat, faces, new):
    """Unique edges of the welded mesh; rest length = flat length (mean over the panels sharing it)."""
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    L = np.linalg.norm(flat[e[:, 0]] - flat[e[:, 1]], axis=1)
    w = np.sort(new[e], axis=1)
    keep = w[:, 0] != w[:, 1]
    w, L = w[keep], L[keep]
    key = w[:, 0].astype(np.int64) * (w.max() + 1) + w[:, 1]
    uk, inv = np.unique(key, return_inverse=True)
    Ls = np.bincount(inv, L) / np.bincount(inv)
    first = np.zeros(len(uk), int)
    first[inv[::-1]] = np.arange(len(inv))[::-1]
    return w[first], Ls


def _ellipse_point(theta, a, b, cx, cz, side):
    return np.stack([cx + a * np.sin(theta), side * b * np.cos(theta) + cz], -1)


def wrap(P, panel_of, panels, body_V, body_L, pairs=(), clearance=1.5):
    """P: (N,3) flat-placed vertices. panels: {id: {"name", "front": bool}}. Returns (N,3) wrapped."""
    X = P.copy()
    arms = np.concatenate([body_L["left_arm"], body_L["right_arm"]])
    keep = np.ones(len(body_V), bool)
    keep[arms] = False
    T = body_V[keep]
    sleeve = np.array([("sleeve" in panels[p]["name"]) for p in panel_of])
    front = np.array([panels[p]["front"] for p in panel_of])

    # body section per height: half-width, half-depth, centre
    ys = np.arange(np.floor(P[:, 1].min()) - 2, np.ceil(P[:, 1].max()) + 3, 1.0)
    sec = []
    for y in ys:
        s = T[np.abs(T[:, 1] - y) < 0.75]
        if len(s) < 5:
            sec.append((np.nan,) * 4)
            continue
        sec.append((np.ptp(s[:, 0]) / 2, np.ptp(s[:, 2]) / 2, s[:, 0].mean() * 0 + 0.5 * (s[:, 0].max() + s[:, 0].min()),
                    0.5 * (s[:, 2].max() + s[:, 2].min())))
    sec = np.array(sec)
    ok = np.isfinite(sec[:, 0])
    sec = np.column_stack([_smooth(np.interp(ys, ys[ok], sec[ok, i]), 4) for i in range(4)])

    # rings: front and back panels stitched to each other (bodice, each skirt tier, waistband, collar);
    # every ring gets its own ellipse per height, with half-perimeter = front + back half-widths there
    tor = ~sleeve
    ring = _rings(panel_of, panels, pairs, tor)
    for rid in np.unique(ring[tor]):
        m = tor & (ring == rid)
        Q = P[m]
        rys = np.arange(np.floor(Q[:, 1].min()), np.ceil(Q[:, 1].max()) + 1, 1.0)
        wf, wb = [], []
        for y in rys:
            band = np.abs(Q[:, 1] - y) < 0.75
            f_, b_ = band & front[m], band & ~front[m]
            wf.append(np.abs(Q[f_, 0]).max() if f_.any() else np.nan)
            wb.append(np.abs(Q[b_, 0]).max() if b_.any() else np.nan)
        wf, wb = _smooth(_fill(rys, np.array(wf)), 2), _smooth(_fill(rys, np.array(wb)), 2)
        out = np.empty_like(Q)
        for j, p in enumerate(Q):
            y = p[1]
            hx, hz, cx, cz = (np.interp(y, ys, sec[:, k]) for k in range(4))
            a, b = hx + clearance, hz + clearance
            g = np.interp(y, rys, wf) + np.interp(y, rys, wb)
            phi, s = _ellipse_arc(a, b)
            a2, b2 = a * g / s[-1], b * g / s[-1]                # half-perimeter -> g (may go inside: push-out)
            arc = abs(p[0]) * s[-1] / g                          # arc from the centre line on the unscaled ellipse
            if not front[m][j]:
                arc = s[-1] - arc                                # back panels: from the centre back
            f = np.interp(arc, s, phi)
            out[j] = [cx + np.sign(p[0]) * a2 * np.sin(f), y, cz + b2 * np.cos(f)]
        X[np.flatnonzero(m)] = out

    # sleeves: around the upper-arm axis of each side
    for sgn, arm in ((1, "left_arm"), (-1, "right_arm")):
        m = sleeve & (np.sign(P[:, 0]) == sgn)
        if not m.any():
            continue
        A = body_V[body_L[arm]]
        sh = np.abs(A[:, 0]).min()
        up = A[(np.abs(A[:, 0]) > sh + 3) & (np.abs(A[:, 0]) < sh + 20)]
        c0 = up.mean(0)
        d = np.linalg.svd(up - c0)[2][0]
        d = d * np.sign(d[0] * sgn)
        n = np.cross(d, [0, 0, 1.0])
        n = n * np.sign(n[1]) / np.linalg.norm(n)            # up-outwards, perpendicular to the arm
        zf = np.cross(n, d)
        zf = zf * np.sign(zf[2])                               # towards the front
        arm_r = np.median(np.linalg.norm(np.cross(up - c0, d), axis=1))
        Q = P[m]
        u = (Q - c0) @ d
        v = (Q - c0) @ n
        us = np.arange(np.floor(u.min()) - 1, np.ceil(u.max()) + 2, 1.0)
        fr = front[m]
        top, bot = {}, {}
        for side in (True, False):
            t_, b_ = [], []
            for uu in us:
                k = (fr == side) & (np.abs(u - uu) < 1.0)
                t_.append(v[k].max() if k.any() else np.nan)
                b_.append(v[k].min() if k.any() else np.nan)
            t_, b_ = np.array(t_), np.array(b_)
            g = np.isfinite(t_)
            top[side] = np.interp(us, us[g], t_[g])
            bot[side] = np.interp(us, us[g], b_[g])
        out = np.empty_like(Q)
        for j in range(len(Q)):
            side = fr[j]
            vt, vb = np.interp(u[j], us, top[side]), np.interp(u[j], us, bot[side])
            width = (vt - vb) + (np.interp(u[j], us, top[not side]) - np.interp(u[j], us, bot[not side]))
            r = max(width / (2 * np.pi), arm_r + clearance)
            phi = (vt - v[j]) / max(vt - vb, 1e-6) * np.pi    # 0 at the top seam, pi at the underarm seam
            out[j] = c0 + u[j] * d + r * (np.cos(phi) * n + np.sin(phi) * (zf if side else -zf))
        X[m] = out
    return X


def close_flat(P, panel_of, panels, body_V, body_L, clearance=2.0):
    """Rigid move of every panel along z (no bending, no strain) to `clearance` cm in front of (behind) the
    body over the panel's own x/y extent — instead of GarmentCode's 15-30 cm placement gaps. Sleeve panels
    go next to the arm of their side."""
    X = P.copy()
    arms = np.concatenate([body_L["left_arm"], body_L["right_arm"]])
    is_arm = np.zeros(len(body_V), bool)
    is_arm[arms] = True
    for pid in np.unique(panel_of):
        if panels[pid].get("nz", 1.0) < 0.9:              # side-facing panels (hoods) stay where they are
            continue
        m = panel_of == pid
        Q = P[m]
        sleeve = "sleeve" in panels[pid]["name"]
        B = body_V[is_arm & (np.sign(body_V[:, 0]) == np.sign(Q[:, 0].mean()))] if sleeve else body_V  # arms too: no start inside them
        lo, hi = Q.min(0), Q.max(0)
        box = B[(B[:, 0] > lo[0] - 1) & (B[:, 0] < hi[0] + 1) & (B[:, 1] > lo[1] - 1) & (B[:, 1] < hi[1] + 1)]
        if len(box) == 0:
            continue
        z = Q[:, 2].mean()
        target = box[:, 2].max() + clearance if panels[pid]["front"] else box[:, 2].min() - clearance
        if (panels[pid]["front"] and target < z) or (not panels[pid]["front"] and target > z):
            X[m, 2] += target - z
    return X


def anchors(P, panel_of, panels, pairs, body_V, body_L):
    """Vertices to pin while the seams close (no gravity): a band of the bodice 4-8 cm under the armhole
    on the front and back, or — without a bodice — the top 2 cm of the topmost ring (waistband / skirt)."""
    sleeve = np.array([("sleeve" in panels[p]["name"]) for p in panel_of])
    names = [panels[p]["name"] for p in panel_of]
    torso = np.array(["torso" in n for n in names])
    if torso.any():
        arm_y = _armhole_height(body_V, body_L)
        return np.flatnonzero(torso & (P[:, 1] > arm_y - 8) & (P[:, 1] < arm_y - 4))
    tor = ~sleeve
    ring = _rings(panel_of, panels, pairs, tor)
    top_ring = ring[tor][np.argmax(P[tor, 1])]
    m = tor & (ring == top_ring)
    return np.flatnonzero(m & (P[:, 1] > P[m, 1].max() - 2.0))


def _ellipse_arc(a, b, n=400):
    """Half ellipse from the front centre (phi=0, point (0, b)) to the back centre (phi=pi): phi, arc length."""
    phi = np.linspace(0, np.pi, n)
    pts = np.stack([a * np.sin(phi), b * np.cos(phi)], 1)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    return phi, s


def _smooth(y, k):
    """Moving average over 2k+1 samples (edges padded)."""
    if len(y) < 3:
        return y
    yp = np.concatenate([np.full(k, y[0]), y, np.full(k, y[-1])])
    return np.convolve(yp, np.ones(2 * k + 1) / (2 * k + 1), mode="valid")


def _fill(x, y):
    g = np.isfinite(y)
    return np.interp(x, x[g], y[g]) if g.any() else np.full(len(x), 1.0)


def _rings(panel_of, panels, pairs, tor):
    """Connected components of front<->back stitches among non-sleeve panels (per vertex)."""
    ids = sorted(panels)
    parent = {i: i for i in ids}

    def find(i):
        while parent[i] != i:
            i = parent[i]
        return i
    for va, vb in pairs:
        pa, pb = panel_of[va], panel_of[vb]
        if tor[va] and tor[vb] and panels[pa]["front"] != panels[pb]["front"]:
            parent[find(pa)] = find(pb)
    return np.array([find(p) for p in panel_of])


def _armhole_height(V, L):
    a = np.zeros(len(V), bool)
    a[L["left_arm"]] = True
    return float(V[a][np.abs(V[a, 0]) < np.abs(V[a, 0]).min() + 4, 1].min())


def relax(X, E, L, iters=400, push=None, push_every=5, omega=0.9, pins=None):
    """Jacobi projection of edge lengths to L; push(X) moves points out of the body. pins: (idx, targets)."""
    X = X.copy()
    n = len(X)
    cnt = np.bincount(E.ravel(), minlength=n).astype(float)
    for it in range(iters):
        d = X[E[:, 1]] - X[E[:, 0]]
        ln = np.linalg.norm(d, axis=1)
        c = ((ln - L) / np.maximum(ln, 1e-9) * 0.5)[:, None] * d
        acc = np.stack([np.bincount(E[:, 0], c[:, k], n) - np.bincount(E[:, 1], c[:, k], n) for k in range(3)], 1)
        X += omega * acc / np.maximum(cnt, 1)[:, None]
        if pins is not None:
            X[pins[0]] = pins[1]
        if push is not None and (it % push_every == 0 or it == iters - 1):
            X = push(X)
    return X


def strain(X, E, L):
    ln = np.linalg.norm(X[E[:, 1]] - X[E[:, 0]], axis=1)
    s = ln / L - 1
    return {"mean_abs_pct": float(np.abs(s).mean() * 100), "p95_abs_pct": float(np.percentile(np.abs(s), 95) * 100),
            "max_stretch_pct": float(s.max() * 100)}
