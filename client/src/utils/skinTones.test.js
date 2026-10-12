import fs from 'fs';
import path from 'path';
import {
  DEFAULT_SKIN_TONE, SKIN_TONES, nearestSkinTone, resolveSkinTone, skinToneLabel, skinToneVar,
} from './skinTones';

// палитра — прямо из tokens.css, как её видит браузер
const css = fs.readFileSync(path.join(__dirname, '../styles/tokens.css'), 'utf8');
const palette = Object.fromEntries(
  [...css.matchAll(/--(skin-\d+):\s*(#[0-9A-Fa-f]{6})/g)].map(([, key, hex]) => [key, hex]),
);

test('tokens.css defines all ten Monk tones and the underwear colour', () => {
  expect(Object.keys(palette)).toEqual(SKIN_TONES);
  expect(css).toMatch(/--underwear:\s*#[0-9A-Fa-f]{6}/);
});

test('a stored key stays as is', () => {
  expect(resolveSkinTone('skin-8', palette)).toBe('skin-8');
});

test('an old colour from the previous colour picker maps to the nearest tone', () => {
  expect(resolveSkinTone(palette['skin-3'], palette)).toBe('skin-3');
  expect(nearestSkinTone('#2a2521', palette)).toBe('skin-10');
  expect(resolveSkinTone('#f1c27d', palette)).toMatch(/^skin-\d+$/);
});

test('anything else falls back to the default tone', () => {
  ['neutral', '', null, undefined, 'skin-11'].forEach((v) => {
    expect(resolveSkinTone(v, palette)).toBe(DEFAULT_SKIN_TONE);
  });
});

test('labels and CSS variables', () => {
  expect(skinToneLabel('skin-1')).toBe('Skin tone 1 of 10 (lightest)');
  expect(skinToneLabel('skin-10')).toBe('Skin tone 10 of 10 (deepest)');
  expect(skinToneVar('skin-4')).toBe('var(--skin-4)');
  expect(skinToneVar('bogus')).toBe(`var(--${DEFAULT_SKIN_TONE})`);
});
