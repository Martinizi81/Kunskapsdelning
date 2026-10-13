'use strict';

// ---------- Hjälpfunktioner ----------

const state = { me: null, authMode: 'demo', ssoEmail: null, meta: { companies: [], categories: [], limits: {} } };
const $main = document.getElementById('main');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const companyName = (id) => (state.meta.companies.find((c) => c.id === id) || {}).name || id;
const shortCompany = (id) => companyName(id).replace(/^Länsförsäkringar /, '');
const categoryName = (id) => (state.meta.categories.find((c) => c.id === id) || {}).name || id;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function fmtDate(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kunskapsdelning' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Något gick fel.');
    err.status = res.status;
    throw err;
  }
  return data;
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

// ---------- Inloggning ----------

function renderUserbox() {
  const box = document.getElementById('userbox');
  if (state.me) {
    box.innerHTML = `<a href="#/profil/${state.me.id}" title="Min profil">${esc(state.me.name)}</a>
      ${state.authMode === 'demo' ? '<button class="btn btn-sm" id="logout">Logga ut</button>' : ''}`;
    const lo = document.getElementById('logout');
    if (lo) lo.onclick = async () => { await api('/logout', { method: 'POST' }); state.me = null; renderUserbox(); toast('Du är utloggad'); route(); };
  } else {
    box.innerHTML = '<button class="btn btn-sm" id="login">Logga in</button>';
    document.getElementById('login').onclick = () => openLogin();
  }
}

