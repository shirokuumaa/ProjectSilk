# scripts/avatar/build_avatar.py
#
# Сборка базового тела (болванки) из MPFB. Запуск только из Blender в фоне:
#   Blender -b --python-exit-code 1 --python scripts/avatar/build_avatar.py
# (обычно через scripts/avatar/build.sh).
#
# Что делает:
#   1. Создаёт нейтральную взрослую женщину в A-позе.
#   2. Для каждого нашего морфа запекает разницу «крайнее значение − нейтральная»
#      в отдельный shape key. Ступни при любом значении остаются на полу.
#   3. Удаляет все ключи MPFB: остаются Basis и 16 наших.
#   4. Ставит скелет game_engine с весами, удаляет вспомогательную геометрию.
#   5. Один однотонный материал, экспорт GLB без Draco, самопроверка файла.

import json
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402
import glb  # noqa: E402

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.targetservice import TargetService  # noqa: E402
from bl_ext.blender_org.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.blender_org.mpfb.entities.objectproperties import HumanObjectProperties  # noqa: E402

ARM_BONES = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")


def log(*args):
    print("[build]", *args, flush=True)


def to_gltf(co):
    """Blender (Z вверх) → glTF (Y вверх, вперёд +Z)."""
    co = np.asarray(co, dtype=np.float64)
    return np.stack([co[..., 0], co[..., 2], -co[..., 1]], axis=-1)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def get_coords(mesh_or_key_data, count):
    co = np.empty(count * 3)
    mesh_or_key_data.foreach_get("co", co)
    return co.reshape(-1, 3)


def mix_coords(obj):
    """Текущая смесь всех shape keys (без модификаторов)."""
    key = obj.shape_key_add(name="__mix__", from_mix=True)
    co = get_coords(key.data, len(obj.data.vertices))
    obj.shape_key_remove(key)
    return co


def set_macro(obj, name, value):
    HumanObjectProperties.set_value(name, value, entity_reference=obj)
    TargetService.reapply_macro_details(obj)


def set_macros(obj, values):
    for name, value in values.items():
        HumanObjectProperties.set_value(name, value, entity_reference=obj)
    TargetService.reapply_macro_details(obj)


def control_delta(obj, neutral, spec, side):
    """Смещения вершин при крайнем значении одного морфа (side: incr|decr)."""
    if "combo" in spec:
        combo = spec["combo"]
        set_macros(obj, combo["base"])
        base = mix_coords(obj)
        set_macros(obj, combo[side])
        delta = mix_coords(obj) - base
        set_macros(obj, {k: 0.5 for k in set(combo["base"]) | set(combo[side])})
    elif "macro" in spec:
        set_macro(obj, spec["macro"], 1.0 if side == "incr" else 0.0)
        delta = mix_coords(obj) - neutral
        set_macro(obj, spec["macro"], 0.5)
    else:
        targets_dir = LocationService.get_mpfb_data("targets")
        keys = []
        for rel in spec["targets"]:
            path = os.path.join(targets_dir, f"{rel}-{side}.target.gz")
            keys.append(TargetService.load_target(obj, path, weight=1.0, name=f"__{os.path.basename(rel)}_{side}"))
        delta = mix_coords(obj) - neutral
        for key in keys:
            obj.shape_key_remove(key)
    back = np.abs(mix_coords(obj) - neutral).max()
    if back > 1e-6:
        raise RuntimeError(f"neutral shape drifted by {back} after {spec} {side}")
    return delta


def vertex_group_members(obj, group_name):
    index = obj.vertex_groups[group_name].index
    return np.array([any(g.group == index and g.weight > 0 for g in v.groups) for v in obj.data.vertices])


