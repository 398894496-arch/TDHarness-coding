'use strict';

// Company knowledge search. Listens on loopback only; the LAN reaches it
// through the login site at /company/knowledge (Caddy strips that prefix).
//
// Every search needs the gateway token a person got at login (Authorization:
// Bearer dsh_... or X-Company-Gw-Token). The token must be live in
// gw-tokens.json and belong to an active person on the roster, so revoking a
// token or disabling a person cuts search off at once. Name headers such as
// X-Auth-Request-User are ignored: anyone can type a name into a header.
//
// What a person can find is decided by where a file sits, then narrowed by its
// frontmatter; frontmatter never widens it. visibility: self = the owner, the
// director of the owner's department and admins; dept = that department; boss =
// admins; company = no narrowing. By folder:
//   everyone   company/_handbook/_company     documents for the whole company
//              company/_shared/_memory        company memory (admins and directors write it)
//              brain/30-lessons, 00-company   corrections, company facts
//              their own personal _memory and their own daily pages (11-l1, 10-logs)
//   department company/_handbook/<dept>, brain/20-l2/<dept>
//   director   + the daily pages and inbox of their department
//   admin      every handbook, every daily page and lesson, the boss inbox
// Raw conversations (brain/10-l0) never come up in a search; they are read one
// file at a time by path (evidence), by their owner, the director of that
// department, or an admin. brain/90-system is never served.
//
// Ranking, passages and office files: kb-index.js.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createIndex } = require('./kb-index');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const BRAIN = process.env.TDH_BRAIN || path.join(ROOT, 'brain');
const COMPANY = process.env.TDH_COMPANY || path.join(ROOT, 'company');
const PORT = Number(process.env.TDH_KNOW_PORT || 4182);
const TOKENS = process.env.TDH_GW_TOKENS || path.join(ROOT, 'runtime', 'gw-tokens.json');
const ROSTER = process.env.TDH_ROSTER || path.join(ROOT, 'runtime', 'roster.json');
const LOG = process.env.TDH_KNOW_LOG || path.join(ROOT, 'logs', 'knowledge-search.log');
const LIMIT = 24;

const index = createIndex({
  skipDir: (name) => name.charAt(0) === '.' || name === 'node_modules' || name === '90-system',
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}

function tokenOf(req) {
  const h = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-company-gw-token'] || '').trim();
}

// The person behind a live token, or null when there is none.
function personOf(token) {
  if (!token || token.indexOf('dsh_') !== 0) return null;
  const store = readJson(TOKENS);
  const rows = store && Array.isArray(store.tokens) ? store.tokens : [];
  const hit = rows.find((r) => r && !r.revoked_at && String(r.token || '') === token);
  if (!hit || !hit.pid) return null;
  const roster = readJson(ROSTER);
  const people = roster && Array.isArray(roster.people) ? roster.people : [];
  const who = people.find((p) => p && String(p.pid || '') === String(hit.pid));
  if (!who || !who.login || (who.status || 'active') !== 'active') return null;
  const login = String(who.login);
  const role = ['admin', 'director'].indexOf(String(who.role || '')) >= 0 ? String(who.role) : 'employee';
  const dept = String(who.dept || '');
  // The brain files admins (and anyone without a department) under "boss" (homes-from-share.js).
  const bdept = role === 'admin' || !dept || dept === '*' || dept === 'company' ? 'boss' : dept;
  return { login, role, dept, bdept };
}

function audit(login, route, hits) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), login, route, hits }) + '\n');
  } catch (e) { /* the search still answers */ }
}

const safe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]/g, '');
const B = (...p) => path.join(BRAIN, ...p);
const C = (...p) => path.join(COMPANY, ...p);

