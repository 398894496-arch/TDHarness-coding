'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const schemaWrite = require('./schema-write');
const distill = require('./l1-distill');

function auditPath(brain, ymd) {
  return path.join(brain, '90-system', 'l1-audit', ymd + '.json');
}
function lockPath(brain, ymd) {
  return path.join(brain, '90-system', 'l1-audit', ymd + '.lock');
}
function runsPath(brain) {
  return path.join(brain, '90-system', 'l1-runs.jsonl');
}
function l1Path(brain, dept, account, ymd) {
  return path.join(brain, '11-l1', dept, account, ymd + '.md');
}
function pendingPath(brain, dept, account, ymd) {
  return l1Path(brain, dept, account, ymd) + '.pending';
}

function deptDirOf(acct) {
  if (!acct || !acct.dept || acct.dept === '*') return 'boss';
  return acct.dept;
}

function rosterPeople(roster) {
  const accounts = roster.accounts || {};
  return Object.keys(accounts).map((id) => ({
    id,
    role: accounts[id].role,
    dept: deptDirOf(accounts[id])
  }));
}

function readAudit(brain, ymd) {
  const p = auditPath(brain, ymd);
  if (!fs.existsSync(p)) return null;
  try { return lib.loadJson(p); } catch (e) { return null; }
}

