'use strict';

const DEFAULT_EFFORTS = ['low', 'medium', 'high'];

const KNOWN_META = [
  { test: /gemini-(2\.5|3)/, contextWindow: 1_048_576, maxTokens: 65_536, reasoningEfforts: ['low', 'high'] },
  { test: /deepseek-v4|deepseek-reasoner|deepseek-chat/, contextWindow: 1_000_000, maxTokens: 384_000, reasoningEfforts: { off: null, high: 'high', max: 'max' } },
  { test: /gpt-5|gpt-4\.1|o3|o4|codex/, contextWindow: 256_000, maxTokens: 32_768, reasoningEfforts: DEFAULT_EFFORTS },
  { test: /gpt-4o|chatgpt/, contextWindow: 128_000, maxTokens: 16_384, reasoningEfforts: DEFAULT_EFFORTS },
  { test: /claude-opus-4|claude-sonnet-4|claude-haiku-4/, contextWindow: 200_000, maxTokens: 32_000, reasoningEfforts: DEFAULT_EFFORTS },
  { test: /claude/, contextWindow: 200_000, maxTokens: 16_384, reasoningEfforts: DEFAULT_EFFORTS },
  { test: /grok-4|grok-3/, contextWindow: 256_000, maxTokens: 32_000, reasoningEfforts: ['low', 'high'] },
  { test: /grok/, contextWindow: 128_000, maxTokens: 16_384, reasoningEfforts: ['low', 'high'] },
];

const FALLBACK_CATALOGS = {
  chatgpt: [
    { id: 'gpt-5.5', contextWindow: 256_000, maxTokens: 32_768, reasoningEfforts: DEFAULT_EFFORTS },
    { id: 'gpt-5.4', contextWindow: 256_000, maxTokens: 32_768, reasoningEfforts: DEFAULT_EFFORTS },
    { id: 'gpt-5.5-mini', contextWindow: 256_000, maxTokens: 16_384, reasoningEfforts: DEFAULT_EFFORTS },
  ],
  grok: [
    { id: 'grok-4.6', contextWindow: 256_000, maxTokens: 32_000, reasoningEfforts: ['low', 'high'] },
    { id: 'grok-4.6-fast', contextWindow: 256_000, maxTokens: 16_384, reasoningEfforts: ['low', 'high'] },
  ],
  claude: [
    { id: 'claude-opus-4-6', contextWindow: 200_000, maxTokens: 32_000, reasoningEfforts: DEFAULT_EFFORTS },
    { id: 'claude-sonnet-4-6', contextWindow: 200_000, maxTokens: 32_000, reasoningEfforts: DEFAULT_EFFORTS },
    { id: 'claude-haiku-4-5', contextWindow: 200_000, maxTokens: 16_384, reasoningEfforts: DEFAULT_EFFORTS },
  ],
  openai: [
    { id: 'gpt-5.5', contextWindow: 256_000, maxTokens: 32_768, reasoningEfforts: DEFAULT_EFFORTS },
    { id: 'gpt-5.5-mini', contextWindow: 256_000, maxTokens: 16_384, reasoningEfforts: DEFAULT_EFFORTS },
  ],
  anthropic: [
    { id: 'claude-opus-4-6', contextWindow: 200_000, maxTokens: 32_000, reasoningEfforts: DEFAULT_EFFORTS },
    { id: 'claude-sonnet-4-6', contextWindow: 200_000, maxTokens: 32_000, reasoningEfforts: DEFAULT_EFFORTS },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', contextWindow: 1_000_000, maxTokens: 384_000, reasoningEfforts: { off: null, high: 'high', max: 'max' } },
    { id: 'deepseek-v4-flash', contextWindow: 1_000_000, maxTokens: 384_000, reasoningEfforts: { off: null, high: 'high', max: 'max' } },
  ],
};

class ModelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function inferModelMeta(id) {
  const key = String(id ?? '').toLowerCase();
  if (!key) return {};
  for (const row of KNOWN_META) {
    if (row.test.test(key)) {
      return { contextWindow: row.contextWindow, maxTokens: row.maxTokens, reasoningEfforts: row.reasoningEfforts };
    }
  }
  return {};
}

function openaiCompatUrl(baseUrl, apiPath) {
  const b = String(baseUrl ?? '').replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (!b) throw new ModelError('missing_base', 'baseUrl is required');
  if (b.toLowerCase().endsWith(p.toLowerCase())) return b;
  if (b.endsWith('/v1')) return `${b}${p}`;
  return `${b}/v1${p}`;
}

function modelsListUrl(baseUrl) {
  return openaiCompatUrl(baseUrl, '/models');
}

