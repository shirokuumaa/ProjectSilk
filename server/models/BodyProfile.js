// server/models/BodyProfile.js
import mongoose from 'mongoose';

/**
 * Профиль тела покупателя.
 *
 * Аватар НЕ хранится как GLB-файл. Хранятся только обмеры — из них
 * в браузере строится тело через morph targets базовой модели.
 * Это ~200 байт вместо ~20 МБ, мгновенно и без GPU.
 *
 * Все обмеры — в сантиметрах. Обхваты = замер лентой вокруг тела.
 */
const bodyProfileSchema = new mongoose.Schema({
  // логин из localStorage: loggedInUser (так же, как в WardrobeItem)
  user: { type: String, required: true, unique: true, index: true },

  // --- базовое ---
  heightCm: { type: Number, required: true, min: 120, max: 220 },
  weightKg: { type: Number, min: 30, max: 250 },

  // --- обхваты (ключевые для посадки) ---
  chest: { type: Number, required: true, min: 50, max: 200 },  // обхват груди
  waist: { type: Number, required: true, min: 40, max: 200 },  // обхват талии
  hips:  { type: Number, required: true, min: 50, max: 200 },  // обхват бёдер

  // --- длины (для пропорций аватара) ---
  shoulderWidth: { type: Number, min: 25, max: 70 },  // ширина плеч
  armLength:     { type: Number, min: 40, max: 90 },  // от плеча до запястья
  inseam:        { type: Number, min: 50, max: 110 }, // длина ноги по внутр. шву

  // --- внешний вид аватара (на посадку не влияет) ---
  bodyType: { type: String, enum: ['F', 'M', 'N'], default: 'N' },
  skinTone: { type: String, default: 'neutral' },
  hairStyle: { type: String, default: 'none' },

  // источник данных: ручной ввод или оценка по фото (на будущее)
  source: { type: String, enum: ['manual', 'photo'], default: 'manual' },
}, { timestamps: true, versionKey: false });

/**
 * Значения морфов для базовой модели тела.
 * GlbViewer подставляет их в morphTargetInfluences.
 *
 * Отклонение обмера от «среднего» тела переводится в диапазон 0..1,
 * где 0.5 — среднее телосложение.
 */
bodyProfileSchema.methods.toMorphTargets = function () {
  const norm = (value, mid, spread) => {
    if (value == null) return 0.5;
    return Math.min(1, Math.max(0, 0.5 + (value - mid) / (spread * 2)));
  };

  return {
    height:   norm(this.heightCm, 170, 25),
    chest:    norm(this.chest, 92, 30),
    waist:    norm(this.waist, 76, 35),
    hips:     norm(this.hips, 98, 30),
    shoulder: norm(this.shoulderWidth, 42, 10),
    armLength: norm(this.armLength, 60, 12),
    legLength: norm(this.inseam, 78, 14),
  };
};

export default mongoose.model('BodyProfile', bodyProfileSchema);
