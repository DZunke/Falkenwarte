import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { noStore, pathOf, readJson, sendJson, startServer } from './http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transcript = JSON.parse(await readFile(path.join(root, 'fixtures/mcp/t3-legacy-session.json'), 'utf8'));
const faultFixture = JSON.parse(await readFile(path.join(root, 'fixtures/mcp/t3-faults.json'), 'utf8'));
const faultIds = new Set(faultFixture.faults.map((fault) => fault.id));
const port = Number(process.env.PORT ?? 4311);
const alternatePort = Number(process.env.ALTERNATE_PORT ?? port + 2);
const statePath = process.env.T3_MOCK_STATE ?? '/tmp/falkenwarte-t3-mock-state.json';

function emptyState() {
  return { scenario: 'default', sessions: {}, acceptedLaunches: {}, acceptedMessages: {}, externalActivities: {}, runs: {}, oauthClients: {}, oauthCodes: {}, oauthTokenChoice: process.env.T3_MOCK_BEARER ?? 'qa-t3-token-A', journal: [], unexpected: [] };
}

let state = emptyState();
if (existsSync(statePath)) {
  try {
    state = { ...emptyState(), ...JSON.parse(readFileSync(statePath, 'utf8')) };
  } catch {
    state = emptyState();
  }
}
let waitingLaunches = [];
let agentCallback = null;

function persist() {
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function namespaceFor(authorization) {
  if (authorization === 'Bearer qa-t3-token-A') return 'oauth-client-A';
  if (authorization === 'Bearer qa-t3-token-B') return 'oauth-client-B';
  return null;
}

function jsonRpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    isError,
  };
}

function toolError(code, message) {
  return toolResult({ code, message }, true);
}

function responseForTool(response, id, value) {
  sendJson(response, 200, jsonRpc(id, value));
}

function appendJournal(entry) {
  state.journal.push({ sequence: state.journal.length + 1, at: new Date().toISOString(), ...entry });
  persist();
}

function originOf(request) {
  return `http://${request.headers.host ?? 't3-mock:4311'}`;
}

