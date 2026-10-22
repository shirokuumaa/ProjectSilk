// Вещь без 3D-модели в гардеробе: надевается шаблоном своего типа в размере покупателя;
// для типа без шаблона (обувь) — только проверка размера.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WardrobePage from './WardrobePage';
import { loadBodyProfile } from '../utils/bodyProfileApi';
import { findBestSize, sizeChartOf } from '../utils/fitCalculator';

// сцена не нужна — показываем, какие вещи и в каком размере ушли на фигуру
jest.mock('../components/GlbViewer', () => ({ garments }) => (
  <p data-testid="worn">{(garments || []).map((g) => `${g.url}|${g.size?.size || '-'}|${g.legs || '-'}`).join(',')}</p>
));
jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));

const PROFILE = { heightCm: 166, chest: 91, waist: 72, hips: 97 };
const CATALOG = [
  { _id: 'skirt', title: 'Pleated Skirt', garmentType: 'bottom', legs: 'joined',
    sizeChart: [{ size: 'S', waist: 66, hips: 92 }, { size: 'M', waist: 72, hips: 98 }, { size: 'L', waist: 78, hips: 104 }] },
  { _id: 'boots', title: 'Ankle Boots', garmentType: 'shoes', sizeChart: [] },
];

beforeEach(() => {
  loadBodyProfile.mockResolvedValue(PROFILE);
  localStorage.clear();
  localStorage.setItem('wardrobeItems', JSON.stringify([
    { id: 'skirt', name: 'Pleated Skirt', image: '' },
    { id: 'boots', name: 'Ankle Boots', image: '' },
  ]));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => CATALOG });
});
afterEach(() => { delete global.fetch; });

test('a skirt without a 3D model is worn as the generic skirt in the recommended size', async () => {
  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  expect(await screen.findByText('No 3D model yet · worn as a generic skirt')).toBeInTheDocument();

  const [wearSkirt] = screen.getAllByRole('button', { name: 'Wear' });
  fireEvent.click(wearSkirt);

  const size = findBestSize(PROFILE, CATALOG[0].sizeChart).recommended.size;
  await waitFor(() => expect(screen.getByTestId('worn')).toHaveTextContent(`/models/test-garments/skirt.glb|${size}|joined`));
});

test('boots (no generic shape) can only be size-checked', async () => {
  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  await screen.findByText('No 3D model yet · worn as a generic skirt');
  expect(screen.getAllByRole('button', { name: 'Wear' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Check size' })).toBeInTheDocument();
});

test('a stretchy dress: the wardrobe shows the same size as the product page and drapes it in that size', async () => {
  const dress = {
    _id: 'dress', title: 'Stretch Maxi Dress', garmentType: 'dress', stretch: 'stretchy',
    sizeChart: [
      { size: 'S', chest: 73, waist: 62, hips: 80, fit: 'tight' },
      { size: 'M', chest: 75, waist: 65, hips: 82, fit: 'tight' },
      { size: 'L', chest: 77, waist: 68, hips: 84, fit: 'tight' },
    ],
  };
  localStorage.setItem('wardrobeItems', JSON.stringify([{ id: 'dress', name: 'Stretch Maxi Dress', image: '' }]));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [dress] });

  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Wear' }));

  const expected = findBestSize(PROFILE, sizeChartOf(dress));   // то же, что считает страница товара
  expect(expected.recommended.wearable).toBe(true);
  expect(await screen.findByText(expected.message)).toBeInTheDocument();
  expect(screen.getByText('Stretchy fabric — fits snugly')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('worn')).toHaveTextContent(`|${expected.recommended.size}|`));
});
