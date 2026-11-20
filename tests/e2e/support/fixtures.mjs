import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resetStack } from './reset-stack.mjs';
import { randomUUID } from 'node:crypto';
import { clearBusinessTime } from './test-clock.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';
const privateDirectory = process.env.FALKENWARTE_PRIVATE_DIR ?? path.join(directory, '../results');
const ownerStatePath = path.join(privateDirectory, 'owner-state.json');
const ownerSessionPath = path.join(privateDirectory, 'owner-session.json');

export class OwnerApi {
  constructor(context, csrfToken) {
    this.context = context;
    this.csrfToken = csrfToken;
    this.apiPrefix = apiPrefix;
  }

  async send(method, route, body, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
    if (options.mutation) {
      headers['X-CSRF-Token'] = this.csrfToken;
      headers['Idempotency-Key'] = options.idempotencyKey ?? randomUUID();
    }
    if (options.version !== undefined) headers['If-Match'] = `"${options.version}"`;
    const response = await this.context.fetch(`${this.apiPrefix}${route}`, {
      method,
      headers,
      data: body,
    });
    const text = await response.text();
    let data = null;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { response, data };
  }

  get(route, options) {
    return this.send('GET', route, undefined, options);
  }

  async waitForSucceededAction(actionId, message = 'The asynchronous action should succeed.') {
    let action;
    await expect.poll(async () => {
      const result = await this.get(`/actions/${actionId}`);
      if (result.response.status() !== 200) {
        return false;
      }
      action = result.data;

      return action.status === 'succeeded';
    }, { timeout: 30_000, message }).toBe(true);
    expect(action).toMatchObject({ id: actionId, status: 'succeeded' });

    return action;
  }

  post(route, body, options = {}) {
    return this.send('POST', route, body, { ...options, mutation: true });
  }

  patch(route, body, options = {}) {
    return this.send('PATCH', route, body, { ...options, mutation: true });
  }

  put(route, body, options = {}) {
    return this.send('PUT', route, body, { ...options, mutation: true });
  }

  async createProject({ name = 'QA Project', color = '#B8914C', icon = 'bird', slug: requestedSlug } = {}) {
    const slug = requestedSlug ?? `qa-${randomUUID().slice(0, 8)}`;
    const { response, data } = await this.post('/projects', {
      slug,
      name,
      description: 'Deterministischer End-to-End-Projektkontext.',
      icon_key: icon,
      color,
    });
    expect(response.status(), JSON.stringify(data)).toBe(201);
    return data;
  }

  async createLabel(projectId, { name, key, color, kind = 'topic', description = 'QA-Label für echte öffentliche Abläufe.' }) {
    const { response, data } = await this.post(`/projects/${projectId}/labels`, { name, key, color, kind, description });
    expect(response.status(), JSON.stringify(data)).toBe(201);
    return data;
  }

  async createTask(projectId, values = {}) {
    const { response, data } = await this.post(`/projects/${projectId}/tasks`, {
      title: values.title ?? 'QA Ticket',
      description: values.description ?? 'Ein vollständiger Ablauf über die öffentliche JSON-API.',
      task_type: values.task_type ?? 'task',
      priority: values.priority ?? 'normal',
      criteria: values.criteria ?? [],
      ...(values.status_id ? { status_id: values.status_id } : {}),
      ...(values.label_ids ? { label_ids: values.label_ids } : {}),
      ...(values.link_collections ? { link_collections: values.link_collections } : {}),
    });
    expect([201, 202], JSON.stringify(data)).toContain(response.status());
    const taskId = data?.task_id ?? data?.id ?? data?.task?.id;
    expect(taskId, `Task creation response did not contain a task identity: ${JSON.stringify(data)}`).toBeTruthy();
    return { ...data, id: taskId };
  }

