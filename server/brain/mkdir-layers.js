'use strict';

const path = require('path');
const lib = require('./lib');

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  const roster = lib.loadRoster(roots.brain);
  const depts = (roster.depts || []).map((d) => d.id);
  const dirs = [
    path.join(roots.brain, '10-l0'),
    path.join(roots.brain, '11-l1'),
    path.join(roots.brain, '20-l2'),
    path.join(roots.brain, '_inbox'),
    path.join(roots.brain, '_inbox', 'boss'),
    path.join(roots.brain, '90-system', 'l1-audit')
  ];
  const accounts = roster.accounts || {};
  for (const d of depts) {
    dirs.push(path.join(roots.brain, '10-l0', d));
    dirs.push(path.join(roots.brain, '11-l1', d));
    dirs.push(path.join(roots.brain, '20-l2', d));
    dirs.push(path.join(roots.brain, '_inbox', 'director', d));
  }
  for (const id of Object.keys(accounts)) {
    const acct = accounts[id];
    const deptDir = (!acct.dept || acct.dept === '*') ? 'boss' : acct.dept;
    dirs.push(path.join(roots.brain, '11-l1', deptDir, id));
    dirs.push(path.join(roots.brain, '10-l0', deptDir, id));
  }
  if (!args.write) {
    process.stdout.write('DRY_RUN dirs=' + dirs.length + '\n');
    return;
  }
  if (lib.isProdBrain(roots.brain) && !args.allowProd) {
    throw new Error('production mkdir needs --allow-prod');
  }
  for (const d of dirs) lib.mkdirp(d);
  process.stdout.write('MKDIR=' + dirs.length + '\n');
  for (const d of dirs) process.stdout.write('DIR|' + d + '\n');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
