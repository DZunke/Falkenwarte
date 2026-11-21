import { randomUUID } from 'node:crypto';
import { authorizeT3InBrowser, expect, recordEvidence, test } from '../support/fixtures.mjs';

const completionPolicy = {
  require_external_settled: true,
  required_evidence_kinds: [],
  required_criterion_ids: [],
  require_human_phase_decision: false,
  require_human_confirmed_evidence: false,
};

async function createConnection(ownerApi) {
  const created = await ownerApi.post('/connections', {
    name: `Scope QA ${randomUUID().slice(0, 8)}`,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: 'https://127.0.0.1:1',
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);

  return created.data;
}

async function createReadyBoundConnection(ownerApi, ownerPage, baseURL, qaMocks, project, name) {
  await qaMocks.setT3Scenario('default');
  const created = await ownerApi.post('/connections', {
    name,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status()).toBe(201);

  await ownerPage.goto('/#/agents');
  const connectionCard = ownerPage.getByRole('button', { name: new RegExp(name) });
  await expect(connectionCard).toBeVisible();
  await connectionCard.click();
  await authorizeT3InBrowser(ownerPage, baseURL, qaMocks.t3URL);
  await expect.poll(async () => (await ownerApi.get(`/connections/${created.data.id}`)).data.auth_status).toBe('valid');

  const checkResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${ownerApi.apiPrefix}/connections/${created.data.id}/check`);
  await ownerPage.getByRole('button', { name: 'Verbindung testen', exact: true }).click();
  const checkResponse = await checkResponsePromise;
  expect(checkResponse.status()).toBe(202);
  const check = await checkResponse.json();
  await ownerApi.waitForSucceededAction(check.action_id, 'Die QA-T3-Verbindung muss bereit sein.');

  const connection = await ownerApi.get(`/connections/${created.data.id}`);
  expect(connection.response.status()).toBe(200);
  expect(connection.data).toMatchObject({ auth_status: 'valid', health: 'ready' });
  const currentProject = await ownerApi.get(`/projects/${project.id}`);
  expect(currentProject.response.status()).toBe(200);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.data.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: currentProject.data.version });
  expect(binding.response.status()).toBe(200);

  return connection.data;
}

async function createProfile(ownerApi, { connection, name, projectIds, allProjects = false, executionTarget = { mode: 't3_project_default' } }) {
  const created = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role: 'Implementierung',
    connection_id: connection.id,
    allowed_project_ids: projectIds,
    all_projects: allProjects,
    max_parallel_runs: 1,
    prompt_template: 'Prüfe die projektspezifische Freigabe.',
    enabled: true,
    default_run_completion_policy: completionPolicy,
    execution_target: executionTarget,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);

  return created.data;
}

async function assignProfile(ownerApi, projectId, profileId, title) {
  const task = await ownerApi.createTask(projectId, { title });
  const current = await ownerApi.get(`/tasks/${task.id}`);
  expect(current.response.status(), JSON.stringify(current.data)).toBe(200);
  const assigned = await ownerApi.post(`/tasks/${task.id}/assignment`, {
    agent_profile_id: profileId,
    requested_role: null,
  }, { version: current.data.version });

  return { task, assigned };
}

test('Agentrollen können alle aktuellen und künftigen Projekte oder eine konkrete Projektauswahl erhalten', async ({ ownerApi, ownerPage }) => {
  const suffix = randomUUID().slice(0, 6);
  const connection = await createConnection(ownerApi);
  const projectA = await ownerApi.createProject({ name: `Freigabe Projekt A ${suffix}` });
  const projectB = await ownerApi.createProject({ name: `Freigabe Projekt B ${suffix}` });

  await ownerPage.goto('/#/roles');
  await expect(ownerPage.getByRole('heading', { name: 'Agentrollen' })).toBeVisible();
  const globalRoleName = `Globale Browserrolle ${suffix}`;
  await ownerPage.getByLabel('Name').fill(globalRoleName);
  await ownerPage.getByLabel('T3-Verbindung').click();
  await ownerPage.getByRole('option', { name: new RegExp(connection.name) }).click();
  await ownerPage.getByTestId('all-projects-checkbox').check();
  await expect(ownerPage.getByText(`Gilt für alle aktuellen und künftigen Falkenwarte-Projekte. Ein Auftrag startet nur, wenn das jeweilige Projekt aktiv mit der T3-Verbindung „${connection.name}“ verbunden ist.`, { exact: true })).toBeVisible();
  const createButton = ownerPage.getByRole('button', { name: 'Rolle anlegen', exact: true });
  await expect(createButton).toBeEnabled();
  const createResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${ownerApi.apiPrefix}/agent-profiles`);
  await createButton.click();
  const createdRoleResponse = await createResponse;
  expect(createdRoleResponse.status()).toBe(201);
  const globalRole = await createdRoleResponse.json();
  await expect(ownerPage.getByText('Rolle angelegt', { exact: true })).toBeVisible();
  expect(globalRole).toMatchObject({ name: globalRoleName, all_projects: true, allowed_project_ids: [] });

  const initialAssignment = await assignProfile(ownerApi, projectA.id, globalRole.id, 'Globale Rolle in bestehendem Projekt');
  expect(initialAssignment.assigned.response.status(), JSON.stringify(initialAssignment.assigned.data)).toBe(200);
  const futureProject = await ownerApi.createProject({ name: `Später angelegtes Projekt ${suffix}` });
  const futureAssignment = await assignProfile(ownerApi, futureProject.id, globalRole.id, 'Globale Rolle in späterem Projekt');
  expect(futureAssignment.assigned.response.status(), JSON.stringify(futureAssignment.assigned.data)).toBe(200);

  const target = { mode: 't3_provider_instance', provider_instance_id: 'codex_review', model: 'qa-review-model' };
  let scopedRole = await createProfile(ownerApi, {
    connection,
    name: `Umschaltbare Projektrolle ${suffix}`,
    projectIds: [projectA.id],
    executionTarget: target,
  });
  expect(scopedRole).toMatchObject({ all_projects: false, allowed_project_ids: [projectA.id], execution_target: target });
  const explicitAllowed = await assignProfile(ownerApi, projectA.id, scopedRole.id, 'Explizit freigegebene Aufgabe');
  expect(explicitAllowed.assigned.response.status(), JSON.stringify(explicitAllowed.assigned.data)).toBe(200);
  const explicitDenied = await assignProfile(ownerApi, projectB.id, scopedRole.id, 'Nicht freigegebene Aufgabe');
  expect(explicitDenied.assigned.response.status(), JSON.stringify(explicitDenied.assigned.data)).toBe(409);

  await ownerPage.reload();
  const roleArticle = ownerPage.getByRole('article').filter({ hasText: scopedRole.name });
  await expect(roleArticle).toBeVisible();
  await expect(roleArticle).toContainText('Providerinstanz codex_review · Modell qa-review-model');
  await roleArticle.getByRole('button', { name: 'Projektfreigaben ändern', exact: true }).click();
  const editor = ownerPage.getByTestId(`profile-project-access-editor-${scopedRole.id}`);
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('all-projects-checkbox')).not.toBeChecked();
  await expect(editor.getByLabel(projectA.name, { exact: true })).toBeChecked();
  await editor.getByTestId('all-projects-checkbox').check();
  await expect(editor.getByText(`Gilt für alle aktuellen und künftigen Falkenwarte-Projekte. Ein Auftrag startet nur, wenn das jeweilige Projekt aktiv mit der T3-Verbindung „${connection.name}“ verbunden ist.`, { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Projektfreigaben speichern', exact: true }).click();
  await expect(ownerPage.getByText('Projektfreigaben aktualisiert', { exact: true })).toBeVisible();

  let refreshed = await ownerApi.get(`/agent-profiles/${scopedRole.id}`);
  expect(refreshed.response.status(), JSON.stringify(refreshed.data)).toBe(200);
  scopedRole = refreshed.data;
  expect(scopedRole).toMatchObject({ all_projects: true, allowed_project_ids: [], execution_target: target });
  const anotherFutureProject = await ownerApi.createProject({ name: `Nach globaler Änderung angelegtes Projekt ${suffix}` });
  const globallyAssigned = await assignProfile(ownerApi, anotherFutureProject.id, scopedRole.id, 'Neue globale Projektfreigabe');
  expect(globallyAssigned.assigned.response.status(), JSON.stringify(globallyAssigned.assigned.data)).toBe(200);

  await roleArticle.getByRole('button', { name: 'Projektfreigaben ändern', exact: true }).click();
  const secondEditor = ownerPage.getByTestId(`profile-project-access-editor-${scopedRole.id}`);
  await expect(secondEditor).toBeVisible();
  await expect(secondEditor.getByTestId('all-projects-checkbox')).toBeChecked();
  await secondEditor.getByTestId('all-projects-checkbox').uncheck();
  await secondEditor.getByLabel(projectB.name, { exact: true }).check();
  const saveProjectAccessResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `${ownerApi.apiPrefix}/agent-profiles/${scopedRole.id}`);
  await secondEditor.getByRole('button', { name: 'Projektfreigaben speichern', exact: true }).click();
  const saveProjectAccessResponse = await saveProjectAccessResponsePromise;
  expect(saveProjectAccessResponse.status()).toBe(200);
  const savedRole = await saveProjectAccessResponse.json();
  expect(savedRole.version).toBeGreaterThan(scopedRole.version);

  refreshed = await ownerApi.get(`/agent-profiles/${scopedRole.id}`);
  expect(refreshed.response.status(), JSON.stringify(refreshed.data)).toBe(200);
  scopedRole = refreshed.data;
  expect(scopedRole).toMatchObject({ all_projects: false, allowed_project_ids: [projectB.id], execution_target: target });
  const switchedAllowed = await assignProfile(ownerApi, projectB.id, scopedRole.id, 'Neu ausgewähltes Projekt');
  expect(switchedAllowed.assigned.response.status(), JSON.stringify(switchedAllowed.assigned.data)).toBe(200);
  const switchedDenied = await assignProfile(ownerApi, projectA.id, scopedRole.id, 'Nicht mehr freigegebenes Projekt');
  expect(switchedDenied.assigned.response.status(), JSON.stringify(switchedDenied.assigned.data)).toBe(409);
  const futureDenied = await assignProfile(ownerApi, anotherFutureProject.id, scopedRole.id, 'Globale Freigabe zurückgenommen');
  expect(futureDenied.assigned.response.status(), JSON.stringify(futureDenied.assigned.data)).toBe(409);

  recordEvidence(
    'Rollen können alle aktuellen und später angelegten Projekte freigeben; eine explizite Auswahl bleibt auf ihre Projekt-IDs begrenzt und lässt sich bei bestehenden Rollen ändern.',
    `Der Browser erstellte eine globale Rolle mit all_projects=true und leerer Projekt-ID-Liste. Aufgaben aus dem bestehenden Projekt ${projectA.id} und dem erst danach angelegten Projekt ${futureProject.id} ließen sich ihr zuweisen. Die bestehende Rolle ${scopedRole.id} wechselte im Browser von Projekt A zu allen Projekten und anschließend zu Projekt B; ihre konkreten Zuweisungen wurden jeweils mit HTTP 200 bzw. 409 geprüft. Ihr Ausführungsziel blieb ${target.provider_instance_id}/${target.model}.`,
  );
});

test('Eine globale Agentrolle erscheint nur bei passender aktiver T3-Projektbindung', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 6);
  const project = await ownerApi.createProject({ name: `Globale Rollenauswahl ${suffix}` });
  const board = await ownerApi.ensureDefaultBoard(project.id);
  const statusPage = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statusPage.response.status()).toBe(200);
  const backlog = statusPage.data.items.find((status) => status.category === 'backlog');
  expect(backlog).toBeTruthy();
  await ownerApi.createTask(project.id, { title: `Globale Rollenwahl ${suffix}`, status_id: backlog.id });

  const matchingConnection = await createReadyBoundConnection(ownerApi, ownerPage, baseURL, qaMocks, project, `QA passende Verbindung ${suffix}`);
  const otherConnection = await createConnection(ownerApi);
  const globalRole = await createProfile(ownerApi, {
    connection: matchingConnection,
    name: `Globale passende Rolle ${suffix}`,
    projectIds: [],
    allProjects: true,
  });
  const otherConnectionRole = await createProfile(ownerApi, {
    connection: otherConnection,
    name: `Globale fremde Verbindung ${suffix}`,
    projectIds: [],
    allProjects: true,
  });
  expect(globalRole).toMatchObject({ all_projects: true, allowed_project_ids: [], connection_id: matchingConnection.id });
  expect(otherConnectionRole).toMatchObject({ all_projects: true, allowed_project_ids: [], connection_id: otherConnection.id });

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByRole('button', { name: board.name, exact: true }).click();
  await ownerPage.getByText(`Globale Rollenwahl ${suffix}`, { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: `Globale Rollenwahl ${suffix}` })).toBeVisible();
  await ownerPage.getByRole('tab', { name: 'Ausführung' }).click();
  const executionPanel = ownerPage.getByRole('tabpanel', { name: 'Ausführung' });
  const rolePicker = executionPanel.getByRole('combobox', { name: 'Rollenprofil' });
  await expect(rolePicker).toBeVisible();
  await rolePicker.click();
  const roleOptions = ownerPage.getByRole('option');
  await expect(roleOptions).toHaveText([`${globalRole.name} · Startbereit`]);
  await expect(ownerPage.getByRole('option', { name: new RegExp(otherConnectionRole.name) })).toHaveCount(0);
  await ownerPage.keyboard.press('Escape');

  await ownerPage.goto('/#/workflows');
  await expect(ownerPage.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  const workflowForm = ownerPage.getByTestId('workflow-editor-create');
  await workflowForm.getByRole('button', { name: 'Zwei-Phasen-Vorlage verwenden', exact: true }).click();
  const workflowProjectPicker = workflowForm.getByLabel('Projekt');
  await workflowProjectPicker.click();
  await ownerPage.getByRole('option', { name: project.name, exact: true }).click();
  await expect(workflowProjectPicker).toContainText(project.name);
  const graph = workflowForm.getByTestId('workflow-editor-graph');
  await graph.getByTestId('workflow-graph-stage-work').click();
  const stageInspector = workflowForm.getByTestId('workflow-stage-inspector');
  const workflowRolePicker = stageInspector.getByTestId('workflow-create-stage-agent-role-work');
  await workflowRolePicker.click();
  const workflowRoleOptions = ownerPage.getByRole('option');
  await expect(workflowRoleOptions).toHaveText([
    'Keine Agentrolle',
    `${globalRole.name} · Implementierung`,
  ]);
  await expect(ownerPage.getByRole('option', { name: new RegExp(otherConnectionRole.name) })).toHaveCount(0);
  await ownerPage.keyboard.press('Escape');
  await graph.getByTestId('workflow-graph-stage-review').click();
  const reviewInspector = workflowForm.getByTestId('workflow-stage-inspector');
  const reviewRolePicker = reviewInspector.getByTestId('workflow-create-stage-agent-role-review');
  await reviewRolePicker.click();
  await expect(ownerPage.getByRole('option')).toHaveText([
    'Keine Agentrolle',
    globalRole.name + ' · Implementierung',
  ]);
  await expect(ownerPage.getByRole('option', { name: new RegExp(otherConnectionRole.name) })).toHaveCount(0);
  await ownerPage.keyboard.press('Escape');

  recordEvidence(
    'Eine globale Rolle wird für alle Projekte berücksichtigt, aber im Startselector nur angeboten, wenn das Projekt eine aktive Bindung an genau ihre T3-Verbindung hat.',
    `Das gebundene Projekt ${project.id} bot die globale Rolle ${globalRole.id} mit Verbindung ${matchingConnection.id} als startbereit an. Beide Workflow-Phasenselektoren enthielten nur die globale Rolle dieser Verbindung; die ebenfalls globale Rolle mit anderer Verbindung ${otherConnection.id} fehlte in beiden Selektoren. Es wurde kein Auftrag gestartet.`,
  );
});
