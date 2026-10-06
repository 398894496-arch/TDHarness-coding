'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const schemaWrite = require('./schema-write');

function l2Path(brain, dept, fingerprint) {
  return path.join(brain, '20-l2', dept, fingerprint + '.md');
}

function acceptRoot(company) {
  return path.join(company, lib.ZH.acceptDir, lib.ZH.passed);
}

function findTickets(company, fingerprint) {
  const root = acceptRoot(company);
  const files = lib.listMd(root);
  const hits = [];
  for (const f of files) {
    const text = lib.readUtf8(f);
    const fm = lib.readFrontmatter(text);
    if (String(fm.fingerprint || '').toLowerCase() === fingerprint.toLowerCase()) {
      hits.push({ path: f, fm, text });
    }
  }
  return hits;
}

function findL0Sources(brain, fingerprint) {
  const hits = [];
  for (const f of lib.listMd(path.join(brain, '10-l0'))) {
    const text = lib.readUtf8(f);
    if (text.toLowerCase().indexOf(fingerprint.toLowerCase()) !== -1) hits.push(f);
  }
  return hits;
}

function notifyInbox(brain, dept, fingerprint, status, write) {
  const ymd = lib.shanghaiTodayMs();
  const body = [
    '---',
    'date: ' + ymd,
    'kind: l2-notify',
    'fingerprint: ' + fingerprint,
    'status: ' + status,
    '---',
    '',
    '# L2 ' + fingerprint + ' ' + status,
    ''
  ].join('\n');
  const dirPath = path.join(brain, '_inbox', 'director', dept, ymd + '-l2-' + fingerprint + '.md');
  const bossPath = path.join(brain, '_inbox', 'boss', ymd + '-l2-' + fingerprint + '.md');
  if (write) {
    lib.writeUtf8(dirPath, body);
    lib.writeUtf8(bossPath, body);
  }
  return [dirPath, bossPath];
}

function renderL2(rec) {
  const fm = {
    owner: rec.adopted_by || rec.accepted_by || rec.dept,
    dept: rec.dept,
    visibility: 'company',
    layer: 'l2',
    status: rec.status,
    fingerprint: rec.fingerprint,
    source_l0: rec.source_l0,
    source_acceptance: rec.source_acceptance,
    adopted_by: rec.adopted_by || '',
    accepted_by: rec.accepted_by || '',
    backlink_l0: rec.source_l0 || 'none',
    backlink_l1: rec.source_acceptance || 'none',
    evidence_level: 'accepted',
    adopt_status: rec.status === 'adopted' ? 'adopted' : 'candidate'
  };
  schemaWrite.assertNote(fm, 'l2');
  return [
    schemaWrite.renderFrontmatter(fm),
    '',
    '# ' + rec.fingerprint,
    '',
    'status=' + rec.status,
    ''
  ].join('\n');
}

function promote(roots, args) {
  const fp = String(args.fingerprint || '').toLowerCase();
  if (!lib.fingerprintOk(fp)) throw new Error('bad-fingerprint ' + fp);
  const dept = fp.split('.')[0];
  const dest = l2Path(roots.brain, dept, fp);
  const tickets = findTickets(roots.company, fp);
  const l0s = findL0Sources(roots.brain, fp);
  const exists = fs.existsSync(dest);
  let current = exists ? lib.readFrontmatter(lib.readUtf8(dest)) : null;

  if (args.dispute) {
    if (!exists) throw new Error('l2-missing');
    current.status = 'disputed';
    const next = Object.assign({}, current, { status: 'disputed' });
    if (args.write) {
      lib.writeUtf8(dest, renderL2(next));
      const corr = path.join(roots.brain, '30-lessons', 'corrections.md');
      lib.appendUtf8(corr, '\n- provisional-correction fingerprint=' + fp + ' at=' + lib.nowIso() + '\n');
    }
    return { action: 'disputed', path: dest };
  }

  if (!exists) {
    if (tickets.length < 1) {
      return { action: 'no-acceptance', path: dest, status: 'none' };
    }
    const rec = {
      status: 'provisional',
      fingerprint: fp,
      dept,
      source_l0: l0s[0] || '',
      source_acceptance: tickets[0].path,
      adopted_by: '',
      accepted_by: ''
    };
    if (args.write) {
      lib.writeUtf8(dest, renderL2(rec));
      notifyInbox(roots.brain, dept, fp, 'provisional', true);
    }
    return { action: 'created-provisional', path: dest, rec, mustAskAdopt: true };
  }

  if (String(current.status) === 'provisional') {
    const adopt = args.adopt;
    if (!adopt) {
      return { action: 'must-ask-adopt', path: dest, mustAskAdopt: true, rec: current };
    }
    if (tickets.length < 2) {
      return { action: 'keep-provisional', path: dest, rec: current, reason: 'need-second-03' };
    }
    const rec = {
      status: 'active',
      fingerprint: fp,
      dept,
      source_l0: current.source_l0 || l0s[0] || '',
      source_acceptance: tickets[tickets.length - 1].path,
      adopted_by: adopt,
      accepted_by: args.acceptedBy || ''
    };
    if (args.write) {
      lib.writeUtf8(dest, renderL2(rec));
      notifyInbox(roots.brain, dept, fp, 'active', true);
    }
    return { action: 'activated', path: dest, rec, mustAskAdopt: false };
  }

  if (args.reject) {
    current.status = 'rejected';
    if (args.write) lib.writeUtf8(dest, renderL2(Object.assign({}, current, { status: 'rejected' })));
    return { action: 'rejected', path: dest };
  }

  return { action: 'unchanged', path: dest, rec: current };
}

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  lib.ensureNotProdWrite(roots, args);
  const r = promote(roots, args);
  process.stdout.write('ACTION=' + r.action + '\n');
  process.stdout.write('PATH=' + r.path + '\n');
  process.stdout.write('MUST_ASK_ADOPT=' + !!r.mustAskAdopt + '\n');
  if (r.rec) process.stdout.write('STATUS=' + r.rec.status + '\n');
  if (r.reason) process.stdout.write('REASON=' + r.reason + '\n');
}

module.exports = { promote, l2Path, findTickets };
if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
