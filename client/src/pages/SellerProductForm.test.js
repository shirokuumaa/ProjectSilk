// Форма товара: подписанные поля в рамке, «Save product» — настоящая кнопка;
// после сохранения поле файла очищается.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SellerPanel from './SellerPanel';
import { fetchMe, isLoggedIn, authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  fetchMe: jest.fn(),
  authFetch: jest.fn(),
}));

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  isLoggedIn.mockReturnValue(true);
  fetchMe.mockResolvedValue({ username: 'sam', role: 'seller', storeName: 'Sam Shop' });
  authFetch.mockImplementation(async (url, o = {}) => {
    if (url.includes('/api/products/mine')) return ok([]);
    if (url.endsWith('/api/products') && o.method === 'POST') return ok({ _id: 'p1' }, 201);
    return ok({ AI_MODE: 'off', AI_ENABLED: false });
  });
  global.URL.createObjectURL = jest.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = jest.fn();
});

async function openForm() {
  render(<MemoryRouter><SellerPanel /></MemoryRouter>);
  const file = await screen.findByLabelText(/Product image/);
  fireEvent.change(file, { target: { files: [new File(['x'], 'tee.png', { type: 'image/png' })] } });
  await screen.findByLabelText('Title');
}

// jsdom отбрасывает значения с var(--…), поэтому проверяем размеры, а не цвета
test('title, price and category are labelled, padded fields like the rest of the form', async () => {
  await openForm();
  for (const name of ['Title', 'Price, ₸', 'Category']) {
    const field = screen.getByLabelText(name);
    expect(field.style.padding).toBe('8px 10px');
    expect(field.style.borderRadius).toBe('8px');
    expect(field.style.width).toBe('100%');
  }
});

test('"Save product" looks like a button (dark, padded, rounded)', async () => {
  await openForm();
  const save = screen.getByRole('button', { name: 'Save product' });
  expect(save.style.padding).toBe('8px 14px');
  expect(save.style.borderRadius).toBe('8px');
  expect(save.style.cursor).toBe('pointer');
});

test('after saving, the image file field is empty again', async () => {
  await openForm();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tee' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '9900' } });
  fireEvent.change(screen.getByLabelText('Garment type'), { target: { value: 'top' } });
  const before = screen.getByLabelText(/Product image/);
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText(/Product saved/);
  await waitFor(() => expect(screen.getByLabelText(/Product image/)).not.toBe(before));
  expect(screen.getByLabelText(/Product image/).value).toBe('');
});

test('saving an empty form names every missing field at once', async () => {
  await openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Please enter a title.');
  expect(alert).toHaveTextContent('Please enter a price (a positive number).');
  expect(alert).toHaveTextContent('Please choose the garment type.');
  expect(authFetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/products$/), expect.objectContaining({ method: 'POST' }));
});

test('the garment type starts empty and must be chosen before saving', async () => {
  await openForm();
  const type = screen.getByLabelText('Garment type');
  expect(type).toHaveValue('');
  expect(screen.getByRole('option', { name: 'Choose a type…' })).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wrap Dress' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '19900' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Please choose the garment type.');
  expect(authFetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/products$/), expect.objectContaining({ method: 'POST' }));

  fireEvent.change(type, { target: { value: 'dress' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText(/Product saved/);
  const post = authFetch.mock.calls.find(([url, o]) => /\/api\/products$/.test(url) && o?.method === 'POST');
  expect(post[1].body.get('garmentType')).toBe('dress');
});

test('the chosen silhouette is sent with the product and dropped when the type changes', async () => {
  await openForm();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wrap Dress' } });
  fireEvent.change(screen.getByLabelText('Price, ₸'), { target: { value: '19900' } });
  fireEvent.change(screen.getByLabelText('Garment type'), { target: { value: 'top' } });
  fireEvent.click(screen.getByRole('button', { name: /Straight top/ }));
  fireEvent.change(screen.getByLabelText('Garment type'), { target: { value: 'dress' } });
  expect(screen.getByRole('button', { name: /None of these/ })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: /Flared/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText(/Product saved/);
  const post = authFetch.mock.calls.find(([url, o]) => /\/api\/products$/.test(url) && o?.method === 'POST');
  expect(JSON.parse(post[1].body.get('silhouette'))).toEqual({ template: 'dress_flared', sleeve: 'short', length: 'knee' });
});
