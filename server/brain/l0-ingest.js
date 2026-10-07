'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const schemaWrite = require('./schema-write');

function ledgerPath(brain) {
  return path.join(brain, '90-system', 'l0-ledger.jsonl');
}

function l0AuditPath(brain, ymd) {
  return path.join(brain, '90-system', 'l0-audit', ymd + '.json');
}

function emptyDayStat() {
  return {
    session_start_count: 0,
    active_session_count: 0,
    cross_day_count: 0,
    ingested: 0,
    skipped: 0,
    warn: 0
  };
}

function bumpDay(stats, ymd) {
  if (!stats[ymd]) stats[ymd] = emptyDayStat();
  return stats[ymd];
}

function mergeDayStats(into, from) {
  for (const ymd of Object.keys(from || {})) {
    const src = from[ymd];
    const dst = bumpDay(into, ymd);
    dst.session_start_count += src.session_start_count;
    dst.active_session_count += src.active_session_count;
    dst.cross_day_count += src.cross_day_count;
    dst.ingested += src.ingested;
    dst.skipped += src.skipped;
    dst.warn += src.warn;
  }
  return into;
}

function alreadyWritten(brain, sessionId, ymd) {
  const p = ledgerPath(brain);
  if (!fs.existsSync(p)) return false;
  const needle = '"session_id":"' + sessionId + '"';
  const day = '"ymd":"' + ymd + '"';
  for (const line of lib.readUtf8(p).split(/\r?\n/)) {
    if (line.indexOf(needle) !== -1 && line.indexOf(day) !== -1) return true;
  }
  return false;
}

function extractFingerprint(header, events, fact) {
  const blob = [fact, JSON.stringify(header || {}), JSON.stringify(events || [])].join('\n');
  const m = blob.match(/fingerprint:\s*([a-z0-9]+(?:\.[a-z0-9_-]+){2,})/i);
  return m ? m[1].toLowerCase() : '';
}

function l0File(brain, dept, account, ymd) {
  const ym = ymd.slice(0, 7);
  return path.join(brain, '10-l0', dept, account, ym, ymd + '.md');
}

function ensureDayFile(filePath, dept, account, ymd) {
  if (fs.existsSync(filePath)) return;
  const fm = {
    date: ymd,
    owner: account,
    dept,
    account,
    visibility: 'company',
    layer: 'l0',
    evidence_level: 'observed'
  };
  schemaWrite.assertNote(fm, 'l0');
  const body = [
    schemaWrite.renderFrontmatter(fm),
    '',
    '# L0 ' + dept + ' / ' + account + ' / ' + ymd,
    ''
  ].join('\n');
  lib.writeUtf8(filePath, body);
}

function appendBlock(filePath, rec) {
  const block = [
    '',
    '## ' + rec.session_id,
    '- time: ' + rec.time,
    '- account: ' + rec.account,
    '- dept: ' + rec.dept,
    '- session_id: ' + rec.session_id,
    '- dsh_home: ' + rec.dsh_home,
    '- cwd: ' + rec.cwd,
    '- title: ' + rec.title,
    '- fact: ' + rec.fact,
    '- artifacts: ' + (rec.artifacts || 'none'),
    '- correction_kind: ' + (rec.correction_kind || 'none'),
    '- completion: ' + (rec.completion || 'mechanical-pass'),
    '- original: ' + rec.original,
    '- fingerprint: ' + (rec.fingerprint || ''),
    '- status: ' + rec.status,
    ''
  ].join('\n');
  lib.appendUtf8(filePath, block);
}

function writeL0Audits(brain, dayStats, write) {
  const written = [];
  for (const ymd of Object.keys(dayStats || {}).sort()) {
    const s = dayStats[ymd];
    const audit = {
      target_date: ymd,
      tz: lib.TZ,
      session_start_count: s.session_start_count,
      active_session_count: s.active_session_count,
      cross_day_count: s.cross_day_count,
      ingested: s.ingested,
      skipped: s.skipped,
      warn: s.warn,
      no_full_index_rewrite: true
    };
    const p = l0AuditPath(brain, ymd);
    if (write) lib.writeUtf8(p, JSON.stringify(audit, null, 2) + '\n');
    written.push(p);
  }
  return written;
}

