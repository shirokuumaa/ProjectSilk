// Плашка после входа: гостевые вещи — перенести в аккаунт или выбросить.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountSync from './AccountSync';
import { GUEST_WARDROBE_KEY, logout } from '../utils/auth';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

let serverWardrobe;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('authToken', 'token-alice');
  localStorage.setItem('loggedInUser', 'alice');
  localStorage.setItem(GUEST_WARDROBE_KEY, JSON.stringify([{ id: 'p1', name: 'Tee' }, { id: 'p2', name: 'Skirt' }]));
  serverWardrobe = [];
  global.fetch = jest.fn(async (url, o = {}) => {
    if (url.endsWith('/api/body-profile/me')) return ok(null);
    if (o.method === 'POST') {
      const { productId, name } = JSON.parse(o.body);
      serverWardrobe.push({ productId, name });
      return ok({});
    }
    return ok(serverWardrobe);
  });
});
afterEach(() => { delete global.fetch; });

test('offers to move the guest items, and "Add to my account" saves them', async () => {
  render(<AccountSync />);
  expect(await screen.findByText(/You saved 2 items on this device before signing in/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Add to my account' }));

  expect(await screen.findByText('Added 2 items to your wardrobe.')).toBeInTheDocument();
  expect(serverWardrobe.map((x) => x.productId)).toEqual(['p1', 'p2']);
  expect(localStorage.getItem(GUEST_WARDROBE_KEY)).toBeNull();
  expect(JSON.parse(localStorage.getItem('wardrobeItems')).map((x) => x.id)).toEqual(['p2', 'p1']);
});

test('"Discard" hides the offer and forgets the guest items', async () => {
  render(<AccountSync />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
  expect(screen.queryByText(/before signing in/)).not.toBeInTheDocument();
  expect(localStorage.getItem(GUEST_WARDROBE_KEY)).toBeNull();
  expect(serverWardrobe).toEqual([]);
});

test('items already in the account are not offered again', async () => {
  serverWardrobe = [{ productId: 'p1', name: 'Tee' }, { productId: 'p2', name: 'Skirt' }];
  render(<AccountSync />);
  await waitFor(() => expect(JSON.parse(localStorage.getItem('wardrobeItems') || '[]')).toHaveLength(2));
  expect(screen.queryByText(/before signing in/)).not.toBeInTheDocument();
});

test('logging out hides the offer', async () => {
  render(<AccountSync />);
  await screen.findByText(/before signing in/);
  act(() => logout());
  expect(screen.queryByText(/before signing in/)).not.toBeInTheDocument();
});
