// TeamUp frontend: plain JavaScript, no frameworks.
const app = document.getElementById('app');
let token = localStorage.getItem('token');
let me = null;
let pendingCount = 0;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chips = (arr = [], hit = []) => arr.map((s) => `<span class="chip ${hit.includes(s) ? 'hit' : ''}">${esc(s)}</span>`).join(' ');
const empty = (msg) => `<div class="empty">${msg}</div>`;
const field = (label, name, value = '', attrs = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let toastTimer;
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3000);
}

// ---------- reusable cards ----------
function projectCard(p) {
  const hit = p.match ? p.match.skills : [];
  return `<article class="card">
    <div class="row between"><span class="tag">${esc(p.type)}</span>
      ${p.match && p.match.score ? `<span class="match">${p.match.score}% match</span>` : ''}</div>
    <h3><a href="#/project/${p.id}">${esc(p.title)}</a></h3>
    <p class="grow">${esc(p.description.slice(0, 110))}${p.description.length > 110 ? '…' : ''}</p>
    <div class="row">${chips(p.requiredSkills, hit)}</div>
    <div class="row between"><span class="tag">by ${esc(p.ownerName)}</span>
      <span class="tag">${p.status === 'open' ? p.vacancies + ' spot' + (p.vacancies > 1 ? 's' : '') + ' open' : 'Team full'}</span></div>
  </article>`;
}

async function personCard(u, ctx = {}) {
  const hit = u.match ? u.match.skills : [];
  let inviteForm = '';
  if (ctx.projects && ctx.projects.length && me && u.id !== me.id) {
    const opts = ctx.projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    inviteForm = `<form data-form="invite" class="row"><input type="hidden" name="toUserId" value="${u.id}">
      <select name="projectId" aria-label="Project" style="flex:1">${opts}</select>
      <button class="btn small">Invite</button></form>`;
  } else if (ctx.projectId) {
    inviteForm = `<form data-form="invite" class="row"><input type="hidden" name="toUserId" value="${u.id}">
      <input type="hidden" name="projectId" value="${ctx.projectId}"><button class="btn small">Invite to team</button></form>`;
  }
  return `<article class="card">
    <div class="row between"><h3>${esc(u.name)}${me && u.id === me.id ? ' (you)' : ''}</h3>
      ${u.match ? `<span class="match">${u.match.score}% fit</span>` : ''}</div>
    <span class="tag">${esc([u.college, u.branch, u.year].filter(Boolean).join(', '))}</span>
    <p>${esc(u.bio)}</p>
    <div class="row">${chips(u.skills, hit)}</div>
    ${u.interests.length ? `<div class="tag">Interested in: ${esc(u.interests.join(', '))}</div>` : ''}
    ${u.github ? `<a class="tag" href="${esc(u.github)}" target="_blank" rel="noopener">GitHub</a>` : ''}
    ${inviteForm}
  </article>`;
}

// ---------- navigation ----------
async function renderNav() {
  pendingCount = 0;
  if (me) {
    try { pendingCount = (await api('/requests')).filter((r) => r.toUserId === me.id && r.status === 'pending').length; } catch (e) {}
  }
  document.getElementById('nav').innerHTML = `
    <a class="logo" href="#/">TeamUp</a>
    <a href="#/projects">Projects</a><a href="#/people">People</a>
    ${me ? `<a href="#/new">Post a project</a>
      <a href="#/requests">Requests ${pendingCount ? `<span class="badge">${pendingCount}</span>` : ''}</a>
      <a href="#/profile">${esc(me.name.split(' ')[0])}</a>
      <a href="#/" data-act="logout">Log out</a>`
      : `<a class="btn small" href="#/login">Log in / Sign up</a>`}`;
}

// ---------- views ----------
const views = {};
const needLogin = () => { if (!me) { location.hash = '#/login'; return true; } };