// Visar inloggnings-/profilrutan. Returnerar ett löfte som blir true om användaren loggade in.
function openLogin({ reason, edit = false } = {}) {
  return new Promise((resolve) => {
    const me = edit ? state.me : null;
    const sso = state.authMode === 'easyauth';
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <form class="card modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <h2 id="login-title">${edit ? 'Redigera profil' : sso ? 'Välkommen! Berätta vem du är' : 'Logga in'}</h2>
        ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
        <div class="error" hidden></div>
        <div class="field"><label for="l-name">Namn</label><input id="l-name" required maxlength="80" autocomplete="name" value="${esc(me?.name || '')}"></div>
        ${edit ? '' : sso
          ? `<div class="field"><label>E-post</label><input value="${esc(state.ssoEmail || '')}" disabled></div>`
          : `<div class="field"><label for="l-email">Jobbmejl</label><input id="l-email" type="email" required autocomplete="email" placeholder="fornamn.efternamn@lansforsakringar.se"></div>`}
        <div class="field"><label for="l-company">Bolag</label><select id="l-company" required>${options(state.meta.companies, me?.companyId, 'Välj ditt bolag…')}</select></div>
        <div class="field"><label for="l-title">Roll <span class="hint">Valfritt, t.ex. "Skadereglerare"</span></label><input id="l-title" maxlength="80" value="${esc(me?.title || '')}"></div>
        <div class="actions"><button class="btn btn-primary" type="submit">${edit ? 'Spara' : 'Fortsätt'}</button><button class="btn" type="button" data-close>Avbryt</button></div>
        ${!edit && !sso ? '<p class="small muted">Testläge: ingen lösenordskontroll. I skarp drift loggar man in med sitt vanliga företagskonto.</p>' : ''}
      </form>`;
    document.body.appendChild(bg);
    const form = bg.querySelector('form');
    const close = (ok) => { bg.remove(); resolve(ok); };
    bg.querySelector('[data-close]').onclick = () => close(false);
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
    bg.querySelector('#l-name').focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        name: form.querySelector('#l-name').value,
        companyId: form.querySelector('#l-company').value,
        title: form.querySelector('#l-title').value,
        email: form.querySelector('#l-email')?.value,
      };
      try {
        const { user } = await api(edit ? '/me' : '/login', { method: edit ? 'PUT' : 'POST', body });
        state.me = user;
        renderUserbox();
        toast(edit ? 'Profilen är sparad' : `Välkommen, ${user.name}!`);
        close(true);
      } catch (err) {
        const box = form.querySelector('.error');
        box.textContent = err.message;
        box.hidden = false;
      }
    };
  });
}

async function requireLogin(reason) {
  if (state.me) return true;
  return openLogin({ reason });
}

// ---------- Komponenter ----------

function postCard(p) {
  return `<article class="card post-card">
    <div class="meta"><a class="chip" href="#/utforska?category=${esc(p.categoryId)}">${esc(categoryName(p.categoryId))}</a>
      <a class="chip chip-company" href="#/utforska?company=${esc(p.companyId)}">${esc(shortCompany(p.companyId))}</a></div>
    <h3><a href="#/forslag/${p.id}">${esc(p.title)}</a></h3>
    <p class="muted">${esc(p.summary)}</p>
    ${p.tags.length ? `<div class="meta">${p.tags.map((t) => `<a class="tag" href="#/utforska?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(' ')}</div>` : ''}
    <div class="meta"><a href="#/profil/${p.author.id}">${esc(p.author.name)}</a> · ${fmtDate(p.createdAt)}</div>
    <div class="counts">
      <span title="Gillningar">${p.liked ? '❤️' : '🤍'} ${p.likeCount}</span>
      <span title="Bolag/personer som använder detta">✅ ${p.usageCount}</span>
      <span title="Kommentarer">💬 ${p.commentCount}</span>
    </div>
  </article>`;
}

function postGrid(posts, emptyText = 'Inga förslag hittades.') {
  if (!posts.length) return `<div class="card empty">${emptyText}</div>`;
  return `<div class="grid grid-3">${posts.map(postCard).join('')}</div>`;
}

function setNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

// ---------- Sidor ----------

async function pageHome() {
  setNav('home');
  const [stats, latest, popular] = await Promise.all([
    api('/stats'),
    api('/posts?sort=new'),
    api('/posts?sort=likes'),
  ]);
  $main.innerHTML = `
    <section class="hero">
      <div>
        <h1>Det du redan vet kan lösa någon annans problem</h1>
        <p>Dela goda erfarenheter mellan de 23 länsförsäkringsbolagen och Länsförsäkringar AB. Hitta lösningar som redan fungerar – och gilla det som inspirerar dig.</p>
        <a class="btn btn-primary" href="#/dela">+ Dela en erfarenhet</a>
        <a class="btn" href="#/utforska">Utforska förslag</a>
        <form class="searchbar" id="hero-search" role="search">
          <input name="q" placeholder="Sök t.ex. &quot;skadeanmälan&quot; eller &quot;onboarding&quot;" aria-label="Sök bland förslag">
          <button class="btn btn-primary" type="submit">Sök</button>
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
    <div class="grid grid-3 steps">
      <div class="card step"><h3>Dela</h3><p class="muted">Beskriv kort vad ni gjorde, vad det gav och hur andra kan göra likadant. Det tar fem minuter.</p></div>
      <div class="card step"><h3>Hitta</h3><p class="muted">Sök fritt eller filtrera på bolag, område och taggar. Allt är öppet för alla i gruppen.</p></div>
      <div class="card step"><h3>Använd & gilla</h3><p class="muted">Gilla det som är bra, markera när ni använder en idé och ställ frågor direkt till den som delade.</p></div>
    </div>

    <div class="section-head"><h2>Mest gillade</h2><a href="#/topplista">Se topplistan →</a></div>
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
    page: params.get('page') || '1',
  };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const data = await api(`/posts?${qs}`);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const link = (changes) => `#/utforska?${new URLSearchParams(Object.entries({ ...f, ...changes }).filter(([, v]) => v))}`;

  $main.innerHTML = `
    <h1>Utforska erfarenheter</h1>
    <form class="filters" id="filters" role="search">
      <input class="f-q" name="q" value="${esc(f.q)}" placeholder="Sök på ord, t.ex. bolån, video, onboarding…" aria-label="Sök">
      <select name="company" aria-label="Bolag">${options(state.meta.companies, f.company, 'Alla bolag')}</select>
      <select name="category" aria-label="Område">${options(state.meta.categories, f.category, 'Alla områden')}</select>
      <select name="sort" aria-label="Sortering">
        ${[['', f.q ? 'Mest relevant' : 'Senaste'], ['new', 'Senaste'], ['likes', 'Mest gillade'], ['used', 'Mest använda'], ['comments', 'Mest diskuterade']]
          .filter(([v], i) => !(i === 1 && !f.q))
          .map(([v, n]) => `<option value="${v}"${v === f.sort ? ' selected' : ''}>${n}</option>`).join('')}
      </select>
    </form>
    ${f.tag ? `<p class="active-filter">Visar taggen <b>#${esc(f.tag)}</b> · <a href="${link({ tag: '', page: '' })}">ta bort</a></p>` : ''}
    <p class="muted">${plural(data.total, 'erfarenhet', 'erfarenheter')}</p>
    ${postGrid(data.posts, f.q || f.company || f.category || f.tag
      ? 'Inga träffar. Prova andra sökord eller ta bort ett filter.'
      : 'Inga förslag ännu. <a href="#/dela">Dela den första!</a>')}
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

async function pagePost(id) {
  setNav('');
  const { post: p, comments } = await api(`/posts/${id}`);
  document.title = `${p.title} – Kunskapsdelning`;
  $main.innerHTML = `
    <p><a href="#/utforska">← Alla erfarenheter</a></p>
    <div class="detail">
      <article class="card">
        <div class="meta"><a class="chip" href="#/utforska?category=${esc(p.categoryId)}">${esc(categoryName(p.categoryId))}</a>
          <a class="chip chip-company" href="#/utforska?company=${esc(p.companyId)}">${esc(companyName(p.companyId))}</a></div>
        <h1>${esc(p.title)}</h1>
        <p class="lead">${esc(p.summary)}</p>
        <div class="actions">
          <button class="btn btn-like${p.liked ? ' on' : ''}" id="like" aria-pressed="${p.liked}">${p.liked ? '❤️ Gillad' : '🤍 Gilla'} · <span>${p.likeCount}</span></button>
          <button class="btn btn-use${p.used ? ' on' : ''}" id="use" aria-pressed="${p.used}" title="Markera att ni använder eller har provat detta">${p.used ? '✅ Vi använder detta' : '☑️ Vi använder detta'} · <span>${p.usageCount}</span></button>
          <button class="btn" id="share">🔗 Kopiera länk</button>
          ${p.canEdit ? `<a class="btn" href="#/forslag/${p.id}/redigera">✏️ Redigera</a><button class="btn btn-danger" id="delete">Ta bort</button>` : ''}
        </div>
        ${section('Utmaning / bakgrund', p.challenge)}
        ${section('Vad vi gjorde', p.solution)}
        ${section('Resultat', p.result)}
        ${section('Så kan ni göra', p.howto)}
        ${p.tags.length ? `<div class="meta mt">${p.tags.map((t) => `<a class="tag" href="#/utforska?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(' ')}</div>` : ''}

        <h2 id="comments">Frågor & kommentarer (${comments.length})</h2>
        <div>${comments.length ? comments.map((c) => `
          <div class="comment">
            <div class="meta"><a href="#/profil/${c.author.id}"><b>${esc(c.author.name)}</b></a> · ${esc(shortCompany(c.author.companyId))} · ${fmtDate(c.createdAt)}
              ${c.canDelete ? `<button class="linkbtn small" data-del-comment="${c.id}">Ta bort</button>` : ''}</div>
            <div class="prose">${esc(c.body)}</div>
          </div>`).join('') : '<p class="muted">Inga kommentarer än. Ställ gärna en fråga!</p>'}</div>
        <form id="comment-form" class="field">
          <label for="comment">Skriv en kommentar eller fråga</label>
          <textarea id="comment" maxlength="${state.meta.limits.comment}" required placeholder="Hur gjorde ni med…? Vi har provat detta i vårt bolag och…"></textarea>
          <div class="actions"><button class="btn btn-primary" type="submit">Skicka</button></div>
        </form>
      </article>
      <aside class="aside">
        <div class="card">
          <h3>Delat av</h3>
          <p><a href="#/profil/${p.author.id}"><b>${esc(p.author.name)}</b></a><br>
            ${p.author.title ? `<span class="muted">${esc(p.author.title)}</span><br>` : ''}
            <span class="muted">${esc(companyName(p.author.companyId))}</span></p>
          <a class="btn btn-sm" href="mailto:${esc(p.author.email)}?subject=${encodeURIComponent('Fråga om: ' + p.title)}">✉️ Kontakta</a>
          <p class="small muted mt">Publicerad ${fmtDate(p.createdAt)}${p.updatedAt !== p.createdAt ? ` · uppdaterad ${fmtDate(p.updatedAt)}` : ''}</p>
        </div>
        <div class="card">
          <h3>Används av</h3>
          ${p.usedByCompanies.length
            ? `<div class="meta">${p.usedByCompanies.map((c) => `<span class="chip chip-company">${esc(shortCompany(c))}</span>`).join('')}</div>`
            : '<p class="muted small">Ingen har markerat att de använder detta än. Har ni provat? Klicka på "Vi använder detta".</p>'}
        </div>
      </aside>
    </div>`;

  const toggle = async (btn, kind) => {
    if (!(await requireLogin('Logga in för att gilla och markera förslag.'))) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.disabled = true;
    try {
      const r = await api(`/posts/${p.id}/${kind}`, { method: on ? 'POST' : 'DELETE' });
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.innerHTML = kind === 'like'
        ? `${on ? '❤️ Gillad' : '🤍 Gilla'} · <span>${r.count}</span>`
        : `${on ? '✅' : '☑️'} Vi använder detta · <span>${r.count}</span>`;
      if (kind === 'use') route();
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  };
  document.getElementById('like').onclick = (e) => toggle(e.currentTarget, 'like');
  document.getElementById('use').onclick = (e) => toggle(e.currentTarget, 'use');
  document.getElementById('share').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Länken är kopierad'); } catch { toast(location.href); }
  };
  const del = document.getElementById('delete');
  if (del) del.onclick = async () => {
    if (!confirm('Vill du ta bort förslaget? Det går inte att ångra.')) return;
    try { await api(`/posts/${p.id}`, { method: 'DELETE' }); toast('Förslaget är borttaget'); go('#/utforska'); } catch (err) { toast(err.message); }
  };
  document.querySelectorAll('[data-del-comment]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Ta bort kommentaren?')) return;
    try { await api(`/comments/${b.dataset.delComment}`, { method: 'DELETE' }); route(); } catch (err) { toast(err.message); }
  }));
  document.getElementById('comment-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!(await requireLogin('Logga in för att kommentera.'))) return;
    try {
      await api(`/posts/${p.id}/comments`, { method: 'POST', body: { body: document.getElementById('comment').value } });
      toast('Kommentaren är publicerad');
      route();
    } catch (err) { toast(err.message); }
  };
}

async function pageEditor(id) {
  setNav(id ? '' : 'share');
  if (!state.me) {
    $main.innerHTML = `<div class="card empty"><h2>Logga in för att dela</h2><p>Du behöver vara inloggad för att dela en erfarenhet.</p>
      <button class="btn btn-primary" id="login-to-share">Logga in</button></div>`;
    document.getElementById('login-to-share').onclick = async () => { if (await openLogin()) route(); };
    return;
  }
  let p = { title: '', summary: '', categoryId: '', challenge: '', solution: '', result: '', howto: '', tags: [] };
  if (id) p = (await api(`/posts/${id}`)).post;
  const L = state.meta.limits;
  const area = (name, label, hint, max, required) => `
    <div class="field"><label for="f-${name}">${label}${required ? '' : ' <span class="hint hint-inline">(valfritt)</span>'}<span class="hint">${hint}</span></label>
      <textarea id="f-${name}" name="${name}" maxlength="${max}"${required ? ' required' : ''}>${esc(p[name])}</textarea></div>`;

  $main.innerHTML = `
    <form class="card narrow" id="editor">
      <h1>${id ? 'Redigera erfarenhet' : 'Dela en erfarenhet'}</h1>
      <p class="muted">Skriv så att en kollega i ett annat bolag förstår vad ni gjorde och kan göra likadant. Kort och konkret är bäst!
        Du delar som <b>${esc(state.me.name)}</b>, ${esc(companyName(id ? p.companyId : state.me.companyId))}.</p>
      <div class="error" hidden></div>
      <div class="field"><label for="f-title">Rubrik <span class="hint">Vad är idén? T.ex. "Videobesiktning halverade ledtiden"</span></label>
        <input id="f-title" name="title" required maxlength="${L.title}" value="${esc(p.title)}"></div>
      <div class="field"><label for="f-summary">Kort sammanfattning <span class="hint">1–3 meningar som visas i listor och sökresultat.</span></label>
        <textarea id="f-summary" name="summary" required maxlength="${L.summary}" class="short">${esc(p.summary)}</textarea>
        <div class="counter" data-for="f-summary"></div></div>
      <div class="row">
        <div class="field"><label for="f-category">Område</label><select id="f-category" name="categoryId" required>${options(state.meta.categories, p.categoryId, 'Välj område…')}</select></div>
        <div class="field"><label for="f-tags">Taggar <span class="hint">Separera med komma, t.ex. bolån, kundmöte</span></label>
          <input id="f-tags" name="tags" value="${esc(p.tags.join(', '))}"></div>
      </div>
      ${area('challenge', 'Utmaning / bakgrund', 'Vilket problem eller behov hade ni?', L.section, false)}
      ${area('solution', 'Vad vi gjorde', 'Beskriv lösningen eller arbetssättet.', L.section, true)}
      ${area('result', 'Resultat', 'Vad blev effekten? Siffror är guld värda – men uppskattningar duger.', L.section, false)}
      ${area('howto', 'Så kan ni göra', 'Tips och första steg för den som vill prova. Material ni kan dela?', L.section, false)}
      <div class="actions">
        <button class="btn btn-primary" type="submit">${id ? 'Spara ändringar' : 'Publicera'}</button>
        <a class="btn" href="${id ? `#/forslag/${id}` : '#/'}">Avbryt</a>
      </div>
    </form>`;

  const form = document.getElementById('editor');
  const counter = form.querySelector('[data-for="f-summary"]');
  const summary = form.querySelector('#f-summary');
  const updateCounter = () => (counter.textContent = `${summary.value.length} / ${L.summary}`);
  summary.oninput = updateCounter;
  updateCounter();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api(id ? `/posts/${id}` : '/posts', { method: id ? 'PUT' : 'POST', body: fd });
      toast(id ? 'Ändringarna är sparade' : 'Tack för att du delar! 🎉');
      go(`#/forslag/${r.id}`);
    } catch (err) {
      const box = form.querySelector('.error');
      box.textContent = err.message;
      box.hidden = false;
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (err.status === 401) openLogin();
    }
    btn.disabled = false;
  };
}

async function pageLeaderboard(params) {
  setNav('leaderboard');
  const period = params.get('period') || 'all';
  const d = await api(`/leaderboard?period=${period}`);
  const periods = [['all', 'Hela tiden'], ['365', 'Senaste året'], ['90', 'Senaste 90 dagarna'], ['30', 'Senaste 30 dagarna']];
  const list = (items, render, empty) => items.length ? `<ol class="rank">${items.map((it, i) => `<li><span class="pos">${i + 1}</span>${render(it)}</li>`).join('')}</ol>` : `<p class="muted">${empty}</p>`;
  const postRow = (unit) => (p) => `<div><a href="#/forslag/${p.id}">${esc(p.title)}</a><div class="small muted">${esc(p.author.name)} · ${esc(shortCompany(p.companyId))}</div></div><span class="score">${unit} ${p.score}</span>`;

  $main.innerHTML = `
    <h1>Topplista</h1>
    <p class="muted">De mest uppskattade erfarenheterna och de flitigaste delarna i Länsförsäkringsgruppen.</p>
    <div class="tabs" role="group" aria-label="Tidsperiod">
      ${periods.map(([v, n]) => `<button class="btn btn-sm${v === d.period ? ' on' : ''}" data-period="${v}" aria-pressed="${v === d.period}">${n}</button>`).join('')}
    </div>
    <div class="grid grid-2">
      <section class="card"><h2>❤️ Mest gillade</h2>${list(d.topPosts, postRow('❤️'), 'Inga gillningar under perioden.')}</section>
      <section class="card"><h2>🏆 Flest delningar</h2>${list(d.topSharers, (u) => `<div><a href="#/profil/${u.id}">${esc(u.name)}</a><div class="small muted">${esc(shortCompany(u.companyId))} · ${plural(u.likesReceived, 'gillning', 'gillningar')} totalt</div></div><span class="score">${plural(u.score, 'delning', 'delningar')}</span>`, 'Inga delningar under perioden.')}</section>
      <section class="card"><h2>✅ Mest återanvända</h2>${list(d.topUsed, postRow('✅'), 'Ingen har markerat återanvändning under perioden.')}</section>
      <section class="card"><h2>🏢 Bolag som delar mest</h2>${list(d.topCompanies, (c) => `<div><a href="#/utforska?company=${esc(c.companyId)}">${esc(companyName(c.companyId))}</a><div class="small muted">${plural(c.sharers, 'person', 'personer')} har delat · ${plural(c.likesReceived, 'gillning', 'gillningar')}</div></div><span class="score">${c.score}</span>`, 'Inga delningar under perioden.')}</section>
    </div>`;
  document.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => go(`#/topplista?period=${b.dataset.period}`)));
}

