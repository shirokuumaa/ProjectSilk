// seller/server/models/Product.js

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  image: {
    type: String, // здесь будет путь к загруженному файлу
    required: true,
  }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);