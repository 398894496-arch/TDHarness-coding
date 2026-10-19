#!/usr/bin/env node
// 公司模型路由自修复（company-shell healOfficeRoute，@@model-heal）的证明，不需要内核：
// 内核的 llm / configEditor 换成假的，配置文件放临时目录。
//   1. 路由正常：什么都不改，不留备份
//   2. 本机配置坏了（模型档位写成内核不认的 `none: none`，另有一个别的路由）：文件改成只有网关下发的
//      office、档位写成 `off: none`，别的行原样保留，旧文件留备份，对一个正常运行的条目做一次空编辑
//      让内核按文件重新加载，加载后路由回来，记一行日志
//   3. 改完仍然没有路由：如实报 healed=false，只改一次，记日志
//   4. 网关没给模型、没有 llm 服务：不动文件
//   5. applyGrokModels 不带 only 时照旧保留别的路由（管理员「应用」用的那条路）
// 2026-10-19 TDH 现场：两台员工电脑每轮 NO_ADAPTER，本机复现后实测这个修法在线修好、不用重启。
// 打印 MODEL_HEAL_PROVE_OK=1。
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SHELL = path.join(__dirname, '..', 'desk', 'plugins', 'company-shell', 'lib', 'index.js');

const BROKEN = [
  '- id: ui-conversation',
  '  name: "@deepseek-ai/dsh-client-ui-conversation"',
  '  config:',
  '    busyEnter: steer',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      deepseek:',
  '        apiKeyEnv: DEEPSEEK_OFFICIAL_KEY',
  '      office:',
  '        displayName: 公司模型',
  '        apiKeyEnv: GROK_API_KEY',
  '        api: openai-completions',
  '        baseURL: http://old.example:8450/v1',
  '        models:',
  '          - id: grok-4.3',
  '            name: grok-4.3',
  '            contextWindow: 850000',
  '            input: [text, image]',
  '            reasoningEfforts:',
  '              none: none',
  '              high: high',
  '- id: agent-default-model',
  '  config:',
  '    provider: office',
  '    model: grok-4.7',
  '',
].join('\n');

const MODELS = [
  { id: 'grok-4.3', efforts: ['none', 'low', 'high'], image: true, context: 850000 },
  { id: 'grok-4.7', efforts: ['low', 'medium', 'high', 'xhigh'], image: true, context: 500000 },
  { id: 'grok-build-0.1', efforts: [], image: true },
];

function fakes(opts) {
  const state = { office: !!opts.office, edits: [] };
  const entries = [
    { options: { id: 'llm-pi-ai' }, fiber: { state: 3 } },
    { options: { id: 'ui-conversation' }, fiber: { state: 2 } },
    { options: { id: 'agent-default-model' }, fiber: { state: 2 } },
  ];
  const services = {
    llm: { listProviders: () => (state.office ? [{ id: 'office', name: '公司模型' }] : []) },
    configEditor: {
      entries: () => entries,
      edit: async (entry, change) => {
        state.edits.push(entry.options.id);
        const cur = { a: 1 };
        assert.deepStrictEqual(change(cur), cur, 'the reload edit changes nothing');
        if (opts.reloadFixes) state.office = true;
      },
    },
  };
  if (opts.noLlm) delete services.llm;
  return { state, ctx: { get: (k) => services[k] } };
}