async function readForm(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function oauthResponse(response, status, body) {
  sendJson(response, status, body, { 'Cache-Control': 'no-store' });
}

async function oauthRequest(request, response, pathname) {
  const origin = originOf(request);
  if (pathname === '/.well-known/oauth-protected-resource/mcp' && request.method === 'GET') {
    return oauthResponse(response, 200, { resource: `${origin}/mcp`, issuer: origin, authorization_servers: [origin] });
  }
  if (pathname === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
    return oauthResponse(response, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }
  if (pathname === '/register' && request.method === 'POST') {
    const body = await readJson(request);
    if (!Array.isArray(body?.redirect_uris) || body.redirect_uris.length !== 1 || body.token_endpoint_auth_method !== 'none') {
      appendJournal({ method: 'oauth_register', outcome: 'invalid_request' });
      return oauthResponse(response, 400, { error: 'invalid_client_metadata' });
    }
    const clientId = `qa-oauth-client-${Object.keys(state.oauthClients).length + 1}`;
    state.oauthClients[clientId] = { redirect_uris: body.redirect_uris };
    appendJournal({ method: 'oauth_register', outcome: 'registered', client_id: clientId });
    persist();
    return oauthResponse(response, 201, { client_id: clientId, token_endpoint_auth_method: 'none' });
  }
  if (pathname === '/authorize' && request.method === 'GET') {
    const url = new URL(request.url ?? '/', origin);
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const redirectRegistered = state.oauthClients[clientId]?.redirect_uris?.includes(redirectUri) ?? false;
    if (url.searchParams.get('response_type') !== 'code' || !redirectRegistered
      || url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge')
      || !url.searchParams.get('resource')) {
      appendJournal({ method: 'oauth_authorize', outcome: 'invalid_request', client_id: clientId || null });
      return oauthResponse(response, 400, { error: 'invalid_request' });
    }
    const code = randomUUID();
    state.oauthCodes[code] = {
      client_id: clientId,
      redirect_uri: redirectUri,
      resource: url.searchParams.get('resource'),
      code_challenge: url.searchParams.get('code_challenge'),
      token: state.oauthTokenChoice,
    };
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', url.searchParams.get('state') ?? '');
    callback.searchParams.set('iss', origin);
    appendJournal({ method: 'oauth_authorize', outcome: 'approved', client_id: clientId });
    persist();
    response.writeHead(302, { Location: callback.toString(), 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (pathname === '/token' && request.method === 'POST') {
    const form = await readForm(request);
    const code = form.get('code') ?? '';
    const pending = state.oauthCodes[code];
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!pending || pending.client_id !== form.get('client_id') || pending.redirect_uri !== form.get('redirect_uri')
      || pending.resource !== form.get('resource') || challenge !== pending.code_challenge) {
      appendJournal({ method: 'oauth_token', outcome: 'invalid_grant' });
      return oauthResponse(response, 400, { error: 'invalid_grant' });
    }
    delete state.oauthCodes[code];
    appendJournal({ method: 'oauth_token', outcome: 'exchanged', client_id: pending.client_id });
    persist();
    return oauthResponse(response, 200, { access_token: pending.token, token_type: 'Bearer', expires_in: 2592000 });
  }

  return false;
}

function recordUnexpected(entry) {
  const item = { ...entry, reason: 'Unexpected or unsupported T3 mock request.' };
  state.unexpected.push(item);
  appendJournal({ ...item, outcome: 'unexpected_request' });
}

function toolDefinitions() {
  return transcript.steps.find((step) => step.name === 'tools_list').response.body.result.tools;
}

function allTools() {
  const base = toolDefinitions().map((tool) => tool.name === 't3_thread_launch'
    ? {
        ...tool,
        inputSchema: {
          ...tool.inputSchema,
          properties: {
            ...tool.inputSchema.properties,
            modelSelection: {
              type: 'object',
              additionalProperties: false,
              properties: {
                instanceId: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
                model: { type: 'string', minLength: 1 },
                options: {
                  anyOf: [
                    { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, value: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } }, required: ['id', 'value'], additionalProperties: false } },
                    { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } },
                  ],
                },
              },
              required: ['instanceId', 'model'],
            },
          },
        },
      }
    : tool);
  const schemas = {
    orchestrator_capabilities: {
      type: 'object', additionalProperties: false,
      properties: { search: { type: 'string', minLength: 1, maxLength: 200 } }, required: [],
    },
    t3_project_list: {
      type: 'object', additionalProperties: false,
      properties: { cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      required: [],
    },
    t3_thread_list: {
      type: 'object', additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        cursor: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['projectId'],
    },
    t3_thread_read: {
      type: 'object', additionalProperties: false,
      properties: {
        threadId: { type: 'string' }, afterPosition: { type: 'integer', minimum: -1 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
        runLimit: { type: 'integer', minimum: 1, maximum: 50 }, maxCharsPerItem: { type: 'integer', minimum: 1, maximum: 20000 },
        itemId: { type: 'string' }, textOffset: { type: 'integer', minimum: 0 }, view: { type: 'string', enum: ['messages', 'activity'] },
      },
      required: ['threadId'],
    },
    t3_thread_send: {
      type: 'object', additionalProperties: false,
      properties: { threadId: { type: 'string' }, message: { type: 'string' }, clientRequestId: { type: 'string' }, mode: { type: 'string', enum: ['queue'] } },
      required: ['threadId', 'message', 'clientRequestId'],
    },
    t3_thread_interrupt: {
      type: 'object', additionalProperties: false,
      properties: { threadId: { type: 'string' }, runId: { type: 'string' }, clientRequestId: { type: 'string' } },
      required: ['threadId', 'runId', 'clientRequestId'],
    },
  };
  return [...base, ...Object.entries(schemas).map(([name, inputSchema]) => ({
    name,
    description: `Fixture profile for native T3 tool ${name}.`,
    inputSchema,
  }))];
}

function providerInventory(scenario, search) {
  if (scenario === 'provider_signals') {
    return [
      {
        providerInstanceId: 'qa_native_signal',
        driverKind: 'codex',
        displayName: 'QA Native Signal',
        canRunChildTask: true,
        models: [{ id: 'qa-native-signal-model', label: 'QA Native Signal Model' }],
        constraints: [],
      },
      {
        providerInstanceId: 'qa_legacy_signal',
        driverKind: 'codex',
        displayName: 'QA Legacy Signal',
        available: true,
        models: [{ id: 'qa-legacy-signal-model', label: 'QA Legacy Signal Model' }],
        constraints: [],
      },
      { providerInstanceId: 'qa_no_signal', driverKind: 'codex', displayName: 'QA No Signal', models: [], constraints: [] },
      { providerInstanceId: 'qa_native_string', driverKind: 'codex', displayName: 'QA Native String', canRunChildTask: 'true', models: [], constraints: [] },
      { providerInstanceId: 'qa_legacy_string', driverKind: 'codex', displayName: 'QA Legacy String', available: 'true', models: [], constraints: [] },
      { providerInstanceId: 'qa_native_overruled', driverKind: 'codex', displayName: 'QA Native Overruled', canRunChildTask: true, available: false, models: [], constraints: [] },
      { providerInstanceId: 'qa_legacy_overruled', driverKind: 'codex', displayName: 'QA Legacy Overruled', canRunChildTask: false, available: true, models: [], constraints: [] },
    ];
  }

  const providers = [
    {
      providerInstanceId: 'codex',
      driverKind: 'codex',
      displayName: 'Codex',
      allModels: [
        { id: 'qa-codex-model', label: 'QA Codex Model' },
        { id: 'qa-codex-fast', label: 'QA Codex Fast' },
      ],
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      constraints: [],
    },
    {
      providerInstanceId: 'codex_general',
      driverKind: 'codex',
      displayName: 'Codex Allgemein',
      allModels: [
        { id: 'qa-general-model', label: 'QA General Model', options: [{ id: 'reasoningEffort', values: ['low', 'medium'], default: 'low' }] },
        { id: 'qa-general-fast', label: 'QA General Fast' },
      ],
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      constraints: [],
    },
    {
      providerInstanceId: 'codex_review',
      driverKind: 'codex',
      displayName: 'Codex Review',
      allModels: [
        { id: 'qa-review-featured', label: 'QA Review Featured' },
        { id: 'qa-review-model', label: 'QA Review Model', options: [{ id: 'reasoningEffort', values: ['low', 'medium', 'high'], default: 'medium' }] },
      ],
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      constraints: [],
    },
    {
      providerInstanceId: 'codex_disabled',
      driverKind: 'codex',
      displayName: 'QA Deaktivierter Codex',
      allModels: [{ id: 'qa-disabled-model', label: 'QA Disabled Model' }],
      canRunChildTask: false,
      canRunCrossProviderChildTask: false,
      constraints: ['Provider instance is disabled.'],
    },
    {
      providerInstanceId: 'qa_uninstalled_agent',
      driverKind: 'claude-code',
      displayName: 'QA Nicht installiert',
      allModels: [{ id: 'qa-uninstalled-model', label: 'QA Uninstalled Model' }],
      canRunChildTask: false,
      canRunCrossProviderChildTask: false,
      constraints: ['Provider executable is not installed.'],
    },
  ];
  return providers
    .filter((provider) => scenario !== 'provider_missing' || provider.providerInstanceId !== 'codex_review')
    .map(({ allModels, ...provider }) => {
      const visibleModels = typeof search === 'string'
        ? allModels.filter((model) => `${model.id} ${model.label}`.toLowerCase().includes(search.toLowerCase()))
        : scenario === 'models_omitted' && provider.providerInstanceId === 'codex_review'
          ? allModels.slice(0, 1)
          : allModels;
      const omittedModels = typeof search === 'string'
        ? 0
        : scenario === 'models_omitted' && provider.providerInstanceId === 'codex_review'
          ? allModels.length - visibleModels.length
          : undefined;
      const models = scenario === 'reasoning_option_missing' && provider.providerInstanceId === 'codex_review'
        ? visibleModels.map((model) => model.id === 'qa-review-model' ? { id: model.id, label: model.label } : model)
        : visibleModels;
      return { ...provider, models, ...(undefined === omittedModels ? {} : { omittedModels }) };
    });
}

function launch(namespace, args, scenario) {
  if (typeof args.title !== 'string' || args.title.trim() === '' || typeof args.message !== 'string') {
    return { result: toolError('validation_failed', 'Launch requires a title and initial message.') };
  }
  if (typeof args.clientRequestId !== 'string' || args.clientRequestId.trim() === '') {
    return { result: toolError('validation_failed', 'Launch requires a stable clientRequestId.') };
  }
  const modelSelection = args.modelSelection ?? { instanceId: 'codex_general', model: 'qa-general-model' };
  if (typeof modelSelection.instanceId !== 'string' || typeof modelSelection.model !== 'string' || modelSelection.model.trim() === '') {
    return { result: toolError('validation_failed', 'A model selection requires an instanceId and model.') };
  }
  const key = `${namespace}:${args.clientRequestId}`;
  const payloadHash = hash(args);
  const existing = state.acceptedLaunches[key];
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      return { result: toolError('idempotency_conflict', 'A different launch payload reused this clientRequestId.') };
    }
    existing.replays += 1;
    existing.response.status = state.runs[existing.response.runId]?.status ?? existing.response.status;
    persist();
    return { result: toolResult(existing.response) };
  }

  const provider = providerInventory(scenario, modelSelection.model).find((candidate) => candidate.providerInstanceId === modelSelection.instanceId);
  if (!provider || provider.canRunChildTask !== true) return { result: toolError('provider_unavailable', `Provider instance ${modelSelection.instanceId} is unavailable.`) };
  const selectedModel = provider.models.find((candidate) => candidate.id === modelSelection.model);
  if (!selectedModel) {
    return { result: toolError('model_unavailable', `Model ${modelSelection.model} is unavailable on ${modelSelection.instanceId}.`) };
  }
  if (undefined !== modelSelection.options) {
    if (!Array.isArray(modelSelection.options) || modelSelection.options.length !== 1 || modelSelection.options.some((selection) => !selection
      || typeof selection.id !== 'string' || typeof selection.value !== 'string'
      || !selectedModel.options?.some((option) => option.id === selection.id && Array.isArray(option.values) && option.values.includes(selection.value)))) {
      return { result: toolError('model_option_unavailable', `A model option is unavailable for ${modelSelection.model}.`) };
    }
  }

  const number = Object.keys(state.acceptedLaunches).length + 1;
  const threadId = `qa-t3-thread-${number}`;
  const runId = `qa-t3-run-${number}`;
  const runStatus = scenario === 'run_pending' ? 'running' : 'completed';
  const value = {
    threadId,
    projectId: args.projectId ?? 'qa-t3-project-1',
    modelSelection,
    runId,
    status: scenario === 'run_pending' ? 'running' : 'queued',
  };
  state.acceptedLaunches[key] = {
    namespace,
    clientRequestId: args.clientRequestId,
    payloadHash,
    payload: args,
    response: value,
    createdAt: new Date().toISOString(),
    replays: 0,
  };
  state.runs[runId] = {
    threadId,
    status: runStatus,
    result: runStatus === 'completed' ? 'reported_success' : null,
    namespace,
    providerInstanceId: modelSelection.instanceId,
    model: modelSelection.model,
    requestedAt: new Date().toISOString(),
  };
  persist();
  return { result: toolResult(value), accepted: true };
}

