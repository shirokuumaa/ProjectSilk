// Заказ покупателя: шаги статуса, вещи, адрес; отмена, пока продавец не подтвердил.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OrderPage from './OrderPage';
import { authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({ ...jest.requireActual('../utils/auth'), authFetch: jest.fn() }));

const ORDER = {
  _id: 'o1', number: 'PS-261029-ABC123', status: 'placed', storeName: 'Store A', total: 19900, currency: 'KZT',
  createdAt: '2026-10-29T10:00:00Z', history: [{ status: 'placed', at: '2026-10-29T10:00:00Z' }],
  items: [{ product: 'p1', title: 'Mini Dress', size: 'S', quantity: 1, price: 19900 }],
  contact: { name: 'Ann Lee', phone: '+7 701 123 45 67' },
  address: { country: 'KZ', city: 'Almaty', line1: 'Abay 10' },
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/orders/:id" element={<OrderPage />} /></Routes></MemoryRouter>,
);

test('a just-placed order: thank-you note, steps, address, payment coming soon; it can be cancelled', async () => {
  authFetch.mockImplementation(async (url, o = {}) => (o.method === 'POST' ? ok({ ...ORDER, status: 'cancelled' }) : ok(ORDER)));
  renderAt('/orders/o1?placed=1');
  expect(await screen.findByText('PS-261029-ABC123')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Store A will contact you');
  expect(screen.getByText('Abay 10, Almaty, Kazakhstan')).toBeInTheDocument();
  expect(screen.getByText(/Coming soon/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
  expect(await screen.findByText('This order was cancelled.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
});

test('someone else\'s or a missing order: "Order not found"', async () => {
  authFetch.mockResolvedValue(ok({ message: 'Order not found.' }, 404));
  renderAt('/orders/zzz');
  expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
});
