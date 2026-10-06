'use strict';
// Build homes.json from the people roster + seats on the company share.
// Sessions live on the share. Do not wait for pull-map / l0-drop.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function deptOf(person) {
  const d = String(person && person.dept || '').toLowerCase();
  if (!d || d === '*' || d === 'company') return 'boss';
  return d;
}

function winPath(p) {
  const s = String(p || '');
  if (process.platform === 'win32') return s.replace(/\//g, '\\');
  return s.replace(/\\/g, '/');
}

function fromPeople(rosterPath) {
  if (!fs.existsSync(rosterPath)) return [];
  const j = lib.loadJson(rosterPath);
  const rows = [];
  for (const p of j.people || []) {
    if (!p || (p.status && p.status !== 'active')) continue;
    const home = p.personal || p.workspace;
    if (!home) continue;
    rows.push({
      account: p.login,
      dept: deptOf(p),
      dshHome: winPath(home),
      role: 'desk',
      ingest: 'allow'
    });
  }
  return rows;
}

function walkShare(company) {
  const out = [];
  if (!fs.existsSync(company)) return out;
  let depts;
  try { depts = fs.readdirSync(company, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const ent of depts) {
    if (!ent.isDirectory()) continue;
    if (ent.name.charAt(0) === '_' && ent.name !== '_office') continue;
    const deptPath = path.join(company, ent.name);
    if (ent.name === '_office') {
      out.push({
        account: 'boss',
        dept: 'boss',
        dshHome: winPath(deptPath),
        role: 'desk',
        ingest: 'allow'
      });
      continue;
    }
    let seats;
    try { seats = fs.readdirSync(deptPath, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const seat of seats) {
      if (!seat.isDirectory()) continue;
      const full = path.join(deptPath, seat.name);
      const desk = path.join(full, '.dsh-desk');
      if (!fs.existsSync(desk) && !fs.existsSync(path.join(full, 'sessions'))) continue;
      let account = seat.name;
      if (account.indexOf('emp-') === 0) account = account.slice(4);
      out.push({
        account,
        dept: ent.name,
        dshHome: winPath(full),
        role: 'desk',
        ingest: 'allow'
      });
    }
  }
  return out;
}

function mergeRows(parts) {
  const seen = new Set();
  const out = [];
  for (const list of parts) {
    for (const row of list) {
      if (!row || !row.dshHome) continue;
      const k = String(row.dshHome).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }
  return out;
}

function syncBrainAccounts(brain, peopleRows) {
  const p = path.join(brain, '90-system', 'roster.json');
  if (!fs.existsSync(p)) return 0;
  const roster = lib.loadJson(p);
  if (!roster.accounts) roster.accounts = {};
  let n = 0;
  for (const row of peopleRows) {
    if (roster.accounts[row.account]) continue;
    roster.accounts[row.account] = { role: 'employee', dept: row.dept };
    n++;
  }
  if (n) lib.writeUtf8(p, JSON.stringify(roster, null, 2) + '\n');
  return n;
}

// Where the people service keeps its roster: beside the other runtime files.
function peopleRosterOf(roots) {
  return path.join(roots.company, '..', 'runtime', 'roster.json');
}

function writeHomes(roots, args) {
  const dest = args.homesFile || path.join(roots.brain, '90-system', 'homes.json');
  const peopleFile = args.peopleRoster || peopleRosterOf(roots);
  const existing = fs.existsSync(dest) ? (lib.loadJson(dest) || []) : [];
  const keep = (Array.isArray(existing) ? existing : []).filter((r) => r && r.dshHome);
  const people = fromPeople(peopleFile);
  const walked = walkShare(roots.company);
  const rows = mergeRows([people, walked, keep]);
  if (args.write) {
    lib.writeUtf8(dest, JSON.stringify(rows, null, 2) + '\n');
    syncBrainAccounts(roots.brain, rows);
  }
  return { dest, n: rows.length, people: people.length, walked: walked.length };
}

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  lib.ensureNotProdWrite(roots, args);
  const r = writeHomes(roots, args);
  process.stdout.write('HOMES_FILE=' + r.dest + '\n');
  process.stdout.write('HOMES_N=' + r.n + '\n');
  process.stdout.write('HOMES_PEOPLE=' + r.people + '\n');
  process.stdout.write('HOMES_WALK=' + r.walked + '\n');
  process.stdout.write('HOMES_FROM_SHARE_OK=1\n');
}

module.exports = { writeHomes, peopleRosterOf, fromPeople, walkShare, mergeRows, syncBrainAccounts };
if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
