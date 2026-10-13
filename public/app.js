'use strict';

// ---------- Hjälpfunktioner ----------

const state = { meta: { companies: [], categories: [], limits: {} } };
const $main = document.getElementById('main');

// Namn, bolag och roll kommer ihåg i webbläsaren så att man slipper skriva dem varje gång.
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privat läge – ignorera */ }
  },
};
const profile = () => store.get('kd_profile', { name: '', companyId: '', title: '' });
const saveProfile = (p) => store.set('kd_profile', { ...profile(), ...p });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const companyName = (id) => (state.meta.companies.find((c) => c.id === id) || {}).name || id;
const shortCompany = (id) => companyName(id).replace(/^Länsförsäkringar /, '');
const categoryName = (id) => (state.meta.categories.find((c) => c.id === id) || {}).name || id;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function fmtDate(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Med server anropas /api. På GitHub Pages (ingen server) körs samma API i webbläsaren, se static-api.js.
let staticApi = null;

async function api(path, { method = 'GET', body } = {}) {
  if (staticApi) return staticApi(path, { method, body: body && JSON.parse(JSON.stringify(body)) });
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'kunskapsdelning' };
  const adminKey = store.get('kd_admin', '');
  if (adminKey) headers['X-Admin-Key'] = adminKey;
  const res = await fetch(`api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Något gick fel.');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function detectMode() {
  try {
    const res = await fetch('api/meta', { headers: { Accept: 'application/json' } });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) return;
  } catch { /* ingen server */ }
  const res = await fetch('data.json');
  if (!res.ok) throw new Error('Kunde inte ladda innehållet.');
  staticApi = window.KDStatic.create(await res.json());
  const banner = document.getElementById('demo-banner');
  banner.innerHTML = '<div class="wrap"><b>Demoversion.</b> Exempelkorten är påhittade. Det du själv delar, gillar och kommenterar sparas bara i din egen webbläsare.</div>';
  banner.hidden = false;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function options(list, selected, placeholder) {
  return (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
    list.map((o) => `<option value="${esc(o.id)}"${o.id === selected ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
}

function go(hash) { location.hash = hash; }

function showError(form, err) {
  const box = form.querySelector('.error');
  box.textContent = err.message;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Frågar vilket bolag man tillhör (används för "Vi använder detta" om vi inte redan vet).
function askCompany() {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <form class="card modal" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <h2 id="ask-title">Vilket bolag använder idén?</h2>
        <p class="muted">Då syns det på kortet att kunskapen sprids i gruppen.</p>
        <div class="field"><label for="ask-company">Bolag</label>
          <select id="ask-company" required>${options(state.meta.companies, profile().companyId, 'Välj bolag…')}</select></div>
        <div class="actions"><button class="btn btn-primary" type="submit">Spara</button><button class="btn" type="button" data-close>Avbryt</button></div>
      </form>`;
    document.body.appendChild(bg);
    const close = (v) => { bg.remove(); resolve(v); };
    bg.querySelector('[data-close]').onclick = () => close(null);
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    bg.querySelector('select').focus();
    bg.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const companyId = bg.querySelector('select').value;
      saveProfile({ companyId });
      close(companyId);
    };
  });
}

// ---------- Komponenter ----------

function postCard(p) {
  return `<article class="card post-card">
    <div class="meta"><a class="chip" href="#/utforska?category=${esc(p.categoryId)}">${esc(categoryName(p.categoryId))}</a>
      <a class="chip chip-company" href="#/utforska?company=${esc(p.companyId)}">${esc(shortCompany(p.companyId))}</a></div>
    <h3><a href="#/kort/${p.id}">${esc(p.title)}</a></h3>
    <p class="muted">${esc(p.summary)}</p>
    ${p.tags.length ? `<div class="meta">${p.tags.map((t) => `<a class="tag" href="#/utforska?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(' ')}</div>` : ''}
    <div class="meta byline"><a href="#/person/${p.author.id}">${esc(p.author.name)}</a> · ${fmtDate(p.createdAt)}</div>
    <div class="counts">
      <span title="Gillningar"><span class="heart">${p.liked ? '♥' : '♡'}</span> ${p.likeCount}</span>
      <span title="Antal som använder idén">✓ ${p.usageCount} använder</span>
      <span title="Kommentarer">💬 ${p.commentCount}</span>
    </div>
  </article>`;
}

function postGrid(posts, emptyText = 'Inga kort hittades.') {
  if (!posts.length) return `<div class="card empty">${emptyText}</div>`;
  return `<div class="grid grid-3">${posts.map(postCard).join('')}</div>`;
}

function setNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

// ---------- Sidor ----------

async function pageHome() {
  setNav('home');
  const [stats, latest, popular] = await Promise.all([api('/stats'), api('/posts?sort=new'), api('/posts?sort=likes')]);
  $main.innerHTML = `
    <section class="hero">
      <div>
        <h1>Det du redan vet kan lösa någon annans problem</h1>
        <p>Dela goda erfarenheter mellan de 23 länsförsäkringsbolagen och Länsförsäkringar AB. Hitta lösningar som redan fungerar – och gilla det som inspirerar dig.</p>
        <a class="btn btn-white" href="#/dela">Dela en erfarenhet</a>
        <a class="btn btn-ghost" href="#/utforska">Utforska alla kort</a>
        <form class="searchbar" id="hero-search" role="search">
          <input name="q" placeholder="Sök t.ex. kundevent, lönerevision eller glasskada" aria-label="Sök bland kort">
          <button class="btn btn-white" type="submit">Sök</button>
        </form>
      </div>
      <div class="stats">
        <div class="stat"><b>${stats.posts}</b>delade erfarenheter</div>
        <div class="stat"><b>${stats.companies}</b>bolag har delat</div>
        <div class="stat"><b>${stats.likes}</b>gillningar</div>
        <div class="stat"><b>${stats.usages}</b>gånger återanvänt</div>
      </div>
    </section>

    <div class="section-head"><h2>Så fungerar det</h2></div>
    <div class="grid grid-3">
      <div class="card step"><span class="step-num">1</span><h3>Dela</h3><p class="muted">Skriv ett kort: vad ni gjorde, vad det gav och hur andra kan göra likadant. Ingen inloggning – bara ditt namn och bolag.</p></div>
      <div class="card step"><span class="step-num">2</span><h3>Hitta</h3><p class="muted">Sök fritt eller filtrera på bolag, område och taggar. Allt är öppet för alla i gruppen.</p></div>
      <div class="card step"><span class="step-num">3</span><h3>Använd & gilla</h3><p class="muted">Gilla det som är bra, markera när ni använder en idé och ställ frågor direkt till den som delade.</p></div>
    </div>

    <div class="section-head"><h2>Mest gillade</h2><a href="#/topplista">Se hela topplistan →</a></div>
    ${postGrid(popular.posts.slice(0, 3), 'Inga gillningar ännu – bli först!')}

    <div class="section-head"><h2>Senast delat</h2><a href="#/utforska">Visa alla →</a></div>
    ${postGrid(latest.posts.slice(0, 6), 'Här är det tomt än så länge. <a href="#/dela">Dela den första erfarenheten!</a>')}
  `;
  document.getElementById('hero-search').onsubmit = (e) => {
    e.preventDefault();
    go(`#/utforska?q=${encodeURIComponent(e.target.q.value.trim())}`);
  };
}

async function pageExplore(params) {
  setNav('explore');
  const f = {
    q: params.get('q') || '',
    company: params.get('company') || '',
    category: params.get('category') || '',
    tag: params.get('tag') || '',
    sort: params.get('sort') || '',
    page: params.get('page') || '',
  };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const data = await api(`/posts?${qs}`);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const link = (changes) => `#/utforska?${new URLSearchParams(Object.entries({ ...f, ...changes }).filter(([, v]) => v))}`;
  const sorts = [['', f.q ? 'Mest relevant' : 'Senaste'], ...(f.q ? [['new', 'Senaste']] : []),
    ['likes', 'Mest gillade'], ['used', 'Mest använda'], ['comments', 'Mest diskuterade']];

  $main.innerHTML = `
    <h1>Utforska erfarenheter</h1>
    <form class="filters" id="filters" role="search">
      <input class="f-q" name="q" value="${esc(f.q)}" placeholder="Sök på ord, namn eller tagg…" aria-label="Sök">
      <select name="company" aria-label="Bolag">${options(state.meta.companies, f.company, 'Alla bolag')}</select>
      <select name="category" aria-label="Område">${options(state.meta.categories, f.category, 'Alla områden')}</select>
      <select name="sort" aria-label="Sortering">${sorts.map(([v, n]) => `<option value="${v}"${v === f.sort ? ' selected' : ''}>${n}</option>`).join('')}</select>
    </form>
    ${f.tag ? `<p class="active-filter">Visar taggen <b>#${esc(f.tag)}</b> · <a href="${link({ tag: '', page: '' })}">ta bort</a></p>` : ''}
    <p class="muted">${plural(data.total, 'erfarenhet', 'erfarenheter')}</p>
    ${postGrid(data.posts, f.q || f.company || f.category || f.tag
      ? 'Inga träffar. Prova andra sökord eller ta bort ett filter.'
      : 'Inga kort ännu. <a href="#/dela">Dela det första!</a>')}
    ${pages > 1 ? `<nav class="pager" aria-label="Sidor">
      ${data.page > 1 ? `<a class="btn btn-sm" href="${link({ page: data.page - 1 })}">← Föregående</a>` : ''}
      <span class="muted">Sida ${data.page} av ${pages}</span>
      ${data.page < pages ? `<a class="btn btn-sm" href="${link({ page: data.page + 1 })}">Nästa →</a>` : ''}
    </nav>` : ''}
  `;
  const form = document.getElementById('filters');
  const apply = () => {
    const fd = new FormData(form);
    go(link({ q: fd.get('q').trim(), company: fd.get('company'), category: fd.get('category'), sort: fd.get('sort'), page: '' }));
  };
  form.onsubmit = (e) => { e.preventDefault(); apply(); };
  form.querySelectorAll('select').forEach((s) => (s.onchange = apply));
}

function section(title, text) {
  return text ? `<h2>${esc(title)}</h2><div class="prose">${esc(text)}</div>` : '';
}

const likeLabel = (on, n) => `${on ? '♥ Gillad' : '♡ Gilla'} · ${n}`;
const useLabel = (on, n) => `${on ? '✓ Vi använder detta' : 'Vi använder detta'} · ${n}`;

async function pagePost(id) {
  setNav('');
  const { post: p, comments } = await api(`/posts/${id}`);
  const me = profile();
  document.title = `${p.title} – Kunskapsdelning`;
  $main.innerHTML = `
    <a class="backlink" href="#/utforska">← Alla erfarenheter</a>
    <div class="detail">
      <article class="card">
        <div class="meta"><a class="chip" href="#/utforska?category=${esc(p.categoryId)}">${esc(categoryName(p.categoryId))}</a>
          <a class="chip chip-company" href="#/utforska?company=${esc(p.companyId)}">${esc(companyName(p.companyId))}</a></div>
        <h1 class="mt">${esc(p.title)}</h1>
        <p class="lead">${esc(p.summary)}</p>
        <div class="actions">
          <button class="btn btn-like${p.liked ? ' on' : ''}" id="like" aria-pressed="${p.liked}">${likeLabel(p.liked, p.likeCount)}</button>
          <button class="btn btn-use${p.used ? ' on' : ''}" id="use" aria-pressed="${p.used}" title="Markera att ditt bolag använder eller har provat detta">${useLabel(p.used, p.usageCount)}</button>
          <button class="btn" id="share">Kopiera länk</button>
          ${p.canEdit ? `<a class="btn" href="#/kort/${p.id}/redigera">Redigera</a><button class="btn btn-danger" id="delete">Ta bort</button>` : ''}
        </div>
        ${section('Utmaning / bakgrund', p.challenge)}
        ${section('Vad vi gjorde', p.solution)}
        ${section('Resultat', p.result)}
        ${section('Så kan ni göra', p.howto)}
        ${p.tags.length ? `<div class="meta mt">${p.tags.map((t) => `<a class="tag" href="#/utforska?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(' ')}</div>` : ''}

        <h2 id="comments">Frågor & kommentarer (${comments.length})</h2>
        <div>${comments.length ? comments.map((c) => `
          <div class="comment">
            <div class="meta"><b>${esc(c.authorName)}</b> · ${esc(shortCompany(c.companyId))} · ${fmtDate(c.createdAt)}
              ${c.canDelete ? `<button class="linkbtn small" data-del-comment="${c.id}">Ta bort</button>` : ''}</div>
            <div class="prose">${esc(c.body)}</div>
          </div>`).join('') : '<p class="muted">Inga kommentarer än. Ställ gärna en fråga!</p>'}</div>
        <form id="comment-form" class="comment-form">
          <div class="error" hidden></div>
          <div class="row">
            <div class="field"><label for="c-name">Ditt namn</label><input id="c-name" required maxlength="80" autocomplete="name" value="${esc(me.name)}"></div>
            <div class="field"><label for="c-company">Bolag</label><select id="c-company" required>${options(state.meta.companies, me.companyId, 'Välj bolag…')}</select></div>
          </div>
          <div class="field"><label for="comment">Kommentar eller fråga</label>
            <textarea id="comment" maxlength="${state.meta.limits.comment}" required placeholder="Hur gjorde ni med…? Vi har provat detta i vårt bolag och…"></textarea></div>
          <button class="btn btn-primary" type="submit">Skicka</button>
        </form>
      </article>
      <aside class="aside">
        <div class="card">
          <h3>Delat av</h3>
          <p><a class="byline" href="#/person/${p.author.id}"><b>${esc(p.author.name)}</b></a><br>
            ${p.author.title ? `<span class="muted">${esc(p.author.title)}</span><br>` : ''}
            <span class="muted">${esc(companyName(p.companyId))}</span></p>
          <p class="small muted">Publicerad ${fmtDate(p.createdAt)}${p.updatedAt !== p.createdAt ? ` · uppdaterad ${fmtDate(p.updatedAt)}` : ''}</p>
          <p class="small muted">Vill du veta mer? Skriv en fråga i kommentarerna eller sök upp ${esc(p.author.name.split(' ')[0])} i Teams.</p>
        </div>
        <div class="card">
          <h3>Används av</h3>
          ${p.usedBy.length
            ? `<div class="meta">${p.usedBy.map((u) => `<span class="chip chip-company">${esc(shortCompany(u.companyId))}${u.count > 1 ? ` (${u.count})` : ''}</span>`).join('')}</div>`
            : '<p class="muted small">Ingen har markerat att de använder detta än. Har ni provat? Klicka på "Vi använder detta".</p>'}
        </div>
      </aside>
    </div>`;

  const likeBtn = document.getElementById('like');
  likeBtn.onclick = async () => {
    const on = likeBtn.getAttribute('aria-pressed') !== 'true';
    likeBtn.disabled = true;
    try {
      const r = await api(`/posts/${p.id}/like`, { method: on ? 'POST' : 'DELETE' });
      likeBtn.classList.toggle('on', on);
      likeBtn.setAttribute('aria-pressed', String(on));
      likeBtn.textContent = likeLabel(on, r.count);
      if (on) toast('Tack för din gillning!');
    } catch (err) { toast(err.message); }
    likeBtn.disabled = false;
  };
  document.getElementById('use').onclick = async (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    try {
      if (on) {
        const companyId = profile().companyId || (await askCompany());
        if (!companyId) return;
        await api(`/posts/${p.id}/use`, { method: 'POST', body: { companyId } });
        toast('Kul att idén sprids!');
      } else {
        await api(`/posts/${p.id}/use`, { method: 'DELETE' });
      }
      route();
    } catch (err) { toast(err.message); }
  };
  document.getElementById('share').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Länken är kopierad'); } catch { toast(location.href); }
  };
  const del = document.getElementById('delete');
  if (del) del.onclick = async () => {
    if (!confirm('Vill du ta bort kortet? Det går inte att ångra.')) return;
    try { await api(`/posts/${p.id}`, { method: 'DELETE' }); toast('Kortet är borttaget'); go('#/utforska'); } catch (err) { toast(err.message); }
  };
  document.querySelectorAll('[data-del-comment]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Ta bort kommentaren?')) return;
    try { await api(`/comments/${b.dataset.delComment}`, { method: 'DELETE' }); route(); } catch (err) { toast(err.message); }
  }));
  const cform = document.getElementById('comment-form');
  cform.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: cform.querySelector('#c-name').value,
      companyId: cform.querySelector('#c-company').value,
      body: cform.querySelector('#comment').value,
    };
    try {
      await api(`/posts/${p.id}/comments`, { method: 'POST', body });
      saveProfile({ name: body.name.trim(), companyId: body.companyId });
      toast('Kommentaren är publicerad');
      route();
    } catch (err) { showError(cform, err); }
  };
}

async function pageEditor(id) {
  setNav(id ? '' : 'share');
  const me = profile();
  let p = { title: '', summary: '', categoryId: '', challenge: '', solution: '', result: '', howto: '', tags: [],
    author: { name: me.name, title: me.title }, companyId: me.companyId };
  if (id) {
    p = (await api(`/posts/${id}`)).post;
    if (!p.canEdit) throw new Error('Kortet kan bara ändras från webbläsaren där det skapades.');
  }
  const L = state.meta.limits;
  const area = (name, label, hint, max, required) => `
    <div class="field"><label for="f-${name}">${label}${required ? '' : ' <span class="hint hint-inline">(valfritt)</span>'}<span class="hint">${hint}</span></label>
      <textarea id="f-${name}" name="${name}" maxlength="${max}"${required ? ' required' : ''}>${esc(p[name])}</textarea></div>`;

  $main.innerHTML = `
    <form class="card narrow" id="editor">
      <h1>${id ? 'Redigera kortet' : 'Dela en erfarenhet'}</h1>
      <p class="muted">Skriv så att en kollega i ett annat bolag förstår vad ni gjorde och kan göra likadant. Kort och konkret är bäst!</p>
      <div class="error" hidden></div>

      <div class="panel">
        <span class="panel-title">Om dig</span>
        <div class="row-3">
          <div class="field"><label for="f-name">Ditt namn</label><input id="f-name" name="name" required maxlength="${L.name}" autocomplete="name" value="${esc(p.author.name)}"></div>
          <div class="field"><label for="f-company">Bolag</label><select id="f-company" name="companyId" required>${options(state.meta.companies, p.companyId, 'Välj bolag…')}</select></div>
          <div class="field"><label for="f-authorTitle">Roll <span class="hint hint-inline">(valfritt)</span></label><input id="f-authorTitle" name="authorTitle" maxlength="${L.name}" placeholder="t.ex. Skadereglerare" value="${esc(p.author.title)}"></div>
        </div>
      </div>

      <div class="field"><label for="f-title">Rubrik <span class="hint">Vad är idén? T.ex. "Kundkväll på gården gav 60 nya kunder"</span></label>
        <input id="f-title" name="title" required maxlength="${L.title}" value="${esc(p.title)}"></div>
      <div class="field"><label for="f-summary">Kort sammanfattning <span class="hint">1–3 meningar som visas på kortet i listor och sökresultat.</span></label>
        <textarea id="f-summary" name="summary" class="short" required maxlength="${L.summary}">${esc(p.summary)}</textarea>
        <div class="counter" data-for="f-summary"></div></div>
      <div class="row">
        <div class="field"><label for="f-category">Område</label><select id="f-category" name="categoryId" required>${options(state.meta.categories, p.categoryId, 'Välj område…')}</select></div>
        <div class="field"><label for="f-tags">Taggar <span class="hint">Separera med komma, t.ex. kundevent, familj</span></label>
          <input id="f-tags" name="tags" value="${esc(p.tags.join(', '))}"></div>
      </div>
      ${area('challenge', 'Utmaning / bakgrund', 'Vilket problem eller behov hade ni?', L.section, false)}
      ${area('solution', 'Vad vi gjorde', 'Beskriv lösningen, aktiviteten eller arbetssättet.', L.section, true)}
      ${area('result', 'Resultat', 'Vad blev effekten? Siffror är guld värda – men uppskattningar duger.', L.section, false)}
      ${area('howto', 'Så kan ni göra', 'Tips och första steg för den som vill prova. Har ni mallar eller material att dela?', L.section, false)}
      <div class="actions">
        <button class="btn btn-primary" type="submit">${id ? 'Spara ändringar' : 'Publicera kortet'}</button>
        <a class="btn" href="${id ? `#/kort/${id}` : '#/'}">Avbryt</a>
      </div>
    </form>`;

  const form = document.getElementById('editor');
  const counter = form.querySelector('[data-for="f-summary"]');
  const summary = form.querySelector('#f-summary');
  const updateCounter = () => (counter.textContent = `${summary.value.length} / ${L.summary}`);
  summary.oninput = updateCounter;
  updateCounter();
  if (!p.author.name) form.querySelector('#f-name').focus();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api(id ? `/posts/${id}` : '/posts', { method: id ? 'PUT' : 'POST', body: fd });
      saveProfile({ name: fd.name.trim(), companyId: fd.companyId, title: fd.authorTitle.trim() });
      toast(id ? 'Ändringarna är sparade' : 'Tack för att du delar!');
      go(`#/kort/${r.id}`);
    } catch (err) { showError(form, err); }
    btn.disabled = false;
  };
}

async function pageLeaderboard(params) {
  setNav('leaderboard');
  const period = params.get('period') || 'all';
  const d = await api(`/leaderboard?period=${encodeURIComponent(period)}`);
  const periods = [['all', 'Hela tiden'], ['365', 'Senaste året'], ['90', 'Senaste 90 dagarna'], ['30', 'Senaste 30 dagarna']];
  const list = (items, render, empty) => items.length
    ? `<ol class="rank">${items.map((it, i) => `<li><span class="pos">${i + 1}</span>${render(it)}</li>`).join('')}</ol>`
    : `<p class="muted">${empty}</p>`;
  const postRow = (unit) => (p) => `<div><a href="#/kort/${p.id}">${esc(p.title)}</a><div class="small muted">${esc(p.author.name)} · ${esc(shortCompany(p.companyId))}</div></div><span class="score">${unit} ${p.score}</span>`;

  $main.innerHTML = `
    <h1>Topplista</h1>
    <p class="muted">De mest uppskattade erfarenheterna och de flitigaste delarna i Länsförsäkringsgruppen.</p>
    <div class="tabs" role="group" aria-label="Tidsperiod">
      ${periods.map(([v, n]) => `<button class="btn btn-sm${v === d.period ? ' on' : ''}" data-period="${v}" aria-pressed="${v === d.period}">${n}</button>`).join('')}
    </div>
    <div class="grid grid-2">
      <section class="card lb-card"><h2>Mest gillade kunskapsdelningar</h2>${list(d.topPosts, postRow('♥'), 'Inga gillningar under perioden.')}</section>
      <section class="card lb-card"><h2>Flest delningar</h2>${list(d.topSharers, (u) => `<div><a href="#/person/${u.id}">${esc(u.name)}</a><div class="small muted">${esc(shortCompany(u.companyId))} · ${plural(u.likesReceived, 'gillning', 'gillningar')} totalt</div></div><span class="score">${plural(u.score, 'kort', 'kort')}</span>`, 'Inga delningar under perioden.')}</section>
      <section class="card lb-card"><h2>Mest återanvända</h2>${list(d.topUsed, postRow('✓'), 'Ingen har markerat återanvändning under perioden.')}</section>
      <section class="card lb-card"><h2>Bolag som delar mest</h2>${list(d.topCompanies, (c) => `<div><a href="#/utforska?company=${esc(c.companyId)}">${esc(companyName(c.companyId))}</a><div class="small muted">${plural(c.sharers, 'person', 'personer')} har delat · ${plural(c.likesReceived, 'gillning', 'gillningar')}</div></div><span class="score">${plural(c.score, 'kort', 'kort')}</span>`, 'Inga delningar under perioden.')}</section>
    </div>`;
  document.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => go(`#/topplista?period=${b.dataset.period}`)));
}

