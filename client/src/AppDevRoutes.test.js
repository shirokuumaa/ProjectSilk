// Маршруты служебных страниц в App обёрнуты в DevOnly: вне режима разработки их нет.
import { render, screen } from '@testing-library/react';
import App from './App';

// обычные страницы здесь не нужны (и тянут three.js) — заглушки
jest.mock('./pages/HomePage', () => () => null);
jest.mock('./pages/CartPage', () => () => null);
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
jest.mock('./components/AssistantLayer', () => () => <p>assistant layer</p>);

const ENV = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = ENV; });

for (const path of ['/metrics', '/triposr-debug', '/avatar/mode1-test']) {
  test(`${path} is "Page not found" outside development`, async () => {
    process.env.NODE_ENV = 'production';
    window.history.pushState({}, '', path);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    delete global.fetch;
  });
}

test('an unknown address shows "Page not found" with a link to the home page', async () => {
  window.history.pushState({}, '', '/no-such-page');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /back to the shop/i })).toHaveAttribute('href', '/');
  delete global.fetch;
});

test('the assistant layer is hidden unless REACT_APP_ASSISTANT=on', () => {
  window.history.pushState({}, '', '/no-such-page');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  const { unmount } = render(<App />);
  expect(screen.queryByText('assistant layer')).not.toBeInTheDocument();
  unmount();
  process.env.REACT_APP_ASSISTANT = 'on';
  render(<App />);
  expect(screen.getByText('assistant layer')).toBeInTheDocument();
  delete process.env.REACT_APP_ASSISTANT;
  delete global.fetch;
});
