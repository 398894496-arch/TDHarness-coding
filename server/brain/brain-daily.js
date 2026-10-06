'use strict';
// One job: full L0 write, L1 distill, correction harvest, L2 provisional.
// Production write needs --write --allow-prod.

const path = require('path');
const lib = require('./lib');
const homes = require('./homes-from-share');
const l0 = require('./l0-ingest');
const l1 = require('./l1-daily');
const l2scan = require('./l2-scan');

function runFacts(roots, args, ymd) {
  const facts = require('./l1-facts');
  if (typeof facts.appendFacts !== 'function') return { ok: 0, n: 0 };
  const rosterPath = path.join(roots.brain, '90-system', 'roster.json');
  const roster = require('fs').existsSync(rosterPath) ? lib.loadJson(rosterPath) : { accounts: {} };
  const n = facts.appendFacts(roots.brain, roster, ymd);
  return { ok: 1, n };
}

// A server that has never run this job has an empty brain folder. The layers,
// the correction page and the brain's own list of accounts (who may read what)
// are made here from the people service's roster, once; after that the list
// only grows as new people appear.
function ensureBrain(roots, args) {
  const fs = require('fs');
  const sys = path.join(roots.brain, '90-system');
  const rosterPath = path.join(sys, 'roster.json');
  if (!fs.existsSync(rosterPath)) {
    const peopleFile = args.peopleRoster || homes.peopleRosterOf(roots);
    const people = fs.existsSync(peopleFile) ? (lib.loadJson(peopleFile).people || []) : [];
    const accounts = {};
    const depts = [];
    for (const p of people) {
      if (!p || !p.login || p.status === 'disabled') continue;
      const boss = p.role === 'admin' || p.role === 'boss';
      const dept = boss ? '*' : String(p.dept || 'company');
      accounts[p.login] = { role: boss ? 'boss' : (p.role === 'director' ? 'director' : 'employee'), dept };
      if (!boss && depts.indexOf(dept) < 0) depts.push(dept);
    }
    lib.writeUtf8(rosterPath, JSON.stringify({
      accounts,
      depts: depts.map((id) => ({ id })),
      paths: { l0: '10-l0', l1: '11-l1', l2: '20-l2', corrections: '30-lessons\\corrections.md' }
    }, null, 2) + '\n');
  }
  const corrections = path.join(roots.brain, '30-lessons', 'corrections.md');
  if (!fs.existsSync(corrections)) lib.writeUtf8(corrections, '# 纠错\n\n');
  for (const d of ['10-l0', '11-l1', '20-l2', path.join('90-system', 'l1-audit')]) lib.mkdirp(path.join(roots.brain, d));
}

function run(roots, args) {
  if (args.write) ensureBrain(roots, args);
  const ymd = args.target || lib.previousShanghaiDay();
  const homesFile = args.homesFile || path.join(roots.brain, '90-system', 'homes.json');
  const homeStat = homes.writeHomes(roots, Object.assign({}, args, { homesFile }));
  const ingested = l0.ingestFromHomesFile(roots, Object.assign({}, args, { homesFile }));
  let l1Day = { status: 'skipped', ymd };
  try {
    l1Day = l1.runOneDay(roots, ymd, args);
  } catch (e) {
    l1Day = { status: 'failed', ymd, error: String(e && e.message ? e.message : e) };
  }
  let facts = { ok: 0, n: 0 };
  try { facts = runFacts(roots, args, ymd); }
  catch (e) { facts = { ok: 0, n: 0, error: String(e && e.message ? e.message : e) }; }
  const scan = l2scan.scanPromote(roots, args);
  const receipt = {
    at: lib.nowIso(),
    ymd,
    homes: homeStat.n,
    l0_added: ingested.added,
    l0_scanned: ingested.scanned,
    l1: l1Day.status,
    l1_model: l1Day.audit && l1Day.audit.model ? l1Day.audit.model : '',
    facts: facts.n,
    l2: scan.actions.map((a) => a.action),
    corrections: scan.corrections.added
  };
  if (args.write) {
    lib.writeUtf8(
      path.join(roots.brain, '90-system', 'brain-daily', ymd + '.json'),
      JSON.stringify(receipt, null, 2) + '\n'
    );
  }
  return { ymd, homeStat, ingested, l1Day, facts, scan, receipt };
}

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  lib.ensureNotProdWrite(roots, args);
  const r = run(roots, args);
  process.stdout.write('TARGET=' + r.ymd + '\n');
  process.stdout.write('HOMES_N=' + r.homeStat.n + '\n');
  process.stdout.write('L0_SCANNED=' + r.ingested.scanned + '\n');
  process.stdout.write('L0_ADDED=' + r.ingested.added + '\n');
  process.stdout.write('L1_STATUS=' + r.l1Day.status + '\n');
  process.stdout.write('L1_MODEL=' + (r.l1Day.audit && r.l1Day.audit.model ? r.l1Day.audit.model : '') + '\n');
  process.stdout.write('FACTS_N=' + r.facts.n + '\n');
  process.stdout.write('CORR_ADD=' + r.scan.corrections.added + '\n');
  process.stdout.write('L2_SCAN_N=' + r.scan.fingerprints + '\n');
  for (const a of r.scan.actions) {
    process.stdout.write('L2|' + a.fingerprint + '|' + a.action + '\n');
  }
  if (r.l1Day.status === 'failed') process.exitCode = 1;
  process.stdout.write('BRAIN_DAILY_OK=1\n');
}

module.exports = { run };
if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
