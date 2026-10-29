// Принт ткани в форме продавца: однотонная по умолчанию; «Printed fabric» — плитка с фото и повтор 10 см
// уходят на сервер; при правке сохранённая плитка остаётся, повтор меняется, принт можно снять.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SellerPanel, { EditProductForm } from './SellerPanel';
import { fetchMe, isLoggedIn, authFetch } from '../utils/auth';
import { imageColor } from '../utils/garmentColor';
import { loadImage, imagePixels, makePrintTile } from '../utils/fabricPrint';

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
// в jsdom нет холста и картинки не грузятся — подменяем чтение фото и сборку плитки
jest.mock('../utils/fabricPrint', () => ({
  ...jest.requireActual('../utils/fabricPrint'),
  loadImage: jest.fn(),
  imagePixels: jest.fn(),
  makePrintTile: jest.fn(),
}));

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const W = 100;
const TILE = new Blob(['tile'], { type: 'image/jpeg' });

beforeEach(() => {
  jest.clearAllMocks();
  imageColor.mockResolvedValue('#c81e28');
  isLoggedIn.mockReturnValue(true);
  fetchMe.mockResolvedValue({ username: 'sam', role: 'seller', storeName: 'Sam Shop' });
  authFetch.mockImplementation(async (url, o = {}) => {
    if (url.includes('/api/products/mine')) return ok([]);
    if (o.method === 'POST' || o.method === 'PATCH') return ok({ _id: 'p1' }, o.method === 'POST' ? 201 : 200);
    return ok({ AI_MODE: 'off', AI_ENABLED: false });
  });
  loadImage.mockResolvedValue({ naturalWidth: W, naturalHeight: W });
  imagePixels.mockReturnValue({ data: new Uint8ClampedArray(W * W * 4).fill(255), width: W, height: W });
  makePrintTile.mockResolvedValue({ blob: TILE, url: 'blob:tile' });
  global.URL.createObjectURL = jest.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = jest.fn();
});

const sent = (method) => authFetch.mock.calls.find(([, o]) => o?.method === method)[1].body;

test('a new product is plain by default and sends no print', async () => {
  render(<MemoryRouter><SellerPanel /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText(/Product image/), { target: { files: [new File(['x'], 'tee.png', { type: 'image/png' })] } });
  await screen.findByLabelText('Title');
  expect(screen.getByLabelText('Printed fabric')).not.toBeChecked();
  expect(screen.getByText(/Plain item — the try-on figure shows it in the main colour/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tee' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '9900' } });
  fireEvent.change(screen.getByLabelText('Garment type'), { target: { value: 'top' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText(/Product saved/);
  expect(sent('POST').get('print')).toBeNull();
  expect(sent('POST').get('printTileCm')).toBeNull();
});

test('"Printed fabric" cuts a tile from the centre of the photo and sends it with a 10 cm repeat', async () => {
  render(<MemoryRouter><SellerPanel /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText(/Product image/), { target: { files: [new File(['x'], 'dress.png', { type: 'image/png' })] } });
  await screen.findByLabelText('Title');
  fireEvent.click(screen.getByLabelText('Printed fabric'));
  expect(screen.getByLabelText('One repeat on the fabric, cm')).toHaveValue(10);
  await waitFor(() => expect(loadImage).toHaveBeenCalledWith('blob:preview'));
  await waitFor(() => expect(makePrintTile).toHaveBeenCalledTimes(1));   // после паузы 250 мс
  const [, box] = makePrintTile.mock.calls[0];
  expect(box).toEqual({ x: 35, y: 35, size: 30 });                        // белое фото — центр, 0,3 стороны
  expect(await screen.findByTestId('print-preview')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('One repeat on the fabric, cm'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dress' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '19900' } });
  fireEvent.change(screen.getByLabelText('Garment type'), { target: { value: 'dress' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText(/Product saved/);
  expect(sent('POST').get('print')).toBeInstanceOf(Blob);
  expect(sent('POST').get('printTileCm')).toBe('6');
});

test('a repeat outside 1…200 cm is named before saving', async () => {
  const product = { _id: 'p1', title: 'Dress', price: 1, garmentType: 'dress', sizeChart: [], image: '/uploads/images/d.png',
    print: { image: '/uploads/images/t.jpg', tileCm: 10 } };
  render(<EditProductForm product={product} onCancel={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('One repeat on the fabric, cm'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Print repeat must be between 1 and 200 cm.')).toBeInTheDocument();
  expect(authFetch).not.toHaveBeenCalled();
});

describe('editing a printed product', () => {
  const PRODUCT = {
    _id: 'p1', title: 'Dress', price: 19900, category: 'Clothes', garmentType: 'dress', sizeChart: [],
    image: '/uploads/images/dress.png', print: { image: '/uploads/images/tile.jpg', tileCm: 4 },
  };
  const renderForm = () => render(<EditProductForm product={PRODUCT} onCancel={jest.fn()} onSaved={jest.fn()} />);

  test('the saved tile is kept: only the new repeat goes to the server', async () => {
    renderForm();
    expect(screen.getByLabelText('Printed fabric')).toBeChecked();
    expect(screen.getByLabelText('One repeat on the fabric, cm')).toHaveValue(4);
    expect(screen.getByTestId('print-preview').style.backgroundImage).toContain('/uploads/images/tile.jpg');
    await waitFor(() => expect(loadImage).toHaveBeenCalledWith('http://localhost:5050/uploads/images/dress.png'));
    fireEvent.change(screen.getByLabelText('One repeat on the fabric, cm'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(sent('PATCH').get('print')).toBeNull();
    expect(sent('PATCH').get('printTileCm')).toBe('5');
    expect(makePrintTile).not.toHaveBeenCalled();
  });

  test('unticking "Printed fabric" removes the print', async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Printed fabric'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(sent('PATCH').get('printTileCm')).toBe('');
    expect(sent('PATCH').get('print')).toBeNull();
  });
});
