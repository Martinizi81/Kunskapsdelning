# Kunskapsdelning – Länsförsäkringsgruppen

En öppen webbplattform där alla medarbetare i de 23 länsförsäkringsbolagen och Länsförsäkringar AB kan **dela goda erfarenheter**, **hitta andras**, **förstå och använda dem** – och **gilla** det som är bra.

## Vad plattformen kan

| Funktion | Beskrivning |
|---|---|
| **Dela en erfarenhet** | Ett enkelt formulär med rubrik, kort sammanfattning, område, taggar och fyra rubriker som gör det lätt att förstå och återanvända: *Utmaning*, *Vad vi gjorde*, *Resultat*, *Så kan ni göra*. |
| **Hitta** | Fritextsök (tål stavning utan å/ä/ö och halva ord, t.ex. "bolan" hittar "bolån"), filter på bolag, område och taggar, sortering på senaste / mest gillade / mest använda / mest diskuterade. |
| **Gilla** | Ett klick. Varje person kan gilla ett förslag en gång. |
| **"Vi använder detta"** | Markera att ditt bolag har provat idén – då syns vilka bolag som återanvänder kunskapen. |
| **Frågor & kommentarer** | Ställ frågor direkt under förslaget, eller mejla den som delade. |
| **Topplista** | Mest gillade förslag, personer med flest delningar, mest återanvända förslag och bolag som delar mest – för hela tiden, senaste året, 90 eller 30 dagar. |
| **Profiler** | Se vad en kollega har delat och hur mycket det uppskattats. |
| **Redigera / ta bort** | Den som delat kan ändra och ta bort sitt. Administratörer kan ta bort olämpligt innehåll. |

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
   npm run demo
   ```
   `npm run demo` lägger in några exempelförslag och startar plattformen.

5. **Öppna** <http://localhost:3000> i webbläsaren. Klart!

För att stänga av: gå till terminalen och tryck `Ctrl + C`. Nästa gång räcker det med `npm start`.

> Allt som delas sparas i filen `data/kunskapsdelning.db`. Vill du börja om från noll: stäng av, radera mappen `data` och starta igen.

---

## Inloggning

Plattformen har två lägen, som väljs med inställningen `AUTH_MODE`:

| Läge | När | Hur det fungerar |
|---|---|---|
| `demo` (standard) | Test och utvärdering | Man skriver in namn, jobbmejl och bolag. **Inget lösenord** – använd inte i skarp drift. |
| `easyauth` | Skarp drift | Plattformen läggs bakom företagets inloggning (Microsoft Entra ID / Azure AD) via Azure App Services inbyggda inloggning ("Easy Auth"). Medarbetaren loggas in automatiskt med sitt vanliga jobbkonto och får vid första besöket välja sitt bolag. |

> **Viktigt:** `easyauth` får bara användas när plattformen ligger bakom Azure App Services inloggning (eller en proxy som gör samma sak), eftersom användarens identitet då läses från headern `X-MS-CLIENT-PRINCIPAL-NAME` som inloggningstjänsten sätter.

## Inställningar

Inställningar ges som miljövariabler (i Azure: *Configuration → Application settings*).

| Inställning | Exempel | Betydelse |
|---|---|---|
| `AUTH_MODE` | `easyauth` | Se ovan. |
| `ALLOWED_EMAIL_DOMAINS` | `lansforsakringar.se` | Bara dessa e-postdomäner (och deras underdomäner) får logga in. Flera separeras med komma. Tomt = alla. |
| `ADMIN_EMAILS` | `anna.a@lansforsakringar.se,erik.e@lansforsakringar.se` | Administratörer som får ta bort andras inlägg och kommentarer. |
| `PORT` | `3000` | Port som webbservern lyssnar på. |
| `DB_PATH` | `/data/kunskapsdelning.db` | Var databasfilen sparas. Ska ligga på en disk som säkerhetskopieras. |

---

## Sätta i drift för alla 10 000 medarbetare

Lämna detta till IT-drift / plattformsteamet. Rekommenderat upplägg:

1. **Bygg containern** med medföljande `Dockerfile` (`docker build -t kunskapsdelning .`) och lägg den i företagets container-register.
2. **Kör den i Azure App Service (Linux, container)** – eller motsvarande intern plattform. En liten instans räcker gott för 10 000 användare.
3. **Montera en beständig disk** på `/data` (t.ex. Azure Files) och säkerhetskopiera den.
4. **Slå på inloggning:** App Service → *Authentication* → *Add identity provider* → **Microsoft**, välj "Require authentication". Sätt `AUTH_MODE=easyauth` och `ALLOWED_EMAIL_DOMAINS`.
5. **Sätt `ADMIN_EMAILS`** till de personer som ska moderera.
6. Kör **inte** `npm run demo`/`npm run seed` i drift – då läggs exempeldata in.

Databasen är SQLite, som klarar den här belastningen utan problem (kunskapsdelning är mest läsning). Om ni senare vill köra flera servrar parallellt behöver databasen bytas till t.ex. PostgreSQL.

---

## För utvecklare

```
npm install
npm test        # kör automatiska tester
npm start       # startar servern på http://localhost:3000
```

**Teknik:** Node.js 22 + Express 5, inbyggd SQLite (`node:sqlite`) med FTS5-fritextsök. Gränssnittet är ren HTML/CSS/JavaScript utan byggsteg.

```
server/
  index.js      start, läser inställningar
  app.js        API: inloggning, förslag, gilla, använd, kommentarer, topplista, profiler
  db.js         databasschema
  constants.js  bolag och områden (ändra här för att lägga till/byta namn)
  seed.js       exempeldata
public/         webbgränssnittet (index.html, app.js, styles.css)
test/           automatiska tester
```

**Säkerhet:** all text escapas innan den visas (skydd mot XSS), databasfrågor är parametriserade, ändrande anrop kräver en egen header (CSRF-skydd), strikt Content-Security-Policy, sessionscookies är `HttpOnly` och `SameSite=Lax`.
