# scripts/garments/export_test_garments.py
#
# Тестовые вещи для подгонки одежды на болванке (Blender в фоне):
#   Blender -b --python-exit-code 1 --python scripts/garments/export_test_garments.py
#
#  1. Нейтральная фигура MPFB с нашими 16 ключами (как в сборке болванки).
#  2. Комплекты MPFB (CC0) надеваются штатной посадкой MakeHuman и делятся на
#     верх и низ по несвязанным кускам.
#  3. В client/public/models/test-garments/ пишутся:
#       <id>.glb         — L0 «идеальная»: вещь на нейтральной болванке;
#       <id>_seller.glb  — L1 «как от продавца»: посажена на другую фигуру,
#                          прорежена, в миллиметрах, чуть повёрнута и сдвинута;
#       manifest.json    — тип, крой, эластичность, размерные сетки, лицензия.
#  4. В scripts/garments/out/ref/ — эталоны: та же вещь, посаженная MakeHuman
#     на каждую тестовую фигуру (для сравнения с нашей подгонкой).

import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "avatar"))
sys.path.insert(0, HERE)
import build_avatar as ba  # noqa: E402
import config  # noqa: E402  (scripts/avatar/config.py)
import garment_config as gc  # noqa: E402
import measure  # noqa: E402

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.clothesservice import ClothesService  # noqa: E402
from bl_ext.blender_org.mpfb.services.locationservice import LocationService  # noqa: E402


def log(*args):
    print("[garments]", *args, flush=True)


def set_figure(human, controls):
    """Значения 8 морфов → веса наших ключей на полной фигуре MPFB."""
    k = measure.key_weights(np.array([controls.get(c, 0.0) for c in config.CONTROL_NAMES]))
    for name, w in zip(config.KEY_NAMES, k):
        human.data.shape_keys.key_blocks[name].value = float(w)


def world_coords(obj):
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    m = np.array(obj.matrix_world)
    return co @ m[:3, :3].T + m[:3, 3]


def components(obj):
    """Номер связного куска для каждой вершины."""
    n = len(obj.data.vertices)
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for p in obj.data.polygons:
        vs = list(p.vertices)
        r0 = find(vs[0])
        for v in vs[1:]:
            r = find(v)
            if r != r0:
                parent[r] = r0
    return np.array([find(i) for i in range(n)])


def piece_labels(obj):
    """'top' / 'bottom' для каждой вершины: кусок, поднимающийся выше 1.15 м на нейтральной фигуре, — верх."""
    comp = components(obj)
    z = world_coords(obj)[:, 2]
    labels = np.empty(len(comp), dtype=object)
    for c in np.unique(comp):
        idx = comp == c
        labels[idx] = "top" if z[idx].max() > 1.15 else "bottom"
    return labels


def keep_only(obj, keep_mask, name):
    """Копия объекта, в которой оставлены только вершины keep_mask."""
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = dup.data.name = name
    dup.parent = None
    dup.matrix_world = obj.matrix_world.copy()
    bpy.context.scene.collection.objects.link(dup)
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep_mask[v.index]], context="VERTS")
    bm.to_mesh(dup.data)
    bm.free()
    return dup


def textured_material(suit):
    """Простой материал с диффузной текстурой комплекта, уменьшенной до 512 px."""
    clothes_dir = os.path.join(LocationService.get_user_data("clothes"), suit)
    img = bpy.data.images.load(os.path.join(clothes_dir, f"{suit}_diffuse.png"))
    img.scale(gc.TEXTURE_SIZE, gc.TEXTURE_SIZE)
    img.pack()
    mat = bpy.data.materials.new(suit)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.8
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def export_glb(obj, path, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="JPEG",
        export_jpeg_quality=85, export_skins=False, export_morph=False, export_animations=False,
        export_cameras=False, export_lights=False,
    )


def make_seller(obj, name):
    """«Как от продавца»: треугольники, прореживание, миллиметры, небольшой поворот и сдвиг."""
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = dup.data.name = name
    bpy.context.scene.collection.objects.link(dup)
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(dup.data)
    bm.free()
    mod = dup.modifiers.new("decimate", "DECIMATE")
    mod.ratio = gc.SELLER_DECIMATE
    bpy.context.view_layer.objects.active = dup
    bpy.ops.object.modifier_apply(modifier=mod.name)
    dup.rotation_euler = (0, 0, math.radians(gc.SELLER_YAW_DEG))
    dup.location = tuple(c * gc.SELLER_SCALE for c in gc.SELLER_OFFSET_M)
    dup.scale = (gc.SELLER_SCALE,) * 3
    bpy.ops.object.select_all(action="DESELECT")
    dup.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return dup


