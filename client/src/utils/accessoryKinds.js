// client/src/utils/accessoryKinds.js
//
// Виды аксессуаров и обуви, поля их карточки (см) и подписи для формы продавца.
// Посадка на фигуру — utils/accessoryPlacement.js. Тот же список — в server/utils/accessory.js;
// совпадение проверяет server/test/accessory.test.js.

/** Виды аксессуаров: поля карточки (см) и подписи для формы продавца. */
export const ACCESSORY_KINDS = {
  earrings:     { label: 'Earrings',     pair: true,  fields: ['lengthCm'] },
  necklace:     { label: 'Necklace',     fields: ['lengthCm', 'heightCm'] },
  ring:         { label: 'Ring',         fields: ['size'], sizeSystems: ['US', 'EU'] },
  bracelet:     { label: 'Bracelet',     fields: ['lengthCm'] },
  watch:        { label: 'Watch',        fields: ['widthCm'] },
  belt:         { label: 'Belt',         fields: ['widthCm', 'lengthCm', 'level'] },
  shoulder_bag: { label: 'Shoulder bag', fields: ['widthCm', 'heightCm', 'depthCm', 'dropCm'] },
  handbag:      { label: 'Handbag',      fields: ['widthCm', 'heightCm', 'depthCm'] },
  hat:          { label: 'Hat',          fields: ['size', 'widthCm'] },
  glasses:      { label: 'Glasses',      fields: ['widthCm'] },
  shoes:        { label: 'Shoes',        pair: true,  fields: ['size'], sizeSystems: ['EU', 'UK', 'US-W', 'US-M', 'cm'] },
};

/** Подписи полей карточки для формы продавца (по виду — своя подпись у одного поля). */
export const FIELD_LABELS = {
  lengthCm: { default: 'Length, cm', earrings: 'Drop length, cm', necklace: 'Chain length, cm',
    bracelet: 'Inner length, cm', belt: 'Belt length, cm' },
  heightCm: { default: 'Height, cm', necklace: 'Pendant height, cm' },
  widthCm: { default: 'Width, cm', watch: 'Case width, cm', belt: 'Strap width, cm',
    hat: 'Width with brim, cm', glasses: 'Frame width, cm' },
  depthCm: { default: 'Depth, cm' },
  dropCm: { default: 'Strap drop, cm' },
  size: { default: 'Size', ring: 'Ring size', hat: 'Hat size (head circumference, cm)', shoes: 'Shoe size' },
  level: { default: 'Worn at' },
};

/** Вид аксессуара товара: у обуви — всегда shoes; у аксессуара — из карточки. */
export function accessoryKind(garmentType, accessory) {
  if (garmentType === 'shoes') return 'shoes';
  if (garmentType !== 'accessory') return null;
  return ACCESSORY_KINDS[accessory?.kind] ? accessory.kind : null;
}