function callTool(namespace, name, args, scenario) {
  if (scenario === 'tool_error') return { result: toolError('capability_unavailable', 'The configured T3 capability is unavailable.') };
  if (scenario === 'unknown_capability') return { result: toolError('capability_unavailable', 'T3 no longer advertises the requested capability.') };
  if (name === 'orchestrator_capabilities') {
    const providers = providerInventory(scenario, args.search);
    return { result: toolResult({
      parentThreadId: null,
      inheritedProviderInstanceId: 'codex_general',
      inheritedModel: 'qa-general-model',
      runtimeMode: 'full-access',
      interactionMode: 'default',
      providers,
      features: {
        appOwnedSubagents: true,
        asyncPolling: true,
        cancellation: true,
        batchThreadCreation: true,
        threadManagement: true,
        incrementalThreadRead: true,
        scheduledTasks: true,
        maxBatchThreads: 20,
      },
    }) };
  }
  if (name === 't3_project_list') {
    const cursor = args.cursor ?? 0;
    const limit = args.limit ?? 20;
    if (!Number.isSafeInteger(cursor) || cursor < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return { result: toolError('validation_failed', 'Project listing requires a non-negative numeric cursor and a limit between 1 and 100.') };
    }

    const projects = [
      { id: 'qa-t3-project-1', title: 'QA T3 Project', workspaceRoot: '/qa/workspace' },
      { id: 'qa-t3-project-2', title: 'QA Archive', workspaceRoot: '/qa/second-workspace' },
    ];
    const page = projects.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < projects.length ? cursor + limit : null;

    return { result: toolResult({ projects: page, nextCursor }) };
  }
  if (name === 't3_thread_list') {
    if (typeof args.projectId !== 'string' || args.projectId.trim() === ''
      || !Number.isSafeInteger(args.cursor ?? 0) || (args.cursor ?? 0) < 0
      || !Number.isSafeInteger(args.limit ?? 50) || (args.limit ?? 50) < 1 || (args.limit ?? 50) > 100) {
      return { result: toolError('validation_failed', 'Thread listing requires a projectId and a non-negative numeric cursor.') };
    }

    const threads = Object.values(state.externalActivities)
      .filter((activity) => scenario === 'foreign_thread_list' || activity.externalProjectId === args.projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((activity) => ({
        threadId: activity.threadId,
        projectId: activity.externalProjectId,
        title: activity.title,
        status: 'running',
        latestRunId: activity.runId,
        providerInstanceId: 'codex_general',
        model: 'qa-general-model',
      }));
    const cursor = args.cursor ?? 0;
    const limit = Math.min(args.limit ?? 50, 100);
    const page = threads.slice(cursor, cursor + limit);
    const nextCursor = cursor + page.length < threads.length ? cursor + page.length : null;

    return { result: toolResult({ projectId: args.projectId, currentThreadId: null, threads: page, nextCursor, total: threads.length }) };
  }
  if (name === 't3_thread_launch') return launch(namespace, args, scenario);
  if (name === 't3_thread_wait') {
    const run = state.runs[args.runId];
    if (scenario === 'wait_timeout') {
      return { result: toolResult({ threadId: args.threadId, runId: args.runId, status: 'running', timedOut: true }) };
    }
    if (!run || run.threadId !== args.threadId) {
      return { result: toolError('run_context_mismatch', 'The run is unknown or belongs to another thread.') };
    }
    if (scenario === 'unknown_run_state') {
      return { result: toolResult({ threadId: args.threadId, runId: args.runId, status: 'future_unknown_state', timedOut: false }) };
    }
    return { result: toolResult({ threadId: args.threadId, runId: args.runId, status: run.status, timedOut: false }) };
  }
  if (name === 't3_thread_read') {
    const launchEntry = Object.values(state.acceptedLaunches).find((entry) => entry.response.threadId === args.threadId);
    const externalActivity = Object.values(state.externalActivities).find((entry) => entry.threadId === args.threadId);
    if (!launchEntry && !externalActivity) return { result: toolError('resource_not_found', 'T3 thread was not found.') };
    const recentRuns = Object.entries(state.runs)
      .filter(([, run]) => run.threadId === args.threadId)
      .map(([runId, run], index) => ({
        runId,
        ordinal: index + 1,
        status: scenario === 'unknown_run_state' ? 'future_unknown_state' : run.status,
        providerInstanceId: run.providerInstanceId ?? launchEntry?.response.modelSelection.instanceId ?? 'codex_general',
        model: run.model ?? launchEntry?.response.modelSelection.model ?? 'qa-general-model',
        requestedAt: run.requestedAt ?? new Date().toISOString(),
        startedAt: run.status === 'queued' ? null : run.startedAt ?? new Date().toISOString(),
        completedAt: ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status) ? run.completedAt ?? new Date().toISOString() : null,
      }));
    const modelSelection = launchEntry?.response.modelSelection ?? { instanceId: 'codex_general', model: 'qa-general-model' };
    const latestRun = recentRuns.at(-1);
    const thread = {
      threadId: args.threadId,
      projectId: launchEntry?.response.projectId ?? externalActivity.externalProjectId,
      title: launchEntry?.payload.title ?? externalActivity.title,
      createdBy: 'user',
      creationSource: launchEntry ? 'mcp' : 'web',
      status: latestRun?.status ?? 'idle',
      latestRunId: latestRun?.runId ?? null,
      activeRunId: latestRun && ['queued', 'running'].includes(latestRun.status) ? latestRun.runId : null,
      providerInstanceId: modelSelection.instanceId,
      model: scenario === 'reference_missing_model' ? '' : modelSelection.model,
      runtimeMode: 'full-access',
      interactionMode: 'default',
      linkedPullRequest: null,
      titleRegeneration: null,
      branch: null,
      worktreePath: null,
      parentThreadId: null,
      relationshipToParent: null,
      runCount: recentRuns.length,
      itemCount: 0,
      pendingRequestCount: 0,
      archived: false,
      settled: Boolean(latestRun && !['queued', 'running'].includes(latestRun.status)),
      settledAt: null,
      snoozed: false,
      snoozedUntil: null,
      createdAt: launchEntry?.createdAt ?? externalActivity.createdAt,
      updatedAt: new Date().toISOString(),
    };

    return { result: toolResult({
      thread,
      recentRuns,
      items: [],
      nextPosition: null,
      hasMore: false,
    }) };
  }
  if (name === 't3_thread_send') {
    const key = `${namespace}:${args.clientRequestId}`;
    const payloadHash = hash(args);
    const existing = state.acceptedMessages[key];
    if (existing) {
      if (existing.payloadHash !== payloadHash) return { result: toolError('idempotency_conflict', 'A different message reused this clientRequestId.') };
      return { result: toolResult(existing.response) };
    }
    const runId = `qa-t3-run-${Object.keys(state.runs).length + 1}`;
    const response = { threadId: args.threadId, runId, status: 'queued', clientRequestId: args.clientRequestId };
    state.acceptedMessages[key] = { payloadHash, response };
    const runStatus = scenario === 'run_pending' ? 'running' : 'completed';
    response.status = runStatus === 'running' ? 'running' : 'queued';
    state.runs[runId] = { threadId: args.threadId, status: runStatus, result: runStatus === 'completed' ? 'reported_success' : null, namespace };
    persist();
    return { result: toolResult(response) };
  }
  if (name === 't3_thread_interrupt') {
    const run = state.runs[args.runId];
    if (!run || run.threadId !== args.threadId) return { result: toolError('run_context_mismatch', 'The run is unknown or belongs to another thread.') };
    run.status = 'cancelled';
    persist();
    return { result: toolResult({ threadId: args.threadId, runId: args.runId, status: 'cancel_requested' }) };
  }
  return { result: toolError('capability_unavailable', `Unsupported T3 tool: ${name}`), unexpected: true };
}

