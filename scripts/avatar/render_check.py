# scripts/avatar/render_check.py
#
# Проверочные картинки болванки (Blender в фоне, Workbench):
#   keys     — каждый морф на −1 и +1, спереди и сбоку (out/keys_front.png, out/keys_side.png)
#   stretch  — выбранные морфы за пределами ±1, чтобы найти, где начинаются изломы
#   figures  — тестовые фигуры из avatarCalibration.json спереди и сбоку с линиями обмеров
#   underwear — маска белья на светлом, среднем и тёмном тоне (цвета из tokens.css)
#
# Запуск: Blender -b --python-exit-code 1 --python scripts/avatar/render_check.py -- keys|stretch|figures|underwear

import json
from pathlib import Path
import math
import os
import re
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402
import glb  # noqa: E402
import measure  # noqa: E402

BODY_COLOR = (0.80, 0.72, 0.66)
GRID_COLOR = (0.85, 0.85, 0.85)
TEXT_COLOR = (0.15, 0.15, 0.15)
LINE_COLORS = {
    "bust": (0.85, 0.15, 0.15), "waist": (0.10, 0.60, 0.20), "hips": (0.15, 0.35, 0.90),
    "shoulder": (0.95, 0.55, 0.05), "arm_l": (0.55, 0.20, 0.75), "arm_r": (0.55, 0.20, 0.75),
    "inseam": (0.05, 0.65, 0.70),
}
COLUMN = 1.15        # шаг между фигурами, м
ROW = 2.75           # шаг между рядами, м


def log(*args):
    print("[render]", *args, flush=True)


