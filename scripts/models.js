#!/usr/bin/env node
'use strict';

// Local model setup for the coding tree: OAuth login that records a grant,
// custom OpenAI-compatible endpoints, and per-model context. Secrets stay in
// $DSH_HOME/.credentials.yaml. No company gateway, roster, or seats.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { credentialsPath, defaultHome, publicView, loadStore } = require('./lib/credentials-store');
const { listProviders, providerSpec } = require('./lib/oauth-providers');
const { LocalOAuth } = require('./lib/oauth-client');
const { customEndpoint, writeOverlay, oauthRouteFromCommit } = require('./lib/models-config');
const { renderSoloOverlay } = require('./lib/model-meta');

function die(code, message) {
  console.error(message);
  process.exitCode = code;
}

function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('-')) return fallback;
  return v;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function cmd() {
  const a = process.argv[2];
  if (!a || a.startsWith('-')) return 'help';
  return a;
}

function credFile() {
  return argOf('--credentials', credentialsPath(argOf('--dsh-home', defaultHome())));
}

function overlayFile() {
  return argOf('--overlay', path.join(__dirname, '..', 'overlays', 'solo.yml'));
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

async function main() {
  const c = cmd();
  if (c === 'help' || hasFlag('--help') || hasFlag('-h')) {
    console.log(`Usage:
  node scripts/models.js list
  node scripts/models.js login <chatgpt|grok|claude> [--models id,id] [--context N] [--max-tokens N]
  node scripts/models.js complete <provider> --state S --code CODE
  node scripts/models.js commit <provider> --state S [--models id,id] [--context N]
  node scripts/models.js custom --label NAME --base-url URL [--key KEY] [--models id,id] [--context N]
  node scripts/models.js overlay

Secrets go to $DSH_HOME/.credentials.yaml. Overlay never stores tokens.
Pass --write-overlay to also write overlays/solo.yml (off by default).
Device-code login prints a URL + user code; paste-code login prints authorizeUrl.
Proofs live in scripts/prove-models.js (no live vendor login).`);
    return;
  }

  if (c === 'list') {
    printJson({
      credentials: publicView(loadStore(credFile())),
      providers: listProviders(),
    });
    return;
  }

  if (c === 'login') {
    const id = process.argv[3];
    if (!providerSpec(id)) return die(2, 'unknown provider; use chatgpt, grok, or claude');
    const oauth = new LocalOAuth();
    const start = await oauth.start(id, {
      models: argOf('--models'),
      contextWindow: argOf('--context'),
      maxTokens: argOf('--max-tokens'),
    });
    const stash = path.join(os.tmpdir(), `tdh-oauth-${start.state}.json`);
    fs.writeFileSync(stash, JSON.stringify({ provider: id, ...serializeSessions(oauth), start }, null, 2));
    printJson({ ...start, sessionFile: stash });
    if (start.flow === 'device_code') {
      console.error(`Open ${start.verificationUriComplete || start.verificationUri}`);
      if (start.userCode) console.error(`Enter code ${start.userCode}`);
      console.error(`Then: node scripts/models.js commit ${id} --state ${start.state} --session ${stash}`);
    } else {
      console.error(`Open ${start.authorizeUrl}`);
      console.error(`Then: node scripts/models.js complete ${id} --state ${start.state} --code PASTE --session ${stash}`);
    }
    return;
  }

  if (c === 'complete' || c === 'commit' || c === 'status') {
    const id = process.argv[3];
    const sessionFile = argOf('--session');
    if (!sessionFile || !fs.existsSync(sessionFile)) return die(2, 'pass --session from login output');
    const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const oauth = restoreSessions(saved);
    if (c === 'status') {
      printJson(await oauth.status(argOf('--state', saved.start?.state)));
      persistSessions(sessionFile, id, oauth, saved.start);
      return;
    }
    if (c === 'complete') {
      const out = await oauth.complete(id, { state: argOf('--state', saved.start?.state), code: argOf('--code') });
      persistSessions(sessionFile, id, oauth, saved.start);
      printJson(out);
      return;
    }
    const out = await oauth.commit(id, {
      state: argOf('--state', saved.start?.state),
      models: argOf('--models') || saved.start?.models,
      contextWindow: argOf('--context'),
      maxTokens: argOf('--max-tokens'),
    }, { credentialsFile: credFile() });
    persistSessions(sessionFile, id, oauth, saved.start);
    // Catalog providers (chatgpt / grok / claude) already exist in dsh-llm-pi-ai.
    // The grant in .credentials.yaml is enough; do not rewrite overlays/solo.yml
    // unless the user passes --overlay explicitly.
    if (hasFlag('--write-overlay')) {
      writeOverlay(overlayFile(), [oauthRouteFromCommit(out)]);
      out.overlay = overlayFile();
    }
    printJson({ ...out, credentials: credFile() });
    return;
  }

  if (c === 'custom') {
    const result = await customEndpoint({
      label: argOf('--label'),
      baseUrl: argOf('--base-url'),
      credential: argOf('--key'),
      models: argOf('--models'),
      contextWindow: argOf('--context'),
      maxTokens: argOf('--max-tokens'),
      reasoningEfforts: argOf('--reasoning') ? argOf('--reasoning').split(/[,\s/]+/).filter(Boolean) : undefined,
      credentialsFile: credFile(),
    });
    if (hasFlag('--write-overlay')) {
      writeOverlay(overlayFile(), [result.provider]);
      result.overlay = overlayFile();
    }
    printJson({
      overlayId: result.provider.id,
      credentialRef: result.credentialRef,
      discovered: result.discovered,
      models: result.models,
      overlay: result.overlay,
    });
    return;
  }

  if (c === 'overlay') {
    process.stdout.write(renderSoloOverlay({ providers: [] }));
    return;
  }

  die(2, `unknown command ${c}`);
}

function serializeSessions(oauth) {
  const sessions = [];
  for (const [state, s] of oauth.sessions) sessions.push([state, s]);
  return { sessions };
}

function restoreSessions(saved) {
  const oauth = new LocalOAuth();
  for (const [state, s] of saved.sessions || []) oauth.sessions.set(state, s);
  return oauth;
}

function persistSessions(file, provider, oauth, start) {
  fs.writeFileSync(file, JSON.stringify({ provider, ...serializeSessions(oauth), start }, null, 2));
}

main().catch((err) => {
  die(1, err.message || String(err));
});
