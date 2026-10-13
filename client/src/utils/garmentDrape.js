// client/src/utils/garmentDrape.js
//
// Прижатие одежды к телу (аналог shrinkwrap, но без Blender).
//
// Тело задаётся «формой» (utils/bodyShape.js): для любой высоты и направления
// известен радиус тела. Два тела:
//   • процедурное BodyAvatar (proceduralBodyShape) — эллипсы из обмеров;
//   • болванка base_avatar.glb (meshBodyShape) — сечения настоящего меша.
// Для совместимости вторым аргументом можно передать профиль обмеров —
// тогда тело процедурное и поведение прежнее.
//
// Без выбранного размера и на процедурном теле работает прежний алгоритм
// (проверяется регрессионным тестом garmentDrape.test.js). С размером или на
// болванке — подгонка по размеру:
//   • таблица размеров — обмеры фигуры, на которую сшит размер; вещь шире на
//     припуск кроя (EASE_BY_FIT). Целевой радиус ткани = радиус тела ×
//     (обхват размера / обхват тела) + припуск, но не ближе толщины ткани:
//     меньший размер ложится на кожу, больший отстоит — разница видна глазом;
//   • ткань всегда выталкивается из тела, а подтягивается только в поясе
//     посадки (верх: бёдра → грудь, низ: пах → талия); ниже пояса ткань
//     свисает: подол сдвигается вслед за нижним краем пояса, крой сохраняется;
//   • редкая сетка: плоский треугольник между вершинами срезает изгиб тела,
//     поэтому проверяются и середины длинных рёбер;
//   • вершины рукава (ближе к руке, чем к торсу) к торсу не тянутся;
//   • ниже паха брюки идут по каждой ноге отдельно, юбки и платья — по общей
//     оболочке ног (определяется по геометрии вещи или подсказке legs);
//   • рукава выталкиваются из капсул рук, к руке не поворачиваются (этап B2).

import * as THREE from 'three';
import { proceduralBodyShape, _internal as shapeInternal } from './bodyShape';

/**
 * Зазор между телом и тканью по типу вещи (в метрах).
 * Свободная вещь висит дальше от тела, облегающая — ближе.
 * При подгонке по размеру это припуск кроя: обхват вещи ≈ обхват размера + 2π·припуск.
 */
const EASE_BY_FIT = {
  tight: 0.004,
  regular: 0.010,
  loose: 0.022,
};

const LAYER_STEP = 0.008; // каждый следующий слой дальше от тела

const BAND_FADE = 0.04;   // плавный выход из пояса посадки, м
const FABRIC_GAP = 0.003; // толщина ткани: ближе к коже вершина не встаёт, м
const SLEEVE_REACH = 0.08; // дальше от поверхности руки — уже не рукав, м
const SLEEVE_HUG = 0.02;  // со стороны торса рукав облегает руку не дальше этого, м
const SLEEVED = ['top', 'dress', 'outerwear'];   // у низа рукавов нет
const HANG_BINS = 36;     // направлений вокруг тела для свисания ниже пояса
const MIN_EDGE2 = 0.015 ** 2; // рёбра короче 1,5 см серединой не проверяем: стрелка меньше миллиметра
const DEFICIT_MAX = 0.015; // предел выталкивания по серединам рёбер, м
const BODY_CURVE = 0.03;  // самый крутой изгиб тела поперёк (грудь, икра), радиус, м

// ── прежний алгоритм (процедурное тело без размера) ─────────────