async function pagePerson(id) {
  setNav('');
  const [{ author: a, stats }, posts] = await Promise.all([api(`/authors/${id}`), api(`/posts?author=${encodeURIComponent(id)}&sort=new`)]);
  document.title = `${a.name} – Kunskapsdelning`;
  $main.innerHTML = `
    <div class="card person-head">
      <h1>${esc(a.name)}</h1>
      <p class="muted">${a.title ? `${esc(a.title)} · ` : ''}${esc(companyName(a.companyId))}</p>
      <div class="meta big">
        <span><b>${stats.posts}</b> delade kort</span>
        <span><b>${stats.likesReceived}</b> gillningar</span>
        <span><b>${stats.usagesReceived}</b> gånger återanvänd</span>
      </div>
    </div>
    <div class="section-head"><h2>Delade erfarenheter</h2></div>
    ${postGrid(posts.posts, 'Inga delningar än.')}`;
}

async function pageAdmin() {
  setNav('');
  if (state.meta.static) {
    $main.innerHTML = '<div class="card empty narrow"><h2>Moderering</h2><p>I demoversionen finns ingen moderering – allt du lägger in syns bara i din egen webbläsare.</p></div>';
    return;
  }
  const active = !!store.get('kd_admin', '');
  $main.innerHTML = `
    <form class="card narrow" id="admin">
      <h1>Moderering</h1>
      <p class="muted">Med administratörsnyckeln kan du ta bort olämpliga kort och kommentarer. Nyckeln sätts av IT med inställningen <code>ADMIN_KEY</code>.</p>
      <p>Status: <b>${active ? (state.meta.isAdmin ? 'Inloggad som administratör' : 'Nyckeln är fel') : 'Inte aktiverad'}</b></p>
      <div class="field"><label for="admin-key">Administratörsnyckel</label><input id="admin-key" type="password" autocomplete="off"></div>
      <div class="actions"><button class="btn btn-primary" type="submit">Aktivera</button>${active ? '<button class="btn" type="button" id="admin-off">Avaktivera</button>' : ''}</div>
    </form>`;
  const reload = async () => { state.meta = await api('/meta'); route(); };
  document.getElementById('admin').onsubmit = (e) => { e.preventDefault(); store.set('kd_admin', document.getElementById('admin-key').value); reload(); };
  const off = document.getElementById('admin-off');
  if (off) off.onclick = () => { store.set('kd_admin', ''); reload(); };
}

