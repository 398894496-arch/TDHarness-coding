#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');
const daily = require('./brain-daily');

const TARGET = '2026-08-18';
const FP = 'ops.thediva.publish';

function writeZstd(home, id, text) {
  const t = Date.parse(TARGET + 'T10:00:00+08:00');
  const header = {
    type: 'session', version: 0, id, createdAt: t, cwd: home,
    delegationDepth: 0, agentPreset: 'standard'
  };
  const user = {
    type: 'user/message', seq: 1, time: t,
    data: { role: 'user', content: [{ type: 'text', text }] },
    surfaceOp: 'append'
  };
  const jsonl = JSON.stringify(header) + '\n' + JSON.stringify(user) + '\n';
  const destDir = path.join(home, '.dsh-desk', 'sessions', lib.cwdSlug(home), id);
  lib.mkdirp(destDir);
  const dest = path.join(destDir, 'session.jsonl.zstd');
  fs.writeFileSync(dest, lib.zstdFromUtf8(jsonl));
  return dest;
}

function setup(root) {
  const brain = path.join(root, 'brain');
  const company = path.join(root, 'company');
  const seat = path.join(company, 'content', 'emp-a');
  for (const p of [brain, company]) lib.mkdirp(p);
  lib.writeUtf8(path.join(brain, '90-system', 'roster.json'), JSON.stringify({
    company: 'prove',
    accounts: {
      boss: { role: 'boss', dept: '*' },
      director: { role: 'director', dept: 'ops' },
      'emp-a': { role: 'employee', dept: 'ops' }
    },
    depts: [{ id: 'ops' }, { id: 'content' }, { id: 'visual' }, { id: 'wms' }, { id: 'live' }],
    paths: { l0: '10-l0', l1: '11-l1', l2: '20-l2', corrections: '30-lessons\\corrections.md' }
  }, null, 2));
  lib.writeUtf8(path.join(brain, '30-lessons', 'corrections.md'), '# 纠错\n\n');
  const people = path.join(root, 'people.json');
  lib.writeUtf8(people, JSON.stringify({
    people: [{
      login: 'emp-a', role: 'employee', status: 'active', dept: 'ops',
      personal: seat, workspace: seat
    }]
  }, null, 2));
  writeZstd(seat, 'session-prove-aaaa-1111-4111-8111-aaaaaaaaaaa1',
    'publish listing fingerprint: ' + FP);
  writeZstd(seat, 'session-prove-bbbb-2222-4222-8222-bbbbbbbbbbb2',
    '纠错 不是这个 上次写错了');
  const ticketDir = path.join(company, lib.ZH.acceptDir, lib.ZH.passed, 'ops');
  lib.writeUtf8(path.join(ticketDir, FP + '-1.md'), [
    '---',
    'fingerprint: ' + FP,
    'dept: ops',
    'round: 1',
    'status: passed',
    '---',
    '',
    '# ' + FP,
    ''
  ].join('\n'));
  return { brain, company, people, seat };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-daily-'));
  const s = setup(root);
  const roots = { brain: s.brain, company: s.company, homes: s.seat };
  const r = daily.run(roots, {
    write: true,
    target: TARGET,
    peopleRoster: s.people,
    homesFile: path.join(s.brain, '90-system', 'homes.json')
  });
  if (r.ingested.added < 1) throw new Error('l0-added=' + r.ingested.added);
  const l0file = path.join(s.brain, '10-l0', 'ops', 'emp-a', TARGET.slice(0, 7), TARGET + '.md');
  if (!fs.existsSync(l0file)) throw new Error('l0-missing');
  if (r.scan.corrections.added < 1) throw new Error('corr-add=' + r.scan.corrections.added);
  const corr = lib.readUtf8(path.join(s.brain, '30-lessons', 'corrections.md'));
  if (corr.indexOf('user-correction') < 0) throw new Error('corr-text');
  const l2hit = r.scan.actions.find((a) => a.fingerprint === FP);
  if (!l2hit || l2hit.action !== 'created-provisional') {
    throw new Error('l2-action=' + (l2hit && l2hit.action));
  }
  if (!fs.existsSync(l2hit.path)) throw new Error('l2-file');
  const fm = lib.readFrontmatter(lib.readUtf8(l2hit.path));
  if (fm.status !== 'provisional') throw new Error('l2-status=' + fm.status);
  const again = daily.run(roots, {
    write: true,
    target: TARGET,
    peopleRoster: s.people,
    homesFile: path.join(s.brain, '90-system', 'homes.json')
  });
  if (again.ingested.added !== 0) throw new Error('l0-not-idempotent');
  console.log(
    'BRAIN_DAILY_PROVE_OK=1 l0_added=' + r.ingested.added
    + ' corr=' + r.scan.corrections.added
    + ' l2=' + l2hit.action
    + ' l1=' + r.l1Day.status
  );
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
