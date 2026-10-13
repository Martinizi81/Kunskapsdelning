// Bygger en fristående webbplats (för t.ex. GitHub Pages) i mappen dist/.
// Exempelkorten exporteras till dist/data.json och webbläsaren kör API:t själv (public/static-api.js).
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../server/db');
const { seedExamples } = require('../server/seed');
const { COMPANIES, CATEGORIES } = require('../server/constants');
const { LIMITS } = require('../server/app');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');

const db = openDb(':memory:');
seedExamples(db);
const all = (sql) => db.prepare(sql).all();

const likes = {};
for (const l of all('SELECT post_id, created_at FROM likes')) (likes[l.post_id] ||= []).push(l.created_at);
const usages = {};
for (const u of all('SELECT post_id, company_id, created_at FROM usages')) (usages[u.post_id] ||= []).push({ companyId: u.company_id, createdAt: u.created_at });

const data = {
  generatedAt: new Date().toISOString(),
  companies: COMPANIES,
  categories: CATEGORIES,
  limits: LIMITS,
  authors: all('SELECT id, name, title, company_id FROM authors').map((a) => ({ id: a.id, name: a.name, title: a.title, companyId: a.company_id })),
  posts: all('SELECT * FROM posts').map((p) => ({
    id: p.id, authorId: p.author_id, companyId: p.company_id, categoryId: p.category_id, title: p.title, summary: p.summary,
    challenge: p.challenge, solution: p.solution, result: p.result, howto: p.howto, tags: p.tags ? p.tags.split(',') : [],
    createdAt: p.created_at, updatedAt: p.updated_at, likes: likes[p.id] || [], usages: usages[p.id] || [],
  })),
  comments: all('SELECT * FROM comments').map((c) => ({
    id: c.id, postId: c.post_id, authorName: c.author_name, companyId: c.company_id, body: c.body, createdAt: c.created_at,
  })),
};

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Webbplatsen är byggd i dist/ (${data.posts.length} kort).`);
