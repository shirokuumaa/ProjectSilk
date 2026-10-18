// Приватность: гардероб и обмеры принадлежат аккаунту. Чужой пользователь их не видит
// и не меняет — ни через свои адреса, ни подставив чужое имя, ни поддельным токеном.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, forgeToken, PNG } from './helpers.js';

const M = { heightCm: 165, chest: 88, waist: 68, hips: 94 };

describe('приватность: гардероб и обмеры по аккаунту', () => {
  let srv, alice, bob, tee, skirt;

  const wardrobe = async (user) => (await api('GET', '/api/wardrobe', { token: user.token })).json;
  const profile = async (user) => (await api('GET', '/api/body-profile/me', { token: user.token })).json;

  before(async () => {
    srv = await startTestServer();
    const seller = await newUser('privseller', { accountType: 'seller', storeName: 'Priv Shop' });
    const add = async (title) => (await api('POST', '/api/products', {
      token: seller.token,
      files: { image: [`${title}.png`, PNG] },
      fields: { title, price: '1000', garmentType: 'top' },
    })).json;
    tee = await add('Tee');
    skirt = await add('Skirt');

    alice = await newUser('privalice');
    bob = await newUser('privbob');

    assert.equal((await api('POST', '/api/body-profile', { token: alice.token, body: M })).status, 200);
    const r = await api('POST', '/api/wardrobe', {
      token: alice.token,
      body: { productId: tee._id, name: 'Tee', image: tee.image, price: 1000 },
    });
    assert.equal(r.status, 201);
  });
  after(() => srv?.stop());

  it('после входа Алиса получает свой гардероб и свои обмеры', async () => {
    assert.deepEqual((await wardrobe(alice)).map((x) => x.productId), [tee._id]);
    assert.equal((await profile(alice)).chest, 88);
  });

  it('Боб не видит гардероб и обмеры Алисы', async () => {
    assert.deepEqual(await wardrobe(bob), []);
    assert.equal(await profile(bob), null);
    assert.equal((await api('GET', '/api/body-profile/privalice', { token: bob.token })).status, 403);
    assert.equal((await api('GET', '/api/wardrobe?user=privalice', { token: bob.token })).status, 403);
    assert.equal((await api('GET', '/api/wardrobe', { token: bob.token, headers: { 'x-user': 'privalice' } })).status, 403);
  });

  it('Боб не может изменить обмеры Алисы', async () => {
    const r = await api('POST', '/api/body-profile', { token: bob.token, body: { ...M, chest: 120, user: 'privalice' } });
    assert.equal(r.status, 403);
    assert.equal((await api('DELETE', '/api/body-profile/privalice', { token: bob.token })).status, 403);
    assert.equal((await profile(alice)).chest, 88);
  });

  it('Боб сохраняет свои обмеры — у Алисы ничего не меняется', async () => {
    const r = await api('POST', '/api/body-profile', { token: bob.token, body: { ...M, chest: 101 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.user, 'privbob');
    assert.equal((await profile(alice)).chest, 88);
    assert.equal((await profile(bob)).chest, 101);
    assert.equal((await api('DELETE', '/api/body-profile/me', { token: bob.token })).status, 200);
    assert.equal((await profile(alice)).chest, 88);
  });

  it('Боб не может удалить вещи Алисы — ни по одной, ни очисткой', async () => {
    assert.equal((await api('DELETE', `/api/wardrobe/${tee._id}`, { token: bob.token })).status, 200);
    assert.equal((await api('DELETE', '/api/wardrobe', { token: bob.token })).status, 200);
    assert.equal((await api('DELETE', `/api/wardrobe/${tee._id}?user=privalice`, { token: bob.token })).status, 403);
    assert.deepEqual((await wardrobe(alice)).map((x) => x.productId), [tee._id]);
  });

  it('одна и та же вещь у обоих — это две разные записи', async () => {
    const body = { productId: tee._id, name: 'Tee', image: tee.image };
    assert.equal((await api('POST', '/api/wardrobe', { token: bob.token, body })).status, 201);
    assert.equal((await api('DELETE', `/api/wardrobe/${tee._id}`, { token: bob.token })).status, 200);
    assert.deepEqual(await wardrobe(bob), []);
    assert.deepEqual((await wardrobe(alice)).map((x) => x.productId), [tee._id]);
  });

  it('Боб добавляет вещь — она у него, Алиса её не видит', async () => {
    const body = { productId: skirt._id, name: 'Skirt', image: skirt.image };
    assert.equal((await api('POST', '/api/wardrobe', { token: bob.token, body })).status, 201);
    assert.deepEqual((await wardrobe(bob)).map((x) => x.productId), [skirt._id]);
    assert.deepEqual((await wardrobe(alice)).map((x) => x.productId), [tee._id]);
  });

  it('поддельный токен с именем Алисы → 401', async () => {
    const fake = forgeToken({ sub: 'x', username: 'privalice', role: 'buyer' }, 'not-the-secret');
    assert.equal((await api('GET', '/api/wardrobe', { token: fake })).status, 401);
    assert.equal((await api('GET', '/api/body-profile/me', { token: fake })).status, 401);
  });

  it('без токена → 401', async () => {
    assert.equal((await api('GET', '/api/wardrobe')).status, 401);
    assert.equal((await api('POST', '/api/wardrobe', { body: { productId: tee._id, name: 'Tee' } })).status, 401);
    assert.equal((await api('GET', '/api/body-profile/me')).status, 401);
  });

  it('вещь без картинки тоже сохраняется', async () => {
    const r = await api('POST', '/api/wardrobe', { token: bob.token, body: { productId: tee._id, name: 'Tee' } });
    assert.equal(r.status, 201);
    assert.equal(r.json.image, '');
  });
});