function sessionsRootOf(dshHome) {
  const home = String(dshHome || '');
  if (!home) return path.join('.', 'sessions');
  const n = home.replace(/\\/g, '/').replace(/\/+$/, '');
  const desk = /\/\.dsh-desk$/i.test(n) ? home : path.join(home, '.dsh-desk');
  const onShare = path.join(desk, 'sessions');
  if (fs.existsSync(onShare)) return onShare;
  return path.join(home, 'sessions');
}

function ingestHome(opts) {
  const { brain, account, dept, dshHome, write } = opts;
  const sessionsRoot = sessionsRootOf(dshHome);
  // the kernel has named this file two ways over its versions
  const files = lib.walkNamed(sessionsRoot, 'session.jsonl.zstd').concat(lib.walkNamed(sessionsRoot, 'session.v4.jsonl.zstd'));
  const result = {
    scanned: files.length,
    added: 0,
    skipped: 0,
    warn: 0,
    warnings: [],
    files: [],
    dayStats: {}
  };

  for (const zpath of files) {
    let text;
    try { text = lib.zstdToUtf8(zpath); }
    catch (e) {
      result.warn++;
      result.warnings.push('WARN zstd-fail ' + zpath + ' ' + e.message);
      continue;
    }
    const parsed = lib.parseSessionJsonl(text);
    if (parsed.error || !parsed.header) {
      result.warn++;
      result.warnings.push('WARN bad-jsonl ' + zpath);
      continue;
    }
    const header = parsed.header;
    const sid = header.id;
    if (!sid) {
      result.warn++;
      result.warnings.push('WARN missing-id ' + zpath);
      continue;
    }
    if (header.createdAt == null) {
      result.warn++;
      result.warnings.push('WARN missing-createdAt ' + zpath);
      continue;
    }
    const days = lib.activeDays(header, parsed.events);
    const startYmd = lib.shanghaiParts(header.createdAt).ymd;
    const isCross = days.length > 1;
    const title = lib.extractTitle(header, parsed.events) || 'none';
    const fact = lib.extractFact(header, parsed.events);
    const arts = lib.extractArtifacts(parsed.events);
    // a correction is something the person said; the same words inside a tool's output or the model's own text are not one
    const said = (parsed.events || []).filter((ev) => ev && ev.type === 'user/message' && !lib.isMachineNote(ev));
    const blob = (said.length ? said : (parsed.events || [])).map((ev) => lib.eventText(ev)).join('\n');
    const recBase = {
      time: lib.shanghaiParts(header.createdAt).iso,
      account,
      dept,
      session_id: sid,
      dsh_home: dshHome,
      cwd: header.cwd || '',
      title,
      fact,
      artifacts: arts.length ? arts.join('; ') : 'none',
      correction_kind: lib.correctionKind(blob),
      completion: lib.completionState(parsed.events),
      original: zpath,
      fingerprint: extractFingerprint(header, parsed.events, fact),
      status: 'ingested'
    };
    for (const ymd of days) {
      const st = bumpDay(result.dayStats, ymd);
      st.active_session_count++;
      if (ymd === startYmd) st.session_start_count++;
      if (isCross) st.cross_day_count++;
      if (alreadyWritten(brain, sid, ymd)) {
        result.skipped++;
        st.skipped++;
        continue;
      }
      const rec = Object.assign({}, recBase, { ymd });
      const outFile = l0File(brain, dept, account, ymd);
      if (write) {
        ensureDayFile(outFile, dept, account, ymd);
        appendBlock(outFile, rec);
        lib.appendJsonl(ledgerPath(brain), {
          session_id: sid,
          ymd,
          account,
          dept,
          path: outFile,
          original: zpath,
          at: lib.nowIso()
        });
      }
      result.added++;
      st.ingested++;
      result.files.push(outFile);
    }
  }
  return result;
}