(async () => {
  const shell = await import(pathToFileURL(SHELL).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-heal-'));
  const file = path.join(dir, 'cordis.patch.yml');
  const deps = (extra) => Object.assign({ file, fetchModels: async () => MODELS, baseURL: 'http://gw.example:8450/v1', waitMs: 300 }, extra || {});
  const backups = () => fs.readdirSync(dir).filter((n) => n.indexOf('.broken-') > 0);
  try {
    // 1. healthy
    fs.writeFileSync(file, BROKEN);
    let f = fakes({ office: true });
    let r = await shell.healOfficeRoute(f.ctx, deps());
    assert.ok(r.ok && r.healthy, JSON.stringify(r));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), BROKEN, 'healthy: file untouched');
    assert.strictEqual(backups().length, 0);
    assert.strictEqual(f.state.edits.length, 0);
    console.log('HEAL_HEALTHY_NOOP_OK=1');

    // 2. broken, reload brings the route back
    f = fakes({ office: false, reloadFixes: true });
    r = await shell.healOfficeRoute(f.ctx, deps());
    assert.ok(r.ok && r.healed, JSON.stringify(r));
    assert.strictEqual(r.reload, 'reconciled');
    assert.deepStrictEqual(f.state.edits, ['agent-default-model'], 'reload edit goes to a running entry, never llm-pi-ai');
    assert.deepStrictEqual(r.dropped, ['deepseek']);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/none: none/.test(text), 'the unknown level is gone');
    assert.ok(/ {14}off: none/.test(text), 'xAI none sits under off');
    assert.ok(!/deepseek:/.test(text), 'office is the only provider');
    assert.deepStrictEqual(shell.piAiProviderKeys(text), ['office']);
    assert.ok(/baseURL: http:\/\/gw\.example:8450\/v1/.test(text), 'base from the gateway');
    for (const m of MODELS) assert.ok(text.indexOf('- id: ' + m.id) >= 0, 'model ' + m.id);
    assert.ok(/- id: ui-conversation\n  name: "@deepseek-ai\/dsh-client-ui-conversation"\n  config:\n    busyEnter: steer\n/.test(text), 'other rows kept');
    assert.ok(/- id: agent-default-model\n  config:\n    provider: office\n/.test(text), 'rows after it kept');
    assert.strictEqual(backups().length, 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, backups()[0]), 'utf8'), BROKEN, 'backup is the old file');
    assert.ok(/MODEL_HEAL healed=true reload=reconciled models=3 dropped=deepseek/.test(fs.readFileSync(path.join(dir, 'model-heal.log'), 'utf8')));
    console.log('HEAL_FIXES_OK=1');

    // 3. still no route after the reload: say so, change the file once
    fs.writeFileSync(file, BROKEN);
    f = fakes({ office: false, reloadFixes: false });
    r = await shell.healOfficeRoute(f.ctx, deps());
    assert.ok(!r.ok && r.healed === false, JSON.stringify(r));
    assert.strictEqual(f.state.edits.length, 1);
    assert.ok(/MODEL_HEAL healed=false/.test(fs.readFileSync(path.join(dir, 'model-heal.log'), 'utf8')));
    assert.strictEqual(backups().length, 2, 'each heal keeps its own backup');
    // a desk that stays broken heals on every launch: only the newest 3 backups stay
    for (let i = 0; i < 4; i++) { fs.writeFileSync(file, BROKEN); await new Promise((res) => setTimeout(res, 5)); await shell.healOfficeRoute(fakes({ office: false }).ctx, deps({ waitMs: 0 })); }
    assert.strictEqual(backups().length, 3, 'backups capped at 3: ' + backups().join(','));
    console.log('HEAL_REPORTS_FAILURE_OK=1');

    // 4. no models, no llm service: nothing written
    fs.writeFileSync(file, BROKEN);
    const before = backups().length;
    r = await shell.healOfficeRoute(fakes({ office: false }).ctx, deps({ fetchModels: async () => [] }));
    assert.ok(!r.ok && r.why === 'no-models', JSON.stringify(r));
    r = await shell.healOfficeRoute(fakes({ noLlm: true }).ctx, deps());
    assert.ok(!r.ok && r.why === 'no-llm', JSON.stringify(r));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), BROKEN);
    assert.strictEqual(backups().length, before);
    console.log('HEAL_LEAVES_ALONE_OK=1');

    // 5. the admin path still keeps other providers
    const kept = shell.applyGrokModels(BROKEN, shell.cleanModelPicks(MODELS), 'http://gw.example:8450/v1');
    assert.deepStrictEqual(shell.piAiProviderKeys(kept), ['deepseek', 'office']);
    assert.ok(!/none: none/.test(kept));
    console.log('APPLY_KEEPS_OTHERS_OK=1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('MODEL_HEAL_PROVE_OK=1');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
