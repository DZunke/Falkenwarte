import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('M4 a domain event starts one manual workflow and leaves other project trigger versions unchanged', async ({ ownerApi }) => {
  const project = await ownerApi.createProject({ name: 'Ereignisgesteuerte Freigabe' });
  const statuses = await ownerApi.get('/projects/' + project.id + '/statuses');
  const ready = statuses.data.items.find((status) => status.category === 'ready');
  expect(ready).toBeTruthy();
  const definition = await ownerApi.post('/workflows', {
    project_id: project.id, name: 'Fachliche Sichtung', preset_id: 'manual', enabled: true,
    stages: [{ id: 'sichten', kind: 'manual', name: 'Sichten', agent_profile_id: null, entry_conditions: [],
      run_completion_policy: { require_external_settled: true, required_evidence_kinds: [], required_criterion_ids: [], require_human_phase_decision: true, require_human_confirmed_evidence: false } }],
    transitions: [], limits: { max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600, max_repair_rounds: 0 },
  });
  expect(definition.response.status(), JSON.stringify(definition.data)).toBe(201);
  const workflowId = definition.data.id;
  const trigger = async (name, eventType) => {
    const result = await ownerApi.post('/triggers', {
      project_id: project.id, workflow_id: workflowId, name, enabled: true, task_id: null,
      spec: { type: 'domain_event', event_type: eventType, task_status_id: ready.id },
    });
    expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
    return result.data;
  };
  const created = await trigger('Neue Tickets sichten', 'task.created');
  const unrelated = await trigger('Auf Bearbeitung warten', 'task.updated');
  const tickets = [];
  for (const title of ['Angebot sichten', 'Lieferung sichten']) {
    const task = await ownerApi.createTask(project.id, { title, status_id: ready.id });
    tickets.push(task);
    await expect.poll(async () => {
      const instances = await ownerApi.get('/workflow-instances?task_id=' + task.id);
      expect(instances.response.status(), JSON.stringify(instances.data)).toBe(200);
      return instances.data.items.filter((item) => item.workflow_id === workflowId && item.current_stage_id === 'sichten').length;
    }, { timeout: 20_000 }).toBe(1);
  }
  const processed = await ownerApi.get('/triggers/' + created.id);
  expect(processed.data.last_fired_at).toBeTruthy();
  const idle = await ownerApi.get('/triggers/' + unrelated.id);
  expect(idle.data).toMatchObject({ version: unrelated.version, last_fired_at: null });
  for (const ticket of tickets) {
    expect((await ownerApi.get('/workflow-instances?task_id=' + ticket.id)).data.items).toHaveLength(1);
    expect((await ownerApi.get('/runs?task_id=' + ticket.id)).data.items).toHaveLength(0);
  }
  recordEvidence('Nur passende Fachereignisse lösen einen Workflow aus.', 'Zwei neue Tickets erhielten je eine manuelle Sichtung ohne T3-Auftrag. Der Trigger für Bearbeitungen behielt seine Version und wurde nie ausgelöst.');
});