function ingestAllowed(row) {
  if (!row) return false;
  if (row.ingest === 'deny' || row.ingest === false) return false;
  if (row.ingest === 'allow' || row.ingest === true) return true;
  const role = String(row.role || '').toLowerCase();
  if (role === 'hands' || role === 'hand' || role === 'audit') return false;
  if (role === 'brain') return true;
  const home = String(row.dshHome || '').replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(company-hands|role-hands|exec-hands|hands-home)(\/|$)/.test(home)) return false;
  if (/(^|\/)(company-audit|role-audit|exec-audit)(\/|$)/.test(home)) return false;
  return true;
}

function ingestFromHomesFile(roots, args) {
  const homesFile = args.homesFile || path.join(roots.brain, '90-system', 'homes.json');
  if (!fs.existsSync(homesFile)) throw new Error('homes-file-missing ' + homesFile);
  const rows = lib.loadJson(homesFile);
  const all = {
    added: 0,
    skipped: 0,
    warn: 0,
    scanned: 0,
    warnings: [],
    files: [],
    per: [],
    dayStats: {},
    audits: []
  };
  for (const row of rows) {
    if (!row || !row.dshHome) {
      all.warnings.push('WARN homes-row-missing-dshHome');
      all.warn++;
      continue;
    }
    if (!ingestAllowed(row)) {
      all.warnings.push('SKIP ingest-denied ' + row.dshHome);
      all.per.push({
        account: row.account, dshHome: row.dshHome,
        added: 0, skipped: 0, warn: 0, denied: 1
      });
      continue;
    }
    const r = ingestHome({
      brain: roots.brain,
      account: row.account,
      dept: row.dept,
      dshHome: row.dshHome,
      write: !!args.write
    });
    all.added += r.added;
    all.skipped += r.skipped;
    all.warn += r.warn;
    all.scanned += r.scanned;
    all.warnings = all.warnings.concat(r.warnings);
    all.files = all.files.concat(r.files);
    all.per.push({ account: row.account, dshHome: row.dshHome, added: r.added, skipped: r.skipped, warn: r.warn });
    mergeDayStats(all.dayStats, r.dayStats);
  }
  all.audits = writeL0Audits(roots.brain, all.dayStats, !!args.write);
  return all;
}

function main() {
  const args = lib.parseArgs(process.argv);
  const roots = lib.resolveRoots(args);
  lib.printRoots(roots);
  lib.ensureNotProdWrite(roots, args);
  const result = ingestFromHomesFile(roots, args);
  process.stdout.write('WRITE=' + (!!args.write) + '\n');
  process.stdout.write('SCANNED=' + result.scanned + '\n');
  process.stdout.write('ADDED=' + result.added + '\n');
  process.stdout.write('SKIPPED=' + result.skipped + '\n');
  process.stdout.write('WARN=' + result.warn + '\n');
  process.stdout.write('NO_FULL_INDEX_REWRITE=true\n');
  for (const w of result.warnings) process.stdout.write(w + '\n');
  for (const row of result.per) {
    process.stdout.write('HOME|' + row.account + '|added=' + row.added + '|skipped=' + row.skipped + '\n');
  }
  for (const ymd of Object.keys(result.dayStats).sort()) {
    const s = result.dayStats[ymd];
    process.stdout.write(
      'AUDIT|' + ymd +
      '|start=' + s.session_start_count +
      '|active=' + s.active_session_count +
      '|cross=' + s.cross_day_count +
      '|ingested=' + s.ingested +
      '|skipped=' + s.skipped +
      '\n'
    );
  }
}

module.exports = {
  ingestHome, ingestFromHomesFile, ingestAllowed, sessionsRootOf, l0File, alreadyWritten, l0AuditPath, writeL0Audits
};
if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  }
}
