// client/src/utils/accessoryPlacement.js
//
// Аксессуары, бижутерия, обувь и сумки на фигуре: твёрдая вещь крепится к точке
// тела (решение 17.10, research/patterns/README.md; research/accessories/README.md).
//
//  • Точки — наборы вершин болванки (data/accessoryAnchors.json, scripts/avatar/accessory_anchors.py).
//    Точка = среднее этих вершин на фигуре покупателя, поэтому она едет вместе с морфами.
//  • Масштаб — по размерам из карточки товара (Product.accessory): длина серьги, ширина сумки,
//    размер кольца… Обувь — по длине стопы покупателя (профиль, иначе стопа фигуры).
//  • Модель вещи — в своей системе: Y вверх, +Z — лицевая сторона (та, что видна при носке),
//    X — поперёк. Обувь: носок к +Z, подошва внизу, модель — левая туфля (правая — зеркально).
//    Кольцо и браслет: отверстие вдоль Z, камень или застёжка к +Y. Часы: циферблат к +Z,
//    «12–6» вдоль Y (ремешок уходит вверх и вниз и обхватывает запястье), «3 часа» (+X) — к кисти.
//    Модели из «фото → 3D» приводит к этой системе scripts/accessories/prepare_models.py.
//
// Без React; THREE — только для матриц.

import * as THREE from 'three';
import anchorsData from '../data/accessoryAnchors.json';
import { hull } from './bodyShape';
import { ACCESSORY_KINDS } from './accessoryKinds';

export { ACCESSORY_KINDS, FIELD_LABELS, accessoryKind } from './accessoryKinds';

const A = anchorsData.anchors;

// ─────────────────────────────────────────────────────────────
//  Размеры
// ─────────────────────────────────────────────────────────────

/** Запас длины обуви над стопой, см: внутри ~1,5 (на носок), плюс верх и подошва у носка и пятки. */
export const SHOE_OUTER_ALLOWANCE_CM = 2.5;
/** Внутренний запас: колодка длиннее стопы на ~1,5 см. */
const SHOE_INNER_ALLOWANCE_CM = 1.5;

/**
 * Длина стопы, на которую рассчитан размер обуви, см.
 *  EU — штихмасс: колодка = размер · 2/3 см; UK — колодка (размер + 25)/3 дюйма;
 *  US женский = UK + 2, US мужской = UK + 1; cm — длина стопы (мондопойнт).
 * @returns {number|null} null — размер не распознан
 */
