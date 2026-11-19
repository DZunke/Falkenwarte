import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';
import { createAgentSimulator, expect, OwnerApi, recordEvidence, test } from '../support/fixtures.mjs';
import { resetStack } from '../support/reset-stack.mjs';

test('A13 identical agent mutations and conflict semantics over JSON and MCP', async ({ baseURL }) => {
  test.setTimeout(135_000);
  async function exercise(transport) {
    const ownerContext = await request.newContext({ baseURL });
    const login = await ownerContext.post('/api/v1/session', {
      data: { password: process.env.FALKENWARTE_QA_OWNER_PASSWORD ?? 'Falkenwarte-Test-Owner-Password-2026!' },
    });
    expect(login.status()).toBe(200);
    const owner = new OwnerApi(ownerContext, (await login.json()).csrf_token);
    const project = await owner.createProject({ name: 'Gemeinsame Fachregeln' });
    const issued = await owner.createTechnicalToken({
      label: 'Prüfender Agent', projectIds: [project.id], capabilities: ['tasks.read', 'tasks.write'],
    });
    const task = await owner.createTask(project.id, { title: 'Ausgangszustand' });
    const before = (await owner.get('/tasks/' + task.id)).data;
    const http = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: 'Bearer ' + issued.token } });
    const mcp = await createAgentSimulator(baseURL, issued.token);
    try {
      const names = (await mcp.agent.listTools()).map(({ name }) => name);
      expect(names.some((name) => name.startsWith('approvals_decide'))).toBe(false);
      async function mutate(key, title) {
        if (transport === 'http') {
          const response = await http.patch('/api/v1/tasks/' + task.id, {
            headers: { 'If-Match': '"' + before.version + '"', 'Idempotency-Key': key }, data: { title },
          });
          return { status: response.status(), data: await response.json() };
        }
        const result = await mcp.agent.call('tasks_update', {
          task_id: task.id, client_request_id: key, expected_version: before.version, title,
        });
        return { status: result.isError ? result.structuredContent.status : 200, data: result.structuredContent };
      }
      const key = randomUUID();
      const updated = await mutate(key, 'Eingang eingegrenzt');
      expect(updated.status).toBe(200);
      const replay = await mutate(key, 'Eingang eingegrenzt');
      expect(replay.data).toEqual(updated.data);
      const stale = await mutate(randomUUID(), 'Überholter Inhalt');
      expect(stale.status).toBe(412);
      expect(stale.data.code).toBe('version_conflict');
      const history = await owner.get('/history?resource_type=task&resource_id=' + task.id);
      const revisions = history.data.items.filter((revision) => revision.actor.kind === 'agent');
      expect(revisions).toHaveLength(1);
      const titleChange = revisions[0].changes.find((item) => item.path === '/title');
      return { title: updated.data.title, version: updated.data.version - before.version,
        status: updated.data.status_category, titleChange, conflict: stale.data.code, actor: revisions[0].actor.kind };
    } finally {
      await mcp.close();
      await http.dispose();
      await ownerContext.dispose();
    }
  }
  const json = await exercise('http');
  if (process.env.FALKENWARTE_STACK_CONTROL) await resetStack(process.env.FALKENWARTE_STACK_CONTROL);
  const mcp = await exercise('mcp');
  expect(mcp).toEqual(json);
  expect(mcp.version).toBe(1);
  recordEvidence('Die gleiche Agentänderung erzeugt über beide Protokolle eine Revision und die gleiche Konfliktrückmeldung.', 'Ticketinhalt, Versionszuwachs, Status, Eigentümer-Historie mit Agent-Akteur, idempotentes Replay und veraltete Schreibversuche stimmten über JSON und MCP überein.');
});
