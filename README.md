# Kunskapsdelning – Länsförsäkringsgruppen

En öppen webbplattform där alla medarbetare i de 23 länsförsäkringsbolagen och Länsförsäkringar AB kan **dela goda erfarenheter**, **hitta andras**, **förstå och använda dem** – och **gilla** det som är bra.

Ingen inloggning behövs. Man skriver bara sitt namn och väljer bolag när man lämnar in sitt kort.

## Vad plattformen kan

| Funktion | Beskrivning |
|---|---|
| **Dela ett kort** | Namn, bolag och (valfritt) roll, sedan rubrik, kort sammanfattning, område, taggar och fyra rubriker som gör idén lätt att förstå och återanvända: *Utmaning*, *Vad vi gjorde*, *Resultat*, *Så kan ni göra*. Namn och bolag kommer ihåg till nästa gång. |
| **Hitta** | Fritextsök (även på namn, tål saknade å/ä/ö och halva ord), filter på bolag, område och taggar, sortering på senaste / mest gillade / mest använda / mest diskuterade. |
| **Gilla** | Ett klick. Man kan gilla ett kort en gång per webbläsare. |
| **"Vi använder detta"** | Markera att ditt bolag har provat idén – då syns det på kortet vilka bolag som återanvänder kunskapen. |
| **Frågor & kommentarer** | Ställ frågor direkt under kortet. |
| **Topplista** | Mest gillade kunskapsdelningar, personer med flest delningar, mest återanvända kort och bolag som delar mest – för hela tiden, senaste året, 90 eller 30 dagar. |
| **Personsida** | Klicka på ett namn för att se allt personen har delat. Samma namn + bolag räknas som samma person. |
| **Ändra / ta bort** | Den som skapat ett kort kan ändra och ta bort det från samma webbläsare. Administratörer kan ta bort olämpligt innehåll (se *Moderering*). |
| **Exempelinnehåll** | En tom plattform fylls automatiskt med 43 exempelkort från alla 24 bolag, med gillningar, kommentarer och fylld topplista. |

Utseendet följer Länsförsäkringars grafiska manér: LF-blå (#005AA0), vitt och ljusgrått, röd accent (#E30613), seriffrubriker och rundade knappar. Om typsnitten *LF Rubrik* och *Intro Cond* finns installerade på datorn används de, annars Georgia och Arial.

Fungerar i dator och mobil. Allt är på svenska.

---

## Prova på din egen dator (steg för steg)

Du behöver bara installera ett program: **Node.js**.

1. **Installera Node.js** (version 22.13 eller senare)
   Gå till <https://nodejs.org>, ladda ner versionen märkt **LTS** och installera med standardinställningarna.

2. **Ladda ner koden**
   På GitHub-sidan för projektet: klicka på den gröna knappen **Code** → **Download ZIP**. Packa upp zip-filen, t.ex. på skrivbordet.

3. **Öppna en terminal i mappen**
   - **Windows:** öppna den uppackade mappen i Utforskaren, klicka i adressfältet, skriv `cmd` och tryck Enter.
   - **Mac:** högerklicka på mappen i Finder → **Tjänster** → **Ny terminal vid mapp**.

4. **Installera och starta** – skriv dessa två rader, tryck Enter efter varje:
   ```
   npm install
   npm start
   ```

5. **Öppna** <http://localhost:3000> i webbläsaren. Klart!

För att stänga av: gå till terminalen och tryck `Ctrl + C`.

> Allt sparas i filen `data/kunskapsdelning.db`. Vill du börja om från början: stäng av, radera mappen `data` och starta igen – då läggs exempelkorten in på nytt.

---

## Inställningar

Inställningar ges som miljövariabler (i Azure: *Configuration → Application settings*).

| Inställning | Exempel | Betydelse |
|---|---|---|
| `SEED_EXAMPLES` | `false` | Sätt till `false` om en tom plattform **inte** ska fyllas med exempelkort. |
| `ADMIN_KEY` | en lång slumpad text | Nyckel för moderering (se nedan). Utan nyckel finns ingen administratör. |
| `PORT` | `3000` | Port som webbservern lyssnar på. |
| `DB_PATH` | `/data/kunskapsdelning.db` | Var databasfilen sparas. Ska ligga på en disk som säkerhetskopieras. |

## Moderering

1. IT sätter inställningen `ADMIN_KEY` till en lång hemlig text.
2. Moderatorn går till `/#/admin` på plattformen, klistrar in nyckeln och klickar **Aktivera**.
3. Nu visas **Ta bort** på alla kort och kommentarer i den webbläsaren.

## Bra att veta om att ha plattformen utan inloggning

- Den som skapat ett kort kan ändra det **från samma webbläsare**. Byter man dator eller rensar webbläsaren kan en administratör hjälpa till.
- En gillning per kort och webbläsare. Den som verkligen vill fuska kan rensa webbläsaren och gilla igen – för en intern plattform brukar det inte vara ett problem.
- Det finns en spärr mot spam (högst 30 inlägg/gillningar per minut och webbläsare).
- Plattformen bör ligga på **intranätet** eller bakom företagets nätverk så att bara medarbetare når den.

---

## Sätta i drift för alla 10 000 medarbetare

Lämna detta till IT-drift / plattformsteamet. Rekommenderat upplägg:

1. **Bygg containern** med medföljande `Dockerfile` (`docker build -t kunskapsdelning .`) och lägg den i företagets container-register.
2. **Kör den** i t.ex. Azure App Service (Linux, container) eller motsvarande intern plattform, åtkomlig från intranätet. En liten instans räcker gott för 10 000 användare.
3. **Montera en beständig disk** på `/data` (t.ex. Azure Files) och säkerhetskopiera den.
4. **Sätt `ADMIN_KEY`** och ge nyckeln till de som ska moderera.
5. Bestäm om exempelkorten ska finnas med vid lansering. Om inte: sätt `SEED_EXAMPLES=false` innan första start.

Databasen är SQLite, som klarar den här belastningen utan problem (kunskapsdelning är mest läsning). Om ni senare vill köra flera servrar parallellt behöver databasen bytas till t.ex. PostgreSQL.

---

## För utvecklare

```
npm install
npm test        # kör automatiska tester
npm start       # startar servern på http://localhost:3000
npm run seed    # lägger in exempelkort i en tom databas
```

**Teknik:** Node.js 22 + Express 5, inbyggd SQLite (`node:sqlite`) med FTS5-fritextsök. Gränssnittet är ren HTML/CSS/JavaScript utan byggsteg.

```
server/
  index.js      start, läser inställningar, lägger in exempelkort i tom databas
  app.js        API: kort, gilla, använd, kommentarer, topplista, personer
  db.js         databasschema
  constants.js  bolag och områden (ändra här för att lägga till/byta namn)
  seed.js       logik för exempelinnehåll
  seed-data.js  själva exempelkorten (texter, personer, kommentarer)
public/         webbgränssnittet (index.html, app.js, styles.css)
test/           automatiska tester
```

**Säkerhet:** all text escapas innan den visas (skydd mot XSS), databasfrågor är parametriserade, ändrande anrop kräver en egen header (CSRF-skydd), strikt Content-Security-Policy, spärr mot för många skrivningar.
