import { randomUUID } from 'node:crypto';
import { authorizeT3InBrowser, expect, recordEvidence, test } from '../support/fixtures.mjs';

async function readUntil(ownerApi, route, matches, description) {
  let current;
  await expect.poll(async () => {
    const result = await ownerApi.get(route);
    if (result.response.status() !== 200) return false;
    current = result.data;
    return matches(current);
  }, { timeout: 45_000, message: description }).toBe(true);
  return current;
}

async function configureBoundT3Project(ownerApi, ownerPage, baseURL, qaMocks, { name, scenario = 'default' }) {
  const uniqueName = `${name} ${randomUUID().slice(0, 6)}`;
  const project = await ownerApi.createProject({ name: `${uniqueName} Projekt` });
  const created = await ownerApi.post('/connections', {
    name: uniqueName,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);

  await ownerPage.goto('/#/agents');
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
  await ownerPage.locator('main').getByRole('button', { name: new RegExp(uniqueName) }).click();
  await authorizeT3InBrowser(ownerPage, baseURL, qaMocks.t3URL);
  await readUntil(ownerApi, `/connections/${created.data.id}`, (item) => item.auth_status === 'valid', 'Die T3-Verbindung muss autorisiert sein.');

  if (scenario !== 'default') await qaMocks.setT3Scenario(scenario);
  await ownerPage.locator('main').getByRole('button', { name: new RegExp(uniqueName) }).click();
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect.poll(async () => {
    const check = await ownerApi.get(`/connections/${created.data.id}/check`);
    return check.response.status() === 200
      ? [check.data.network, check.data.authentication, check.data.mcp_handshake, check.data.capabilities].join(':')
      : null;
  }, { timeout: 45_000, message: 'T3-Verbindung und MCP-Fähigkeiten müssen erreichbar sein.' }).toBe('ok:ok:ok:ok');
  const connection = await readUntil(ownerApi, `/connections/${created.data.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Die T3-Verbindung muss bereit sein.');

  await ownerPage.getByRole('button', { name: 'Projekte laden' }).click();
  await expect(ownerPage.getByText('QA T3 Project', { exact: true })).toBeVisible();
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: project.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
  return { project, connection };
}

async function openRoles(ownerPage) {
  await ownerPage.getByRole('button', { name: 'Agentrollen', exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Agentrollen' })).toBeVisible();
}

async function selectRoleConnectionAndProject(ownerPage, connectionName, projectName) {
  const connectionSelect = ownerPage.getByLabel('T3-Verbindung');
  await connectionSelect.click();
  await ownerPage.getByRole('option', { name: new RegExp(connectionName) }).click();
  await ownerPage.getByLabel(projectName, { exact: true }).check();
}

async function createRoleFromForm(ownerPage, name) {
  await ownerPage.getByLabel('Name').fill(name);
  await ownerPage.getByRole('button', { name: 'Rolle anlegen', exact: true }).click();
  await expect(ownerPage.getByText('Rolle angelegt', { exact: true })).toBeVisible();
}

async function roleByName(ownerApi, name) {
  const result = await ownerApi.get('/agent-profiles?limit=100');
  expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
  return result.data.items.find((profile) => profile.name === name);
}

test('Agentrolle kann einen echten Referenzthread aus dem gebundenen T3-Projekt wählen', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureBoundT3Project(ownerApi, ownerPage, baseURL, qaMocks, { name: 'Threadpicker' });
  const threadTitle = 'Morgenwacht: Leitartikel besprechen';
  const thread = await qaMocks.createExternalT3Activity({
    threadId: 'qa-morgenwacht-reference-thread',
    runId: 'qa-morgenwacht-reference-run',
    externalProjectId: 'qa-t3-project-1',
    title: threadTitle,
  });
  const foreignTitle = 'Fremdprojekt: interne Planung';
  const foreign = await qaMocks.createExternalT3Activity({
    threadId: 'qa-foreign-project-reference-thread',
    runId: 'qa-foreign-project-reference-run',
    externalProjectId: 'qa-t3-project-foreign',
    title: foreignTitle,
  });
  await qaMocks.setT3Scenario('foreign_thread_list');

  await openRoles(ownerPage);
  await selectRoleConnectionAndProject(ownerPage, connection.name, project.name);
  await ownerPage.getByLabel('Ausführungsziel in T3').click();
  await ownerPage.getByRole('option', { name: 'Vorhandener Referenzthread', exact: true }).click();

  const threadSelect = ownerPage.getByLabel('Referenzthread aus T3');
  await expect(threadSelect).toBeVisible();
  await expect(ownerPage.getByText('Projekt für die Threadliste')).toHaveCount(0);
  await threadSelect.click();
  const chosenThread = ownerPage.getByRole('option', { name: `${threadTitle} · ${thread.thread_id}`, exact: true });
  await expect(chosenThread).toBeVisible();
  await expect(ownerPage.getByRole('option', { name: new RegExp(foreignTitle) })).toHaveCount(0);
  await chosenThread.click();
  await expect(threadSelect).toContainText(thread.thread_id);
  await expect(ownerPage.getByLabel('T3-Referenzthread-ID')).toHaveCount(0);
  await expect(ownerPage.getByLabel('Provider')).toHaveCount(0);

  const roleName = 'Morgenwacht Redaktionsrolle';
  await createRoleFromForm(ownerPage, roleName);
  const profile = await roleByName(ownerApi, roleName);
  expect(profile).toBeTruthy();
  expect(profile.execution_target).toEqual({ mode: 't3_reference_thread', reference_thread_id: thread.thread_id });
  await expect(ownerPage.getByRole('article').filter({ hasText: roleName })).toContainText(`Referenzthread ${thread.thread_id}`);

  const t3 = await qaMocks.t3Journal();
  const threadListCall = t3.journal.find((entry) => entry.tool === 't3_thread_list' && entry.outcome === 'success');
  expect(threadListCall).toMatchObject({
    thread_list_project_id: 'qa-t3-project-1',
    thread_list_cursor: null,
    thread_list_limit: 50,
  });
  expect(threadListCall.thread_list_result_threads).toContainEqual({ threadId: thread.thread_id, projectId: 'qa-t3-project-1' });
  expect(threadListCall.thread_list_result_threads).toContainEqual({ threadId: foreign.thread_id, projectId: foreign.external_project_id });
  expect(t3.unexpected).toEqual([]);
  recordEvidence(
    'Eine Agentrolle kann ohne manuelle Thread-ID und ohne Providerwahl einen aktiven Referenzthread aus ihrem gebundenen T3-Projekt auswählen; fremde Projektthreads erscheinen nicht.',
    `Der Browser zeigte „${threadTitle}“ mit ID ${thread.thread_id} zur Auswahl und speicherte diese ID als Ausführungsziel. Der T3-Mock lieferte zusätzlich den Fremdthread aus ${foreign.external_project_id}; er blieb in der Falkenwarte-Auswahl verborgen. Die Threadliste wurde für das gebundene externe Projekt qa-t3-project-1 angefragt.`,
    { t3 },
  );
});

test('ältere T3-Server behalten Projektstandard und bekannte manuelle Referenz-ID', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureBoundT3Project(ownerApi, ownerPage, baseURL, qaMocks, {
    name: 'Legacy-Threadpicker',
    scenario: 'without_thread_list',
  });
  const knownThreadId = 'qa-known-legacy-reference-thread';
  await qaMocks.createExternalT3Activity({
    threadId: knownThreadId,
    runId: 'qa-known-legacy-reference-run',
    externalProjectId: 'qa-t3-project-1',
    title: 'Bekannter älterer T3-Thread',
  });

  await openRoles(ownerPage);
  await selectRoleConnectionAndProject(ownerPage, connection.name, project.name);
  const defaultRoleName = 'Legacy T3 Projektstandard';
  await createRoleFromForm(ownerPage, defaultRoleName);
  const defaultProfile = await roleByName(ownerApi, defaultRoleName);
  expect(defaultProfile.execution_target).toEqual({ mode: 't3_project_default' });

  await ownerPage.getByLabel(project.name, { exact: true }).check();
  await ownerPage.getByLabel('Ausführungsziel in T3').click();
  await ownerPage.getByRole('option', { name: 'Vorhandener Referenzthread', exact: true }).click();
  await expect(ownerPage.getByRole('alert')).toContainText('Diese T3-Version stellt keine Threadliste bereit. Wähle den T3-Projektstandard oder gib eine bekannte Referenzthread-ID ein.');
  await ownerPage.getByRole('button', { name: 'ID manuell eingeben', exact: true }).click();
  const manualReference = ownerPage.getByLabel('T3-Referenzthread-ID');
  await expect(manualReference).toBeVisible();
  await manualReference.fill(knownThreadId);
  const manualRoleName = 'Legacy T3 manuelle Referenz';
  await createRoleFromForm(ownerPage, manualRoleName);
  const manualProfile = await roleByName(ownerApi, manualRoleName);
  expect(manualProfile.execution_target).toEqual({ mode: 't3_reference_thread', reference_thread_id: knownThreadId });

  const t3 = await qaMocks.t3Journal();
  const legacyRequests = t3.journal.filter((entry) => entry.scenario === 'without_thread_list');
  const advertisedTools = legacyRequests.find((entry) => entry.method === 'tools/list' && entry.tool_names);
  expect(advertisedTools, 'Der Mock muss die tatsächlich angefragte Legacy-Werkzeugliste belegen.').toBeTruthy();
  expect(advertisedTools.tool_names).not.toContain('t3_thread_list');
  expect(legacyRequests.some((entry) => entry.tool === 't3_thread_list')).toBe(false);
  expect(t3.unexpected).toEqual([]);
  recordEvidence(
    'Bei älteren T3-Servern bleibt der Projektstandard ohne Threadlistenaufruf verfügbar; eine bekannte Referenzthread-ID lässt sich weiterhin manuell hinterlegen.',
    `Der Server bewarb t3_thread_list nicht. Die Projektstandard-Rolle wurde gespeichert, und die bekannte ID ${knownThreadId} wurde als Referenzziel gespeichert, nachdem die Oberfläche den manuellen Fallback angezeigt hatte.`,
    { t3 },
  );
});
