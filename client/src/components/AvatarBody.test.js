// Пока болванка грузится — «Loading your avatar…», а не пустая сцена;
// служебная плашка — только в режиме разработки и по ?avatarDebug=1; покупатель
// не видит ярлыков фигуры («Base avatar · …», «out of range», «plus», «xxl»).
import { render, screen } from '@testing-library/react';
import AvatarBody from './AvatarBody';
import { useAvatarBody } from '../utils/avatarBody';

// сцена three.js в jsdom не нужна: Html — обычный div, тела — метки
jest.mock('@react-three/drei', () => ({ Html: ({ children }) => <div>{children}</div> }));
jest.mock('./BodyAvatar', () => () => <p>procedural body</p>);
jest.mock('./BaseAvatar', () => () => <p>base avatar</p>);
jest.mock('../utils/avatarBody', () => ({ useAvatarBody: jest.fn() }));

const P = { heightCm: 156, chest: 80, waist: 62, hips: 86 };
const ENV = process.env.NODE_ENV;
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(() => { process.env.NODE_ENV = ENV; });

const LABELS = /base avatar ·|standard body|out of (calibrated )?range|calibrat|\bplus\b|\bxxl\b/i;

test('while the base avatar loads, a loading message is shown instead of an empty scene', () => {
  useAvatarBody.mockReturnValue({ kind: 'loading', reason: null, shape: null });
  render(<AvatarBody profile={P} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your avatar…');
  expect(screen.queryByText('procedural body')).not.toBeInTheDocument();
});

test('once loaded: the base avatar and no loading message, no debug badge', () => {
  useAvatarBody.mockReturnValue({ kind: 'base', reason: null, shape: {}, solution: {}, body: {} });
  render(<AvatarBody profile={P} />);
  expect(screen.getByText('base avatar')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(/Base avatar ·/)).not.toBeInTheDocument();
});

test('out of range: the procedural body, no loading message', () => {
  useAvatarBody.mockReturnValue({ kind: 'standard', reason: 'range', shape: {} });
  render(<AvatarBody profile={P} />);
  expect(screen.getByText('procedural body')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('a buyer sees no body labels for any body, even with ?avatarDebug=1 in the link', () => {
  process.env.NODE_ENV = 'production';
  window.history.replaceState({}, '', '/?avatarDebug=1');
  const cases = [
    { kind: 'base', reason: null, shape: {}, solution: {}, body: {} },
    { kind: 'standard', reason: 'range', shape: {} },
    { kind: 'standard', reason: 'missing', shape: {} },
    { kind: 'standard', reason: 'error', shape: {} },
  ];
  for (const avatar of cases) {
    useAvatarBody.mockReturnValue(avatar);
    const { unmount } = render(<AvatarBody profile={{ heightCm: 180, chest: 140, waist: 130, hips: 150 }} />);
    // метки-заглушки тел из моков не в счёт
    const text = document.body.textContent.replace(/procedural body|base avatar$/g, '');
    expect(text).not.toMatch(LABELS);
    unmount();
  }
});

test('in development ?avatarDebug=1 shows which body is used and why', () => {
  process.env.NODE_ENV = 'development';
  window.history.replaceState({}, '', '/?avatarDebug=1');
  useAvatarBody.mockReturnValue({ kind: 'standard', reason: 'range', shape: {} });
  render(<AvatarBody profile={P} />);
  expect(screen.getByText('Standard body · out of calibrated range')).toBeInTheDocument();
});