// <brain>/<layer>/<any dept>/<login>: a person's own pages stay theirs when they change department.
function ownDirs(layer, login) {
  let depts = [];
  try { depts = fs.readdirSync(B(layer), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return []; }
  return depts.map((d) => B(layer, d, login));
}

function personalMemory(person) {
  return person.role === 'admin' ? C('_office', '_memory') : C('content', 'emp-' + safe(person.login), '_memory');
}

function roots(person) {
  const out = [
    C('_handbook', '_company'),
    C('_shared', '_memory'),
    B('30-lessons'),
    B('00-company'),
    personalMemory(person),
  ].concat(ownDirs('11-l1', person.login), ownDirs('10-logs', person.login));
  if (person.role === 'admin') {
    return out.concat([C('_handbook'), B('20-l2'), B('11-l1'), B('10-logs'), B('_inbox')]);
  }
  const d = safe(person.dept);
  const bd = safe(person.bdept);
  if (d) out.push(C('_handbook', d));
  if (bd) out.push(B('20-l2', bd));
  if (person.role === 'director' && bd) out.push(B('11-l1', bd), B('10-logs', bd), B('_inbox', 'director', bd));
  return out;
}

function under(root, full) {
  const a = path.resolve(root).toLowerCase();
  const b = path.resolve(full).toLowerCase();
  return b === a || b.indexOf(a.endsWith(path.sep) ? a : a + path.sep) === 0;
}

// Frontmatter can only narrow what the folder already allows.
function fmAllows(person, fm) {
  const vis = String((fm && fm.visibility) || '').trim();
  if (person.role === 'admin' || !vis || vis === 'company') return true;
  if (fm.owner && String(fm.owner) === person.login) return true;
  const sameDept = [person.dept, person.bdept].indexOf(String(fm.dept || '')) >= 0;
  // self: the owner, the director of the owner's department, admins.
  if (vis === 'self') return person.role === 'director' && sameDept;
  if (vis === 'boss') return false;
  if (vis === 'dept') return sameDept;
  return true;
}

// Raw conversations and daily pages, one file by path: owner, their director, admin.
function evidenceAllows(person, full) {
  if (!under(BRAIN, full) || under(B('90-system'), full)) return false;
  const rel = path.relative(BRAIN, full).split(path.sep);
  if (rel[0] !== '10-l0' && rel[0] !== '11-l1' && rel[0] !== '10-logs') {
    return roots(person).some((r) => under(r, full));
  }
  if (person.role === 'admin') return true;
  if (rel[2] === person.login) return true;
  return person.role === 'director' && rel[1] === person.bdept;
}

function relName(full) {
  if (under(COMPANY, full)) return 'company/' + path.relative(COMPANY, full).split(path.sep).join('/');
  return path.relative(BRAIN, full).split(path.sep).join('/');
}

function layerOf(full) {
  const r = relName(full);
  if (/^10-l0\//.test(r)) return 'evidence';
  if (/^company\/_handbook\//.test(r)) return 'handbook';
  if (/\/_memory\//.test(r)) return 'memory';
  if (/^(11-l1|10-logs)\//.test(r)) return 'daily';
  if (/^(20-l2|30-lessons|00-company)\//.test(r)) return 'lesson';
  if (/^_inbox\//.test(r)) return 'inbox';
  return 'lookup';
}

function hit(h) {
  return { layer: layerOf(h.full), path: relName(h.full), line: h.line, text: h.text, title: h.title };
}

function resolveNamed(named) {
  let p = String(named || '').trim().replace(/\\/g, '/');
  if (!p) return '';
  if (/^[A-Za-z]:\//.test(p) || p.charAt(0) === '/') {
    const abs = path.resolve(p);
    return under(BRAIN, abs) || under(COMPANY, abs) ? abs : '';
  }
  p = p.replace(/^\/+/, '');
  if (p.indexOf('company/') === 0) return path.resolve(COMPANY, p.slice('company/'.length));
  return path.resolve(BRAIN, p);
}

function search(person, body) {
  const route = String(body.route || 'search');
  const query = String(body.query || '').trim();
  const who = { account: person.login, role: person.role, dept: person.dept };
  if (route === 'status') {
    return { ok: true, status: 'ok', ...who, layer: 'lookup', hits: [], index: index.stats() };
  }
  const named = String(body.path || body.evidence_path || '').trim();
  if (body.evidence && !named) return { ok: false, status: 'evidence-need-path', ...who, hits: [] };
  if (named) {
    const full = resolveNamed(named);
    const doc = full && fs.existsSync(full) ? index.docs([full])[0] : null;
    if (!doc || !evidenceAllows(person, full) || !fmAllows(person, doc.doc.fm)) {
      return { ok: true, status: 'not-found', ...who, evidence: true, layer: 'evidence', hits: [] };
    }
    let found = query ? index.search([full], [query], { limit: 6, perFile: 6 }) : [];
    if (!found.length) found = index.preview(full, 6);
    return { ok: true, status: found.length ? 'ok' : 'not-found', ...who, evidence: true, layer: 'evidence', hits: found.map(hit) };
  }
  if (!query) return { ok: false, status: 'bad-request', ...who, hits: [] };
  const found = index.search(roots(person), [query], { limit: LIMIT, perFile: 3, allow: (full, fm) => fmAllows(person, fm) });
  return { ok: true, status: found.length ? 'ok' : 'not-found', ...who, layer: 'lookup', hits: found.map(hit) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, obj) => {
    const raw = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(raw + '\n');
  };
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  if (req.method === 'POST' && (url.pathname === '/v1/search' || url.pathname === '/v1/prior-work')) {
    const person = personOf(tokenOf(req));
    if (!person) {
      audit('', url.pathname, -1);
      json(401, { ok: false, status: 'login-required', hits: [] });
      return;
    }
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
      json(400, { ok: false, status: 'bad-request', hits: [] });
      return;
    }
    let out;
    try { out = search(person, body || {}); } catch (e) {
      out = { ok: false, status: 'search-failed', hits: [] };
    }
    audit(person.login, url.pathname, out.hits.length);
    json(200, { ...out, login: person.login });
    return;
  }
  json(404, { status: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('LISTEN=127.0.0.1:' + PORT + '\n');
  // Read everything once in the background so the first question is not the slow one.
  setTimeout(() => { try { index.docs([BRAIN, C('_handbook'), C('_shared', '_memory'), C('_office', '_memory')]); } catch (e) { /* lazily then */ } }, 50);
});
