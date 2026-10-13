// client/src/utils/bodyShape.js
//
// «Форма тела», на которую садится одежда (utils/garmentDrape.js).
// Один интерфейс для двух тел:
//
//   proceduralBodyShape(profile) — процедурное тело BodyAvatar: эллиптические
//     сечения из обмеров. Формулы перенесены из garmentDrape.js без изменений
//     и должны совпадать с BodyAvatar.jsx.
//   meshBodyShape(body)          — болванка base_avatar.glb в текущей фигуре:
//     сечения настоящего меша с шагом 1 см. Торс — выпуклая оболочка на
//     уровне (ткань не проваливается между грудями), радиус по 72 углам от
//     её центра; ноги — по отдельности (брюки) и вместе (юбки); руки — капсулы
//     плечо → локоть → запястье (рукава только выталкиваются из руки).
//
// Интерфейс формы:
//   kind        'procedural' | 'mesh'
//   landmarks   уровни для посадки вещи (как getBodyLandmarks в BodyAvatar), м
//   zone        { low, high } — где прижимать ткань к торсу
//   levels      { crotch, chest, waist, hips } — уровни обмеров для размера
//   surfaceAt(y, x, z, region) → { cx, cz, r }  — центр сечения и радиус тела
//                 в направлении точки; region: 'torso' | 'legL' | 'legR' | 'legs'
//   girthAt(y, region) → обхват тела на высоте y, м
//   arms        [{ a, b, c, r1, r2, m1, m2 }] — капсулы рук (только у меша): r — с запасом
//               на дельту и подмышку (выталкивание), m — медиана (рукав или торс)

// ── процедурное тело (копия логики BodyAvatar) ─────────────────

function ellipseFromPerimeter(perimeterCm, ratio = 0.72) {
  const p = perimeterCm / 100;
  let a = p / (2 * Math.PI);
  for (let i = 0; i < 12; i++) {
    const b = a * ratio;
    const h = ((a - b) ** 2) / ((a + b) ** 2);
    const per = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    a *= p / per;
  }
  return { a, b: a * ratio };
}

function resolveProfile(p = {}) {
  const H = (Number(p.heightCm) || 170) / 100;
  const chest = Number(p.chest) || (H * 100) * 0.53;
  const waist = Number(p.waist) || (H * 100) * 0.42;
  const hips = Number(p.hips) || (H * 100) * 0.55;
  const shoulderW = (Number(p.shoulderWidth) || (H * 100) * 0.245) / 100;

  return {
    H, chest, waist, hips, shoulderW,
    y: {
      ankle: H * 0.04,
      knee: H * 0.28,
      thighTop: H * 0.48,
      hips: H * 0.53,
      waist: H * 0.62,
      chest: H * 0.72,
      shoulder: H * 0.82,
      neck: H * 0.86,
      headTop: H * 1.0,
    },
  };
}

/**
 * Опорные сечения тела: высота → обхват и соотношение осей.
 * Между ними интерполируем.
 */
function bodySections(P) {
  const { y } = P;
  return [
    { y: y.hips - 0.02, per: P.hips,                   ratio: 0.75 },
    { y: y.hips + 0.04, per: P.hips * 0.98,            ratio: 0.75 },
    { y: y.waist,       per: P.waist,                  ratio: 0.72 },
    { y: y.chest - 0.04, per: (P.waist + P.chest) / 2, ratio: 0.70 },
    { y: y.chest,       per: P.chest,                  ratio: 0.68 },
    { y: y.chest + 0.06, per: P.chest * 0.96,          ratio: 0.66 },
    { y: y.shoulder,    per: P.chest * 0.92,           ratio: 0.62 },
    { y: y.neck,        per: P.chest * 0.42,           ratio: 0.85 },
  ];
}

