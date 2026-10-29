"""Drape one garment with Newton (Apache-2.0, on open warp-lang) — the same input and output as GarmentCode's
simulator test (pod/gc_sim_case.py), so simtest_report.py compares the two directly.

Input: GarmentCode's box mesh of the garment (pygarment BoxMesh, made by their test run: <case>_boxmesh.obj,
_sim_segmentation.txt, _orig_lens.pickle, _vertex_labels.yaml) and the body (<body>.obj in metres + <body>.yaml).
Our own implementation of the same ideas on Newton's public API (nothing taken from the non-commercial fork):
  * the box mesh is already sewn: stitched points are one vertex, the seam triangles bridge the panels;
  * rest shape per triangle from edge lengths — triangles inside a panel keep the box mesh lengths (panels are
    placed rigidly), triangles touching a seam vertex take the flat pattern lengths from _orig_lens.pickle;
    given to Newton as per-triangle 2D "panel" coordinates (Style3D cloth: panel space = rest space);
  * attachments as soft plane springs for the first 400 frames (an external force): the garment's lower
    interface (waistband / bodice hem) to the waist height, the collar sides to x = +-(neck_w - 2)/2,
    a strapless top to the underarm height — the same planes GarmentCode uses;
  * gravity off for the first 10 frames; stop when 98.5% of the vertices move < 0.3 mm per frame
    (after the attachments are released), else at --max-frames.
Solver: SolverStyle3D (cloth for garments: anisotropic stretch/bending from panel space, self-collision,
body contacts from Newton's collision pipeline), parameters of Newton's garment-on-avatar example.

Usage: python newton_case.py --box-dir <dir> --case <case> --body-obj <obj> --body-yaml <yaml> --out <dir>
           [--max-frames 2400] [--device cpu|cuda:0] [--attach-ke 0.5] [--settle-frames 5] [--max-speed 1.0]
           [--snapshots N]  (every N frames <case>_f<frame>.obj, to see when cloth goes wrong)
  --attach-ke: 0.5 N/m per vertex held a skirt's waist only with the hips' help — it slid 3.5-6.7 cm while still
  attached (a spring alone would sag 12-25 cm under the skirt's or trousers' weight); 20 N/m sags <= 0.6 cm.
  --settle-frames: frames after the attachments are released before the stop-when-static check may end the run.
Writes <out>/<case>/{<case>_sim.obj (cm, box mesh faces), <case>_boxmesh.obj, case_result.json}.
"""
import argparse
import json
import pickle
import shutil
import time
from pathlib import Path

import numpy as np
import warp as wp
import yaml

FPS, SUBSTEPS, ITERATIONS = 60, 10, 4
ZERO_GRAVITY_FRAMES, ATTACH_FRAMES = 10, 400
STATIC_MOVE_M, STATIC_SHARE = 0.0003, 0.985
ATTACH_KE, ATTACH_KD = 0.5, 0.005           # N/m and N*s/m per attached vertex
# Newton finds cloth-body contacts only near the body surface (not inside it), once per frame: the cloth must not
# cross more than the detection gap in a frame. The seams pull the box walls in fast, so — like GarmentCode's
# global max velocity and damping — speeds are clamped and the gap is larger than the per-frame travel.
MAX_SPEED, CONTACT_GAP = 1.0, 0.03          # m/s (1.7 cm per frame at 60 fps), m


def read_obj(path):
    V, F = [], []
    for line in open(path):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            F += [[idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1)]
    return np.array(V, float), np.array(F, int)


def rest_panel_coords(V, F, stitch, orig_lens):
    """Per-triangle 2D rest triangles (3 corners each) from rest edge lengths."""
    def length(i, j):
        if stitch[i] or stitch[j]:
            k = (min(i, j), max(i, j))
            if k in orig_lens:
                return orig_lens[k]
        return float(np.linalg.norm(V[i] - V[j]))
    P = np.zeros((len(F), 3, 2))
    n_seam = 0
    for t, (a, b, c) in enumerate(F):
        if stitch[a] or stitch[b] or stitch[c]:
            n_seam += 1
            lab, lbc, lca = length(a, b), length(b, c), length(c, a)
        else:
            lab, lbc, lca = (float(np.linalg.norm(V[x] - V[y])) for x, y in ((a, b), (b, c), (c, a)))
        x = (lab ** 2 + lca ** 2 - lbc ** 2) / (2 * lab)
        y = np.sqrt(max(lca ** 2 - x ** 2, 1e-12))
        P[t] = [[0.0, 0.0], [lab, 0.0], [x, y]]
    return P.reshape(-1, 2), n_seam


