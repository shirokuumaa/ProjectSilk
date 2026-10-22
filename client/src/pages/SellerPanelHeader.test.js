// Кабинет продавца: шапка с магазином, «View shop» и «Sign out».
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SellerPanel from './SellerPanel';
import { fetchMe, isLoggedIn, authFetch, logout } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  fetchMe: jest.fn(),
  authFetch: jest.fn(),
  logout: jest.fn(),
}));

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const renderPanel = () => render(<MemoryRouter><SellerPanel /></MemoryRouter>);

beforeEach(() => {
  authFetch.mockImplementation(async (url) => (url.includes('/api/products/mine') ? ok([]) : ok({ AI_MODE: 'off', AI_ENABLED: false })));
  logout.mockResolvedValue(undefined);
});

test('a seller sees which store they are signed in to, a way back to the shop and sign out', async () => {
  isLoggedIn.mockReturnValue(true);
  fetchMe.mockResolvedValue({ username: 'sam', role: 'seller', storeName: 'Sam Shop' });
  renderPanel();

  await waitFor(() => expect(screen.getByRole('banner')).toHaveTextContent('Signed in as sam · Store: Sam Shop'));
  expect(screen.getByRole('link', { name: 'View shop' })).toHaveAttribute('href', '/');

  const assign = jest.fn();
  delete window.location;
  window.location = { assign };
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  expect(logout).toHaveBeenCalled();
});

test('a guest gets the header with "View shop" and a seller sign-up link', async () => {
  isLoggedIn.mockReturnValue(false);
  renderPanel();
  expect(await screen.findByRole('button', { name: 'Create seller account' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View shop' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
});