/** Обхват и соотношение осей на высоте (линейно между сечениями). */
function sectionAtHeight(sections, yPos) {
  if (yPos <= sections[0].y) return sections[0];
  const last = sections[sections.length - 1];
  if (yPos >= last.y) return last;
  for (let i = 0; i < sections.length - 1; i++) {
    const s0 = sections[i];
    const s1 = sections[i + 1];
    if (yPos >= s0.y && yPos <= s1.y) {
      const t = (yPos - s0.y) / (s1.y - s0.y);
      return { per: s0.per + (s1.per - s0.per) * t, ratio: s0.ratio + (s1.ratio - s0.ratio) * t };
    }
  }
  return last;
}

/**
 * Полуоси тела на заданной высоте (линейная интерполяция между сечениями).
 * Возвращает { a, b } — полуширина и полуглубина в метрах.
 */
function bodyAxesAtHeight(sections, yPos) {
  const s = sectionAtHeight(sections, yPos);
  return ellipseFromPerimeter(s.per, s.ratio);
}

/**
 * Радиус тела в направлении (x, z) на высоте y.
 * Для эллипса с полуосями a, b радиус под углом θ:
 *   r = a·b / sqrt((b·cosθ)² + (a·sinθ)²)
 */
function bodyRadiusAt(sections, yPos, x, z) {
  const { a, b } = bodyAxesAtHeight(sections, yPos);
  const len = Math.hypot(x, z);
  if (len < 1e-6) return Math.min(a, b);
  const cos = x / len;
  const sin = z / len;
  return (a * b) / Math.sqrt((b * cos) ** 2 + (a * sin) ** 2);
}

export function proceduralBodyShape(profile) {
  const P = resolveProfile(profile);
  const sections = bodySections(P);
  return {
    kind: 'procedural',
    landmarks: { height: P.H, shoulderWidth: P.shoulderW, ...P.y },
    zone: { low: P.y.hips - 0.06, high: P.y.shoulder + 0.02 },
    levels: { crotch: P.y.hips - 0.02, chest: P.y.chest, waist: P.y.waist, hips: P.y.hips },
    surfaceAt(y, x, z) {
      return { cx: 0, cz: 0, r: bodyRadiusAt(sections, y, x, z) };
    },
    girthAt(y) {
      return sectionAtHeight(sections, y).per / 100;
    },
    arms: [],
  };
}

// ── болванка: сечения настоящего меша ──────────────────────────

const ANGLES = 72;
const STEP = 0.01;                      // шаг уровней, м
export const PART = { TORSO: 0, ARM: 1, LEG: 2 };

/** Выпуклая оболочка (монотонная цепь), против часовой стрелки; pts — плоский [x0, z0, x1, z1, …]. */
function hull(pts) {
  const n = pts.length / 2;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o, a, b) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1])
    - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const half = (order) => {
    const h = [];
    for (const i of order) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
      h.push(i);
    }
    return h;
  };
  const lower = half(idx);
  const upper = half(idx.slice().reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map((i) => [pts[2 * i], pts[2 * i + 1]]);
}

