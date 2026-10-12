# scripts/avatar/glb.py
#
# Минимальное чтение GLB в numpy: позиции, треугольники, морфы, веса.
# Читаем сам файл, а не импорт Blender, чтобы номера вершин совпадали
# с тем, что увидит three.js в браузере.

import json
import struct
from pathlib import Path

import numpy as np

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_chunks(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError(f"{path}: not a glTF 2.0 binary")
    doc, binary, offset = None, b"", 12
    while offset < length:
        size, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + size]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + size
    return doc, binary


def _view(doc, binary, view_index, byte_offset, dtype, count, width):
    view = doc["bufferViews"][view_index]
    start = view.get("byteOffset", 0) + byte_offset
    item = np.dtype(dtype).itemsize * width
    stride = view.get("byteStride", item)
    if stride == item:
        arr = np.frombuffer(binary, dtype=dtype, count=count * width, offset=start)
        return arr.reshape(count, width) if width > 1 else arr
    rows = [np.frombuffer(binary, dtype=dtype, count=width, offset=start + i * stride) for i in range(count)]
    return np.array(rows)


def accessor(doc, binary, index):
    acc = doc["accessors"][index]
    dtype, width, count = _COMPONENT[acc["componentType"]], _WIDTH[acc["type"]], acc["count"]
    if "bufferView" in acc:
        out = np.array(_view(doc, binary, acc["bufferView"], acc.get("byteOffset", 0), dtype, count, width))
    else:
        out = np.zeros((count, width) if width > 1 else count, dtype=dtype)
    sparse = acc.get("sparse")
    if sparse:
        idx = sparse["indices"]
        ids = _view(doc, binary, idx["bufferView"], idx.get("byteOffset", 0), _COMPONENT[idx["componentType"]], sparse["count"], 1)
        val = sparse["values"]
        vals = _view(doc, binary, val["bufferView"], val.get("byteOffset", 0), dtype, sparse["count"], width)
        out[ids.astype(np.int64)] = vals
    if acc.get("normalized") and dtype in (np.uint8, np.uint16):
        out = out.astype(np.float32) / np.iinfo(dtype).max
    return out


def load_body(path):
    """Единственный skinned-меш болванки: всё в системе координат glTF (Y вверх, метры)."""
    doc, binary = read_chunks(path)
    meshes = doc["meshes"]
    if len(meshes) != 1:
        raise ValueError(f"expected one mesh, got {len(meshes)}")
    mesh = meshes[0]
    names = mesh.get("extras", {}).get("targetNames", [])

    positions, triangles, joints, weights, underwear = [], [], [], [], []
    morphs = {name: [] for name in names}
    base = 0
    for prim in mesh["primitives"]:
        pos = accessor(doc, binary, prim["attributes"]["POSITION"]).astype(np.float64)
        positions.append(pos)
        tri = accessor(doc, binary, prim["indices"]).astype(np.int64).reshape(-1, 3)
        triangles.append(tri + base)
        if "JOINTS_0" in prim["attributes"]:
            joints.append(accessor(doc, binary, prim["attributes"]["JOINTS_0"]).astype(np.int64))
            weights.append(accessor(doc, binary, prim["attributes"]["WEIGHTS_0"]).astype(np.float64))
        if "_UNDERWEAR" in prim["attributes"]:
            underwear.append(accessor(doc, binary, prim["attributes"]["_UNDERWEAR"]).astype(np.float64).reshape(-1))
        for name, target in zip(names, prim.get("targets", [])):
            morphs[name].append(accessor(doc, binary, target["POSITION"]).astype(np.float64))
        base += len(pos)

    skin = doc["skins"][0] if doc.get("skins") else None
    joint_names = [doc["nodes"][j].get("name", str(j)) for j in skin["joints"]] if skin else []

    return {
        "doc": doc,
        "positions": np.concatenate(positions),
        "triangles": np.concatenate(triangles),
        "morphs": {name: np.concatenate(parts) for name, parts in morphs.items()},
        "joints": np.concatenate(joints) if joints else None,
        "weights": np.concatenate(weights) if weights else None,
        "underwear": np.concatenate(underwear) if underwear else None,
        "joint_names": joint_names,
    }
