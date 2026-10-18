// Корзина в App: после выхода корзина прошлого покупателя не возвращается из памяти страницы.
import { act, render, screen } from '@testing-library/react';
import App from './App';
import { logout } from './utils/auth';

// обычные страницы здесь не нужны (и тянут three.js) — заглушки; корзина показывает число вещей
jest.mock('./pages/HomePage', () => () => null);
jest.mock('./pages/LoginPage', () => () => null);
jest.mock('./pages/RegisterPage', () => () => null);
jest.mock('./pages/FavoritesPage', () => () => null);
jest.mock('./pages/WardrobePage', () => () => null);
jest.mock('./pages/tryon/TryOnPhoto', () => () => null);
jest.mock('./pages/tryon/TryOnAR', () => () => null);
jest.mock('./pages/tryon/TryOnAvatar', () => () => null);
jest.mock('./pages/AllProductsPage', () => () => null);
jest.mock('./pages/ProductPage', () => () => null);
jest.mock('./pages/SellerPanel', () => () => null);
jest.mock('./pages/Product3DViewer', () => () => null);
jest.mock('./pages/AvatarCreate', () => () => null);
jest.mock('./pages/OrderPage', () => () => null);
jest.mock('./pages/OrdersList', () => () => null);
jest.mock('./pages/CartPage', () => ({ cartItems }) => <p>Cart: {cartItems.length}</p>);
jest.mock('./components/AssistantLayer', () => () => null);

test('after logout the cart is empty in the page and in the browser', async () => {
  localStorage.clear();
  localStorage.setItem('loggedInUser', 'alice');
  localStorage.setItem('cartItems', JSON.stringify([{ id: 'p1', quantity: 1 }, { id: 'p2', quantity: 3 }]));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  window.history.pushState({}, '', '/cart');

  render(<App />);
  expect(screen.getByText('Cart: 2')).toBeInTheDocument();

  await act(async () => { await logout(); });

  expect(screen.getByText('Cart: 0')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('cartItems'))).toEqual([]);
  delete global.fetch;
});