/** Центр (центроид площади), радиус по ANGLES направлениям и периметр выпуклого многоугольника. */
function polarTable(poly) {
  let area = 0;
  let cx = 0;
  let cz = 0;
  let perimeter = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const c = x0 * z1 - x1 * z0;
    area += c;
    cx += (x0 + x1) * c;
    cz += (z0 + z1) * c;
    perimeter += Math.hypot(x1 - x0, z1 - z0);
  }
  if (Math.abs(area) < 1e-12) return null;
  cx /= 3 * area;
  cz /= 3 * area;
  // Радиус по ANGLES направлениям: оболочка выпуклая и обходится против часовой
  // стрелки, центр внутри — углы вершин растут монотонно, поэтому все лучи
  // находят своё ребро за один проход.
  const n = poly.length;
  const ang = new Float64Array(n + 1);
  let i0 = 0;
  for (let i = 0; i < n; i++) {
    let a = Math.atan2(poly[i][1] - cz, poly[i][0] - cx);
    if (a < 0) a += Math.PI * 2;
    ang[i] = a;
    if (a < ang[i0]) i0 = i;
  }
  const order = new Int32Array(n + 1);
  const A = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    order[k] = (i0 + k) % n;
    A[k] = ang[order[k]] + (k > 0 && ang[order[k]] < A[k - 1] - 1e-12 ? Math.PI * 2 : 0);
    if (k > 0 && A[k] < A[k - 1]) A[k] += Math.PI * 2;
  }
  A[n] = A[0] + Math.PI * 2;
  const r = new Float32Array(ANGLES);
  // обходим направления по возрастанию угла, начиная с первого не меньше A[0]
  const kStart = Math.ceil((A[0] / (Math.PI * 2)) * ANGLES - 1e-9);
  let j = 0;
  for (let step = 0; step < ANGLES; step++) {
    const k = (kStart + step) % ANGLES;
    let t = (k / ANGLES) * Math.PI * 2;
    if (t < A[0]) t += Math.PI * 2;
    while (j < n - 1 && A[j + 1] <= t) j++;
    const [x0, z0] = poly[order[j]];
    const [x1, z1] = poly[order[j + 1]];
    const dx = Math.cos(t);
    const dz = Math.sin(t);
    const ex = x1 - x0;
    const ez = z1 - z0;
    const den = dx * ez - dz * ex;
    r[k] = Math.abs(den) < 1e-12 ? Math.hypot(x0 - cx, z0 - cz) : ((x0 - cx) * ez - (z0 - cz) * ex) / den;
  }
  return { cx, cz, r, perimeter };
}

/**
 * Точки сечений по уровням y0, y0 + STEP, … y1 (плоский [x0, z0, x1, z1, …] на уровень).
 * Треугольники раскладываются по уровням один раз — каждый проверяется только там, где он есть.
 */
function sectionsByLevel(positions, tris, y0, y1) {
  const count = Math.floor((y1 - y0) / STEP + 1e-9) + 1;
  const buckets = Array.from({ length: count }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    const ya = positions[3 * tris[t] + 1];
    const yb = positions[3 * tris[t + 1] + 1];
    const yc = positions[3 * tris[t + 2] + 1];
    const lo = Math.max(0, Math.ceil((Math.min(ya, yb, yc) - y0) / STEP));
    const hi = Math.min(count - 1, Math.floor((Math.max(ya, yb, yc) - y0) / STEP));
    for (let k = lo; k <= hi; k++) buckets[k].push(t);
  }
  return buckets.map((list, k) => {
    const y = y0 + k * STEP;
    const pts = [];
    for (const t of list) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e];
        const b = tris[t + ((e + 1) % 3)];
        const ya = positions[3 * a + 1];
        const yb = positions[3 * b + 1];
        if ((ya - y) * (yb - y) >= 0) continue;
        const s = (y - ya) / (yb - ya);
        pts.push(positions[3 * a] + (positions[3 * b] - positions[3 * a]) * s,
          positions[3 * a + 2] + (positions[3 * b + 2] - positions[3 * a + 2]) * s);
      }
    }
    return { y, pts };
  });
}

