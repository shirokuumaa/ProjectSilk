// Данные покупателя в браузере: выход стирает гардероб, обмеры и черновики,
// вход откладывает гостевой гардероб, кэш заполняется с сервера и правки уходят на сервер.
import { login, logout, ACCOUNT_KEYS, GUEST_WARDROBE_KEY, LOGIN_EVENT } from './auth';
import {
  addToWardrobe, removeFromWardrobe, clearWardrobe, getWardrobe,
  pullWardrobe, getGuestWardrobe, moveGuestWardrobeToAccount, discardGuestWardrobe,
} from './wardrobeStorage';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const get = (k) => JSON.parse(localStorage.getItem(k) || 'null');

function signIn(username = 'alice') {
  localStorage.setItem('loggedInUser', username); // сам вход — в httpOnly-cookie, её JS не видит
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });

describe('logout', () => {
  test('removes the wardrobe, measurements and drafts of the user who left', () => {
    signIn('alice');
    ACCOUNT_KEYS.forEach((k) => set(k, { owner: 'alice' }));
    set(GUEST_WARDROBE_KEY, [{ id: 'g1' }]);
    logout();
    ACCOUNT_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBeNull());
    expect(localStorage.getItem(GUEST_WARDROBE_KEY)).toBeNull();
    expect(localStorage.getItem('loggedInUser')).toBeNull();
  });

  test('covers every key with personal data', () => {
    expect(ACCOUNT_KEYS).toEqual(expect.arrayContaining([
      'bodyProfile', 'wardrobeItems', 'wardrobeOutfits',
      'avatarDraft', 'avatarOutfitDraft', 'avatarChosenSizes',
    ]));
  });
});

describe('login', () => {
  const loginResponse = (username) => ok({ token: `token-${username}`, user: { username, role: 'buyer' } });

  test('a guest wardrobe is set aside for the transfer offer; the measurements draft stays', async () => {
    set('wardrobeItems', [{ id: 'p1', name: 'Tee' }, { id: 'p2', name: 'Skirt' }]);
    set('avatarDraft', { m: { heightCm: 170 } });
    set('avatarChosenSizes', { p1: 'M' });
    global.fetch.mockResolvedValue(loginResponse('bob'));
    const onLogin = jest.fn();
    window.addEventListener(LOGIN_EVENT, onLogin);

    await login('bob', 'secret-password');

    window.removeEventListener(LOGIN_EVENT, onLogin);
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('wardrobeItems')).toBeNull();
    expect(localStorage.getItem('avatarChosenSizes')).toBeNull();
    expect(get(GUEST_WARDROBE_KEY).map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(get('avatarDraft')).toEqual({ m: { heightCm: 170 } });
  });

  test('switching accounts without logging out leaves nothing from the previous user', async () => {
    signIn('alice');
    ACCOUNT_KEYS.forEach((k) => set(k, { owner: 'alice' }));
    global.fetch.mockResolvedValue(loginResponse('bob'));

    await login('bob', 'secret-password');

    ACCOUNT_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBeNull());
    expect(localStorage.getItem(GUEST_WARDROBE_KEY)).toBeNull(); // вещи Алисы — не «гостевые»
    expect(localStorage.getItem('loggedInUser')).toBe('bob');
  });

  test('a failed login does not touch the guest wardrobe', async () => {
    set('wardrobeItems', [{ id: 'p1', name: 'Tee' }]);
    global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Wrong username or password' }) });
    await expect(login('bob', 'wrong-password')).rejects.toThrow('Wrong username or password');
    expect(get('wardrobeItems')).toHaveLength(1);
    expect(localStorage.getItem(GUEST_WARDROBE_KEY)).toBeNull();
  });
});

describe('wardrobe and the server', () => {
  test('a guest wardrobe stays in the browser only', () => {
    addToWardrobe({ _id: 'p1', title: 'Tee', image: '/uploads/t.jpg', price: 10 });
    removeFromWardrobe('p1');
    clearWardrobe();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a signed-in buyer: add, remove and clear go to /api/wardrobe with the login cookie', async () => {
    signIn('alice');
    global.fetch.mockResolvedValue(ok({}));

    addToWardrobe({ _id: 'p1', title: 'Tee', image: '/uploads/t.jpg', price: 10, category: 'Tops' });
    addToWardrobe({ _id: 'p1', title: 'Tee' }); // уже есть — второй раз не отправляем
    removeFromWardrobe('p1');
    clearWardrobe();
    await Promise.resolve();

    const calls = global.fetch.mock.calls.map(([url, o]) => [o?.method || 'GET', url.replace(/^.*\/api/, '/api')]);
    expect(calls).toEqual([
      ['POST', '/api/wardrobe'],
      ['DELETE', '/api/wardrobe/p1'],
      ['DELETE', '/api/wardrobe'],
    ]);
    const [, post] = global.fetch.mock.calls[0];
    expect(JSON.parse(post.body)).toEqual({ productId: 'p1', name: 'Tee', price: 10, image: '/uploads/t.jpg', category: 'Tops' });
    expect(post.credentials).toBe('include');
  });

  test('pullWardrobe replaces the cache with the account wardrobe', async () => {
    signIn('alice');
    set('wardrobeItems', [{ id: 'stale' }]);
    global.fetch.mockResolvedValue(ok([
      { productId: 'p2', name: 'Skirt', image: '/s.jpg', price: 20, createdAt: '2026-10-02T00:00:00Z' },
      { productId: 'p1', name: 'Tee', image: '/t.jpg', price: 10, createdAt: '2026-10-01T00:00:00Z' },
    ]));
    expect(await pullWardrobe()).toBe(true);
    expect(getWardrobe().map((x) => x.id)).toEqual(['p1', 'p2']);
  });

  test('if the server does not answer, the cache is kept', async () => {
    signIn('alice');
    set('wardrobeItems', [{ id: 'p1' }]);
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await pullWardrobe()).toBe(false);
    expect(getWardrobe()).toEqual([{ id: 'p1' }]);
  });
});

describe('moving a guest wardrobe into the account', () => {
  test('only items the account does not have yet are offered', () => {
    signIn('alice');
    set('wardrobeItems', [{ id: 'p1' }]);
    set(GUEST_WARDROBE_KEY, [{ id: 'p1' }, { id: 'p2' }]);
    expect(getGuestWardrobe().map((x) => x.id)).toEqual(['p2']);
  });

  test('"Add to my account" saves each item on the server and reloads the wardrobe', async () => {
    signIn('alice');
    set(GUEST_WARDROBE_KEY, [{ id: 'p1', name: 'Tee' }, { id: 'p2', name: 'Skirt' }]);
    global.fetch.mockImplementation(async (url, o) => (o?.method === 'POST'
      ? ok({})
      : ok([{ productId: 'p1', name: 'Tee' }, { productId: 'p2', name: 'Skirt' }])));

    expect(await moveGuestWardrobeToAccount()).toBe(2);

    const posted = global.fetch.mock.calls.filter(([, o]) => o?.method === 'POST').map(([, o]) => JSON.parse(o.body).productId);
    expect(posted).toEqual(['p1', 'p2']);
    expect(localStorage.getItem(GUEST_WARDROBE_KEY)).toBeNull();
    expect(getWardrobe().map((x) => x.id).sort()).toEqual(['p1', 'p2']);
  });

  test('"Discard" forgets the guest items', () => {
    set(GUEST_WARDROBE_KEY, [{ id: 'p1' }]);
    discardGuestWardrobe();
    expect(getGuestWardrobe()).toEqual([]);
  });
});
