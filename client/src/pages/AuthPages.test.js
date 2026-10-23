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
  expect(screen.getByLabelText('Store name')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create seller account' })).toBeInTheDocument();
});

test('plain /register still starts as a buyer', () => {
  renderAt('/register');
  expect(screen.getByLabelText('I want to shop')).toBeChecked();
  expect(screen.queryByLabelText('Store name')).not.toBeInTheDocument();
});

async function signInAs(role) {
  global.fetch.mockResolvedValue(ok({ token: 't', user: { username: 'sam', role, storeName: role === 'seller' ? 'Sam Shop' : null } }));
  renderAt('/login');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sam' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
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

test('fields have visible labels and the submit control is a real button', () => {
  renderAt('/login');
  expect(screen.getByLabelText('Username')).toHaveClass('input');
  expect(screen.getByLabelText('Password')).toHaveClass('input');
  expect(screen.getByRole('button', { name: 'Sign in' })).toHaveClass('primary');
});

// ── все ошибки формы сразу ──

test('registration shows every problem at once, not only the first', async () => {
  renderAt('/register?as=seller');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ab' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create seller account' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Please enter your store name');
  expect(alert).toHaveTextContent('Username must be 3–32 characters');
  expect(alert).toHaveTextContent('Password must be at least 8 characters');
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a valid form clears old errors; the server\'s list of errors is shown in full', async () => {
  global.fetch.mockResolvedValue({
    ok: false, status: 400,
    json: async () => ({ message: 'A. B.', errors: ['Username is taken somewhere.', 'Another server rule.'] }),
  });
  renderAt('/register');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sam' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  const items = await screen.findAllByRole('listitem');
  expect(items.map((li) => li.textContent)).toEqual(['Username is taken somewhere.', 'Another server rule.']);
});

test('sign-in with both fields empty names both', () => {
  renderAt('/login');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Please enter your username.');
  expect(alert).toHaveTextContent('Please enter your password.');
});
