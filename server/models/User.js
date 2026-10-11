// server/models/User.js
import mongoose from 'mongoose';

/**
 * Учётная запись покупателя.
 *
 * Имя хранится в нижнем регистре: «Anna» и «anna» — один пользователь.
 * По этому же имени ищутся BodyProfile.user и WardrobeItem.user, поэтому
 * старые профили находятся, если человек зарегистрируется под тем же именем.
 */
export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

export const normalizeUsername = (v) => String(v ?? '').trim().toLowerCase();

/** buyer — покупатель (по умолчанию), seller — может выставлять товары. */
export const ROLES = ['buyer', 'seller'];

export const normalizeStoreName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
export const isValidStoreName = (v) => v.length >= 2 && v.length <= 60;

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: USERNAME_RE,
  },
  // bcrypt-хеш; в выборки не попадает, пока его не запросят явно
  passwordHash: { type: String, required: true, select: false },
  // старые записи без поля считаются покупателями (см. requireAuth)
  role: { type: String, enum: ROLES, default: 'buyer' },
  // название магазина; есть только у продавца
  storeName: { type: String, trim: true, maxlength: 60 },
}, { timestamps: true, versionKey: false });

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
