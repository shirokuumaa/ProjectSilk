// client/src/utils/testing/readGlb.js
//
// Чтение GLB без GLTFLoader — для тестов и прогонов подгонки в Node/Jest
// (GLTFLoader — ES-модуль из node_modules, Jest его не транспилирует).
// Аналог scripts/avatar/glb.py.

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// в jsdom (Jest) нет TextDecoder — там есть Buffer из Node
const utf8 = (bytes) => (typeof TextDecoder !== 'undefined'
  ? new TextDecoder().decode(bytes)
  : Buffer.from(bytes).toString('utf8'));

export function readGlb(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  let doc = null;
  let bin = null;
  while (offset < view.byteLength) {
    const size = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (kind === 0x4e4f534a) doc = JSON.parse(utf8(chunk));
    else if (kind === 0x004e4942) bin = chunk;
    offset += 8 + size;
  }

  const read = (viewIndex, byteOffset, Type, count, width) => {
    const bv = doc.bufferViews[viewIndex];
    const start = (bv.byteOffset || 0) + byteOffset;
    const item = Type.BYTES_PER_ELEMENT * width;
    const stride = bv.byteStride || item;
    const out = new Type(count * width);
    const dv = new DataView(bin.buffer, bin.byteOffset);
    const get = {
      Int8Array: (o) => dv.getInt8(o), Uint8Array: (o) => dv.getUint8(o),
      Int16Array: (o) => dv.getInt16(o, true), Uint16Array: (o) => dv.getUint16(o, true),
      Uint32Array: (o) => dv.getUint32(o, true), Float32Array: (o) => dv.getFloat32(o, true),
    }[Type.name];
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < width; c++) out[i * width + c] = get(start + i * stride + c * Type.BYTES_PER_ELEMENT);
    }
    return out;
  };

  const accessor = (index) => {
    const acc = doc.accessors[index];
    const Type = COMPONENT[acc.componentType];
    const width = WIDTH[acc.type];
    const out = acc.bufferView != null
      ? read(acc.bufferView, acc.byteOffset || 0, Type, acc.count, width)
      : new Type(acc.count * width);
    if (acc.sparse) {
      const s = acc.sparse;
      const ids = read(s.indices.bufferView, s.indices.byteOffset || 0, COMPONENT[s.indices.componentType], s.count, 1);
      const vals = read(s.values.bufferView, s.values.byteOffset || 0, Type, s.count, width);
      for (let i = 0; i < s.count; i++) for (let c = 0; c < width; c++) out[ids[i] * width + c] = vals[i * width + c];
    }
    if (acc.normalized && Type !== Float32Array) {
      const max = Type === Uint8Array ? 255 : 65535;
      return Float32Array.from(out, (v) => v / max);
    }
    return out;
  };

  return { doc, accessor };
}

/** Болванка: первый skinned-меш (один примитив). */
export function readBaseBody(buffer) {
  const { doc, accessor } = readGlb(buffer);
  const mesh = doc.meshes[0];
  const prim = mesh.primitives[0];
  const names = mesh.extras?.targetNames || [];
  const morphs = {};
  names.forEach((name, i) => { morphs[name] = accessor(prim.targets[i].POSITION); });
  const skin = doc.skins[0];
  return {
    positions: accessor(prim.attributes.POSITION),
    morphs,
    index: accessor(prim.indices),
    skinIndex: accessor(prim.attributes.JOINTS_0),
    skinWeight: accessor(prim.attributes.WEIGHTS_0),
    boneNames: skin.joints.map((j) => doc.nodes[j].name),
  };
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Все меши сцены в мировых координатах: [{ positions, index, uv, extras }] (как отдаёт GLTFLoader после updateMatrixWorld). */
export function readMeshes(buffer) {
  const { doc, accessor } = readGlb(buffer);
  const out = [];
  const walk = (nodeIndex, parent) => {
    const node = doc.nodes[nodeIndex];
    const m = multiply(parent, nodeMatrix(node));
    if (node.mesh != null) {
      doc.meshes[node.mesh].primitives.forEach((prim) => {
        const p = accessor(prim.attributes.POSITION);
        const world = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 3) {
          for (let r = 0; r < 3; r++) world[i + r] = m[r] * p[i] + m[4 + r] * p[i + 1] + m[8 + r] * p[i + 2] + m[12 + r];
        }
        out.push({
          positions: world,
          index: prim.indices != null ? accessor(prim.indices) : null,
          uv: prim.attributes.TEXCOORD_0 != null ? accessor(prim.attributes.TEXCOORD_0) : null,
          extras: doc.meshes[node.mesh].extras || {},
        });
      });
    }
    (node.children || []).forEach((c) => walk(c, m));
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  (doc.scenes[doc.scene || 0].nodes || []).forEach((n) => walk(n, identity));
  return out;
}
