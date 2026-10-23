// Регистрация, вход, токены; профиль тела и гардероб — только свои.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, api, register, newUser, forgeToken, withTestDb, PNG, tokenFromCookie,
} from './helpers.js';

describe('auth', () => {
  let srv, alice, bob;

  before(async () => {
    srv = await startTestServer();
    alice = await newUser('alice');
    bob = await newUser('bob');
  });
  after(() => srv?.stop());

  describe('регистрация', () => {
    it('новый пользователь — покупатель, ответ с токеном', () => {
      assert.equal(alice.user.username, 'alice');
      assert.equal(alice.user.role, 'buyer');
      assert.ok(alice.token);
    });

    it('пароль короче 8 символов → 400', async () => {
      const r = await register('shorty', { password: '1234567' });
      assert.equal(r.status, 400);
    });

    it('занятое имя → 409', async () => {
      assert.equal((await register('alice')).status, 409);
    });

    it('недопустимое имя → 400', async () => {
      assert.equal((await register('Bad Name!')).status, 400);
    });

    it('имя хранится в нижнем регистре', async () => {
      const carol = await newUser('Carol_X');
      assert.equal(carol.user.username, 'carol_x');
    });

    it('в базе только bcrypt-хеши, открытого пароля нет', async () => {
      await withTestDb(async (db) => {
        const users = await db.collection('users').find().toArray();
        assert.ok(users.length >= 3);
        for (const u of users) {
          assert.match(u.passwordHash, /^\$2[ab]\$12\$/);
          assert.equal('password' in u, false);
        }
        assert.equal(JSON.stringify(users).includes('test-pass-123'), false);
      });
    });
  });

  describe('вход', () => {
    it('неверный пароль → 401', async () => {
      const r = await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'wrong-password' } });
      assert.equal(r.status, 401);
    });

    it('несуществующее имя → тот же ответ, что и неверный пароль', async () => {
      const r = await api('POST', '/api/auth/login', { body: { username: 'nobody-here', password: 'test-pass-123' } });
      assert.equal(r.status, 401);
      assert.equal(r.json.message, 'Invalid username or password');
    });

    it('верный пароль → 200 и вход в cookie; регистр имени не важен', async () => {
      const r = await api('POST', '/api/auth/login', { body: { username: 'ALICE', password: 'test-pass-123' } });
      assert.equal(r.status, 200);
      assert.equal(r.json.user.username, 'alice');
      assert.ok(tokenFromCookie(r));
    });

    it('токена нет в теле ответа на вход и регистрацию — только в httpOnly-cookie', async () => {
      const login = await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'test-pass-123' } });
      const reg = await api('POST', '/api/auth/register', { body: { username: 'notoken', password: 'test-pass-123' } });
      for (const r of [login, reg]) {
        assert.equal(r.json.token, undefined);
        assert.deepEqual(Object.keys(r.json), ['user']);
        const token = tokenFromCookie(r);
        assert.match(token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
        assert.ok(!r.text.includes(token), 'токен не должен попадать в тело');
        assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
      }
      // токен из cookie работает
      const me = await api('GET', '/api/auth/me', { token: tokenFromCookie(login) });
      assert.equal(me.json.username, 'alice');
    });
  });

  describe('/api/auth/me и токены', () => {
    it('без токена → 401', async () => {
      assert.equal((await api('GET', '/api/auth/me')).status, 401);
    });

    it('мусорный токен → 401', async () => {
      assert.equal((await api('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
    });

    it('истёкший токен → 401', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = forgeToken({ sub: alice.user.id, iat: now - 900000, exp: now - 60 });
      assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
    });

    it('токен с чужой подписью → 401', async () => {
      const token = forgeToken({ sub: alice.user.id, exp: Math.floor(Date.now() / 1000) + 600 }, 'not-the-secret-'.repeat(4));
      assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
    });

    it('не Bearer-схема → 401', async () => {
      const r = await api('GET', '/api/auth/me', { headers: { Authorization: `Basic ${alice.token}` } });
      assert.equal(r.status, 401);
    });

    it('свой токен → 200', async () => {
      const r = await api('GET', '/api/auth/me', { token: alice.token });
      assert.equal(r.status, 200);
      assert.equal(r.json.username, 'alice');
    });
  });

  describe('профиль тела', () => {
    const m = { heightCm: 165, chest: 88, waist: 68, hips: 94 };

    it('без токена → 401', async () => {
      assert.equal((await api('GET', '/api/body-profile/alice')).status, 401);
      assert.equal((await api('DELETE', '/api/body-profile/me')).status, 401);
    });

    it('чужой профиль → 403', async () => {
      assert.equal((await api('GET', '/api/body-profile/alice', { token: bob.token })).status, 403);
    });

    it('POST с чужим user в теле → 403', async () => {
      const r = await api('POST', '/api/body-profile', { token: alice.token, body: { ...m, user: 'bob' } });
      assert.equal(r.status, 403);
    });

    it('свой профиль: сохранить и прочитать', async () => {
      const saved = await api('POST', '/api/body-profile', { token: alice.token, body: m });
      assert.equal(saved.status, 200);
      assert.equal(saved.json.user, 'alice');

      const me = await api('GET', '/api/body-profile/me', { token: alice.token });
      assert.equal(me.json.chest, 88);
      assert.equal((await api('GET', '/api/body-profile/ALICE', { token: alice.token })).status, 200);
    });

    it('у другого пользователя профиля нет', async () => {
      const r = await api('GET', '/api/body-profile/me', { token: bob.token });
      assert.equal(r.status, 200);
      assert.equal(r.json, null);
    });

    it('чужой не может удалить профиль', async () => {
      assert.equal((await api('DELETE', '/api/body-profile/alice', { token: bob.token })).status, 403);
      const me = await api('GET', '/api/body-profile/me', { token: alice.token });
      assert.equal(me.json.chest, 88);
    });

    it('старый профиль находится после регистрации под тем же именем', async () => {
      await withTestDb((db) => db.collection('bodyprofiles').insertOne({
        user: 'legacyuser', heightCm: 168, chest: 90, waist: 70, hips: 96,
      }));
      const legacy = await newUser('legacyuser');
      const r = await api('GET', '/api/body-profile/me', { token: legacy.token });
      assert.equal(r.json.chest, 90);
      assert.equal(r.json.hips, 96);
    });
  });

  describe('гардероб', () => {
    let item;
    before(async () => {
      const seller = await newUser('wardrobeseller', { accountType: 'seller', storeName: 'Dress Shop' });
      const product = (await api('POST', '/api/products', {
        token: seller.token,
        files: { image: ['dress.png', PNG] },
        fields: { title: 'Dress', price: '10', garmentType: 'dress' },
      })).json;
      item = { productId: product._id, name: 'Dress', image: product.image, price: 10 };
    });

    it('без токена → 401', async () => {
      assert.equal((await api('GET', '/api/wardrobe')).status, 401);
    });

    it('чужое имя в ?user= или x-user → 403', async () => {
      assert.equal((await api('GET', '/api/wardrobe?user=alice', { token: bob.token })).status, 403);
      assert.equal((await api('GET', '/api/wardrobe', { token: bob.token, headers: { 'x-user': 'alice' } })).status, 403);
    });

    it('гардеробы не смешиваются', async () => {
      assert.equal((await api('POST', '/api/wardrobe', { token: alice.token, body: item })).status, 201);
      assert.equal((await api('DELETE', `/api/wardrobe/${item.productId}?user=alice`, { token: bob.token })).status, 403);
      assert.equal((await api('GET', '/api/wardrobe', { token: alice.token })).json.length, 1);
      assert.equal((await api('GET', '/api/wardrobe', { token: bob.token })).json.length, 0);
    });
  });

  describe('прочее', () => {
    it('/api/avatar/persist без токена → 401', async () => {
      const r = await api('POST', '/api/avatar/persist', { body: { url: '/static/x.obj' } });
      assert.equal(r.status, 401);
    });

    it('/_debug/mongo удалён', async () => {
      assert.equal((await api('GET', '/_debug/mongo')).status, 404);
    });
  });
});
