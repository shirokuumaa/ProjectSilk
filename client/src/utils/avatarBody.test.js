// Какое тело видит покупатель: болванка MPFB по умолчанию, процедурное BodyAvatar —
// только для фигур вне калиброванного диапазона (большие размеры) и по ?avatar=standard.
import { renderHook } from '@testing-library/react';
import { readAvatarMode, avatarDebugEnabled } from './avatarMode';
import { useAvatarBody, withEstimatedGirths } from './avatarBody';
import { solveAvatar } from './avatarMorphs';

// файл болванки в тестах не грузится: «загрузка» не заканчивается
jest.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class { loadAsync() { return new Promise(() => {}); } },
}));

const S = { heightCm: 156, chest: 80, waist: 62, hips: 86 };
const L = { heightCm: 172, chest: 110, waist: 94, hips: 118 };
const PLUS = { heightCm: 166, chest: 125, waist: 110, hips: 132 };
const BEYOND = { heightCm: 166, chest: 170, waist: 160, hips: 180 }; // за калибровкой болванки

const at = (search) => window.history.replaceState({}, '', `/tryon/avatar${search}`);

beforeEach(() => { localStorage.clear(); at(''); });

describe('avatar mode', () => {
  test('the MPFB base avatar is the default', () => {
    expect(readAvatarMode()).toBe('base');
  });

  test('?avatar=standard switches to the procedural body and is remembered; ?avatar=base switches back', () => {
    at('?avatar=standard');
    expect(readAvatarMode()).toBe('standard');
    at('');
    expect(readAvatarMode()).toBe('standard');
    at('?avatar=base');
    expect(readAvatarMode()).toBe('base');
  });

  test('a choice saved while the base avatar was on trial no longer matters', () => {
    localStorage.setItem('silk.avatarMode', 'standard');
    expect(readAvatarMode()).toBe('base');
  });

  test('the "which body and why" badge only with ?avatarDebug=1, and only in development', () => {
    const env = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      expect(avatarDebugEnabled()).toBe(false);
      at('?avatarDebug=1');
      expect(avatarDebugEnabled()).toBe(true);
      // сборка для покупателей: ссылка с ?avatarDebug=1 плашку не включает
      process.env.NODE_ENV = 'production';
      expect(avatarDebugEnabled()).toBe(false);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('which body a buyer gets', () => {
  const body = (profile) => renderHook(() => useAvatarBody(profile)).result.current;

  test.each([['S', S], ['L', L]])('%s: the base avatar (loading first, never the procedural body)', (name, p) => {
    expect(body(p).kind).toBe('loading');
  });

  test('plus (125/110/132): the base avatar too, since the large-size morphs', () => {
    expect(body(PLUS).kind).toBe('loading');
  });

  test('a size beyond the calibrated range: the procedural BodyAvatar', () => {
    const r = body(BEYOND);
    expect(r.kind).toBe('standard');
    expect(r.reason).toBe('range');
    expect(r.shape).toBeTruthy(); // одежда садится на то же тело
  });

  test('?avatar=standard: the procedural body for any figure', () => {
    at('?avatar=standard');
    expect(body(S).kind).toBe('standard');
  });

  test('while the measurements form is being filled in, the base avatar is still shown', () => {
    expect(body({ heightCm: 166 }).kind).toBe('loading');
    expect(body({ heightCm: 166, chest: 90 }).kind).toBe('loading');
  });
});

describe('withEstimatedGirths', () => {
  test('fills only missing girths from height, keeps entered values', () => {
    expect(withEstimatedGirths({ heightCm: 166, chest: 90 })).toMatchObject({
      heightCm: 166, chest: 90, waist: Math.round(166 * 0.42), hips: Math.round(166 * 0.55),
    });
  });

  test('estimated figures are inside the base avatar range', () => {
    [150, 160, 170, 180].forEach((h) => {
      expect(solveAvatar(withEstimatedGirths({ heightCm: h })).inRange).toBe(true);
    });
  });
});
