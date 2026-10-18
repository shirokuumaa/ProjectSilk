// server/models/WardrobeItem.js
import mongoose from 'mongoose';

const wardrobeItemSchema = new mongoose.Schema({
  user:     { type: String, required: true },    // логин владельца, берётся из токена
  productId:{ type: String, required: true },
  name:     { type: String, required: true },
  price:    { type: Number, default: 0 },
  image:    { type: String, default: '' },
  category: { type: String, default: 'Clothes' },
}, { timestamps: true, versionKey: false });

wardrobeItemSchema.index({ user: 1, productId: 1 }, { unique: true });

export default mongoose.model('WardrobeItem', wardrobeItemSchema);