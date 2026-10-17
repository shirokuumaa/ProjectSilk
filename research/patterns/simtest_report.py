"""Stage B report of the GarmentCode simulator test, on the Mac, from the pod's results.

Input: runs/simtest/results/ (unpacked simtest_results.tar.gz: <case>/…_sim.obj, …_boxmesh.obj,
case_result.json; summary.tsv, timings.tsv, logs/), runs/simtest/inputs/ (bodies, cases, reference).

Per case:
  * time — wall seconds of the simulation (+ box mesh), frames, s/frame (GPU);
  * holds — no NaN, nothing flew away (garment inside the body's box + 50 cm) and the top of the garment
    did not slide: top drop vs the box mesh (GarmentCode places panels at their worn height) < 5 cm;
    the control instead: within 2 cm (Chamfer) of the authors' own simulation;
  * inside — share of garment vertices more than 2 mm inside the body (signed distance to the nearest
    body surface sample, with its normal) and the 99th percentile depth;
  * files — simulated OBJ and the same mesh as GLB (vertices welded, no UVs), MB;
  * control only — Chamfer distance to GarmentCodeData's own simulation of the same garment.
Pictures: Blender workbench front/side per case + one sheet. Cost: 3 sizes × 8 figures per product.

Usage: python simtest_report.py [--results runs/simtest/results] [--price 0.40] [--no-render]
  -> runs/simtest/report.md, runs/simtest/sheet.png, runs/simtest/renders/
Another simulator on the same box meshes (Newton): --results runs/newtontest/results --out runs/newtontest
  --title "..." --compare runs/simtest/results — adds the distance to GarmentCode's result per case (same
  box mesh, same vertex order: per-vertex mean / 95th percentile, cm). --price 0: no GPU, report CPU time.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import trimesh
import yaml
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
SIM = HERE / "runs" / "simtest"
GC_BODIES = HERE / ".envs" / "src" / "GarmentCode" / "assets" / "bodies"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
SIZES, FIGURES = 3, 8


def body_mesh(case, inputs):
    p = (GC_BODIES / f"{case['body']}.obj") if case["bodies"] == "gc" else \
        (inputs / "bodies_mpfb" / f"{case['body']}.obj")
    m = trimesh.load(p, process=False, force="mesh")
    if np.ptp(m.vertices[:, 1]) < 3.0:
        m.vertices *= 100.0
    return p, m


def inside_stats(body, V, n=300000):
    pts, fid = trimesh.sample.sample_surface(body, n, seed=0)
    nrm = body.face_normals[fid]
    d, i = cKDTree(pts).query(V)
    s = np.einsum("ij,ij->i", V - pts[i], nrm[i])
    depth = np.clip(-s, 0, None)
    return float((s < -0.2).mean() * 100), float(np.percentile(depth, 99))


def chamfer(a, b, n=50000):
    p1, _ = trimesh.sample.sample_surface(a, n, seed=0)
    p2, _ = trimesh.sample.sample_surface(b, n, seed=0)
    return float((cKDTree(p2).query(p1)[0].mean() + cKDTree(p1).query(p2)[0].mean()) / 2)


def read_v(path):
    return np.array([[float(x) for x in l.split()[1:4]] for l in open(path) if l.startswith("v ")])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=str(SIM / "results"))
    ap.add_argument("--inputs", default=str(SIM / "inputs"))
    ap.add_argument("--price", type=float, default=0.40)
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--out", default=str(SIM))
    ap.add_argument("--title", default="Тест симулятора GarmentCode (их форк Warp) на видеокарте")
    ap.add_argument("--compare", help="results dir of another simulator on the same box meshes")
    ap.add_argument("--compare-name", default="GarmentCode")
    a = ap.parse_args()
    res_dir, inputs, out = Path(a.results), Path(a.inputs), Path(a.out)
    cases = json.load(open(inputs / "cases.json"))
    rdir = out / "renders"
    rdir.mkdir(parents=True, exist_ok=True)
    rows = []
    for c in cases:
        d = res_dir / c["case"]
        rj = d / "case_result.json"
        if not rj.exists():
            rows.append({"case": c["case"], "status": "нет результата"})
            continue
        r = json.load(open(rj))
        sim_p, box_p = d / f"{c['case']}_sim.obj", d / f"{c['case']}_boxmesh.obj"
        g = trimesh.load(sim_p, process=False, force="mesh")
        box = trimesh.load(box_p, process=False, force="mesh")
        bpath, body = body_mesh(c, inputs)
        V = np.asarray(g.vertices)
        nan = int(np.isnan(V).any(1).sum())
        lo, hi = body.bounds[0] - 50, body.bounds[1] + 50
        flew = bool(((V < lo) | (V > hi)).any())
        top_drop = float(box.vertices[:, 1].max() - np.nanmax(V[:, 1]))
        moved = float(r.get("move_max_cm") or 0)
        holds = nan == 0 and not flew and top_drop < 5.0 and moved > 1.0
        ins, depth99 = inside_stats(body, np.nan_to_num(V)) if nan == 0 else (float("nan"), float("nan"))
        glb = rdir / f"{c['case']}.glb"
        gw = trimesh.Trimesh(V, g.faces, process=True)
        gw.export(glb)
        row = {"case": c["case"], "item": c["item"], "size": c["size"], "body": c["body"],
               "wall_s": r.get("sim_wall_s"), "box_s": r.get("boxmesh_s"), "frames": r.get("frames"),
               "s_per_frame": r.get("s_per_frame"), "fails": ", ".join(r.get("fails") or []) or "—",
               "holds": holds, "nan": nan, "flew": flew, "top_drop_cm": round(top_drop, 1),
               "move_max_cm": moved, "inside_pct": round(ins, 2), "inside_depth_p99_cm": round(depth99, 2),
               "obj_mb": round(sim_p.stat().st_size / 2 ** 20, 2), "glb_mb": round(glb.stat().st_size / 2 ** 20, 2),
               "triangles": len(g.faces)}
        if a.compare:
            other = Path(a.compare) / c["case"] / f"{c['case']}_sim.obj"
            if other.exists():
                va, vb = read_v(sim_p), read_v(other)
                if va.shape == vb.shape:
                    dd = np.linalg.norm(va - vb, axis=1)
                    row["vs_mean_cm"], row["vs_p95_cm"] = round(float(dd.mean()), 2), round(float(np.percentile(dd, 95)), 2)
                row["vs_chamfer_cm"] = round(chamfer(gw, trimesh.load(other, process=False, force="mesh")), 2)
        ref = inputs / "reference" / f"{c['case']}_sim.ply"
        if ref.exists():   # control: judged by the authors' own result (its hood starts upright, drops 16 cm)
            row["chamfer_to_reference_cm"] = round(chamfer(gw, trimesh.load(ref, process=False, force="mesh")), 2)
            row["holds"] = nan == 0 and not flew and row["chamfer_to_reference_cm"] < 2.0
        if not a.no_render:
            subprocess.run([BLENDER, "-b", "--factory-startup", "--python", str(HERE / "blender" / "render_pair.py"),
                            "--", "--body", str(bpath), "--garment", str(sim_p), "--out", str(rdir / c["case"])],
                           check=False, capture_output=True)
        rows.append(row)

    # sheet: front + side per case
    from PIL import Image, ImageDraw
    tiles = []
    for row in rows:
        f, s = rdir / f"{row['case']}_front.png", rdir / f"{row['case']}_side.png"
        if f.exists() and s.exists():
            im = Image.new("RGB", (500, 780), "white")
            im.paste(Image.open(f).convert("RGB").resize((250, 375)), (0, 30))
            im.paste(Image.open(s).convert("RGB").resize((250, 375)), (250, 30))
            ImageDraw.Draw(im).text((5, 5), f"{row['case']}  {'holds' if row['holds'] else 'FAILS'}", fill="black")
            tiles.append(im.crop((0, 0, 500, 410)))
    if tiles:
        cols = 4
        sheet = Image.new("RGB", (500 * cols, 410 * ((len(tiles) + cols - 1) // cols)), "white")
        for k, t in enumerate(tiles):
            sheet.paste(t, ((k % cols) * 500, (k // cols) * 410))
        sheet.save(out / "sheet.png")

    ours = [r for r in rows if r.get("item") not in (None, "gcd_control") and r.get("wall_s")]
    t_mean = float(np.mean([r["wall_s"] + (r["box_s"] or 0) for r in ours])) if ours else float("nan")
    per_product = SIZES * FIGURES * t_mean * a.price / 3600
    timings = {}
    tf = res_dir / "timings.tsv"
    if tf.exists():
        for line in open(tf).read().splitlines()[1:]:
            p = line.split("\t")
            timings[p[0]] = float(p[3])
    setup_s = sum(v for k, v in timings.items() if not k.startswith("sim_"))

    vs = f" | До {a.compare_name}, см (по вершинам: среднее / p95; Chamfer)" if a.compare else ""
    L = [f"# {a.title}\n",
         "| Вещь | Размер | Болванка | Держится | Время, с (кадров, с/кадр) | Верх сполз, см | Ткань внутри тела, % (p99 глубина, см) | OBJ / GLB, МБ | Треугольников | Отбраковка" + vs + " |",
         "|---|---|---|---|---|---|---|---|---|---|" + ("---|" if a.compare else "")]
    for r in rows:
        if "wall_s" not in r:
            L.append(f"| {r['case']} | | | {r['status']} | | | | | | |")
            continue
        ctrl = f" (контроль; до их результата {r['chamfer_to_reference_cm']} см)" if "chamfer_to_reference_cm" in r else ""
        L.append(f"| {r['item']}{ctrl} | {r['size']} | {r['body']} | {'да' if r['holds'] else 'НЕТ'} | "
                 f"{r['wall_s']:.0f} ({r['frames']}, {r['s_per_frame']:.3f}) | {r['top_drop_cm']} | "
                 f"{r['inside_pct']} ({r['inside_depth_p99_cm']}) | {r['obj_mb']} / {r['glb_mb']} | {r['triangles']} | {r['fails']}"
                 + (f" | {r.get('vs_mean_cm', '—')} / {r.get('vs_p95_cm', '—')}; {r.get('vs_chamfer_cm', '—')}" if a.compare else "")
                 + " |")
    if a.price > 0:
        L += ["", f"**Стоимость товара** ({SIZES} размера × {FIGURES} фигур = {SIZES * FIGURES} симуляций): "
              f"{SIZES * FIGURES} × {t_mean:.0f} с × ${a.price}/ч = **${per_product:.3f}** за товар "
              f"(среднее время наших вещей, вместе с построением сетки).",
              f"Разовая установка на свежей машине (apt, окружение, сборка форка): {setup_s / 60:.1f} мин ≈ "
              f"${setup_s / 3600 * a.price:.2f} — на пачку товаров, не на товар."]
    else:
        L += ["", f"**Время на товар без видеокарты** ({SIZES} × {FIGURES} = {SIZES * FIGURES} симуляций, "
              f"по одной на ядро процессора): {SIZES * FIGURES} × {t_mean / 60:.1f} мин = "
              f"{SIZES * FIGURES * t_mean / 3600:.1f} ч процессорного времени."]
    (out / "report.md").write_text("\n".join(L) + "\n")
    json.dump(rows, open(out / "report.json", "w"), indent=1)
    print("\n".join(L))


if __name__ == "__main__":
    main()
