'use strict';
// D20: append-only L1 facts. No conclusions, no narrative, no inference.
// Writes brain/10-logs/<dept>/<account>/<ymd>.md
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const schemaWrite = require('./schema-write');

function stripFrontmatter(text) {
  const m = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? String(text).slice(m[0].length) : String(text);
}

function factsFrontmatter(row, ymd, prev) {
  const fm = Object.assign({}, prev || {});
  fm.date = ymd;
  fm.owner = String(fm.owner || row.account || '').trim() || row.account;
  fm.dept = row.dept;
  fm.account = row.account;
  fm.visibility = String(fm.visibility || 'company').trim() || 'company';
  fm.layer = 'facts';
  fm.evidence_level = String(fm.evidence_level || 'observed').trim() || 'observed';
  schemaWrite.assertNote(fm, 'l1');
  return fm;
}

function ymdNow() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

function deptOf(acct) {
  if (!acct || !acct.dept || acct.dept === '*') return 'boss';
  return String(acct.dept);
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

function factLine(b) {
  const id = b.session_id || 'none';
  const cwd = b.cwd && b.cwd !== 'none' ? b.cwd : '';
  const arts = b.artifacts && b.artifacts !== 'none' ? b.artifacts : '';
  let line = '- session: ' + id;
  if (cwd) line += ' | cwd: ' + cwd;
  if (arts) line += ' | files: ' + arts;
  return line;
}

function factsPath(brain, dept, account, ymd) {
  return path.join(brain, '10-logs', dept, account, ymd + '.md');
}

function appendFacts(brain, roster, ymd) {
  const l0Root = path.join(brain, '10-l0');
  const files = lib.listMd(l0Root).filter((p) => path.basename(p) === ymd + '.md');
  const byAcct = {};
  for (const f of files) {
    const text = lib.readUtf8(f);
    const fm = lib.readFrontmatter(text);
    const dept = fm.dept || 'unknown';
    const account = fm.account || 'unknown';
    const key = dept + '/' + account;
    if (!byAcct[key]) byAcct[key] = { dept, account, lines: [] };
    for (const b of parseL0Blocks(text)) {
      const line = factLine(b);
      if (byAcct[key].lines.indexOf(line) === -1) byAcct[key].lines.push(line);
    }
  }
  const accounts = (roster && roster.accounts) || {};
  for (const id of Object.keys(accounts)) {
    const dept = deptOf(accounts[id]);
    const key = dept + '/' + id;
    if (!byAcct[key]) byAcct[key] = { dept, account: id, lines: [] };
  }
  let wrote = 0;
  for (const key of Object.keys(byAcct)) {
    const row = byAcct[key];
    const dest = factsPath(brain, row.dept, row.account, ymd);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let body = '';
    if (fs.existsSync(dest)) body = fs.readFileSync(dest, 'utf8');
    const prev = lib.readFrontmatter(body);
    const rest = body ? stripFrontmatter(body) : '';
    const fm = factsFrontmatter(row, ymd, prev);
    const heading = rest.trim()
      ? rest.replace(/^\s+/, '')
      : ('# facts ' + row.dept + ' / ' + row.account + ' / ' + ymd + '\n');
    body = schemaWrite.renderFrontmatter(fm) + '\n\n' + heading;
    if (!body.endsWith('\n')) body += '\n';
    if (/结论|评价|^## inference|^## narrative/m.test(body)) {
      process.stdout.write('FACTS_SKIP_CONCLUSIONS|' + dest + '\n');
      continue;
    }
    const have = new Set(body.split(/\r?\n/).filter((l) => l.indexOf('- session:') === 0));
    const add = row.lines.filter((l) => !have.has(l));
    if (!add.length && fs.existsSync(dest)) continue;
    if (add.length) {
      if (!body.endsWith('\n')) body += '\n';
      body += add.join('\n') + '\n';
    }
    fs.writeFileSync(dest, body, 'utf8');
    wrote++;
    process.stdout.write('FACTS|' + dest + '|add=' + add.length + '\n');
  }
  return wrote;
}

function main() {
  const args = lib.parseArgs(process.argv);
  const brain = args.brainRoot || 'D:\\dsh\\brain';
  lib.ensureNotProdWrite({ brain, company: '', homes: '' }, args);
  if (!args.write) {
    process.stdout.write('DRAFT_ONLY=1\n');
    return;
  }
  const rosterPath = path.join(brain, '90-system', 'roster.json');
  const roster = fs.existsSync(rosterPath) ? lib.loadJson(rosterPath) : { accounts: {} };
  const ymd = args.from || ymdNow();
  const n = appendFacts(brain, roster, ymd);
  process.stdout.write('FACTS_FILES=' + n + '\n');
  process.stdout.write('L1_FACTS_OK=1\n');
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write(String(e && e.message ? e.message : e) + '\n');
    process.exit(2);
  }
}

module.exports = { appendFacts, factLine, factsFrontmatter, stripFrontmatter };
