import mongoose from 'mongoose';

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

  // как задуман крой — влияет на то, какая прибавка считается нормальной
  fit: {
    type: String,
    enum: ['tight', 'regular', 'loose'],
    default: 'regular',
  },

  // старое поле «Stretch, %» по строкам; подбор размера его больше не читает —
  // тянучесть ткани теперь у товара целиком (ProductSchema.stretch)
  stretch: { type: Number, default: 0, min: 0, max: 50 },
}, { _id: false });

export const GARMENT_TYPES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'];

const ProductSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  name:     { type: String },
  price:    { type: Number, required: true },
  category: { type: String, default: 'Clothes' },
  image:    { type: String, required: true },   // /uploads/images/...
  images:   [{ type: String }],                 // на будущее
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

