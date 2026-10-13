const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { COMPANIES, CATEGORIES, companyIds, categoryIds } = require('./constants');

const PAGE_SIZE = 20;
const SESSION_COOKIE = 'kd_session';
const SESSION_DAYS = 30;

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

function createApp({ db, authMode = 'demo', adminEmails = [], allowedDomains = [] }) {
  const admins = new Set(adminEmails.map((e) => e.toLowerCase()));
  const domains = allowedDomains.map((d) => d.toLowerCase().replace(/^@/, ''));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userBySession: db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.created_at > datetime('now', '-${SESSION_DAYS} days')`
    ),
    insertUser: db.prepare('INSERT INTO users (email, name, company_id, title) VALUES (?, ?, ?, ?)'),
    updateUser: db.prepare('UPDATE users SET name = ?, company_id = ?, title = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    postById: db.prepare('SELECT * FROM posts WHERE id = ?'),
    insertPost: db.prepare(
      `INSERT INTO posts (user_id, company_id, category_id, title, summary, challenge, solution, result, howto, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    updatePost: db.prepare(
      `UPDATE posts SET category_id = ?, title = ?, summary = ?, challenge = ?, solution = ?, result = ?,
       howto = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    insertFts: db.prepare('INSERT INTO posts_fts (rowid, title, summary, body, tags) VALUES (?, ?, ?, ?, ?)'),
    deleteFts: db.prepare('DELETE FROM posts_fts WHERE rowid = ?'),
    like: db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)'),
    unlike: db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?'),
    use: db.prepare('INSERT OR IGNORE INTO usages (user_id, post_id) VALUES (?, ?)'),
    unuse: db.prepare('DELETE FROM usages WHERE user_id = ? AND post_id = ?'),
    insertComment: db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)'),
    commentById: db.prepare('SELECT * FROM comments WHERE id = ?'),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    comments: db.prepare(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.name AS author_name, u.company_id AS author_company
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at, c.id`
    ),
    usedBy: db.prepare(
      `SELECT DISTINCT u.company_id FROM usages s JOIN users u ON u.id = s.user_id WHERE s.post_id = ?`
    ),
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

  function indexPost(id, p) {
    q.deleteFts.run(id);
    q.insertFts.run(id, p.title, p.summary, [p.challenge, p.solution, p.result, p.howto].join('\n'), p.tags);
  }

  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, name: u.name, email: u.email, companyId: u.company_id, title: u.title, isAdmin: admins.has(u.email.toLowerCase()) };
  }

  function emailAllowed(email) {
    if (!domains.length) return true;
    const domain = email.split('@')[1] || '';
    return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
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

  // Identifierar användaren. I "easyauth"-läge (Azure App Service / Entra ID) kommer e-post från inloggningen.
  app.use('/api', (req, res, next) => {
    if (authMode === 'easyauth') {
      const email = (req.get('x-ms-client-principal-name') || '').trim().toLowerCase();
      req.ssoEmail = email || null;
      req.user = email ? q.userByEmail.get(email) || null : null;
    } else {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      req.user = token ? q.userBySession.get(token) || null : null;
    }
    next();
  });

  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Du behöver logga in.' });
    next();
  }

  const isAdmin = (user) => admins.has(user.email.toLowerCase());

  function loadPost(req) {
    const id = Number(req.params.id);
    const post = Number.isInteger(id) ? q.postById.get(id) : null;
    if (!post) throw new HttpError(404, 'Förslaget hittades inte.');
    return post;
  }

  // ---------- Inloggning & profil ----------

  app.get('/api/me', (req, res) => {
    res.json({ user: publicUser(req.user), authMode, ssoEmail: req.ssoEmail || null });
  });

  app.post('/api/login', (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 'Namn', { required: true, min: 2, max: LIMITS.name });
    const title = str(b.title, 'Roll', { max: LIMITS.name });
    const companyId = String(b.companyId || '');
    if (!companyIds.has(companyId)) throw new HttpError(400, 'Välj vilket bolag du arbetar på.');

    let email;
    if (authMode === 'easyauth') {
      if (!req.ssoEmail) throw new HttpError(401, 'Inloggning via företagskonto saknas.');
      email = req.ssoEmail;
    } else {
      email = str(b.email, 'E-post', { required: true, max: 200 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Ange en giltig e-postadress.');
    }
    if (!emailAllowed(email)) {
      throw new HttpError(403, `Använd din jobbadress (${domains.map((d) => '@' + d).join(', ')}).`);
    }

    let user = q.userByEmail.get(email);
    if (user) {
      q.updateUser.run(name, companyId, title, user.id);
    } else {
      q.insertUser.run(email, name, companyId, title);
    }
    user = q.userByEmail.get(email);

    if (authMode !== 'easyauth') {
      const token = crypto.randomBytes(32).toString('hex');
      q.insertSession.run(token, user.id);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        maxAge: SESSION_DAYS * 864e5,
        path: '/',
      });
    }
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) q.deleteSession.run(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.put('/api/me', requireUser, (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 'Namn', { required: true, min: 2, max: LIMITS.name });
    const title = str(b.title, 'Roll', { max: LIMITS.name });
    const companyId = String(b.companyId || '');
    if (!companyIds.has(companyId)) throw new HttpError(400, 'Välj ett giltigt bolag.');
    q.updateUser.run(name, companyId, title, req.user.id);
    res.json({ user: publicUser(q.userById.get(req.user.id)) });
  });

  // ---------- Grunddata & statistik ----------

  app.get('/api/meta', (req, res) => {
    res.json({ companies: COMPANIES, categories: CATEGORIES, limits: LIMITS });
  });

  app.get('/api/stats', (req, res) => {
    const one = (sql) => Object.values(db.prepare(sql).get())[0];
    res.json({
      posts: one('SELECT COUNT(*) FROM posts'),
      users: one('SELECT COUNT(*) FROM users'),
      sharers: one('SELECT COUNT(DISTINCT user_id) FROM posts'),
      companies: one('SELECT COUNT(DISTINCT company_id) FROM posts'),
      likes: one('SELECT COUNT(*) FROM likes'),
      usages: one('SELECT COUNT(*) FROM usages'),
    });
  });

  // ---------- Förslag ----------

  const POST_FIELDS = `
    p.id, p.title, p.summary, p.category_id, p.company_id, p.tags, p.created_at, p.updated_at, p.user_id,
    u.name AS author_name, u.title AS author_title,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
    (SELECT COUNT(*) FROM usages s WHERE s.post_id = p.id) AS usage_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = :me) AS liked,
    EXISTS (SELECT 1 FROM usages s WHERE s.post_id = p.id AND s.user_id = :me) AS used`;

  function shapePost(r) {
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      categoryId: r.category_id,
      companyId: r.company_id,
      tags: r.tags ? r.tags.split(',') : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: { id: r.user_id, name: r.author_name, title: r.author_title },
      likeCount: r.like_count,
      commentCount: r.comment_count,
      usageCount: r.usage_count,
      liked: !!r.liked,
      used: !!r.used,
    };
  }

  app.get('/api/posts', (req, res) => {
    const where = [];
    const params = { me: req.user ? req.user.id : 0 };
    const fts = toFtsQuery(req.query.q);
    let from = 'posts p JOIN users u ON u.id = p.user_id';
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
      where.push('p.user_id = :author');
      params.author = Number(req.query.author);
    }

    const sorts = {
      new: 'p.created_at DESC, p.id DESC',
      likes: 'like_count DESC, p.created_at DESC',
      used: 'usage_count DESC, like_count DESC, p.created_at DESC',
      comments: 'comment_count DESC, p.created_at DESC',
      relevance: fts ? 'bm25(posts_fts, 10.0, 5.0, 1.0, 3.0), p.created_at DESC' : 'p.created_at DESC',
    };
    const sort = sorts[req.query.sort] ? req.query.sort : fts ? 'relevance' : 'new';
    const page = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${from} ${whereSql}`).get(
      Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'me'))
    );
    const rows = db
      .prepare(`SELECT ${POST_FIELDS} FROM ${from} ${whereSql} ORDER BY ${sorts[sort]} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`)
      .all(params);
    res.json({ posts: rows.map(shapePost), total, page, pageSize: PAGE_SIZE, sort });
  });

  app.get('/api/posts/:id', (req, res) => {
    const post = loadPost(req);
    const row = db
      .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = :id`)
      .get({ id: post.id, me: req.user ? req.user.id : 0 });
    const author = q.userById.get(post.user_id);
    res.json({
      post: {
        ...shapePost(row),
        challenge: post.challenge,
        solution: post.solution,
        result: post.result,
        howto: post.howto,
        author: { id: author.id, name: author.name, title: author.title, email: author.email, companyId: author.company_id },
        usedByCompanies: q.usedBy.all(post.id).map((r) => r.company_id),
        canEdit: !!req.user && (req.user.id === post.user_id || isAdmin(req.user)),
      },
      comments: q.comments.all(post.id).map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        author: { id: c.user_id, name: c.author_name, companyId: c.author_company },
        canDelete: !!req.user && (req.user.id === c.user_id || isAdmin(req.user)),
      })),
    });
  });

  function readPostBody(body) {
    const b = body || {};
    const categoryId = String(b.categoryId || '');
    if (!categoryIds.has(categoryId)) throw new HttpError(400, 'Välj en kategori.');
    return {
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

  app.post('/api/posts', requireUser, (req, res) => {
    const p = readPostBody(req.body);
    const id = tx(() => {
      const { lastInsertRowid } = q.insertPost.run(
        req.user.id, req.user.company_id, p.categoryId, p.title, p.summary, p.challenge, p.solution, p.result, p.howto, p.tags
      );
      indexPost(Number(lastInsertRowid), p);
      return Number(lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  app.put('/api/posts/:id', requireUser, (req, res) => {
    const post = loadPost(req);
    if (post.user_id !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'Du kan bara ändra dina egna förslag.');
    const p = readPostBody(req.body);
    tx(() => {
      q.updatePost.run(p.categoryId, p.title, p.summary, p.challenge, p.solution, p.result, p.howto, p.tags, post.id);
      indexPost(post.id, p);
    });
    res.json({ id: post.id });
  });

  app.delete('/api/posts/:id', requireUser, (req, res) => {
    const post = loadPost(req);
    if (post.user_id !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'Du kan bara ta bort dina egna förslag.');
    tx(() => {
      q.deletePost.run(post.id);
      q.deleteFts.run(post.id);
    });
    res.json({ ok: true });
  });

  // Gilla / "vi använder detta" – idempotenta så att dubbelklick inte ger dubbla röster.
  function toggleRoute(path, add, remove, countSql, key) {
    const count = db.prepare(countSql);
    app.post(path, requireUser, (req, res) => {
      const post = loadPost(req);
      add.run(req.user.id, post.id);
      res.json({ [key]: true, count: count.get(post.id).n });
    });
    app.delete(path, requireUser, (req, res) => {
      const post = loadPost(req);
      remove.run(req.user.id, post.id);
      res.json({ [key]: false, count: count.get(post.id).n });
    });
  }
  toggleRoute('/api/posts/:id/like', q.like, q.unlike, 'SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', 'liked');
  toggleRoute('/api/posts/:id/use', q.use, q.unuse, 'SELECT COUNT(*) AS n FROM usages WHERE post_id = ?', 'used');

  app.post('/api/posts/:id/comments', requireUser, (req, res) => {
    const post = loadPost(req);
    const body = str((req.body || {}).body, 'Kommentar', { required: true, max: LIMITS.comment });
    const { lastInsertRowid } = q.insertComment.run(post.id, req.user.id, body);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.delete('/api/comments/:id', requireUser, (req, res) => {
    const c = q.commentById.get(Number(req.params.id));
    if (!c) throw new HttpError(404, 'Kommentaren hittades inte.');
    if (c.user_id !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'Du kan bara ta bort dina egna kommentarer.');
    q.deleteComment.run(c.id);
    res.json({ ok: true });
  });

  // ---------- Topplista ----------

  app.get('/api/leaderboard', (req, res) => {
    const period = ['30', '90', '365'].includes(req.query.period) ? req.query.period : 'all';
    const since = sinceDate(period);
    const limit = 10;

    const topPosts = db
      .prepare(
        `SELECT p.id, p.title, p.company_id, p.category_id, u.id AS user_id, u.name AS author_name, COUNT(l.user_id) AS score
         FROM likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = p.user_id
         WHERE l.created_at >= ? GROUP BY p.id ORDER BY score DESC, p.created_at DESC LIMIT ${limit}`
      )
      .all(since);

    const topUsed = db
      .prepare(
        `SELECT p.id, p.title, p.company_id, p.category_id, u.id AS user_id, u.name AS author_name, COUNT(s.user_id) AS score
         FROM usages s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = p.user_id
         WHERE s.created_at >= ? GROUP BY p.id ORDER BY score DESC, p.created_at DESC LIMIT ${limit}`
      )
      .all(since);

    const topSharers = db
      .prepare(
        `SELECT u.id, u.name, u.company_id, u.title, COUNT(*) AS score,
           (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id = l.post_id WHERE p2.user_id = u.id) AS likes_received
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.created_at >= ? GROUP BY u.id ORDER BY score DESC, likes_received DESC, u.name LIMIT ${limit}`
      )
      .all(since);

    const topCompanies = db
      .prepare(
        `SELECT p.company_id, COUNT(*) AS score, COUNT(DISTINCT p.user_id) AS sharers,
           (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id = l.post_id WHERE p2.company_id = p.company_id) AS likes_received
         FROM posts p WHERE p.created_at >= ? GROUP BY p.company_id ORDER BY score DESC, likes_received DESC LIMIT ${COMPANIES.length}`
      )
      .all(since);

    const shapeRanked = (r) => ({
      id: r.id, title: r.title, companyId: r.company_id, categoryId: r.category_id,
      author: { id: r.user_id, name: r.author_name }, score: r.score,
    });

    res.json({
      period,
      topPosts: topPosts.map(shapeRanked),
      topUsed: topUsed.map(shapeRanked),
      topSharers: topSharers.map((r) => ({
        id: r.id, name: r.name, title: r.title, companyId: r.company_id, score: r.score, likesReceived: r.likes_received,
      })),
      topCompanies: topCompanies.map((r) => ({
        companyId: r.company_id, score: r.score, sharers: r.sharers, likesReceived: r.likes_received,
      })),
    });
  });

  // ---------- Profil ----------

  app.get('/api/users/:id', (req, res) => {
    const u = q.userById.get(Number(req.params.id));
    if (!u) throw new HttpError(404, 'Användaren hittades inte.');
    const n = (sql) => db.prepare(sql).get(u.id).n;
    res.json({
      user: { id: u.id, name: u.name, title: u.title, email: u.email, companyId: u.company_id, createdAt: u.created_at },
      stats: {
        posts: n('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?'),
        likesReceived: n('SELECT COUNT(*) AS n FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?'),
        usagesReceived: n('SELECT COUNT(*) AS n FROM usages s JOIN posts p ON p.id = s.post_id WHERE p.user_id = ?'),
        likesGiven: n('SELECT COUNT(*) AS n FROM likes WHERE user_id = ?'),
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

module.exports = { createApp, toFtsQuery };
