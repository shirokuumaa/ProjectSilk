// Заказы: пока грузятся, пусто, ошибка и список — у каждого состояния свой понятный текст.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersList from './OrdersList';

const renderList = () => render(<MemoryRouter><OrdersList sessionId="s1" /></MemoryRouter>);

afterEach(() => { delete global.fetch; });

test('no orders: a message and a link to the shop', async () => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ ok: true, orders: [] }) });
  renderList();
  expect(screen.getByText(/loading your orders/i)).toBeInTheDocument();
  expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /browse the shop/i })).toHaveAttribute('href', '/');
});

test('orders service down: a plain message instead of an empty page', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  renderList();
  expect(await screen.findByText(/could not load your orders/i)).toBeInTheDocument();
  expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /back to the shop/i })).toHaveAttribute('href', '/');
});

test('orders are listed with links', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ ok: true, orders: [{ order_id: 7, total_usd: 12.5, created_at: '2026-10-01' }] }),
  });
  renderList();
  expect(await screen.findByRole('link', { name: '#7' })).toHaveAttribute('href', '/orders/7');
  expect(screen.queryByText(/no orders yet/i)).not.toBeInTheDocument();
});
