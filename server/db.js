const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
-- En "delare" är bara ett namn + bolag som anges på kortet. Ingen inloggning.
CREATE TABLE IF NOT EXISTS authors (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name_key, company_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY,
  author_id     INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  owner_visitor TEXT NOT NULL DEFAULT '',
  company_id    TEXT NOT NULL,
  category_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  challenge     TEXT NOT NULL DEFAULT '',
  solution      TEXT NOT NULL DEFAULT '',
  result        TEXT NOT NULL DEFAULT '',
  howto         TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_company ON posts(company_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

-- Gillningar knyts till webbläsaren (anonym besökar-id i cookie), en per kort.
CREATE TABLE IF NOT EXISTS likes (
  visitor_id  TEXT NOT NULL,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (visitor_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

-- "Vi använder detta" – visar att kunskapen återanvänds i ett annat bolag.
CREATE TABLE IF NOT EXISTS usages (
  visitor_id  TEXT NOT NULL,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (visitor_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_usages_post ON usages(post_id);

CREATE TABLE IF NOT EXISTS comments (
  id            INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  owner_visitor TEXT NOT NULL DEFAULT '',
  author_name   TEXT NOT NULL,
  company_id    TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- Fritextsök. rowid = posts.id. Åäö matchas även utan prickar (remove_diacritics).
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, summary, body, tags, author,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

function defaultDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kunskapsdelning.db');
}

module.exports = { openDb, defaultDbPath };
