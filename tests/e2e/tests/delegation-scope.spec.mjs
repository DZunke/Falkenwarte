import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

test('A02 A13 technical run requests need explicit permission and an existing bounded delegation', async ({ baseURL, ownerApi }) => {
  const project = await ownerApi.createProject({ name: 'Begrenzte Übergabe' });
  const task = await ownerApi.createTask(project.id);
  const read = await ownerApi.get('/tasks/' + task.id);
  const sessionIds = new Map();
  for (const granted of [false, true]) {
    const issued = await ownerApi.createTechnicalToken({
      label: granted ? 'Delegierte Folgephase' : 'Normale Rolle',
      projectIds: [project.id],
      capabilities: granted ? ['tasks.read', 'runs.request'] : ['tasks.read'],
    });
    const simulator = await createAgentSimulator(baseURL, issued.token);
    try {
      const ownSessionId = simulator.agent.sessionId;
      expect(ownSessionId).toBeTruthy();
      const tools = await simulator.agent.listTools();
      expect(simulator.agent.sessionId).toBe(ownSessionId);
      expect(tools.some((entry) => entry.name === 'runs_request')).toBe(granted);
      sessionIds.set(granted ? 'delegated' : 'ordinary', ownSessionId);
      if (granted) {
        const ordinarySession = sessionIds.get('ordinary');
        expect(ordinarySession).toBeTruthy();
        expect(ownSessionId).not.toBe(ordinarySession);

        simulator.agent.sessionId = ordinarySession;
        const crossPrincipalList = await simulator.agent.post({
          jsonrpc: '2.0',
          id: simulator.agent.nextId++,
          method: 'tools/list',
          params: {},
        });
        expect(crossPrincipalList.response.status()).toBe(404);
        simulator.agent.sessionId = ownSessionId;
        expect((await simulator.agent.listTools()).some((entry) => entry.name === 'runs_request')).toBe(true);

        const denied = await simulator.agent.call('runs_request', {
          task_id: task.id, agent_profile_id: randomUUID(), stage: 'work', task_revision: read.data.version,
          expected_version: read.data.version, client_request_id: randomUUID(),
        });
        expect(denied.isError).toBe(true);
        expect(denied.structuredContent.status).toBe(403);
        const runs = await ownerApi.get('/runs?task_id=' + task.id);
        expect(runs.response.status()).toBe(200);
        expect(runs.data.items).toHaveLength(0);
      }
    } finally {
      await simulator.close();
    }
  }
  recordEvidence('Die Startberechtigung muss dem technischen Token ausdrücklich zugewiesen sein. Auch dann braucht der Agent eine bestehende begrenzte Übergabe.', 'Zwei getrennte MCP-Sitzungen zeigten unterschiedliche Werkzeuge. Der berechtigte Agent erhielt für einen eigenständigen Start HTTP-Problemstatus 403 und es entstand kein Run.');
});