views.home = async () => {
  let recs = '';
  if (me) {
    const list = await api('/recommendations');
    recs = `<h2>Projects that need your skills</h2>` + (list.length
      ? `<div class="grid">${list.slice(0, 6).map(projectCard).join('')}</div>`
      : empty('No matches yet. Add more skills to <a href="#/profile">your profile</a>.'));
  }
  app.innerHTML = `<section class="hero">
    <div><h1>Find the teammate your project is missing.</h1>
      <p class="muted">Post what your team needs. TeamUp ranks students by the skills you still lack, not just who has the longest résumé.</p>
      <div class="row"><a class="btn" href="${me ? '#/new' : '#/login'}">${me ? 'Post a project' : 'Create your profile'}</a>
      <a class="btn ghost" href="#/projects">Browse projects</a></div></div>
    <div class="stack" aria-hidden="true">
      <div class="card"><h3>Campus Expense Splitter</h3><div class="row">${chips(['react', 'node.js'])}<span class="tag">covered</span></div></div>
      <div class="card open-slot"><h3>Open seat</h3><div class="row">${chips(['figma', 'ui/ux'], ['figma', 'ui/ux'])}<span class="tag">needed</span></div></div>
    </div></section>${recs}`;
};

views.projects = async () => {
  const draw = async () => {
    const q = new URLSearchParams({ q: $f.q.value, skill: $f.skill.value, type: $f.type.value, open: $f.open.checked ? '1' : '' });
    const list = await api('/projects?' + q);
    document.getElementById('results').innerHTML = list.length ? `<div class="grid">${list.map(projectCard).join('')}</div>` : empty('No projects match those filters.');
  };
  app.innerHTML = `<h1>Projects</h1><form class="filters" id="filters">
    <input name="q" placeholder="Search title or description"><input name="skill" placeholder="Filter by skill, e.g. react">
    <select name="type"><option value="">All types</option><option>Hackathon</option><option>College project</option><option>Competition</option></select>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="open" checked style="width:auto"> Only open</label></form>
    <div id="results"></div>`;
  const $f = document.getElementById('filters');
  $f.addEventListener('input', draw); $f.addEventListener('submit', (e) => e.preventDefault());
  await draw();
};

views.people = async () => {
  const mine = me ? (await api('/projects?open=1')).filter((p) => p.ownerId === me.id) : [];
  const draw = async () => {
    const q = new URLSearchParams({ q: $f.q.value, skill: $f.skill.value });
    const list = await api('/users?' + q);
    const cards = await Promise.all(list.map((u) => personCard(u, { projects: mine })));
    document.getElementById('results').innerHTML = cards.length ? `<div class="grid">${cards.join('')}</div>` : empty('Nobody matches that search.');
  };
  app.innerHTML = `<h1>People</h1><form class="filters" id="filters">
    <input name="q" placeholder="Search name, college, interest"><input name="skill" placeholder="Filter by skill, e.g. python"></form>
    ${me && !mine.length ? '<p class="muted">Post a project to invite people from here.</p>' : ''}<div id="results"></div>`;
  const $f = document.getElementById('filters');
  $f.addEventListener('input', draw); $f.addEventListener('submit', (e) => e.preventDefault());
  await draw();
};

