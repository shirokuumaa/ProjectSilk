// Подделка scripts/garments/patterns_job.py для тестов: те же аргументы и тот же result.json.
// Что вернуть — по названию товара: «fail» — ни один размер не вышел, «crash» — процесс упал,
// «slow» — работает 1,5 с; иначе каждый размер сетки готов.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const job = JSON.parse(fs.readFileSync(arg('--job'), 'utf8'));
const out = arg('--out');

if (/crash/.test(job.title)) {
  console.error('Traceback: something broke');
  process.exit(1);
}
if (/slow/.test(job.title)) await new Promise((r) => setTimeout(r, 1500));

const result = /fail/.test(job.title)
  ? { sizes: [], failed: job.sizeChart.map((r) => ({ size: r.size, error: 'This size is outside the body range we can model yet.' })) }
  : {
    sizes: job.sizeChart.map((r) => ({ size: r.size, within_1cm: true, box: `boxes/size_${r.size}` })),
    failed: [],
  };
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ...result, seenJob: job }));
