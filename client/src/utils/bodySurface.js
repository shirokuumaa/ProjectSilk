// client/src/utils/bodySurface.js
//
// Знаковое расстояние до настоящей поверхности болванки: ближайшая вершина тела и её
// нормаль (сетка с шагом 2 см). Меш плотный (вершины в 1–2 см друг от друга), поэтому
// точность — несколько миллиметров; на гладких местах — лучше.
// Нужно там, где сечения и капсулы рук слишком грубы: «внутри ли тела вершина ткани».
//   distance < 0 — внутри тела, > 0 — снаружи; normal — куда выносить.

const CELL = 0.02;
const MAX_RING = 3;              // ищем ближайшую вершину не дальше ~6 см

export function bodySurface(positions, index) {
  const n = positions.length / 3;
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = 3 * index[t]; const b = 3 * index[t + 1]; const c = 3 * index[t + 2];
    const ux = positions[b] - positions[a]; const uy = positions[b + 1] - positions[a + 1]; const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a]; const vy = positions[c + 1] - positions[a + 1]; const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx; // ∝ площади
    [a, b, c].forEach((k) => { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; });
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]) || 1;
    normals[3 * i] /= l; normals[3 * i + 1] /= l; normals[3 * i + 2] /= l;
  }

  const cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(positions[3 * i] / CELL), Math.floor(positions[3 * i + 1] / CELL), Math.floor(positions[3 * i + 2] / CELL));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }

  /** Ближайшая вершина тела к p: { distance (со знаком), normal, near } или null — тело далеко. */
  function query(p, out = {}) {
    const cx = Math.floor(p[0] / CELL); const cy = Math.floor(p[1] / CELL); const cz = Math.floor(p[2] / CELL);
    let best = -1;
    let bestD2 = Infinity;
    for (let ring = 1; ring <= MAX_RING && best < 0; ring++) {
      for (let x = cx - ring; x <= cx + ring; x++) {
        for (let y = cy - ring; y <= cy + ring; y++) {
          for (let z = cz - ring; z <= cz + ring; z++) {
            const list = cells.get(key(x, y, z));
            if (!list) continue;
            for (let j = 0; j < list.length; j++) {
              const i = list[j];
              const d2 = (p[0] - positions[3 * i]) ** 2 + (p[1] - positions[3 * i + 1]) ** 2 + (p[2] - positions[3 * i + 2]) ** 2;
              if (d2 < bestD2) { bestD2 = d2; best = i; }
            }
          }
        }
      }
    }
    if (best < 0) return null;
    out.normal = [normals[3 * best], normals[3 * best + 1], normals[3 * best + 2]];
    out.distance = (p[0] - positions[3 * best]) * out.normal[0]
      + (p[1] - positions[3 * best + 1]) * out.normal[1]
      + (p[2] - positions[3 * best + 2]) * out.normal[2];
    out.near = Math.sqrt(bestD2);
    return out;
  }

  return { query };
}
