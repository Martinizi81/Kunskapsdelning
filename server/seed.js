// Fyller databasen med exempeldata så att plattformen går att prova direkt.
// Körs bara om databasen är tom. Använd inte i produktion.
const { openDb, defaultDbPath } = require('./db');

const db = openDb(defaultDbPath());
if (db.prepare('SELECT COUNT(*) AS n FROM posts').get().n > 0) {
  console.log('Databasen innehåller redan förslag – hoppar över exempeldata.');
  process.exit(0);
}

const users = [
  ['anna.lindqvist@exempel.lansforsakringar.se', 'Anna Lindqvist', 'skane', 'Skadereglerare'],
  ['erik.johansson@exempel.lansforsakringar.se', 'Erik Johansson', 'stockholm', 'Kundrådgivare bank'],
  ['sara.nilsson@exempel.lansforsakringar.se', 'Sara Nilsson', 'norrbotten', 'Teamledare kundcenter'],
  ['mohammed.ali@exempel.lansforsakringar.se', 'Mohammed Ali', 'goteborg-bohuslan', 'Verksamhetsutvecklare'],
  ['karin.berg@exempel.lansforsakringar.se', 'Karin Berg', 'dalarna', 'HR-partner'],
  ['johan.ek@exempel.lansforsakringar.se', 'Johan Ek', 'lf-ab', 'Hållbarhetsspecialist'],
  ['lina.holm@exempel.lansforsakringar.se', 'Lina Holm', 'jonkoping', 'Säljchef företag'],
  ['oskar.str@exempel.lansforsakringar.se', 'Oskar Strand', 'vasterbotten', 'Skadeförebyggare'],
];

const posts = [
  [0, 'skada', 'Videobesiktning halverade ledtiden för vattenskador',
    'Vi låter kunden visa skadan via videosamtal i stället för att alltid skicka ut en besiktningsman. Ledtiden för enklare vattenskador gick från 9 till 4 dagar.',
    'Långa väntetider på besiktning vid enklare vattenskador gav missnöjda kunder och höga kostnader för resor.',
    'Vi införde ett enkelt videosamtal via mobilen. Skadereglerare bokar en tid inom 24 timmar, kunden visar skadan och vi fattar beslut direkt i samtalet om det är möjligt.',
    'Ledtid 9 → 4 dagar, NKI +6 och 30 % färre fysiska besök.',
    '1. Börja med en skadetyp (t.ex. vattenskada i kök).\n2. Ta fram ett kort manus för samtalet.\n3. Utbilda 3–4 handläggare som piloter.\n4. Kontakta mig gärna så delar jag manus och checklista.',
    'video,besiktning,vattenskada,kundupplevelse'],
  [1, 'bank', 'Bolånemöte på 30 minuter med förberedande checklista',
    'Genom att skicka en tydlig checklista till kunden innan mötet blev bolånemötena kortare och kunderna mer förberedda.',
    'Många bolånemöten blev långa och krävde uppföljning eftersom underlag saknades.',
    'Kunden får ett sms och mejl två dagar innan med en checklista och en länk där underlag kan laddas upp.',
    'Snittlängd på möten 55 → 32 minuter, färre uppföljande möten.',
    'Mallen för sms och mejl finns att få – hör av dig!',
    'bolån,mötesteknik,checklista'],
  [2, 'kund', 'Morgonpuls på 10 minuter i kundcenter',
    'En kort stående avstämning varje morgon där vi går igenom dagens prognos, gårdagens lärdomar och ett kundcase.',
    'Vi saknade ett gemensamt sätt att dela lärdomar mellan skiften.',
    'Varje morgon kl 08.05 samlas teamet i 10 minuter vid en tavla. Vi roterar vem som leder.',
    'Medarbetarna upplever bättre koll och vi löser fler ärenden vid första kontakt.',
    'Använd en fysisk eller digital tavla med tre kolumner: Prognos, Lärdom, Kundcase.',
    'teammöte,kundcenter,förstakontaktslösning'],
  [3, 'process', 'Automatiserad sortering av inkommande skadeanmälningar',
    'En enkel regelmotor sorterar inkomna digitala skadeanmälningar till rätt team, vilket sparar ca 2 timmar per dag.',
    'Manuell sortering av anmälningar tog tid och gav ibland felaktiga köer.',
    'Vi kartlade de vanligaste skadetyperna och byggde regler på skadetyp, belopp och postnummer.',
    'Ca 2 timmar sparad tid per dag och färre felsorterade ärenden.',
    'Börja med att logga hur ni sorterar idag under två veckor – då ser ni vilka regler som täcker flest fall.',
    'automatisering,skadeanmälan,effektivisering'],
  [4, 'ledarskap', 'Introduktionsbuddy för nyanställda',
    'Varje nyanställd får en buddy från ett annat team under de första 90 dagarna. Det har gett snabbare inskolning och starkare gemenskap.',
    '',
    'Buddyn träffar den nyanställda varje vecka första månaden och därefter varannan vecka. Vi har en enkel guide med samtalsämnen.',
    'Nyanställda uppger högre trivsel och vi ser lägre tidig personalomsättning.',
    'Guiden och samtalsmallen kan jag dela.',
    'onboarding,introduktion,medarbetare'],
  [5, 'hallbarhet', 'Återbruk av byggmaterial vid skadereparationer',
    'Tillsammans med våra entreprenörer prioriterar vi reparation och återbruk före utbyte vid skador, vilket minskar både klimatavtryck och kostnad.',
    'Vid många skador byttes hela delar ut trots att reparation var möjlig.',
    'Vi lade in krav och uppföljning i avtalen med entreprenörer samt införde en fråga om återbruk i skadeprocessen.',
    'Minskade CO2-utsläpp och lägre skadekostnader per ärende.',
    'Starta med en entreprenör och en skadetyp, mät och följ upp.',
    'återbruk,klimat,entreprenörer'],
  [6, 'kund', 'Gemensam företagskundsträff med lokala näringslivet',
    'Vi bjuder in lokala företagskunder till frukostseminarium om riskhantering. Det ger nya affärer och stärker relationen.',
    '',
    'Fyra gånger per år med ett aktuellt tema, t.ex. brandskydd eller cybersäkerhet. Vi samarbetar med kommunen.',
    'Flera nya företagskunder per träff och mycket goda betyg.',
    'Välj ett tema som är aktuellt lokalt och be en kund berätta om sina erfarenheter.',
    'företag,event,riskhantering'],
  [7, 'skada', 'Förebyggande sms inför köldknäppar',
    'Vi skickar sms till villakunder när temperaturen väntas falla kraftigt, med tips för att undvika frysta rör. Antalet frysskador minskade märkbart.',
    'Varje vinter får vi många skador på grund av frysta vattenledningar.',
    'Vi kopplade SMHI:s prognoser till ett utskick som triggas vid under −20 grader.',
    'Färre frysskador jämfört med tidigare vintrar med liknande väder.',
    'Ta fram tre korta tips och en tröskel för när sms skickas. Hör av dig för texter.',
    'skadeförebyggande,sms,villa,vinter'],
];

