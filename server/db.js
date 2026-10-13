const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL,
  category_id TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  challenge   TEXT NOT NULL DEFAULT '',
  solution    TEXT NOT NULL DEFAULT '',
  result      TEXT NOT NULL DEFAULT '',
  howto       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_company ON posts(company_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

CREATE TABLE IF NOT EXISTS likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

-- "Vi använder detta" – visar att kunskapen faktiskt återanvänds i ett annat bolag.
CREATE TABLE IF NOT EXISTS usages (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_usages_post ON usages(post_id);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- Fritextsök. rowid = posts.id. Åäö matchas även utan prickar (remove_diacritics).
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, summary, body, tags,
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
