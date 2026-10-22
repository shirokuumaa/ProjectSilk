// Вход и регистрация: продавец по ссылке «Create seller account» сразу регистрируется
// как продавец; после входа продавец попадает в панель, покупатель — в магазин.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); global.fetch = jest.fn(); });
afterEach(() => { delete global.fetch; });

test('"Create seller account" (?as=seller) opens registration with the seller role and the store name field', () => {
  renderAt('/register?as=seller');
  expect(screen.getByLabelText('I want to sell')).toBeChecked();
  expect(screen.getByPlaceholderText('Store name')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create seller account' })).toBeInTheDocument();
});

test('plain /register still starts as a buyer', () => {
  renderAt('/register');
  expect(screen.getByLabelText('I want to shop')).toBeChecked();
  expect(screen.queryByPlaceholderText('Store name')).not.toBeInTheDocument();
});

async function signInAs(role) {
  global.fetch.mockResolvedValue(ok({ token: 't', user: { username: 'sam', role, storeName: role === 'seller' ? 'Sam Shop' : null } }));
  renderAt('/login');
  fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'sam' } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
  return screen.getByTestId('where').textContent;
}

test('a seller lands on the seller dashboard after signing in', async () => {
  expect(await signInAs('seller')).toBe('/seller');
});

test('a buyer lands on the shop after signing in', async () => {
  expect(await signInAs('buyer')).toBe('/');
});