async function pageProfile(id) {
  setNav('');
  const [{ user: u, stats }, posts] = await Promise.all([api(`/users/${id}`), api(`/posts?author=${id}&sort=new`)]);
  const mine = state.me && state.me.id === u.id;
  $main.innerHTML = `
    <div class="card">
      <h1>${esc(u.name)}</h1>
      <p class="muted">${u.title ? `${esc(u.title)} · ` : ''}${esc(companyName(u.companyId))}</p>
      <div class="meta big">
        <span><b>${stats.posts}</b> delningar</span><span><b>${stats.likesReceived}</b> gillningar fått</span>
        <span><b>${stats.usagesReceived}</b> gånger återanvänd</span><span><b>${stats.likesGiven}</b> gillningar givna</span>
      </div>
      <div class="actions">
        ${mine ? '<button class="btn" id="edit-profile">✏️ Redigera profil</button>' : `<a class="btn btn-sm" href="mailto:${esc(u.email)}">✉️ Kontakta</a>`}
      </div>
    </div>
    <div class="section-head"><h2>${mine ? 'Mina delningar' : 'Delningar'}</h2></div>
    ${postGrid(posts.posts, mine ? 'Du har inte delat något än. <a href="#/dela">Dela din första erfarenhet!</a>' : 'Inga delningar än.')}`;
  const edit = document.getElementById('edit-profile');
  if (edit) edit.onclick = async () => { if (await openLogin({ edit: true })) route(); };
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
    else if (parts[0] === 'forslag' && parts[2] === 'redigera') await pageEditor(parts[1]);
    else if (parts[0] === 'forslag') await pagePost(parts[1]);
    else if (parts[0] === 'profil') await pageProfile(parts[1]);
    else $main.innerHTML = '<div class="card empty"><h2>Sidan finns inte</h2><a href="#/">Till startsidan</a></div>';
  } catch (err) {
    $main.innerHTML = `<div class="card empty"><h2>Hoppsan!</h2><p>${esc(err.message)}</p><a href="#/">Till startsidan</a></div>`;
  }
}

let lastPath = null;
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  route().then(() => { if (path !== lastPath) { window.scrollTo(0, 0); $main.focus({ preventScroll: true }); } lastPath = path; });
});

(async function init() {
  const [me, meta] = await Promise.all([api('/me'), api('/meta')]);
  Object.assign(state, { me: me.user, authMode: me.authMode, ssoEmail: me.ssoEmail, meta });
  renderUserbox();
  lastPath = location.hash.split('?')[0];
  await route();
  // Vid företagsinloggning: be nya användare välja namn och bolag första gången.
  if (state.authMode === 'easyauth' && !state.me && state.ssoEmail) {
    if (await openLogin({ reason: 'Första gången behöver vi veta ditt namn och vilket bolag du arbetar på.' })) route();
  }
})();
