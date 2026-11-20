import { randomUUID } from 'node:crypto';
import { expect, recordEvidence, test } from '../support/fixtures.mjs';

const runPolicy = {
  require_external_settled: true,
  required_evidence_kinds: [],
  required_criterion_ids: [],
  require_human_phase_decision: false,
  require_human_confirmed_evidence: false,
};

async function readUntil(ownerApi, route, matches, description, timeout = 45_000) {
  let current;
  await expect.poll(async () => {
    const result = await ownerApi.get(route);
    if (result.response.status() !== 200) return false;
    current = result.data;
    return matches(current);
  }, { timeout, message: description }).toBe(true);
  return current;
}

async function configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, name) {
  const created = await ownerApi.post('/connections', {
    name: `${name} ${randomUUID().slice(0, 6)}`,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, {
    redirect_uri: new URL('/auth/t3/callback', baseURL).toString(),
  }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Der T3-Mock muss im Browser autorisiert werden.');
  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  const readyConnection = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der MCP-Handshake mit dem T3-Mock muss erfolgreich sein.');
  const projectRead = await ownerApi.get(`/projects/${project.id}`);
  expect(projectRead.response.status(), JSON.stringify(projectRead.data)).toBe(200);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: projectRead.data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
  return readyConnection;
}

async function createProfile(ownerApi, project, connection, name) {
  const result = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role: 'Bearbeitung',
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Bearbeite ausschließlich die zugewiesene Workflowphase.',
    enabled: true,
    default_run_completion_policy: runPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  expect(result.data.configuration_valid).toBe(true);
  return result.data;
}

async function createWorkflow(ownerApi, projectId, profile, name) {
  const result = await ownerApi.post('/workflows', {
    project_id: projectId,
    name,
    preset_id: 'manual',
    stages: [{
      id: 'bearbeiten',
      kind: 'agent_run',
      name: 'Bearbeitung',
      agent_profile_id: profile.id,
      instructions: 'Bearbeite diese Phase und melde das Ergebnis.',
      entry_conditions: [],
      run_completion_policy: runPolicy,
    }],
    transitions: [],
    limits: { max_repair_rounds: 0, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data.workflow ?? result.data;
}

async function createUnassignedWorkflow(ownerApi, projectId, name) {
  const result = await ownerApi.post('/workflows', {
    project_id: projectId,
    name,
    preset_id: 'manual',
    stages: [{
      id: 'bearbeiten',
      kind: 'agent_run',
      name: 'Bearbeitung ohne Rolle',
      agent_profile_id: null,
      instructions: 'Diese unvollständige Phase darf nicht starten.',
      entry_conditions: [],
      run_completion_policy: runPolicy,
    }],
    transitions: [],
    limits: { max_repair_rounds: 0, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data.workflow ?? result.data;
}

async function setupProject(ownerApi, ownerPage, baseURL, qaMocks, name) {
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 8);
  const project = await ownerApi.createProject({ name: `${name} ${suffix}` });
  const connection = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, name);
  const board = await ownerApi.ensureDefaultBoard(project.id);
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  return { suffix, project, connection, board, statuses: statuses.data.items };
}

async function selectOption(page, control, optionName) {
  await control.click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function openTaskOnBoard(ownerPage, title) {
  const card = ownerPage.locator('[aria-roledescription="Ticketkarte"]').filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await card.getByRole('button').first().click();
  const sheet = ownerPage.getByRole('dialog', { name: title, exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: 'Ausführung', exact: true }).click();
  return { sheet, panel: sheet.getByRole('tabpanel', { name: 'Ausführung' }) };
}

async function closeTaskSheet(sheet) {
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();
}

async function updateBoardPolicy(ownerApi, board, workflowId, manualLabelId) {
  const latest = await ownerApi.get(`/boards/${board.id}`);
  expect(latest.response.status(), JSON.stringify(latest.data)).toBe(200);
  const workflowPolicy = { workflow_id: workflowId };
  if (manualLabelId) workflowPolicy.manual_label_id = manualLabelId;
  const updated = await ownerApi.patch(`/boards/${board.id}`, {
    config: { ...latest.data.config, workflow_policy: workflowPolicy },
  }, { version: latest.data.version });
  expect(updated.response.status(), JSON.stringify(updated.data)).toBe(200);
  return updated.data;
}

async function startWorkflow(ownerApi, task, workflow, boardId) {
  const result = await ownerApi.post(`/tasks/${task.id}/workflow-instances`, {
    workflow_id: workflow.id,
    definition_version: workflow.definition_version,
    task_revision: task.version,
    board_id: boardId,
  }, { version: task.version });
  return result;
}

test('board workflow defaults wait for an explicit click and manual labels override pinned routes', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(300_000);
  test.info().annotations.push({ type: 'scenario', description: 'Boardworkflows werden gespeichert, vorausgewählt und nur durch ausdrücklichen Ticketstart ausgeführt; ein manuelles Label sperrt auch eine eingefrorene Workflowroute.' });
  const setup = await setupProject(ownerApi, ownerPage, baseURL, qaMocks, 'Boardworkflow expliziter Start');
  const profile = await createProfile(ownerApi, setup.project, setup.connection, `Redaktion ${setup.suffix}`);
  const defaultWorkflow = await createWorkflow(ownerApi, setup.project.id, profile, `Standardworkflow ${setup.suffix}`);
  const routeWorkflow = await createWorkflow(ownerApi, setup.project.id, profile, `Labelroute ${setup.suffix}`);
  const unfinishedWorkflow = await createUnassignedWorkflow(ownerApi, setup.project.id, `Unvollständiger Workflow ${setup.suffix}`);
  const manualLabel = await ownerApi.createLabel(setup.project.id, {
    name: `Manuell ${setup.suffix}`,
    key: `manuell-${setup.suffix}`,
    color: '#B07B40',
  });
  const workflowLabel = await ownerApi.createLabel(setup.project.id, {
    name: `Route ${setup.suffix}`,
    key: `route-${setup.suffix}`,
    color: '#7A5AB8',
    kind: 'workflow',
  });
  const routing = await ownerApi.get(`/projects/${setup.project.id}/routing-rules`);
  expect(routing.response.status(), JSON.stringify(routing.data)).toBe(200);
  const routingUpdate = await ownerApi.put(`/projects/${setup.project.id}/routing-rules`, {
    rules: [{
      workflow_label_id: workflowLabel.id,
      workflow_id: routeWorkflow.id,
      workflow_definition_version: routeWorkflow.definition_version,
    }],
    on_unresolved: 'needs_human_decision',
  }, { version: routing.data.version });
  expect(routingUpdate.response.status(), JSON.stringify(routingUpdate.data)).toBe(200);

  const backlog = setup.statuses.find((status) => status.category === 'backlog');
  const ready = setup.statuses.find((status) => status.category === 'ready');
  const active = setup.statuses.find((status) => status.category === 'active');
  expect(backlog).toBeTruthy();
  expect(ready).toBeTruthy();
  expect(active).toBeTruthy();
  const rolelessTask = await ownerApi.createTask(setup.project.id, {
    title: `Phase ohne Rolle ${setup.suffix}`,
    status_id: ready.id,
  });
  const rolelessStart = await startWorkflow(ownerApi, rolelessTask, unfinishedWorkflow, setup.board.id);
  expect(rolelessStart.response.status(), JSON.stringify(rolelessStart.data)).toBe(409);
  expect(rolelessStart.data.code).toBe('workflow_profile_required');
  const rolelessInstances = await ownerApi.get(`/workflow-instances?task_id=${rolelessTask.id}`);
  expect(rolelessInstances.response.status(), JSON.stringify(rolelessInstances.data)).toBe(200);
  expect(rolelessInstances.data.items).toHaveLength(0);
  expect((await qaMocks.t3Journal()).accepted_launches).toHaveLength(0);

  const taskTitle = `Aufgabe mit manuellem Start ${setup.suffix}`;
  const task = await ownerApi.createTask(setup.project.id, { title: taskTitle, status_id: backlog.id });

  await ownerPage.goto(`/#/project/${setup.project.id}/board`);
  await expect(ownerPage.getByRole('heading', { name: setup.project.name, exact: true })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Workflowstandard', exact: true }).click();
  const settings = ownerPage.getByRole('dialog', { name: 'Boardworkflow festlegen', exact: true });
  await expect(settings).toBeVisible();
  await selectOption(ownerPage, settings.getByLabel('Standardworkflow', { exact: true }), `${defaultWorkflow.name} · Version ${defaultWorkflow.definition_version}`);
  await selectOption(ownerPage, settings.getByLabel('Label für manuelle Tickets', { exact: true }), manualLabel.name);
  await settings.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
  await expect(settings).toBeHidden();

  const savedBoard = await ownerApi.get(`/boards/${setup.board.id}`);
  expect(savedBoard.response.status(), JSON.stringify(savedBoard.data)).toBe(200);
  expect(savedBoard.data.config.workflow_policy).toEqual({ workflow_id: defaultWorkflow.id, manual_label_id: manualLabel.id });
  const afterSaveInstances = await ownerApi.get(`/workflow-instances?task_id=${task.id}`);
  expect(afterSaveInstances.response.status(), JSON.stringify(afterSaveInstances.data)).toBe(200);
  expect(afterSaveInstances.data.items).toHaveLength(0);
  const savedPolicy = await ownerApi.get(`/tasks/${task.id}/flow?board_id=${setup.board.id}`);
  expect(savedPolicy.response.status(), JSON.stringify(savedPolicy.data)).toBe(200);
  expect(savedPolicy.data.board_workflow_policy).toMatchObject({
    state: 'available',
    board_id: setup.board.id,
    workflow_id: defaultWorkflow.id,
    definition_version: defaultWorkflow.definition_version,
  });

  const movedToReady = await ownerApi.post(`/tasks/${task.id}/move`, { status_id: ready.id, board_id: setup.board.id }, { version: task.version });
  expect(movedToReady.response.status(), JSON.stringify(movedToReady.data)).toBe(200);
  const afterReadyInstances = await ownerApi.get(`/workflow-instances?task_id=${task.id}`);
  expect(afterReadyInstances.response.status(), JSON.stringify(afterReadyInstances.data)).toBe(200);
  expect(afterReadyInstances.data.items).toHaveLength(0);
  expect((await qaMocks.t3Journal()).accepted_launches).toHaveLength(0);

  await ownerPage.goto(`/#/project/${setup.project.id}/board`);
  const { sheet, panel } = await openTaskOnBoard(ownerPage, taskTitle);
  const workflowSelect = panel.getByRole('combobox', { name: 'Workflow', exact: true });
  await expect(workflowSelect).toContainText(defaultWorkflow.name);
  const startButton = panel.getByRole('button', { name: 'Workflow starten', exact: true });
  await expect(startButton).toBeEnabled();
  const startResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(`/tasks/${task.id}/workflow-instances`));
  await startButton.click();
  const startResponse = await startResponsePromise;
  expect(startResponse.status()).toBe(202);
  const receipt = await startResponse.json();
  const instanceId = receipt.resource?.id ?? receipt.instance_id;
  expect(instanceId).toBeTruthy();
  const instance = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (item) => item.id === instanceId, 'Der ausdrückliche Klick muss genau eine Workflowinstanz anlegen.');
  expect(instance).toMatchObject({ workflow_id: defaultWorkflow.id, definition_version: defaultWorkflow.definition_version });
  await closeTaskSheet(sheet);

  const manualTaskTitle = `Manuelles Ticket mit Route ${setup.suffix}`;
  const manualTask = await ownerApi.createTask(setup.project.id, {
    title: manualTaskTitle,
    status_id: ready.id,
    label_ids: [manualLabel.id, workflowLabel.id],
  });
  await ownerPage.goto(`/#/project/${setup.project.id}/board`);
  const excluded = await ownerApi.get(`/tasks/${manualTask.id}/flow?board_id=${setup.board.id}`);
  expect(excluded.response.status(), JSON.stringify(excluded.data)).toBe(200);
  expect(excluded.data.board_workflow_policy).toMatchObject({
    state: 'excluded',
    board_id: setup.board.id,
    workflow_id: defaultWorkflow.id,
    definition_version: defaultWorkflow.definition_version,
  });
  expect(excluded.data.board_workflow_policy.reason).toContain(manualLabel.name);
  const blockedRouteStart = await startWorkflow(ownerApi, manualTask, routeWorkflow, setup.board.id);
  expect(blockedRouteStart.response.status(), JSON.stringify(blockedRouteStart.data)).toBe(409);
  expect(blockedRouteStart.data.code).toBe('board_workflow_excluded');
  const excludedInstances = await ownerApi.get(`/workflow-instances?task_id=${manualTask.id}`);
  expect(excludedInstances.response.status(), JSON.stringify(excludedInstances.data)).toBe(200);
  expect(excludedInstances.data.items).toHaveLength(0);

  const excludedSheet = await openTaskOnBoard(ownerPage, manualTaskTitle);
  await expect(excludedSheet.panel.getByText(new RegExp(manualLabel.name))).toBeVisible();
  await expect(excludedSheet.panel.getByRole('button', { name: 'Workflow starten', exact: true })).toBeDisabled();
  await closeTaskSheet(excludedSheet.sheet);

  const latestManualTask = await ownerApi.get(`/tasks/${manualTask.id}`);
  expect(latestManualTask.response.status(), JSON.stringify(latestManualTask.data)).toBe(200);
  const manualMove = await ownerApi.post(`/tasks/${manualTask.id}/move`, { status_id: active.id, board_id: setup.board.id }, { version: latestManualTask.data.version });
  expect(manualMove.response.status(), JSON.stringify(manualMove.data)).toBe(200);
  expect((await qaMocks.t3Journal()).accepted_launches).toHaveLength(1);

  recordEvidence(
    'Boardworkflows sind Voreinstellungen für einen ausdrücklichen Ticketstart.',
    `Eine Workflowphase ohne Rolle wurde vor Instanzanlage mit workflow_profile_required abgewiesen. Das Speichern des Standards und der Wechsel nach Bereit starteten keinen Lauf. Der Button startete Workflow ${defaultWorkflow.id} in Version ${defaultWorkflow.definition_version}. Ein Ticket mit dem manuellen Label und einer eingefrorenen Labelroute wurde in der UI gesperrt und beim direkten API-Aufruf mit board_workflow_excluded abgewiesen; die manuelle Boardbewegung blieb möglich.`,
    { t3: await qaMocks.t3Journal() },
  );
});

test('overlapping board policies require an explicit board context', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(300_000);
  test.info().annotations.push({ type: 'scenario', description: 'Mehrere passende Boardrichtlinien liefern ohne Kontext keine zufällige Vorauswahl; explizite Boardkontexte binden den Start an die jeweilige Workflowversion.' });
  const setup = await setupProject(ownerApi, ownerPage, baseURL, qaMocks, 'Mehrdeutige Boardworkflows');
  const profile = await createProfile(ownerApi, setup.project, setup.connection, `Rolle ${setup.suffix}`);
  const firstWorkflow = await createWorkflow(ownerApi, setup.project.id, profile, `Erster Standard ${setup.suffix}`);
  const secondWorkflow = await createWorkflow(ownerApi, setup.project.id, profile, `Zweiter Standard ${setup.suffix}`);
  const manualLabel = await ownerApi.createLabel(setup.project.id, {
    name: `Manuell ${setup.suffix}`,
    key: `manuell-${setup.suffix}`,
    color: '#B07B40',
  });
  const requiredLabel = await ownerApi.createLabel(setup.project.id, {
    name: `Nur Board B ${setup.suffix}`,
    key: `nur-board-b-${setup.suffix}`,
    color: '#2D7180',
  });
  const firstBoard = await updateBoardPolicy(ownerApi, setup.board, firstWorkflow.id, manualLabel.id);
  const secondBoardResponse = await ownerApi.post(`/projects/${setup.project.id}/boards`, {
    name: `Zweites Board ${setup.suffix}`,
    config: {
      ...firstBoard.config,
      filter: { ...firstBoard.config.filter, label_ids: [requiredLabel.id] },
      workflow_policy: { workflow_id: secondWorkflow.id, manual_label_id: manualLabel.id },
    },
    columns: firstBoard.columns.map((column) => ({
      name: column.name,
      status_ids: column.status_ids,
      default_drop_status_id: column.default_drop_status_id,
      wip_limit: column.wip_limit,
      wip_policy: column.wip_policy,
    })),
  });
  expect(secondBoardResponse.response.status(), JSON.stringify(secondBoardResponse.data)).toBe(201);
  const secondBoard = secondBoardResponse.data;
  const ready = setup.statuses.find((status) => status.category === 'ready');
  expect(ready).toBeTruthy();
  const firstTask = await ownerApi.createTask(setup.project.id, { title: `Board A ${setup.suffix}`, status_id: ready.id, label_ids: [requiredLabel.id] });
  const secondTask = await ownerApi.createTask(setup.project.id, { title: `Board B ${setup.suffix}`, status_id: ready.id, label_ids: [requiredLabel.id] });

  const ambiguous = await ownerApi.get(`/tasks/${firstTask.id}/flow`);
  expect(ambiguous.response.status(), JSON.stringify(ambiguous.data)).toBe(200);
  expect(ambiguous.data.board_workflow_policy).toMatchObject({ state: 'ambiguous', board_id: null, workflow_id: null });
  expect(ambiguous.data.board_workflow_policy.reason).toContain(firstBoard.name);
  expect(ambiguous.data.board_workflow_policy.reason).toContain(secondBoard.name);
  const contextlessStart = await startWorkflow(ownerApi, firstTask, firstWorkflow, undefined);
  expect(contextlessStart.response.status(), JSON.stringify(contextlessStart.data)).toBe(409);
  expect(contextlessStart.data.code).toBe('board_workflow_ambiguous');

  const firstPolicy = await ownerApi.get(`/tasks/${firstTask.id}/flow?board_id=${firstBoard.id}`);
  const secondPolicy = await ownerApi.get(`/tasks/${secondTask.id}/flow?board_id=${secondBoard.id}`);
  expect(firstPolicy.response.status(), JSON.stringify(firstPolicy.data)).toBe(200);
  expect(secondPolicy.response.status(), JSON.stringify(secondPolicy.data)).toBe(200);
  expect(firstPolicy.data.board_workflow_policy).toMatchObject({ state: 'available', board_id: firstBoard.id, workflow_id: firstWorkflow.id, definition_version: firstWorkflow.definition_version });
  expect(secondPolicy.data.board_workflow_policy).toMatchObject({ state: 'available', board_id: secondBoard.id, workflow_id: secondWorkflow.id, definition_version: secondWorkflow.definition_version });

  const firstStart = await startWorkflow(ownerApi, firstTask, firstWorkflow, firstBoard.id);
  expect(firstStart.response.status(), JSON.stringify(firstStart.data)).toBe(202);
  const firstInstanceId = firstStart.data.resource?.id ?? firstStart.data.instance_id;
  expect(firstInstanceId).toBeTruthy();
  const firstInstance = await readUntil(ownerApi, `/workflow-instances/${firstInstanceId}`, (item) => item.id === firstInstanceId, 'Der explizite erste Boardkontext muss gestartet werden.');
  expect(firstInstance).toMatchObject({ workflow_id: firstWorkflow.id, definition_version: firstWorkflow.definition_version });

  const secondStart = await startWorkflow(ownerApi, secondTask, secondWorkflow, secondBoard.id);
  expect(secondStart.response.status(), JSON.stringify(secondStart.data)).toBe(202);
  const secondInstanceId = secondStart.data.resource?.id ?? secondStart.data.instance_id;
  expect(secondInstanceId).toBeTruthy();
  const secondInstance = await readUntil(ownerApi, `/workflow-instances/${secondInstanceId}`, (item) => item.id === secondInstanceId, 'Der explizite zweite Boardkontext muss gestartet werden.');
  expect(secondInstance).toMatchObject({ workflow_id: secondWorkflow.id, definition_version: secondWorkflow.definition_version });

  const nonMemberTask = await ownerApi.createTask(setup.project.id, {
    title: `Nur Board A ${setup.suffix}`,
    status_id: ready.id,
    label_ids: [manualLabel.id],
  });
  const nonMemberFlow = await ownerApi.get(`/tasks/${nonMemberTask.id}/flow`);
  expect(nonMemberFlow.response.status(), JSON.stringify(nonMemberFlow.data)).toBe(200);
  expect(nonMemberFlow.data.board_workflow_policy).toMatchObject({
    state: 'excluded',
    board_id: firstBoard.id,
    workflow_id: firstWorkflow.id,
    definition_version: firstWorkflow.definition_version,
  });
  expect(nonMemberFlow.data.board_workflow_policy.reason).toContain(firstBoard.name);
  expect(nonMemberFlow.data.board_workflow_policy.reason).not.toContain(secondBoard.name);
  const boardAContext = await ownerApi.get(`/tasks/${nonMemberTask.id}/flow?board_id=${firstBoard.id}`);
  const boardBContext = await ownerApi.get(`/tasks/${nonMemberTask.id}/flow?board_id=${secondBoard.id}`);
  expect(boardAContext.data.board_workflow_policy.state).toBe('excluded');
  expect(boardBContext.data.board_workflow_policy).toMatchObject({ state: 'unavailable', board_id: secondBoard.id });
  const boardBView = await ownerApi.get(`/boards/${secondBoard.id}/view?limit_per_column=100`);
  expect(boardBView.response.status(), JSON.stringify(boardBView.data)).toBe(200);
  expect(boardBView.data.columns.flatMap((column) => column.items).some((item) => item.id === nonMemberTask.id)).toBe(false);
  const wrongBoardStart = await startWorkflow(ownerApi, nonMemberTask, secondWorkflow, secondBoard.id);
  expect(wrongBoardStart.response.status(), JSON.stringify(wrongBoardStart.data)).toBe(409);
  expect(wrongBoardStart.data.code).toBe('board_workflow_unavailable');

  recordEvidence(
    'Überlappende Boards lösen ihre Workflowstandards nur mit einem eindeutigen Boardkontext auf.',
    `Die kontextlose Projektion eines Tickets, das auf beiden Boards lag, nannte ${firstBoard.name} und ${secondBoard.name} und lieferte ambiguous; ein kontextloser Start wurde mit 409 abgewiesen. Mit board_id starteten die beiden Tickets jeweils exakt den Workflow des ausgewählten Boards. Ein Ticket mit manuellem Label, aber ohne das Pflichtlabel von ${secondBoard.name}, blieb ausschließlich Mitglied von ${firstBoard.name}: seine Projektion war excluded statt ambiguous, und der falsche Boardkontext wurde mit unavailable abgewiesen.`,
    { t3: await qaMocks.t3Journal() },
  );
});
