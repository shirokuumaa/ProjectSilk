// Плавающая кнопка ассистента не закрывает кнопки страниц: она одна внизу справа,
// а внизу каждой страницы (в подвале) — запас её высоты, чтобы прокрутить кнопки выше неё.
// jsdom не считает раскладку — проверяем, что стили связаны одними токенами.
const fs = require('fs');
const path = require('path');

const css = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('the button size and the page clearance come from the same tokens', () => {
  const tokens = css('styles/tokens.css');
  expect(tokens).toMatch(/--fab-size:\s*\d+px;/);
  expect(tokens).toMatch(/--fab-clearance:\s*calc\(var\(--fab-size\)/);

  const orb = css('components/VoiceOrb.module.css');
  expect(orb).toMatch(/width:\s*var\(--fab-size\)/);
  expect(orb).toMatch(/bottom:\s*var\(--fab-gap\)/);
});

test('every page ends with room for the floating button', () => {
  expect(css('components/SiteFooter.module.css')).toMatch(/padding:[^;]*var\(--fab-clearance\)/);
  // подвал — последний элемент разметки на каждой странице
  expect(css('App.js')).toMatch(/<\/Routes>\s*<SiteFooter \/>/);
});

test('on a narrow screen the guest-wardrobe bar sits above the floating button', () => {
  expect(css('components/AccountSync.module.css')).toMatch(/@media \(max-width: 720px\)\s*\{\s*\.bar \{ bottom: var\(--fab-clearance\); \}/);
});
