// TeamUp backend: Express + a JSON file as the "database".
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
let db = { users: [], projects: [], requests: [], sessions: {} };

// ---------- tiny database helpers ----------
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const uid = () => crypto.randomBytes(6).toString('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
// "React, Node.js" or ["React"] -> ["react","node.js"]
const norm = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 30);

function makeUser(d) {
  const salt = crypto.randomBytes(8).toString('hex');
  return {
    id: uid(), name: String(d.name).trim(), email: String(d.email).trim().toLowerCase(),
    salt, hash: hashPw(d.password, salt),
    college: d.college || '', branch: d.branch || '', year: d.year || '',
    bio: d.bio || '', experience: d.experience || '', github: d.github || '',
    skills: norm(d.skills), interests: norm(d.interests), createdAt: Date.now(),
  };
}
const selfView = ({ hash, salt, ...u }) => u;          // what I see about myself
const publicView = ({ hash, salt, email, ...u }) => u; // what others see (no email)
const find = (list, id) => list.find((x) => x.id === id);

// ---------- matching: the "smart" part ----------
// Looks at which required skills the team is STILL missing (after counting
// current members' skills) and scores a person on how many of those they cover.
function match(user, project) {
  const members = project.members.map((id) => find(db.users, id)).filter(Boolean);
  const covered = new Set(members.flatMap((m) => m.skills));
  const missing = project.requiredSkills.filter((s) => !covered.has(s));
  const target = missing.length ? missing : project.requiredSkills;
  const skills = target.filter((s) => user.skills.includes(s));
  const text = (project.title + ' ' + project.description).toLowerCase();
  const interests = user.interests.filter((i) => text.includes(i));
  const skillScore = target.length ? skills.length / target.length : 0;
  const interestScore = Math.min(1, interests.length / 2);
  return { score: Math.round((skillScore * 0.75 + interestScore * 0.25) * 100), skills, interests };
}

const projectView = (p) => ({
  ...p,
  ownerName: (find(db.users, p.ownerId) || {}).name || 'Unknown',
  memberList: p.members.map((id) => find(db.users, id)).filter(Boolean)
    .map((u) => ({ id: u.id, name: u.name, skills: u.skills })),
});

// ---------- auth ----------
function startSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.id; save();
  return { token, user: selfView(user) };
}
function getUser(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  return find(db.users, db.sessions[t]);
}
const optAuth = (req, res, next) => { req.user = getUser(req); next(); };
const auth = (req, res, next) => {
  req.user = getUser(req);
  if (!req.user) return res.status(401).json({ error: 'Please log in first' });
  next();
};
const fail = (res, code, error) => res.status(code).json({ error });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.password || b.password.length < 6)
    return fail(res, 400, 'Name, email and a password of at least 6 characters are required');
  if (db.users.some((u) => u.email === b.email.trim().toLowerCase()))
    return fail(res, 400, 'That email is already registered');
  const user = makeUser(b);
  db.users.push(user);
  res.json(startSession(user));
});

app.post('/api/login', (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const user = db.users.find((u) => u.email === email.trim().toLowerCase());
  const ok = user && crypto.timingSafeEqual(Buffer.from(hashPw(password, user.salt)), Buffer.from(user.hash));
  if (!ok) return fail(res, 401, 'Wrong email or password');
  res.json(startSession(user));
});

app.post('/api/logout', auth, (req, res) => {
  delete db.sessions[(req.headers.authorization || '').replace('Bearer ', '')];
  save(); res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(selfView(req.user)));

app.put('/api/me', auth, (req, res) => {
  const b = req.body || {};
  for (const f of ['name', 'college', 'branch', 'year', 'bio', 'experience', 'github'])
    if (typeof b[f] === 'string') req.user[f] = b[f].trim();
  if (!req.user.name) return fail(res, 400, 'Name cannot be empty');
  if ('skills' in b) req.user.skills = norm(b.skills);
  if ('interests' in b) req.user.interests = norm(b.interests);
  save(); res.json(selfView(req.user));
});

// ---------- people ----------
app.get('/api/users', optAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const skill = (req.query.skill || '').toLowerCase().trim();
  const list = db.users
    .filter((u) => !q || [u.name, u.college, u.branch, u.bio, ...u.interests].join(' ').toLowerCase().includes(q))
    .filter((u) => !skill || u.skills.some((s) => s.includes(skill)))
    .map(publicView);
  res.json(list);
});

