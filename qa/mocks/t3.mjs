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
const statePath = process.env.T3_MOCK_STATE ?? '/tmp/falkenwarte-t3-mock-state.json';

function emptyState() {
  return { scenario: 'default', sessions: {}, acceptedLaunches: {}, runs: {}, oauthClients: {}, oauthCodes: {}, oauthTokenChoice: process.env.T3_MOCK_BEARER ?? 'qa-t3-token-A', journal: [], unexpected: [] };
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
  const base = toolDefinitions();
  const schemas = {
    t3_thread_read: {
      type: 'object', additionalProperties: false,
      properties: { threadId: { type: 'string' }, afterMessageId: { type: 'string' } },
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

function launch(namespace, args) {
  if (typeof args.title !== 'string' || args.title.trim() === '' || typeof args.message !== 'string') {
    return { result: toolError('validation_failed', 'Launch requires a title and initial message.') };
  }
  if (typeof args.clientRequestId !== 'string' || args.clientRequestId.trim() === '') {
    return { result: toolError('validation_failed', 'Launch requires a stable clientRequestId.') };
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

  const number = Object.keys(state.acceptedLaunches).length + 1;
  const threadId = `qa-t3-thread-${number}`;
  const runId = `qa-t3-run-${number}`;
  const value = {
    threadId,
    projectId: args.projectId ?? 'qa-t3-project-1',
    modelSelection: { instanceId: 'qa-inherited-provider', model: 'qa-inherited-model' },
    runId,
    status: 'queued',
  };
  state.acceptedLaunches[key] = {
    namespace,
    clientRequestId: args.clientRequestId,
    payloadHash,
    payload: args,
    response: value,
    replays: 0,
  };
  state.runs[runId] = { threadId, status: 'completed', result: 'reported_success', namespace };
  persist();
  return { result: toolResult(value), accepted: true };
}

function callTool(namespace, name, args, scenario) {
  if (scenario === 'tool_error') return { result: toolError('capability_unavailable', 'The configured T3 capability is unavailable.') };
  if (scenario === 'unknown_capability') return { result: toolError('capability_unavailable', 'T3 no longer advertises the requested capability.') };
  if (name === 't3_thread_launch') return launch(namespace, args);
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
    if (!launchEntry) return { result: toolError('resource_not_found', 'T3 thread was not found.') };
    return { result: toolResult({
      threadId: args.threadId,
      projectId: launchEntry.response.projectId,
      providerInstanceId: 'qa-inherited-provider',
      model: 'qa-inherited-model',
      runs: Object.entries(state.runs).filter(([, run]) => run.threadId === args.threadId).map(([runId, run]) => ({ runId, status: run.status })),
    }) };
  }
  if (name === 't3_thread_send') {
    return { result: toolResult({ threadId: args.threadId, runId: `qa-t3-run-${Object.keys(state.runs).length + 1}`, status: 'queued', clientRequestId: args.clientRequestId }) };
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

async function mcpRequest(request, response) {
  noStore(response);
  const body = await readJson(request);
  const namespace = namespaceFor(request.headers.authorization);
  const sessionId = request.headers['mcp-session-id'];
  const version = request.headers['mcp-protocol-version'];
  const entry = {
    method: body?.method ?? null,
    request_id: body?.id ?? null,
    tool: body?.params?.name ?? null,
    auth_namespace: namespace,
    session_id: typeof sessionId === 'string' ? sessionId : null,
    protocol_version: typeof version === 'string' ? version : body?.params?.protocolVersion ?? null,
    arguments_hash: body?.params?.arguments ? hash(body.params.arguments) : null,
  };

  if (request.method !== 'POST' || pathOf(request) !== '/mcp') {
    recordUnexpected({ ...entry, http_method: request.method, path: pathOf(request) });
    return sendJson(response, 404, { error: { message: 'Unknown MCP endpoint.' } });
  }
  if (!namespace) {
    appendJournal({ ...entry, outcome: 'unauthorized' });
    return sendJson(response, 401, { error: { message: 'Fixture OAuth bearer required.' } });
  }
  if (state.scenario === 'http_401' && body?.method !== 'initialize') {
    appendJournal({ ...entry, outcome: 'unauthorized' });
    return sendJson(response, 401, { error: { message: 'Fixture authorization expired.' } });
  }
  if (body?.method === 'initialize') {
    const requested = body.params?.protocolVersion;
    if (state.scenario === 'unsupported_protocol' || requested !== transcript.protocol_version) {
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
  if (state.scenario === 'session_expired' && body?.method !== 'notifications/initialized') {
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
    appendJournal({ ...entry, outcome: 'success' });
    return sendJson(response, 200, jsonRpc(body.id, { tools: allTools() }));
  }
  if (body?.method === 'tools/call') {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (state.scenario === 'protocol_error') {
      appendJournal({ ...entry, outcome: 'jsonrpc_error' });
      return sendJson(response, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32603, message: 'Fixture protocol error.' } });
    }
    const fault = state.scenario;
    const outcome = callTool(namespace, name, args, fault);
    appendJournal({ ...entry, outcome: outcome.unexpected ? 'unexpected_tool' : outcome.result.isError ? 'tool_error' : 'success', launch_payload_hash: name === 't3_thread_launch' ? hash(args) : undefined });
    persist();
    if (fault === 'lost_reply_after_accept' && name === 't3_thread_launch' && outcome.accepted) {
      state.scenario = 'default';
      persist();
      response.destroy();
      return;
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

startServer(port, async (request, response) => {
  const pathname = pathOf(request);
  if (pathname === '/__qa/health' && request.method === 'GET') {
    return sendJson(response, 200, { service: 't3-mcp-mock', scenario: state.scenario, launches: Object.keys(state.acceptedLaunches).length });
  }
  if (pathname === '/__qa/reset' && request.method === 'POST') {
    const body = await readJson(request);
    const next = body?.scenario ?? 'default';
    if (next !== 'default' && !faultIds.has(next) && !['unknown_capability', 'unknown_run_state'].includes(next)) return sendJson(response, 400, { error: `Unknown T3 scenario: ${next}`, available: [...faultIds] });
    state = { ...emptyState(), scenario: next };
    waitingLaunches = [];
    agentCallback = null;
    persist();
    return sendJson(response, 200, { reset: true, scenario: state.scenario });
  }
  if (pathname === '/__qa/scenario' && request.method === 'POST') {
    const body = await readJson(request);
    const next = body?.scenario;
    if (next !== 'default' && !faultIds.has(next) && !['unknown_capability', 'unknown_run_state'].includes(next)) return sendJson(response, 400, { error: `Unknown T3 scenario: ${next}`, available: [...faultIds] });
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
});