function externalActivity(body) {
  if (body?.action === 'create') {
    const sequence = Object.keys(state.externalActivities).length + 1;
    const threadId = body.thread_id ?? `qa-external-thread-${sequence}`;
    const runId = body.run_id ?? `qa-external-run-${sequence}`;
    const externalProjectId = body.external_project_id ?? 'qa-t3-project-1';
    if (typeof threadId !== 'string' || threadId.trim() === '' || typeof runId !== 'string' || runId.trim() === ''
      || typeof externalProjectId !== 'string' || externalProjectId.trim() === '') {
      return { status: 422, body: { error: 'thread_id, run_id, and external_project_id must be non-empty strings.' } };
    }
    const existing = state.externalActivities[runId];
    if (existing) {
      if (existing.threadId !== threadId || existing.externalProjectId !== externalProjectId) {
        return { status: 409, body: { error: 'External run identity is already used by another activity.' } };
      }
      return { status: 200, body: { status: existing.status, thread_id: threadId, run_id: runId, external_project_id: externalProjectId } };
    }
    const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : `QA T3 thread ${sequence}`;
    state.externalActivities[runId] = { threadId, runId, externalProjectId, title, createdAt: new Date().toISOString(), status: 'running' };
    state.runs[runId] = { threadId, status: 'running', result: null, namespace: 'external' };
    appendJournal({ method: 'external_activity_create', external_thread_id: threadId, external_run_id: runId, outcome: 'created_running' });
    persist();
    return { status: 201, body: { status: 'running', thread_id: threadId, run_id: runId, external_project_id: externalProjectId } };
  }
  if (body?.action === 'complete') {
    const runId = body.run_id;
    const activity = typeof runId === 'string' ? state.externalActivities[runId] : null;
    const run = typeof runId === 'string' ? state.runs[runId] : null;
    const launchEntry = runId ? Object.values(state.acceptedLaunches).find((entry) => entry.response.runId === runId) : null;
    const threadId = activity?.threadId ?? run?.threadId;
    if (!run || !threadId || (body.thread_id !== undefined && body.thread_id !== threadId)) {
      return { status: 404, body: { error: 'External activity was not found.' } };
    }
    const terminalStatus = body.status ?? 'completed';
    if (!['completed', 'failed', 'cancelled', 'canceled', 'interrupted', 'succeeded', 'success', 'error'].includes(terminalStatus)) {
      return { status: 422, body: { error: 'status must be a supported terminal T3 run state.' } };
    }
    if (activity) activity.status = terminalStatus;
    run.status = terminalStatus;
    run.result = `external_activity_${terminalStatus}`;
    const externalProjectId = activity?.externalProjectId ?? launchEntry?.response.projectId ?? 'qa-t3-project-1';
    appendJournal({ method: 'external_activity_complete', external_thread_id: threadId, external_run_id: runId, outcome: terminalStatus });
    persist();
    return { status: 200, body: { status: terminalStatus, thread_id: threadId, run_id: runId, external_project_id: externalProjectId } };
  }
  return { status: 422, body: { error: 'action must be create or complete.' } };
}

