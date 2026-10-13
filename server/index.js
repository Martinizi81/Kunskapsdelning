const { openDb, defaultDbPath } = require('./db');
const { createApp } = require('./app');

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const authMode = process.env.AUTH_MODE === 'easyauth' ? 'easyauth' : 'demo';
const db = openDb(defaultDbPath());
const app = createApp({
  db,
  authMode,
  adminEmails: list(process.env.ADMIN_EMAILS),
  allowedDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Kunskapsdelning körs på http://localhost:${port}  (inloggning: ${authMode})`);
});
