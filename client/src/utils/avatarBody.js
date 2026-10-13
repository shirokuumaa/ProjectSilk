// client/src/utils/avatarBody.js
//
// Какое тело в сцене и какой он формы — одно решение на тело и на одежду.
//
//   useAvatarBody(profile) → { kind, reason, shape, solution?, body? }
//     kind 'standard' — процедурное BodyAvatar (режим по умолчанию, фигура вне
//                       калиброванного диапазона, болванка не загрузилась);
//     kind 'base'     — болванка base_avatar.glb в фигуре покупателя;
//     kind 'loading'  — болванка ещё грузится (ни тело, ни одежду не рисуем).
//   shape — форма тела для подгонки одежды (utils/bodyShape.js).
//
// Болванка грузится один раз на страницу; форма тела кэшируется по фигуре,
// поэтому тело и все надетые вещи всегда считаются для одной и той же фигуры.

import { useEffect, useMemo, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useAvatarMode } from './avatarMode';
import { solveAvatar } from './avatarMorphs';
import { proceduralBodyShape } from './bodyShape';
import { baseBodyShape, prepareBaseBody } from './baseBody';

export const BASE_AVATAR_URL = '/models/base_avatar.glb';

let loading = null;
let loaded = null;
let failed = null;

function prepareFromGltf(gltf) {
  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  const g = mesh.geometry;
  const morphs = {};
  Object.entries(mesh.morphTargetDictionary).forEach(([name, i]) => { morphs[name] = g.morphAttributes.position[i].array; });
  return prepareBaseBody({
    positions: g.attributes.position.array,
    morphs,
    index: g.index.array,
    skinIndex: g.attributes.skinIndex.array,
    skinWeight: g.attributes.skinWeight.array,
    boneNames: mesh.skeleton.bones.map((b) => b.name),
    scene: gltf.scene,
  });
}

export function loadBaseAvatar() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(BASE_AVATAR_URL).then(
      (gltf) => { loaded = prepareFromGltf(gltf); return loaded; },
      (error) => { failed = error; console.warn('[avatar] base avatar failed to load:', error?.message); throw error; },
    );
  }
  return loading;
}

export function profileKey(profile) {
  return [
    profile?.heightCm, profile?.chest, profile?.waist, profile?.hips,
    profile?.shoulderWidth, profile?.armLength, profile?.inseam,
  ].join('|');
}

export function useAvatarBody(profile) {
  const mode = useAvatarMode();
  const key = profileKey(profile);
  /* eslint-disable react-hooks/exhaustive-deps */
  const solution = useMemo(() => (mode === 'base' ? solveAvatar(profile) : null), [mode, key]);
  const standard = useMemo(() => proceduralBodyShape(profile), [key]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [, rerender] = useState(0);
  const wantBase = mode === 'base' && !!solution?.inRange;

  useEffect(() => {
    if (!wantBase || loaded || failed) return undefined;
    let alive = true;
    loadBaseAvatar().then(() => alive && rerender((n) => n + 1), () => alive && rerender((n) => n + 1));
    return () => { alive = false; };
  }, [wantBase]);

  const shape = useMemo(
    () => (wantBase && loaded ? baseBodyShape(loaded, solution) : null),
    [wantBase, solution, loaded], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (mode !== 'base') return { kind: 'standard', reason: null, shape: standard };
  if (!solution.inRange) return { kind: 'standard', reason: solution.reason, shape: standard };
  if (failed) return { kind: 'standard', reason: 'error', shape: standard };
  if (!loaded || !shape) return { kind: 'loading', reason: null, shape: null };
  return { kind: 'base', reason: null, shape, solution, body: loaded };
}
