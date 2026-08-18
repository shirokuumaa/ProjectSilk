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

  // эластичность ткани в процентах: 0 = не тянется (джинса), 30 = сильно тянется (трикотаж)
  stretch: { type: Number, default: 0, min: 0, max: 50 },
}, { _id: false });

const ProductSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  name:     { type: String },
  price:    { type: Number, required: true },
  category: { type: String, default: 'Clothes' },
  image:    { type: String, required: true },   // /uploads/images/...
  images:   [{ type: String }],                 // на будущее
  model3d:  { type: String },                   // /uploads/models/...
  rating:   { type: Number, default: 0 },

  // --- для Try-On Avatar ---

  // размерная сетка; без неё подбор размера невозможен
  sizeChart: { type: [SizeEntrySchema], default: [] },

  // тип вещи — определяет, на какую часть тела надевается и порядок слоёв
  garmentType: {
    type: String,
    enum: ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'],
    default: 'top',
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

