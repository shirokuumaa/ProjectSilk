// client/src/utils/productGarment.js
//
// Вещь для примерки на странице товара (GlbViewer garments): ткань выбранного размера
// (драпировка Newton), своя модель продавца или шаблон своего типа — как в гардеробе
// (pages/WardrobePage.jsx). broken — файл модели не загрузился: шаблон того же типа.

import { brokenModelNote, garmentTypeOf, offFigureReason, templateFor } from './garmentTemplates';
import { pickSizeModel } from './sizeModels';

/**
 * @returns {{ garment: object|null, note: string|null }} note — пояснение покупателю
 */
export function productGarment(product, sizeRow, { broken = false, toPublicUrl = (s) => s } = {}) {
  const name = product?.name || product?.title || 'This item';
  const garmentType = garmentTypeOf(product);
  const reason = offFigureReason({ ...product, name, garmentType });
  if (reason) return { garment: null, note: reason };

  const base = {
    id: String(product._id || product.id),
    name,
    garmentType,
    layer: product.layer || 1,
    fit: sizeRow?.fit || 'regular',
    size: sizeRow || null,
    color: product.color || null,
    print: product.print ? { ...product.print, image: toPublicUrl(product.print.image) } : null,
    accessory: product.accessory || null,   // вид и размеры аксессуара или обуви — точка на теле и масштаб
  };

  if (!broken) {
    const model = pickSizeModel(product, sizeRow);
    if (model) {
      return { garment: { ...base, url: toPublicUrl(model.model3d), simFigure: model.body || null, legs: product.legs || null }, note: null };
    }
    if (product.model3d) return { garment: { ...base, url: toPublicUrl(product.model3d), legs: product.legs || null }, note: null };
  }

  const template = templateFor({ ...product, garmentType }, { ignoreModel: broken });
  const note = broken ? brokenModelNote(name, template) : null;
  if (!template) return { garment: null, note };
  return { garment: { ...base, url: template.url, template: true, legs: template.legs }, note };
}
