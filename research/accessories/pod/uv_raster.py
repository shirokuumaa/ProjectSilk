"""Drop-in for the two nvdiffrast calls in TRELLIS.2 texture baking (o_voxel/postprocess.py, to_glb), without nvdiffrast.

nvdiffrast is under the NVIDIA Source Code License — "research or evaluation purposes only". In to_glb it only
rasterises the UV layout (which triangle covers each texel, and where inside it) and interpolates 3D positions
at the texels. Both are a few lines of our own code (MIT, like TRELLIS.2):

  - rasterize_uv_np(uv, faces, size) → (size, size, 4): barycentrics b0, b1, 0, triangle id + 1 (0 — empty texel),
    the layout of nvdiffrast's rast output: point = b0·v0 + b1·v1 + (1 − b0 − b1)·v2, row 0 at v = 0;
  - interpolate_np(attr, rast, faces) → (size, size, C).

The torch shim at the bottom has nvdiffrast's names (RasterizeCudaContext, rasterize, interpolate) and the
arguments to_glb passes, so baking needs one import changed:
    import nvdiffrast.torch as dr   →   import uv_raster as dr
It goes through numpy on the CPU: baking runs once per item, a 2048 px texture of ~1 M texels in seconds.
"""
import numpy as np


def rasterize_uv_np(uv, faces, size, eps=1e-9):
    """UV layout → face id and barycentrics per texel (texel centres; later triangles win, as in to_glb's chunks)."""
    uv = np.asarray(uv, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)
    out = np.zeros((size, size, 4), dtype=np.float32)
    p = uv[faces] * size - 0.5                           # вершины в координатах центров текселей
    lo = np.clip(np.floor(p.min(1)), 0, size - 1).astype(np.int64)
    hi = np.clip(np.ceil(p.max(1)), 0, size - 1).astype(np.int64)
    for f in range(len(faces)):
        (x0, y0), (x1, y1), (x2, y2) = p[f]
        det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(det) < eps:
            continue                                     # вырожденный треугольник развёртки
        xs = np.arange(lo[f, 0], hi[f, 0] + 1)
        ys = np.arange(lo[f, 1], hi[f, 1] + 1)
        gx, gy = np.meshgrid(xs, ys)
        b0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / det
        b1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / det
        b2 = 1 - b0 - b1
        inside = (b0 >= -1e-7) & (b1 >= -1e-7) & (b2 >= -1e-7)
        if not inside.any():
            continue
        yy, xx = gy[inside], gx[inside]
        out[yy, xx, 0] = b0[inside]
        out[yy, xx, 1] = b1[inside]
        out[yy, xx, 2] = 0
        out[yy, xx, 3] = f + 1
    return out


def interpolate_np(attr, rast, faces):
    """Attribute per texel from the triangle and barycentrics of rast; empty texels get 0."""
    attr = np.asarray(attr, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)
    fid = rast[..., 3].astype(np.int64) - 1
    out = np.zeros(rast.shape[:2] + attr.shape[1:], dtype=np.float32)
    m = fid >= 0
    tri = attr[faces[fid[m]]]                            # (N, 3, C)
    b0, b1 = rast[..., 0][m, None], rast[..., 1][m, None]
    out[m] = b0 * tri[:, 0] + b1 * tri[:, 1] + (1 - b0 - b1) * tri[:, 2]
    return out


# ── то же под именами nvdiffrast.torch (как их вызывает o_voxel.postprocess.to_glb) ──

class RasterizeCudaContext:                              # контекст nvdiffrast не нужен
    def __init__(self, *args, **kwargs):
        pass


def rasterize(ctx, pos, tri, resolution, **kwargs):
    """pos: (1, V, 4) клип-координаты развёртки (uv·2 − 1, 0, 1), tri: (F, 3). → (rast (1, H, W, 4), None)."""
    import torch
    uv = (pos[0, :, :2].detach().cpu().numpy() + 1) / 2
    rast = rasterize_uv_np(uv, tri.detach().cpu().numpy(), resolution[0])
    return torch.from_numpy(rast).to(pos.device).unsqueeze(0), None


def interpolate(attr, rast, tri, **kwargs):
    """attr: (1, V, C), rast: (1, H, W, 4) → ((1, H, W, C), None) — как dr.interpolate."""
    import torch
    out = interpolate_np(attr[0].detach().cpu().numpy(), rast[0].detach().cpu().numpy(), tri.detach().cpu().numpy())
    return torch.from_numpy(out).to(attr.device).unsqueeze(0), None

