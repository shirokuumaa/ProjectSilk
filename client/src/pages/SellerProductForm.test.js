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
  const before = screen.getByLabelText(/Product image/);
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText(/Product saved/);
  await waitFor(() => expect(screen.getByLabelText(/Product image/)).not.toBe(before));
  expect(screen.getByLabelText(/Product image/).value).toBe('');
});
