// Страница примерки без 3D-сцены: что уходит на фигуру и что объясняется покупателю.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TryOnAvatar from './TryOnAvatar';
import { loadBodyProfile } from '../../utils/bodyProfileApi';

// сцена: Canvas рендерит детей как есть, тела нет — Garment только грузит файл
jest.mock('@react-three/fiber', () => ({ Canvas: ({ children }) => <div data-testid="scene">{children}</div> }));
jest.mock('@react-three/drei', () => ({ OrbitControls: () => null }));
jest.mock('../../components/AvatarBody', () => () => null);
jest.mock('../../components/BodyStage', () => () => null);
jest.mock('../../utils/avatarBody', () => ({ useAvatarBody: () => ({ shape: null }) }));
jest.mock('../../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));

// загрузчик GLB: адреса с «missing» не находятся, остальные — пустая сцена
const loaded = [];
jest.mock('three/examples/jsm/loaders/GLTFLoader.js', () => {
  const { Group } = jest.requireActual('three');
  return {
    GLTFLoader: class {
      load(url, onLoad, onProgress, onError) {
        loaded.push(url);
        if (url.includes('missing')) setTimeout(() => onError(new Error('404')), 0);
        else setTimeout(() => onLoad({ scene: new Group() }), 0);
      }
    },
  };
});

const PROFILE = { heightCm: 166, chest: 88, waist: 70, hips: 96 };

function open(catalog) {
  localStorage.setItem('wardrobeItems', JSON.stringify(catalog.map((p) => ({ id: p._id, name: p.title, image: '' }))));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => catalog });
  render(<MemoryRouter><TryOnAvatar /></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  loaded.length = 0;
  loadBodyProfile.mockResolvedValue(PROFILE);
  // three-теги (<group>, <color>…) в DOM неизвестны — это ожидаемо для сцены-заглушки
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  console.error.mockRestore();
  delete global.fetch;
});

test('an old product without a type is not worn as a tee: "type not set" and a size check only', async () => {
  open([{ _id: 'old', title: 'Test dress', category: 'Clothes', sizeChart: [] }]);

  expect(await screen.findByText('Clothes · type not set')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Wear' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Check size' }));
  expect(await screen.findByText(/Test dress: type not set\./)).toBeInTheDocument();
  await waitFor(() => expect(loaded).toEqual([]));
});

test('a type-less item left in a slot by an old draft is not put on the figure', async () => {
  localStorage.setItem('avatarOutfitDraft', JSON.stringify({ top: 'old' }));
  open([{ _id: 'old', title: 'Test dress', category: 'Clothes', sizeChart: [] }]);

  await screen.findByText('Clothes · type not set');
  expect(screen.queryByRole('button', { name: 'Take off' })).not.toBeInTheDocument();
  expect(loaded).toEqual([]);
});
