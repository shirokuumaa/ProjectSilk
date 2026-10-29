// Вещь без 3D-модели в гардеробе: надевается шаблоном своего типа в размере покупателя;
// для типа без шаблона (обувь) — только проверка размера.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WardrobePage from './WardrobePage';
import { loadBodyProfile } from '../utils/bodyProfileApi';
import { findBestSize, sizeChartOf } from '../utils/fitCalculator';

// сцена не нужна — показываем, какие вещи и в каком размере ушли на фигуру
// щелчок по сцене-заглушке — «файлы вещей не загрузились»
jest.mock('../components/GlbViewer', () => ({ garments, onGarmentError }) => (
  <p data-testid="worn" onClick={() => (garments || []).forEach((g) => onGarmentError?.(g.url))}>
    {(garments || []).map((g) => `${g.url}|${g.size?.size || '-'}|${g.legs || '-'}${g.print ? `|print ${g.print.image} ${g.print.tileCm}` : ''}`).join(',')}
  </p>
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

test('boots (no generic shape) can only be size-checked, and the buyer is told why', async () => {
  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  await screen.findByText('No 3D model yet · worn as a generic skirt');
  expect(screen.getAllByRole('button', { name: 'Wear' })).toHaveLength(1);
  expect(screen.getByText('No 3D model yet · not shown on the figure')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Check size' }));
  expect(await screen.findByText(
    'Ankle Boots has no 3D model yet, and there is no generic shape for shoes, so it is not shown on the figure.',
  )).toBeInTheDocument();
  expect(screen.getByTestId('worn')).toHaveTextContent(/^$/);
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

test('an old product without a type is not worn as a top: "Type not set" and a size check only', async () => {
  const old = { _id: 'old', title: 'Test dress', category: 'Clothes', sizeChart: [] };
  localStorage.setItem('wardrobeItems', JSON.stringify([{ id: 'old', name: 'Test dress', image: '' }]));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [old] });

  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  expect(await screen.findByText('Type not set · not shown on the figure')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Wear' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Check size' }));
  expect(await screen.findByText(/Test dress: type not set\./)).toBeInTheDocument();
  expect(screen.getByTestId('worn')).toHaveTextContent(/^$/);
});

test('a dress whose 3D file is missing is worn as the generic dress, with an explanation', async () => {
  const dress = { _id: 'red', title: 'Red Dress', garmentType: 'dress', model3d: '/uploads/models/missing.glb', sizeChart: [] };
  localStorage.setItem('wardrobeItems', JSON.stringify([{ id: 'red', name: 'Red Dress', image: '' }]));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [dress] });

  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Wear' }));
  await waitFor(() => expect(screen.getByTestId('worn')).toHaveTextContent('/uploads/models/missing.glb'));

  fireEvent.click(screen.getByTestId('worn'));   // файл не загрузился
  await waitFor(() => expect(screen.getByTestId('worn')).toHaveTextContent('/uploads/stub/dress.glb|-|joined'));
  expect(screen.getByText('The 3D model of Red Dress could not be loaded, so it is shown as a generic dress.')).toBeInTheDocument();
});

test('photo try-on is hidden: no "On my photo" mode and no photo limit note', async () => {
  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  await screen.findByText('No 3D model yet · worn as a generic skirt');
  expect(screen.queryByRole('button', { name: /On my photo/ })).not.toBeInTheDocument();
  expect(screen.getByText('Avatar and camera are free')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /On my avatar/ })).toBeInTheDocument();
});

test('a printed product goes on the figure with its print tile and repeat', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [
    { ...CATALOG[0], print: { image: '/uploads/images/check.jpg', tileCm: 4 } }, CATALOG[1],
  ] });
  render(<MemoryRouter><WardrobePage /></MemoryRouter>);
  const [wearSkirt] = await screen.findAllByRole('button', { name: 'Wear' });
  fireEvent.click(wearSkirt);
  await waitFor(() => expect(screen.getByTestId('worn'))
    .toHaveTextContent('|print http://localhost:5050/uploads/images/check.jpg 4'));
});
