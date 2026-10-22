// Редактирование товара продавцом: форма заполнена текущими данными, сохранение — PATCH с сеткой.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditProductForm } from './SellerPanel';
import { authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  authFetch: jest.fn(),
}));

const PRODUCT = {
  _id: 'p1',
  title: 'Basic Tee',
  price: 9900,
  category: 'Clothes',
  garmentType: 'top',
  sizeChart: [
    { size: 'S', chest: 92, waist: 84, length: 66, sleeve: 19, fit: 'regular', stretch: 0 },
    { size: 'M', chest: 96, waist: 88, length: 68, sleeve: 20, fit: 'regular', stretch: 0 },
  ],
};

const renderForm = (props = {}) =>
  render(<EditProductForm product={PRODUCT} onCancel={jest.fn()} onSaved={jest.fn()} {...props} />);

afterEach(() => jest.clearAllMocks());

test('the form starts with the product data, including the size chart', () => {
  renderForm();
  expect(screen.getByLabelText('Title')).toHaveValue('Basic Tee');
  expect(screen.getByLabelText('Price, ₸')).toHaveValue(9900);
  expect(screen.getByDisplayValue('S')).toBeInTheDocument();
  expect(screen.getByDisplayValue('96')).toBeInTheDocument();
});

test('Save sends PATCH /api/products/:id with the new title, price and size chart', async () => {
  const saved = { ...PRODUCT, title: 'Basic Tee v2' };
  authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => saved });
  const onSaved = jest.fn();
  renderForm({ onSaved });

  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Basic Tee v2' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '10500' } });
  fireEvent.change(screen.getByDisplayValue('96'), { target: { value: '97' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  const [url, options] = authFetch.mock.calls[0];
  expect(url).toMatch(/\/api\/products\/p1$/);
  expect(options.method).toBe('PATCH');
  const body = options.body;
  expect(body.get('title')).toBe('Basic Tee v2');
  expect(body.get('price')).toBe('10500');
  expect(body.get('garmentType')).toBe('top');
  expect(body.get('stretch')).toBe('none');       // у старого товара поля не было — «No stretch»
  expect(body.get('image')).toBeNull();          // фото не меняли — не отправляем
  const chart = JSON.parse(body.get('sizeChart'));
  expect(chart.map((r) => r.size)).toEqual(['S', 'M']);
  expect(chart[1].chest).toBe(97);
});

test('an empty title is not sent to the server', () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('alert')).toHaveTextContent('The title cannot be empty.');
  expect(authFetch).not.toHaveBeenCalled();
});

test('a blocked request (e.g. CORS) shows a readable error instead of "Failed to fetch"', async () => {
  authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
  renderForm();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.');
});

test('a server error message is shown as is', async () => {
  authFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Price must be a positive number.' }) });
  renderForm();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Price must be a positive number.');
});

test('the seller picks how much the fabric stretches; it is sent with the product', async () => {
  authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => PRODUCT });
  renderForm();
  fireEvent.change(screen.getByLabelText(/Fabric stretch/), { target: { value: 'stretchy' } });
  expect(screen.getByText('Jersey, knits with elastane, bodycon')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(authFetch).toHaveBeenCalled());
  const body = authFetch.mock.calls[0][1].body;
  expect(body.get('stretch')).toBe('stretchy');
  expect(JSON.parse(body.get('sizeChart'))[0]).not.toHaveProperty('stretch'); // не строками сетки
});

test('measured flat: the form sends girthMode=flat and the numbers as entered (the server doubles them)', async () => {
  authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => PRODUCT });
  renderForm();
  fireEvent.click(screen.getByLabelText('Flat (half) width'));
  fireEvent.change(screen.getByDisplayValue('96'), { target: { value: '48' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(authFetch).toHaveBeenCalled());
  const body = authFetch.mock.calls[0][1].body;
  expect(body.get('girthMode')).toBe('flat');
  expect(JSON.parse(body.get('sizeChart'))[1].chest).toBe(48);
});

test('editing opens with full circumferences and says so', () => {
  renderForm();
  expect(screen.getByLabelText('Full circumference')).toBeChecked();
  expect(screen.getByText('Saved measurements are shown as full circumferences.')).toBeInTheDocument();
});