def css_color(name):
    """Цвет токена из client/src/styles/tokens.css → линейный RGB для Blender."""
    text = (config.REPO / "client" / "src" / "styles" / "tokens.css").read_text()
    match = re.search(rf"{re.escape(name)}:\s*#([0-9A-Fa-f]{{6}})", text)
    srgb = np.array([int(match.group(1)[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4).tolist()


def to_blender(co):
    co = np.asarray(co)
    return np.stack([co[..., 0], -co[..., 2], co[..., 1]], axis=-1)


class Scene:
    def __init__(self, body, vertex_colors=False):
        self.body = body
        # вершины glTF дублируются на швах UV — сшиваем, чтобы не было швов в затенении
        _, first, inverse = np.unique(np.round(body.base, 6), axis=0, return_index=True, return_inverse=True)
        self.unique = first
        self.faces = inverse.reshape(-1)[body.tris]
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_WORKBENCH"
        shading = scene.display.shading
        shading.light = "STUDIO"
        shading.color_type = "VERTEX" if vertex_colors else "OBJECT"
        shading.show_cavity = True
        scene.world.color = (0.75, 0.75, 0.75) if vertex_colors else (1, 1, 1)
        scene.view_settings.view_transform = "Standard"
        self.extent = [np.inf, -np.inf, np.inf, -np.inf]   # x min/max, z min/max
        self.row_top = {}                                   # низ ряда → рост самой высокой фигуры

    def add_body(self, u, x, z, view, label, lines=False, tone=None):
        res, geometry, co = self.body.measure(u, with_geometry=True)
        pts = to_blender(co[self.unique])
        mesh = bpy.data.meshes.new("body")
        mesh.from_pydata(pts.tolist(), [], self.faces.tolist())
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        if tone is not None:                        # кожа + бельё по маске, цвета из tokens.css
            skin, cloth = np.array(tone), np.array(css_color("--underwear"))
            mask = np.clip(self.body.underwear[self.unique] / 0.003 * 0.5 + 0.5, 0, 1)[:, None]
            rgb = skin * (1 - mask) + cloth * mask
            attr = mesh.color_attributes.new("tone", "FLOAT_COLOR", "POINT")
            attr.data.foreach_set("color", np.hstack([rgb, np.ones((len(rgb), 1))]).ravel())
        obj = bpy.data.objects.new("body", mesh)
        obj.color = (*BODY_COLOR, 1)
        bpy.context.scene.collection.objects.link(obj)
        parts = [obj]
        if lines:
            for name, poly in geometry.items():
                parts.append(self.polyline(to_blender(poly), LINE_COLORS[name], closed=name in ("bust", "waist", "hips")))
        for part in parts:
            if view in ("side", "back"):            # правым боком или спиной к камере
                part.rotation_euler = (0, 0, math.pi / 2 if view == "side" else math.pi)
            part.location = (x, 0, z)
        self.text(label, x, z - 0.12)
        self.extent = [min(self.extent[0], x - 0.55), max(self.extent[1], x + 0.55),
                       min(self.extent[2], z - 0.25), max(self.extent[3], z + res["height"] / 100 + 0.05)]
        self.row_top[z] = max(self.row_top.get(z, 0.0), res["height"] / 100)
        return res

    def polyline(self, pts, color, closed=False, radius=0.006):
        curve = bpy.data.curves.new("line", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = radius
        spline = curve.splines.new("POLY")
        spline.points.add(len(pts) - 1)
        for p, q in zip(spline.points, pts):
            p.co = (*q, 1)
        spline.use_cyclic_u = closed
        obj = bpy.data.objects.new("line", curve)
        obj.color = (*color, 1)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def text(self, body, x, z, size=0.075):
        curve = bpy.data.curves.new("label", "FONT")
        curve.body = body
        curve.size = size
        curve.align_x = "CENTER"
        obj = bpy.data.objects.new("label", curve)
        obj.rotation_euler = (math.pi / 2, 0, 0)
        obj.location = (x, -0.5, z)
        obj.color = (*TEXT_COLOR, 1)
        bpy.context.scene.collection.objects.link(obj)

    def grid(self):
        """Горизонтальные линии каждые 10 см за фигурами — для сравнения роста."""
        x0, x1 = self.extent[:2]
        for row_base, top in self.row_top.items():
            for cm in range(0, int(top * 100) + 11, 10):
                z = row_base + cm / 100
                self.polyline(np.array([[x0, 0.6, z], [x1, 0.6, z]]), GRID_COLOR,
                              radius=0.0015 if cm % 50 else 0.003)
                if cm % 50 == 0 and cm:
                    self.text(f"{cm}", x0 + 0.08, z + 0.01, size=0.05)

    def render(self, path, px_per_m=None):
        px_per_m = px_per_m or float(os.environ.get("PX_PER_M", 260))
        x0, x1, z0, z1 = self.extent
        cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
        cam.data.type = "ORTHO"
        w, h = x1 - x0, z1 - z0
        cam.data.ortho_scale = max(w, h)
        cam.location = ((x0 + x1) / 2, -10, (z0 + z1) / 2)
        cam.rotation_euler = (math.pi / 2, 0, 0)
        bpy.context.scene.collection.objects.link(cam)
        scene = bpy.context.scene
        scene.camera = cam
        scene.render.resolution_x = int(w * px_per_m)
        scene.render.resolution_y = int(h * px_per_m)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        log("wrote", path)


def load_body():
    info = json.loads(config.BUILD_INFO_PATH.read_text())
    return measure.Body(glb.load_body(config.GLB_PATH), info["landmarks"])


def sheet(body, rows, path, lines=False, vertex_colors=False):
    """rows: [[(label, u, view[, tone]) | None, ...], ...]; None — пустая клетка."""
    sc = Scene(body, vertex_colors)
    for r, row in enumerate(rows):
        z = -r * ROW
        for c, item in enumerate(row):
            if item is not None:
                label, u, view, *tone = item
                sc.add_body(u, c * COLUMN, z, view, label, lines=lines, tone=tone[0] if tone else None)
    sc.grid()
    sc.render(path)


def control(name, value):
    u = np.zeros(len(config.CONTROL_NAMES))
    u[config.CONTROL_NAMES.index(name)] = value
    return u


def keys_sheets(body):
    for view in ("front", "side"):
        rows = []
        for v in (-1, 1):
            first = ("neutral", np.zeros(len(config.CONTROL_NAMES)), view) if v < 0 else None
            rows.append([first] + [(f"{c} {v:+g}", control(c, v), view) for c in config.CONTROL_NAMES])
        sheet(body, rows, config.OUT_DIR / f"keys_{view}.png")


def stretch_sheet(body, names, values):
    for view in ("front", "side"):
        rows = [[(f"{n} {v:+g}", control(n, v), view) for v in values] for n in names]
        sheet(body, rows, config.OUT_DIR / f"stretch_{'_'.join(names)}_{view}.png")


def figures_sheet(body):
    cal = json.loads(config.CALIBRATION_PATH.read_text())
    rows = []
    for view in ("front", "side"):
        row = []
        for name, t in cal["validation"]["testFigures"].items():
            u = np.array([t["controls"][c] for c in config.CONTROL_NAMES])
            flag = "" if t["inRange"] else "  OUT OF RANGE"
            row.append((f"{name}{flag}", u, view))
        rows.append(row)
    sheet(body, rows, config.OUT_DIR / "figures.png", lines=True)


def underwear_sheet(body):
    cal = json.loads(config.CALIBRATION_PATH.read_text())
    large = np.array([cal["validation"]["testFigures"]["large"]["controls"][c] for c in config.CONTROL_NAMES])
    figures = [("skin-1", np.zeros(len(config.CONTROL_NAMES)), "--skin-1"),
               ("skin-5", np.zeros(len(config.CONTROL_NAMES)), "--skin-5"),
               ("skin-10", np.zeros(len(config.CONTROL_NAMES)), "--skin-10"),
               ("large, skin-7", large, "--skin-7")]
    rows = [[(f"{label} {view}", u, view, css_color(token)) for label, u, token in figures]
            for view in ("front", "side", "back")]
    sheet(body, rows, config.OUT_DIR / "underwear.png", vertex_colors=True)


def controls_sheet(body, path):
    """Любые наборы морфов из JSON {подпись: {морф: значение}} — спереди и сбоку, по строке на ряд."""
    sets = json.loads(path.read_text())
    rows = []
    for view in ("front", "side"):
        rows.append([(label, np.array([u.get(c, 0.0) for c in config.CONTROL_NAMES]), view)
                     for label, u in sets.items()])
    sheet(body, rows, config.OUT_DIR / f"{path.stem}.png", lines=True)


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["keys"]
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    body = load_body()
    mode = args[0]
    if mode == "keys":
        keys_sheets(body)
    elif mode == "stretch":
        names = args[1].split(",")
        values = [float(v) for v in args[2].split(",")]
        stretch_sheet(body, names, values)
    elif mode == "figures":
        figures_sheet(body)
    elif mode == "underwear":
        underwear_sheet(body)
    elif mode == "controls":
        controls_sheet(body, Path(args[1]))
    else:
        raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