def to_gltf(co):
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=-1)


def main():
    gc.GARMENTS_DIR.mkdir(parents=True, exist_ok=True)
    (gc.OUT_DIR / "ref").mkdir(parents=True, exist_ok=True)
    human, *_ = ba.create_keyed_human()
    cal = json.loads(config.CALIBRATION_PATH.read_text())
    figures = {name: t["controls"] for name, t in cal["validation"]["testFigures"].items() if t["inRange"]}
    figures["neutral"] = {}

    clothes_root = LocationService.get_user_data("clothes")
    manifest = {"source": "MPFB 2.0.18 / MakeHuman system assets (CC0); dress — our photo-generation stub",
                "items": []}

    for suit, parts in gc.SUITS.items():
        set_figure(human, {})
        clothes = HumanService.add_mhclo_asset(
            os.path.join(clothes_root, suit, f"{suit}.mhclo"), human, asset_type="Clothes", subdiv_levels=0,
            material_type="NONE", set_up_rigging=False, interpolate_weights=False, import_subrig=False,
            import_weights=False)
        labels = piece_labels(clothes)
        material = textured_material(suit)

        # эталоны MakeHuman на каждой фигуре (координаты glTF)
        for fig, controls in figures.items():
            set_figure(human, controls)
            ClothesService.fit_clothes_to_human(clothes, human)
            co = to_gltf(world_coords(clothes))
            for part, item in parts.items():
                np.save(gc.OUT_DIR / "ref" / f"{fig}__{item}.npy", co[labels == part].astype(np.float32))

        # L0 — на нейтральной фигуре; L1 — на «чужой» фигуре, испорченная как генерация
        for variant, controls in (("", {}), ("_seller", gc.SELLER_FIGURE)):
            set_figure(human, controls)
            ClothesService.fit_clothes_to_human(clothes, human)
            for part, item in parts.items():
                piece = keep_only(clothes, labels == part, f"{item}{variant}")
                if variant:
                    piece = make_seller(piece, f"{item}{variant}_out")
                export_glb(piece, gc.GARMENTS_DIR / f"{item}{variant}.glb", material)
                log(f"{item}{variant}: {len(piece.data.vertices)} verts, "
                    f"{(gc.GARMENTS_DIR / f'{item}{variant}.glb').stat().st_size / 1024:.0f} KB")

        for part, item in parts.items():
            spec = gc.ITEMS[item]
            manifest["items"].append({
                "id": item, "name": spec["name"], "garmentType": spec["garmentType"],
                "fit": spec["fit"], "stretch": spec["stretch"], "legs": spec.get("legs"),
                "file": f"/models/test-garments/{item}.glb",
                "sellerFile": f"/models/test-garments/{item}_seller.glb",
                "sizeChart": [{"size": s, **g, "fit": spec["fit"], "stretch": spec["stretch"]}
                              for s, g in spec["sizes"].items()],
                "source": f"MPFB {suit} ({part})", "license": "CC0",
            })
        bpy.data.objects.remove(clothes, do_unlink=True)
        set_figure(human, {})

    d = gc.DRESS
    manifest["items"].append({
        "id": "dress", "name": d["name"], "garmentType": d["garmentType"], "fit": d["fit"], "stretch": d["stretch"],
        "legs": d["legs"], "file": d["file"], "sellerFile": d["file"],
        "sizeChart": [{"size": s, **g, "fit": d["fit"], "stretch": d["stretch"]} for s, g in d["sizes"].items()],
        "source": "photo-generation stub (ImageToStl)", "license": "project",
    })
    gc.MANIFEST_PATH.write_text(json.dumps(manifest, indent=1) + "\n")
    log("wrote", gc.MANIFEST_PATH, "and", len(list((gc.OUT_DIR / "ref").glob("*.npy"))), "reference fits")


if __name__ == "__main__":
    main()