// ---------- projects ----------
app.get('/api/projects', optAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const skill = (req.query.skill || '').toLowerCase().trim();
  const type = req.query.type || '';
  let list = db.projects
    .filter((p) => !q || (p.title + ' ' + p.description).toLowerCase().includes(q))
    .filter((p) => !skill || p.requiredSkills.some((s) => s.includes(skill)))
    .filter((p) => !type || p.type === type)
    .filter((p) => req.query.open !== '1' || p.status === 'open')
    .map((p) => ({ ...projectView(p), match: req.user ? match(req.user, p) : null }));
  res.json(list.sort((a, b) => b.createdAt - a.createdAt));
});

app.post('/api/projects', auth, (req, res) => {
  const b = req.body || {};
  const requiredSkills = norm(b.requiredSkills);
  const vacancies = parseInt(b.vacancies, 10);
  if (!b.title || !b.description) return fail(res, 400, 'Title and description are required');
  if (!requiredSkills.length) return fail(res, 400, 'Add at least one required skill');
  if (!(vacancies >= 1 && vacancies <= 10)) return fail(res, 400, 'Vacancies must be between 1 and 10');
  const p = {
    id: uid(), ownerId: req.user.id, title: b.title.trim(), description: b.description.trim(),
    type: b.type || 'Hackathon', requiredSkills, vacancies, deadline: b.deadline || '',
    status: 'open', members: [req.user.id], createdAt: Date.now(),
  };
  db.projects.push(p); save(); res.json(projectView(p));
});

app.get('/api/projects/:id', optAuth, (req, res) => {
  const p = find(db.projects, req.params.id);
  if (!p) return fail(res, 404, 'Project not found');
  res.json({ ...projectView(p), match: req.user ? match(req.user, p) : null });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  const p = find(db.projects, req.params.id);
  if (!p || p.ownerId !== req.user.id) return fail(res, 403, 'Only the owner can delete this project');
  db.projects = db.projects.filter((x) => x !== p);
  db.requests = db.requests.filter((r) => r.projectId !== p.id);
  save(); res.json({ ok: true });
});

// Best teammates for MY project
app.get('/api/projects/:id/suggestions', auth, (req, res) => {
  const p = find(db.projects, req.params.id);
  if (!p || p.ownerId !== req.user.id) return fail(res, 403, 'Only the owner can see suggestions');
  const list = db.users.filter((u) => !p.members.includes(u.id))
    .map((u) => ({ ...publicView(u), match: match(u, p) }))
    .filter((u) => u.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score).slice(0, 6);
  res.json(list);
});

// Best projects for ME
app.get('/api/recommendations', auth, (req, res) => {
  const list = db.projects.filter((p) => p.status === 'open' && !p.members.includes(req.user.id))
    .map((p) => ({ ...projectView(p), match: match(req.user, p) }))
    .filter((p) => p.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score);
  res.json(list);
});

// ---------- collaboration requests ----------
// apply: me -> project owner.   invite: owner -> another student.
app.post('/api/requests', auth, (req, res) => {
  const { projectId, toUserId, message = '' } = req.body || {};
  const p = find(db.projects, projectId);
  if (!p) return fail(res, 404, 'Project not found');
  if (p.status !== 'open') return fail(res, 400, 'This team is already full');
  let kind, to;
  if (toUserId) {
    if (p.ownerId !== req.user.id) return fail(res, 403, 'Only the owner can send invitations');
    if (!find(db.users, toUserId)) return fail(res, 404, 'Student not found');
    kind = 'invite'; to = toUserId;
  } else {
    if (p.ownerId === req.user.id) return fail(res, 400, 'You own this project');
    kind = 'apply'; to = p.ownerId;
  }
  const joiner = kind === 'invite' ? to : req.user.id;
  if (p.members.includes(joiner)) return fail(res, 400, 'Already on the team');
  if (db.requests.some((r) => r.projectId === p.id && r.status === 'pending' &&
      ((r.kind === kind && r.fromUserId === req.user.id && r.toUserId === to))))
    return fail(res, 400, 'You already sent this request');
  const r = { id: uid(), projectId: p.id, kind, fromUserId: req.user.id, toUserId: to,
    message: String(message).slice(0, 300), status: 'pending', createdAt: Date.now() };
  db.requests.push(r); save(); res.json(r);
});