/** Таблица сечений из точек по уровням; filter(x) отбирает точки (например, одна нога). */
function buildLevels(sections, filter) {
  const levels = sections.map(({ y, pts }) => {
    let use = pts;
    if (filter) {
      use = [];
      for (let i = 0; i < pts.length; i += 2) if (filter(pts[i])) use.push(pts[i], pts[i + 1]);
    }
    const table = polarTable(hull(use));
    return table && { y, ...table };
  });
  // пустые уровни (нет пересечений) заполняем соседними
  for (let i = 0; i < levels.length; i++) {
    if (!levels[i]) {
      const near = levels.slice(0, i).reverse().find(Boolean) || levels.find((l, k) => l && k > i);
      if (near) levels[i] = { ...near, y: sections[i].y };
    }
  }
  return { y0: sections[0].y, levels };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Центр и радиус в направлении точки, с интерполяцией между уровнями и углами.
 * out — необязательный объект для ответа (в горячих циклах без лишних объектов).
 */
function sample(table, y, x, z, out = {}) {
  const { y0, levels } = table;
  const f = Math.min(Math.max((y - y0) / STEP, 0), levels.length - 1);
  const i = Math.min(Math.floor(f), levels.length - 2 < 0 ? 0 : levels.length - 2);
  const t = levels.length > 1 ? f - i : 0;
  const L0 = levels[i];
  const L1 = levels[Math.min(i + 1, levels.length - 1)];
  const cx = lerp(L0.cx, L1.cx, t);
  const cz = lerp(L0.cz, L1.cz, t);
  let ang = Math.atan2(z - cz, x - cx);
  if (ang < 0) ang += Math.PI * 2;
  const g = (ang / (Math.PI * 2)) * ANGLES;
  const k0 = Math.floor(g) % ANGLES;
  const k1 = (k0 + 1) % ANGLES;
  const u = g - Math.floor(g);
  const r0 = lerp(L0.r[k0], L0.r[k1], u);
  const r1 = lerp(L1.r[k0], L1.r[k1], u);
  out.cx = cx;
  out.cz = cz;
  out.r = lerp(r0, r1, t);
  out.perimeter = lerp(L0.perimeter, L1.perimeter, t);
  return out;
}

function averagePoint(positions, ids) {
  const p = [0, 0, 0];
  ids.forEach((i) => { for (let c = 0; c < 3; c++) p[c] += positions[3 * i + c]; });
  return p.map((v) => v / ids.length);
}

/** Расстояние от точки (px, py, pz) до отрезка ab и параметр проекции t (без создания объектов). */
function segDist(px, py, pz, a, b, out) {
  const abx = b[0] - a[0]; const aby = b[1] - a[1]; const abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / len2 : 0;
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  out.t = t;
  out.d = Math.hypot(px - (a[0] + abx * tc), py - (a[1] + aby * tc), pz - (a[2] + abz * tc));
}

/**
 * Капсула руки: отрезки плечо → локоть → запястье и радиусы по вершинам руки:
 * r — 85-й процентиль (с дельтой и подмышкой, для выталкивания ткани),
 * m — медиана (сама рука, чтобы отличить рукав от торса рядом с рукой).
 */
function armCapsule(positions, armIdx, side, landmarks) {
  const a = averagePoint(positions, landmarks[`shoulder_${side}`]);
  const b = averagePoint(positions, landmarks[`elbow_${side}`]);
  const c = averagePoint(positions, landmarks[`wrist_${side}`]);
  const upper = new Float32Array(armIdx.length);
  const lower = new Float32Array(armIdx.length);
  let nu = 0;
  let nl = 0;
  const s1 = {};
  const s2 = {};
  for (let k = 0; k < armIdx.length; k++) {
    const i = armIdx[k];
    const px = positions[3 * i]; const py = positions[3 * i + 1]; const pz = positions[3 * i + 2];
    segDist(px, py, pz, a, b, s1);
    segDist(px, py, pz, b, c, s2);
    if (s1.t > 0 && s1.t < 1 && s1.d < s2.d) upper[nu++] = s1.d;
    else if (s2.t > 0 && s2.t < 1) lower[nl++] = s2.d;
  }
  const q = (arr, n, k) => (n ? arr.subarray(0, n).sort()[Math.floor(n * k)] : 0.035);
  return { a, b, c, r1: q(upper, nu, 0.85), r2: q(lower, nl, 0.85), m1: q(upper, nu, 0.5), m2: q(lower, nl, 0.5) };
}

export function segmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = len2 > 0 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2 : 0;
  const tc = Math.min(Math.max(t, 0), 1);
  const q = [a[0] + ab[0] * tc, a[1] + ab[1] * tc, a[2] + ab[2] * tc];
  return { t, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), q };
}

