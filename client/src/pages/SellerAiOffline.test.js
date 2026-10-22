// ИИ офлайн: одно понятное сообщение на странице, без запроса /features (и без 503 в консоли).
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SellerPanel from './SellerPanel';
import { fetchMe, isLoggedIn, authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  fetchMe: jest.fn(),
  authFetch: jest.fn(),
}));

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  isLoggedIn.mockReturnValue(true);
  fetchMe.mockResolvedValue({ username: 'sam', role: 'seller', storeName: 'Sam Shop' });
  global.URL.createObjectURL = jest.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = jest.fn();
});

test('AI off: one plain-English message, /features is never requested', async () => {
  authFetch.mockImplementation(async (url) => (url.includes('/api/products/mine') ? ok([]) : ok({ AI_MODE: 'off', AI_ENABLED: false })));
  render(<MemoryRouter><SellerPanel /></MemoryRouter>);

  expect(await screen.findByText(/Photo tools are offline right now/)).toBeInTheDocument();
  expect(authFetch.mock.calls.some(([url]) => url.includes('/api/ai/features'))).toBe(false);

  // после загрузки фото сообщение не повторяется
  fireEvent.change(screen.getByLabelText(/Product image/), { target: { files: [new File(['x'], 'tee.png', { type: 'image/png' })] } });
  await screen.findByLabelText('Title');
  expect(screen.getAllByText(/offline/i)).toHaveLength(2); // строка статуса и подпись кнопки 3D
  expect(screen.getAllByText(/Photo tools are offline right now/)).toHaveLength(1);
  expect(screen.queryByText(/AI is off/)).not.toBeInTheDocument();
});

test('AI on: features are checked and no offline message is shown', async () => {
  authFetch.mockImplementation(async (url) => {
    if (url.includes('/api/products/mine')) return ok([]);
    if (url.includes('/__target')) return ok({ AI_MODE: 'proxy', AI_ENABLED: true });
    return ok({ rembg: true, triposr: true });
  });
  render(<MemoryRouter><SellerPanel /></MemoryRouter>);
  expect(await screen.findByText(/AI online/)).toBeInTheDocument();
  expect(screen.queryByText(/Photo tools are offline/)).not.toBeInTheDocument();
});
