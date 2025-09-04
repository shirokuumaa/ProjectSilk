// seller/server/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const upload = require('../uploads/upload');
const Product = require('../models/Product');

// 📥 POST /api/products
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { title, price } = req.body;
    const imageUrl = `/uploads/${req.file.filename}`;

    const newProduct = new Product({ title, price, image: imageUrl });
    await newProduct.save();

    res.status(201).json({ message: 'Товар создан', product: newProduct });
  } catch (err) {
    console.error('❌ Ошибка при создании товара:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// 📤 GET /api/products
router.get('/', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка при получении товаров' });
  }
});

module.exports = router;