function normalizeDiscoveredModel(raw, channel) {
  const id = String(raw?.id ?? raw?.name ?? '').trim();
  if (!id) return null;
  const inferred = inferModelMeta(id);
  const contextWindow = Number(raw.context_window ?? raw.contextWindow ?? raw.max_context_tokens ?? inferred.contextWindow ?? channel?.contextWindow);
  const maxTokens = Number(raw.max_tokens ?? raw.maxTokens ?? raw.max_output_tokens ?? inferred.maxTokens ?? channel?.maxTokens);
  const efforts = raw.reasoningEfforts ?? raw.reasoning_efforts ?? inferred.reasoningEfforts ?? channel?.reasoningEfforts;
  const entry = { id };
  const named = raw.display_name ?? (raw.name && raw.name !== id ? raw.name : undefined);
  if (named) entry.name = String(named);
  if (Number.isFinite(contextWindow) && contextWindow > 0) entry.contextWindow = contextWindow;
  if (Number.isFinite(maxTokens) && maxTokens > 0) entry.maxTokens = maxTokens;
  if (efforts !== undefined && efforts !== null && efforts !== false) entry.reasoningEfforts = efforts;
  return entry;
}

function parseModelPayload(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.models)) return json.models;
  return [];
}

function fallbackModelsFor(channel) {
  const id = String(channel?.id ?? '');
  const rows = FALLBACK_CATALOGS[id];
  if (rows) return rows.map((m) => normalizeDiscoveredModel(m, channel)).filter(Boolean);
  const hint = String(channel?.hint ?? '')
    .split(/[,\n，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return hint.map((mid) => normalizeDiscoveredModel({ id: mid }, channel)).filter(Boolean);
}

function normalizeModels(input) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === 'string') list = input.split(/[,\n，]/);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const m = typeof raw === 'string' ? { id: raw.trim() } : { ...raw, id: String(raw?.id ?? '').trim() };
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const entry = { id: m.id };
    for (const k of ['name', 'contextWindow', 'maxTokens', 'reasoningEfforts']) {
      if (m[k] !== undefined && m[k] !== null && m[k] !== '') entry[k] = m[k];
    }
    out.push(entry);
  }
  return out;
}

function mergeDiscoveredModels(manual, discovered, input = {}, channel) {
  const byId = new Map((discovered ?? []).map((m) => [m.id, m]));
  return (manual ?? []).map((m) => {
    const extra = byId.get(m.id) ?? inferModelMeta(m.id);
    const contextWindow = m.contextWindow ?? input.contextWindow ?? extra.contextWindow ?? channel?.contextWindow;
    const maxTokens = m.maxTokens ?? input.maxTokens ?? extra.maxTokens ?? channel?.maxTokens;
    const reasoningEfforts = input.reasoningEfforts ?? m.reasoningEfforts ?? extra.reasoningEfforts ?? channel?.reasoningEfforts;
    return {
      ...extra,
      ...m,
      ...(m.name || extra.name ? { name: m.name ?? extra.name } : {}),
      ...(contextWindow != null ? { contextWindow } : {}),
      ...(maxTokens != null ? { maxTokens } : {}),
      ...(reasoningEfforts != null && reasoningEfforts !== '' ? { reasoningEfforts } : {}),
    };
  });
}

function assertHttpUrl(url) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) throw new ModelError('bad_base', 'baseUrl must be an http(s) URL');
}

