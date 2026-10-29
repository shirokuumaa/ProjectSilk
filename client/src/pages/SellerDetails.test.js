// Карточка товара в форме продавца: галерея, описание, состав ткани, уход, страна, остаток по размерам.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SellerPanel, { EditProductForm } from './SellerPanel';
import { fetchMe, isLoggedIn, authFetch } from '../utils/auth';
import { imageColor } from '../utils/garmentColor';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  fetchMe: jest.fn(),
  authFetch: jest.fn(),
}));
jest.mock('../utils/garmentColor', () => ({
  ...jest.requireActual('../utils/garmentColor'),
  imageColor: jest.fn(),
}));

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const png = (name) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  jest.clearAllMocks();
  imageColor.mockResolvedValue(null);
  isLoggedIn.mockReturnValue(true);
  fetchMe.mockResolvedValue({ username: 'sam', role: 'seller', storeName: 'Sam Shop' });
  authFetch.mockImplementation(async (url, o = {}) => {
    if (url.includes('/api/products/mine')) return ok([]);
    if (o.method === 'POST' || o.method === 'PATCH') return ok({ _id: 'p1' }, o.method === 'POST' ? 201 : 200);
    return ok({ AI_MODE: 'off', AI_ENABLED: false });
  });
  let n = 0;
  global.URL.createObjectURL = jest.fn(() => `blob:preview-${(n += 1)}`);
  global.URL.revokeObjectURL = jest.fn();
});

const sent = (method) => authFetch.mock.calls.find(([, o]) => o?.method === method)?.[1].body;

async function openNewProduct() {
  render(<MemoryRouter><SellerPanel /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText(/Product image/), { target: { files: [png('tee.png')] } });
  await screen.findByLabelText('Title');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tee' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '9900' } });
  fireEvent.change(screen.getByLabelText('Garment type'), { target: { value: 'top' } });
}

test('a new product sends gallery photos, details and stock per size', async () => {
  await openNewProduct();
  fireEvent.change(screen.getByLabelText('Add photos to the gallery'), { target: { files: [png('back.png'), png('detail.png')] } });
  expect(screen.getByText('(2 of 8)')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Soft cotton tee' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add fibre' }));
  fireEvent.change(screen.getByLabelText('Fibre 1'), { target: { value: 'Cotton' } });
  fireEvent.change(screen.getByLabelText('Share of fibre 1, %'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Care'), { target: { value: 'Wash at 30 °C' } });
  fireEvent.change(screen.getByLabelText('Country of origin'), { target: { value: 'Portugal' } });

  fireEvent.click(screen.getByRole('button', { name: /XS–XXL/ }));
  fireEvent.change(await screen.findByLabelText('Stock of size M'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Stock of size L'), { target: { value: '0' } });

  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await waitFor(() => expect(sent('POST')).toBeTruthy());
  const fd = sent('POST');
  expect(fd.getAll('gallery').map((f) => f.name)).toEqual(['back.png', 'detail.png']);
  expect(fd.get('description')).toBe('Soft cotton tee');
  expect(JSON.parse(fd.get('composition'))).toEqual([{ fibre: 'Cotton', percent: 100 }]);
  expect(fd.get('care')).toBe('Wash at 30 °C');
  expect(fd.get('countryOfOrigin')).toBe('Portugal');
  expect(fd.get('galleryKeep')).toBeNull();
  const chart = JSON.parse(fd.get('sizeChart'));
  expect(chart.find((r) => r.size === 'M').stock).toBe(4);
  expect(chart.find((r) => r.size === 'L').stock).toBe(0);
  expect(chart.find((r) => r.size === 'S')).not.toHaveProperty('stock');   // пусто — не указан
});

test('a composition that does not add up to 100 % is not sent', async () => {
  await openNewProduct();
  fireEvent.click(screen.getByRole('button', { name: '+ Add fibre' }));
  fireEvent.change(screen.getByLabelText('Fibre 1'), { target: { value: 'Cotton' } });
  fireEvent.change(screen.getByLabelText('Share of fibre 1, %'), { target: { value: '60' } });
  expect(screen.getByText('Total 60 %')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  expect(await screen.findByText('Fabric composition must add up to 100 % (now 60 %).')).toBeInTheDocument();
  expect(sent('POST')).toBeUndefined();
});

describe('editing a product', () => {
  const PRODUCT = {
    _id: 'p1', title: 'Dress', price: 19900, garmentType: 'dress', image: '/uploads/images/d.png',
    images: ['/uploads/images/a.png', '/uploads/images/b.png'],
    description: 'Midi dress', care: 'Hand wash', countryOfOrigin: 'Italy',
    composition: [{ fibre: 'Viscose', percent: 100 }],
    sizeChart: [{ size: 'S', chest: 86, stock: 2 }, { size: 'M', chest: 90 }],
  };

  test('opens with the saved details and stock; a removed photo is left out of galleryKeep', async () => {
    render(<EditProductForm product={PRODUCT} onCancel={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByLabelText('Description')).toHaveValue('Midi dress');
    expect(screen.getByLabelText('Fibre 1')).toHaveValue('Viscose');
    expect(screen.getByLabelText('Stock of size S')).toHaveValue(2);
    expect(screen.getByLabelText('Stock of size M')).toHaveValue(null);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Saved photo 1' }));
    fireEvent.change(screen.getByLabelText('Care'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent('PATCH')).toBeTruthy());
    const fd = sent('PATCH');
    expect(JSON.parse(fd.get('galleryKeep'))).toEqual(['/uploads/images/b.png']);
    expect(fd.get('care')).toBe('');   // пусто — очистить
    expect(JSON.parse(fd.get('sizeChart')).map((r) => r.stock)).toEqual([2, undefined]);
  });
});

describe('fabric stretch from the composition', () => {
  const fill = (fibres) => {
    fireEvent.click(screen.getByRole('button', { name: '+ Add fibre' }));
    fibres.forEach(([fibre, percent], i) => {
      if (i > 0) fireEvent.click(screen.getByRole('button', { name: '+ Add fibre' }));
      fireEvent.change(screen.getByLabelText(`Fibre ${i + 1}`), { target: { value: fibre } });
      fireEvent.change(screen.getByLabelText(`Share of fibre ${i + 1}, %`), { target: { value: String(percent) } });
    });
  };

  test('3 % elastane suggests "Slight stretch"; one click sets it and it is sent', async () => {
    await openNewProduct();
    fill([['Cotton', 97], ['Elastane', 3]]);
    expect(screen.getByRole('status')).toHaveTextContent('3 % elastane usually means “Slight stretch”.');
    fireEvent.click(screen.getByRole('button', { name: 'Use Slight stretch' }));
    expect(screen.queryByRole('button', { name: 'Use Slight stretch' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(sent('POST')).toBeTruthy());
    expect(sent('POST').get('stretch')).toBe('slight');
  });

  test('no elastane — no suggestion, the stretch stays as the seller set it', async () => {
    await openNewProduct();
    fill([['Cotton', 100]]);
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument();
  });
});
