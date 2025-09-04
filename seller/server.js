const express = require('express');
const connectDB = require('./server/db'); // Подключение к MongoDB
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

connectDB(); // Запускаем подключение к базе

// Пока просто заглушка
app.get('/', (req, res) => {
  res.send('🎉 Seller backend работает!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Сервер запущен на порту ${PORT}");
});