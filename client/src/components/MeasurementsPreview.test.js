// Подпись к фигуре на странице обмеров: без «a — cm bust», когда обхвата ещё нет.
import { render, screen } from '@testing-library/react';
import MeasurementsPreview from './MeasurementsPreview';

// сцена three.js в jsdom не нужна
jest.mock('@react-three/fiber', () => ({ Canvas: () => null }));
jest.mock('@react-three/drei', () => ({ OrbitControls: () => null }));
jest.mock('./AvatarBody', () => () => null);
jest.mock('./BodyStage', () => () => null);

const empty = { heightCm: 170, chest: '', waist: '', hips: '' };

test('empty measurements: a plain invitation, no dash instead of a number', () => {
  render(<MeasurementsPreview m={empty} />);
  expect(screen.getByText('The body is built from your measurements. Enter your height, bust, waist and hips, and the figure updates as you type.')).toBeInTheDocument();
  expect(screen.queryByText(/—\s*cm/)).not.toBeInTheDocument();
  expect(screen.queryByText(/\ba\s+—/)).not.toBeInTheDocument();
});

test('with a bust: the sentence uses the number', () => {
  render(<MeasurementsPreview m={{ ...empty, chest: '91' }} />);
  expect(screen.getByText(/a 91 cm bust gives a body with that bust/)).toBeInTheDocument();
});