async function mcpRequest(request, response) {
  noStore(response);
  const scenario = state.scenario;
  const pathname = pathOf(request);
  if (pathname === '/mcp' && request.method === 'DELETE') {
    const namespace = namespaceFor(request.headers.authorization);
    const sessionId = request.headers['mcp-session-id'];
    const version = request.headers['mcp-protocol-version'];
    const entry = {
      scenario,
      method: 'session_terminate',
      request_id: null,
      tool: null,
      auth_namespace: namespace,
      session_id: typeof sessionId === 'string' ? sessionId : null,
      protocol_version: typeof version === 'string' ? version : null,
      arguments_hash: null,
    };
    if (!namespace) {
      appendJournal({ ...entry, outcome: 'unauthorized' });
      return sendJson(response, 401, { error: { message: 'Fixture OAuth bearer required.' } });
    }
    const activeSession = state.sessions[sessionId];
    if (!activeSession || activeSession.namespace !== namespace || version !== activeSession.protocolVersion) {
      appendJournal({ ...entry, outcome: 'invalid_session' });
      return sendJson(response, 404, { error: { message: 'Unknown or expired MCP session.' } });
    }
    delete state.sessions[sessionId];
    appendJournal({ ...entry, outcome: 'terminated' });
    persist();
    response.writeHead(202);
    response.end();
    return;
  }
  if (pathname === '/mcp' && request.method === 'GET') {
    response.writeHead(405, { Allow: 'POST, DELETE' });
    response.end();
    return;
  }
  const body = await readJson(request);
  const namespace = namespaceFor(request.headers.authorization);
  const sessionId = request.headers['mcp-session-id'];
  const version = request.headers['mcp-protocol-version'];
  const entry = {
    scenario,
    path: pathname,
    mock_origin: originOf(request),
    method: body?.method ?? null,
    request_id: body?.id ?? null,
    tool: body?.params?.name ?? null,
    auth_namespace: namespace,
    session_id: typeof sessionId === 'string' ? sessionId : null,
    protocol_version: typeof version === 'string' ? version : body?.params?.protocolVersion ?? null,
    arguments_hash: body?.params?.arguments ? hash(body.params.arguments) : null,
  };

  if (request.method !== 'POST' || pathname !== '/mcp') {
    recordUnexpected({ ...entry, http_method: request.method, path: pathOf(request) });
    return sendJson(response, 404, { error: { message: 'Unknown MCP endpoint.' } });
  }
  if (!namespace) {
    appendJournal({ ...entry, outcome: 'unauthorized' });
    return sendJson(response, 401, { error: { message: 'Fixture OAuth bearer required.' } });
  }
  if (scenario === 'http_401' && body?.method !== 'initialize') {
    appendJournal({ ...entry, outcome: 'unauthorized' });
    return sendJson(response, 401, { error: { message: 'Fixture authorization expired.' } });
  }
  if (body?.method === 'initialize') {
    const requested = body.params?.protocolVersion;
    if (scenario === 'unsupported_protocol' || requested !== transcript.protocol_version) {
      appendJournal({ ...entry, outcome: 'unsupported_protocol' });
      return sendJson(response, 400, { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unsupported MCP protocol version.' } });
    }
    const nextSession = `qa-mcp-session-${Object.keys(state.sessions).length + 1}`;
    state.sessions[nextSession] = { namespace, protocolVersion: requested, initialized: false };
    appendJournal({ ...entry, outcome: 'initialized', assigned_session_id: nextSession });
    persist();
    return sendJson(response, 200, jsonRpc(body.id, {
      protocolVersion: transcript.protocol_version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'falkenwarte-t3-traffic-fixture', version: '1.0.0' },
    }), { 'Mcp-Session-Id': nextSession });
  }

  const activeSession = state.sessions[sessionId];
  if (!activeSession || activeSession.namespace !== namespace || version !== transcript.protocol_version) {
    appendJournal({ ...entry, outcome: 'invalid_session' });
    return sendJson(response, 404, { jsonrpc: '2.0', id: body?.id, error: { code: -32001, message: 'Unknown or expired MCP session.' } });
  }
  if (scenario === 'session_expired' && body?.method !== 'notifications/initialized') {
    delete state.sessions[sessionId];
      state.scenario = 'default';
    appendJournal({ ...entry, outcome: 'session_expired' });
    persist();
    return sendJson(response, 404, { jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'MCP session expired.' } });
  }
  if (body?.method === 'notifications/initialized') {
    activeSession.initialized = true;
    appendJournal({ ...entry, outcome: 'notification_accepted' });
    persist();
    response.writeHead(202);
    response.end();
    return;
  }
  if (!activeSession.initialized) {
    appendJournal({ ...entry, outcome: 'initialize_required' });
    return sendJson(response, 400, { jsonrpc: '2.0', id: body?.id, error: { code: -32002, message: 'Initialize notification required.' } });
  }
  if (body?.method === 'tools/list') {
    const tools = allTools();
    const compatibleTools = scenario === 'without_thread_list'
      ? tools.filter((tool) => tool.name !== 't3_thread_list')
      : tools;
    appendJournal({ ...entry, outcome: 'success', tool_names: compatibleTools.map((tool) => tool.name) });
    return sendJson(response, 200, jsonRpc(body.id, { tools: compatibleTools }));
  }
  if (body?.method === 'tools/call') {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (scenario === 'protocol_error') {
      appendJournal({ ...entry, outcome: 'jsonrpc_error' });
      return sendJson(response, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32603, message: 'Fixture protocol error.' } });
    }
    const fault = scenario;
    const outcome = callTool(namespace, name, args, fault);
    const threadListResult = name === 't3_thread_list' ? outcome.result.structuredContent : null;
    appendJournal({
      ...entry,
      outcome: outcome.unexpected ? 'unexpected_tool' : outcome.result.isError ? 'tool_error' : 'success',
      launch_payload_hash: name === 't3_thread_launch' ? hash(args) : undefined,
      ...(name === 't3_thread_list' ? {
        thread_list_project_id: args.projectId ?? null,
        thread_list_cursor: args.cursor ?? null,
        thread_list_limit: args.limit ?? null,
        thread_list_result_threads: threadListResult?.threads?.map((thread) => ({ threadId: thread.threadId, projectId: thread.projectId })) ?? [],
      } : {}),
      ...(name === 'orchestrator_capabilities' ? {
        capability_search: args.search ?? null,
        provider_inventory: outcome.result.structuredContent?.providers?.map((provider) => ({
          providerInstanceId: provider.providerInstanceId,
          driverKind: provider.driverKind,
          canRunChildTask: provider.canRunChildTask,
          canRunCrossProviderChildTask: provider.canRunCrossProviderChildTask,
          ...(Object.hasOwn(provider, 'available') ? { available: provider.available } : {}),
          ...(Object.hasOwn(provider, 'enabled') ? { enabled: provider.enabled } : {}),
          ...(Object.hasOwn(provider, 'installed') ? { installed: provider.installed } : {}),
          constraints: provider.constraints ?? [],
          models: provider.models?.map((model) => ({
            id: model.id,
            label: model.label,
            ...(Array.isArray(model.options) ? { options: model.options } : {}),
          })) ?? [],
          omittedModels: provider.omittedModels ?? 0,
        })) ?? [],
      } : {}),
      ...(name === 't3_thread_read' ? {
        thread_read_target_thread_id: args.threadId ?? null,
        thread_read_result: {
          thread: {
            threadId: outcome.result.structuredContent?.thread?.threadId ?? null,
            projectId: outcome.result.structuredContent?.thread?.projectId ?? null,
            providerInstanceId: outcome.result.structuredContent?.thread?.providerInstanceId ?? null,
            model: outcome.result.structuredContent?.thread?.model ?? null,
          },
          recentRuns: outcome.result.structuredContent?.recentRuns?.map((run) => ({
            runId: run.runId,
            providerInstanceId: run.providerInstanceId,
            model: run.model,
            status: run.status,
          })) ?? [],
        },
      } : {}),
    });
    persist();
    if (fault === 'lost_reply_after_accept' && name === 't3_thread_launch' && outcome.accepted) {
      state.scenario = 'default';
      persist();
      response.destroy();
      return;
    }
    if (fault === 'lost_reply_then_hold_retry' && name === 't3_thread_launch' && outcome.accepted) {
      state.scenario = 'hold_retry';
      persist();
      response.destroy();
      return;
    }
    if (fault === 'hold_retry' && name === 't3_thread_launch' && !outcome.result.isError) {
      await new Promise((resolve) => waitingLaunches.push(resolve));
      state.scenario = 'default';
      persist();
    }
    if (fault === 'mismatched_structured_content' && name === 't3_thread_launch' && !outcome.result.isError) {
      const structured = outcome.result.structuredContent;
      outcome.result.structuredContent = { ...structured, threadId: `${structured.threadId}-mismatch` };
    }
    if (fault === 'report_before_launch_reply' && name === 't3_thread_launch' && agentCallback) {
      const callbackResponse = await fetch(agentCallback.url, {
        method: 'POST',
        headers: agentCallback.headers,
        body: JSON.stringify(agentCallback.body),
      });
      appendJournal({ method: 'agent_callback', outcome: callbackResponse.ok ? 'reported_before_launch_reply' : `callback_http_${callbackResponse.status}` });
    }
    if (fault === 'delayed_launch_reply' && name === 't3_thread_launch' && outcome.accepted) {
      await new Promise((resolve) => waitingLaunches.push(resolve));
      state.scenario = 'default';
      persist();
    }
    return sendJson(response, 200, jsonRpc(body.id, outcome.result));
  }
  if (body?.method === 'ping') {
    appendJournal({ ...entry, outcome: 'success' });
    return sendJson(response, 200, jsonRpc(body.id, {}));
  }

  recordUnexpected({ ...entry, path: pathOf(request) });
  return sendJson(response, 200, { jsonrpc: '2.0', id: body?.id, error: { code: -32601, message: `Unsupported MCP method: ${String(body?.method)}` } });
}

