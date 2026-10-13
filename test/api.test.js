const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp, toFtsQuery } = require('../server/app');

let server;
let base;

before(async () => {
  const app = createApp({
    db: openDb(':memory:'),
    adminEmails: ['admin@lansforsakringar.se'],
    allowedDomains: ['lansforsakringar.se'],
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, csrf = true } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-Requested-With'] = 'kunskapsdelning';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const login = (c, name, email, companyId) => c('/login', { method: 'POST', body: { name, email, companyId } });

const samplePost = {
  title: 'Videobesiktning av vattenskador',
  summary: 'Kunden visar skadan via video vilket halverar ledtiden.',
  categoryId: 'skada',
  solution: 'Vi bokar ett videosamtal inom 24 timmar och fattar beslut direkt.',
  tags: 'video, Besiktning, video',
};

test('meta innehåller 23 lokala bolag plus Länsförsäkringar AB', async () => {
  const { body } = await client()('/meta');
  assert.equal(body.companies.length, 24);
  assert.ok(body.categories.length > 5);
});

test('inloggning kräver jobbmejl och giltigt bolag', async () => {
  const c = client();
  assert.equal((await login(c, 'Test', 'test@gmail.com', 'skane')).status, 403);
  assert.equal((await login(c, 'Test', 'test@lansforsakringar.se', 'finns-inte')).status, 400);
  const ok = await login(c, 'Test Testsson', 'Test@Lansforsakringar.se', 'skane');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'test@lansforsakringar.se');
  assert.equal((await c('/me')).body.user.name, 'Test Testsson');
});

test('ändrande anrop utan CSRF-header nekas', async () => {
  const c = client();
  await login(c, 'Csrf Test', 'csrf@lansforsakringar.se', 'skane');
  const r = await c('/posts', { method: 'POST', body: samplePost, csrf: false });
  assert.equal(r.status, 403);
});

test('dela, söka, gilla, använda, kommentera och topplista', async () => {
  const anna = client();
  const erik = client();
  await login(anna, 'Anna', 'anna@lansforsakringar.se', 'skane');
  await login(erik, 'Erik', 'erik@lansforsakringar.se', 'norrbotten');

  assert.equal((await client()('/posts', { method: 'POST', body: samplePost })).status, 401);
  assert.equal((await anna('/posts', { method: 'POST', body: { ...samplePost, title: '' } })).status, 400);

  const created = await anna('/posts', { method: 'POST', body: samplePost });
  assert.equal(created.status, 201);
  const id = created.body.id;
  await anna('/posts', { method: 'POST', body: { ...samplePost, title: 'Bolånemöte med checklista', categoryId: 'bank', tags: 'bolån' } });

  // Sök – prefix och utan prickar ska hitta "vattenskador" / "bolån".
  let r = await erik('/posts?q=vattensk');
  assert.equal(r.body.total, 1);
  assert.equal(r.body.posts[0].id, id);
  assert.deepEqual(r.body.posts[0].tags, ['video', 'besiktning']);
  r = await erik('/posts?q=bolan');
  assert.equal(r.body.total, 1);
  r = await erik('/posts?q="); DROP TABLE posts; --');
  assert.equal(r.status, 200);
  assert.equal((await erik('/posts?category=bank')).body.total, 1);
  assert.equal((await erik('/posts?company=skane')).body.total, 2);
  assert.equal((await erik('/posts?tag=video')).body.total, 1);

  // Gilla är idempotent.
  await erik(`/posts/${id}/like`, { method: 'POST' });
  r = await erik(`/posts/${id}/like`, { method: 'POST' });
  assert.equal(r.body.count, 1);
  await anna(`/posts/${id}/like`, { method: 'POST' });
  await erik(`/posts/${id}/use`, { method: 'POST' });

  r = await erik(`/posts/${id}`);
  assert.equal(r.body.post.likeCount, 2);
  assert.equal(r.body.post.liked, true);
  assert.deepEqual(r.body.post.usedByCompanies, ['norrbotten']);
  assert.equal(r.body.post.canEdit, false);

  await erik(`/posts/${id}/comments`, { method: 'POST', body: { body: 'Hur bokar ni samtalen?' } });
  r = await anna(`/posts/${id}`);
  assert.equal(r.body.comments.length, 1);
  assert.equal(r.body.post.canEdit, true);

  r = await erik('/posts?sort=likes');
  assert.equal(r.body.posts[0].id, id);

  r = await erik('/leaderboard');
  assert.equal(r.body.topPosts[0].id, id);
  assert.equal(r.body.topPosts[0].score, 2);
  assert.equal(r.body.topSharers[0].name, 'Anna');
  assert.equal(r.body.topSharers[0].score, 2);
  assert.equal(r.body.topUsed[0].id, id);
  assert.equal(r.body.topCompanies[0].companyId, 'skane');

  r = await erik(`/posts/${id}/like`, { method: 'DELETE' });
  assert.equal(r.body.count, 1);
});

test('bara författare eller admin kan ändra och ta bort', async () => {
  const owner = client();
  const other = client();
  const admin = client();
  await login(owner, 'Ägare', 'owner@lansforsakringar.se', 'halland');
  await login(other, 'Annan', 'other@lansforsakringar.se', 'gotland');
  await login(admin, 'Admin', 'admin@lansforsakringar.se', 'lf-ab');

  const { body } = await owner('/posts', { method: 'POST', body: samplePost });
  assert.equal((await other(`/posts/${body.id}`, { method: 'PUT', body: samplePost })).status, 403);
  assert.equal((await other(`/posts/${body.id}`, { method: 'DELETE' })).status, 403);

  const upd = await owner(`/posts/${body.id}`, { method: 'PUT', body: { ...samplePost, title: 'Uppdaterad rubrik om drönare' } });
  assert.equal(upd.status, 200);
  assert.equal((await owner('/posts?q=drönare')).body.total, 1);

  assert.equal((await admin(`/posts/${body.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await owner(`/posts/${body.id}`)).status, 404);
  assert.equal((await owner('/posts?q=drönare')).body.total, 0);
});

test('fritextfrågan saneras', () => {
  assert.equal(toFtsQuery('Skade-anmälan  "OR" *'), '"skade"* "anmälan"* "or"*');
  assert.equal(toFtsQuery(''), '');
});

test('easyauth-läge läser identiteten från inloggningstjänstens header', async () => {
  const app = createApp({ db: openDb(':memory:'), authMode: 'easyauth', allowedDomains: ['lansforsakringar.se'] });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api`;
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'kunskapsdelning', 'X-MS-CLIENT-PRINCIPAL-NAME': 'Sso.User@lansforsakringar.se' };
  try {
    let r = await (await fetch(`${url}/me`, { headers })).json();
    assert.equal(r.user, null);
    assert.equal(r.ssoEmail, 'sso.user@lansforsakringar.se');
    await fetch(`${url}/login`, { method: 'POST', headers, body: JSON.stringify({ name: 'Sso User', companyId: 'uppsala', email: 'fusk@lansforsakringar.se' }) });
    r = await (await fetch(`${url}/me`, { headers })).json();
    assert.equal(r.user.email, 'sso.user@lansforsakringar.se');
    assert.equal(r.user.companyId, 'uppsala');
  } finally {
    srv.close();
  }
});
