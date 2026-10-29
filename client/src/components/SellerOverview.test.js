// Сводка кабинета продавца: товары, заказы и возвраты к обработке, распроданные размеры, продажи.
import { render, screen } from '@testing-library/react';
import SellerOverview from './SellerOverview';
import { authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({ ...jest.requireActual('../utils/auth'), authFetch: jest.fn() }));
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('counts come from my products and my orders', async () => {
  const products = [{ sizeChart: [{ size: 'S', stock: 0 }, { size: 'M', stock: 2 }] }, { sizeChart: [{ size: 'L', stock: 0 }] }];
  authFetch.mockImplementation(async () => (ok([
      { status: 'placed', total: 100, currency: 'KZT' },
      { status: 'delivered', total: 19900, currency: 'KZT' },
      { status: 'delivered', total: 5000, currency: 'KZT', return: { status: 'requested' } },
      { status: 'cancelled', total: 7000, currency: 'KZT' },
    ])));
  render(<SellerOverview products={products} />);
  expect(await screen.findByText('Orders to handle')).toBeInTheDocument();
  const value = (label) => screen.getByRole('group', { name: label }).textContent.replace(label, '');
  expect(value('Products')).toBe('2');
  expect(value('Orders to handle')).toBe('1');
  expect(value('Returns to handle')).toBe('1');
  expect(value('Sold-out sizes')).toBe('2');
  expect(value('Delivered sales')).toBe('24,900 ₸');
});