def pick_landmarks(obj, armature, neutral, body):
    """Точки-ориентиры на нейтральной фигуре (координаты Blender)."""
    pts = neutral
    ids = np.flatnonzero(body)
    bones = {b.name: armature.matrix_world @ b.head_local for b in armature.data.bones}
    marks = {}

    tips = np.flatnonzero(vertex_group_members(obj, "nippleTip") & body)
    marks["nipple_l"] = pts[tips[pts[tips, 0] > 0]].mean(0)
    marks["nipple_r"] = pts[tips[pts[tips, 0] < 0]].mean(0)

    polys = [p.vertices[:] for p in obj.data.polygons if all(body[i] for i in p.vertices)]
    tris = np.array([(f[0], f[k], f[k + 1]) for f in polys for k in range(1, len(f) - 1)])
    tree = BVHTree.FromPolygons([Vector(p) for p in pts], polys)

    def nearest_vertex(point):
        return pts[ids[np.argmin(np.linalg.norm(pts[ids] - np.asarray(point), axis=1))]]

    for side, sign in (("l", 1), ("r", -1)):
        # плечевая точка: угол силуэта спереди, где пологая линия плеча переходит в руку
        joint = np.array(bones[f"upperarm_{side}"])
        profile = []
        for x in np.arange(abs(joint[0]) - 0.07, abs(joint[0]) + 0.09, 0.002):
            cut = section_by_x(pts, tris, sign * x)
            cut = cut[(np.abs(cut[:, 1] - joint[1]) < 0.12) & (cut[:, 2] > joint[2] - 0.15)]
            if len(cut):
                profile.append(cut[np.argmax(cut[:, 2])])
        profile = np.array(profile)
        a, b = profile[0], profile[-1]
        chord = np.array([abs(b[0]) - abs(a[0]), b[2] - a[2]])
        rel = np.column_stack([np.abs(profile[:, 0]) - abs(a[0]), profile[:, 2] - a[2]])
        above = (chord[0] * rel[:, 1] - chord[1] * rel[:, 0]) / np.linalg.norm(chord)
        marks[f"shoulder_{side}"] = nearest_vertex(profile[np.argmax(above)])

        # локоть: внешняя сторона сгиба (кольцо вершин в плоскости-биссектрисе сустава)
        elbow = np.array(bones[f"lowerarm_{side}"])
        wrist = np.array(bones[f"hand_{side}"])
        upper = elbow - joint
        upper /= np.linalg.norm(upper)
        forearm = wrist - elbow
        forearm /= np.linalg.norm(forearm)
        bisector = (upper + forearm) / np.linalg.norm(upper + forearm)
        ring = ids[(np.abs((pts[ids] - elbow) @ bisector) < 0.006) & (np.linalg.norm(pts[ids] - elbow, axis=1) < 0.06)]
        outward = upper - forearm                      # наружу от угла сгиба
        marks[f"elbow_{side}"] = pts[ring[np.argmax((pts[ring] - elbow) @ outward)]]

        # запястье: кольцо вершин в плоскости сустава, самая наружная точка
        ring = ids[(np.abs((pts[ids] - wrist) @ forearm) < 0.006) & (np.linalg.norm(pts[ids] - wrist, axis=1) < 0.06)]
        marks[f"wrist_{side}"] = pts[ring[np.argmax(sign * pts[ring, 0])]]

    # пах: самая низкая точка тела на средней линии
    mid = ids[np.abs(pts[ids, 0]) < 0.004]
    marks["crotch"] = pts[mid[np.argmin(pts[mid, 2])]]

    # шейная точка (C7): кожа на спине позади основания шеи (спина у MakeHuman — в сторону +Y)
    hit, _normal, _face, _dist = tree.ray_cast(bones["neck_01"], Vector((0, 1, 0)))
    if hit is None:
        raise RuntimeError("no back-of-neck surface behind neck_01")
    marks["cervicale"] = nearest_vertex(hit)
    return {name: [float(c) for c in to_gltf(p)] for name, p in marks.items()}


def section_by_x(pts, tris, x):
    """Точки пересечения поверхности с плоскостью X = x."""
    out = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        a, b = pts[tris[:, i]], pts[tris[:, j]]
        s = (a[:, 0] - x) * (b[:, 0] - x) < 0
        t = (x - a[s, 0]) / (b[s, 0] - a[s, 0])
        out.append(a[s] + (b[s] - a[s]) * t[:, None])
    return np.concatenate(out)


