import { randomUUID } from 'node:crypto';
import { test, expect, createAgentSimulator, recordEvidence } from '../support/fixtures.mjs';

async function expectWithinMobileViewport(locator, label) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  expect(bounds, `${label} has no rendered bounds`).toBeTruthy();
  expect(bounds.x, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width, `${label} extends past the right edge`).toBeLessThanOrEqual(391);
}

async function configureAmbiguousIntake(ownerApi, ownerPage, project) {
  const suffix = randomUUID().slice(0, 6);
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

  await ownerPage.goto('/#/labels');
  const projectSelect = ownerPage.getByRole('combobox', { name: 'Projekt für Labels' });
  await projectSelect.click();
  await ownerPage.getByRole('option', { name: project.name, exact: true }).click();

  const createLabelInUi = async ({ key, name, kind, description }) => {
    await ownerPage.getByRole('button', { name: 'Label anlegen' }).click();
    const dialog = ownerPage.getByRole('dialog', { name: 'Label anlegen' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Stabiler Schlüssel').fill(key);
    await dialog.getByLabel('Beschreibung').fill(description);
    if (kind === 'workflow') {
      await dialog.getByLabel('Labelart').click();
      await ownerPage.getByRole('option', { name: 'Workflowroute', exact: true }).click();
    }
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(ownerPage.getByText(name, { exact: true }).first()).toBeVisible();
  };

  await createLabelInUi({ key: `topic-ui-${suffix}`, name: 'Darstellung', kind: 'topic', description: 'Darstellung und Bedienung einer Ansicht.' });
  await createLabelInUi({ key: `workflow-ui-a-${suffix}`, name: 'Bedienung ändern', kind: 'workflow', description: 'Änderung an einer sichtbaren Oberfläche.' });
  await createLabelInUi({ key: `workflow-ui-b-${suffix}`, name: 'Dokumentation ergänzen', kind: 'workflow', description: 'Ergänzung einer Produktbeschreibung.' });

  const labelsResponse = await ownerApi.get(`/projects/${project.id}/labels`);
  expect(labelsResponse.response.status(), JSON.stringify(labelsResponse.data)).toBe(200);
  const topic = labelsResponse.data.items.find((label) => label.key === `topic-ui-${suffix}`);
  const workflowLabels = ['workflow-ui-a-', 'workflow-ui-b-'].map((prefix) => labelsResponse.data.items.find((label) => label.key === `${prefix}${suffix}`));
  expect(topic).toBeTruthy();
  expect(workflowLabels.every(Boolean)).toBe(true);

  await expect(ownerPage.getByText('Workflowzuordnung', { exact: true })).toBeVisible();
  for (let index = 0; index < workflowLabels.length; index += 1) {
    const label = workflowLabels[index];
    const workflow = workflows[index];
    await ownerPage.getByRole('combobox', { name: `Route für ${label.name}`, exact: true }).click();
    await ownerPage.getByRole('option', { name: `${workflow.name} · v${workflow.definition_version ?? 1}`, exact: true }).click();
  }
  await ownerPage.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(ownerPage.getByText('Workflowzuordnung gespeichert')).toBeVisible();
  const routeState = await ownerApi.get(`/projects/${project.id}/routing-rules`);
  expect(routeState.response.status(), JSON.stringify(routeState.data)).toBe(200);
  expect(routeState.data.rules).toHaveLength(2);
  expect(routeState.data.rules.every((rule) => workflowLabels.some((label) => label.id === rule.workflow_label_id))).toBe(true);

  await ownerPage.goto('/#/settings');
  await expect(ownerPage.getByRole('heading', { name: 'Einordnung', exact: true })).toBeVisible();
  await ownerPage.getByLabel('Neue Secret-Bezeichnung').fill(`QA Decisions ${suffix}`);
  await ownerPage.getByLabel('OpenAI API-Schlüssel').fill('qa-decisions-token');
  await ownerPage.getByRole('button', { name: 'Secret anlegen', exact: true }).click();
  await expect(ownerPage.getByRole('combobox', { name: 'OpenAI-Secret-Referenz' })).toContainText(`QA Decisions ${suffix}`);
  await ownerPage.getByRole('button', { name: 'Verbindung speichern', exact: true }).click();
  await expect.poll(async () => (await ownerApi.get('/decision-configuration')).data.configured).toBe(true);

  await ownerPage.getByRole('combobox', { name: 'Projekt', exact: true }).click();
  await ownerPage.getByRole('option', { name: project.name, exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Pflichtangabe ergänzen' }).click();
  await ownerPage.getByLabel('Feldschlüssel').fill('expected_behavior');
  await ownerPage.getByLabel('Gesuchte Angabe').fill('das erwartete Verhalten');
  await ownerPage.getByLabel('Rückfrage an den ursprünglichen Agenten').fill('Welches Verhalten wird stattdessen erwartet?');
  await ownerPage.getByRole('button', { name: 'Projektregeln speichern' }).click();

  await expect(ownerPage.getByText('Einordnungsregeln gespeichert')).toBeVisible();
  const policy = await ownerApi.get(`/projects/${project.id}/decision-policy`);
  expect(policy.response.status(), JSON.stringify(policy.data)).toBe(200);
  expect(policy.data.requirements[0].question_template).toBe('Welches Verhalten wird stattdessen erwartet?');
  const configuration = await ownerApi.get('/decision-configuration');
  expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);
  expect(configuration.data.configured).toBe(true);
  expect(configuration.data.secret_reference_id).toBeTruthy();

  return { topic, workflowLabels };
}

test('A27 owner resolves an ambiguous intake from the dashboard task decision panel', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Eine mehrdeutige Einordnung erscheint bei mobiler Breite und 200 Prozent Grundschrift in der Dashboard-Aufmerksamkeit, führt per Tastatur zum betroffenen Ticket und wird mit begründeter Ownerentscheidung aufgelöst.' });
  const project = await ownerApi.createProject({ name: `UI Ticketentscheidung ${randomUUID().slice(0, 6)}`, color: '#887AA8' });
  await ownerApi.ensureDefaultBoard(project.id);
  const { topic, workflowLabels } = await configureAmbiguousIntake(ownerApi, ownerPage, project);
  const token = await ownerApi.createTechnicalToken({
    label: `UI Decisions ${randomUUID().slice(0, 6)}`,
    projectIds: [project.id],
    capabilities: ['projects.read', 'tasks.read', 'tasks.write'],
  });
  const simulator = await createAgentSimulator(baseURL, token.token);

  try {
    await qaMocks.setDecisionsScenario('decisions_missing_information');
    const title = `UI-Aufgabe braucht eine Arbeitsablaufentscheidung ${randomUUID().slice(0, 6)}`;
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

    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerPage.goto(`/#/project/${project.id}/board?task=${taskId}`);
    await ownerPage.addStyleTag({ content: ':root { font-size: 200% !important; }' });
    expect(await ownerPage.locator('html').evaluate((element) => getComputedStyle(element).fontSize)).toBe('32px');
    await expectWithinMobileViewport(ownerPage.getByRole('heading', { name: title }), 'Ticket sheet heading with requester question');
    const requesterDecisionTab = ownerPage.getByRole('tab', { name: 'Entscheidungen' });
    await requesterDecisionTab.focus();
    await ownerPage.keyboard.press('Enter');
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
    await expectWithinMobileViewport(decisionLink, 'Dashboard decision link');
    await decisionLink.focus();
    await ownerPage.keyboard.press('Enter');
    await expectWithinMobileViewport(ownerPage.getByRole('heading', { name: title }), 'Ticket sheet heading with owner decision');
    const ownerDecisionTab = ownerPage.getByRole('tab', { name: 'Entscheidungen' });
    await ownerDecisionTab.focus();
    await ownerPage.keyboard.press('Enter');
    await expect(ownerPage.getByText('Eigentümerentscheidung')).toBeVisible();
    await expect(ownerPage.getByText('Klassifikationsnachweis')).toBeVisible();

    const decisionPanel = ownerPage.getByTestId('task-decisions');
    const workflowSelect = decisionPanel.getByRole('combobox', { name: 'Arbeitsablauf', exact: true });
    await workflowSelect.focus();
    await ownerPage.keyboard.press('Enter');
    await ownerPage.getByRole('option', { name: workflowLabels[0].name, exact: true }).click();
    await ownerPage.getByLabel('Begründung', { exact: true }).fill('Die Anfrage beschreibt eine sichtbare Bedienungsänderung.');
    const decideButton = ownerPage.getByRole('button', { name: 'Einordnung festlegen' });
    await expectWithinMobileViewport(decideButton, 'Owner decision button');
    await decideButton.focus();
    await ownerPage.keyboard.press('Enter');

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
      `MCP erzeugte Task ${taskId} mit needs_human_decision. Chromium zeigte das Ticket und die offene Entscheidung bei 390×844 Pixeln und 200 Prozent Grundschrift. Tastatursteuerung öffnete Dashboardlink, Entscheidungen-Tab, Arbeitsablauf-Auswahl und Abschlussbutton. Die Ownerentscheidung setzte Workflowlabel ${workflowLabels[0].id}. Öffentliche Task- und Intake-Reads bestätigten outcome=ready und human_attention.required=false.`,
    );
  } finally {
    await simulator.close();
  }
});
