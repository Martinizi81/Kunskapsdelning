const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { COMPANIES, CATEGORIES, companyIds, categoryIds } = require('./constants');

const PAGE_SIZE = 24;
const VISITOR_COOKIE = 'kd_visitor';

const LIMITS = {
  name: 80,
  title: 120,
  summary: 400,
  section: 5000,
  comment: 2000,
  tag: 30,
  tags: 8,
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function str(value, field, { min = 0, max, required = false } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new HttpError(400, `Fältet "${field}" måste fyllas i.`);
  if (s && s.length < min) throw new HttpError(400, `Fältet "${field}" måste vara minst ${min} tecken.`);
  if (max && s.length > max) throw new HttpError(400, `Fältet "${field}" får vara högst ${max} tecken.`);
  return s;
}

function company(value) {
  const id = String(value || '');
  if (!companyIds.has(id)) throw new HttpError(400, 'Välj vilket bolag du arbetar på.');
  return id;
}

const nameKey = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

function parseTags(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const tags = [];
  for (const t of raw) {
    const tag = String(t).trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > LIMITS.tag) throw new HttpError(400, `Taggen "${tag}" är för lång (max ${LIMITS.tag} tecken).`);
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > LIMITS.tags) throw new HttpError(400, `Högst ${LIMITS.tags} taggar.`);
  return tags;
}