export function shoeFootLengthCm(size, system = 'EU') {
  const n = Number(String(size ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (system) {
    case 'EU':   return (n * 2) / 3 - SHOE_INNER_ALLOWANCE_CM;
    case 'UK':   return ((n + 25) / 3) * 2.54 - SHOE_INNER_ALLOWANCE_CM;
    case 'US-W': return shoeFootLengthCm(n - 2, 'UK');
    case 'US-M': return shoeFootLengthCm(n - 1, 'UK');
    case 'cm':   return n;
    default:     return null;
  }
}

/** Подходит ли обувь: стопа покупателя против стопы размера. Меньше на 0,5 см — мала, больше на 1 см — велика. */
export function shoeFit(sizeFootCm, buyerFootCm) {
  if (!(sizeFootCm > 0) || !(buyerFootCm > 0)) return null;
  const d = sizeFootCm - buyerFootCm;
  if (d < -0.5) return 'small';
  if (d > 1.0) return 'large';
  return 'fits';
}

/**
 * Внутренний диаметр кольца, мм. US: 11,63 + 0,8128 · размер; EU (ISO 8653) — размер = длина
 * окружности в мм.
 */
export function ringInnerDiameterMm(size, system = 'US') {
  const n = Number(String(size ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (system === 'US') return 11.63 + 0.8128 * n;
  if (system === 'EU') return n / Math.PI;
  return null;
}

// ─────────────────────────────────────────────────────────────
//  Точки и оси на фигуре
// ─────────────────────────────────────────────────────────────

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Точка крепления на фигуре: среднее вершин набора name (м). */
export function anchorPoint(positions, name) {
  const ids = A[name];
  if (!ids) throw new Error(`no accessory anchor "${name}"`);
  const p = [0, 0, 0];
  ids.forEach((i) => { for (let c = 0; c < 3; c++) p[c] += positions[3 * i + c]; });
  return v3(p.map((x) => x / ids.length));
}

/** Периметр выпуклой оболочки вершин набора в плоскости, перпендикулярной axis. */
function ringPerimeter(positions, name, centre, axis) {
  const u = new THREE.Vector3(0, 1, 0).cross(axis);
  if (u.lengthSq() < 1e-8) u.set(1, 0, 0).cross(axis);
  u.normalize();
  const w = axis.clone().cross(u).normalize();
  const pts = [];
  const p = new THREE.Vector3();
  A[name].forEach((i) => {
    p.fromArray(positions, 3 * i).sub(centre);
    pts.push(p.dot(u), p.dot(w));
  });
  const h = hull(pts);
  let per = 0;
  for (let i = 0; i < h.length; i++) {
    const [x0, z0] = h[i];
    const [x1, z1] = h[(i + 1) % h.length];
    per += Math.hypot(x1 - x0, z1 - z0);
  }
  return per;
}

/** Ось вдоль конечности и тыльное направление, перпендикулярное ей. */
function limbFrame(positions, ringName, towardName, dorsalName) {
  const origin = anchorPoint(positions, ringName);
  const axis = anchorPoint(positions, towardName).sub(origin).normalize();
  const dorsal = anchorPoint(positions, dorsalName).sub(origin);
  dorsal.addScaledVector(axis, -dorsal.dot(axis)).normalize();
  const perimeter = ringPerimeter(positions, ringName, origin, axis);
  return { origin, axis, dorsal, perimeter };
}

/** Запястье: центр, ось к кисти, тыльная сторона (циферблат), обхват (м). */
export function wristFrame(positions, side = 'l') {
  const f = limbFrame(positions, `wrist_${side}`, `forearm_${side}`, `wrist_dorsal_${side}`);
  f.axis.negate();                                  // от предплечья к кисти
  return f;
}

/** Безымянный палец: центр кольца на основной фаланге, ось к ногтю, тыльная сторона, обхват (м). */
export function ringFingerFrame(positions, side = 'l') {
  return limbFrame(positions, `ring_${side}`, `ring_tip_${side}`, `ring_dorsal_${side}`);
}

/** Стопа: пятка, носок, направление пятка → носок (горизонтально), длина (м), пол. */
export function footFrame(positions, side = 'l') {
  const heel = anchorPoint(positions, `heel_${side}`);
  const toe = anchorPoint(positions, `toe_${side}`);
  let floor = Infinity;
  A[`foot_${side}`].forEach((i) => { floor = Math.min(floor, positions[3 * i + 1]); });
  const dir = new THREE.Vector3(toe.x - heel.x, 0, toe.z - heel.z);
  const length = dir.length();
  return { heel, toe, dir: dir.normalize(), length, floor };
}

/** Длина стопы фигуры, см (среднее двух стоп). */
export function avatarFootLengthCm(positions) {
  return ((footFrame(positions, 'l').length + footFrame(positions, 'r').length) / 2) * 100;
}

/** Сечение головы на высоте y: центр и периметр выпуклой оболочки (м); слой ±3 мм. */
function headSection(positions, y) {
  const pts = [];
  let cx = 0; let cz = 0;
  A.head.forEach((i) => {
    if (Math.abs(positions[3 * i + 1] - y) < 0.003) {
      pts.push(positions[3 * i], positions[3 * i + 2]);
      cx += positions[3 * i]; cz += positions[3 * i + 2];
    }
  });
  const n = pts.length / 2;
  if (n < 3) return null;
  const h = hull(pts);
  let per = 0;
  for (let i = 0; i < h.length; i++) {
    per += Math.hypot(h[(i + 1) % h.length][0] - h[i][0], h[(i + 1) % h.length][1] - h[i][1]);
  }
  return { y, cx: cx / n, cz: cz / n, perimeter: per };
}

/**
 * Где сядет шапка обхватом hatCm: спускаемся от макушки, пока обхват головы не станет
 * равен обхвату шапки. Ниже бровей (переносица + 2 см) не опускается — большая шапка
 * лежит на бровях и ушах. Без размера — на уровне бровей.
 * @returns {{ y, cx, cz, perimeter }} м
 */
export function hatSeat(positions, hatCm) {
  const crown = anchorPoint(positions, 'crown').y;
  const brow = anchorPoint(positions, 'sellion').y + 0.02;
  const target = hatCm > 0 ? hatCm / 100 : Infinity;
  let last = null;
  for (let y = crown - 0.01; y >= brow; y -= 0.002) {
    const s = headSection(positions, y);
    if (!s) continue;
    if (s.perimeter >= target) return s;
    last = s;
  }
  return headSection(positions, brow) || last;
}

/** Точка на поверхности торса на высоте y в направлении (dx, dz) от оси, отодвинутая на gap. */
function torsoPoint(shape, y, dx, dz, gap = 0) {
  const s = shape.surfaceAt(y, 0, 0);
  const c = shape.surfaceAt(y, s.cx + dx, s.cz + dz);
  const len = Math.hypot(dx, dz) || 1;
  return new THREE.Vector3(c.cx + (dx / len) * (c.r + gap), y, c.cz + (dz / len) * (c.r + gap));
}

/** Передняя поверхность торса на высоте y над точкой x: z (бисекция по углу передней половины сечения). */
function frontZ(shape, y, x) {
  const c = shape.surfaceAt(y, 0, 0);
  const pointAt = (t) => {
    const s = shape.surfaceAt(y, c.cx + Math.cos(t), c.cz + Math.sin(t));
    return [s.cx + s.r * Math.cos(t), s.cz + s.r * Math.sin(t)];
  };
  let lo = 0; let hi = Math.PI;                 // t = 0 — левый бок (+X), π/2 — спереди, π — правый бок
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (pointAt(mid)[0] > x) lo = mid; else hi = mid;
  }
  return pointAt((lo + hi) / 2)[1];
}

/** Длина замкнутой линии, м. */
function closedLength(points) {
  let L = 0;
  for (let i = 0; i < points.length; i++) L += points[i].distanceTo(points[(i + 1) % points.length]);
  return L;
}

/** Цепочка лежит на коже с зазором, м. */
const CHAIN_GAP = 0.003;

/**
 * Линия цепочки длиной lengthCm: сзади — по основанию шеи (C7 и бока шеи),
 * спереди — от боков шеи вниз к точке на средней линии. Высота этой точки подбирается
 * так, чтобы длина линии была lengthCm: от переда шеи на уровне её боков до талии.
 * Цепочка короче основания шеи (чокер) лежит по основанию шеи.
 * @returns {{ points: THREE.Vector3[], lowest: THREE.Vector3, lengthCm: number }}
 */
export function necklaceCurve(shape, positions, lengthCm, segments = 24) {
  const L = lengthCm / 100;
  const c7 = anchorPoint(positions, 'cervicale');
  const jug = anchorPoint(positions, 'jugular');
  const sideL = anchorPoint(positions, 'neck_side_l');
  const sideR = anchorPoint(positions, 'neck_side_r');
  // спинка: полуэллипс через бок шеи, C7 и другой бок (наружу на зазор)
  const centre = new THREE.Vector3((sideL.x + sideR.x) / 2, (sideL.y + sideR.y) / 2, (sideL.z + sideR.z) / 2);
  const back = [];
  for (let k = 0; k <= segments / 2; k++) {
    const t = Math.PI * (k / (segments / 2));     // 0 — левый бок, π — правый
    const p = centre.clone()
      .addScaledVector(sideL.clone().sub(centre), Math.cos(t))
      .addScaledVector(c7.clone().sub(centre), Math.sin(t));
    const out = p.clone().sub(centre).setY(0).normalize().multiplyScalar(CHAIN_GAP);
    back.push(p.add(out));
  }
  // спереди: от бока шеи прямо к точке на средней линии груди на высоте y; ниже яремной
  // вырезки точка, ушедшая в грудь, выносится вперёд (по Z, X не меняется) на переднюю
  // поверхность торса: вбок по радиусу нельзя — у шеи сечение торса захватывает плечи
  const half = (start, end) => {
    const pts = [];
    for (let k = 1; k <= segments / 2; k++) {
      const q = start.clone().lerp(end, k / (segments / 2));
      if (k < segments / 2 && q.y < jug.y) q.z = Math.max(q.z, frontZ(shape, q.y, q.x) + CHAIN_GAP);
      pts.push(q);
    }
    return pts;
  };
  const loopAt = (y) => {
    const end = torsoPoint(shape, y, 0, 1, CHAIN_GAP);
    // замкнутая линия: левый бок → C7 → правый бок → грудь → обратно к левому боку
    return [...back, ...half(sideR, end), ...half(sideL, end).slice(0, -1).reverse()];
  };
  const lenAt = (y) => closedLength(loopAt(y));
  const at = (y) => ({ points: loopAt(y), lowest: torsoPoint(shape, y, 0, 1, CHAIN_GAP), lengthCm: lenAt(y) * 100 });
  const top = anchorPoint(positions, 'neck_front').y;
  if (lenAt(top) >= L) return at(top);          // чокер: короче основания шеи не бывает
  let lo = shape.levels.waist; let hi = top;    // чем ниже точка, тем длиннее линия
  if (lenAt(lo) <= L) return at(lo);
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (lenAt(mid) > L) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2);
}

/** Ремень: замкнутая линия по поверхности торса на талии или бёдрах, с зазором на одежду. */
export function beltLoop(shape, level = 'waist', gap = 0.008, segments = 48) {
  const y = shape.levels[level === 'hips' ? 'hips' : 'waist'];
  const points = [];
  for (let k = 0; k < segments; k++) {
    const t = (2 * Math.PI * k) / segments;
    points.push(torsoPoint(shape, y, Math.sin(t), Math.cos(t), gap));   // k = 0 — спереди
  }
  return { points, front: points[0], y, lengthCm: closedLength(points) * 100 };
}

// ─────────────────────────────────────────────────────────────
//  Посадка модели
// ─────────────────────────────────────────────────────────────

/**
 * Матрица: опорная точка модели ref (в её системе) → target; оси модели X, Y, Z → ex, ey, ez;
 * масштаб s; mirror — отражение по X модели (правая туфля из левой).
 */
function frameMatrix(ex, ey, ez, s, ref, target, mirror = false) {
  const basis = new THREE.Matrix4().makeBasis(ex, ey, ez);
  const scale = new THREE.Matrix4().makeScale(mirror ? -s : s, s, s);
  const shift = new THREE.Matrix4().makeTranslation(-ref.x, -ref.y, -ref.z);
  return new THREE.Matrix4().makeTranslation(target.x, target.y, target.z).multiply(basis).multiply(scale).multiply(shift);
}

/** Правая тройка из двух направлений: ey — «вверх» модели, ez — её лицо (ez подправляется под ey). */
function axesFrom(ey, ez) {
  const y = ey.clone().normalize();
  const z = ez.clone().addScaledVector(y, -ez.dot(y)).normalize();
  return { ex: y.clone().cross(z), ey: y, ez: z };
}

const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
const cm = (v, fallback) => (Number(v) > 0 ? Number(v) / 100 : fallback);

/**
 * Где и в каком масштабе стоит вещь вида kind: одна или две (пара) матрицы.
 * @param {string} kind ACCESSORY_KINDS
 * @param {THREE.Box3} box габариты модели в её системе
 * @param {object} shape форма фигуры (meshBodyShape), нужен shape.mesh.positions
 * @param {object} card Product.accessory: размеры (см), size, sizeSystem, side, level
 * @param {object} opts footLengthCm — стопа покупателя из профиля
 * @returns {{ items: { side, matrix }[], extra: object }} extra — линия цепочки или ремня, вердикт размера
 */
export function accessoryTransforms(kind, box, shape, card = {}, opts = {}) {
  const P = shape.mesh.positions;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const side = card.side === 'r' ? 'r' : 'l';
  const items = [];
  const extra = {};

  switch (kind) {
    case 'earrings': {
      // висит вниз от мочки; лицо — наружу и вперёд (так серьгу видно и спереди, и сбоку)
      const s = cm(card.lengthCm, 0.03) / size.y;
      for (const sd of ['l', 'r']) {
        const out = new THREE.Vector3(sd === 'l' ? 1 : -1, 0, 1);
        const { ex, ey, ez } = axesFrom(UP, out);
        items.push({ side: sd, matrix: frameMatrix(ex, ey, ez, s, v3([c.x, box.max.y, c.z]), anchorPoint(P, `ear_lobe_${sd}`)) });
      }
      break;
    }
    case 'ring': {
      const f = ringFingerFrame(P, side);
      const dMm = ringInnerDiameterMm(card.size, card.sizeSystem || 'US') ?? (f.perimeter * 1000) / Math.PI;
      const band = 0.002;
      const s = (dMm / 1000 + 2 * band) / size.x;
      const { ex, ey, ez } = axesFrom(f.dorsal, f.axis);       // Y модели — к тылу, ось отверстия (Z) — вдоль пальца
      const ref = v3([c.x, box.min.y + (band + dMm / 2000) / s, c.z]);
      items.push({ side, matrix: frameMatrix(ex, ey, ez, s, ref, f.origin) });
      extra.fingerCm = f.perimeter * 100;
      extra.ringCm = (dMm * Math.PI) / 10;
      break;
    }
    case 'watch':
    case 'bracelet': {
      const f = wristFrame(P, side);
      const wristD = f.perimeter / Math.PI;
      if (kind === 'watch') {
        // циферблат (Z) — к тылу, «3 часа» (X) — к кисти, ремешок (Y) обхватывает запястье; на 1,5 см выше сустава
        const s = cm(card.widthCm, 0.038) / size.x;
        const { ex, ey, ez } = axesFrom(f.dorsal.clone().cross(f.axis), f.dorsal);
        const closed = size.z * s > 0.6 * wristD;               // ремешок застёгнут кольцом
        const target = f.origin.clone().addScaledVector(f.axis, -0.015);
        const ref = closed ? c.clone() : v3([c.x, c.y, box.min.z]);
        if (!closed) target.addScaledVector(f.dorsal, wristD / 2);
        items.push({ side, matrix: frameMatrix(ex, ey, ez, s, ref, target) });
      } else {
        const inner = cm(card.lengthCm, f.perimeter * 1.1) / Math.PI;
        const s = (inner + 0.008) / size.x;
        const { ex, ey, ez } = axesFrom(f.dorsal, f.axis);
        items.push({ side, matrix: frameMatrix(ex, ey, ez, s, c.clone(), f.origin) });
      }
      extra.wristCm = f.perimeter * 100;
      break;
    }
    case 'necklace': {
      const curve = necklaceCurve(shape, P, Number(card.lengthCm) > 0 ? Number(card.lengthCm) : 45);
      extra.chain = curve;
      // модель — подвеска: верх — в нижней точке цепочки, лицом вперёд
      const s = card.heightCm > 0 ? cm(card.heightCm) / size.y : 0.025 / Math.max(size.x, size.y);
      const { ex, ey, ez } = axesFrom(UP, FRONT);
      items.push({ side: 'c', matrix: frameMatrix(ex, ey, ez, s, v3([c.x, box.max.y, box.min.z]), curve.lowest) });
      break;
    }
    case 'belt': {
      const loop = beltLoop(shape, card.level);
      extra.belt = { ...loop, widthCm: Number(card.widthCm) > 0 ? Number(card.widthCm) : 3 };
      // модель — пряжка: высота = ширина ремня + 6 мм, спереди на линии ремня
      const s = (extra.belt.widthCm / 100 + 0.006) / size.y;
      const { ex, ey, ez } = axesFrom(UP, FRONT);
      items.push({ side: 'c', matrix: frameMatrix(ex, ey, ez, s, v3([c.x, c.y, box.min.z]), loop.front) });
      break;
    }
    case 'shoulder_bag': {
      // сумка висит у бедра снаружи; ширина сумки — вдоль тела спереди назад, лицо — наружу
      const sign = side === 'l' ? 1 : -1;
      const s = cm(card.widthCm, 0.25) / size.x;
      const top = anchorPoint(P, `shoulder_top_${side}`);
      const yTop = card.dropCm > 0 ? top.y - cm(card.dropCm) : top.y;
      const yMid = yTop - (size.y * s) / 2;
      const depth = size.z * s;
      const hip = torsoPoint(shape, Math.max(yMid, shape.levels.crotch), sign, 0, 0);
      const target = new THREE.Vector3(hip.x + sign * (depth / 2 + 0.01), yTop, hip.z);
      const { ex, ey, ez } = axesFrom(UP, new THREE.Vector3(sign, 0, 0));
      items.push({ side, matrix: frameMatrix(ex, ey, ez, s, v3([c.x, box.max.y, c.z]), target) });
      break;
    }
    case 'handbag': {
      const s = cm(card.widthCm, 0.25) / size.x;
      const { ex, ey, ez } = axesFrom(UP, FRONT);
      items.push({ side, matrix: frameMatrix(ex, ey, ez, s, v3([c.x, box.max.y, c.z]), anchorPoint(P, `grip_${side}`)) });
      break;
    }
    case 'hat': {
      const seat = hatSeat(P, Number(card.size));
      const s = card.widthCm > 0 ? cm(card.widthCm) / size.x : (seat.perimeter / Math.PI + 0.01) / size.x;
      const { ex, ey, ez } = axesFrom(UP, FRONT);
      items.push({ side: 'c', matrix: frameMatrix(ex, ey, ez, s, v3([c.x, box.min.y, c.z]), v3([seat.cx, seat.y, seat.cz])) });
      extra.headCm = seat.perimeter * 100;
      break;
    }
    case 'glasses': {
      // перемычка — на переносице, линза ~1 см перед ней; оси — по линии между ушами
      const l = anchorPoint(P, 'ear_top_l');
      const r = anchorPoint(P, 'ear_top_r');
      const across = l.clone().sub(r).normalize();
      const ey = UP.clone().addScaledVector(across, -UP.dot(across)).normalize();
      const ez = across.clone().cross(ey);
      const s = cm(card.widthCm, 0.135) / size.x;
      const target = anchorPoint(P, 'sellion').addScaledVector(ez, 0.01);
      items.push({ side: 'c', matrix: frameMatrix(across, ey, ez, s, v3([c.x, c.y, box.max.z]), target) });
      break;
    }
    case 'shoes': {
      const foot = opts.footLengthCm > 0 ? opts.footLengthCm : avatarFootLengthCm(P);
      const s = (foot + SHOE_OUTER_ALLOWANCE_CM) / 100 / size.z;
      for (const sd of ['l', 'r']) {
        const f = footFrame(P, sd);
        const { ex, ey, ez } = axesFrom(UP, f.dir);
        // пятка туфли — на 5 мм позади пятки стопы (задник), подошва — на полу
        const target = new THREE.Vector3(f.heel.x, f.floor, f.heel.z).addScaledVector(f.dir, -0.005);
        items.push({ side: sd, matrix: frameMatrix(ex, ey, ez, s, v3([c.x, box.min.y, box.min.z]), target, sd === 'r') });
      }
      extra.footCm = foot;
      const sizeFoot = shoeFootLengthCm(card.size, card.sizeSystem || 'EU');
      extra.fit = shoeFit(sizeFoot, foot);
      break;
    }
    default:
      return { items, extra };
  }
  return { items, extra };
}

/**
 * Посадка аксессуара в примерке: модель root (внутри group) ставится в первую точку,
 * для пары — копия во вторую (дочерний объект group с относительной матрицей).
 * Цепочка и ремень строятся трубкой по линии. Вызывается после сброса group к единичной матрице.
 * opts.color — цвет товара ('#rrggbb'): им красится лента ремня и цепочка (сама модель — в своей текстуре).
 * @returns {object|null} extra из accessoryTransforms; null — вид неизвестен или у фигуры нет меша
 */
export function placeAccessory(group, root, shape, kind, card = {}, opts = {}) {
  // копии и цепочка прошлой посадки — убрать в любом случае (фигура могла смениться на процедурную)
  group.children.filter((o) => o.userData.accessoryPart).forEach((o) => {
    group.remove(o);
    if (o.userData.ownsGeometry) o.geometry.dispose();
  });
  if (!ACCESSORY_KINDS[kind] || shape?.kind !== 'mesh') return null;
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const { items, extra } = accessoryTransforms(kind, box, shape, card, opts);
  if (!items.length) return null;

  const first = items[0].matrix;
  first.decompose(group.position, group.quaternion, group.scale);
  group.updateWorldMatrix(true, true);
  const inv = first.clone().invert();
  items.slice(1).forEach(({ side, matrix }) => {
    const copy = root.clone();
    copy.userData.accessoryPart = side;
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(inv.clone().multiply(matrix).multiply(root.matrix));   // root — прямой ребёнок group
    group.add(copy);
  });

  // цепочка — тонкая трубка, ремень — вертикальная лента; обе в системе фигуры
  const line = extra.chain
    ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(extra.chain.points, true), extra.chain.points.length * 4, 0.0012, 6, true)
    : extra.belt && ribbonGeometry(extra.belt.points, extra.belt.widthCm / 100);
  if (line) {
    const mesh = new THREE.Mesh(line, lineMaterial(root, opts.color));
    mesh.userData.accessoryPart = 'line';
    mesh.userData.ownsGeometry = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(inv);
    group.add(mesh);
  }
  return extra;
}

/** Замкнутая вертикальная лента высотой width по точкам линии (ремень). */
function ribbonGeometry(points, width) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  points.forEach((p, i) => {
    pos.set([p.x, p.y + width / 2, p.z, p.x, p.y - width / 2, p.z], i * 6);
  });
  const index = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * i; const b = 2 * ((i + 1) % n);
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Материал ленты или цепочки: как у модели, но без её текстуры; цвет — цвет товара, если он есть. */
function lineMaterial(root, color) {
  let base = null;
  root.traverse((o) => { if (!base && o.isMesh) base = Array.isArray(o.material) ? o.material[0] : o.material; });
  const mat = base ? base.clone() : new THREE.MeshStandardMaterial();
  mat.map = null;
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) mat.color?.set(color);
  mat.needsUpdate = true;
  return mat;
}
