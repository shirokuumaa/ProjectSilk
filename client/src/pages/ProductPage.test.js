// Страница товара /product/:id: загрузка, «not found», разбор размера с обмерами и без.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductPage from './ProductPage';
import { loadBodyProfile } from '../utils/bodyProfileApi';

jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));

const PRODUCT = {
  _id: 'p1',
  title: 'Basic Tee',
  price: 9900,
  image: '/uploads/images/tee.jpg',
  garmentType: 'top',
  sizeChart: [
    { size: 'S', chest: 92, waist: 84, length: 66, fit: 'regular', stretch: 0 },
    { size: 'M', chest: 96, waist: 88, length: 68, fit: 'regular', stretch: 0 },
  ],
};

function respond(status, body) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

function renderAt(path = '/product/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/product/:id" element={<ProductPage addToCart={jest.fn()} />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { jest.clearAllMocks(); delete global.fetch; });

test('shows a loading state, then the product with its size chart', async () => {
  respond(200, PRODUCT);
  loadBodyProfile.mockResolvedValue(null);
  renderAt();
  expect(screen.getByText('Loading the product…')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Basic Tee' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/products\/p1$/));
  expect(screen.getByText('Size chart · garment measurements, cm')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Bust' })).toBeInTheDocument();
  // мерок бёдер нет ни у одного размера — пустого столбца нет
  expect(screen.queryByRole('columnheader', { name: 'Hips' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Wardrobe' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument();
  // без 3D-модели примерка недоступна и это объяснено
  expect(screen.getByRole('button', { name: 'Try on' })).toBeDisabled();
  expect(screen.getByText(/No 3D model yet/)).toBeInTheDocument();
});

test('a missing product shows "Product not found" and a way back', async () => {
  respond(404, { message: 'Not found' });
  loadBodyProfile.mockResolvedValue(null);
  renderAt('/product/nope');
  expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← Back to the shop' })).toHaveAttribute('href', '/');
});

test('without measurements: an "Add your measurements" button instead of the breakdown', async () => {
  respond(200, PRODUCT);
  loadBodyProfile.mockResolvedValue(null);
  renderAt();
  expect(await screen.findByRole('button', { name: 'Add your measurements' })).toBeInTheDocument();
  expect(screen.queryByText(/Your size is/)).not.toBeInTheDocument();
});

test('with measurements: the recommended size and the ease per measurement in cm', async () => {
  respond(200, PRODUCT);
  loadBodyProfile.mockResolvedValue({ heightCm: 166, chest: 90, waist: 70, hips: 96 });
  renderAt();
  expect(await screen.findByText('Your size is S')).toBeInTheDocument();
  expect(screen.getByText('+2 cm')).toBeInTheDocument();   // bust: 92 − 90
  expect(screen.getByText('+14 cm')).toBeInTheDocument();  // waist: 84 − 70
  expect(screen.queryByRole('button', { name: 'Add your measurements' })).not.toBeInTheDocument();
});

test('a stretchy dress smaller than the body is not "too tight", and the buyer sees why', async () => {
  respond(200, {
    ...PRODUCT,
    title: 'Stretch Maxi Dress',
    garmentType: 'dress',
    stretch: 'stretchy',
    sizeChart: [
      { size: 'S', chest: 73, waist: 62, hips: 80, fit: 'tight' },
      { size: 'M', chest: 75, waist: 65, hips: 82, fit: 'tight' },
    ],
  });
  loadBodyProfile.mockResolvedValue({ heightCm: 166, chest: 84, waist: 69, hips: 92 });
  renderAt();
  expect(await screen.findByText(/^Your size is (S|M)$/)).toBeInTheDocument();
  expect(screen.getByText('Stretchy fabric — fits snugly')).toBeInTheDocument();
  expect(screen.queryByText('will not close')).not.toBeInTheDocument();
  expect(screen.getByText('-7 cm')).toBeInTheDocument(); // талия S: 62 − 69, показана честно
});

test('without stretch the same dress will not close', async () => {
  respond(200, {
    ...PRODUCT,
    garmentType: 'dress',
    sizeChart: [{ size: 'S', chest: 73, waist: 62, hips: 80, fit: 'tight' }],
  });
  loadBodyProfile.mockResolvedValue({ heightCm: 166, chest: 84, waist: 69, hips: 92 });
  renderAt();
  expect(await screen.findByText(/No size will really work/)).toBeInTheDocument();
  expect(screen.queryByText(/Stretchy fabric/)).not.toBeInTheDocument();
});