function drapeLegacy(garmentRoot, shape, { gap, pullStrength }) {
  const yLow = shape.zone.low;
  const yHigh = shape.zone.high;

  let pushed = 0;
  let pulled = 0;
  let total = 0;

  const worldPos = new THREE.Vector3();
  const localPos = new THREE.Vector3();

  garmentRoot.updateWorldMatrix(true, true);

  garmentRoot.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;

    const geo = child.geometry;
    const pos = geo.attributes.position;
    const inv = new THREE.Matrix4().copy(child.matrixWorld).invert();

    for (let i = 0; i < pos.count; i++) {
      localPos.fromBufferAttribute(pos, i);
      worldPos.copy(localPos).applyMatrix4(child.matrixWorld);
      total++;

      // вне зоны прижатия — оставляем как есть
      if (worldPos.y < yLow || worldPos.y > yHigh) continue;

      const dist = Math.hypot(worldPos.x, worldPos.z);
      if (dist < 1e-5) continue;

      const bodyR = shape.surfaceAt(worldPos.y, worldPos.x, worldPos.z).r;
      const targetR = bodyR + gap;

      let newR = null;

      if (dist < targetR) {
        // ткань провалилась внутрь тела — выталкиваем
        newR = targetR;
        pushed++;
      } else if (dist > targetR * 1.35) {
        // висит слишком далеко — подтягиваем, но не до конца
        newR = dist + (targetR - dist) * pullStrength;
        pulled++;
      }

      if (newR != null) {
        const k = newR / dist;
        worldPos.x *= k;
        worldPos.z *= k;
        localPos.copy(worldPos).applyMatrix4(inv);
        pos.setXYZ(i, localPos.x, localPos.y, localPos.z);
      }
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  });

  return { total, pushed, pulled, gap };
}

// ── подгонка по размеру ────────────────────────────────────────

