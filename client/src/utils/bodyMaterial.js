// client/src/utils/bodyMaterial.js
//
// Общий материал тела для BodyAvatar и BaseAvatar: тон кожи из токенов
// --skin-N и нейтральное бельё (топ-бандо и трусы) цвета --underwear.
//
// Бельё — это окраска тела, а не отдельная вещь: геометрия не меняется,
// поэтому одежда садится на тело как раньше.
//
// Где бельё — задаёт «расстояние со знаком» до его края (м, > 0 — внутри):
//   mode 'attribute' — у болванки оно запечено в вершины (атрибут _underwear,
//                      см. scripts/avatar/build_avatar.py) и едет вместе с морфами;
//   mode 'bands'     — у процедурного тела считается по высоте: два пояса
//                      [низ трусов, верх трусов] и [низ топа, верх топа];
//   mode 'none'      — без белья (руки, голова).
// Край получается чётким независимо от размера треугольников.

import * as THREE from 'three';
import { DEFAULT_SKIN_TONE, isSkinTone } from './skinTones';

/** Значение CSS-токена, например cssToken('--underwear') → '#9EA3AA'. */
export function cssToken(name) {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Цвет токена; без загруженного CSS (тесты) — белый по умолчанию THREE.Color. */
function tokenColor(name) {
  const value = cssToken(name);
  return value ? new THREE.Color(value) : new THREE.Color();
}

export function skinColor(toneKey) {
  return tokenColor(`--${isSkinTone(toneKey) ? toneKey : DEFAULT_SKIN_TONE}`);
}

const EDGE = '0.0015';   // полуширина края белья, м

/**
 * @param {object} opts
 * @param {'attribute'|'bands'|'none'} opts.underwear
 * @param {string} opts.skinTone — ключ skin-1 … skin-10
 * @param {number[]} [opts.bands] — для 'bands': [низ трусов, верх трусов, низ топа, верх топа], м
 */
export function createBodyMaterial({ underwear = 'none', skinTone = DEFAULT_SKIN_TONE, bands = [0, 0, 0, 0] } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: skinColor(skinTone),
    roughness: 0.6,
    metalness: 0.0,
  });
  if (underwear === 'none') return material;

  const uniforms = {
    uUnderwearColor: { value: tokenColor('--underwear') },
    uBands: { value: new THREE.Vector4(...bands) },
  };
  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const varying = underwear === 'attribute' ? 'varying float vUnderwear;' : 'varying float vBodyY;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${underwear === 'attribute' ? 'attribute float _underwear;\n' : ''}${varying}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${underwear === 'attribute' ? 'vUnderwear = _underwear;' : 'vBodyY = transformed.y;'}`);

    const distance = underwear === 'attribute'
      ? 'float uwDist = vUnderwear;'
      : 'float uwDist = max(min(vBodyY - uBands.x, uBands.y - vBodyY), min(vBodyY - uBands.z, uBands.w - vBodyY));';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uUnderwearColor;\nuniform vec4 uBands;\n${varying}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${distance}\nfloat uw = smoothstep(-${EDGE}, ${EDGE}, uwDist);\ndiffuseColor.rgb = mix(diffuseColor.rgb, uUnderwearColor, uw);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, uw);');
  };
  material.customProgramCacheKey = () => `silk-body-underwear-${underwear}`;
  return material;
}

/** Сменить тон кожи у готового материала. */
export function setSkinTone(material, toneKey) {
  material.color.copy(skinColor(toneKey));
}

/** Сменить пояса белья у материала 'bands' (процедурное тело меняет пропорции). */
export function setUnderwearBands(material, bands) {
  material.userData.uniforms?.uBands.value.set(...bands);
}
