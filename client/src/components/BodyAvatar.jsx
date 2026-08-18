// client/src/components/BodyAvatar.jsx
//
// Аватар, построенный ПРЯМО ИЗ ОБМЕРОВ покупателя.
// Никакого GLB-файла, никакого Blender, никакого GPU.
//
// Принцип: тело — это набор горизонтальных сечений по высоте.
// Обхват груди 92 см → на уровне груди строим сечение периметром ровно 92 см.
// Поэтому аватар не «примерно похож», а математически точен по замерам.
//
// Использование:
//   <BodyAvatar profile={{ heightCm: 170, chest: 92, waist: 76, hips: 98 }} />
//   <BodyAvatar profile={p} stressMap={{ chest: '#e03131' }} />

import React, { useMemo } from 'react';
import * as THREE from 'three';

// ── геометрия сечений ──────────────────────────────────────────

/**
 * Полуоси эллипса по заданному периметру.
 * ratio = глубина / ширина (тело не круглое в сечении).
 * Периметр эллипса — приближение Рамануджана.
 */
function ellipseFromPerimeter(perimeterCm, ratio = 0.72) {
  const p = perimeterCm / 100; // в метры
  // подбираем a так, чтобы периметр совпал
  let a = p / (2 * Math.PI); // начальное приближение (круг)
  for (let i = 0; i < 12; i++) {
    const b = a * ratio;
    const h = ((a - b) ** 2) / ((a + b) ** 2);
    const per = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    a *= p / per;
  }
  return { a, b: a * ratio };
}

/** Точки одного сечения в мировых координатах */
function ringPoints(y, perimeterCm, segments, ratio, offsetX = 0, offsetZ = 0) {
  const { a, b } = ellipseFromPerimeter(perimeterCm, ratio);
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(
      offsetX + Math.cos(t) * a,
      y,
      offsetZ + Math.sin(t) * b
    ));
  }
  return pts;
}

/** Сшивает кольца в единую поверхность */
function buildSurface(rings, segments, close = true) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  rings.forEach((ring, r) => {
    ring.forEach((p, i) => {
      positions.push(p.x, p.y, p.z);
      const n = new THREE.Vector3(p.x, 0, p.z).normalize();
      normals.push(n.x, 0.15, n.z);
      uvs.push(i / segments, r / (rings.length - 1));
    });
  });

  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = r * segments + i;
      const b = r * segments + next;
      const c = (r + 1) * segments + i;
      const d = (r + 1) * segments + next;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // крышки сверху и снизу
  if (close) {
    const capTop = positions.length / 3;
    const topRing = rings[rings.length - 1];
    const cx = topRing.reduce((s, p) => s + p.x, 0) / segments;
    const cz = topRing.reduce((s, p) => s + p.z, 0) / segments;
    positions.push(cx, topRing[0].y, cz);
    normals.push(0, 1, 0);
    uvs.push(0.5, 1);
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      indices.push((rings.length - 1) * segments + i, capTop, (rings.length - 1) * segments + next);
    }

    const capBot = positions.length / 3;
    const botRing = rings[0];
    const bx = botRing.reduce((s, p) => s + p.x, 0) / segments;
    const bz = botRing.reduce((s, p) => s + p.z, 0) / segments;
    positions.push(bx, botRing[0].y, bz);
    normals.push(0, -1, 0);
    uvs.push(0.5, 0);
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      indices.push(i, next, capBot);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── антропометрия ──────────────────────────────────────────────

/**
 * Пропорции тела как доли роста (усреднённые антропометрические данные).
 * Если обмер не задан — оцениваем от роста.
 */