def underwear_sdf(obj, marks):
    """Маска белья: расстояние со знаком до края (м), > 0 — внутри белья.

    Топ-бандо — пояс вокруг груди; трусы — от линии ниже талии до паха с
    вырезами на бёдрах. Руки и кисти исключены (в A-позе кисти на уровне бёдер).
    Значение по вершинам; в шейдере из него получается чёткий край.
    """
    cfg = config.UNDERWEAR
    n = len(obj.data.vertices)
    co = get_coords(obj.data.vertices, n)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]

    arm_groups = {g.index for g in obj.vertex_groups if g.name.split("_")[0] in ARM_BONES}
    arm = np.array([sum(g.weight for g in v.groups if g.group in arm_groups) > 0.5 for v in obj.data.vertices])

    nipple_z = 0.5 * (marks["nipple_l"][1] + marks["nipple_r"][1])     # glTF Y = Blender Z
    crotch_z = marks["crotch"][1]
    crotch_y = -marks["crotch"][2]                                       # glTF Z = −Blender Y
    span = nipple_z - crotch_z

    top = np.minimum(nipple_z + cfg["top_above_nipple"] - z, z - (nipple_z - cfg["top_below_nipple"]))

    # вырез на бедре: от паха у средней линии поднимается к боку; сзади ниже
    ramp = np.clip((np.abs(x) - cfg["brief_gusset"]) / (cfg["brief_side_x"] - cfg["brief_gusset"]), 0.0, 1.0)
    rise = cfg["brief_side_frac"] * span * np.where(y > crotch_y, cfg["brief_back_factor"], 1.0)
    leg_line = crotch_z - 0.01 + ramp * (rise + 0.01)
    brief = np.minimum(crotch_z + cfg["brief_top_frac"] * span - z, z - leg_line)

    sdf = np.maximum(top, brief)
    sdf[arm] = -cfg["clamp"]
    return np.clip(sdf, -cfg["clamp"], cfg["clamp"])


def make_skin_material():
    mat = bpy.data.materials.new("skin")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.62, 0.45, 0.36, 1.0)  # нейтральный тон; в приложении цвет задаётся токеном
    bsdf.inputs["Roughness"].default_value = 0.65
    return mat


def create_keyed_human():
    """Нейтральная фигура MPFB со всей вспомогательной геометрией и нашими 16 ключами (все на 0).

    Возвращает (obj, body, neutral, deltas, feet_shift, macros). Нужна и сборке
    болванки, и скрипту тестовой одежды: MPFB надевает вещи на «колготки» и
    «юбку» из вспомогательной геометрии, поэтому ключи есть и у них.
    """
    clear_scene()

    macros = dict(config.NEUTRAL_MACROS)
    # detailed_helpers нужны: по группам joint-* MPFB ставит суставы скелета
    obj = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True,
                                    feet_on_ground=True, scale=0.1, macro_detail_dict=macros)
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    targets_dir = LocationService.get_mpfb_data("targets")
    for rel, weight in config.NEUTRAL_DETAIL_TARGETS.items():
        TargetService.load_target(obj, os.path.join(targets_dir, f"{rel}.target.gz"), weight=weight)
    body = vertex_group_members(obj, "body")
    log("basemesh verts", len(obj.data.vertices), "body verts", int(body.sum()))

    neutral = mix_coords(obj)
    neutral[:, 2] -= neutral[body, 2].min()          # подошва ровно на z = 0

    deltas, feet_shift = {}, {}
    for name, spec in config.CONTROLS:
        for side in ("incr", "decr"):
            delta = control_delta(obj, mix_coords(obj), spec, side)
            # ступни на полу: убираем общий вертикальный сдвиг подошвы
            shift = (neutral[body, 2] + delta[body, 2]).min() - neutral[body, 2].min()
            delta[:, 2] -= shift
            key = f"{name}_{side}"
            deltas[key] = delta
            feet_shift[key] = round(float(shift) * 100, 2)
            log(f"{key:16s} max shift {np.linalg.norm(delta[body], axis=1).max() * 100:6.2f} cm, feet {feet_shift[key]:+.2f} cm")

    # Basis = нейтральная фигура, дальше только наши 16 ключей
    obj.shape_key_clear()
    obj.data.vertices.foreach_set("co", neutral.ravel())
    obj.data.update()
    obj.shape_key_add(name="Basis", from_mix=False)
    for key_name in config.KEY_NAMES:
        key = obj.shape_key_add(name=key_name, from_mix=False)
        key.data.foreach_set("co", (neutral + deltas[key_name]).ravel())
        key.slider_min, key.slider_max, key.value = 0.0, 3.0, 0.0
    return obj, body, neutral, deltas, feet_shift, macros


