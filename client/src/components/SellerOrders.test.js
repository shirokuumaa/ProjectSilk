// Заказы в кабинете продавца: покупатель и адрес, кнопки следующего шага, смена статуса.
import { fireEvent, render, screen } from '@testing-library/react';
import SellerOrders from './SellerOrders';
import { authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({ ...jest.requireActual('../utils/auth'), authFetch: jest.fn() }));

const ORDER = {
  _id: 'o1', number: 'PS-261029-ABC123', status: 'placed', total: 19900, currency: 'KZT', createdAt: '2026-10-29T10:00:00Z',
  items: [{ product: 'p1', title: 'Mini Dress', size: 'S', quantity: 1, price: 19900 }],
  contact: { name: 'Ann Lee', phone: '+7 701 123 45 67' },
  address: { country: 'KZ', city: 'Almaty', line1: 'Abay 10' },
};
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('an order shows the buyer, the address and the next steps; confirming moves it on', async () => {
  authFetch.mockImplementation(async (url, o = {}) => (o.method === 'PATCH'
    ? ok({ ...ORDER, status: 'confirmed' })
    : ok([ORDER])));
  render(<SellerOrders />);
  expect(await screen.findByText('PS-261029-ABC123')).toBeInTheDocument();
  expect(screen.getByText('1 to handle')).toBeInTheDocument();
  expect(screen.getByText(/Ann Lee/)).toBeInTheDocument();
  expect(screen.getByText('Abay 10, Almaty, Kazakhstan')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm order' }));
  expect(await screen.findByRole('button', { name: 'Mark as shipped' })).toBeInTheDocument();
  expect(JSON.parse(authFetch.mock.calls.find(([, o]) => o?.method === 'PATCH')[1].body)).toEqual({ status: 'confirmed' });
});

test('no orders yet — a plain message', async () => {
  authFetch.mockResolvedValue(ok([]));
  render(<SellerOrders />);
  expect(await screen.findByText(/No orders yet/)).toBeInTheDocument();
});