// ---------- Router ----------

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  document.title = 'Kunskapsdelning – Länsförsäkringsgruppen';
  try {
    if (!parts.length) await pageHome();
    else if (parts[0] === 'utforska') await pageExplore(params);
    else if (parts[0] === 'dela') await pageEditor();
    else if (parts[0] === 'topplista') await pageLeaderboard(params);
    else if (parts[0] === 'kort' && parts[2] === 'redigera') await pageEditor(parts[1]);
    else if (parts[0] === 'kort') await pagePost(parts[1]);
    else if (parts[0] === 'person') await pagePerson(parts[1]);
    else if (parts[0] === 'admin') await pageAdmin();
    else $main.innerHTML = '<div class="card empty"><h2>Sidan finns inte</h2><a href="#/">Till startsidan</a></div>';
  } catch (err) {
    $main.innerHTML = `<div class="card empty"><h2>Hoppsan!</h2><p>${esc(err.message)}</p><a href="#/">Till startsidan</a></div>`;
  }
}

let lastPath = null;
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  route().then(() => {
    if (path !== lastPath) { window.scrollTo(0, 0); $main.focus({ preventScroll: true }); }
    lastPath = path;
  });
});

(async function init() {
  try {
    await detectMode();
    state.meta = await api('/meta');
  } catch (err) {
    $main.innerHTML = `<div class="card empty"><h2>Hoppsan!</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  lastPath = location.hash.split('?')[0];
  await route();
})();