views.project = async (id) => {
  const p = await api('/projects/' + id);
  const owner = me && p.ownerId === me.id;
  const member = me && p.members.includes(me.id);
  let side = '';
  if (owner && p.status === 'open') {
    const sugg = await api(`/projects/${id}/suggestions`);
    const cards = await Promise.all(sugg.map((u) => personCard(u, { projectId: id })));
    side = `<h2>Suggested teammates</h2>` + (cards.length ? `<div class="grid">${cards.join('')}</div>` : empty('No one matches the missing skills yet. Check back as more students join.'));
  }
  let action = '';
  if (owner) action = `<button class="btn danger small" data-act="deleteProject" data-id="${id}">Delete project</button>`;
  else if (member) action = `<span class="match">You're on this team</span>`;
  else if (p.status !== 'open') action = `<span class="tag">This team is full</span>`;
  else if (me) action = `<form data-form="apply" class="box"><input type="hidden" name="projectId" value="${id}">
      <label>Tell them why you're a fit<textarea name="message" maxlength="300" placeholder="I've built a React dashboard before..."></textarea></label>
      <button class="btn">Ask to join</button></form>`;
  else action = `<a class="btn" href="#/login">Log in to apply</a>`;
  app.innerHTML = `<a href="#/projects" class="tag">← All projects</a>
    <div class="row between"><h1>${esc(p.title)}</h1><span class="tag">${esc(p.type)}</span></div>
    <p>${esc(p.description)}</p>
    <h3>Skills needed</h3><div class="row">${chips(p.requiredSkills, p.match ? p.match.skills : [])}</div>
    ${p.match && p.match.score ? `<p class="match">You'd be a ${p.match.score}% fit for this team.</p>` : ''}
    <h3 style="margin-top:1em">Team (${p.vacancies} spot${p.vacancies === 1 ? '' : 's'} left)</h3>
    <div class="grid">${p.memberList.map((m) => `<div class="card"><h3>${esc(m.name)}${m.id === p.ownerId ? ' · owner' : ''}</h3><div class="row">${chips(m.skills)}</div></div>`).join('')}
      ${p.status === 'open' ? Array.from({ length: p.vacancies }, () => `<div class="card open-slot"><h3>Open seat</h3></div>`).join('') : ''}</div>
    <div style="margin:20px 0">${action}</div>${side}`;
};

views.new = async () => {
  if (needLogin()) return;
  app.innerHTML = `<h1>Post a project</h1><form class="box" data-form="newProject">
    ${field('Title', 'title', '', 'required')}
    <label>What are you building?<textarea name="description" required></textarea></label>
    <div class="two"><label>Type<select name="type"><option>Hackathon</option><option>College project</option><option>Competition</option></select></label>
    ${field('Open spots', 'vacancies', 2, 'type="number" min="1" max="10" required')}</div>
    ${field('Skills needed (comma separated)', 'requiredSkills', '', 'required placeholder="react, figma, python"')}
    <button class="btn">Publish project</button></form>`;
};

views.profile = async () => {
  if (needLogin()) return;
  app.innerHTML = `<h1>Your profile</h1><p class="muted">${esc(me.email)} · Skills and interests power your matches.</p>
    <form class="box" data-form="profile">
      ${field('Name', 'name', me.name, 'required')}
      <div class="two">${field('College', 'college', me.college)}${field('Branch', 'branch', me.branch)}</div>
      <div class="two">${field('Year', 'year', me.year, 'placeholder="2nd year"')}${field('GitHub link', 'github', me.github)}</div>
      ${field('Skills (comma separated)', 'skills', me.skills.join(', '), 'placeholder="react, python, figma"')}
      ${field('Interests (comma separated)', 'interests', me.interests.join(', '), 'placeholder="fintech, health, ai"')}
      <label>Short bio<textarea name="bio">${esc(me.bio)}</textarea></label>
      <label>Experience<textarea name="experience" placeholder="Hackathons, internships, projects...">${esc(me.experience)}</textarea></label>
      <button class="btn">Save profile</button></form>`;
};

views.requests = async () => {
  if (needLogin()) return;
  const all = await api('/requests');
  const incoming = all.filter((r) => r.toUserId === me.id);
  const outgoing = all.filter((r) => r.fromUserId === me.id);
  const line = (r, inbox) => {
    const text = inbox
      ? (r.kind === 'apply' ? `<b>${esc(r.from.name)}</b> wants to join <a href="#/project/${r.projectId}">${esc(r.projectTitle)}</a>` : `<b>${esc(r.from.name)}</b> invited you to <a href="#/project/${r.projectId}">${esc(r.projectTitle)}</a>`)
      : (r.kind === 'apply' ? `You applied to <a href="#/project/${r.projectId}">${esc(r.projectTitle)}</a>` : `You invited <b>${esc(r.to.name)}</b> to <a href="#/project/${r.projectId}">${esc(r.projectTitle)}</a>`);
    const skills = inbox && r.kind === 'apply' ? `<div class="row">${chips(r.from.skills)}</div>` : '';
    const btns = inbox && r.status === 'pending'
      ? `<div class="row"><button class="btn small" data-act="respond" data-id="${r.id}" data-a="accept">Accept</button>
         <button class="btn ghost small" data-act="respond" data-id="${r.id}" data-a="decline">Decline</button></div>` : '';
    return `<div class="card"><div>${text}</div>${r.message ? `<p class="muted">“${esc(r.message)}”</p>` : ''}${skills}
      <span class="status-${r.status}">${r.status}</span>${btns}</div>`;
  };
  app.innerHTML = `<h1>Requests</h1><h2>Received</h2>
    <div class="grid">${incoming.map((r) => line(r, true)).join('') || empty('Nothing here yet.')}</div>
    <h2>Sent</h2><div class="grid">${outgoing.map((r) => line(r, false)).join('') || empty('You haven\'t sent any requests.')}</div>`;
};

views.login = async () => {
  app.innerHTML = `<h1>Join TeamUp</h1>
    <form class="box" data-form="login"><h3>Log in</h3>${field('Email', 'email', '', 'type="email" required')}
      ${field('Password', 'password', '', 'type="password" required')}<button class="btn">Log in</button>
      <p class="tag">Demo account: aarav@demo.com / demo1234</p></form>
    <h2>New here?</h2>
    <form class="box" data-form="register"><h3>Create account</h3>${field('Name', 'name', '', 'required')}
      ${field('Email', 'email', '', 'type="email" required')}${field('Password (6+ characters)', 'password', '', 'type="password" minlength="6" required')}
      <button class="btn">Sign up</button></form>`;
};

// ---------- form submits ----------
async function startSession(data, then) {
  token = data.token; localStorage.setItem('token', token); me = data.user; location.hash = then;
}
const forms = {
  login: async (d) => { await startSession(await api('/login', 'POST', d), '#/'); toast('Welcome back!'); },
  register: async (d) => { await startSession(await api('/register', 'POST', d), '#/profile'); toast('Account created. Add your skills!'); },
  profile: async (d) => { me = await api('/me', 'PUT', d); toast('Profile saved'); renderNav(); },
  newProject: async (d) => { const p = await api('/projects', 'POST', d); toast('Project published'); location.hash = '#/project/' + p.id; },
  apply: async (d) => { await api('/requests', 'POST', d); toast('Request sent'); renderNav(); },
  invite: async (d) => { await api('/requests', 'POST', d); toast('Invitation sent'); },
};
document.addEventListener('submit', async (e) => {
  const name = e.target.dataset.form;
  if (!name) return;
  e.preventDefault();
  try { await forms[name](Object.fromEntries(new FormData(e.target))); } catch (err) { toast(err.message, true); }
});

// ---------- button clicks ----------
const actions = {
  logout: async () => { try { await api('/logout', 'POST'); } catch (e) {} token = null; me = null; localStorage.removeItem('token'); toast('Logged out'); },
  respond: async (b) => { await api(`/requests/${b.id}/respond`, 'POST', { action: b.a }); toast(b.a === 'accept' ? 'Accepted. They\'re on the team!' : 'Declined'); route(); },
  deleteProject: async (b) => { if (!confirm('Delete this project?')) return; await api('/projects/' + b.id, 'DELETE'); toast('Project deleted'); location.hash = '#/projects'; },
};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  try { await actions[b.dataset.act](b.dataset); if (b.dataset.act === 'logout') route(); } catch (err) { toast(err.message, true); }
});

// ---------- router ----------
async function route() {
  const [, page, arg] = location.hash.split('/');
  await renderNav();
  try { await (views[page || 'home'] || views.home)(arg); }
  catch (e) { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

(async () => {
  if (token) { try { me = await api('/me'); } catch (e) { token = null; localStorage.removeItem('token'); } }
  route();
})();
