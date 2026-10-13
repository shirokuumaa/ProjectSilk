// client/src/utils/baseBody.js
//
// Болванка base_avatar.glb как данные для расчётов: вершины, смещения 16 ключей,
// треугольники, части тела по весам скелета, форма тела в фигуре покупателя.
// Без загрузчика и React — работает и в браузере, и в тестах/прогонах.

import calibration from '../data/avatarCalibration.json';
import { PART, meshBodyShape } from './bodyShape';
import { mark, now } from './garmentDrape';

const ARM_BONE = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
const LEG_BONE = /^(thigh|calf|foot|ball)_/;

/** Части тела по весам скелета: рука, если на кости руки больше половины веса (как в калибровке). */
export function bodyParts(skinIndex, skinWeight, boneNames) {
  const part = new Uint8Array(skinIndex.length / 4);
  for (let v = 0; v < part.length; v++) {
    let arm = 0;
    let leg = 0;
    for (let k = 0; k < 4; k++) {
      const name = boneNames[skinIndex[4 * v + k]] || '';
      const w = skinWeight[4 * v + k];
      if (ARM_BONE.test(name)) arm += w;
      else if (LEG_BONE.test(name)) leg += w;
    }
    part[v] = arm > 0.5 ? PART.ARM : leg > 0.5 ? PART.LEG : PART.TORSO;
  }
  return part;
}

/** Данные болванки для расчётов формы: вершины, смещения 16 ключей, треугольники, части тела. */
export function prepareBaseBody({ positions, morphs, index, skinIndex, skinWeight, boneNames, scene = null }) {
  return {
    scene,
    base: positions,
    deltas: calibration.keys.map((k) => morphs[k]),
    index,
    part: bodyParts(skinIndex, skinWeight, boneNames),
  };
}

/** Вершины болванки с морфами фигуры. */
export function morphedPositions(body, weights) {
  const out = new Float32Array(body.base);
  calibration.keys.forEach((key, i) => {
    const w = weights[key];
    if (!w) return;
    const d = body.deltas[i];
    for (let j = 0; j < out.length; j++) out[j] += w * d[j];
  });
  return out;
}

const shapeCache = new Map();

/** Форма болванки для решения подбора морфов (кэш по весам ключей). */
export function baseBodyShape(body, solution) {
  const key = calibration.keys.map((k) => solution.weights[k].toFixed(5)).join(',');
  if (!shapeCache.has(key)) {
    const t0 = now();
    shapeCache.set(key, meshBodyShape({
      positions: morphedPositions(body, solution.weights),
      index: body.index,
      part: body.part,
      landmarks: calibration.landmarks,
      waistLevel: calibration.waistLevel,
      hipLevel: calibration.hipLevel,
    }));
    shapeCache.get(key).buildMs = mark('body shape', t0);
    if (shapeCache.size > 8) shapeCache.delete(shapeCache.keys().next().value);
  }
  return shapeCache.get(key);
}
