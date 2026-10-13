const { openDb, defaultDbPath } = require('./db');
const { createApp } = require('./app');
const { seedExamples } = require('./seed');

const db = openDb(defaultDbPath());

// Tom databas fylls med exempelkort så att plattformen inte ser tom ut. Stängs av med SEED_EXAMPLES=false.
if (process.env.SEED_EXAMPLES !== 'false' && seedExamples(db)) {
  console.log('Databasen var tom – exempelkort har lagts in.');
}

const app = createApp({ db, adminKey: process.env.ADMIN_KEY || '' });

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Kunskapsdelning körs på http://localhost:${port}`);
});