  async ensureDefaultBoard(projectId) {
    let { response: statusResponse, data: statusCollection } = await this.get(`/projects/${projectId}/statuses`);
    expect(statusResponse.status(), JSON.stringify(statusCollection)).toBe(200);
    if (statusCollection.items.length === 0) {
      const { response: projectResponse, data: project } = await this.get(`/projects/${projectId}`);
      expect(projectResponse.status(), JSON.stringify(project)).toBe(200);
      const defaults = [
        ['backlog', 'Backlog', '#88968E'],
        ['ready', 'Bereit', '#346783'],
        ['active', 'In Arbeit', '#176447'],
        ['review', 'Review', '#7754A2'],
        ['done', 'Erledigt', '#95620B'],
        ['cancelled', 'Abgebrochen', '#A34545'],
      ];
      const replacement = await this.put(`/projects/${projectId}/statuses`, {
        statuses: defaults.map(([category, name, color], index) => ({
          id: randomUUID(),
          category,
          name,
          color,
          is_default: index === 1,
        })),
      }, { version: project.version });
      expect(replacement.response.status(), JSON.stringify(replacement.data)).toBe(200);
      statusCollection = replacement.data;
    }

    const { response: boardsResponse, data: boardsPage } = await this.get(`/projects/${projectId}/boards`);
    expect(boardsResponse.status(), JSON.stringify(boardsPage)).toBe(200);
    if (boardsPage.items.length > 0) return boardsPage.items[0];

    const grouped = ['backlog', 'ready', 'active', 'review', 'done', 'cancelled']
      .map((category) => statusCollection.items.filter((status) => status.category === category))
      .filter((statuses) => statuses.length > 0);
    const board = await this.post(`/projects/${projectId}/boards`, {
      name: 'QA-Board',
      config: { filter: {}, sort: 'updated_at', group_by: 'status', swimlane_by: 'none', visible_fields: ['key', 'title', 'priority', 'labels', 'criteria'] },
      columns: grouped.map((statuses) => ({
        name: statuses[0].name,
        status_ids: statuses.map((status) => status.id),
        default_drop_status_id: statuses[0].id,
        wip_limit: null,
        wip_policy: 'block',
      })),
    });
    expect(board.response.status(), JSON.stringify(board.data)).toBe(201);
    return board.data;
  }

  async createTechnicalToken({ label, projectIds, capabilities }) {
    const { response, data } = await this.post('/tokens', {
      label,
      project_ids: projectIds,
      capabilities,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(response.status(), JSON.stringify(data)).toBe(201);
    expect(data.token).toBeTruthy();
    return data;
  }
}

export class AgentSimulator {
  constructor(context, token, baseURL) {
    this.context = context;
    this.token = token;
    this.baseURL = baseURL;
    this.apiPrefix = apiPrefix;
    this.nextId = 1;
    this.sessionId = null;
    this.protocolVersion = process.env.FALKENWARTE_MCP_VERSION ?? '2025-06-18';
  }

  async post(body, extraHeaders = {}) {
    const headers = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...extraHeaders,
    };
    if (this.sessionId) {
      headers['MCP-Protocol-Version'] = this.protocolVersion;
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    const response = await this.context.post('/mcp', { headers, data: body });
    const sessionId = response.headers()['mcp-session-id'];
    if (sessionId) this.sessionId = sessionId;
    const contentType = response.headers()['content-type'] ?? '';
    const text = await response.text();
    let data = null;
    if (text !== '') {
      const jsonText = contentType.includes('text/event-stream')
        ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).at(-1)
        : text;
      if (jsonText) data = JSON.parse(jsonText);
    }
    return { response, data };
  }

  async initialize() {
    const initialized = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: { name: 'falkenwarte-e2e-agent', version: '1.0.0' },
      },
    });
    expect(initialized.response.status()).toBe(200);
    expect(initialized.data?.result?.protocolVersion).toBe(this.protocolVersion);
    const notification = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.response.status()).toBe(202);
    return initialized.data.result;
  }

  async listTools() {
    const result = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} });
    expect(result.response.ok(), JSON.stringify(result.data)).toBeTruthy();
    expect(result.data?.error).toBeUndefined();
    return result.data.result.tools;
  }

  async call(name, args) {
    const result = await this.callRaw(name, args);
    expect(result.response.ok(), JSON.stringify(result.data)).toBeTruthy();
    expect(result.data?.error, JSON.stringify(result.data)).toBeUndefined();
    return result.data.result;
  }

  async callRaw(name, args) {
    const result = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return result;
  }
}