/**
 * Форма болванки в текущей фигуре.
 * @param {object} body
 * @param {Float32Array} body.positions — вершины с морфами (x, y, z подряд), Y вверх, метры
 * @param {Uint32Array|Uint16Array|number[]} body.index — треугольники
 * @param {Uint8Array} body.part — PART.* для каждой вершины (по весам скелета)
 * @param {object} body.landmarks — номера вершин ориентиров (avatarCalibration.json → landmarks)
 * @param {number} body.waistLevel, body.hipLevel — доли расстояния пах → соски
 */
export function meshBodyShape({ positions, index, part, landmarks, waistLevel, hipLevel }) {
  const P = (ids) => averagePoint(positions, ids);
  let floor = Infinity;
  let top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    floor = Math.min(floor, positions[i]);
    top = Math.max(top, positions[i]);
  }
  const nipple = (P(landmarks.nipple_l)[1] + P(landmarks.nipple_r)[1]) / 2;
  const crotch = P(landmarks.crotch)[1];
  const span = nipple - crotch;
  const waist = crotch + waistLevel * span;
  const hips = crotch + hipLevel * span;
  const shL = P(landmarks.shoulder_l);
  const shR = P(landmarks.shoulder_r);
  const neck = P(landmarks.cervicale)[1];
  // «плечи» для посадки — как у BodyAvatar: верх плечевого пояса, между плечевой
  // точкой у руки и шейным позвонком (туда ложится верх футболки или платья)
  const shoulder = ((shL[1] + shR[1]) / 2 + neck) / 2;

  // треугольники по частям тела: торс без рук; ноги
  const torsoTris = [];
  const legTris = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]; const b = index[t + 1]; const c = index[t + 2];
    if (part[a] !== PART.ARM && part[b] !== PART.ARM && part[c] !== PART.ARM) torsoTris.push(a, b, c);
    if (part[a] === PART.LEG && part[b] === PART.LEG && part[c] === PART.LEG) legTris.push(a, b, c);
  }
  const ankle = floor + 0.09 * (crotch - floor);
  const torso = buildLevels(sectionsByLevel(positions, torsoTris, crotch + 0.005, neck));
  const legSections = sectionsByLevel(positions, legTris, ankle, crotch);
  const legL = buildLevels(legSections, (x) => x > 0);   // +X — левая сторона тела
  const legR = buildLevels(legSections, (x) => x < 0);
  const legs = buildLevels(legSections);

  const tables = { torso, legL, legR, legs };

  // вершины рук по сторонам (+X — левая сторона тела)
  const armIdx = { l: [], r: [] };
  for (let i = 0; i < part.length; i++) {
    if (part[i] === PART.ARM) armIdx[positions[3 * i] > 0 ? 'l' : 'r'].push(i);
  }
  return {
    kind: 'mesh',
    landmarks: {
      height: top - floor,
      shoulderWidth: Math.hypot(shL[0] - shR[0], shL[2] - shR[2]),
      ankle,
      knee: floor + 0.55 * (crotch - floor),
      thighTop: crotch,
      hips,
      waist,
      chest: nipple,
      shoulder,
      neck,
      headTop: top,
    },
    zone: { low: crotch, high: neck },
    levels: { crotch, chest: nipple, waist, hips, ankle },
    surfaceAt(y, x, z, region = 'torso', out = undefined) {
      return sample(tables[region] || torso, y, x, z, out);
    },
    girthAt(y, region = 'torso') {
      return sample(tables[region] || torso, y, 1, 0).perimeter;
    },
    arms: ['l', 'r'].map((side) => armCapsule(positions, armIdx[side], side, landmarks)),
  };
}

/** Экспорт для тестов. */
export const _internal = { ellipseFromPerimeter, resolveProfile, bodySections, bodyAxesAtHeight, bodyRadiusAt, hull, polarTable };
