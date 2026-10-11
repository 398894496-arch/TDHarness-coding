// Point the running desk at realpath workspace ids. Do not stop TDHarness.
const fs = require('fs');
const http = require('http');
const path = require('path');

function rpc(method, payload) {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'ws-' + Date.now().toString(36),
    method: method,
    payload: { args: { request: payload } },
  });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 17803,
      path: '/api/' + method.replace(/\./g, '/'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('rpc-timeout')));
    req.write(body);
    req.end();
  });
}

function idOf(text) {
  const m = String(text || '').match(/"workspaceId"\s*:\s*"([^"]+)"/);
  return m ? m[1] : '';
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

function findWorkspaceFile() {
  const guesses = [
    'D:\\dsh\\company\\_office\\.dsh-desk\\storages\\workspace.json',
    'D:/dsh/company/_office/.dsh-desk/storages/workspace.json',
  ];
  for (const p of guesses) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('workspace-json-missing');
}

(async () => {
  const personal = fs.realpathSync('D:/dsh/company/_office');
  const org = fs.realpathSync('D:/dsh/company');
  process.stdout.write('REAL_PERSONAL=' + personal + '\n');
  process.stdout.write('REAL_ORG=' + org + '\n');
  const made = [];
  for (const pair of [[personal, '个人'], [org, '团队']]) {
    const created = await rpc('workspace/create', { path: pair[0] });
    process.stdout.write('CREATE_' + pair[1] + '=' + created.status + ' ' + created.text.slice(0, 240).replace(/\s+/g, ' ') + '\n');
    if (created.status !== 200) throw new Error('create-failed-' + pair[1]);
    const id = idOf(created.text);
    if (!isUuid(id)) throw new Error('create-not-uuid-' + pair[1] + '=' + id);
    made.push({ id: id, title: pair[1] });
  }
  const file = findWorkspaceFile();
  const ws = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tables = (ws.tables && ws.tables.workspaces) || {};
  let dropped = 0;
  for (const id of Object.keys(tables)) {
    if (made.some(function (row) { return row.id === id; })) continue;
    const gone = await rpc('workspace/delete', { workspaceId: id });
    process.stdout.write('DELETE=' + id + ' ' + gone.status + '\n');
    if (gone.status !== 200) throw new Error('delete-failed=' + id);
    dropped += 1;
  }
  for (const row of made) {
    const renamed = await rpc('workspace/rename', { workspaceId: row.id, title: row.title });
    process.stdout.write('RENAME_' + row.title + '=' + renamed.status + ' ' + renamed.text.slice(0, 220).replace(/\s+/g, ' ') + '\n');
    if (renamed.status !== 200 || renamed.text.indexOf('"ok":true') < 0) throw new Error('rename-failed-' + row.title);
  }
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = (after.tables && after.tables.workspaces) || {};
  const ids = Object.keys(rows);
  process.stdout.write('WS_IDS=' + ids.join(',') + '\n');
  process.stdout.write('WS_DROPPED=' + dropped + '\n');
  if (ids.length !== 2) throw new Error('ws-count=' + ids.length);
  for (const id of ids) {
    if (!isUuid(id)) throw new Error('ws-still-synthetic=' + id);
    const got = rows[id].path;
    if (got !== personal && got !== org) throw new Error('ws-path=' + got);
    const title = rows[id].title;
    if (title !== '个人' && title !== '团队') throw new Error('ws-title=' + title);
    process.stdout.write('WS_ROW=' + title + '|' + got + '\n');
  }
  process.stdout.write('WS_LIVE_OK=1\n');
})().catch((err) => {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