export async function authorizeT3InBrowser(ownerPage, baseURL, t3URL) {
  const callback = new URL('/auth/t3/callback', baseURL);
  const [callbackResponse] = await Promise.all([
    ownerPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === callback.origin && url.pathname === callback.pathname && response.request().isNavigationRequest();
    }),
    ownerPage.waitForRequest((request) => request.url().startsWith(`${t3URL}/authorize?`)),
    ownerPage.getByRole('button', { name: /Bei T3 anmelden/ }).click(),
  ]);
  expect(callbackResponse.status()).toBe(302);
  await ownerPage.waitForURL((url) => url.origin === callback.origin && url.hash === '#/agents', { waitUntil: 'domcontentloaded' });
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
}

export async function createAgentSimulator(baseURL, token) {
  const context = await playwrightRequest.newContext({ baseURL });
  const agent = new AgentSimulator(context, token, baseURL);
  await agent.initialize();
  return {
    agent,
    close: () => context.dispose(),
  };
}

export const test = base.extend({
  isolatedStack: [async ({}, use) => {
    await clearBusinessTime();
    if (process.env.FALKENWARTE_STACK_CONTROL) {
      await resetStack(process.env.FALKENWARTE_STACK_CONTROL);
      const context = await playwrightRequest.newContext();
      try {
        for (const url of [process.env.QA_DECISIONS_MOCK_URL, process.env.QA_T3_MOCK_URL]) {
          const reset = await context.post(url + '/__qa/reset', { data: {} });
          expect(reset.status()).toBe(200);
        }
      } finally {
        await context.dispose();
      }
    }
    await use();
  }, { auto: true, timeout: 105_000 }],
  ownerPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL, storageState: ownerStatePath });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
  ownerApi: async ({ baseURL }, use) => {
    const session = JSON.parse(await readFile(ownerSessionPath, 'utf8'));
    const context = await playwrightRequest.newContext({ baseURL, storageState: ownerStatePath });
    try {
      const owner = new OwnerApi(context, session.csrfToken);
      await use(owner);
    } finally {
      await context.dispose();
    }
  },
  qaMocks: async ({}, use) => {
    const decisionsURL = process.env.QA_DECISIONS_MOCK_URL ?? 'http://127.0.0.1:4310';
    const t3URL = process.env.QA_T3_MOCK_URL ?? 'http://127.0.0.1:4311';
    const context = await playwrightRequest.newContext();
    const reset = async (url) => {
      const response = await context.post(`${url}/__qa/reset`, { data: {} });
      expect(response.status(), await response.text()).toBe(200);
    };
    try {
      await reset(decisionsURL);
      await reset(t3URL);
      await use({
        decisionsURL,
        t3URL,
        setDecisionsScenario: async (scenario) => {
          const response = await context.post(`${decisionsURL}/__qa/scenario`, { data: { scenario } });
          expect(response.status(), await response.text()).toBe(200);
        },
        setT3Scenario: async (scenario) => {
          const response = await context.post(`${t3URL}/__qa/scenario`, { data: { scenario } });
          expect(response.status(), await response.text()).toBe(200);
        },
        setT3OAuthToken: async (token) => {
          const response = await context.post(`${t3URL}/__qa/oauth-token`, { data: { token } });
          expect(response.status(), await response.text()).toBe(200);
          return response.json();
        },
        createExternalT3Activity: async ({ threadId, runId, externalProjectId = 'qa-t3-project-1' } = {}) => {
          const response = await context.post(`${t3URL}/__qa/external-activity`, {
            data: { action: 'create', ...(threadId ? { thread_id: threadId } : {}), ...(runId ? { run_id: runId } : {}), external_project_id: externalProjectId },
          });
          expect(response.status(), await response.text()).toBe(201);
          return response.json();
        },
        completeExternalT3Activity: async ({ threadId, runId, status = 'completed' }) => {
          const response = await context.post(`${t3URL}/__qa/external-activity`, {
            data: { action: 'complete', thread_id: threadId, run_id: runId, status },
          });
          expect(response.status(), await response.text()).toBe(200);
          return response.json();
        },
        releaseDecisions: async () => {
          const response = await context.post(`${decisionsURL}/__qa/release`, { data: {} });
          expect(response.status()).toBe(200);
        },
        releaseT3: async () => {
          const response = await context.post(`${t3URL}/__qa/release`, { data: {} });
          expect(response.status()).toBe(200);
        },
        configureAgentCallback: async (configuration) => {
          const response = await context.post(`${t3URL}/__qa/agent-callback`, { data: configuration });
          expect(response.status()).toBe(200);
        },
        decisionsJournal: async () => (await context.get(`${decisionsURL}/__qa/journal`)).json(),
        t3Journal: async () => (await context.get(`${t3URL}/__qa/journal`)).json(),
      });
    } finally {
      await context.dispose();
    }
  },
});

