import mongoose from 'mongoose';

/**
 * Отзыв о посадке. Оставить может только покупатель доставленного заказа — по каждой
 * вещи заказа (вещь + размер) один раз. Кроме оценки и текста — как село: в целом
 * (маломерит / в размер / большемерит) и по зонам, и снимок обмеров автора на момент
 * отзыва — для «люди с похожей фигурой взяли M». Обмеры автора наружу не отдаются,
 * в отзыве видны только рост и купленный размер.
 */
export const FIT_VERDICTS = ['small', 'true', 'large'];
export const ZONE_FEEL = ['tight', 'ok', 'loose'];

const reviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  order:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  buyer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  author:  { type: String, required: true },           // как подписать: «A.» — первая буква имени
  size:    { type: String },
  rating:  { type: Number, required: true, min: 1, max: 5 },
  fit:     { type: String, enum: FIT_VERDICTS, required: true },
  zones: {
    bust:   { type: String, enum: ZONE_FEEL },
    waist:  { type: String, enum: ZONE_FEEL },
    hips:   { type: String, enum: ZONE_FEEL },
    length: { type: String, enum: ZONE_FEEL },
  },
  text:    { type: String, maxlength: 1000 },
  body: {                                               // обмеры автора — только для подсчёта похожих
    heightCm: Number, chest: Number, waist: Number, hips: Number,
  },
}, { timestamps: true, versionKey: false });

reviewSchema.index({ order: 1, product: 1, size: 1 }, { unique: true });

export default mongoose.model('Review', reviewSchema);
