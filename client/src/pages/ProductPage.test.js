// Страница товара /product/:id: загрузка, «not found», разбор размера с обмерами и без.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductPage from './ProductPage';
import { loadBodyProfile } from '../utils/bodyProfileApi';

// сцена примерки: показываем, какая вещь и в каком размере ушла на фигуру
jest.mock('../components/GlbViewer', () => ({ garments }) => (
  <p data-testid="worn">{(garments || []).map((g) => `${g.url}|${g.size?.size || '-'}`).join(',')}</p>
));
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

function renderAt(path = '/product/p1', addToCart = jest.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/product/:id" element={<ProductPage addToCart={addToCart} />} />
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
  // футболка без своей 3D-модели примеряется шаблоном — прямо на странице
  expect(screen.getByRole('button', { name: 'Try on my avatar' })).toBeEnabled();
  expect(screen.queryByText(/No 3D model yet/)).not.toBeInTheDocument();
});

test('a coat with no 3D model and no generic shape cannot be tried on, and the buyer is told why', async () => {
  respond(200, { ...PRODUCT, garmentType: 'outerwear' });
  loadBodyProfile.mockResolvedValue(null);
  renderAt();
  expect(await screen.findByRole('button', { name: 'Try on my avatar' })).toBeDisabled();
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
  // облегающий крой: если подходят оба — советуем меньший, S
  expect(await screen.findByText(/^Your size is S( — a fitted cut sits best in the smaller size)?$/)).toBeInTheDocument();
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

describe('the size goes into the cart', () => {
  const BODY = { heightCm: 166, chest: 90, waist: 70, hips: 96 };
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('bodyProfile', JSON.stringify(BODY));   // кэш обмеров, как после входа
    loadBodyProfile.mockResolvedValue(BODY);
  });

  test('the recommended size when the buyer picked none', async () => {
    respond(200, PRODUCT);
    const addToCart = jest.fn().mockReturnValue(true);
    renderAt('/product/p1', addToCart);
    await screen.findByText('Your size is S');
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart · S' }));
    expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', size: 'S' }));
    expect(screen.getByText('Added to cart · size S')).toBeInTheDocument();
  });

  test('the size the buyer picked', async () => {
    respond(200, PRODUCT);
    const addToCart = jest.fn().mockReturnValue(true);
    renderAt('/product/p1', addToCart);
    await screen.findByText('Your size is S');
    fireEvent.click(screen.getByRole('button', { name: /^M/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart · M' }));
    expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ size: 'M' }));
  });
});

describe('the full product card', () => {
  const BODY = { heightCm: 166, chest: 90, waist: 70, hips: 96 };
  const FULL = {
    ...PRODUCT,
    images: ['/uploads/images/back.jpg', '/uploads/images/detail.jpg'],
    description: 'Soft cotton tee.\nRegular fit.',
    composition: [{ fibre: 'Polyester', percent: 92 }, { fibre: 'Elastane', percent: 8 }],
    care: 'Machine wash at 30 °C',
    countryOfOrigin: 'Portugal',
  };
  beforeEach(() => localStorage.clear());

  test('a gallery of all photos; a thumbnail opens its photo', async () => {
    respond(200, FULL);
    loadBodyProfile.mockResolvedValue(null);
    renderAt();
    const main = await screen.findByRole('img', { name: 'Basic Tee' });
    expect(main).toHaveAttribute('src', 'http://localhost:5050/uploads/images/tee.jpg');
    expect(screen.getAllByRole('button', { name: /^Photo \d of 3$/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Photo 2 of 3' }));
    expect(screen.getByRole('img', { name: 'Basic Tee' })).toHaveAttribute('src', 'http://localhost:5050/uploads/images/back.jpg');
  });

  test('description, composition, care and country of origin', async () => {
    respond(200, FULL);
    loadBodyProfile.mockResolvedValue(null);
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByText(/Soft cotton tee\./)).toBeInTheDocument();
    expect(screen.getByText('92% Polyester · 8% Elastane')).toBeInTheDocument();
    expect(screen.getByText('Machine wash at 30 °C')).toBeInTheDocument();
    expect(screen.getByText('Portugal')).toBeInTheDocument();
  });

  test('the recommended size is picked in advance; a sold-out size is greyed and cannot be picked', async () => {
    respond(200, { ...PRODUCT, sizeChart: [{ ...PRODUCT.sizeChart[0], stock: 5 }, { ...PRODUCT.sizeChart[1], stock: 0 }] });
    loadBodyProfile.mockResolvedValue(BODY);
    renderAt();
    await screen.findByText('Your size is S');
    expect(screen.getByRole('button', { name: /^S/ })).toHaveAttribute('aria-pressed', 'true');
    const m = screen.getByRole('button', { name: /^M/ });
    expect(m).toBeDisabled();
    expect(m).toHaveTextContent('out of stock');
  });

  test('the recommended size is sold out: nothing is picked and "Add to cart" asks for a size', async () => {
    respond(200, { ...PRODUCT, sizeChart: [{ ...PRODUCT.sizeChart[0], stock: 0 }, PRODUCT.sizeChart[1]] });
    loadBodyProfile.mockResolvedValue(BODY);
    const addToCart = jest.fn().mockReturnValue(true);
    renderAt('/product/p1', addToCart);
    expect(await screen.findByText('Your size S is out of stock.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose a size.');
    expect(addToCart).not.toHaveBeenCalled();
  });

  test('"Try on my avatar" shows the item on the figure right here, in the chosen size', async () => {
    respond(200, {
      ...PRODUCT,
      sizeModels: [
        { size: 'S', model3d: '/uploads/models/tee_S.glb' },
        { size: 'M', model3d: '/uploads/models/tee_M.glb' },
      ],
    });
    loadBodyProfile.mockResolvedValue(BODY);
    renderAt();
    await screen.findByText('Your size is S');
    fireEvent.click(screen.getByRole('button', { name: 'Try on my avatar' }));
    expect(await screen.findByTestId('worn')).toHaveTextContent('http://localhost:5050/uploads/models/tee_S.glb|S');
    expect(screen.getByText('On your figure in size S')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^M/ }));
    expect(await screen.findByTestId('worn')).toHaveTextContent('tee_M.glb|M');
  });

  test('without measurements the avatar tab asks for them', async () => {
    respond(200, PRODUCT);
    loadBodyProfile.mockResolvedValue(null);
    renderAt();
    fireEvent.click(await screen.findByRole('tab', { name: 'On my avatar' }));
    expect(screen.getByRole('button', { name: 'Add measurements to try it on' })).toBeInTheDocument();
  });
});
