import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  name:     { type: String },
  price:    { type: Number, required: true },
  category: { type: String, default: 'Clothes' },
  image:    { type: String, required: true },   // /uploads/images/...
  images:   [{ type: String }],                 // на будущее
  model3d:  { type: String },                   // /uploads/models/...
  rating:   { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('Product', ProductSchema);