app.get('/api/requests', auth, (req, res) => {
  const who = (id) => { const u = find(db.users, id) || {}; return { id: u.id, name: u.name, skills: u.skills || [] }; };
  const rows = db.requests.filter((r) => r.fromUserId === req.user.id || r.toUserId === req.user.id)
    .map((r) => ({ ...r, projectTitle: (find(db.projects, r.projectId) || {}).title, from: who(r.fromUserId), to: who(r.toUserId) }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(rows);
});

app.post('/api/requests/:id/respond', auth, (req, res) => {
  const r = find(db.requests, req.params.id);
  if (!r || r.status !== 'pending') return fail(res, 404, 'Request not found or already answered');
  if (r.toUserId !== req.user.id) return fail(res, 403, 'This request is not addressed to you');
  const p = find(db.projects, r.projectId);
  if (req.body.action === 'accept') {
    if (!p || p.vacancies < 1) return fail(res, 400, 'No spots left on this team');
    const joiner = r.kind === 'invite' ? r.toUserId : r.fromUserId;
    if (!p.members.includes(joiner)) { p.members.push(joiner); p.vacancies--; }
    if (p.vacancies === 0) p.status = 'full';
    r.status = 'accepted';
  } else r.status = 'declined';
  save(); res.json(r);
});

// ---------- demo data (only on first run) ----------
function seed() {
  const U = (name, college, branch, year, skills, interests, bio) => makeUser({
    name, email: name.split(' ')[0].toLowerCase() + '@demo.com', password: 'demo1234',
    college, branch, year, skills, interests, bio });
  const [aarav, isha, rohan, sneha, kabir, meera] = [
    U('Aarav Sharma', 'COEP Pune', 'Computer Engg', '3rd year', 'react, node.js, mongodb', 'fintech, web3', 'Full-stack tinkerer who ships on weekends.'),
    U('Isha Patil', 'MIT-WPU Pune', 'IT', '2nd year', 'figma, ui/ux, css, react', 'edtech, health', 'Designer who codes just enough to be dangerous.'),
    U('Rohan Mehta', 'VIT Pune', 'AI & DS', '3rd year', 'python, machine learning, tensorflow', 'health, ai', 'Likes turning messy data into models.'),
    U('Sneha Kulkarni', 'PICT Pune', 'Computer Engg', '4th year', 'flutter, firebase, dart', 'edtech, mobile', 'Built 3 apps, shipped 1.'),
    U('Kabir Singh', 'COEP Pune', 'E&TC', '3rd year', 'arduino, c++, iot, embedded', 'robotics, smart city', 'Hardware hacker.'),
    U('Meera Nair', 'SPPU Pune', 'Statistics', '3rd year', 'python, sql, data analysis, tableau', 'fintech, sustainability', 'Finds the story inside spreadsheets.'),
  ];
  const P = (o, title, description, type, skills, vacancies) => ({
    id: uid(), ownerId: o.id, title, description, type, requiredSkills: norm(skills),
    vacancies, deadline: '', status: 'open', members: [o.id], createdAt: Date.now() });
  db.users = [aarav, isha, rohan, sneha, kabir, meera];
  db.projects = [
    P(aarav, 'Campus Expense Splitter', 'A fintech app so hostel roommates can split bills and track who owes what. Entering a 24-hour hackathon.', 'Hackathon', 'react, node.js, figma, ui/ux', 2),
    P(rohan, 'Early Disease Screening Bot', 'Health chatbot that flags early symptoms using a small ML model. College final-year project.', 'College project', 'python, machine learning, flutter, data analysis', 2),
    P(kabir, 'Smart Parking for Campus', 'IoT sensors + dashboard to show free parking slots live. Smart city competition entry.', 'Competition', 'arduino, iot, react, sql', 3),
    P(sneha, 'Study Buddy Mobile App', 'Edtech app that matches students for group study sessions and tracks streaks.', 'Hackathon', 'flutter, firebase, figma', 1),
  ];
}

// ---------- start ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
else { seed(); save(); }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TeamUp running at http://localhost:${PORT}`));
