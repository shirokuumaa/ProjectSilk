// client/src/utils/avatarMorphs.js
//
// Обмеры покупателя (см) → значения морфов болванки base_avatar.glb.
//
// Таблица калибровки — client/src/data/avatarCalibration.json, её строит
// scripts/avatar/calibrate.py. Здесь тот же подбор, что там (функция solve):
// модель «веса ключей → сантиметры» (многочлен 2-й степени), несколько
// итераций линейной поправки (Гаусс–Ньютон) с границами морфов и слабой
// регуляризацией. Совпадение с Python проверяет avatarMorphs.test.js.
//
// Если после подбора хоть один обмер расходится больше чем на
// range.acceptResidualCm, фигура вне диапазона — показываем BodyAvatar.

import defaultCalibration from '../data/avatarCalibration.json';

/** Поле BodyProfile для каждого обмера калибровки. */
const PROFILE_FIELD = {
  height: 'heightCm',
  bust: 'chest',
  waist: 'waist',
  hips: 'hips',
  shoulder: 'shoulderWidth',
  arm_length: 'armLength',
  inseam: 'inseam',
};

/** Без этих обмеров болванку не строим. */
const REQUIRED = ['height', 'bust', 'waist', 'hips'];

const FD_STEP = 1e-3;

/** 8 значений морфов → 16 весов ключей (u > 0 → _incr, u < 0 → _decr). */
export function keyWeights(u) {
  const k = new Array(u.length * 2);
  for (let i = 0; i < u.length; i++) {
    k[2 * i] = Math.max(u[i], 0);
    k[2 * i + 1] = Math.max(-u[i], 0);
  }
  return k;
}

/** Модель калибровки: значения морфов → обмеры (в порядке calibration.measures). */
function makeModel(cal) {
  const { pairs, coefficients } = cal.surrogate;
  const coef = cal.measures.map((m) => coefficients[m]);
  const n = cal.keys.length;
  return (u) => {
    const k = keyWeights(u);
    const f = new Array(1 + n + pairs.length);
    f[0] = 1;
    for (let i = 0; i < n; i++) f[1 + i] = k[i];
    for (let p = 0; p < pairs.length; p++) f[1 + n + p] = k[pairs[p][0]] * k[pairs[p][1]];
    return coef.map((c) => {
      let s = 0;
      for (let i = 0; i < f.length; i++) s += c[i] * f[i];
      return s;
    });
  };
}

/** Наименьшие квадраты через QR (Хаусхолдер): min |A x − b|, A — m×n, m ≥ n, полный ранг. */
function lstsq(A, b) {
  const m = A.length;
  const n = A[0].length;
  const R = A.map((row) => row.slice());
  const y = b.slice();
  for (let j = 0; j < n; j++) {
    let norm = 0;
    for (let i = j; i < m; i++) norm += R[i][j] * R[i][j];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = R[j][j] > 0 ? -norm : norm;
    const v = new Array(m).fill(0);
    for (let i = j; i < m; i++) v[i] = R[i][j];
    v[j] -= alpha;
    let vv = 0;
    for (let i = j; i < m; i++) vv += v[i] * v[i];
    if (vv === 0) continue;
    for (let c = j; c < n; c++) {
      let d = 0;
      for (let i = j; i < m; i++) d += v[i] * R[i][c];
      d = (2 * d) / vv;
      for (let i = j; i < m; i++) R[i][c] -= d * v[i];
    }
    let d = 0;
    for (let i = j; i < m; i++) d += v[i] * y[i];
    d = (2 * d) / vv;
    for (let i = j; i < m; i++) y[i] -= d * v[i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let c = i + 1; c < n; c++) s -= R[i][c] * x[c];
    x[i] = s / R[i][i];
  }
  return x;
}

/**
 * Линейная поправка с регуляризацией. Морф, который уже стоит на границе и
 * тянется наружу, фиксируется; шаг остальных укорачивается, чтобы не выйти
 * за границы.
 */
/** Шаг по свободным морфам (остальные стоят на месте). */
function freeStep(J, r, u, lam, free) {
  const A = [
    ...J.map((row) => free.map((i) => row[i])),
    ...free.map((i) => free.map((c) => (c === i ? lam[i] : 0))),
  ];
  const b = [...r, ...free.map((i) => -lam[i] * u[i])];
  const x = lstsq(A, b);
  const du = new Array(u.length).fill(0);
  free.forEach((i, p) => { du[i] = x[p]; });
  return du;
}

function step(J, r, u, lam, lo, hi) {
  const n = u.length;
  const atLo = u.map((v, i) => v <= lo[i] + 1e-12);
  const atHi = u.map((v, i) => v >= hi[i] - 1e-12);
  let free = u.map((_, i) => i);
  let du = freeStep(J, r, u, lam, free);
  for (let pass = 0; pass < n; pass++) {
    const outward = new Set();
    for (const i of free) {
      if ((atLo[i] && du[i] < 0) || (atHi[i] && du[i] > 0)) outward.add(i);
    }
    if (!outward.size) break;
    free = free.filter((i) => !outward.has(i));
    du = freeStep(J, r, u, lam, free);
  }
  let room = Infinity;
  for (let i = 0; i < n; i++) {
    if (du[i] > 0) room = Math.min(room, (hi[i] - u[i]) / du[i]);
    else if (du[i] < 0) room = Math.min(room, (lo[i] - u[i]) / du[i]);
  }
  const scale = Math.min(1, room);
  return du.map((v) => v * scale);
}

