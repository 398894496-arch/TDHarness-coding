#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Deliberately bounded format detection, not a claim of exhaustive coverage.
const rules = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
  ['vendor-api-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
];

function scan(root) {
  // Use Git's NUL-delimited tracked-file list, including force-added ignored files.
  // Git failures must not be treated as an empty repository.
  const tracked = execFileSync(process.env.TDH_TEST_GIT || 'git', ['ls-files', '--stage', '-z'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  let failures = 0;
  const report = (file, rule, line) => {
    // Never print the matched line or secret value.
    console.error('SECRET_HIT=' + JSON.stringify({ file, rule, ...(line ? { line } : {}) }));
    failures++;
  };
  for (const entry of tracked.split('\0').filter(Boolean)) {
    const match = entry.match(/^(\d+) [a-f0-9]+ ([0-3])\t([\s\S]+)$/);
    if (!match) throw new Error('Invalid tracked-file record');
    const [, mode, stage, file] = match;
    if (stage !== '0' || !['100644', '100755'].includes(mode)) {
      report(file, 'unsupported-or-unmerged-file');
      continue;
    }
    const full = path.resolve(root, file);
    const relative = path.relative(root, full);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Path outside repository');
    // Reject symlinks, including symlinked parent directories, before reading.
    let current = root;
    let safe = true;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) { safe = false; break; }
    }
    if (!safe) { report(file, 'symlink'); continue; }
    const name = path.basename(file);
    if (/^\.env(?:\..*)?$/.test(name) && !['.env.example', '.env.sample', '.env.template'].includes(name)) {
      report(file, 'sensitive-env-file');
    }
    const content = fs.readFileSync(full, 'utf8');
    for (const [id, pattern] of rules) {
      pattern.lastIndex = 0;
      const found = pattern.exec(content);
      if (found) report(file, id, content.slice(0, found.index).split('\n').length);
    }
  }
  return failures === 0;
}

try {
  const ok = scan(path.resolve(process.argv[2] || path.join(__dirname, '..')));
  console.log('SECRET_SCAN_OK=' + Number(ok));
  if (!ok) process.exitCode = 1;
} catch (_) {
  // Avoid exposing subprocess output or file contents on an operational failure.
  console.error('SECRET_SCAN_ERROR=unable-to-scan-all-tracked-files');
  process.exitCode = 2;
}
