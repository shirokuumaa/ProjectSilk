// server/scripts/seedDemoAccessories.js
//
// Девять демо-аксессуаров для проверки примерки: серьги, колье, часы, ремень, сумка, кеды, туфли, шапка, очки.
// Модели — TRELLIS.2 по фото Wikimedia Commons (research/accessories, сеанс 1), подготовленные
// scripts/accessories/prepare_models.py: client/public/models/demo-accessories/ (<id>.glb, <id>.jpg,
// prepared.json). Это внутренний тест — папка в .gitignore, в публичный каталог эти товары не идут.
// Карточка (вид и размеры, см) — из prepared.json: по ней примерка крепит модель к точке тела
// и масштабирует (client/src/utils/accessoryPlacement.js).
//
// Запуск (товары появятся у существующего продавца; повторный запуск обновляет их):
//   MONGODB_URI=mongodb://localhost:27017/<база> node scripts/seedDemoAccessories.js <имя продавца>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import User, { normalizeUsername } from '../models/User.js';
import { parseAccessory } from '../utils/accessory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DIR = path.resolve(HERE, '../../client/public/models/demo-accessories');

/** id подготовленной модели → поля товара (тексты придуманы, брендов нет). */
export const DEMO_ACCESSORIES = {
  '01_earrings': { title: 'Beaded Hoop Drop Earrings', price: 6900, material: 'Metal, glass beads' },
  '02_necklace': { title: 'Silver Pendant Necklace', price: 12900, material: 'Sterling silver, enamel' },
  '04_watch':    { title: 'Two-Tone Chronograph Watch', price: 49900, material: 'Stainless steel' },
  '05_belt':     { title: 'Black Leather Belt', price: 8900, material: 'Leather', color: '#1c1c1e' },
  '06_handbag':  { title: 'Round Beaded Bag', price: 15900, material: 'Glass beads, cotton lining' },
  '07_sneakers': { title: 'Black Canvas Sneakers', price: 21900, material: 'Organic cotton canvas, rubber sole' },
  '08_heels':    { title: 'Burgundy Leather Pumps', price: 27900, material: 'Leather' },
  '09_hat':      { title: 'Felt Bucket Hat', price: 9900, material: 'Wool felt' },
  '10_glasses':  { title: 'Titanium Frame Glasses', price: 18900, material: 'Titanium' },
};

/** Документы товаров для продавца ownerId по prepared.json. */
export function demoAccessories(ownerId, prepared = JSON.parse(fs.readFileSync(path.join(DIR, 'prepared.json'), 'utf8'))) {
  return prepared.filter((m) => DEMO_ACCESSORIES[m.item]).map((m) => {
    const garmentType = m.kind === 'shoes' ? 'shoes' : 'accessory';
    const { accessory, error } = parseAccessory({ kind: m.kind, ...m.card }, garmentType);
    if (error) throw new Error(`${m.item}: ${error}`);
    return {
      ...DEMO_ACCESSORIES[m.item],
      name: DEMO_ACCESSORIES[m.item].title,
      description: 'Demo item for the try-on: a 3D model made from one product photo.',
      category: 'Clothes',
      garmentType,
      accessory,
      image: `/models/demo-accessories/${m.item}.jpg`,
      model3d: `/models/demo-accessories/${m.file}`,
      owner: ownerId,
    };
  });
}

/** Создать или обновить демо-аксессуары продавца. */
export async function seedDemoAccessories(username) {
  const seller = await User.findOne({ username: normalizeUsername(username) });
  if (!seller) throw new Error(`No user "${username}"`);
  if (seller.role !== 'seller') throw new Error(`"${username}" is not a seller`);
  const out = [];
  for (const doc of demoAccessories(seller._id)) {
    out.push(await Product.findOneAndUpdate(
      { owner: seller._id, title: doc.title }, doc, { upsert: true, new: true, runValidators: true },
    ));
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const uri = process.env.MONGODB_URI;
  const username = process.argv[2];
  if (!uri || !username) {
    console.error('Usage: MONGODB_URI=… node scripts/seedDemoAccessories.js <seller username>');
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const docs = await seedDemoAccessories(username);
    docs.forEach((d) => console.log(`${d._id}  ${d.title}  ${JSON.stringify(d.accessory)}`));
  } finally {
    await mongoose.disconnect();
  }
}