function resolveProfile(p = {}) {
  const H = (Number(p.heightCm) || 170) / 100; // метры

  const chest = Number(p.chest) || (H * 100) * 0.53;
  const waist = Number(p.waist) || (H * 100) * 0.42;
  const hips = Number(p.hips) || (H * 100) * 0.55;
  const shoulderW = (Number(p.shoulderWidth) || (H * 100) * 0.245) / 100;

  return {
    H,
    chest, waist, hips,
    shoulderW,
    // уровни по высоте (доли роста)
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

// ── компонент ──────────────────────────────────────────────────

const SEG = 32;

export default function BodyAvatar({
  profile = {},
  color = '#d8c3a5',
  stressMap = null,      // { chest: '#e03131', waist: '#2f9e44', ... }
  wireframe = false,
}) {
  const parts = useMemo(() => {
    const P = resolveProfile(profile);
    const { y } = P;

    // ── торс: от бёдер до шеи ──
    const torsoRings = [
      ringPoints(y.hips - 0.02, P.hips, SEG, 0.75),
      ringPoints(y.hips + 0.04, P.hips * 0.98, SEG, 0.75),
      ringPoints(y.waist, P.waist, SEG, 0.72),
      ringPoints(y.chest - 0.04, (P.waist + P.chest) / 2, SEG, 0.7),
      ringPoints(y.chest, P.chest, SEG, 0.68),
      ringPoints(y.chest + 0.06, P.chest * 0.96, SEG, 0.66),
      ringPoints(y.shoulder, P.chest * 0.92, SEG, 0.62),
      ringPoints(y.neck, P.chest * 0.42, SEG, 0.85),
    ];
    const torso = buildSurface(torsoRings, SEG);

    // ── таз и ноги ──
    const legGap = P.hips / 100 / 8;
    const thighPer = P.hips * 0.58;
    const kneePer = P.hips * 0.36;
    const anklePer = P.hips * 0.22;

    const makeLeg = (side) => {
      const dx = side * legGap;
      return buildSurface([
        ringPoints(y.ankle, anklePer, SEG, 0.8, dx),
        ringPoints(y.knee, kneePer, SEG, 0.85, dx),
        ringPoints(y.thighTop, thighPer, SEG, 0.9, dx),
        ringPoints(y.hips - 0.01, thighPer * 1.05, SEG, 0.9, dx * 0.6),
      ], SEG);
    };

    // ── руки ──
    const armPerTop = P.chest * 0.32;
    const armPerElbow = P.chest * 0.26;
    const armPerWrist = P.chest * 0.17;
    const armX = P.shoulderW / 2 + 0.02;

    const makeArm = (side) => {
      const dx = side * armX;
      return buildSurface([
        ringPoints(y.waist - 0.04, armPerWrist, SEG, 0.9, dx * 1.06),
        ringPoints(y.waist + 0.12, armPerElbow, SEG, 0.9, dx * 1.03),
        ringPoints(y.shoulder - 0.02, armPerTop, SEG, 0.9, dx),
      ], SEG);
    };

    // ── голова ──
    const headR = P.H * 0.065;
    const headGeo = new THREE.SphereGeometry(headR, 24, 20);
    headGeo.scale(1, 1.22, 0.94);

    return {
      torso,
      legL: makeLeg(-1),
      legR: makeLeg(1),
      armL: makeArm(-1),
      armR: makeArm(1),
      head: headGeo,
      headY: y.neck + headR * 1.15,
      neckY: y.neck,
      neckR: headR * 0.42,
      heights: y,
      P,
    };
  }, [
    profile?.heightCm, profile?.chest, profile?.waist,
    profile?.hips, profile?.shoulderWidth, profile?.inseam,
    profile?.skinTone, // <- добавлено
  ]);

  const skin = profile.skinTone && profile.skinTone.startsWith('#')
    ? profile.skinTone
    : color;

  const mat = (c = skin) => (
    <meshStandardMaterial
      color={c}
      roughness={0.85}
      metalness={0.02}
      wireframe={wireframe}
      side={THREE.DoubleSide}
    />
  );

  return (
    <group>
      <mesh geometry={parts.torso} castShadow receiveShadow>{mat()}</mesh>
      <mesh geometry={parts.legL} castShadow>{mat()}</mesh>
      <mesh geometry={parts.legR} castShadow>{mat()}</mesh>
      <mesh geometry={parts.armL} castShadow>{mat()}</mesh>
      <mesh geometry={parts.armR} castShadow>{mat()}</mesh>

      {/* шея */}
      <mesh position={[0, parts.neckY + 0.03, 0]}>
        <cylinderGeometry args={[parts.neckR, parts.neckR * 1.1, 0.09, 20]} />
        {mat()}
      </mesh>

      <mesh geometry={parts.head} position={[0, parts.headY, 0]} castShadow>
        {mat()}
      </mesh>

      {/* Кольца натяжения: подсветка проблемных зон при примерке */}
      {stressMap && Object.entries(stressMap).map(([key, hex]) => {
        const level =
          key === 'chest' ? parts.heights.chest :
          key === 'waist' ? parts.heights.waist :
          key === 'hips'  ? parts.heights.hips  : null;
        if (level == null) return null;

        const per =
          key === 'chest' ? parts.P.chest :
          key === 'waist' ? parts.P.waist : parts.P.hips;
        const { a, b } = ellipseFromPerimeter(per * 1.03, key === 'hips' ? 0.75 : 0.7);

        return (
          <mesh key={key} position={[0, level, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[(a + b) / 2, 0.012, 8, 48]} />
            <meshBasicMaterial color={hex} transparent opacity={0.85} />
            <group scale={[a / ((a + b) / 2), b / ((a + b) / 2), 1]} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Высоты ключевых уровней — нужны для позиционирования одежды */
export function getBodyLandmarks(profile) {
  const P = resolveProfile(profile);
  return {
    height: P.H,
    shoulderWidth: P.shoulderW,
    ...P.y,
  };
}
