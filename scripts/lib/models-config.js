'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ModelError,
  assertHttpUrl,
  discoverUpstreamModels,
  fallbackModelsFor,
  mergeDiscoveredModels,
  normalizeModels,
  overlayIdFromLabel,
  renderSoloOverlay,
} = require('./model-meta');
const { setRef, publicView, loadStore } = require('./credentials-store');
const { listProviders, providerSpec } = require('./oauth-providers');

function positiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function apiForBase(baseUrl, explicit) {
  if (explicit) return explicit;
  try {
    const host = new URL(baseUrl).hostname;
    if (host.includes('anthropic.com')) return 'anthropic-messages';
    if (host.includes('chatgpt.com')) return 'openai-responses';
  } catch { /* ignore */ }
  return 'openai-completions';
}

function apiKeyEnvFor(id) {
  const slug = String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${slug}_API_KEY`;
}

async function customEndpoint({
  label,
  baseUrl,
  credential,
  models,
  contextWindow,
  maxTokens,
  reasoningEfforts,
  credentialsFile,
  fetchImpl,
} = {}) {
  const name = String(label ?? '').trim();
  if (!name) throw new ModelError('missing_label', 'endpoint name is required');
  assertHttpUrl(baseUrl);
  const id = overlayIdFromLabel(name);
  const envName = apiKeyEnvFor(id);
  const channel = {
    id,
    hint: models,
    contextWindow: positiveInt(contextWindow),
    maxTokens: positiveInt(maxTokens),
    reasoningEfforts,
  };
  const listed = models ? normalizeModels(models) : [];
  let discovered = { models: [], source: 'none' };
  if (credential) {
    discovered = await discoverUpstreamModels({
      baseUrl,
      credential,
      api: apiForBase(baseUrl),
      channel,
      fetchImpl,
    });
  } else if (!listed.length) {
    throw new ModelError('models_required', 'pass models or a credential to discover them');
  }
  const selected = listed.length ? listed : discovered.models;
  const merged = mergeDiscoveredModels(selected, discovered.models, {
    contextWindow: channel.contextWindow,
    maxTokens: channel.maxTokens,
    reasoningEfforts,
  }, channel);
  if (!merged.length) throw new ModelError('models_required', 'at least one model id is required');
  if (credential) setRef(credentialsFile, envName, credential);
  const provider = {
    id: `custom-${id}`,
    displayName: name,
    apiKeyEnv: envName,
    api: apiForBase(baseUrl),
    baseURL: String(baseUrl).replace(/\/+$/, ''),
    defaultContextWindow: channel.contextWindow,
    defaultMaxTokens: channel.maxTokens,
    models: merged,
  };
  return {
    provider,
    discovered: discovered.source,
    credentialRef: envName,
    models: merged.map((m) => ({ id: m.id, contextWindow: m.contextWindow, maxTokens: m.maxTokens })),
  };
}

function oauthRouteFromCommit(commit) {
  const spec = providerSpec(commit.provider);
  const models = commit.models || [];
  return {
    id: spec.overlayId,
    displayName: spec.label,
    api: spec.id === 'chatgpt' ? undefined : spec.id === 'claude' ? 'anthropic-messages' : 'openai-completions',
    baseURL: spec.defaultBaseUrl,
    models,
  };
}

function writeOverlay(file, providers) {
  const text = renderSoloOverlay({ providers });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function describeLocal({ credentialsFile } = {}) {
  const doc = loadStore(credentialsFile);
  return {
    credentialsFile,
    ...publicView(doc),
    providers: listProviders(),
  };
}

module.exports = {
  apiForBase,
  apiKeyEnvFor,
  customEndpoint,
  oauthRouteFromCommit,
  writeOverlay,
  describeLocal,
  positiveInt,
};
