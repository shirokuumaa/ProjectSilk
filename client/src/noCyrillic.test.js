// client/src/noCyrillic.test.js
//
// Весь текст интерфейса — по-английски (CLAUDE.md). Тест разбирает каждый файл
// клиента и ответы сервера парсером и ищет кириллицу в строках, шаблонах,
// регулярных выражениях и тексте JSX. Комментарии не проверяются — они по-русски.
// На сервере пропускаются аргументы console.* — это лог для разработчика,
// покупатель его не видит.
//
// Тесты, фикстуры и отладочные утилиты для тестов (utils/testing) не проверяются.

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const CYRILLIC = /[Ѐ-ӿ]/;
const CLIENT_SRC = __dirname;
const SERVER = path.resolve(__dirname, '..', '..', 'server');
const SERVER_PARTS = ['index.js', 'routes', 'controllers', 'middleware', 'models', 'utils', 'config'];

const SKIP = /(\.test\.js$|__fixtures__|[\\/]testing[\\/]|[\\/]node_modules[\\/])/;

function sourceFiles(entry) {
  if (!fs.existsSync(entry)) return [];
  if (fs.statSync(entry).isFile()) return /\.(js|jsx|mjs)$/.test(entry) ? [entry] : [];
  return fs.readdirSync(entry).flatMap((name) => sourceFiles(path.join(entry, name)));
}

const isConsoleCall = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'console';

/** Все строки файла с кириллицей: «строка: текст». */
function cyrillicStrings(file, { skipConsole = false } = {}) {
  const ast = parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'topLevelAwait'],
  });
  const hits = [];

  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (skipConsole && isConsoleCall(node)) return;

    let text = null;
    if (node.type === 'StringLiteral' || node.type === 'JSXText') text = node.value;
    else if (node.type === 'TemplateElement') text = node.value.raw;
    else if (node.type === 'RegExpLiteral') text = node.pattern;
    if (text && CYRILLIC.test(text)) hits.push(`${node.loc.start.line}: ${text.trim().slice(0, 80)}`);

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  })(ast.program);

  return hits;
}

function report(files, options) {
  const found = {};
  for (const file of files) {
    if (SKIP.test(file)) continue;
    const hits = cyrillicStrings(file, options);
    if (hits.length) found[path.relative(path.resolve(__dirname, '..', '..'), file)] = hits;
  }
  return found;
}

describe('no Russian text in the interface', () => {
  it('client: strings, templates and JSX text are in English', () => {
    expect(report(sourceFiles(CLIENT_SRC))).toEqual({});
  });

  it('server: response messages are in English (logs may stay Russian)', () => {
    const files = SERVER_PARTS.flatMap((part) => sourceFiles(path.join(SERVER, part)));
    expect(files.length).toBeGreaterThan(5);
    expect(report(files, { skipConsole: true })).toEqual({});
  });

  it('the check itself finds Cyrillic outside comments and ignores comments', () => {
    const tmp = path.join(require('os').tmpdir(), `cyr-${process.pid}.jsx`);
    fs.writeFileSync(tmp, [
      '// комментарий',
      'const a = "Привет";',
      'const b = <p>Корзина</p>;',
      'const c = `Итого`;',
      'console.log("лог");',
    ].join('\n'));
    try {
      expect(cyrillicStrings(tmp).map((h) => h.split(':')[0])).toEqual(['2', '3', '4', '5']);
      expect(cyrillicStrings(tmp, { skipConsole: true })).toHaveLength(3);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