db.exec('BEGIN');
const insUser = db.prepare('INSERT INTO users (email, name, company_id, title) VALUES (?, ?, ?, ?)');
const ids = users.map((u) => Number(insUser.run(...u).lastInsertRowid));
const insPost = db.prepare(`INSERT INTO posts (user_id, company_id, category_id, title, summary, challenge, solution, result, howto, tags, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`);
const insFts = db.prepare('INSERT INTO posts_fts (rowid, title, summary, body, tags) VALUES (?, ?, ?, ?, ?)');
const postIds = posts.map(([ui, cat, title, summary, challenge, solution, result, howto, tags], i) => {
  const age = `-${(posts.length - i) * 3} days`;
  const id = Number(insPost.run(ids[ui], users[ui][2], cat, title, summary, challenge, solution, result, howto, tags, age, age).lastInsertRowid);
  insFts.run(id, title, summary, [challenge, solution, result, howto].join('\n'), tags);
  return id;
});
const like = db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)');
const use = db.prepare('INSERT OR IGNORE INTO usages (user_id, post_id) VALUES (?, ?)');
postIds.forEach((pid, i) => {
  ids.forEach((uid, j) => {
    if ((i * 3 + j * 5) % 7 < 4 - (i % 3)) like.run(uid, pid);
    if ((i + j) % 5 === 0 && j !== posts[i][0]) use.run(uid, pid);
  });
});
db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').run(
  postIds[0], ids[2], 'Vi har testat detta i Norrbotten sedan i våras – fungerar mycket bra! Tack för tipset.'
);
db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').run(
  postIds[7], ids[3], 'Smart! Vilken leverantör använder ni för sms-utskicken?'
);
db.exec('COMMIT');
console.log(`Exempeldata skapad: ${users.length} användare och ${posts.length} förslag.`);
