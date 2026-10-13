// Fyller en tom databas med exempelinnehåll från alla bolag, inklusive gillningar,
// återanvändningar och kommentarer så att topplistan har innehåll från start.
const { AUTHORS, POSTS, COMMENTS } = require('./seed-data');
const { companyIds } = require('./constants');

// Deterministisk slump så att exempeldatan blir likadan varje gång.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');

function seedExamples(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM posts').get().n > 0) return false;
  const rnd = random(2026);
  const companies = [...companyIds];

  db.exec('BEGIN');
  try {
    const insAuthor = db.prepare('INSERT INTO authors (name, name_key, company_id, title, created_at) VALUES (?, ?, ?, ?, ?)');
    const authorIds = AUTHORS.map(([name, company, title]) =>
      Number(insAuthor.run(name, name.toLowerCase(), company, title, ago(400)).lastInsertRowid)
    );

    const insPost = db.prepare(
      `INSERT INTO posts (author_id, owner_visitor, company_id, category_id, title, summary, challenge, solution, result, howto, tags, created_at, updated_at)
       VALUES (?, 'exempel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insFts = db.prepare('INSERT INTO posts_fts (rowid, title, summary, body, tags, author) VALUES (?, ?, ?, ?, ?, ?)');
    const insLike = db.prepare('INSERT OR IGNORE INTO likes (visitor_id, post_id, created_at) VALUES (?, ?, ?)');
    const insUse = db.prepare('INSERT OR IGNORE INTO usages (visitor_id, post_id, company_id, created_at) VALUES (?, ?, ?, ?)');

    const postIds = POSTS.map(([a, cat, days, likes, uses, title, summary, challenge, solution, result, howto, tags]) => {
      const [name, company] = AUTHORS[a];
      const created = ago(days);
      const id = Number(
        insPost.run(authorIds[a], company, cat, title, summary, challenge, solution, result, howto, tags, created, created).lastInsertRowid
      );
      insFts.run(id, title, summary, [challenge, solution, result, howto].join('\n'), tags, name);
      // Gillningar sprids ut över tiden sedan kortet publicerades, med tyngdpunkt tidigt.
      for (let i = 0; i < likes; i++) {
        insLike.run(`exempel-${i}`, id, ago(days * Math.pow(rnd(), 2)));
      }
      const others = companies.filter((c) => c !== company);
      for (let i = 0; i < uses; i++) {
        insUse.run(`exempel-${i}`, id, others[Math.floor(rnd() * others.length)], ago(days * rnd()));
      }
      return { id, days };
    });

    const insComment = db.prepare(
      `INSERT INTO comments (post_id, owner_visitor, author_name, company_id, body, created_at) VALUES (?, 'exempel', ?, ?, ?, ?)`
    );
    COMMENTS.forEach(([p, name, company, body], i) => {
      insComment.run(postIds[p].id, name, company, body, ago(Math.max(0.1, postIds[p].days - 1 - i * 0.3)));
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return true;
}

module.exports = { seedExamples };

if (require.main === module) {
  const { openDb, defaultDbPath } = require('./db');
  const done = seedExamples(openDb(defaultDbPath()));
  console.log(done ? `Exempelinnehåll skapat: ${POSTS.length} kort från ${AUTHORS.length} personer.` : 'Databasen innehåller redan kort – inget ändrat.');
}