/**
 * Подбор морфов под обмеры. targets — { height, bust, ... } в см, null — не задан.
 * Тот же алгоритм, что solve() в scripts/avatar/calibrate.py.
 */
export function solveControls(targets, cal = defaultCalibration, iterations = cal.solver?.iterations ?? 30) {
  const model = makeModel(cal);
  const C = cal.controls;
  const M = cal.measures;
  const lo = C.map((c) => cal.limits[c][0]);
  const hi = C.map((c) => cal.limits[c][1]);
  const lam = C.map((c) => Math.sqrt(cal.solver.regularization[c]));
  const rows = M.map((m, i) => (targets[m] != null ? i : -1)).filter((i) => i >= 0);
  const t = rows.map((i) => Number(targets[M[i]]));
  const pick = (f) => rows.map((i) => f[i]);

  const cost = (u) => {
    const f = pick(model(u));
    let s = 0;
    for (let i = 0; i < f.length; i++) s += (f[i] - t[i]) ** 2;
    for (let i = 0; i < u.length; i++) s += (lam[i] * u[i]) ** 2;
    return s;
  };
  const clip = (u) => u.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));

  // производная обмеров по морфу i — с той стороны, куда он сейчас смотрит
  const side = new Array(C.length).fill(1);
  const column = (u, f, i) => {
    let s = u[i] !== 0 ? Math.sign(u[i]) : side[i];
    if (!(lo[i] <= u[i] + s * FD_STEP && u[i] + s * FD_STEP <= hi[i])) s = -s;
    const e = u.slice();
    e[i] += s * FD_STEP;
    return pick(model(e)).map((v, r) => (v - f[r]) / (s * FD_STEP));
  };
  const add = (u, du, k) => clip(u.map((v, i) => v + du[i] * k));

  let u = new Array(C.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const f = pick(model(u));
    const cols = [];
    for (let i = 0; i < C.length; i++) cols.push(column(u, f, i));
    const J = rows.map((_, r) => cols.map((col) => col[r]));
    const r = t.map((v, i) => v - f[i]);
    let du = step(J, r, u, lam, lo, hi);

    // в нуле пошли в другую сторону — пересчитываем производную с той стороны
    let flipped = false;
    for (let i = 0; i < u.length; i++) {
      if (u[i] === 0 && Math.sign(du[i]) !== side[i] && Math.abs(du[i]) > 1e-9) {
        side[i] *= -1;
        const col = column(u, f, i);
        for (let rr = 0; rr < J.length; rr++) J[rr][i] = col[rr];
        flipped = true;
      }
    }
    if (flipped) du = step(J, r, u, lam, lo, hi);

    // шаг не должен ухудшать результат: иначе делим пополам
    const base = cost(u);
    let cand = null;
    for (let h = 0, k = 1; h < 8; h++, k *= 0.5) {
      const c = add(u, du, k);
      if (cost(c) <= base) { cand = c; break; }
    }
    if (!cand) break;
    let moved = 0;
    for (let i = 0; i < u.length; i++) moved = Math.max(moved, Math.abs(cand[i] - u[i]));
    u = cand;
    if (moved < 1e-5) break;
  }

  const f = model(u);
  const residuals = {};
  rows.forEach((i) => { residuals[M[i]] = f[i] - Number(targets[M[i]]); });
  return { controls: u, predicted: Object.fromEntries(M.map((m, i) => [m, f[i]])), residuals };
}

/** Обмеры из BodyProfile в формате калибровки (см или null). */
export function profileTargets(profile = {}) {
  const out = {};
  Object.entries(PROFILE_FIELD).forEach(([m, field]) => {
    const v = Number(profile?.[field]);
    out[m] = Number.isFinite(v) && v > 0 ? v : null;
  });
  return out;
}

/**
 * Профиль → всё, что нужно BaseAvatar.
 * inRange = false, если не хватает обязательных обмеров или фигура
 * не строится точнее range.acceptResidualCm.
 */
export function solveAvatar(profile, cal = defaultCalibration) {
  const targets = profileTargets(profile);
  const missing = REQUIRED.filter((m) => targets[m] == null);
  if (missing.length) {
    return { inRange: false, reason: 'missing', missing, controls: null, weights: null, residuals: {} };
  }
  const { controls, predicted, residuals } = solveControls(targets, cal);
  const maxResidual = Math.max(...Object.values(residuals).map(Math.abs));
  const k = keyWeights(controls);
  const weights = Object.fromEntries(cal.keys.map((key, i) => [key, k[i]]));
  return {
    inRange: maxResidual <= cal.range.acceptResidualCm,
    reason: maxResidual <= cal.range.acceptResidualCm ? null : 'range',
    controls: Object.fromEntries(cal.controls.map((c, i) => [c, controls[i]])),
    weights,
    predicted,
    residuals,
    maxResidual,
  };
}

/** Уровни (доли расстояния пах → соски) и ориентиры болванки — для колец посадки. */
export function avatarLevels(cal = defaultCalibration) {
  return { waistLevel: cal.waistLevel, hipLevel: cal.hipLevel, landmarks: cal.landmarks };
}
