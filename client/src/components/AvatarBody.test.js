// Пока болванка грузится — «Loading your avatar…», а не пустая сцена;
// служебная плашка — только по ?avatarDebug=1.
import { render, screen } from '@testing-library/react';
import AvatarBody from './AvatarBody';
import { useAvatarBody } from '../utils/avatarBody';

// сцена three.js в jsdom не нужна: Html — обычный div, тела — метки
jest.mock('@react-three/drei', () => ({ Html: ({ children }) => <div>{children}</div> }));
jest.mock('./BodyAvatar', () => () => <p>procedural body</p>);
jest.mock('./BaseAvatar', () => () => <p>base avatar</p>);
jest.mock('../utils/avatarBody', () => ({ useAvatarBody: jest.fn() }));

const P = { heightCm: 156, chest: 80, waist: 62, hips: 86 };
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); });

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

test('?avatarDebug=1 shows which body is used and why', () => {
  window.history.replaceState({}, '', '/?avatarDebug=1');
  useAvatarBody.mockReturnValue({ kind: 'standard', reason: 'range', shape: {} });
  render(<AvatarBody profile={P} />);
  expect(screen.getByText('Standard body · out of calibrated range')).toBeInTheDocument();
});