/** Отношение «обхват размера / обхват тела» по высоте: линейно между грудью, талией и бёдрами. */
function sizeRatio(shape, size) {
  const L = shape.levels;
  const pts = [];
  [['hips', L.hips], ['waist', L.waist], ['chest', L.chest]].forEach(([key, y]) => {
    const g = Number(size?.[key]);
    if (g > 0) pts.push([y, g / 100 / shape.girthAt(y)]);
  });
  if (!pts.length) return () => 1;
  pts.sort((a, b) => a[0] - b[0]);
  return (y) => {
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
      if (y <= pts[i + 1][0]) {
        const t = (y - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  };
}

/** Пояс посадки: [lo, hi] — ткань подтягивается к размеру; выше hi — плавный выход. */
function fittedBand(shape, garmentType) {
  const L = shape.levels;
  const [lo, hi] = garmentType === 'bottom'
    ? [L.crotch, L.waist + 0.02]
    : [L.hips - 0.03, L.chest + 0.03];
  const weight = (y) => (y <= hi ? 1 : Math.max(0, 1 - (y - hi) / BAND_FADE));
  return { lo, hi, weight };
}

/**
 * Свисание ниже пояса посадки: ткань висит от бёдер, поэтому подол сдвигается
 * на столько же, на сколько сдвинулся нижний край пояса (по направлениям вокруг
 * тела). Крой сохраняется: карандаш остаётся карандашом, клёш — клёшем; больший
 * размер отстоит от тела по всей длине, а не только в поясе.
 */
function hangShift(meshes, shape, lo, targetAt) {
  const c = shape.surfaceAt(lo, 1, 0, 'torso');
  const sum = new Float64Array(HANG_BINS);
  const cnt = new Uint32Array(HANG_BINS);
  const binOf = (dx, dz) => {
    let a = Math.atan2(dz, dx);
    if (a < 0) a += Math.PI * 2;
    return Math.min(HANG_BINS - 1, Math.floor((a / (Math.PI * 2)) * HANG_BINS));
  };
  meshes.forEach(({ world }) => {
    for (let i = 0; i < world.length; i += 3) {
      if (Math.abs(world[i + 1] - lo) > 0.015) continue;
      const dx = world[i] - c.cx;
      const dz = world[i + 2] - c.cz;
      const b = binOf(dx, dz);
      sum[b] += Math.sqrt(dx * dx + dz * dz);
      cnt[b]++;
    }
  });
  const filled = [];
  const delta = new Float32Array(HANG_BINS);
  for (let b = 0; b < HANG_BINS; b++) {
    if (!cnt[b]) continue;
    const a = ((b + 0.5) / HANG_BINS) * Math.PI * 2;
    const s = shape.surfaceAt(lo, c.cx + Math.cos(a), c.cz + Math.sin(a), 'torso');
    delta[b] = targetAt(lo, s) - sum[b] / cnt[b];
    filled.push(b);
  }
  if (!filled.length) return null;
  // пустые направления — между соседними заполненными
  for (let b = 0; b < HANG_BINS; b++) {
    if (cnt[b]) continue;
    let prev = filled[filled.length - 1];
    let next = filled[0];
    filled.forEach((f) => { if (f < b) prev = f; });
    for (let k = filled.length - 1; k >= 0; k--) if (filled[k] > b) next = filled[k];
    const span = (next - prev + HANG_BINS) % HANG_BINS || HANG_BINS;
    const t = ((b - prev + HANG_BINS) % HANG_BINS) / span;
    delta[b] = delta[prev] + (delta[next] - delta[prev]) * t;
  }
  return {
    apply(p) {
      const dx = p[0] - c.cx;
      const dz = p[2] - c.cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1e-5) return;
      // между центрами соседних направлений — линейно
      let a = Math.atan2(dz, dx);
      if (a < 0) a += Math.PI * 2;
      const g = (a / (Math.PI * 2)) * HANG_BINS - 0.5;
      const k0 = (Math.floor(g) + HANG_BINS) % HANG_BINS;
      const k1 = (k0 + 1) % HANG_BINS;
      const t = g - Math.floor(g);
      const d = delta[k0] + (delta[k1] - delta[k0]) * t;
      const k = Math.max(0, dist + d) / dist;
      p[0] = c.cx + dx * k;
      p[2] = c.cz + dz * k;
    },
  };
}

/**
 * Брюки или юбка — по геометрии самой вещи (без опоры на тело: посадка может
 * растянуть вещь). Режем вещь горизонтальными плоскостями: у юбки и платья
 * сечение — петля вокруг обеих ног, она обязательно пересекает середину
 * (x = 0) спереди и сзади; у брюк ниже шагового шва две отдельные штанины,
 * ни один отрезок сечения середину не пересекает.
 */
function detectLegs(meshes) {
  let ymin = Infinity;
  let ymax = -Infinity;
  meshes.forEach(({ world }) => {
    for (let i = 1; i < world.length; i += 3) { ymin = Math.min(ymin, world[i]); ymax = Math.max(ymax, world[i]); }
  });
  const height = ymax - ymin;
  if (!(height > 0)) return null;
  const EPS = 1e-4;
  const levels = [];
  for (let f = 0.3; f <= 0.95 + 1e-9; f += 0.05) levels.push(ymax - height * f);
  const left = new Uint32Array(levels.length);
  const right = new Uint32Array(levels.length);
  const crosses = new Uint32Array(levels.length);
  meshes.forEach(({ world, index }) => {
    const triCount = index ? index.length / 3 : world.length / 9;
    for (let t = 0; t < triCount; t++) {
      const a = index ? index[3 * t] : 3 * t;
      const b = index ? index[3 * t + 1] : 3 * t + 1;
      const c = index ? index[3 * t + 2] : 3 * t + 2;
      const ya = world[3 * a + 1]; const yb = world[3 * b + 1]; const yc = world[3 * c + 1];
      const yLo = ya < yb ? (ya < yc ? ya : yc) : (yb < yc ? yb : yc);
      const yHi = ya > yb ? (ya > yc ? ya : yc) : (yb > yc ? yb : yc);
      for (let k = 0; k < levels.length; k++) {
        const y = levels[k];
        if (y < yLo || y > yHi || yLo === yHi) continue;
        // x точек, где плоскость пересекает рёбра треугольника
        let lo = Infinity;
        let hi = -Infinity;
        if ((ya - y) * (yb - y) <= 0 && ya !== yb) { const x = world[3 * a] + (world[3 * b] - world[3 * a]) * ((y - ya) / (yb - ya)); if (x < lo) lo = x; if (x > hi) hi = x; }
        if ((yb - y) * (yc - y) <= 0 && yb !== yc) { const x = world[3 * b] + (world[3 * c] - world[3 * b]) * ((y - yb) / (yc - yb)); if (x < lo) lo = x; if (x > hi) hi = x; }
        if ((yc - y) * (ya - y) <= 0 && yc !== ya) { const x = world[3 * c] + (world[3 * a] - world[3 * c]) * ((y - yc) / (ya - yc)); if (x < lo) lo = x; if (x > hi) hi = x; }
        if (lo === Infinity) continue;
        if (lo <= EPS && hi >= -EPS) crosses[k]++;
        else if (lo > 0) left[k]++;
        else right[k]++;
      }
    }
  });
  for (let k = 0; k < levels.length; k++) {
    if (left[k] > 2 && right[k] > 2 && crosses[k] === 0) return 'split';
  }
  return 'joined';
}

function drapeFitted(garmentRoot, shape, opts) {
  const { layer, size, garmentType = 'top', fit = 'regular', legs: legsHint } = opts;
  const ratio = sizeRatio(shape, size);
  // с размером припуск кроя прибавляется к обхвату размера, а у кожи — только
  // толщина ткани; без размера (болванка, вещь без таблицы) — прежний зазор
  const ease = (EASE_BY_FIT[fit] ?? EASE_BY_FIT.regular);
  const gap = (size ? FABRIC_GAP : ease) + layer * LAYER_STEP;
  const layerGap = layer * LAYER_STEP;
  const band = fittedBand(shape, garmentType);
  const L = shape.levels;
  const zone = shape.zone;
  const sleeved = SLEEVED.includes(garmentType);
  const targetAt = (y, s) => Math.max(s.r + gap, s.r * ratio(y) + ease + layerGap);

  garmentRoot.updateWorldMatrix(true, true);
  const meshes = [];
  garmentRoot.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const pos = child.geometry.attributes.position;
    const world = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      world[3 * i] = v.x; world[3 * i + 1] = v.y; world[3 * i + 2] = v.z;
    }
    meshes.push({
      child, world, index: child.geometry.index?.array,
      sleeve: new Uint8Array(pos.count), moved: new Uint8Array(pos.count),
      clearance: new Float32Array(pos.count).fill(Infinity),
    });
  });

  // ноги есть только у низа и платья; подсказка товара важнее геометрии. Ответ по
  // геометрии запоминается на вещи: от масштаба и сдвига посадки он не зависит
  let legs = null;
  if (['bottom', 'dress'].includes(garmentType)) {
    if (legsHint === 'split' || legsHint === 'joined') legs = legsHint;
    else {
      if (garmentRoot.userData.__legs === undefined) garmentRoot.userData.__legs = detectLegs(meshes);
      legs = garmentRoot.userData.__legs;
    }
  }
  const legsMesh = legs && shape.kind === 'mesh';
  const hang = legs === 'split' ? null : hangShift(meshes, shape, band.lo, targetAt);
  const hipsRatio = ratio(L.hips);
  let total = 0;
  let pushed = 0;
  let pulled = 0;

  // область тела для точки: торс, своя нога (брюки), обе ноги (юбка) или никакая
  const regionOf = (x, y) => {
    if (y >= zone.low && y <= zone.high) return 'torso';
    if (y < zone.low && legsMesh) return legs === 'split' ? (x > 0 ? 'legL' : 'legR') : 'legs';
    return null;
  };

  // отрезки рук (плечо → локоть, локоть → запястье) с габаритами: большинство
  // вершин отсеиваются по габариту без расчёта расстояний
  const armSegs = [];
  shape.arms.forEach(({ a, b, c, r1, r2, m1 = r1, m2 = r2 }) => {
    [[a, b, r1, m1, true], [b, c, r2, m2, false]].forEach(([s0, s1, r, m, upper]) => {
      const reach = m + SLEEVE_REACH;
      const box = [0, 1, 2].map((k) => Math.min(s0[k], s1[k]) - reach)
        .concat([0, 1, 2].map((k) => Math.max(s0[k], s1[k]) + reach));
      const len2 = (s1[0] - s0[0]) ** 2 + (s1[1] - s0[1]) ** 2 + (s1[2] - s0[2]) ** 2 || 1e-12;
      armSegs.push({ s0, s1, r, m, box, len2, upper });
    });
  });

  // ближайший отрезок руки: расстояние до поверхности руки (по медиане) и точка на оси
  const near = { seg: null, d: 0, t: 0, qx: 0, qy: 0, qz: 0 };
  const nearestArm = (p) => {
    near.seg = null;
    let best = Infinity;
    for (let a = 0; a < armSegs.length; a++) {
      const seg = armSegs[a];
      const box = seg.box;
      if (p[0] < box[0] || p[0] > box[3] || p[1] < box[1] || p[1] > box[4] || p[2] < box[2] || p[2] > box[5]) continue;
      const ex = seg.s1[0] - seg.s0[0]; const ey = seg.s1[1] - seg.s0[1]; const ez = seg.s1[2] - seg.s0[2];
      const tRaw = ((p[0] - seg.s0[0]) * ex + (p[1] - seg.s0[1]) * ey + (p[2] - seg.s0[2]) * ez) / seg.len2;
      const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
      const qx = seg.s0[0] + ex * t; const qy = seg.s0[1] + ey * t; const qz = seg.s0[2] + ez * t;
      const d = Math.sqrt((p[0] - qx) ** 2 + (p[1] - qy) ** 2 + (p[2] - qz) ** 2);
      if (d - seg.m < best) {
        best = d - seg.m;
        near.seg = seg; near.d = d; near.t = tRaw; near.qx = qx; near.qy = qy; near.qz = qz;
      }
    }
    return best;
  };

  const radial = (p, s, target, pullWeight) => {
    const dx = p[0] - s.cx;
    const dz = p[2] - s.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1e-5) return false;
    let newDist = null;
    if (dist < target) {
      newDist = target;
      pushed++;
    } else if (pullWeight > 0) {
      newDist = dist + (target - dist) * pullWeight;
      if (Math.abs(newDist - dist) > 1e-6) pulled++;
    }
    if (newDist == null) return false;
    const k = newDist / dist;
    p[0] = s.cx + dx * k;
    p[2] = s.cz + dz * k;
    return true;
  };

  // 1. вершины: пояс посадки — к размеру, ниже — свисание, всюду — не внутрь тела
  const p = [0, 0, 0];
  const S1 = {};   // ответы surfaceAt без новых объектов на каждую вершину
  const S2 = {};
  meshes.forEach(({ world, sleeve, moved, clearance }) => {
    for (let i = 0; i < world.length / 3; i++) {
      p[0] = world[3 * i]; p[1] = world[3 * i + 1]; p[2] = world[3 * i + 2];
      const y = p[1];
      total++;
      const region = regionOf(p[0], y);
      const s = region ? shape.surfaceAt(y, p[0], p[2], region, S1) : null;

      // рукав: ниже плечевой точки и ближе к руке, чем к торсу; со стороны торса —
      // только если облегает руку или вдвое ближе к ней, чем к телу (иначе это
      // бок вещи между рукой и телом).
      // К торсу не тянется и не свисает — только не проваливается в торс и в руку
      // (поворот к руке — B2)
      let isSleeve = false;
      if (sleeved && y > L.crotch) {
        const armGap = nearestArm(p);
        if (near.seg && armGap < SLEEVE_REACH && (!near.seg.upper || near.t > 0)) {
          const torsoGap = region === 'torso' ? Math.sqrt((p[0] - s.cx) ** 2 + (p[2] - s.cz) ** 2) - s.r : Infinity;
          // со стороны торса: от оси руки к точке — туда же, куда от руки к центру тела
          const inner = region === 'torso'
            && (p[0] - near.qx) * (s.cx - near.qx) + (p[2] - near.qz) * (s.cz - near.qz) > 0;
          isSleeve = armGap < torsoGap && (!inner || armGap < SLEEVE_HUG || 2 * armGap < torsoGap);
        }
      }

      let m = false;
      if (isSleeve) {
        if (region === 'torso') m = radial(p, s, s.r + gap, 0);
        if (m) nearestArm(p);
        const need = near.seg.r + gap;
        if (near.d < need && near.d > 1e-6) {
          const k = need / near.d;
          p[0] = near.qx + (p[0] - near.qx) * k;
          p[1] = near.qy + (p[1] - near.qy) * k;
          p[2] = near.qz + (p[2] - near.qz) * k;
          m = true;
          pushed++;
        }
      } else if (region === 'legL' || region === 'legR') {
        // верх бедра — по размеру бёдер, ниже — только не провалиться в ногу
        const fade = Math.max(0, Math.min(1, (y - (L.crotch - 0.25)) / 0.25));
        const k = 1 + (hipsRatio - 1) * fade;
        const target = Math.max(s.r + gap, s.r * k + ease * fade + layerGap);
        const pullWeight = fit === 'tight' ? 1 : Math.max(0, (y - (L.crotch - 0.1)) / 0.1);
        m = radial(p, s, target, pullWeight);
      } else if (region && y >= band.lo) {
        m = radial(p, s, targetAt(y, s), band.weight(y));
      } else if (region) {
        if (hang) { hang.apply(p); m = true; }
        radial(p, s, s.r + gap, 0);
      }

      if (m) {
        world[3 * i] = p[0]; world[3 * i + 1] = p[1]; world[3 * i + 2] = p[2];
        moved[i] = 1;
      }
      sleeve[i] = isSleeve ? 1 : 0;
      // запас до кожи: треугольники, далёкие от тела, на шаге 2 не проверяются
      if (s && !isSleeve) clearance[i] = Math.sqrt((p[0] - s.cx) ** 2 + (p[2] - s.cz) ** 2) - s.r - gap;
    }
  });

  // 2. плоский треугольник между вершинами не должен срезать тело: середины рёбер
  //    и центр крупных треугольников (стрелка хорды, выпуклость груди, икры).
  //    Нехватку до кожи добираем, отодвигая вершины. Рукава — этап B2.
  //    Грань провисает внутрь не глубже e²/(8·ρ) (e — длина ребра, ρ — самый
  //    крутой изгиб тела): если все вершины дальше от кожи, грань не проверяется
  //    Второй проход смотрит только грани-кандидаты первого: выталкивание
  //    лишь увеличивает запас до кожи
  const q = [0, 0, 0];
  meshes.forEach(({ world, index, sleeve, moved, clearance }) => {
    const count = world.length / 3;
    const triCount = index ? index.length / 3 : count / 3;
    const deficit = new Float32Array(count);
    const check = (x, y, z, a, b, c) => {
      const region = regionOf(x, y);
      if (!region) return;
      const s = shape.surfaceAt(y, x, z, region, S2);
      const d = s.r + gap - Math.sqrt((x - s.cx) ** 2 + (z - s.cz) ** 2);
      if (d <= 0) return;
      const v = Math.min(d, DEFICIT_MAX);
      if (v > deficit[a]) deficit[a] = v;
      if (v > deficit[b]) deficit[b] = v;
      if (c >= 0 && v > deficit[c]) deficit[c] = v;
    };
    // true — грань близко к коже и проверена
    const checkTri = (t) => {
      const a = index ? index[3 * t] : 3 * t;
      const b = index ? index[3 * t + 1] : 3 * t + 1;
      const c = index ? index[3 * t + 2] : 3 * t + 2;
      if (sleeve[a] || sleeve[b] || sleeve[c]) return false;
      const ax = world[3 * a]; const ay = world[3 * a + 1]; const az = world[3 * a + 2];
      const bx = world[3 * b]; const by = world[3 * b + 1]; const bz = world[3 * b + 2];
      const cx = world[3 * c]; const cy = world[3 * c + 1]; const cz = world[3 * c + 2];
      const lab = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
      const lbc = (bx - cx) ** 2 + (by - cy) ** 2 + (bz - cz) ** 2;
      const lca = (cx - ax) ** 2 + (cy - ay) ** 2 + (cz - az) ** 2;
      const e2 = Math.max(lab, lbc, lca);
      if (e2 < MIN_EDGE2) return false;
      if (Math.min(clearance[a], clearance[b], clearance[c]) > e2 / (8 * BODY_CURVE)) return false;
      if (lab >= MIN_EDGE2) check((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, a, b, -1);
      if (lbc >= MIN_EDGE2) check((bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2, b, c, -1);
      if (lca >= MIN_EDGE2) check((cx + ax) / 2, (cy + ay) / 2, (cz + az) / 2, c, a, -1);
      check((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, a, b, c);
      return true;
    };
    const pushOut = () => {
      for (let i = 0; i < count; i++) {
        if (!deficit[i]) continue;
        q[0] = world[3 * i]; q[1] = world[3 * i + 1]; q[2] = world[3 * i + 2];
        const region = regionOf(q[0], q[1]);
        const s = region && shape.surfaceAt(q[1], q[0], q[2], region, S2);
        const dx = region ? q[0] - s.cx : 0;
        const dz = region ? q[2] - s.cz : 0;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 1e-5) {
          const k = (dist + deficit[i]) / dist;
          world[3 * i] = s.cx + dx * k;
          world[3 * i + 2] = s.cz + dz * k;
          clearance[i] += deficit[i];
          moved[i] = 1;
          pushed++;
        }
        deficit[i] = 0;
      }
    };
    const candidates = [];
    for (let t = 0; t < triCount; t++) if (checkTri(t)) candidates.push(t);
    pushOut();
    candidates.forEach(checkTri);
    pushOut();
  });

  // 3. обратно в локальные координаты вещи
  meshes.forEach(({ child, world, moved }) => {
    const pos = child.geometry.attributes.position;
    const inv = new THREE.Matrix4().copy(child.matrixWorld).invert();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      if (!moved[i]) continue;
      v.set(world[3 * i], world[3 * i + 1], world[3 * i + 2]).applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    child.geometry.computeVertexNormals();
    child.geometry.computeBoundingSphere();
  });

  return { total, pushed, pulled, gap, legs };
}

// ── исходная геометрия: прижатие пересчитывается с чистого листа ──

/** Запомнить исходные вершины, чтобы прижатие можно было пересчитывать. */
export function snapshotGeometry(root) {
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    if (pos && !child.geometry.userData.__pristine) {
      child.geometry.userData.__pristine = Float32Array.from(pos.array);
    }
  });
}

