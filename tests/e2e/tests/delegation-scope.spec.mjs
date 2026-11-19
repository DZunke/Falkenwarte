import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

test('A02 A13 technical run requests need explicit permission and an existing bounded delegation', async ({ baseURL, ownerApi }) => {
  const project = await ownerApi.createProject({ name: 'Begrenzte Übergabe' });
  const task = await ownerApi.createTask(project.id);
  const read = await ownerApi.get('/tasks/' + task.id);
  for (const granted of [false, true]) {
    const issued = await ownerApi.createTechnicalToken({
      label: granted ? 'Delegierte Folgephase' : 'Normale Rolle',
      projectIds: [project.id],
      capabilities: granted ? ['tasks.read', 'runs.request'] : ['tasks.read'],
    });
    const simulator = await createAgentSimulator(baseURL, issued.token);
    try {
      const tools = await simulator.agent.listTools();
      expect(tools.some((entry) => entry.name === 'runs_request')).toBe(granted);
      if (granted) {
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
