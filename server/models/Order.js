import mongoose from 'mongoose';

/**
 * Заказ покупателя у одного продавца. Корзина с вещами разных продавцов при оформлении
 * делится на несколько заказов — каждый продавец ведёт свой (как на маркетплейсах).
 *
 * Оплаты пока нет: payment.status 'not_started' — «Payment coming soon»; продавец сам
 * связывается с покупателем. Цены и валюта берутся из товара на сервере, не из корзины.
 * Остаток размера уменьшается при оформлении и возвращается при отмене (services/orders.js).
 */
export const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];

/**
 * Возврат доставленного заказа (целиком — для пилота): покупатель просит с причиной,
 * продавец принимает или отказывает, затем отмечает, что вещи получены — остаток возвращается.
 * Причина «size» и зона посадки — главные данные для точности советов размера.
 */
export const RETURN_REASONS = ['size', 'look', 'quality', 'changed_mind', 'other'];
export const RETURN_STATUSES = ['requested', 'accepted', 'refused', 'received'];
export const RETURN_ZONES = ['bust', 'waist', 'hips', 'length', 'shoulders', 'sleeves'];

const OrderItemSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  title:    { type: String, required: true },
  image:    { type: String },
  size:     { type: String },              // нет сетки (аксессуар) — без размера
  price:    { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1, max: 20 },
  stockTaken: { type: Boolean, default: false },   // остаток списан — при отмене вернуть
}, { _id: false });

const orderSchema = new mongoose.Schema({
  number:   { type: String, required: true, unique: true },   // для людей: PS-261029-4F7Q
  buyer:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  buyerUsername: { type: String, required: true },
  seller:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  storeName: { type: String },
  items:    { type: [OrderItemSchema], validate: (v) => v.length > 0 },
  currency: { type: String, required: true },
  subtotal: { type: Number, required: true, min: 0 },
  shipping: { type: Number, default: 0, min: 0 },     // доставку пока договаривает продавец
  total:    { type: Number, required: true, min: 0 },

  contact: {
    name:  { type: String, required: true, maxlength: 80 },
    phone: { type: String, required: true, maxlength: 24 },
    email: { type: String, maxlength: 120 },
  },
  address: {
    country:  { type: String, required: true, match: /^[A-Z]{2}$/ },   // ISO 3166-1 alpha-2
    city:     { type: String, required: true, maxlength: 80 },
    line1:    { type: String, required: true, maxlength: 160 },
    line2:    { type: String, maxlength: 160 },
    postcode: { type: String, maxlength: 20 },
  },
  note:     { type: String, maxlength: 500 },

  status:   { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
  history:  [{ status: String, at: Date, by: String, _id: false }],
  payment: {
    method: { type: String, default: 'none' },
    status: { type: String, default: 'not_started' },
  },
  return: {
    type: new mongoose.Schema({
      status: { type: String, enum: RETURN_STATUSES, required: true },
      reason: { type: String, enum: RETURN_REASONS, required: true },
      tooSmall: [{ type: String, enum: RETURN_ZONES }],   // причина size: где тесно
      tooBig: [{ type: String, enum: RETURN_ZONES }],     // где велико
      note: { type: String, maxlength: 500 },
      sellerNote: { type: String, maxlength: 500 },
      requestedAt: Date,
      decidedAt: Date,
    }, { _id: false }),
    default: undefined,
  },
}, { timestamps: true, versionKey: false });

export default mongoose.model('Order', orderSchema);
