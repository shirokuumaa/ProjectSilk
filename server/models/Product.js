import mongoose from 'mongoose';
import { ACCESSORY_KINDS, ALL_SIZE_SYSTEMS } from '../utils/accessory.js';

/**
 * Размерная сетка товара.
 * Здесь хранятся обмеры САМОГО ИЗДЕЛИЯ (не тела покупателя), в сантиметрах.
 * Эти числа используются в client/src/utils/fitCalculator.js для подбора размера.
 */
const SizeEntrySchema = new mongoose.Schema({
  size:   { type: String, required: true },  // 'XS', 'S', 'M', '42', '30/32'...

  // обхваты изделия в разложенном виде (замер по кругу, см)
  chest:  { type: Number },   // обхват груди изделия
  waist:  { type: Number },   // обхват талии изделия
  hips:   { type: Number },   // обхват бёдер изделия

  // длины (см)
  length: { type: Number },   // длина изделия целиком
  sleeve: { type: Number },   // длина рукава
  shoulder: { type: Number }, // ширина плеч: от шва до шва по спинке (верхняя одежда)

  // как задуман крой — влияет на то, какая прибавка считается нормальной
  fit: {
    type: String,
    enum: ['tight', 'regular', 'loose'],
    default: 'regular',
  },

  // старое поле «Stretch, %» по строкам; подбор размера его больше не читает —
  // тянучесть ткани теперь у товара целиком (ProductSchema.stretch)
  stretch: { type: Number, default: 0, min: 0, max: 50 },

  // остаток на складе продавца; нет поля — продавец не указал (считаем, что есть).
  // Уменьшаться будет при оформлении заказа — заказов пока нет, только храним
  stock: { type: Number, min: 0, validate: { validator: Number.isInteger, message: 'Stock must be a whole number.' } },
}, { _id: false });

export const CURRENCIES = ['KZT', 'RUB', 'UZS', 'USD', 'EUR', 'GBP'];

export const GARMENT_TYPES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'];

const ProductSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  name:     { type: String },
  price:    { type: Number, required: true },
  // валюта цены: пилот — тенге, место под другие рынки заложено (client/src/utils/money.js)
  currency: { type: String, enum: CURRENCIES, default: 'KZT' },
  category: { type: String, default: 'Clothes' },
  image:    { type: String, required: true },   // /uploads/images/... — главное фото
  images:   [{ type: String }],                 // галерея: ещё до MAX_GALLERY фото, по порядку
  model3d:  { type: String },                   // /uploads/models/...
  rating:   { type: Number, default: 0 },

  // продавец, который выставил товар; менять и удалять может только он
  owner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // --- для Try-On Avatar ---

  // размерная сетка; без неё подбор размера невозможен
  sizeChart: { type: [SizeEntrySchema], default: [] },

  // тянется ли ткань (на весь товар); насколько вещь может быть меньше тела —
  // client/src/utils/fitCalculator.js (STRETCH_SHARE). У старых товаров — 'none'.
  stretch: {
    type: String,
    enum: { values: ['none', 'slight', 'stretchy'], message: 'Fabric stretch must be none, slight or stretchy.' },
    default: 'none',
  },

  // тип вещи — определяет, на какую часть тела надевается и порядок слоёв.
  // Обязателен при создании (productController); умолчания нет: у старых товаров
  // без типа примерка пишет «Type not set», а не надевает их как верх.
  garmentType: {
    type: String,
    enum: { values: GARMENT_TYPES, message: 'Garment type must be one of: top, bottom, dress, outerwear, shoes, accessory.' },
  },

  // фасон, который выбрал продавец: шаблон GarmentCode и ручки (utils/silhouettes.js).
  // По нему и по сетке сервер строит выкройки каждого размера. Нет — «None of these».
  silhouette: {
    type: new mongoose.Schema({
      template: { type: String, required: true },
      sleeve:   { type: String },
      length:   { type: String },
    }, { _id: false }),
    default: undefined,
  },

  // основной цвет вещи ('#rrggbb'): снят с фото в форме продавца, продавец может поправить.
  // В примерке драпировки и шаблоны окрашиваются в него (client/src/utils/garmentColor.js).
  color: {
    type: String,
    lowercase: true,
    match: [/^#[0-9a-f]{6}$/, 'Colour must look like #a1b2c3.'],
  },

  // принт ткани: бесшовная плитка, вырезанная продавцом из фото товара (client/src/utils/fabricPrint.js),
  // и сколько сантиметров ткани занимает один её повтор. Примерка кладёт плитку на развёртку выкройки
  // драпировки (UV в метрах) — одинаково на всех размерах. Нет принта — вещь однотонная, в цвете color.
  print: {
    type: new mongoose.Schema({
      image:  { type: String, required: true },
      tileCm: { type: Number, required: true, min: 1, max: 200 },
    }, { _id: false }),
    default: undefined,
  },

  // карточка аксессуара или обуви: вид и размеры (см), по которым примерка крепит твёрдую модель
  // к точке тела и масштабирует её (client/src/utils/accessoryPlacement.js); разбор — utils/accessory.js
  accessory: {
    type: new mongoose.Schema({
      kind:       { type: String, enum: Object.keys(ACCESSORY_KINDS), required: true },
      lengthCm:   { type: Number, min: 0, max: 300 },
      widthCm:    { type: Number, min: 0, max: 300 },
      heightCm:   { type: Number, min: 0, max: 300 },
      depthCm:    { type: Number, min: 0, max: 300 },
      dropCm:     { type: Number, min: 0, max: 300 },
      size:       { type: String },                     // размер обуви, кольца или обхват головы (шапка)
      sizeSystem: { type: String, enum: ALL_SIZE_SYSTEMS },
      side:       { type: String, enum: ['l', 'r'] },   // рука или плечо; по умолчанию левая
      level:      { type: String, enum: ['waist', 'hips'] },
    }, { _id: false }),
    default: undefined,
  },

  // выкройки по силуэту и сетке — фоновая задача (services/patternJobs.js)
  patterns: {
    type: new mongoose.Schema({
      status:    { type: String, enum: ['queued', 'patterns_ready', 'failed'], required: true },
      message:   { type: String },          // причина для продавца, если failed
      sizes:     [new mongoose.Schema({
        size: String, ok: Boolean, within1cm: Boolean, error: String,
      }, { _id: false })],
      jobId:     { type: String },
      updatedAt: { type: Date },
    }, { _id: false }),
    default: undefined,
  },

  // подсказка для низа: брюки (две штанины) или юбка. Необязательна — без неё
  // примерка определяет это по геометрии вещи (client/src/utils/garmentDrape.js).
  legs: { type: String, enum: ['split', 'joined'] },

  // 3D-модели по размерам: ткань, заранее просимулированная на нашей болванке в фигуре
  // этого размера (body). Примерка берёт модель ближайшего размера, переносит её на
  // фигуру покупателя и подгоняет по обмерам (client/src/utils/sizeModels.js).
  sizeModels: {
    type: [new mongoose.Schema({
      size:    { type: String, required: true },
      model3d: { type: String, required: true },
      body: {
        heightCm: Number, chest: Number, waist: Number, hips: Number,
      },
    }, { _id: false })],
    default: undefined,
  },

  // порядок слоёв при примерке нескольких вещей (меньше = ближе к телу)
  layer: { type: Number, default: 1 },

  // материал — справочно для покупателя
  material: { type: String },

  // карточка для покупателя: описание, состав ткани в %, уход, страна производства
  description:     { type: String, maxlength: 4000 },
  composition: {
    type: [new mongoose.Schema({
      fibre:   { type: String, required: true, maxlength: 40 },
      percent: { type: Number, required: true, min: 0.1, max: 100 },
    }, { _id: false })],
    default: undefined,
  },
  care:            { type: String, maxlength: 1000 },
  countryOfOrigin: { type: String, maxlength: 60 },
}, { timestamps: true });

/** Есть ли у товара данные для подбора размера */
ProductSchema.virtual('hasSizeData').get(function () {
  return Array.isArray(this.sizeChart) && this.sizeChart.length > 0;
});

/** Список доступных размеров: ['S', 'M', 'L'] */
ProductSchema.virtual('availableSizes').get(function () {
  return (this.sizeChart || []).map((s) => s.size);
});

ProductSchema.set('toJSON', { virtuals: true });
ProductSchema.set('toObject', { virtuals: true });

export default mongoose.model('Product', ProductSchema);

