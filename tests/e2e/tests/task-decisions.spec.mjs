import { randomUUID } from 'node:crypto';
import { test, expect, createAgentSimulator, recordEvidence } from '../support/fixtures.mjs';

async function configureAmbiguousIntake(ownerApi, project) {
  const suffix = randomUUID().slice(0, 6);
  const topic = await ownerApi.createLabel(project.id, {
    key: `topic.ui-${suffix}`,
    name: 'Darstellung',
    color: '#729E90',
    kind: 'topic',
    description: 'Darstellung und Bedienung einer Ansicht.',
  });
  const workflowLabels = await Promise.all(['workflow.ui-a', 'workflow.ui-b'].map((key, index) => ownerApi.createLabel(project.id, {
    key: `${key}-${suffix}`,
    name: index === 0 ? 'Bedienung ändern' : 'Dokumentation ergänzen',
    color: index === 0 ? '#C89562' : '#8FA78E',
    kind: 'workflow',
    description: index === 0 ? 'Änderung an einer sichtbaren Oberfläche.' : 'Ergänzung einer Produktbeschreibung.',
  })));

  const workflows = await Promise.all(['Oberflächenarbeit', 'Dokumentationsarbeit'].map(async (name) => {
    const result = await ownerApi.post('/workflows', {
      project_id: project.id,
      name,
      preset_id: 'manual',
      stages: [{
        id: 'work',
        kind: 'implementation',
        name: 'Bearbeitung',
        agent_profile_id: null,
        entry_conditions: [],
        run_completion_policy: {
          require_external_settled: true,
          required_evidence_kinds: [],
          required_criterion_ids: [],
          require_human_phase_decision: false,
          require_human_confirmed_evidence: false,
        },
      }],
      transitions: [],
      limits: { max_repair_rounds: 1, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
      enabled: true,
    });
    expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
    return result.data.workflow ?? result.data;
  }));

  const routeState = await ownerApi.get(`/projects/${project.id}/routing-rules`);
  expect(routeState.response.status(), JSON.stringify(routeState.data)).toBe(200);
  const route = await ownerApi.put(`/projects/${project.id}/routing-rules`, {
    rules: workflowLabels.map((label, index) => ({
      workflow_label_id: label.id,
      workflow_id: workflows[index].id,
      workflow_definition_version: workflows[index].definition_version ?? 1,
    })),
    on_unresolved: 'needs_human_decision',
  }, { version: routeState.data.version });
  expect(route.response.status(), JSON.stringify(route.data)).toBe(200);

  const policyState = await ownerApi.get(`/projects/${project.id}/decision-policy`);
  expect(policyState.response.status(), JSON.stringify(policyState.data)).toBe(200);
  const policy = await ownerApi.put(`/projects/${project.id}/decision-policy`, {
    enabled_for_manual: false,
    requirements: [{
      field_key: 'expected_behavior',
      description: 'das erwartete Verhalten',
      question_template: 'Welches Verhalten wird stattdessen erwartet?',
      workflow_label_ids: [],
      required: true,
    }],
    minimum_choice_probability: 0.65,
    minimum_choice_confidence: 0.65,
    minimum_choice_margin: 0.15,
    positive_tag_threshold: 0.7,
    missing_field_threshold: 0.7,
    max_clarification_rounds: 3,
  }, { version: policyState.data.version });
  expect(policy.response.status(), JSON.stringify(policy.data)).toBe(200);

  const secret = await ownerApi.post('/secret-references', { label: 'QA Decisions UI', value: 'qa-decisions-token' });
  expect(secret.response.status(), JSON.stringify(secret.data)).toBe(201);
  const configState = await ownerApi.get('/decision-configuration');
  expect(configState.response.status(), JSON.stringify(configState.data)).toBe(200);
  const configuration = await ownerApi.put('/decision-configuration', {
    secret_reference_id: secret.data.id,
    timeout_ms: 5000,
    max_attempts: 2,
    max_requests_per_hour: 100,
  }, { version: configState.data.version });
  expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);

  return { topic, workflowLabels };
}

