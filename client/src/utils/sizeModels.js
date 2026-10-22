// client/src/utils/sizeModels.js
//
// Гибрид примерки, шаг 3 (research/patterns/README.md, «Решение по примерке»):
// у товара есть ткань, заранее просимулированная на нашей болванке в фигуре размера
// (product.sizeModels: [{ size, model3d, body }]). В браузере:
//   1. pickSizeModel — модель того размера, что покупатель надевает, или ближайшего;
//   2. transferToFigure — перенос ткани с фигуры симуляции на фигуру покупателя:
//      высоты — по ориентирам тела (кусочно-линейно), в сечении — тот же зазор
//      между тканью и телом в том же направлении; складки сохраняются;
//   3. дальше — та же подгонка по обмерам, что у всех вещей (garmentDrape).
import * as THREE from 'three';
import { solveAvatar } from './avatarMorphs';
import { baseBodyShape } from './baseBody';
import { proceduralBodyShape } from './bodyShape';

const GIRTHS = ['chest', 'waist', 'hips'];

/**
 * Для сравнения в режиме разработки: ?simFit=transfer — только перенос ткани на фигуру,
 * без подгонки garmentDrape. По умолчанию (и в продакшне) — перенос и подгонка.
 */
export function simFitMode() {
  try {
    if (process.env.NODE_ENV !== 'development') return 'drape';
    return new URLSearchParams(window.location.search).get('simFit') === 'transfer' ? 'transfer' : 'drape';
  } catch {
    return 'drape';
  }
}

/**
 * Модель для размера sizeRow: того же размера, иначе ближайшего по обхватам сетки
 * (при равенстве — больший: свободнее, чем тесно). Без sizeRow — первая.
 * @returns {{ size, model3d, body } | null}
 */
export function pickSizeModel(product, sizeRow) {
  const models = product?.sizeModels;
  if (!Array.isArray(models) || !models.length) return null;
  if (!sizeRow) return models[0];
  const exact = models.find((m) => m.size === sizeRow.size);
  if (exact) return exact;

  const chart = product.sizeChart || [];
  const order = (size) => chart.findIndex((r) => r.size === size);
  const rowOf = (size) => chart.find((r) => r.size === size) || {};
  const distance = (m) => {
    const row = rowOf(m.size);
    const keys = GIRTHS.filter((k) => Number(row[k]) > 0 && Number(sizeRow[k]) > 0);
    if (keys.length) return keys.reduce((s, k) => s + Math.abs(row[k] - sizeRow[k]), 0);
    return Math.abs(order(m.size) - order(sizeRow.size));   // нет обхватов — по порядку в сетке
  };
  return models.reduce((best, m) => {
    const d = distance(m);
    const b = distance(best);
    if (d < b - 1e-9) return m;
    if (Math.abs(d - b) <= 1e-9 && order(m.size) > order(best.size)) return m;
    return best;
  });
}

/**
 * Форма тела фигуры, на которой считалась ткань: та же болванка, если у покупателя
 * болванка, иначе процедурное тело (покупатель вне калиброванного диапазона).
 */
export function figureShape(figure, avatar) {
  if (avatar?.kind === 'base' && avatar.body) {
    const solution = solveAvatar(figure);
    if (solution.inRange) return baseBodyShape(avatar.body, solution);
  }
  return proceduralBodyShape(figure);
}

const KNOTS = ['ankle', 'knee', 'thighTop', 'hips', 'waist', 'chest', 'shoulder', 'neck', 'headTop'];

/** Кусочно-линейное отображение высот: пол и ориентиры фигуры симуляции → покупателя. */
export function heightMap(from, to) {
  const a = [0];
  const b = [0];
  KNOTS.forEach((k) => {
    const y0 = from.landmarks?.[k];
    const y1 = to.landmarks?.[k];
    if (!(y0 > a[a.length - 1]) || !(y1 > b[b.length - 1])) return; // только по возрастанию
    a.push(y0);
    b.push(y1);
  });
  return (y) => {
    if (y <= a[0]) return y;
    for (let i = 1; i < a.length; i++) {
      if (y <= a[i]) return b[i - 1] + ((y - a[i - 1]) / (a[i] - a[i - 1])) * (b[i] - b[i - 1]);
    }
    return b[b.length - 1] + (y - a[a.length - 1]) * (b[b.length - 1] / a[a.length - 1]);
  };
}

/**
 * Перенести ткань с фигуры from на фигуру to (обе — формы bodyShape).
 * Высота — по ориентирам; в сечении сохраняется зазор между тканью и телом в том же
 * направлении: ткань у тела остаётся у тела, складка — складкой, а рукав и подол
 * следуют за шириной плеч и бёдер покупателя.
 * Меняет вершины на месте; корень вещи без собственного масштаба и сдвига.
 */
export function transferToFigure(root, from, to) {
  const mapY = heightMap(from, to);
  const regionOf = (shape, y) => (shape.kind === 'mesh' && y < shape.zone.low ? 'legs' : 'torso');
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    if (!pos) return;
    inv.copy(child.matrixWorld).invert();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      const y1 = mapY(v.y);
      const s0 = from.surfaceAt(v.y, v.x, v.z, regionOf(from, v.y));
      const dx = v.x - s0.cx;
      const dz = v.z - s0.cz;
      const dist = Math.hypot(dx, dz);
      const region = regionOf(to, y1);
      const c1 = to.surfaceAt(y1, v.x, v.z, region);                  // центр сечения покупателя
      if (dist < 1e-6) {
        v.set(c1.cx, y1, c1.cz);
      } else {
        const s1 = to.surfaceAt(y1, c1.cx + dx, c1.cz + dz, region);   // радиус в том же направлении
        const k = Math.max(dist + (s1.r - s0.r), 0) / dist;
        v.set(c1.cx + dx * k, y1, c1.cz + dz * k);
      }
      v.applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    child.geometry.computeVertexNormals();
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  });
}