def main():
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    obj, body, neutral, deltas, feet_shift, macros = create_keyed_human()

    armature = HumanService.add_builtin_rig(obj, "game_engine", import_weights=True)
    if armature is None:
        raise RuntimeError("could not add game_engine rig")
    landmarks = pick_landmarks(obj, armature, neutral, body)

    # убираем вспомогательную геометрию и лишние группы вершин
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not body[v.index]], context="VERTS")
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode="OBJECT")

    bone_names = {b.name for b in armature.data.bones}
    for group in list(obj.vertex_groups):
        if group.name not in bone_names:
            obj.vertex_groups.remove(group)
    unweighted = sum(1 for v in obj.data.vertices if sum(g.weight for g in v.groups) <= 0)
    if unweighted:
        raise RuntimeError(f"{unweighted} body vertices have no bone weights")

    # маска белья — атрибут «_UNDERWEAR» (glTF экспортирует атрибуты с подчёркиванием)
    sdf = underwear_sdf(obj, landmarks)
    attr = obj.data.attributes.new("_UNDERWEAR", "FLOAT", "POINT")
    attr.data.foreach_set("value", sdf.astype(np.float32))
    log(f"underwear: {(sdf > 0).sum()} of {len(sdf)} vertices inside")

    obj.name = obj.data.name = "base_avatar"
    armature.name = armature.data.name = "base_avatar_rig"
    obj.data.materials.clear()
    obj.data.materials.append(make_skin_material())
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.update()

    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    log("final mesh verts", len(obj.data.vertices), "tris", tris, "keys", len(obj.data.shape_keys.key_blocks) - 1)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    config.GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(config.GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_morph=True,
        export_morph_normal=True,
        export_try_sparse_sk=True,
        export_attributes=True,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,
        export_cameras=False,
        export_lights=False,
    )

    info = validate(tris)
    info.update({"landmarks": landmarks, "feet_shift_cm": feet_shift,
                 "macros": macros, "mpfb_targets": {n: s for n, s in config.CONTROLS}})
    config.BUILD_INFO_PATH.write_text(json.dumps(info, indent=2))
    log("wrote", config.GLB_PATH, f"{info['glb_bytes'] / 1024 / 1024:.2f} MB")


def validate(tris_blender):
    """Проверяем сам файл: лимиты, имена морфов, скелет, без Draco; затем обратный импорт."""
    size = config.GLB_PATH.stat().st_size
    body = glb.load_body(config.GLB_PATH)
    doc = body["doc"]
    problems = []
    if size > config.MAX_GLB_BYTES:
        problems.append(f"GLB is {size / 1024 / 1024:.2f} MB > 5 MB")
    used = set(doc.get("extensionsUsed", [])) | set(doc.get("extensionsRequired", []))
    if any("draco" in e.lower() for e in used):
        problems.append(f"Draco extension present: {used}")
    if list(body["morphs"].keys()) != config.KEY_NAMES:
        problems.append(f"morph names {list(body['morphs'].keys())}")
    if not body["joint_names"]:
        problems.append("no skin")
    wsum = body["weights"].sum(1)
    if np.abs(wsum - 1).max() > 0.01:
        problems.append(f"skin weights do not sum to 1 (min {wsum.min():.3f})")
    if body["underwear"] is None or not (body["underwear"] > 0).any():
        problems.append("underwear mask attribute _UNDERWEAR missing")
    if problems:
        raise RuntimeError("GLB check failed: " + "; ".join(problems))

    # обратный импорт штатным импортёром Blender
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(config.GLB_PATH))
    imported = [o for o in bpy.data.objects if o.type == "MESH"]
    names = [k.name for k in imported[0].data.shape_keys.key_blocks][1:]
    if names != config.KEY_NAMES:
        raise RuntimeError(f"re-import shape keys mismatch: {names}")

    log(f"GLB ok: {size / 1024 / 1024:.2f} MB, {len(body['positions'])} verts, {len(body['triangles'])} tris, "
        f"{len(body['joint_names'])} joints, {len(body['morphs'])} morphs, extensions {sorted(used) or 'none'}")
    return {"glb_bytes": size, "gltf_vertices": int(len(body["positions"])), "triangles": int(len(body["triangles"])),
            "blender_triangles": int(tris_blender), "joints": body["joint_names"], "morphs": list(body["morphs"].keys())}


if __name__ == "__main__":
    main()
