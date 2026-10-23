// Консоль браузера без ошибок от сборки:
//   — нет 404 на vision_bundle.js с CDN (MediaPipe берётся из npm, TryOnAR);
//   — одна копия three.js: <model-viewer> с CDN нёс свою, stats-gl (через drei) — свою 0.170.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
// комментарии HTML не в счёт
const markup = html.replace(/<!--[\s\S]*?-->/g, '');

test('index.html does not load the missing MediaPipe bundle or a CDN copy of three.js', () => {
  expect(markup).not.toMatch(/vision_bundle\.js/);
  expect(markup).not.toMatch(/model-viewer/);
  const scripts = markup.match(/<script\b[^>]*\bsrc=/g) || [];
  expect(scripts).toEqual([]);
});

test('only one three.js is installed', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const copies = Object.keys(lock.packages).filter((p) => /(^|\/)node_modules\/three$/.test(p));
  expect(copies).toEqual(['node_modules/three']);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.overrides?.['stats-gl']?.three).toBe('$three');
});

test('no <model-viewer> left in the app code', () => {
  const walk = (dir) => fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() ? walk(p) : [p];
  });
  const users = walk(path.join(ROOT, 'src'))
    .filter((f) => /\.jsx?$/.test(f) && !/\.test\.js$/.test(f))
    .filter((f) => /<model-viewer\b/.test(fs.readFileSync(f, 'utf8')));
  expect(users).toEqual([]);
});
