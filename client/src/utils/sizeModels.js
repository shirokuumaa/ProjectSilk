// client/src/utils/sizeModels.js
//
// Гибрид примерки, шаг 3 (research/patterns/README.md, «Решение по примерке»):
// у товара есть ткань, заранее просимулированная на нашей болванке в фигуре размера
// (product.sizeModels: [{ size, model3d, body }]). В браузере:
//   1. pickSizeModel — модель того размера, что покупатель надевает, или ближайшего;
//   2. transferToFigure — перенос ткани с фигуры симуляции на фигуру покупателя:
//      высоты — по ориентирам тела (кусочно-линейно), в сечении — тот же зазор
//      между тканью и телом в том же направлении; складки сохраняются;
//   3. pushOutOfBody — страховка: вершины, оказавшиеся внутри тела, — наружу на 4 мм,
//      остальное не трогаем. garmentDrape здесь не нужен (он для шаблонов без симуляции).
import * as THREE from 'three';
import { solveAvatar } from './avatarMorphs';
import { baseBodyShape } from './baseBody';
import { proceduralBodyShape } from './bodyShape';
import { bodySurface } from './bodySurface';

const GIRTHS = ['chest', 'waist', 'hips'];

/**
 * Как надевается просимулированная ткань. По умолчанию — перенос на фигуру покупателя и
 * страховка pushOutOfBody: складки симуляции не трогаются (garmentDrape делал из рукавов
 * «крылья»). Для сравнения в режиме разработки: ?simFit=drape — перенос и garmentDrape.
 */
export function simFitMode() {
  try {
    if (process.env.NODE_ENV !== 'development') return 'transfer';
    return new URLSearchParams(window.location.search).get('simFit') === 'drape' ? 'drape' : 'transfer';
  } catch {
    return 'transfer';
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

/** Плечевые отрезки рук формы (плечо → локоть, медианный радиус m1); стороны по порядку. */
function armSegments(shape) {
  return (shape.arms || []).map(({ a, b, m1 }, side) => ({ side, s0: a, s1: b, m: m1 }));
}

/** Ближайший отрезок руки: параметр t, точка на оси, расстояние; t вне [−0,1; 0,8] — не рука. */
function nearestArm(segs, p) {
  let best = null;
  segs.forEach((g) => {
    const e = [g.s1[0] - g.s0[0], g.s1[1] - g.s0[1], g.s1[2] - g.s0[2]];
    const len2 = e[0] ** 2 + e[1] ** 2 + e[2] ** 2 || 1e-12;
    const t = ((p[0] - g.s0[0]) * e[0] + (p[1] - g.s0[1]) * e[1] + (p[2] - g.s0[2]) * e[2]) / len2;
    if (t < -0.1 || t > 0.8) return;                    // у локтя — уже не рукав (локти у талии)
    const tc = Math.min(Math.max(t, 0), 1);
    const q = [g.s0[0] + e[0] * tc, g.s0[1] + e[1] * tc, g.s0[2] + e[2] * tc];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (!best || d - g.m < best.gap) best = { g, tc, q, d, gap: d - g.m };
  });
  return best;
}

const ARM_BLEND = 0.04; // ширина перехода «торс ↔ рука» по разнице зазоров, м

/**
 * Перенести ткань с фигуры from на фигуру to (обе — формы bodyShape).
 *  • торс и ноги: высота — по ориентирам; в сечении тот же зазор между тканью и телом в том
 *    же направлении — ткань у тела остаётся у тела, складка складкой;
 *  • рукава (ткань ближе к руке, чем к торсу): то же место вдоль руки покупателя и тот же
 *    зазор до её поверхности — рукав идёт за рукой, а не за торсом;
 *  • у подмышки — плавный переход между двумя правилами.
 * Меняет вершины на месте; корень вещи без собственного масштаба и сдвига.
 */
export function transferToFigure(root, from, to) {
  const mapY = heightMap(from, to);
  const regionOf = (shape, x, y) => (shape.kind === 'mesh' && y < shape.zone.low ? (x > 0 ? 'legL' : 'legR') : 'torso');
  const armsFrom = armSegments(from);
  const armsTo = armSegments(to);
  const withArms = armsFrom.length && armsFrom.length === armsTo.length;
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const p = [0, 0, 0];
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    if (!pos) return;
    inv.copy(child.matrixWorld).invert();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      p[0] = v.x; p[1] = v.y; p[2] = v.z;

      // торс / ноги
      const y1 = mapY(p[1]);
      const s0 = from.surfaceAt(p[1], p[0], p[2], regionOf(from, p[0], p[1]));
      const dx = p[0] - s0.cx;
      const dz = p[2] - s0.cz;
      const dist = Math.hypot(dx, dz);
      const region = regionOf(to, p[0], y1);
      const c1 = to.surfaceAt(y1, p[0], p[2], region);
      let tx = c1.cx;
      let tz = c1.cz;
      if (dist >= 1e-6) {
        const s1 = to.surfaceAt(y1, c1.cx + dx, c1.cz + dz, region);
        const k = Math.max(dist + (s1.r - s0.r), 0) / dist;
        tx = c1.cx + dx * k;
        tz = c1.cz + dz * k;
      }
      let nx = tx; let ny = y1; let nz = tz;

      // рукав: по руке покупателя
      // только плечевой отрезок выше талии: кисти и локти в A-позе — у бёдер, подол не рукав
      const arm = withArms && p[1] > from.landmarks.waist ? nearestArm(armsFrom, p) : null;
      if (arm) {
        const gapTorso = p[1] >= from.zone.low && p[1] <= from.zone.high ? dist - s0.r : Infinity;
        const w = Math.min(Math.max(0.5 + (gapTorso - arm.gap) / ARM_BLEND, 0), 1);
        if (w > 0) {
          const g1 = armsTo[armsFrom.indexOf(arm.g)];
          const e = [g1.s1[0] - g1.s0[0], g1.s1[1] - g1.s0[1], g1.s1[2] - g1.s0[2]];
          const q1 = [g1.s0[0] + e[0] * arm.tc, g1.s0[1] + e[1] * arm.tc, g1.s0[2] + e[2] * arm.tc];
          const u = [p[0] - arm.q[0], p[1] - arm.q[1], p[2] - arm.q[2]];
          const k = arm.d > 1e-6 ? Math.max(g1.m + arm.gap, 0) / arm.d : 0;
          const ax = q1[0] + u[0] * k; const ay = q1[1] + u[1] * k; const az = q1[2] + u[2] * k;
          nx += (ax - nx) * w; ny += (ay - ny) * w; nz += (az - nz) * w;
        }
      }

      v.set(nx, ny, nz).applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    computeSeamlessNormals(child.geometry);
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  });
}

