// client/src/components/BaseAvatar.jsx
//
// Болванка base_avatar.glb (MPFB/MakeHuman, CC0), подогнанная под обмеры.
//
// Значения морфов подбирает utils/avatarMorphs.js по таблице калибровки;
// сюда приходит готовое решение (solution.weights — веса 16 ключей).
// Модель в метрах, ступни на полу, центр на оси — как у BodyAvatar, поэтому
// normalizeModel к ней не применяется: масштаб сломал бы калибровку.
//
// Решает, показывать ли болванку, utils/avatarBody.js: вне калиброванного
// диапазона там остаётся BodyAvatar.

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createBodyMaterial, setSkinTone } from '../utils/bodyMaterial';
import { avatarLevels } from '../utils/avatarMorphs';
import { ellipseFromPerimeter } from './BodyAvatar';

const _p = new THREE.Vector3();

/** Точка меша с учётом морфов, в координатах корня модели. */
function vertexAt(mesh, root, index, target = new THREE.Vector3()) {
  mesh.getVertexPosition(index, target);
  return root.worldToLocal(mesh.localToWorld(target));
}

function averageAt(mesh, root, indices) {
  const sum = new THREE.Vector3();
  indices.forEach((i) => sum.add(vertexAt(mesh, root, i, _p)));
  return sum.multiplyScalar(1 / indices.length);
}

/** Уровни груди, талии и бёдер — те же, по которым калибровались обмеры. */
function bodyLevels(mesh, root) {
  const { waistLevel, hipLevel, landmarks } = avatarLevels();
  const nipple = averageAt(mesh, root, [...landmarks.nipple_l, ...landmarks.nipple_r]).y;
  const crotch = averageAt(mesh, root, landmarks.crotch).y;
  const span = nipple - crotch;
  return { chest: nipple, waist: crotch + waistLevel * span, hips: crotch + hipLevel * span };
}

/** Центр торса по глубине на каждом уровне — чтобы кольцо обхватывало тело, а не ось. */
function torsoCentersZ(mesh, root, levels) {
  const count = mesh.geometry.attributes.position.count;
  const range = Object.fromEntries(Object.keys(levels).map((k) => [k, [Infinity, -Infinity]]));
  for (let i = 0; i < count; i++) {
    vertexAt(mesh, root, i, _p);
    if (Math.abs(_p.x) > 0.22) continue;          // руки и кисти в A-позе
    Object.entries(levels).forEach(([k, y]) => {
      if (Math.abs(_p.y - y) < 0.01) {
        range[k][0] = Math.min(range[k][0], _p.z);
        range[k][1] = Math.max(range[k][1], _p.z);
      }
    });
  }
  return Object.fromEntries(Object.entries(range).map(([k, [a, b]]) => [k, Number.isFinite(a) ? (a + b) / 2 : 0]));
}

export default function BaseAvatar({ body, solution, skinTone, profile, stressMap = null, onHeight }) {
  const { scene } = body;      // загружена один раз (utils/avatarBody.js)

  // свой экземпляр на каждое окно: морфы у нескольких аватаров на странице не мешают друг другу
  const { root, mesh, material } = useMemo(() => {
    const clone = cloneSkinned(scene);
    let skinned = null;
    clone.traverse((o) => { if (o.isSkinnedMesh) skinned = o; });
    const mat = createBodyMaterial({ underwear: 'attribute' });
    skinned.material = mat;
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    return { root: clone, mesh: skinned, material: mat };
  }, [scene]);

  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => { setSkinTone(material, skinTone); }, [material, skinTone]);

  const [rings, setRings] = useState(null);

  useLayoutEffect(() => {
    const dict = mesh.morphTargetDictionary;
    Object.entries(solution.weights).forEach(([key, w]) => {
      mesh.morphTargetInfluences[dict[key]] = w;
    });
    // габариты skinned-меша three.js запоминает — без пересчёта FitCamera
    // кадрировал бы нейтральную фигуру. Матрицы костей нужны до пересчёта:
    // до первого кадра они ещё не обновлены.
    root.updateMatrixWorld(true);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    onHeight?.((mesh.boundingBox.max.y - mesh.boundingBox.min.y) * 100);

    if (stressMap) {
      const levels = bodyLevels(mesh, root);
      setRings({ levels, centers: torsoCentersZ(mesh, root, levels) });
    } else {
      setRings(null);
    }
  }, [mesh, root, solution, stressMap, onHeight]);

  return (
    <group>
      <primitive object={root} />

      {/* Кольца натяжения — на тех же уровнях, где калибровались обмеры */}
      {/* stressMap мог уже исчезнуть (сняли вещь), а кольца — ещё с прошлого кадра */}
      {rings && stressMap && Object.entries(stressMap).map(([key, hex]) => {
        const y = rings.levels[key];
        const per = Number(profile?.[key]);
        if (y == null || !per) return null;
        const { a, b } = ellipseFromPerimeter(per * 1.03, 0.7);
        const r = (a + b) / 2;
        return (
          <mesh key={key} position={[0, y, rings.centers[key]]} rotation={[Math.PI / 2, 0, 0]} scale={[a / r, b / r, 1]}>
            <torusGeometry args={[r, 0.012, 8, 48]} />
            <meshBasicMaterial color={hex} transparent opacity={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}