function parseL0Blocks(text) {
  const blocks = [];
  const parts = String(text || '').split(/^## /m).slice(1);
  for (const part of parts) {
    const rec = { session_id: part.split(/\r?\n/)[0].trim() };
    for (const line of part.split(/\r?\n/)) {
      const m = line.match(/^- ([a-z_]+): (.*)$/);
      if (m) rec[m[1]] = m[2];
    }
    blocks.push(rec);
  }
  return blocks;
}

function classifyBlocks(blocks) {
  const verified = [];
  const inProgress = [];
  const inference = [];
  for (const b of blocks || []) {
    const fact = b.fact || '';
    const title = b.title && b.title !== 'none' ? b.title : '';
    const arts = b.artifacts && b.artifacts !== 'none' ? b.artifacts : '';
    const completion = b.completion || '';
    // what was asked and how it ended says more than the conversation's name
    const line = (fact.indexOf('要求：') === 0 ? fact : (title || fact)) || b.session_id;
    if (completion === 'mechanical-pass') {
      inProgress.push(line + ' [mechanical-pass; lint/file-exists is not work-done]');
      continue;
    }
    if (completion === 'partial') {
      inProgress.push(line);
      continue;
    }
    if (arts || completion === 'reported-complete') {
      verified.push(arts ? line + ' | ' + arts : line);
      continue;
    }
    inference.push(line || 'session-opened');
  }
  return { verified, inProgress, inference };
}

function collectL0(brain, ymd) {
  const root = path.join(brain, '10-l0');
  const files = lib.listMd(root).filter((p) => path.basename(p) === ymd + '.md');
  const byDept = {};
  for (const f of files) {
    const text = lib.readUtf8(f);
    const fm = lib.readFrontmatter(text);
    const dept = fm.dept || 'unknown';
    const account = fm.account || 'unknown';
    const blocks = parseL0Blocks(text);
    if (!byDept[dept]) byDept[dept] = { files: [], accounts: {}, sessions: 0, blocksByAccount: {} };
    byDept[dept].files.push(f);
    byDept[dept].accounts[account] = (byDept[dept].accounts[account] || 0) + blocks.length;
    byDept[dept].sessions += blocks.length;
    if (!byDept[dept].blocksByAccount[account]) byDept[dept].blocksByAccount[account] = [];
    byDept[dept].blocksByAccount[account] = byDept[dept].blocksByAccount[account].concat(blocks);
  }
  return byDept;
}

function yamlOk(text) {
  const fm = lib.readFrontmatter(text);
  return !!(fm && fm.date && fm.layer);
}

function skeletonBody(dept, account, ymd, info) {
  const files = info && info.files ? info.files : [];
  const n = info && info.sessions ? info.sessions : 0;
  const has = n > 0;
  const classified = classifyBlocks(info && info.blocks ? info.blocks : []);
  const fm = {
    date: ymd,
    owner: account,
    dept,
    account,
    visibility: 'company',
    layer: 'l1',
    summary: lib.ZH.pending,
    sessions: n,
    evidence_level: 'observed'
  };
  schemaWrite.assertNote(fm, 'l1');
  const lines = [
    schemaWrite.renderFrontmatter(fm),
    '',
    '# L1 ' + dept + ' / ' + account + ' / ' + ymd,
    '',
    '## skeleton',
    '- who: ' + account,
    '- session_count: ' + n,
    '- l0_paths:',
    ...(files.length ? files.map((f) => '  - ' + f) : ['  - none']),
    '- fail_count: 0',
    '',
    '## verified',
    ...(classified.verified.length ? classified.verified.map((s) => '- ' + s) : ['- none']),
    '',
    '## in_progress',
    ...(classified.inProgress.length ? classified.inProgress.map((s) => '- ' + s) : ['- none']),
    '',
    '## inference',
    ...(classified.inference.length ? classified.inference.map((s) => '- ' + s) : ['- none']),
    '',
    '## narrative',
    has ? lib.ZH.pending : lib.ZH.noActivity,
    ''
  ];
  return lines.join('\n');
}

function deptSummaryBody(dept, ymd, info) {
  const accounts = info && info.accounts ? info.accounts : {};
  const files = info && info.files ? info.files : [];
  const n = info && info.sessions ? info.sessions : 0;
  return [
    '---',
    'date: ' + ymd,
    'dept: ' + dept,
    'layer: inbox',
    'sessions: ' + n,
    '---',
    '',
    '# ' + dept + ' ' + ymd,
    '- who: ' + (Object.keys(accounts).sort().map((a) => a + '=' + accounts[a]).join(', ') || 'none'),
    '- session_count: ' + n,
    '- l0_paths:',
    ...(files.length ? files.map((f) => '  - ' + f) : ['  - none']),
    '',
    n > 0 ? lib.ZH.pending : lib.ZH.noActivity,
    ''
  ].join('\n');
}

function directorDepts(roster) {
  const out = [];
  const accounts = roster.accounts || {};
  for (const id of Object.keys(accounts)) {
    const acct = accounts[id];
    if (acct && acct.role === 'director' && acct.dept && acct.dept !== '*') out.push(acct.dept);
  }
  return out;
}

function writeInbox(brain, ymd, byDept, depts, roster, write) {
  const written = [];
  for (const dept of directorDepts(roster)) {
    const body = deptSummaryBody(dept, ymd, byDept[dept]);
    const p = path.join(brain, '_inbox', 'director', dept, ymd + '.md');
    if (write) lib.writeUtf8(p, body);
    written.push(p);
  }
  const bossParts = ['---', 'date: ' + ymd, 'layer: inbox', 'role: boss', '---', '', '# inbox boss ' + ymd, ''];
  for (const dept of depts) {
    bossParts.push('## ' + dept);
    bossParts.push(deptSummaryBody(dept, ymd, byDept[dept]));
    bossParts.push('');
  }
  const bossPath = path.join(brain, '_inbox', 'boss', ymd + '.md');
  if (write) lib.writeUtf8(bossPath, bossParts.join('\n'));
  written.push(bossPath);
  return written;
}

function dateContinuity(brain, people, ymd) {
  const prev = lib.addDaysYmd(ymd, -1);
  const missing = [];
  for (const person of people) {
    if (!fs.existsSync(l1Path(brain, person.dept, person.id, prev))) missing.push(person.id);
  }
  if (missing.length) {
    return {
      status: 'degraded',
      previous_date: prev,
      missing_accounts: missing,
      reason: 'previous-l1-missing'
    };
  }
  return { status: 'ok', previous_date: prev, missing_accounts: [] };
}

function checksPass(audit) {
  return audit &&
    audit.l1_files_written > 0 &&
    audit.inbox_written > 0 &&
    audit.no_full_index_rewrite === true &&
    audit.skeleton === true &&
    audit.checks &&
    audit.checks.yaml_parseable === true &&
    audit.checks.files_present === true &&
    audit.checks.receipt_fields === true;
}

function accountSlice(byDept, person) {
  const hit = { files: [], sessions: 0, blocks: [] };
  const order = [];
  if (person && person.dept) order.push(person.dept);
  for (const dept of Object.keys(byDept || {})) {
    if (order.indexOf(dept) === -1) order.push(dept);
  }
  for (const dept of order) {
    const info = byDept[dept];
    if (!info || !info.accounts || !info.accounts[person.id]) continue;
    hit.sessions = info.accounts[person.id];
    hit.blocks = (info.blocksByAccount && info.blocksByAccount[person.id]) || [];
    hit.files = (info.files || []).filter((f) =>
      f.indexOf(path.join(person.dept, person.id)) !== -1
      || f.indexOf(dept + '\\' + person.id + '\\') !== -1
      || f.indexOf(dept + '/' + person.id + '/') !== -1
    );
    if (hit.sessions > 0) return hit;
  }
  return hit;
}

function distillModel(distillOn, stats) {
  if (!distillOn) return 'skipped';
  if (stats.fail > 0 && stats.ok > 0) return 'partial';
  if (stats.fail > 0 && stats.ok === 0) return 'failed';
  return distill.MODEL;
}

function runOneDay(roots, ymd, args) {
  const brain = roots.brain;
  const roster = lib.loadRoster(brain);
  const depts = (roster.depts || []).map((d) => d.id);
  const prior = readAudit(brain, ymd);
  const lock = lockPath(brain, ymd);
  const distillOn = distill.wanted(args);
  const forceDistill = !!(args && args.forceDistill);
  const priorModel = prior && prior.model ? prior.model : 'skipped';
  const priorAttempted = prior && prior.distill ? Number(prior.distill.attempted) || 0 : 0;
  const redoDistill = distillOn && (
    forceDistill
    || priorModel === 'skipped'
    || priorModel === 'failed'
    || priorModel === 'partial'
    || (priorModel === distill.MODEL && priorAttempted === 0)
  );
  if (prior && prior.status === 'success' && fs.existsSync(lock) && !redoDistill) {
    lib.appendJsonl(runsPath(brain), {
      run_id: lib.nowIso() + '-' + ymd,
      target_date: ymd,
      status: 'success',
      skipped: true,
      reason: 'lock-and-success',
      at: lib.nowIso()
    });
    return { status: 'success', skipped: true, ymd };
  }

  const people = rosterPeople(roster);
  const byDept = collectL0(brain, ymd);
  const emptyDepts = depts.filter((d) => !byDept[d] || !byDept[d].sessions);
  const emptyPeople = people.filter((p) => {
    const info = byDept[p.dept] && byDept[p.dept].accounts ? byDept[p.dept].accounts[p.id] : 0;
    return !info;
  });
  const l1Files = [];
  const pendingFiles = [];
  const distillStats = { attempted: 0, ok: 0, fail: 0 };

  if (args.write) lib.writeUtf8(lock, JSON.stringify({ ymd, at: lib.nowIso(), pid: process.pid }) + '\n');

  try {
    for (const person of people) {
      const slice = accountSlice(byDept, person);
      const acctSessions = slice.sessions;
      const acctFiles = slice.files;
      const blocks = slice.blocks;
      const info = { files: acctFiles, sessions: acctSessions, accounts: {}, blocks };
      info.accounts[person.id] = acctSessions;
      let body = skeletonBody(person.dept, person.id, ymd, info);
      if (distillOn && acctSessions > 0) {
        distillStats.attempted++;
        try {
          const classified = classifyBlocks(blocks);
          const text = distill.completeSync(
            distill.promptFor(person, ymd, classified, acctSessions),
            { complete: args.distillComplete }
          );
          body = distill.applyNarrative(body, text);
          distillStats.ok++;
          process.stdout.write('DISTILL|' + person.id + '|ok|chars=' + text.length + '\n');
        } catch (e) {
          distillStats.fail++;
          process.stdout.write('DISTILL|' + person.id + '|fail|' + String(e && e.message ? e.message : e).slice(0, 80) + '\n');
        }
      }
      const pend = pendingPath(brain, person.dept, person.id, ymd);
      const final = l1Path(brain, person.dept, person.id, ymd);
      if (args.write) {
        lib.writeUtf8(pend, body);
        fs.renameSync(pend, final);
      }
      l1Files.push(final);
      pendingFiles.push(pend);
    }
    const inbox = writeInbox(brain, ymd, byDept, depts, roster, args.write);
    let yamlOkCount = 0;
    let filesPresent = true;
    if (args.write) {
      for (const f of l1Files.concat(inbox)) {
        if (!fs.existsSync(f)) { filesPresent = false; continue; }
        if (yamlOk(lib.readUtf8(f))) yamlOkCount++;
      }
    } else {
      yamlOkCount = l1Files.length + inbox.length;
    }
    const continuity = dateContinuity(brain, people, ymd);
    const audit = {
      target_date: ymd,
      tz: lib.TZ,
      skeleton: true,
      model: distillModel(distillOn, distillStats),
      distill: distillStats,
      summary: lib.ZH.pending,
      l1_files_written: l1Files.length,
      inbox_written: inbox.length,
      depts_with_sessions: Object.keys(byDept).filter((d) => byDept[d].sessions > 0),
      empty_depts: emptyDepts,
      empty_people: emptyPeople.map((p) => p.id),
      empty_dept_reason: lib.ZH.noActivity,
      no_full_index_rewrite: true,
      date_continuity: continuity,
      checks: {
        one_l1_per_account: l1Files.length === people.length,
        inbox_director_and_boss: inbox.length === directorDepts(roster).length + 1,
        skeleton_present: true,
        yaml_parseable: yamlOkCount === l1Files.length + inbox.length,
        files_present: filesPresent,
        receipt_fields: true,
        no_full_index_rewrite: true
      }
    };
    const ok = checksPass(audit) && audit.checks.one_l1_per_account && audit.checks.inbox_director_and_boss;
    audit.status = ok ? 'success' : 'degraded';
    if (args.write) lib.writeUtf8(auditPath(brain, ymd), JSON.stringify(audit, null, 2));
    const fails = ok ? 0 : lib.consecutiveFailures(runsPath(brain)) + 1;
    lib.appendJsonl(runsPath(brain), {
      run_id: lib.nowIso() + '-' + ymd,
      target_date: ymd,
      status: audit.status,
      consecutive_failures: ok ? 0 : fails,
      skipped: false,
      at: lib.nowIso(),
      l1_files: l1Files,
      inbox
    });
    return { status: audit.status, skipped: false, ymd, audit, l1Files, inbox };
  } catch (e) {
    lib.appendJsonl(runsPath(brain), {
      run_id: lib.nowIso() + '-' + ymd,
      target_date: ymd,
      status: 'failed',
      error: String(e.message || e),
      consecutive_failures: lib.consecutiveFailures(runsPath(brain)) + 1,
      at: lib.nowIso()
    });
    throw e;
  }
}

function runRange(roots, from, through, args) {
  return lib.ymdRange(from, through).map((ymd) => runOneDay(roots, ymd, args));
}

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  lib.ensureNotProdWrite(roots, args);
  const target = args.target || lib.previousShanghaiDay();
  const from = args.from || target;
  const through = args.through || target;
  process.stdout.write('TARGET=' + target + '\n');
  process.stdout.write('FROM=' + from + '\n');
  process.stdout.write('THROUGH=' + through + '\n');
  const days = runRange(roots, from, through, args);
  for (const r of days) {
    process.stdout.write(
      'DAY|' + r.ymd + '|status=' + r.status + '|skipped=' + !!r.skipped
      + '|model=' + (r.audit && r.audit.model ? r.audit.model : '')
      + '|attempted=' + (r.audit && r.audit.distill ? r.audit.distill.attempted : '')
      + '\n'
    );
    if (r.l1Files) {
      for (const f of r.l1Files) process.stdout.write('L1|' + f + '\n');
    }
    if (r.inbox) {
      for (const f of r.inbox) process.stdout.write('INBOX|' + f + '\n');
    }
    if (r.status !== 'success' && !r.skipped) process.exitCode = 1;
  }
}

module.exports = { runOneDay, runRange, collectL0, l1Path, parseL0Blocks, classifyBlocks };
if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