async function discoverUpstreamModels({
  baseUrl,
  credential,
  api,
  authStyle,
  channel,
  fetchImpl = fetch,
  timeoutMs = 12_000,
} = {}) {
  if (api === 'chatgpt-codex' || channel?.id === 'chatgpt') {
    return { models: fallbackModelsFor(channel ?? { id: 'chatgpt' }), source: 'fallback', reason: 'chatgpt-codex has no public /models' };
  }
  if (!credential) throw new ModelError('missing_credential', 'credential is required to list models');
  assertHttpUrl(baseUrl);
  const url = modelsListUrl(baseUrl);
  const headers = { accept: 'application/json', 'user-agent': 'tdh-coding' };
  if (api === 'anthropic-messages' || authStyle === 'anthropic-oauth') {
    headers['x-api-key'] = credential;
    headers['anthropic-version'] = '2023-06-01';
    if (authStyle === 'anthropic-oauth') {
      headers.authorization = `Bearer ${credential}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
      delete headers['x-api-key'];
    }
  } else {
    headers.authorization = `Bearer ${credential}`;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: ac.signal });
  } catch (err) {
    const fallback = fallbackModelsFor(channel);
    if (fallback.length) return { models: fallback, source: 'fallback', reason: `upstream unreachable: ${err.message}` };
    throw new ModelError('models_unreachable', `model list failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const fallback = fallbackModelsFor(channel);
    if (fallback.length) return { models: fallback, source: 'fallback', reason: `upstream HTTP ${res.status}` };
    throw new ModelError('models_failed', `model list failed HTTP ${res.status}`);
  }
  const json = await res.json().catch(() => ({}));
  const models = parseModelPayload(json).map((row) => normalizeDiscoveredModel(row, channel)).filter(Boolean);
  if (models.length === 0) {
    const fallback = fallbackModelsFor(channel);
    if (fallback.length) return { models: fallback, source: 'fallback', reason: 'upstream catalog empty' };
    throw new ModelError('models_empty', 'upstream returned no models');
  }
  return { models, source: 'upstream' };
}

function overlayIdFromLabel(label) {
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return slug || 'custom';
}

function yamlScalar(value) {
  if (value == null) return '';
  const s = String(value);
  if (s === '') return "''";
  if (/[:#{}[\],&*?|<>=!%@`']/.test(s) || /^\s|\s$/.test(s) || /[\r\n]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function yamlEfforts(efforts) {
  if (!efforts) return null;
  if (Array.isArray(efforts)) {
    return efforts.map((e) => String(e)).filter(Boolean);
  }
  if (typeof efforts === 'object') {
    return Object.entries(efforts).map(([k, v]) => ({ key: k, value: v == null ? null : String(v) }));
  }
  return [String(efforts)];
}

function renderProviderYaml(route) {
  const lines = [];
  const indent = '        ';
  const push = (s) => lines.push(s);
  push(`      ${route.id}:`);
  if (route.displayName) push(`${indent}displayName: ${yamlScalar(route.displayName)}`);
  if (route.apiKeyEnv) push(`${indent}apiKeyEnv: ${route.apiKeyEnv}`);
  if (route.api) push(`${indent}api: ${route.api}`);
  if (route.baseURL) push(`${indent}baseURL: ${yamlScalar(route.baseURL)}`);
  if (route.defaultContextWindow) push(`${indent}defaultContextWindow: ${Number(route.defaultContextWindow)}`);
  if (route.defaultMaxTokens) push(`${indent}defaultMaxTokens: ${Number(route.defaultMaxTokens)}`);
  if (route.models?.length) {
    push(`${indent}models:`);
    for (const m of route.models) {
      push(`${indent}  - id: ${yamlScalar(m.id)}`);
      if (m.name) push(`${indent}    name: ${yamlScalar(m.name)}`);
      if (m.contextWindow) push(`${indent}    contextWindow: ${Number(m.contextWindow)}`);
      if (m.maxTokens) push(`${indent}    maxTokens: ${Number(m.maxTokens)}`);
      const efforts = yamlEfforts(m.reasoningEfforts);
      if (efforts) {
        if (Array.isArray(efforts) && typeof efforts[0] === 'string') {
          push(`${indent}    reasoningEfforts:`);
          for (const e of efforts) push(`${indent}      ${e}: ${e}`);
        } else if (Array.isArray(efforts) && efforts[0] && typeof efforts[0] === 'object') {
          push(`${indent}    reasoningEfforts:`);
          for (const e of efforts) {
            push(`${indent}      ${e.key}: ${e.value == null ? '' : yamlScalar(e.value)}`);
          }
        }
      }
    }
  }
  return lines.join('\n');
}

function renderSoloOverlay({ providers = [] } = {}) {
  const head = [
    '# Small-team overlay. No office gateway, no Tailscale, no SMB.',
    '# Model key comes from the environment: DEEPSEEK_API_KEY',
    '# Optional: DEEPSEEK_BASE_URL (OpenAI-compatible, include /v1)',
    '#',
    '# Generated extra providers (custom endpoints / OAuth routes) live under',
    '# dsh-llm-pi-ai. Secrets stay in $DSH_HOME/.credentials.yaml — never here.',
    '# Official dsh already reads those env vars. This file also sets the',
    '# default sandbox to workspace-write so a local folder can be used',
    '# without clicking approve on every write.',
    '- id: permission',
    '  config:',
    '    defaultPreset: workspace-write',
    '    presets:',
    '      read-only:',
    '        sandbox: read-only',
    '        approval: ask',
    '      workspace-write:',
    '        sandbox: workspace-write',
    '        approval: never',
  ];
  if (!providers.length) return head.join('\n') + '\n';
  const body = [
    '- name: \'@deepseek-ai/dsh-llm-pi-ai\'',
    '  config:',
    '    providers:',
    ...providers.map((p) => renderProviderYaml(p)),
  ];
  return head.join('\n') + '\n' + body.join('\n') + '\n';
}

module.exports = {
  DEFAULT_EFFORTS,
  FALLBACK_CATALOGS,
  ModelError,
  inferModelMeta,
  openaiCompatUrl,
  modelsListUrl,
  normalizeDiscoveredModel,
  fallbackModelsFor,
  normalizeModels,
  mergeDiscoveredModels,
  discoverUpstreamModels,
  overlayIdFromLabel,
  assertHttpUrl,
  renderProviderYaml,
  renderSoloOverlay,
};