// Gör om användarens sökord till en säker FTS5-fråga: varje ord blir ett prefixsök, alla ord måste matcha.
function toFtsQuery(q) {
  const words = (q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.slice(0, 10).map((w) => `"${w}"*`).join(' ');
}

function sinceDate(period) {
  const days = { '30': 30, '90': 90, '365': 365 }[period];
  if (!days) return '0000-00-00';
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
}

// Enkel spärr mot spam: högst `max` skrivningar per besökare och minut.
function rateLimiter(max) {
  const hits = new Map();
  return (req, res, next) => {
    if (req.method === 'GET') return next();
    const minute = Math.floor(Date.now() / 60000);
    const key = `${req.visitorId}:${minute}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (hits.size > 50000) hits.clear();
    if (n > max) return res.status(429).json({ error: 'Lugn i stormen! Vänta en minut och försök igen.' });
    next();
  };
}

function createApp({ db, adminKey = '', writesPerMinute = 30 }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const q = {
    authorById: db.prepare('SELECT * FROM authors WHERE id = ?'),
    authorByKey: db.prepare('SELECT * FROM authors WHERE name_key = ? AND company_id = ?'),
    insertAuthor: db.prepare('INSERT INTO authors (name, name_key, company_id, title) VALUES (?, ?, ?, ?)'),
    updateAuthorTitle: db.prepare('UPDATE authors SET title = ?, name = ? WHERE id = ?'),
    postById: db.prepare('SELECT * FROM posts WHERE id = ?'),
    insertPost: db.prepare(
      `INSERT INTO posts (author_id, owner_visitor, company_id, category_id, title, summary, challenge, solution, result, howto, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    updatePost: db.prepare(
      `UPDATE posts SET author_id = ?, company_id = ?, category_id = ?, title = ?, summary = ?, challenge = ?, solution = ?,
       result = ?, howto = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    deleteOrphanAuthors: db.prepare('DELETE FROM authors WHERE id NOT IN (SELECT author_id FROM posts)'),
    insertFts: db.prepare('INSERT INTO posts_fts (rowid, title, summary, body, tags, author) VALUES (?, ?, ?, ?, ?, ?)'),
    deleteFts: db.prepare('DELETE FROM posts_fts WHERE rowid = ?'),
    like: db.prepare('INSERT OR IGNORE INTO likes (visitor_id, post_id) VALUES (?, ?)'),
    unlike: db.prepare('DELETE FROM likes WHERE visitor_id = ? AND post_id = ?'),
    likeCount: db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?'),
    use: db.prepare('INSERT OR REPLACE INTO usages (visitor_id, post_id, company_id) VALUES (?, ?, ?)'),
    unuse: db.prepare('DELETE FROM usages WHERE visitor_id = ? AND post_id = ?'),
    usageCount: db.prepare('SELECT COUNT(*) AS n FROM usages WHERE post_id = ?'),
    usedBy: db.prepare(
      'SELECT company_id, COUNT(*) AS n FROM usages WHERE post_id = ? GROUP BY company_id ORDER BY n DESC, company_id'
    ),
    insertComment: db.prepare('INSERT INTO comments (post_id, owner_visitor, author_name, company_id, body) VALUES (?, ?, ?, ?, ?)'),
    commentById: db.prepare('SELECT * FROM comments WHERE id = ?'),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    comments: db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at, id'),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function getOrCreateAuthor(name, companyId, title) {
    const existing = q.authorByKey.get(nameKey(name), companyId);
    if (existing) {
      if (title && title !== existing.title) q.updateAuthorTitle.run(title, name, existing.id);
      return existing.id;
    }
    return Number(q.insertAuthor.run(name, nameKey(name), companyId, title).lastInsertRowid);
  }

  function indexPost(id, p, authorName) {
    q.deleteFts.run(id);
    q.insertFts.run(id, p.title, p.summary, [p.challenge, p.solution, p.result, p.howto].join('\n'), p.tags, authorName);
  }

  // ---------- Middleware ----------

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  // Skydd mot CSRF: alla ändrande anrop måste skicka med en egen header, vilket en extern sida inte kan göra.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'kunskapsdelning') {
      return res.status(403).json({ error: 'Ogiltig förfrågan.' });
    }
    next();
  });

  // Varje webbläsare får ett anonymt id. Det används för att man bara ska kunna gilla ett kort en gång
  // och för att den som skapat ett kort ska kunna ändra det från samma webbläsare.
  app.use('/api', (req, res, next) => {
    let id = parseCookies(req.headers.cookie)[VISITOR_COOKIE];
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
      id = crypto.randomBytes(16).toString('hex');
      res.cookie(VISITOR_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 2 * 365 * 864e5, path: '/' });
    }
    req.visitorId = id;
    const key = req.get('x-admin-key') || '';
    req.isAdmin = !!adminKey && key.length === adminKey.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(adminKey));
    next();
  });

  app.use('/api', rateLimiter(writesPerMinute));

  function loadPost(req) {
    const id = Number(req.params.id);
    const post = Number.isInteger(id) ? q.postById.get(id) : null;
    if (!post) throw new HttpError(404, 'Kortet hittades inte.');
    return post;
  }

  const canEdit = (req, ownerVisitor) => req.isAdmin || (!!ownerVisitor && ownerVisitor === req.visitorId);

  // ---------- Grunddata & statistik ----------

  app.get('/api/meta', (req, res) => {
    res.json({ companies: COMPANIES, categories: CATEGORIES, limits: LIMITS, isAdmin: req.isAdmin });
  });

  app.get('/api/stats', (req, res) => {
    const one = (sql) => Object.values(db.prepare(sql).get())[0];
    res.json({
      posts: one('SELECT COUNT(*) FROM posts'),
      authors: one('SELECT COUNT(DISTINCT author_id) FROM posts'),
      companies: one('SELECT COUNT(DISTINCT company_id) FROM posts'),
      likes: one('SELECT COUNT(*) FROM likes'),
      usages: one('SELECT COUNT(*) FROM usages'),
    });
  });

  // ---------- Kort (förslag) ----------

  const POST_FIELDS = `
    p.id, p.title, p.summary, p.category_id, p.company_id, p.tags, p.created_at, p.updated_at, p.owner_visitor,
    a.id AS author_id, a.name AS author_name, a.title AS author_title,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
    (SELECT COUNT(*) FROM usages s WHERE s.post_id = p.id) AS usage_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.visitor_id = :me) AS liked,
    EXISTS (SELECT 1 FROM usages s WHERE s.post_id = p.id AND s.visitor_id = :me) AS used`;

  function shapePost(r, req) {
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      categoryId: r.category_id,
      companyId: r.company_id,
      tags: r.tags ? r.tags.split(',') : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: { id: r.author_id, name: r.author_name, title: r.author_title },
      likeCount: r.like_count,
      commentCount: r.comment_count,
      usageCount: r.usage_count,
      liked: !!r.liked,
      used: !!r.used,
      canEdit: canEdit(req, r.owner_visitor),
    };
  }

  app.get('/api/posts', (req, res) => {
    const where = [];
    const params = {};
    const fts = toFtsQuery(req.query.q);
    let from = 'posts p JOIN authors a ON a.id = p.author_id';
    if (fts) {
      from += ' JOIN posts_fts f ON f.rowid = p.id';
      where.push('posts_fts MATCH :fts');
      params.fts = fts;
    }
    if (req.query.company && companyIds.has(req.query.company)) {
      where.push('p.company_id = :company');
      params.company = req.query.company;
    }
    if (req.query.category && categoryIds.has(req.query.category)) {
      where.push('p.category_id = :category');
      params.category = req.query.category;
    }
    if (req.query.tag) {
      where.push("(',' || p.tags || ',') LIKE :tag");
      params.tag = `%,${String(req.query.tag).toLowerCase().replace(/[%_,]/g, '')},%`;
    }
    if (req.query.author && /^\d+$/.test(req.query.author)) {
      where.push('p.author_id = :author');
      params.author = Number(req.query.author);
    }

    const sorts = {
      new: 'p.created_at DESC, p.id DESC',
      likes: 'like_count DESC, p.created_at DESC',
      used: 'usage_count DESC, like_count DESC, p.created_at DESC',
      comments: 'comment_count DESC, p.created_at DESC',
      relevance: fts ? 'bm25(posts_fts, 10.0, 5.0, 1.0, 3.0, 2.0), p.created_at DESC' : 'p.created_at DESC',
    };
    const sort = sorts[req.query.sort] ? req.query.sort : fts ? 'relevance' : 'new';
    const page = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${from} ${whereSql}`).get(params);
    const rows = db
      .prepare(`SELECT ${POST_FIELDS} FROM ${from} ${whereSql} ORDER BY ${sorts[sort]} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`)
      .all({ ...params, me: req.visitorId });
    res.json({ posts: rows.map((r) => shapePost(r, req)), total, page, pageSize: PAGE_SIZE, sort });
  });

  app.get('/api/posts/:id', (req, res) => {
    const post = loadPost(req);
    const row = db
      .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id = :id`)
      .get({ id: post.id, me: req.visitorId });
    res.json({
      post: {
        ...shapePost(row, req),
        challenge: post.challenge,
        solution: post.solution,
        result: post.result,
        howto: post.howto,
        usedBy: q.usedBy.all(post.id).map((r) => ({ companyId: r.company_id, count: r.n })),
      },
      comments: q.comments.all(post.id).map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        authorName: c.author_name,
        companyId: c.company_id,
        canDelete: canEdit(req, c.owner_visitor),
      })),
    });
  });

  function readPostBody(body) {
    const b = body || {};
    const categoryId = String(b.categoryId || '');
    if (!categoryIds.has(categoryId)) throw new HttpError(400, 'Välj ett område.');
    return {
      name: str(b.name, 'Ditt namn', { required: true, min: 2, max: LIMITS.name }),
      companyId: company(b.companyId),
      authorTitle: str(b.authorTitle, 'Roll', { max: LIMITS.name }),
      categoryId,
      title: str(b.title, 'Rubrik', { required: true, min: 5, max: LIMITS.title }),
      summary: str(b.summary, 'Sammanfattning', { required: true, min: 20, max: LIMITS.summary }),
      challenge: str(b.challenge, 'Utmaning', { max: LIMITS.section }),
      solution: str(b.solution, 'Vad vi gjorde', { required: true, min: 20, max: LIMITS.section }),
      result: str(b.result, 'Resultat', { max: LIMITS.section }),
      howto: str(b.howto, 'Så kan ni göra', { max: LIMITS.section }),
      tags: parseTags(b.tags).join(','),
    };
  }

  app.post('/api/posts', (req, res) => {
    const p = readPostBody(req.body);
    const id = tx(() => {
      const authorId = getOrCreateAuthor(p.name, p.companyId, p.authorTitle);
      const { lastInsertRowid } = q.insertPost.run(
        authorId, req.visitorId, p.companyId, p.categoryId, p.title, p.summary, p.challenge, p.solution, p.result, p.howto, p.tags
      );
      indexPost(Number(lastInsertRowid), p, p.name);
      return Number(lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  app.put('/api/posts/:id', (req, res) => {
    const post = loadPost(req);
    if (!canEdit(req, post.owner_visitor)) throw new HttpError(403, 'Kortet kan bara ändras från webbläsaren där det skapades.');
    const p = readPostBody(req.body);
    tx(() => {
      const authorId = getOrCreateAuthor(p.name, p.companyId, p.authorTitle);
      q.updatePost.run(authorId, p.companyId, p.categoryId, p.title, p.summary, p.challenge, p.solution, p.result, p.howto, p.tags, post.id);
      indexPost(post.id, p, p.name);
      q.deleteOrphanAuthors.run();
    });
    res.json({ id: post.id });
  });

  app.delete('/api/posts/:id', (req, res) => {
    const post = loadPost(req);
    if (!canEdit(req, post.owner_visitor)) throw new HttpError(403, 'Kortet kan bara tas bort från webbläsaren där det skapades.');
    tx(() => {
      q.deletePost.run(post.id);
      q.deleteFts.run(post.id);
      q.deleteOrphanAuthors.run();
    });
    res.json({ ok: true });
  });

  // Gilla – idempotent så att dubbelklick inte ger dubbla röster.
  app.post('/api/posts/:id/like', (req, res) => {
    const post = loadPost(req);
    q.like.run(req.visitorId, post.id);
    res.json({ liked: true, count: q.likeCount.get(post.id).n });
  });
  app.delete('/api/posts/:id/like', (req, res) => {
    const post = loadPost(req);
    q.unlike.run(req.visitorId, post.id);
    res.json({ liked: false, count: q.likeCount.get(post.id).n });
  });

  app.post('/api/posts/:id/use', (req, res) => {
    const post = loadPost(req);
    q.use.run(req.visitorId, post.id, company((req.body || {}).companyId));
    res.json({ used: true, count: q.usageCount.get(post.id).n });
  });
  app.delete('/api/posts/:id/use', (req, res) => {
    const post = loadPost(req);
    q.unuse.run(req.visitorId, post.id);
    res.json({ used: false, count: q.usageCount.get(post.id).n });
  });

  app.post('/api/posts/:id/comments', (req, res) => {
    const post = loadPost(req);
    const b = req.body || {};
    const name = str(b.name, 'Ditt namn', { required: true, min: 2, max: LIMITS.name });
    const companyId = company(b.companyId);
    const body = str(b.body, 'Kommentar', { required: true, max: LIMITS.comment });
    const { lastInsertRowid } = q.insertComment.run(post.id, req.visitorId, name, companyId, body);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.delete('/api/comments/:id', (req, res) => {
    const c = q.commentById.get(Number(req.params.id));
    if (!c) throw new HttpError(404, 'Kommentaren hittades inte.');
    if (!canEdit(req, c.owner_visitor)) throw new HttpError(403, 'Kommentaren kan bara tas bort från webbläsaren där den skrevs.');
    q.deleteComment.run(c.id);
    res.json({ ok: true });
  });

  // ---------- Topplista ----------

  app.get('/api/leaderboard', (req, res) => {
    const period = ['30', '90', '365'].includes(req.query.period) ? req.query.period : 'all';
    const since = sinceDate(period);
    const limit = 10;

    const ranked = (table) =>
      db
        .prepare(
          `SELECT p.id, p.title, p.company_id, p.category_id, a.id AS author_id, a.name AS author_name, COUNT(*) AS score
           FROM ${table} x JOIN posts p ON p.id = x.post_id JOIN authors a ON a.id = p.author_id
           WHERE x.created_at >= ? GROUP BY p.id ORDER BY score DESC, p.created_at DESC LIMIT ${limit}`
        )
        .all(since);

    const topSharers = db
      .prepare(
        `SELECT a.id, a.name, a.company_id, a.title, COUNT(*) AS score,
           (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id = l.post_id WHERE p2.author_id = a.id) AS likes_received
         FROM posts p JOIN authors a ON a.id = p.author_id
         WHERE p.created_at >= ? GROUP BY a.id ORDER BY score DESC, likes_received DESC, a.name LIMIT ${limit}`
      )
      .all(since);

    const topCompanies = db
      .prepare(
        `SELECT p.company_id, COUNT(*) AS score, COUNT(DISTINCT p.author_id) AS sharers,
           (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id = l.post_id WHERE p2.company_id = p.company_id) AS likes_received
         FROM posts p WHERE p.created_at >= ? GROUP BY p.company_id ORDER BY score DESC, likes_received DESC LIMIT ${COMPANIES.length}`
      )
      .all(since);

    const shapeRanked = (r) => ({
      id: r.id, title: r.title, companyId: r.company_id, categoryId: r.category_id,
      author: { id: r.author_id, name: r.author_name }, score: r.score,
    });

    res.json({
      period,
      topPosts: ranked('likes').map(shapeRanked),
      topUsed: ranked('usages').map(shapeRanked),
      topSharers: topSharers.map((r) => ({
        id: r.id, name: r.name, title: r.title, companyId: r.company_id, score: r.score, likesReceived: r.likes_received,
      })),
      topCompanies: topCompanies.map((r) => ({
        companyId: r.company_id, score: r.score, sharers: r.sharers, likesReceived: r.likes_received,
      })),
    });
  });

  // ---------- Delare ----------

  app.get('/api/authors/:id', (req, res) => {
    const a = q.authorById.get(Number(req.params.id));
    if (!a) throw new HttpError(404, 'Personen hittades inte.');
    const n = (sql) => db.prepare(sql).get(a.id).n;
    res.json({
      author: { id: a.id, name: a.name, title: a.title, companyId: a.company_id },
      stats: {
        posts: n('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?'),
        likesReceived: n('SELECT COUNT(*) AS n FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = ?'),
        usagesReceived: n('SELECT COUNT(*) AS n FROM usages s JOIN posts p ON p.id = s.post_id WHERE p.author_id = ?'),
      },
    });
  });

  // ---------- Webbsidan ----------

  app.use('/api', (req, res) => res.status(404).json({ error: 'Okänt API-anrop.' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ogiltig data.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Texten är för lång.' });
    console.error(err);
    res.status(500).json({ error: 'Något gick fel. Försök igen.' });
  });

  return app;
}

module.exports = { createApp, toFtsQuery, nameKey, LIMITS };
