// client/src/utils/garmentPlacement.js
//
// Посадка вещи на тело в примерке (TryOnAvatar): масштаб по росту фигуры.
// Вынесено из TryOnAvatar.jsx без изменений, чтобы тем же кодом пользовался
// прогон подгонки (scripts/garments). У GlbViewer своя посадка — по ширине;
// свести их в одну — следующий шаг.

import * as THREE from 'three';
import { drapeGarment } from './garmentDrape';
import { pushOutOfBody, transferToFigure } from './sizeModels';
import { accessoryKind, placeAccessory } from './accessoryPlacement';

/**
 * Типы, которые прижимаются к телу как ткань (garmentDrape). Обувь и аксессуары
 * твёрдые: ставятся по росту и не деформируются (решение 17.10, research/patterns/README.md).
 */
export const DRAPED_TYPES = ['top', 'bottom', 'dress', 'outerwear'];

export const isDrapedType = (garmentType) => DRAPED_TYPES.includes(garmentType);

/**
 * Куда садится вещь: верхняя граница и высота, обе в метрах от пола.
 * Считается от реальных обмеров — на высокой фигуре платье длиннее.
 */
export function placementFor(garmentType, L) {
  switch (garmentType) {
    case 'dress':     return { top: L.shoulder,        height: L.shoulder - L.knee };
    case 'outerwear': return { top: L.shoulder + 0.02, height: L.shoulder - L.thighTop };
    case 'bottom':    return { top: L.waist,           height: L.waist - L.ankle };
    case 'shoes':     return { top: L.ankle * 1.6,     height: L.ankle * 1.6 };
    case 'accessory': return { top: L.neck + 0.06,     height: 0.14 };
    case 'top':
    default:          return { top: L.shoulder,        height: L.shoulder - L.hips };
  }
}

/**
 * Масштабирует и ставит вещь: верх — на уровень placementFor.top, высота —
 * placementFor.height, центр по X и Z — на ось тела. Возвращает false,
 * если у вещи нулевая высота.
 */
export function placeByHeight(group, garmentType, landmarks) {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (size.y < 1e-6) return false;

  const place = placementFor(garmentType, landmarks);
  const scale = place.height / size.y;

  group.scale.setScalar(scale);
  group.position.set(
    -center.x * scale,
    place.top - box.max.y * scale,
    -center.z * scale,
  );
  group.updateWorldMatrix(true, true);
  return true;
}

/**
 * Посадка вещи в примерке (TryOnAvatar).
 *  • from — форма фигуры, на которой просимулирована ткань: перенос на фигуру покупателя
 *    (складки сохраняются); transferOnly — дальше только страховка pushOutOfBody;
 *  • обувь и аксессуар известного вида на фигуре-болванке — к точке тела, в масштабе по карточке
 *    товара (accessory) и длине стопы покупателя (utils/accessoryPlacement.js); color — цвет ленты ремня;
 *  • иначе — масштаб по росту; ткань прижимается к телу, твёрдые вещи (обувь, аксессуары) — нет.
 * Перед вызовом геометрия вещи должна быть откачена к исходной (restoreGeometry),
 * а group — к единичной матрице.
 * @returns {'transfer' | 'anchored' | 'rigid' | 'draped' | null} null — у вещи нулевая высота
 */
export function seatGarment(group, root, shape, {
  garmentType, from = null, transferOnly = true, fit, layer, size, legs, accessory = null, footLengthCm, color = null,
} = {}) {
  const kind = accessoryKind(garmentType, accessory);
  if (kind && placeAccessory(group, root, shape, kind, accessory || {}, { footLengthCm, color })) return 'anchored';
  if (from) transferToFigure(root, from, shape);
  else if (!placeByHeight(group, garmentType, shape.landmarks)) return null;

  if (from && transferOnly) {
    pushOutOfBody(root, shape);
    return 'transfer';
  }
  if (!isDrapedType(garmentType)) return 'rigid';
  drapeGarment(group, shape, { fit, layer, size, garmentType, legs });
  return 'draped';
}