/**
 * Нормали без видимых швов развёртки. У драпировки с выкройкой (scripts/garments/export_demo_drapes.py)
 * вершина на краю панели раздвоена — у каждой панели свои UV, — и computeVertexNormals считает нормаль
 * каждой копии только по её панели: шов виден как складка света. Копии стоят в одной точке (перенос и
 * страховка — функции только положения), поэтому их нормали усредняются по совпадающим координатам.
 */
export function computeSeamlessNormals(geometry) {
  geometry.computeVertexNormals();
  if (!geometry.attributes.uv) return;          // без развёртки вершины не раздвоены
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    const g = groups.get(key);
    if (g) g.push(i); else groups.set(key, [i]);
  }
  groups.forEach((ids) => {
    if (ids.length < 2) return;
    let x = 0; let y = 0; let z = 0;
    ids.forEach((i) => { x += nrm.getX(i); y += nrm.getY(i); z += nrm.getZ(i); });
    const len = Math.hypot(x, y, z) || 1;
    ids.forEach((i) => nrm.setXYZ(i, x / len, y / len, z / len));
  });
  nrm.needsUpdate = true;
}

/** Зазор, на который страховка выносит ткань из тела, м (3–5 мм). */
export const SKIN_GAP = 0.004;

/** Поверхность фигуры для проверки «внутри тела» (строится один раз на форму). */
function surfaceOf(shape) {
  if (!shape.mesh) return null;
  if (!shape.__surface) shape.__surface = bodySurface(shape.mesh.positions, shape.mesh.index);
  return shape.__surface;
}

/**
 * Насколько точка внутри тела (м; > 0 — внутри) и куда её вынести, чтобы оказаться на gap
 * снаружи. Болванка — по настоящей поверхности меша; процедурное тело — по сечениям торса.
 */
function insideBody(shape, p, gap, out) {
  out.depth = 0;
  const surface = surfaceOf(shape);
  if (surface) {
    const q = surface.query(p, out.q || (out.q = {}));
    if (q && q.distance < 0) {
      out.depth = -q.distance;
      const move = gap - q.distance;
      out.x = p[0] + q.normal[0] * move;
      out.y = p[1] + q.normal[1] * move;
      out.z = p[2] + q.normal[2] * move;
    }
    return out.depth > 0;
  }
  if (p[1] < shape.zone.low || p[1] > shape.zone.high) return false;
  const s = shape.surfaceAt(p[1], p[0], p[2]);
  const dx = p[0] - s.cx;
  const dz = p[2] - s.cz;
  const d = Math.hypot(dx, dz);
  if (d < s.r && d > 1e-6) {
    out.depth = s.r - d;
    out.x = s.cx + (dx * (s.r + gap)) / d;
    out.y = p[1];
    out.z = s.cz + (dz * (s.r + gap)) / d;
  }
  return out.depth > 0;
}

/** Сколько вершин ткани внутри тела (глубже tolerance). */
export function countInsideBody(root, shape, tolerance = 1e-4) {
  let n = 0;
  const hit = {};
  forEachWorldVertex(root, (p) => {
    if (insideBody(shape, p, 0, hit) && hit.depth > tolerance) n++;
    return false;
  });
  return n;
}

/**
 * Страховка после переноса: вершины ткани внутри тела выносятся наружу на gap (4 мм) по
 * нормали тела; остальные не меняются. Возвращает, сколько вершин вынесено.
 */
export function pushOutOfBody(root, shape, gap = SKIN_GAP) {
  let pushed = 0;
  const hit = {};
  forEachWorldVertex(root, (p) => {
    let moved = false;
    // до пяти шагов: у сгиба (подмышка, пах) и между пальцами вынесенная вершина может задеть соседнюю
    // часть тела (край широкого рукава жакета L на кисти фигуры S выходит только за 4 шага)
    for (let step = 0; step < 5 && insideBody(shape, p, gap, hit); step++) {
      p[0] = hit.x; p[1] = hit.y; p[2] = hit.z;
      moved = true;
    }
    if (moved) pushed++;
    return moved;
  });
  return pushed;
}

/** Обход вершин в мировых координатах; fn вернул true — вершина изменена (p). */
function forEachWorldVertex(root, fn) {
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const p = [0, 0, 0];
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    if (!pos) return;
    inv.copy(child.matrixWorld).invert();
    let changed = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      p[0] = v.x; p[1] = v.y; p[2] = v.z;
      if (fn(p)) {
        v.set(p[0], p[1], p[2]).applyMatrix4(inv);
        pos.setXYZ(i, v.x, v.y, v.z);
        changed = true;
      }
    }
    if (changed) {
      pos.needsUpdate = true;
      computeSeamlessNormals(child.geometry);
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
  });
}