const handleRequest = async (request, response) => {
  const pathname = pathOf(request);
  if (pathname === '/__qa/health' && request.method === 'GET') {
    return sendJson(response, 200, { service: 't3-mcp-mock', scenario: state.scenario, launches: Object.keys(state.acceptedLaunches).length });
  }
  if (pathname === '/__qa/reset' && request.method === 'POST') {
    const body = await readJson(request);
    const next = body?.scenario ?? 'default';
    if (next !== 'default' && !faultIds.has(next) && !['unknown_capability', 'unknown_run_state', 'lost_reply_then_hold_retry', 'hold_retry', 'run_pending', 'without_thread_list', 'foreign_thread_list', 'provider_missing', 'models_omitted', 'provider_signals', 'reasoning_option_missing'].includes(next)) return sendJson(response, 400, { error: `Unknown T3 scenario: ${next}`, available: [...faultIds, 'run_pending', 'without_thread_list', 'foreign_thread_list', 'provider_missing', 'models_omitted', 'provider_signals', 'reasoning_option_missing'] });
    state = { ...emptyState(), scenario: next };
    waitingLaunches = [];
    agentCallback = null;
    persist();
    return sendJson(response, 200, { reset: true, scenario: state.scenario });
  }
  if (pathname === '/__qa/scenario' && request.method === 'POST') {
    const body = await readJson(request);
    const next = body?.scenario;
    if (next !== 'default' && !faultIds.has(next) && !['unknown_capability', 'unknown_run_state', 'lost_reply_then_hold_retry', 'hold_retry', 'run_pending', 'without_thread_list', 'foreign_thread_list', 'provider_missing', 'models_omitted', 'provider_signals', 'reasoning_option_missing'].includes(next)) return sendJson(response, 400, { error: `Unknown T3 scenario: ${next}`, available: [...faultIds, 'run_pending', 'without_thread_list', 'foreign_thread_list', 'provider_missing', 'models_omitted', 'provider_signals', 'reasoning_option_missing'] });
    state.scenario = next;
    persist();
    return sendJson(response, 200, { scenario: state.scenario });
  }
  if (pathname === '/__qa/release' && request.method === 'POST') {
    for (const resolve of waitingLaunches) resolve();
    waitingLaunches = [];
    return sendJson(response, 200, { released: true });
  }
  if (pathname === '/__qa/agent-callback' && request.method === 'POST') {
    agentCallback = await readJson(request);
    return sendJson(response, 200, { configured: true });
  }
  if (pathname === '/__qa/oauth-token' && request.method === 'POST') {
    const body = await readJson(request);
    if (!['qa-t3-token-A', 'qa-t3-token-B'].includes(body?.token)) {
      return sendJson(response, 400, { error: 'Unsupported test OAuth token.' });
    }
    state.oauthTokenChoice = body.token;
    persist();
    return sendJson(response, 200, { token_namespace: body.token === 'qa-t3-token-A' ? 'oauth-client-A' : 'oauth-client-B' });
  }
  if (pathname === '/__qa/external-activity' && request.method === 'POST') {
    const result = externalActivity(await readJson(request));
    return sendJson(response, result.status, result.body);
  }
  if (pathname === '/__qa/journal' && request.method === 'GET') {
    return sendJson(response, 200, { scenario: state.scenario, journal: state.journal, unexpected: state.unexpected, accepted_launches: Object.values(state.acceptedLaunches).map(({ namespace, clientRequestId, payloadHash, payload, response: launchResponse, replays }) => ({ namespace, clientRequestId, payloadHash, payload, response: launchResponse, replays })) });
  }
  if (pathname.startsWith('/.well-known/') || ['/register', '/authorize', '/token'].includes(pathname)) {
    const handled = await oauthRequest(request, response, pathname);
    if (handled !== false) return handled;
  }
  if (pathname === '/mcp') return mcpRequest(request, response);
  recordUnexpected({ http_method: request.method, path: pathname });
  return sendJson(response, 404, { error: { message: 'Unknown mock path.' } });
};

startServer(alternatePort, handleRequest);
startServer(port, handleRequest);