test('A27 owner resolves an ambiguous intake from the dashboard task decision panel', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Eine mehrdeutige Einordnung erscheint in der Dashboard-Aufmerksamkeit, führt zum betroffenen Ticket und wird mit begründeter Ownerentscheidung aufgelöst.' });
  const project = await ownerApi.createProject({ name: 'UI Ticketentscheidung', color: '#887AA8' });
  await ownerApi.ensureDefaultBoard(project.id);
  const { topic, workflowLabels } = await configureAmbiguousIntake(ownerApi, project);
  const token = await ownerApi.createTechnicalToken({
    label: `UI Decisions ${randomUUID().slice(0, 6)}`,
    projectIds: [project.id],
    capabilities: ['projects.read', 'tasks.read', 'tasks.write'],
  });
  const simulator = await createAgentSimulator(baseURL, token.token);

  try {
    await qaMocks.setDecisionsScenario('decisions_missing_information');
    const title = 'UI-Aufgabe braucht eine Arbeitsablaufentscheidung';
    const created = await simulator.agent.call('tasks_create', {
      client_request_id: `ui-intake-${randomUUID()}`,
      project_id: project.id,
      title,
      description: 'Die Anfrage kann eine sichtbare Änderung oder eine Dokumentationsergänzung bedeuten.',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 1500,
    });
    expect(created.isError, JSON.stringify(created)).toBe(false);
    const taskId = created.structuredContent.task_id;
    expect(taskId).toBeTruthy();
    await expect.poll(async () => {
      const intake = await simulator.agent.call('tasks_intake_get', { task_id: taskId });
      return intake.structuredContent?.outcome;
    }, { timeout: 30_000 }).toBe('needs_information');
    const requesterIntake = await simulator.agent.call('tasks_intake_get', { task_id: taskId });
    expect(requesterIntake.structuredContent.missing_fields[0].question).toBe('Welches Verhalten wird stattdessen erwartet?');

    await ownerPage.goto(`/#/project/${project.id}/board?task=${taskId}`);
    await expect(ownerPage.getByRole('heading', { name: title })).toBeVisible();
    await ownerPage.getByRole('tab', { name: 'Entscheidungen' }).click();
    await expect(ownerPage.getByText('Welches Verhalten wird stattdessen erwartet?')).toBeVisible();
    await expect(ownerPage.getByText('Agent antwortet')).toBeVisible();
    await expect(ownerPage.getByRole('button', { name: 'Einordnung festlegen' })).toHaveCount(0);

    await qaMocks.setDecisionsScenario('decisions_ambiguous');
    const answered = await simulator.agent.call('tasks_supply_information', {
      task_id: taskId,
      expected_version: requesterIntake.structuredContent.task_version,
      client_request_id: `ui-answer-${randomUUID()}`,
      prefer_wait_ms: 0,
      answers: [{ field_key: 'expected_behavior', value: 'Die Ansicht zeigt den gewählten Projektfilter.' }],
    });
    expect(answered.isError, JSON.stringify(answered)).toBe(false);
    await expect.poll(async () => {
      const intake = await simulator.agent.call('tasks_intake_get', { task_id: taskId });
      return intake.structuredContent?.outcome;
    }, { timeout: 30_000 }).toBe('needs_human_decision');

    await ownerPage.goto('/#/dashboard');
    const decisionLink = ownerPage.getByRole('link', { name: title, exact: true });
    await expect(decisionLink).toBeVisible();
    await decisionLink.click();
    await expect(ownerPage.getByRole('heading', { name: title })).toBeVisible();
    await ownerPage.getByRole('tab', { name: 'Entscheidungen' }).click();
    await expect(ownerPage.getByText('Eigentümerentscheidung')).toBeVisible();
    await expect(ownerPage.getByText('Klassifikationsnachweis')).toBeVisible();

    await ownerPage.getByLabel('Arbeitsablauf').click();
    await ownerPage.getByRole('option', { name: workflowLabels[0].name, exact: true }).click();
    await ownerPage.getByLabel('Begründung', { exact: true }).fill('Die Anfrage beschreibt eine sichtbare Bedienungsänderung.');
    await ownerPage.getByRole('button', { name: 'Einordnung festlegen' }).click();

    const decisionPanel = ownerPage.getByTestId('task-decisions');
    await expect(decisionPanel.getByText('Eingeordnet', { exact: true })).toBeVisible();
    await expect(decisionPanel.getByText('Mensch erforderlich', { exact: true })).toHaveCount(0);
    await expect.poll(async () => {
      const task = await ownerApi.get(`/tasks/${taskId}`);
      return task.data.human_attention.required;
    }).toBe(false);
    const finalTask = await ownerApi.get(`/tasks/${taskId}`);
    expect(finalTask.response.status()).toBe(200);
    expect(finalTask.data.intake_outcome).toBe('ready');
    expect(finalTask.data.workflow_label_id).toBe(workflowLabels[0].id);
    const finalIntake = await ownerApi.get(`/tasks/${taskId}/intake`);
    expect(finalIntake.response.status()).toBe(200);
    expect(finalIntake.data.outcome).toBe('ready');
    expect(finalIntake.data.human_attention.required).toBe(false);
    const projectTasks = await ownerApi.get(`/tasks?project_id=${encodeURIComponent(project.id)}&limit=100`);
    expect(projectTasks.response.status()).toBe(200);
    expect(projectTasks.data.items.filter((task) => task.id === taskId)).toHaveLength(1);

    recordEvidence(
      'Der Dashboard-Link öffnet das richtige Ticket. Der Eigentümer kann die geprüfte Ticketrevision und Klassifikationsantworten lesen, eine zulässige Route begründet festlegen und den offenen Attention-Grund auflösen.',
      `MCP erzeugte Task ${taskId} mit needs_human_decision. Der Browser navigierte vom Dashboard ins Ticket-Sheet, zeigte Frage/Revision und ClassificationRecord, und die Ownerentscheidung setzte Workflowlabel ${workflowLabels[0].id}. Öffentliche Task- und Intake-Reads bestätigten outcome=ready und human_attention.required=false.`,
    );
  } finally {
    await simulator.close();
  }
});
