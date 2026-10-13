const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp, toFtsQuery } = require('../server/app');
const { seedExamples } = require('../server/seed');
const { POSTS, AUTHORS } = require('../server/seed-data');

let server;
let base;

async function start(options) {
  const app = createApp({ db: openDb(':memory:'), ...options });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { srv, url: `http://127.0.0.1:${srv.address().port}/api` };
}

before(async () => {
  ({ srv: server, url: base } = await start({ adminKey: 'hemlig-nyckel-123' }));
});

after(() => server.close());

// En "webbläsare": håller sin egen besökscookie.
function browser(url = () => base, extraHeaders = {}) {
  let cookie = '';
  return async (path, { method = 'GET', body, csrf = true } = {}) => {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (csrf) headers['X-Requested-With'] = 'kunskapsdelning';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(url() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const card = (overrides = {}) => ({
  name: 'Anna Andersson',
  companyId: 'skane',
  authorTitle: 'Skadereglerare',
  title: 'Videobesiktning av vattenskador',
  summary: 'Kunden visar skadan via video vilket halverar ledtiden.',
  categoryId: 'skada',
  solution: 'Vi bokar ett videosamtal inom 24 timmar och fattar beslut direkt.',
  tags: 'video, Besiktning, video',
  ...overrides,
});

test('meta innehåller 23 lokala bolag plus Länsförsäkringar AB', async () => {
  const { body } = await browser()('/meta');
  assert.equal(body.companies.length, 24);
  assert.ok(body.categories.some((c) => c.id === 'marknad'));
});

test('kort kräver namn, bolag och område – men ingen inloggning', async () => {
  const b = browser();
  assert.equal((await b('/posts', { method: 'POST', body: card({ name: '' }) })).status, 400);
  assert.equal((await b('/posts', { method: 'POST', body: card({ companyId: 'finns-inte' }) })).status, 400);
  assert.equal((await b('/posts', { method: 'POST', body: card({ categoryId: '' }) })).status, 400);
  assert.equal((await b('/posts', { method: 'POST', body: card(), csrf: false })).status, 403);
  const r = await b('/posts', { method: 'POST', body: card({ name: 'Test Person', title: 'Ett helt annat testkort', summary: 'Sammanfattning för ett annat testkort här.', tags: '' }) });
  assert.equal(r.status, 201);
});

test('dela, söka, gilla, använda, kommentera och topplista', async () => {
  const anna = browser();
  const erik = browser();
  const lisa = browser();

  const id = (await anna('/posts', { method: 'POST', body: card() })).body.id;
  // Samma namn (annan stavning av versaler) och bolag räknas som samma person.
  await anna('/posts', { method: 'POST', body: card({ name: 'anna  andersson', title: 'Bolånemöte med checklista', categoryId: 'bank', tags: 'bolån' }) });

  let r = await erik('/posts?q=vattensk');
  assert.equal(r.body.total, 1);
  assert.equal(r.body.posts[0].id, id);
  assert.deepEqual(r.body.posts[0].tags, ['video', 'besiktning']);
  assert.equal(r.body.posts[0].canEdit, false);
  assert.equal((await erik('/posts?q=bolan')).body.total, 1);
  assert.equal((await erik('/posts?q=anna andersson')).body.total, 2);
  assert.equal((await erik('/posts?q="); DROP TABLE posts; --')).status, 200);
  assert.equal((await erik('/posts?tag=video')).body.total, 1);

  // Gilla är idempotent per webbläsare.
  await erik(`/posts/${id}/like`, { method: 'POST' });
  r = await erik(`/posts/${id}/like`, { method: 'POST' });
  assert.equal(r.body.count, 1);
  r = await lisa(`/posts/${id}/like`, { method: 'POST' });
  assert.equal(r.body.count, 2);

  assert.equal((await erik(`/posts/${id}/use`, { method: 'POST', body: {} })).status, 400);
  await erik(`/posts/${id}/use`, { method: 'POST', body: { companyId: 'norrbotten' } });
  await lisa(`/posts/${id}/use`, { method: 'POST', body: { companyId: 'norrbotten' } });

  r = await erik(`/posts/${id}`);
  assert.equal(r.body.post.likeCount, 2);
  assert.equal(r.body.post.liked, true);
  assert.deepEqual(r.body.post.usedBy, [{ companyId: 'norrbotten', count: 2 }]);
  assert.equal(r.body.post.author.name, 'Anna Andersson');

  await erik(`/posts/${id}/comments`, { method: 'POST', body: { name: 'Erik', companyId: 'norrbotten', body: 'Hur bokar ni samtalen?' } });
  r = await anna(`/posts/${id}`);
  assert.equal(r.body.comments.length, 1);
  assert.equal(r.body.comments[0].canDelete, false);
  assert.equal(r.body.post.canEdit, true);

  r = await erik('/leaderboard');
  assert.equal(r.body.topPosts[0].id, id);
  assert.equal(r.body.topPosts[0].score, 2);
  const annaRow = r.body.topSharers.find((s) => s.name === 'Anna Andersson');
  assert.equal(annaRow.score, 2);
  assert.equal(r.body.topUsed[0].id, id);

  const person = await erik(`/authors/${annaRow.id}`);
  assert.equal(person.body.stats.posts, 2);
  assert.equal(person.body.stats.likesReceived, 2);

  r = await erik(`/posts/${id}/like`, { method: 'DELETE' });
  assert.equal(r.body.count, 1);
});

test('bara skaparens webbläsare eller admin kan ändra och ta bort', async () => {
  const owner = browser();
  const other = browser();
  const admin = browser(undefined, { 'X-Admin-Key': 'hemlig-nyckel-123' });
  const fake = browser(undefined, { 'X-Admin-Key': 'fel-nyckel-1234567' });

  const { body } = await owner('/posts', { method: 'POST', body: card({ name: 'Ägare Ägarsson' }) });
  assert.equal((await other(`/posts/${body.id}`, { method: 'PUT', body: card() })).status, 403);
  assert.equal((await other(`/posts/${body.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await fake(`/posts/${body.id}`, { method: 'DELETE' })).status, 403);

  const upd = await owner(`/posts/${body.id}`, { method: 'PUT', body: card({ name: 'Ägare Ägarsson', title: 'Uppdaterad rubrik om drönare' }) });
  assert.equal(upd.status, 200);
  assert.equal((await owner('/posts?q=drönare')).body.total, 1);

  assert.equal((await admin('/meta')).body.isAdmin, true);
  assert.equal((await admin(`/posts/${body.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await owner(`/posts/${body.id}`)).status, 404);
  assert.equal((await owner('/posts?q=drönare')).body.total, 0);
});

test('spärr mot för många skrivningar per minut', async () => {
  const { srv, url } = await start({ writesPerMinute: 3 });
  try {
    const b = browser(() => url);
    await b('/meta'); // hämtar besökscookie
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await b('/posts', { method: 'POST', body: card({ name: `Spam ${i}` }) })).status);
    assert.deepEqual(statuses, [201, 201, 201, 429]);
  } finally {
    srv.close();
  }
});

test('exempeldata: alla bolag har delat, flera har delat mer än en gång, topplistan är fylld', () => {
  const db = openDb(':memory:');
  assert.equal(seedExamples(db), true);
  assert.equal(seedExamples(db), false, 'ska inte köras två gånger');
  const n = (sql) => Object.values(db.prepare(sql).get())[0];
  assert.equal(n('SELECT COUNT(*) FROM posts'), POSTS.length);
  assert.equal(n('SELECT COUNT(DISTINCT company_id) FROM posts'), 24);
  assert.equal(n('SELECT COUNT(*) FROM authors'), AUTHORS.length);
  assert.ok(n('SELECT COUNT(*) FROM (SELECT author_id FROM posts GROUP BY author_id HAVING COUNT(*) > 1)') >= 5);
  assert.ok(n('SELECT COUNT(*) FROM likes') > 1000);
  assert.ok(n("SELECT COUNT(*) FROM likes WHERE created_at >= datetime('now', '-30 days')") > 50);
  assert.equal(n("SELECT COUNT(*) FROM posts_fts WHERE posts_fts MATCH '\"lönerevision\"*'"), 1);
});

test('fritextfrågan saneras', () => {
  assert.equal(toFtsQuery('Skade-anmälan  "OR" *'), '"skade"* "anmälan"* "or"*');
  assert.equal(toFtsQuery(''), '');
});
