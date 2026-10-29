// Профиль тела: тон кожи хранится ключом skin-1 … skin-10 и переживает перезагрузку.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, withTestDb } from './helpers.js';

const m = { heightCm: 166, chest: 92, waist: 74, hips: 99, armLength: 58, footLength: 24.5 };

describe('body profile', () => {
  let srv, carol, dave;

  before(async () => {
    srv = await startTestServer();
    carol = await newUser('carol');
    dave = await newUser('dave');
  });
  after(() => srv?.stop());

  it('тон кожи по умолчанию — skin-5', async () => {
    const r = await api('POST', '/api/body-profile', { token: dave.token, body: m });
    assert.equal(r.status, 200);
    assert.equal(r.json.skinTone, 'skin-5');
  });

  it('выбранный тон сохраняется и читается снова', async () => {
    const saved = await api('POST', '/api/body-profile', { token: carol.token, body: { ...m, skinTone: 'skin-7' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.skinTone, 'skin-7');

    const me = await api('GET', '/api/body-profile/me', { token: carol.token });
    assert.equal(me.json.skinTone, 'skin-7');
    assert.equal(me.json.armLength, 58);
    assert.equal(me.json.footLength, 24.5);
  });

  it('тон вне шкалы → 400, старое значение не тронуто', async () => {
    for (const bad of ['#ffffff', 'skin-11', 'neutral']) {
      const r = await api('POST', '/api/body-profile', { token: carol.token, body: { ...m, skinTone: bad } });
      assert.equal(r.status, 400, bad);
    }
    const me = await api('GET', '/api/body-profile/me', { token: carol.token });
    assert.equal(me.json.skinTone, 'skin-7');
  });

  it('старый профиль с цветом вместо ключа читается и пересохраняется ключом', async () => {
    await withTestDb((db) => db.collection('bodyprofiles').updateOne(
      { user: 'dave' }, { $set: { skinTone: '#f1c27d' } },
    ));
    const old = await api('GET', '/api/body-profile/me', { token: dave.token });
    assert.equal(old.status, 200);
    assert.equal(old.json.skinTone, '#f1c27d');

    const r = await api('POST', '/api/body-profile', { token: dave.token, body: { ...m, skinTone: 'skin-4' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.skinTone, 'skin-4');
  });
});
