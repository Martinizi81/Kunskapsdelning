'use strict';

// Webbläsarversion av API:t – används när sajten ligger på GitHub Pages (utan server).
// Exempelkorten kommer från data.json. Det besökaren själv delar, gillar och kommenterar
// sparas i webbläsarens localStorage och syns alltså bara för den besökaren.
(function () {
  const LOCAL_KEY = 'kd_local_v1';
  const PAGE_SIZE = 24;

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const parse = (s) => new Date(s.replace(' ', 'T') + 'Z');
  const now = () => fmt(new Date());
  const nameKey = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = (s) => normalize(s).match(/[\p{L}\p{N}]+/gu) || [];

  function create(data) {
    // Exempeldatan är skapad vid byggtillfället – flytta fram alla datum så att de är relativa till idag.
    const shift = Date.now() - new Date(data.generatedAt).getTime();
    const shiftDate = (s) => fmt(new Date(parse(s).getTime() + shift));
    const companyIds = new Set(data.companies.map((c) => c.id));
    const categoryIds = new Set(data.categories.map((c) => c.id));
    const L = data.limits;

    const seedAuthors = data.authors;
    const seedPosts = data.posts.map((p) => ({
      ...p,
      createdAt: shiftDate(p.createdAt),
      updatedAt: shiftDate(p.updatedAt),
      likes: p.likes.map(shiftDate),
      usages: p.usages.map((u) => ({ ...u, createdAt: shiftDate(u.createdAt) })),
    }));
    const seedComments = data.comments.map((c) => ({ ...c, createdAt: shiftDate(c.createdAt) }));

    function load() {
      try {
        const v = JSON.parse(localStorage.getItem(LOCAL_KEY));
        if (v && v.posts) return v;
      } catch { /* ignorera */ }
      return { nextId: 1, authors: [], posts: [], comments: [], likes: {}, usages: {} };
    }
    let local = load();
    const save = () => {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch { /* privat läge */ }
    };
    const newId = () => 1000000 + local.nextId++;

    const allAuthors = () => [...seedAuthors, ...local.authors];
    const allPosts = () => [...seedPosts, ...local.posts];
    const allComments = () => [...seedComments, ...local.comments];
    const authorById = (id) => allAuthors().find((a) => a.id === id);

    const likeCount = (p) => p.likes.length + (local.likes[p.id] ? 1 : 0);
    const likeDates = (p) => (local.likes[p.id] ? [...p.likes, local.likes[p.id]] : p.likes);
    const usagesOf = (p) => (local.usages[p.id] ? [...p.usages, local.usages[p.id]] : p.usages);

    function shape(p) {
      const a = authorById(p.authorId);
      return {
        id: p.id, title: p.title, summary: p.summary, categoryId: p.categoryId, companyId: p.companyId,
        tags: p.tags, createdAt: p.createdAt, updatedAt: p.updatedAt,
        author: { id: a.id, name: a.name, title: a.title },
        likeCount: likeCount(p),
        commentCount: allComments().filter((c) => c.postId === p.id).length,
        usageCount: usagesOf(p).length,
        liked: !!local.likes[p.id],
        used: !!local.usages[p.id],
        canEdit: !!p.own,
      };
    }

    function getPost(id) {
      const p = allPosts().find((x) => x.id === Number(id));
      if (!p) throw new ApiError(404, 'Kortet hittades inte.');
      return p;
    }

    function str(value, field, { min = 0, max, required = false } = {}) {
      const s = typeof value === 'string' ? value.trim() : '';
      if (required && !s) throw new ApiError(400, `Fältet "${field}" måste fyllas i.`);
      if (s && s.length < min) throw new ApiError(400, `Fältet "${field}" måste vara minst ${min} tecken.`);
      if (max && s.length > max) throw new ApiError(400, `Fältet "${field}" får vara högst ${max} tecken.`);
      return s;
    }
    function company(v) {
      if (!companyIds.has(String(v || ''))) throw new ApiError(400, 'Välj vilket bolag du arbetar på.');
      return String(v);
    }
    function parseTags(value) {
      const tags = [];
      for (const t of String(value || '').split(',')) {
        const tag = t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
        if (!tag) continue;
        if (tag.length > L.tag) throw new ApiError(400, `Taggen "${tag}" är för lång (max ${L.tag} tecken).`);
        if (!tags.includes(tag)) tags.push(tag);
      }
      if (tags.length > L.tags) throw new ApiError(400, `Högst ${L.tags} taggar.`);
      return tags;
    }
    function readPost(b) {
      b = b || {};
      if (!categoryIds.has(String(b.categoryId || ''))) throw new ApiError(400, 'Välj ett område.');
      return {
        name: str(b.name, 'Ditt namn', { required: true, min: 2, max: L.name }),
        companyId: company(b.companyId),
        authorTitle: str(b.authorTitle, 'Roll', { max: L.name }),
        categoryId: b.categoryId,
        title: str(b.title, 'Rubrik', { required: true, min: 5, max: L.title }),
        summary: str(b.summary, 'Sammanfattning', { required: true, min: 20, max: L.summary }),
        challenge: str(b.challenge, 'Utmaning', { max: L.section }),
        solution: str(b.solution, 'Vad vi gjorde', { required: true, min: 20, max: L.section }),
        result: str(b.result, 'Resultat', { max: L.section }),
        howto: str(b.howto, 'Så kan ni göra', { max: L.section }),
        tags: parseTags(b.tags),
      };
    }
    function getOrCreateAuthor(name, companyId, title) {
      const existing = allAuthors().find((a) => nameKey(a.name) === nameKey(name) && a.companyId === companyId);
      if (existing) {
        const mine = local.authors.find((a) => a.id === existing.id);
        if (mine && title) mine.title = title;
        return existing.id;
      }
      const a = { id: newId(), name, title, companyId };
      local.authors.push(a);
      return a.id;
    }
    const pruneAuthors = () => {
      local.authors = local.authors.filter((a) => allPosts().some((p) => p.authorId === a.id));
    };

    function search(posts, q) {
      const qw = words(q).slice(0, 10);
      if (!qw.length) return null;
      const scored = [];
      for (const p of posts) {
        const a = authorById(p.authorId);
        const fields = [
          [words(p.title), 10], [words(p.summary), 5], [words(p.tags.join(' ')), 3], [words(a.name), 2],
          [words([p.challenge, p.solution, p.result, p.howto].join(' ')), 1],
        ];
        let score = 0;
        const all = qw.every((w) => {
          let hit = false;
          for (const [ws, weight] of fields) {
            const n = ws.filter((x) => x.startsWith(w)).length;
            if (n) { hit = true; score += n * weight; }
          }
          return hit;
        });
        if (all) scored.push({ p, score });
      }
      return scored;
    }

    function sinceDate(period) {
      const days = { '30': 30, '90': 90, '365': 365 }[period];
      return days ? fmt(new Date(Date.now() - days * 864e5)) : '0000-00-00';
    }

    const routes = [
      ['GET', /^\/meta$/, () => ({ companies: data.companies, categories: data.categories, limits: L, isAdmin: false, static: true })],

      ['GET', /^\/stats$/, () => {
        const posts = allPosts();
        return {
          posts: posts.length,
          authors: new Set(posts.map((p) => p.authorId)).size,
          companies: new Set(posts.map((p) => p.companyId)).size,
          likes: posts.reduce((n, p) => n + likeCount(p), 0),
          usages: posts.reduce((n, p) => n + usagesOf(p).length, 0),
        };
      }],

      ['GET', /^\/posts$/, (m, body, query) => {
        let posts = allPosts();
        if (companyIds.has(query.get('company'))) posts = posts.filter((p) => p.companyId === query.get('company'));
        if (categoryIds.has(query.get('category'))) posts = posts.filter((p) => p.categoryId === query.get('category'));
        if (query.get('tag')) posts = posts.filter((p) => p.tags.includes(query.get('tag').toLowerCase()));
        if (/^\d+$/.test(query.get('author') || '')) posts = posts.filter((p) => p.authorId === Number(query.get('author')));
        const scored = search(posts, query.get('q'));
        let rows = (scored || posts.map((p) => ({ p, score: 0 }))).map(({ p, score }) => ({ ...shape(p), _score: score }));
        const byDate = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
        const sorts = {
          new: byDate,
          likes: (a, b) => b.likeCount - a.likeCount || byDate(a, b),
          used: (a, b) => b.usageCount - a.usageCount || b.likeCount - a.likeCount || byDate(a, b),
          comments: (a, b) => b.commentCount - a.commentCount || byDate(a, b),
          relevance: (a, b) => b._score - a._score || byDate(a, b),
        };
        const sort = sorts[query.get('sort')] ? query.get('sort') : scored ? 'relevance' : 'new';
        rows.sort(sorts[sort]);
        const page = Math.max(1, Math.min(1000, parseInt(query.get('page'), 10) || 1));
        const total = rows.length;
        rows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ _score, ...r }) => r);
        return { posts: rows, total, page, pageSize: PAGE_SIZE, sort };
      }],

      ['GET', /^\/posts\/(\d+)$/, (m) => {
        const p = getPost(m[1]);
        const usedBy = {};
        for (const u of usagesOf(p)) usedBy[u.companyId] = (usedBy[u.companyId] || 0) + 1;
        return {
          post: {
            ...shape(p), challenge: p.challenge, solution: p.solution, result: p.result, howto: p.howto,
            usedBy: Object.entries(usedBy).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([companyId, count]) => ({ companyId, count })),
          },
          comments: allComments().filter((c) => c.postId === p.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
            .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, authorName: c.authorName, companyId: c.companyId, canDelete: !!c.own })),
        };
      }],

      ['POST', /^\/posts$/, (m, body) => {
        const v = readPost(body);
        const p = {
          id: newId(), authorId: getOrCreateAuthor(v.name, v.companyId, v.authorTitle), companyId: v.companyId,
          categoryId: v.categoryId, title: v.title, summary: v.summary, challenge: v.challenge, solution: v.solution,
          result: v.result, howto: v.howto, tags: v.tags, createdAt: now(), updatedAt: now(), likes: [], usages: [], own: true,
        };
        local.posts.push(p);
        save();
        return { id: p.id };
      }],

      ['PUT', /^\/posts\/(\d+)$/, (m, body) => {
        const p = getPost(m[1]);
        if (!p.own) throw new ApiError(403, 'Kortet kan bara ändras från webbläsaren där det skapades.');
        const v = readPost(body);
        Object.assign(p, {
          authorId: getOrCreateAuthor(v.name, v.companyId, v.authorTitle), companyId: v.companyId, categoryId: v.categoryId,
          title: v.title, summary: v.summary, challenge: v.challenge, solution: v.solution, result: v.result,
          howto: v.howto, tags: v.tags, updatedAt: now(),
        });
        pruneAuthors();
        save();
        return { id: p.id };
      }],

      ['DELETE', /^\/posts\/(\d+)$/, (m) => {
        const p = getPost(m[1]);
        if (!p.own) throw new ApiError(403, 'Kortet kan bara tas bort från webbläsaren där det skapades.');
        local.posts = local.posts.filter((x) => x.id !== p.id);
        local.comments = local.comments.filter((c) => c.postId !== p.id);
        delete local.likes[p.id];
        delete local.usages[p.id];
        pruneAuthors();
        save();
        return { ok: true };
      }],

      ['POST', /^\/posts\/(\d+)\/like$/, (m) => {
        const p = getPost(m[1]);
        if (!local.likes[p.id]) local.likes[p.id] = now();
        save();
        return { liked: true, count: likeCount(p) };
      }],
      ['DELETE', /^\/posts\/(\d+)\/like$/, (m) => {
        const p = getPost(m[1]);
        delete local.likes[p.id];
        save();
        return { liked: false, count: likeCount(p) };
      }],

      ['POST', /^\/posts\/(\d+)\/use$/, (m, body) => {
        const p = getPost(m[1]);
        local.usages[p.id] = { companyId: company((body || {}).companyId), createdAt: now() };
        save();
        return { used: true, count: usagesOf(p).length };
      }],
      ['DELETE', /^\/posts\/(\d+)\/use$/, (m) => {
        const p = getPost(m[1]);
        delete local.usages[p.id];
        save();
        return { used: false, count: usagesOf(p).length };
      }],

      ['POST', /^\/posts\/(\d+)\/comments$/, (m, body) => {
        const p = getPost(m[1]);
        const b = body || {};
        const c = {
          id: newId(), postId: p.id,
          authorName: str(b.name, 'Ditt namn', { required: true, min: 2, max: L.name }),
          companyId: company(b.companyId),
          body: str(b.body, 'Kommentar', { required: true, max: L.comment }),
          createdAt: now(), own: true,
        };
        local.comments.push(c);
        save();
        return { id: c.id };
      }],

      ['DELETE', /^\/comments\/(\d+)$/, (m) => {
        const c = allComments().find((x) => x.id === Number(m[1]));
        if (!c) throw new ApiError(404, 'Kommentaren hittades inte.');
        if (!c.own) throw new ApiError(403, 'Kommentaren kan bara tas bort från webbläsaren där den skrevs.');
        local.comments = local.comments.filter((x) => x.id !== c.id);
        save();
        return { ok: true };
      }],

      ['GET', /^\/leaderboard$/, (m, body, query) => {
        const period = ['30', '90', '365'].includes(query.get('period')) ? query.get('period') : 'all';
        const since = sinceDate(period);
        const posts = allPosts();
        const ranked = (datesOf) => posts
          .map((p) => ({ p, score: datesOf(p).filter((d) => d >= since).length }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || b.p.createdAt.localeCompare(a.p.createdAt))
          .slice(0, 10)
          .map(({ p, score }) => {
            const a = authorById(p.authorId);
            return { id: p.id, title: p.title, companyId: p.companyId, categoryId: p.categoryId, author: { id: a.id, name: a.name }, score };
          });
        const recent = posts.filter((p) => p.createdAt >= since);
        const likesFor = (filter) => posts.filter(filter).reduce((n, p) => n + likeCount(p), 0);

        const sharers = {};
        for (const p of recent) sharers[p.authorId] = (sharers[p.authorId] || 0) + 1;
        const topSharers = Object.entries(sharers).map(([id, score]) => {
          const a = authorById(Number(id));
          return { id: a.id, name: a.name, title: a.title, companyId: a.companyId, score, likesReceived: likesFor((p) => p.authorId === a.id) };
        }).sort((a, b) => b.score - a.score || b.likesReceived - a.likesReceived || a.name.localeCompare(b.name, 'sv')).slice(0, 10);

        const comps = {};
        for (const p of recent) {
          comps[p.companyId] = comps[p.companyId] || { score: 0, authors: new Set() };
          comps[p.companyId].score++;
          comps[p.companyId].authors.add(p.authorId);
        }
        const topCompanies = Object.entries(comps).map(([companyId, c]) => ({
          companyId, score: c.score, sharers: c.authors.size, likesReceived: likesFor((p) => p.companyId === companyId),
        })).sort((a, b) => b.score - a.score || b.likesReceived - a.likesReceived);

        return {
          period,
          topPosts: ranked(likeDates),
          topUsed: ranked((p) => usagesOf(p).map((u) => u.createdAt)),
          topSharers,
          topCompanies,
        };
      }],

      ['GET', /^\/authors\/(\d+)$/, (m) => {
        const a = authorById(Number(m[1]));
        if (!a) throw new ApiError(404, 'Personen hittades inte.');
        const mine = allPosts().filter((p) => p.authorId === a.id);
        return {
          author: { id: a.id, name: a.name, title: a.title, companyId: a.companyId },
          stats: {
            posts: mine.length,
            likesReceived: mine.reduce((n, p) => n + likeCount(p), 0),
            usagesReceived: mine.reduce((n, p) => n + usagesOf(p).length, 0),
          },
        };
      }],
    ];

    return async function handle(path, { method = 'GET', body } = {}) {
      const [p, qs = ''] = path.split('?');
      for (const [verb, re, fn] of routes) {
        const m = verb === method && p.match(re);
        if (m) {
          local = load(); // ta hänsyn till ändringar i andra flikar
          // Kopiera svaret så att sidan inte kan ändra i den interna datan av misstag.
          return JSON.parse(JSON.stringify(fn(m, body, new URLSearchParams(qs))));
        }
      }
      throw new ApiError(404, 'Okänt anrop.');
    };
  }

  window.KDStatic = { create };
})();
