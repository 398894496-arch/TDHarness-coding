'use strict';
// Harvest corrections from L0. Promote accepted fingerprints to L2 provisional.
// Never auto-activate. Director / boss still adopt.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const l2 = require('./l2-promote');

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

function collectL0Blocks(brain) {
  const root = path.join(brain, '10-l0');
  const out = [];
  for (const f of lib.listMd(root)) {
    const text = lib.readUtf8(f);
    const fm = lib.readFrontmatter(text);
    for (const b of parseL0Blocks(text)) {
      out.push(Object.assign({ file: f, dept: fm.dept || '', account: fm.account || '' }, b));
    }
  }
  return out;
}

function harvestCorrections(brain, blocks, write) {
  const dest = path.join(brain, '30-lessons', 'corrections.md');
  let body = fs.existsSync(dest) ? lib.readUtf8(dest) : '---\nstatus: active\n---\n\n# 纠错\n\n';
  let added = 0;
  const lines = [];
  for (const b of blocks) {
    const kind = String(b.correction_kind || 'none');
    if (kind === 'none' || !kind) continue;
    const sid = b.session_id || '';
    const marker = 'session=' + sid;
    if (sid && body.indexOf(marker) !== -1) continue;
    const line = '- ' + lib.shanghaiTodayMs() + ' ' + marker
      + ' kind=' + kind
      + ' account=' + (b.account || '')
      + ' fact=' + String(b.fact || '').slice(0, 160);
    lines.push(line);
    added++;
  }
  if (write && lines.length) {
    if (!body.endsWith('\n')) body += '\n';
    lib.writeUtf8(dest, body + lines.join('\n') + '\n');
  }
  return { dest, added };
}

function scanPromote(roots, args) {
  const blocks = collectL0Blocks(roots.brain);
  const fps = [];
  const seen = new Set();
  for (const b of blocks) {
    const fp = String(b.fingerprint || '').toLowerCase();
    if (!lib.fingerprintOk(fp) || seen.has(fp)) continue;
    seen.add(fp);
    fps.push(fp);
  }
  const actions = [];
  for (const fp of fps) {
    const r = l2.promote(roots, { fingerprint: fp, write: !!args.write });
    actions.push({ fingerprint: fp, action: r.action, path: r.path, mustAskAdopt: !!r.mustAskAdopt });
  }
  const corr = harvestCorrections(roots.brain, blocks, !!args.write);
  return { fingerprints: fps.length, actions, corrections: corr };
}

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  lib.ensureNotProdWrite(roots, args);
  const r = scanPromote(roots, args);
  process.stdout.write('L2_SCAN_N=' + r.fingerprints + '\n');
  process.stdout.write('CORR_ADD=' + r.corrections.added + '\n');
  for (const a of r.actions) {
    process.stdout.write('L2|' + a.fingerprint + '|' + a.action + '\n');
  }
  process.stdout.write('L2_SCAN_OK=1\n');
}

module.exports = { scanPromote, harvestCorrections, collectL0Blocks };
if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