/** Вернуть вершины в исходное состояние перед новым прижатием. */
export function restoreGeometry(root) {
  root.traverse((child) => {
    const pos = child.isMesh && child.geometry?.attributes?.position;
    const pristine = child.isMesh && child.geometry?.userData?.__pristine;
    if (pos && pristine) {
      pos.array.set(pristine);
      pos.needsUpdate = true;
      child.geometry.computeVertexNormals();
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
  });
}

// ── точка входа ─────────────────────────────────────────────────

/**
 * Прижимает вершины одежды к телу.
 *
 * @param {THREE.Object3D} garmentRoot — корень одежды (после масштабирования и посадки)
 * @param {object} body — форма тела (bodyShape.js) или профиль обмеров (процедурное тело)
 * @param {object} opts
 * @param {string} opts.fit — tight | regular | loose
 * @param {number} opts.layer — номер слоя (0 = ближе к телу)
 * @param {number} opts.pullStrength — 0..1, насколько притягивать далёкие вершины (прежний алгоритм)
 * @param {object} [opts.size] — обмеры выбранного размера изделия, см: { chest, waist, hips }
 * @param {string} [opts.garmentType] — top | bottom | dress | outerwear …
 * @param {string} [opts.legs] — подсказка 'split' (брюки) | 'joined' (юбка); без неё — по геометрии
 * @returns {object} статистика: сколько вершин двинулось, брюки или юбка
 */
export function drapeGarment(garmentRoot, body, opts = {}) {
  const {
    fit = 'regular',
    layer = 0,
    pullStrength = 0.55,
    size = null,
  } = opts;

  const shape = typeof body?.surfaceAt === 'function' ? body : proceduralBodyShape(body);
  const gap = (EASE_BY_FIT[fit] ?? EASE_BY_FIT.regular) + layer * LAYER_STEP;

  const t0 = now();
  const stats = shape.kind === 'procedural' && !size
    ? drapeLegacy(garmentRoot, shape, { gap, pullStrength })
    : drapeFitted(garmentRoot, shape, { ...opts, gap, layer });
  stats.ms = mark('garment drape', t0);
  return stats;
}

/** Время с t0, мс; заодно отметка в Performance (видна в DevTools → Performance). */
export function mark(name, t0) {
  const ms = now() - t0;
  try { performance.measure(name, { start: t0 }); } catch { /* старые браузеры, jsdom */ }
  return ms;
}

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Экспорт для тестов и переиспользования */
export const _internal = shapeInternal;