@wp.kernel
def clamp_speed(qd: wp.array(dtype=wp.vec3), vmax: float):
    i = wp.tid()
    s = wp.length(qd[i])
    if s > vmax:
        qd[i] = qd[i] * (vmax / s)


@wp.kernel
def plane_springs(q: wp.array(dtype=wp.vec3), qd: wp.array(dtype=wp.vec3), idx: wp.array(dtype=wp.int32),
                  point: wp.array(dtype=wp.vec3), normal: wp.array(dtype=wp.vec3), ke: float, kd: float,
                  f: wp.array(dtype=wp.vec3)):
    t = wp.tid()
    i = idx[t]
    n = normal[t]
    d = wp.dot(q[i] - point[t], n)
    v = wp.dot(qd[i], n)
    f[i] = f[i] - (ke * d + kd * v) * n


def attachments(labels, body, n_verts):
    """(indices, plane points, plane normals) in metres — GarmentCode's attachment planes."""
    waist = body["height"] - body["head_l"] - body["waist_line"]
    neck = (body["neck_w"] - 2.0) / 2.0
    under_arm = body["height"] - body["head_l"] - body["armscye_depth"]
    planes = {"lower_interface": ((0, waist, 0), (0, 1, 0)), "right_collar": ((-neck, 0, 0), (1, 0, 0)),
              "left_collar": ((neck, 0, 0), (-1, 0, 0)), "strapless_top": ((0, under_arm, 0), (0, 1, 0))}
    idx, pts, nrm, used = [], [], [], {}
    for name, (p, n) in planes.items():
        vs = [v for v in labels.get(name, []) if v < n_verts]
        if vs:
            used[name] = len(vs)
            idx += vs
            pts += [np.array(p) * 0.01] * len(vs)
            nrm += [n] * len(vs)
    return np.array(idx, np.int32), np.array(pts, np.float32), np.array(nrm, np.float32), used


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--box-dir", required=True)
    ap.add_argument("--case", required=True)
    ap.add_argument("--body-obj", required=True)
    ap.add_argument("--body-yaml", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-frames", type=int, default=2400)
    ap.add_argument("--device", default=None)
    ap.add_argument("--mu", type=float, default=0.2, help="cloth-body friction (Newton example 0.2; GarmentCode 0.5)")
    ap.add_argument("--attach-ke", type=float, default=ATTACH_KE, help="attachment plane spring, N/m per vertex")
    ap.add_argument("--attach-kd", type=float, default=ATTACH_KD)
    ap.add_argument("--settle-frames", type=int, default=5, help="frames after release before the static check")
    ap.add_argument("--max-speed", type=float, default=MAX_SPEED, help="cloth speed limit, m/s")
    ap.add_argument("--snapshots", type=int, default=0, help="write the cloth every N frames (0: never)")
    a = ap.parse_args()
    t0 = time.time()
    import newton
    from newton.solvers import style3d
    wp.init()
    device = wp.get_device(a.device)
    t_import = time.time() - t0

    box_dir, out = Path(a.box_dir), Path(a.out) / a.case
    out.mkdir(parents=True, exist_ok=True)
    t1 = time.time()
    V, F = read_obj(box_dir / f"{a.case}_boxmesh.obj")                       # cm, Y up
    seg = open(box_dir / f"{a.case}_sim_segmentation.txt").read().split("\n")[:len(V)]
    stitch = np.array([s.startswith("stitch") for s in seg])
    orig_lens = pickle.load(open(box_dir / f"{a.case}_orig_lens.pickle", "rb"))
    labels = yaml.safe_load(open(box_dir / f"{a.case}_vertex_labels.yaml")) or {}
    panel, n_seam = rest_panel_coords(V, F, stitch, orig_lens)
    bV, bF = read_obj(a.body_obj)
    if np.ptp(bV[:, 1]) > 3.0:
        bV = bV * 0.01                                                       # cm -> m
    body = yaml.safe_load(open(a.body_yaml))["body"]

    builder = newton.ModelBuilder(up_axis=newton.Axis.Y)
    newton.solvers.SolverStyle3D.register_custom_attributes(builder)
    style3d.add_cloth_mesh(
        builder, pos=wp.vec3(0.0, 0.0, 0.0), rot=wp.quat_identity(), vel=wp.vec3(0.0, 0.0, 0.0),
        vertices=(V * 0.01).tolist(), indices=F.reshape(-1).tolist(),
        panel_verts=(panel * 0.01).tolist(), panel_indices=list(range(3 * len(F))),
        density=0.3, scale=1.0, particle_radius=5.0e-3,
        tri_aniso_ke=wp.vec3(1.0e2, 1.0e2, 1.0e1), edge_aniso_ke=wp.vec3(2.0e-5, 1.0e-5, 5.0e-6))
    builder.add_shape_mesh(body=-1, mesh=newton.Mesh(bV.astype(np.float32), bF.reshape(-1).astype(np.int32)))
    model = builder.finalize(device=device)
    model.soft_contact_ke = 1.0e1
    model.soft_contact_kd = 1.0e-5
    model.soft_contact_mu = a.mu
    model.set_gravity((0.0, 0.0, 0.0))
    solver = newton.solvers.SolverStyle3D(model=model, iterations=ITERATIONS)
    state_0, state_1, control = model.state(), model.state(), model.control()
    pipeline = newton.CollisionPipeline(model, soft_contact_gap=CONTACT_GAP)
    contacts = pipeline.contacts()
    a_idx, a_pts, a_nrm, a_used = attachments(labels, body, len(V))
    a_idx_w = wp.array(a_idx, dtype=wp.int32, device=device)
    a_pts_w = wp.array(a_pts, dtype=wp.vec3, device=device)
    a_nrm_w = wp.array(a_nrm, dtype=wp.vec3, device=device)
    t_build = time.time() - t1

    dt = 1.0 / FPS / SUBSTEPS
    q_prev = state_0.particle_q.numpy().copy()
    t2 = time.time()
    frame, static, nan = 0, False, False
    for frame in range(a.max_frames):
        if frame == ZERO_GRAVITY_FRAMES:
            model.set_gravity((0.0, -9.81, 0.0))
        pipeline.collide(state_0, contacts)
        for _ in range(SUBSTEPS):
            state_0.clear_forces()
            if frame < ATTACH_FRAMES and len(a_idx):
                wp.launch(plane_springs, dim=len(a_idx), device=device,
                          inputs=[state_0.particle_q, state_0.particle_qd, a_idx_w, a_pts_w, a_nrm_w,
                                  a.attach_ke, a.attach_kd, state_0.particle_f])
            solver.step(state_0, state_1, control, contacts, dt)
            state_0, state_1 = state_1, state_0
            wp.launch(clamp_speed, dim=model.particle_count, device=device, inputs=[state_0.particle_qd, a.max_speed])
        q = state_0.particle_q.numpy()
        if not np.isfinite(q).all():
            nan = True
            break
        if a.snapshots and frame % a.snapshots == 0:
            with open(out / f"{a.case}_f{frame:04d}.obj", "w") as f:
                f.write("".join(f"v {x:.4f} {y:.4f} {z:.4f}\n" for x, y, z in q * 100.0))
        move = np.linalg.norm(q - q_prev, axis=1)
        q_prev = q.copy()
        if frame >= max(ATTACH_FRAMES + a.settle_frames, ZERO_GRAVITY_FRAMES) and (move < STATIC_MOVE_M).mean() >= STATIC_SHARE:
            static = True
            break
    t_sim = time.time() - t2
    frames = frame + 1

    q = state_0.particle_q.numpy() * 100.0                                    # m -> cm
    sim_obj = out / f"{a.case}_sim.obj"
    with open(sim_obj, "w") as f:
        f.write("".join(f"v {x:.5f} {y:.5f} {z:.5f}\n" for x, y, z in q))
        f.write("".join(f"f {i + 1} {j + 1} {k + 1}\n" for i, j, k in F))
    shutil.copy(box_dir / f"{a.case}_boxmesh.obj", out / f"{a.case}_boxmesh.obj")
    d = np.linalg.norm(q - V, axis=1)
    fails = ([] if static else ["static_equilibrium"]) + (["nan"] if nan else [])
    res = {"case": a.case, "solver": "newton.SolverStyle3D", "max_speed": a.max_speed, "contact_gap": CONTACT_GAP, "mu": a.mu,
           "attach_ke": a.attach_ke, "settle_frames": a.settle_frames, "newton": newton.__version__,
           "warp": wp.config.version, "device": str(device), "import_s": round(t_import, 1),
           "boxmesh_s": round(t_build, 1), "sim_wall_s": round(t_sim, 1), "frames": frames,
           "s_per_frame": t_sim / frames, "fails": fails, "vertices": len(V), "triangles": len(F),
           "seam_triangles": n_seam, "attachments": a_used, "body_collisions": None, "self_collisions": None,
           "move_max_cm": round(float(np.nanmax(d)), 2), "move_mean_cm": round(float(np.nanmean(d)), 2),
           "nan_vertices": int((~np.isfinite(q)).any(1).sum()),
           "sim_obj": sim_obj.name, "sim_obj_mb": round(sim_obj.stat().st_size / 2 ** 20, 2)}
    json.dump(res, open(out / "case_result.json", "w"), indent=1)
    print("CASE_RESULT", json.dumps(res))


if __name__ == "__main__":
    main()
