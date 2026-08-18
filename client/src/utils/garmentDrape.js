// client/src/utils/garmentDrape.js
//
// Прижатие одежды к телу (аналог shrinkwrap, но без Blender).
//
// Наше тело задано формулой, а не полигонами — поэтому для любой точки
// пространства мы можем ТОЧНО посчитать, где проходит поверхность тела.
// Это позволяет прижать вершины одежды к телу прямо в браузере, мгновенно.
//
// ВАЖНО: математика сечений должна совпадать с BodyAvatar.jsx.
// Если меняете пропорции там — обновите и здесь.

import * as THREE from 'three';

// ── форма тела (копия логики BodyAvatar) ───────────────────────

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

/**
 * Полуоси тела на заданной высоте (линейная интерполяция между сечениями).
 * Возвращает { a, b } — полуширина и полуглубина в метрах.
 */
function bodyAxesAtHeight(sections, yPos) {
  if (yPos <= sections[0].y) {
    return ellipseFromPerimeter(sections[0].per, sections[0].ratio);
  }
  const last = sections[sections.length - 1];
  if (yPos >= last.y) {
    return ellipseFromPerimeter(last.per, last.ratio);
  }

  for (let i = 0; i < sections.length - 1; i++) {
    const s0 = sections[i];
    const s1 = sections[i + 1];
    if (yPos >= s0.y && yPos <= s1.y) {
      const t = (yPos - s0.y) / (s1.y - s0.y);
      const per = s0.per + (s1.per - s0.per) * t;
      const ratio = s0.ratio + (s1.ratio - s0.ratio) * t;
      return ellipseFromPerimeter(per, ratio);
    }
  }
  return ellipseFromPerimeter(last.per, last.ratio);
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

// ── прижатие одежды ────────────────────────────────────────────

/**
 * Зазор между телом и тканью по типу вещи (в метрах).
 * Свободная вещь висит дальше от тела, облегающая — ближе.
 */
const EASE_BY_FIT = {
  tight: 0.004,
  regular: 0.010,
  loose: 0.022,
};

const LAYER_STEP = 0.008; // каждый следующий слой дальше от тела

/**
 * Прижимает вершины одежды к телу.
 *
 * Вершины, оказавшиеся ВНУТРИ тела, выталкиваются на поверхность + зазор.
 * Вершины, висящие слишком далеко, притягиваются (частично, чтобы
 * сохранить силуэт — рукава и подол не должны прилипнуть к торсу).
 *
 * @param {THREE.Object3D} garmentRoot — корень одежды (после масштабирования)
 * @param {object} profile — обмеры покупателя
 * @param {object} opts
 * @param {string} opts.fit — tight | regular | loose
 * @param {number} opts.layer — номер слоя (0 = ближе к телу)
 * @param {number} opts.pullStrength — 0..1, насколько притягивать далёкие вершины
 * @returns {object} статистика: сколько вершин двинулось
 */
export function drapeGarment(garmentRoot, profile, opts = {}) {
  const {
    fit = 'regular',
    layer = 0,
    pullStrength = 0.55,
  } = opts;

  const P = resolveProfile(profile);
  const sections = bodySections(P);
  const gap = (EASE_BY_FIT[fit] ?? EASE_BY_FIT.regular) + layer * LAYER_STEP;

  // границы зоны, где прижимаем: торс. Ниже бёдер и выше плеч не трогаем,
  // иначе подол и воротник деформируются.
  const yLow = P.y.hips - 0.06;
  const yHigh = P.y.shoulder + 0.02;

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

      const bodyR = bodyRadiusAt(sections, worldPos.y, worldPos.x, worldPos.z);
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

/** Экспорт для тестов и переиспользования */
export const _internal = {
  ellipseFromPerimeter,
  resolveProfile,
  bodySections,
  bodyAxesAtHeight,
  bodyRadiusAt,
};
