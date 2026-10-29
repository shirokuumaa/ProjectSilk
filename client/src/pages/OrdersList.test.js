// «My orders»: гость, загрузка, пусто, ошибка и список — у каждого состояния свой понятный текст.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersList from './OrdersList';
import { isLoggedIn, authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  authFetch: jest.fn(),
}));

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const renderList = (path = '/orders') => render(<MemoryRouter initialEntries={[path]}><OrdersList /></MemoryRouter>);

beforeEach(() => { jest.clearAllMocks(); isLoggedIn.mockReturnValue(true); });

test('a guest is asked to sign in, and nothing is requested', () => {
  isLoggedIn.mockReturnValue(false);
  renderList();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=/orders');
  expect(authFetch).not.toHaveBeenCalled();
});

test('no orders: a message and a link to the shop', async () => {
  authFetch.mockResolvedValue(ok([]));
  renderList();
  expect(screen.getByText(/loading your orders/i)).toBeInTheDocument();
  expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /browse the shop/i })).toHaveAttribute('href', '/');
  expect(authFetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/orders\/mine$/), expect.anything());
});

test('orders service down: a plain message instead of an empty page', async () => {
  authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
  renderList();
  expect(await screen.findByText(/could not load your orders/i)).toBeInTheDocument();
  expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
});

test('orders are listed with number, store, status, total and a link', async () => {
  authFetch.mockResolvedValue(ok([{
    _id: 'o1', number: 'PS-261029-ABC123', storeName: 'Store A', status: 'confirmed', total: 27800, currency: 'KZT',
    createdAt: '2026-10-29T10:00:00Z', items: [{ product: 'p1', title: 'Dress', size: 'S', image: '/x.jpg', quantity: 1, price: 27800 }],
  }]));
  renderList('/orders?placed=1');
  expect(await screen.findByText('PS-261029-ABC123')).toBeInTheDocument();
  expect(screen.getByText('Confirmed')).toBeInTheDocument();
  expect(screen.getByText('27,800 ₸')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/your orders are placed/);
  expect(screen.getByRole('link', { name: /PS-261029-ABC123/ })).toHaveAttribute('href', '/orders/o1');
});
