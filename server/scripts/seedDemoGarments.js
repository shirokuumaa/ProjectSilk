// server/scripts/seedDemoGarments.js
//
// Шесть демо-товаров с настоящей тканью: платье, юбка, футболка, брюки, жакет, пальто. 3D-модели всех
// размеров сетки — драпировки Newton на нашей болванке с прямыми руками (scripts/garments/export_demo_drapes.py,
// client/public/models/demo-garments/manifest.json). Сетки платья, юбки, футболки — замеры изделий
// из исследования, день 7 (research/patterns/runs/day7/report.md): ширины в разложенном
// виде уже × 2, рукав Uniqlo — «от центра спинки» минус половина ширины плеч. Брюки, жакет, пальто —
// открытые средние таблицы, без данных магазинов (research/patterns/demo/<вещь>_job.json).
// У платья — принт: клетка-гингем, нарисованная кодом (scripts/garments/make_demo_print.py), повтор 4 см;
// на примерке она ложится на развёртку выкройки драпировки одинаково во всех размерах.
// Карточка для покупателя — описание, состав (вместе 100 %), уход, страна, остаток по размерам (DETAILS):
// тексты придуманы, брендов нет; у каждой вещи есть размер с остатком 0 (серый) и размеры с 1–3 штуками
// («N left»). Виды сзади и сбоку — рендер на поде (research/accessories/pod/run_session.sh, часть D).
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
    print: { image: '/models/demo-garments/dress_print.png', tileCm: 4 },   // гингем: клетка 2 см
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
  trousers: {
    title: 'Straight Trousers',
    price: 15900,
    garmentType: 'bottom',
    legs: 'split',
    stretch: 'none',
    material: 'Viscose blend',
    sizeChart: rows(['size', 'waist', 'hips', 'length'], [
      ['XS', 64, 92, 100], ['S', 68, 96, 100.5], ['M', 72, 100, 101],
      ['L', 78, 106, 101.5], ['XL', 84, 112, 102], ['XXL', 90, 118, 102.5],
    ]).map((r) => ({ ...r, fit: 'tight' })),
  },
  jacket: {
    title: 'Lapel Jacket',
    price: 29900,
    garmentType: 'outerwear',
    stretch: 'none',
    material: 'Wool blend',
    sizeChart: rows(['size', 'shoulder', 'chest', 'waist', 'length', 'sleeve'], [
      ['XS', 36, 98, 100, 63, 59], ['S', 37, 102, 104, 64, 59.5], ['M', 38, 106, 108, 65, 60],
      ['L', 39.5, 112, 114, 66, 60.5], ['XL', 41, 118, 120, 67, 61], ['XXL', 42.5, 124, 126, 68, 61.5],
    ]).map((r) => ({ ...r, fit: 'loose' })),
  },
  coat: {
    title: 'Knee-Length Coat',
    price: 44900,
    garmentType: 'outerwear',
    stretch: 'none',
    material: 'Wool blend',
    sizeChart: rows(['size', 'shoulder', 'chest', 'waist', 'length', 'sleeve'], [
      ['XS', 37, 98, 100, 98, 60], ['S', 38, 102, 104, 99, 60.5], ['M', 39, 106, 108, 100, 61],
      ['L', 40.5, 112, 114, 101, 61.5], ['XL', 42, 118, 120, 102, 62], ['XXL', 43.5, 124, 126, 103, 62.5],
    ]).map((r) => ({ ...r, fit: 'loose' })),
  },
};

/** Карточка для покупателя и остаток по размерам (размер → штук). */
export const DETAILS = {
  dress: {
    description: 'A fitted mini dress in stretch gingham jersey with short sleeves, a round neck and a hidden back zip. '
      + 'The fabric gives, so the close cut stays comfortable all day.',
    composition: [{ fibre: 'Polyester', percent: 92 }, { fibre: 'Elastane', percent: 8 }],
    care: 'Machine wash cold on a gentle cycle. Do not tumble dry. Iron on low heat.',
    countryOfOrigin: 'Turkey',
    stock: { XS: 2, S: 6, M: 9, L: 4, XL: 0, XXL: 1 },
  },
  skirt: {
    description: 'A flared midi skirt in fluid viscose that moves as you walk. Elastic back waistband, '
      + 'a side pocket, and a hem that falls just below the knee.',
    composition: [{ fibre: 'Viscose', percent: 100 }],
    care: 'Hand wash cold. Dry flat in the shade. Iron inside out on low heat.',
    countryOfOrigin: 'Uzbekistan',
    stock: { XS: 3, S: 7, M: 5, L: 2, XL: 0 },
  },
  tee: {
    description: 'A crew neck T-shirt in mid-weight cotton jersey. A regular fit with short sleeves '
      + 'that keeps its shape wash after wash.',
    composition: [{ fibre: 'Cotton', percent: 100 }],
    care: 'Machine wash at 30 °C. Tumble dry low. Iron on medium heat.',
    countryOfOrigin: 'Uzbekistan',
    stock: { XXS: 0, XS: 4, S: 12, M: 15, L: 8, XL: 3, XXL: 1 },
  },
  trousers: {
    description: 'High-rise straight trousers with a pressed crease, side pockets and a zip fly. '
      + 'Full length, to wear with flats or heels.',
    composition: [{ fibre: 'Viscose', percent: 68 }, { fibre: 'Polyester', percent: 32 }],
    care: 'Machine wash at 30 °C on a gentle cycle. Hang to dry. Iron on low heat.',
    countryOfOrigin: 'Poland',
    stock: { XS: 2, S: 1, M: 6, L: 5, XL: 3, XXL: 0 },
  },
  jacket: {
    description: 'A single-breasted jacket with notched lapels, light shoulder pads and long sleeves. '
      + 'Fully lined, cut loose to layer over knitwear.',
    composition: [{ fibre: 'Wool', percent: 60 }, { fibre: 'Polyester', percent: 35 }, { fibre: 'Polyamide', percent: 5 }],
    care: 'Dry clean only. Steam to refresh.',
    countryOfOrigin: 'Italy',
    stock: { XS: 1, S: 4, M: 0, L: 6, XL: 2, XXL: 2 },
  },
  coat: {
    description: 'A knee-length coat in a soft wool blend with notched lapels, welt pockets and a full lining. '
      + 'A relaxed cut with room for a jacket underneath.',
    composition: [{ fibre: 'Wool', percent: 70 }, { fibre: 'Polyamide', percent: 20 }, { fibre: 'Cashmere', percent: 10 }],
    care: 'Dry clean only. Brush gently and store on a wide hanger.',
    countryOfOrigin: 'Kazakhstan',
    stock: { XS: 1, S: 3, M: 5, L: 4, XL: 2, XXL: 0 },
  },
};

/** Документы товаров для продавца ownerId: сетка, модели размеров, картинка. */
export function demoProducts(ownerId, manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))) {
  return Object.entries(DEMO).map(([id, p]) => {
    const item = manifest.items[id];
    const sizeModels = item.models.map((m) => ({ size: m.size, model3d: m.file, body: m.body }));
    const { stock, ...details } = DETAILS[id];
    return {
      ...p,
      ...details,
      sizeChart: p.sizeChart.map((r) => ({ ...r, stock: stock[r.size] })),
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