export { expect };

function sanitizeMockJournal(name, journal) {
  if (name === 'decisions') {
    return {
      service: 'decisions',
      scenario: journal.scenario,
      attempts: journal.attempts,
      barrier_observed: journal.barrier_observed === true,
      requests: journal.requests.map((entry) => ({
        sequence: entry.sequence,
        provider_request_id: entry.provider_request_id,
        method: entry.method,
        path: entry.path,
        model: entry.model,
        payload_keys: entry.payload_keys,
        input_data_keys: entry.input_data_keys,
        sensitive_payload_keys: entry.sensitive_payload_keys,
        question_names: entry.question_names,
        question_types: entry.question_types,
        taxonomy_version: entry.taxonomy_version,
        authorization_present: entry.authorization_present,
        authorization_valid: entry.authorization_valid,
        scenario: entry.scenario,
        validation_error: entry.validation_error,
        outcome: entry.outcome,
      })),
    };
  }
  if (name === 't3') {
    return {
      service: 't3-mcp',
      scenario: journal.scenario,
      unexpected: journal.unexpected.map((entry) => ({ method: entry.method, path: entry.path, tool: entry.tool, outcome: entry.outcome })),
      requests: journal.journal.map((entry) => ({
        sequence: entry.sequence,
        path: entry.path ?? null,
        method: entry.method,
        tool: entry.tool ?? null,
        external_thread_id: entry.external_thread_id ?? null,
        external_run_id: entry.external_run_id ?? null,
        auth_namespace: entry.auth_namespace ?? null,
        protocol_version: entry.protocol_version ?? null,
        arguments_hash: entry.arguments_hash ?? null,
        outcome: entry.outcome,
        launch_payload_hash: entry.launch_payload_hash ?? null,
      })),
      accepted_launches: journal.accepted_launches.map((entry) => ({
        namespace: entry.namespace,
        clientRequestId: entry.clientRequestId,
        payloadHash: entry.payloadHash,
        response: {
          threadId: entry.response.threadId,
          runId: entry.response.runId,
          projectId: entry.response.projectId,
          status: entry.response.status,
        },
        replays: entry.replays,
      })),
    };
  }
  throw new Error(`Unsupported mock journal type: ${name}`);
}

export function recordEvidence(expected, observed, mockJournals = {}) {
  if (typeof expected !== 'string' || !expected.trim() || typeof observed !== 'string' || !observed.trim()) {
    throw new Error('An acceptance result requires a written expectation and a written observation.');
  }
  test.info().annotations.push({ type: 'expected', description: expected });
  test.info().annotations.push({ type: 'observed', description: observed });
  for (const [name, journal] of Object.entries(mockJournals)) {
    test.info().annotations.push({ type: 'mock-journal', description: JSON.stringify(sanitizeMockJournal(name, journal)) });
  }
}
