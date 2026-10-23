// server/scripts/seedDemoGarments.js
//
// Три демо-товара с настоящей тканью: платье, юбка, футболка. 3D-модели всех размеров сетки —
// драпировки Newton на нашей болванке (scripts/garments/export_demo_drapes.py,
// client/public/models/demo-garments/manifest.json). Размерные сетки — замеры изделий
// из исследования, день 7 (research/patterns/runs/day7/report.md): ширины в разложенном
// виде уже × 2, рукав Uniqlo — «от центра спинки» минус половина ширины плеч.
//
// Запуск (товары появятся у существующего продавца; повторный запуск обновляет их):
//   MONGODB_URI=mongodb://localhost:27017/<база> node scripts/seedDemoGarments.js <имя продавца>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import User, { normalizeUsername } from '../models/User.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(HERE, '../../client/public/models/demo-garments/manifest.json');

const rows = (keys, table) => table.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));

/** Товары без владельца: id манифеста → поля товара. */
export const DEMO = {
  dress: {
    title: 'Short Sleeve Mini Dress',
    price: 19900,
    garmentType: 'dress',
    legs: 'joined',
    stretch: 'stretchy',              // 92 % polyester, 8 % elastane
    material: '92% polyester, 8% elastane',
    sizeChart: rows(['size', 'chest', 'waist', 'hips', 'length', 'sleeve'], [
      ['XS', 77, 64, 81, 82.5, 14], ['S', 80, 66, 85, 83, 15], ['M', 83, 68, 89, 83.5, 16],
      ['L', 86, 70, 93, 84, 17], ['XL', 89, 72, 97, 84.5, 18], ['XXL', 92, 74, 101, 85, 19],
    ]).map((r) => ({ ...r, fit: 'tight' })),
  },
  skirt: {
    title: 'Flared Midi Skirt',
    price: 17900,
    garmentType: 'bottom',
    legs: 'joined',
    stretch: 'none',                  // viscose
    material: 'Viscose',
    sizeChart: rows(['size', 'waist', 'hips', 'length'], [
      ['XS', 70, 98, 79.5], ['S', 74, 102, 80], ['M', 78, 106, 80.5], ['L', 82, 110, 81], ['XL', 86, 114, 81.5],
    ]).map((r) => ({ ...r, fit: 'regular' })),
  },
  tee: {
    title: 'Crew Neck T-Shirt',
    price: 7900,
    garmentType: 'top',
    stretch: 'none',
    material: 'Cotton',
    sizeChart: rows(['size', 'chest', 'length', 'sleeve'], [
      ['XXS', 76, 58, 15.5], ['XS', 81, 59.5, 16], ['S', 86, 61.5, 16.5], ['M', 92, 63.5, 16.8],
      ['L', 98, 66, 17.5], ['XL', 104, 68, 18.5], ['XXL', 110, 69.5, 19],
    ]).map((r) => ({ ...r, fit: 'regular' })),
  },
};

/** Документы товаров для продавца ownerId: сетка, модели размеров, картинка. */
export function demoProducts(ownerId, manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))) {
  return Object.entries(DEMO).map(([id, p]) => {
    const item = manifest.items[id];
    const sizeModels = item.models.map((m) => ({ size: m.size, model3d: m.file, body: m.body }));
    return {
      ...p,
      name: p.title,
      category: 'Clothes',
      image: item.image,
      // «есть 3D» для старых страниц — модель S (или первая, если S нет)
      model3d: (sizeModels.find((m) => m.size === 'S') || sizeModels[0]).model3d,
      sizeModels,
      owner: ownerId,
    };
  });
}

/** Создать или обновить демо-товары продавца. */
export async function seedDemoGarments(username) {
  const seller = await User.findOne({ username: normalizeUsername(username) });
  if (!seller) throw new Error(`No user "${username}"`);
  if (seller.role !== 'seller') throw new Error(`"${username}" is not a seller`);
  const out = [];
  for (const doc of demoProducts(seller._id)) {
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
    console.error('Usage: MONGODB_URI=… node scripts/seedDemoGarments.js <seller username>');
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const docs = await seedDemoGarments(username);
    docs.forEach((d) => console.log(`${d._id}  ${d.title}  sizes ${d.sizeChart.map((r) => r.size).join('/')}  models ${d.sizeModels.map((m) => m.size).join('/')}`));
  } finally {
    await mongoose.disconnect();
  }
}
