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
  const threadPage = await ownerApi.get(`/projects/${project.id}/t3-threads?limit=50`);
  expect(threadPage.response.status(), JSON.stringify(threadPage.data)).toBe(200);
  const listedThread = threadPage.data.items.find((item) => item.id === thread.thread_id);
  expect(listedThread).toMatchObject({
    provider_instance_id: 'codex_general',
    model: 'qa-general-model',
  });
  await threadSelect.click();
  const chosenThread = ownerPage.getByRole('option', { name: `${threadTitle} · Providerinstanz codex_general · Modell qa-general-model · Thread-ID ${thread.thread_id}`, exact: true });
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
    `Der Browser zeigte „${threadTitle}“ mit Providerinstanz codex_general, Modell qa-general-model und ID ${thread.thread_id} zur Auswahl. Der echte Falkenwarte-API-Aufruf an /projects/${project.id}/t3-threads lieferte dieselben Routingwerte; gespeichert wurde weiterhin nur die Referenzthread-ID. Der T3-Mock lieferte zusätzlich den Fremdthread aus ${foreign.external_project_id}; er blieb in der Falkenwarte-Auswahl verborgen.`,
    { t3 },
  );
});

test('Agentrollen können zwei Providerinstanzen desselben T3-Treibers samt Modell unterscheiden und speichern', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureBoundT3Project(ownerApi, ownerPage, baseURL, qaMocks, { name: 'Providerziel' });
  const inventory = await ownerApi.get(`/connections/${connection.id}/providers`);
  expect(inventory.response.status(), JSON.stringify(inventory.data)).toBe(200);
  expect(inventory.data.providers).toContainEqual(expect.objectContaining({
    provider_instance_id: 'codex_general',
    display_name: 'Codex Allgemein',
    available: true,
    models: [expect.objectContaining({ id: 'qa-general-model' })],
  }));
  expect(inventory.data.providers).toContainEqual(expect.objectContaining({
    provider_instance_id: 'codex_review',
    display_name: 'Codex Review',
    available: true,
    models: [expect.objectContaining({ id: 'qa-review-model' })],
  }));

  await openRoles(ownerPage);
  await selectRoleConnectionAndProject(ownerPage, connection.name, project.name);
  await ownerPage.getByLabel('Ausführungsziel in T3').click();
  await ownerPage.getByRole('option', { name: 'T3-Providerinstanz', exact: true }).click();

  const targets = [
    { label: 'Codex Allgemein · codex_general', providerInstanceId: 'codex_general', model: 'qa-general-model', roleName: 'Codex Allgemein Rolle' },
    { label: 'Codex Review · codex_review', providerInstanceId: 'codex_review', model: 'qa-review-model', roleName: 'Codex Review Rolle' },
  ];

  for (const target of targets) {
    const providerPicker = ownerPage.getByLabel('Providerinstanz aus T3');
    await expect(providerPicker).toBeVisible();
    await providerPicker.click();
    const providerOption = ownerPage.getByRole('option', { name: target.label, exact: true });
    await expect(providerOption).toBeVisible();
    await providerOption.click();
    const modelPicker = ownerPage.getByLabel('Modell aus T3');
    await expect(modelPicker).toBeVisible();
    await expect(modelPicker).toContainText(target.model);

    await ownerPage.getByLabel(project.name, { exact: true }).check();
    await createRoleFromForm(ownerPage, target.roleName);
    const profile = await roleByName(ownerApi, target.roleName);
    expect(profile).toBeTruthy();
    expect(profile.execution_target).toEqual({
      mode: 't3_provider_instance',
      provider_instance_id: target.providerInstanceId,
      model: target.model,
    });
    await expect(ownerPage.getByRole('article').filter({ hasText: target.roleName })).toContainText(`${target.providerInstanceId} · ${target.model}`);
  }

  const capabilityCalls = (await qaMocks.t3Journal()).journal.filter((entry) => entry.tool === 'orchestrator_capabilities' && entry.outcome === 'success');
  expect(capabilityCalls.some((entry) => entry.provider_inventory?.some((provider) => provider.providerInstanceId === 'codex_general' && provider.driverKind === 'codex')
    && entry.provider_inventory?.some((provider) => provider.providerInstanceId === 'codex_review' && provider.driverKind === 'codex'))).toBe(true);

  const generalProfile = await roleByName(ownerApi, targets[0].roleName);
  expect(generalProfile).toBeTruthy();
  const preservedFields = ['id', 'name', 'icon_key', 'role', 'connection_id', 'allowed_project_ids', 'max_parallel_runs', 'prompt_template', 'enabled', 'default_run_completion_policy'];
  const originalValues = Object.fromEntries(preservedFields.map((field) => [field, generalProfile[field]]));
  const generalArticle = ownerPage.getByRole('article').filter({ hasText: targets[0].roleName });
  await generalArticle.getByRole('button', { name: 'Ausführungsziel ändern', exact: true }).click();
  const editor = ownerPage.getByTestId(`profile-target-editor-${generalProfile.id}`);
  await expect(editor).toBeVisible();
  await editor.getByLabel('Ausführungsziel in T3').click();
  await ownerPage.getByRole('option', { name: 'T3-Providerinstanz', exact: true }).click();
  const providerPicker = editor.getByLabel('Providerinstanz aus T3');
  await providerPicker.click();
  await ownerPage.getByRole('option', { name: targets[1].label, exact: true }).click();
  await expect(editor.getByLabel('Modell aus T3')).toContainText(targets[1].model);
  await editor.getByRole('button', { name: 'Ausführungsziel speichern', exact: true }).click();
  await expect.poll(async () => (await roleByName(ownerApi, targets[0].roleName))?.execution_target, {
    timeout: 45_000,
    message: 'Die vorhandene Rolle muss auf die zweite T3-Providerinstanz umgestellt werden.',
  }).toEqual({ mode: 't3_provider_instance', provider_instance_id: targets[1].providerInstanceId, model: targets[1].model });
  const changedProfile = await roleByName(ownerApi, targets[0].roleName);
  for (const field of preservedFields) expect(changedProfile[field]).toEqual(originalValues[field]);
  expect(changedProfile.version).toBe(generalProfile.version + 1);

  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  recordEvidence(
    'Agentrollen können zwei Providerinstanzen desselben T3-Treibers anhand ihrer Verbindungs-ID unterscheiden und die jeweilige Modell-ID speichern.',
    'Die Live-Provider-API lieferte codex_general mit qa-general-model und codex_review mit qa-review-model; der T3-Capability-Mock weist beide als codex-Treiberinstanzen aus. Die Browserauswahl zeigte beide Instanzen eindeutig und die Agentrollen-API speicherte für beide den passenden provider_instance_id- und model-Wert. Eine vorhandene Rolle wurde anschließend auf codex_review umgestellt; ID, Name, Rolle, Verbindung, Projektfreigaben und übrige Profilfelder blieben erhalten.',
    { t3 },
  );
});

test('gekürzte T3-Modelllisten lassen sich gezielt durchsuchen, bevor eine Rolle gespeichert wird', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureBoundT3Project(ownerApi, ownerPage, baseURL, qaMocks, {
    name: 'Modellsuche',
    scenario: 'models_omitted',
  });
  const shortInventory = await ownerApi.get(`/connections/${connection.id}/providers`);
  expect(shortInventory.response.status(), JSON.stringify(shortInventory.data)).toBe(200);
  expect(shortInventory.data.providers).toContainEqual(expect.objectContaining({
    provider_instance_id: 'codex_review',
    models: [expect.objectContaining({ id: 'qa-review-featured' })],
    omitted_models: 1,
  }));

  await openRoles(ownerPage);
  await selectRoleConnectionAndProject(ownerPage, connection.name, project.name);
  await ownerPage.getByLabel('Ausführungsziel in T3').click();
  await ownerPage.getByRole('option', { name: 'T3-Providerinstanz', exact: true }).click();
  const providerPicker = ownerPage.getByLabel('Providerinstanz aus T3');
  await providerPicker.click();
  await ownerPage.getByRole('option', { name: 'Codex Review · codex_review', exact: true }).click();

  const modelPicker = ownerPage.getByLabel('Modell aus T3');
  await expect(modelPicker).toBeVisible();
  await expect(modelPicker).toContainText('Modell wählen');
  await expect(ownerPage.getByRole('status').filter({ hasText: 'nur einen Teil der Modelle' })).toBeVisible();
  await ownerPage.getByLabel(project.name, { exact: true }).check();
  const createButton = ownerPage.getByRole('button', { name: 'Rolle anlegen', exact: true });
  await expect(createButton).toBeDisabled();

  const search = ownerPage.getByLabel('Modellsuche in T3');
  await search.fill('qa-review-model');
  await ownerPage.getByRole('button', { name: 'Modelle suchen', exact: true }).click();
  await expect(modelPicker).toContainText('qa-review-model');
  await expect(createButton).toBeEnabled();
  const roleName = 'Gezielte Modellrolle';
  await createRoleFromForm(ownerPage, roleName);
  const profile = await roleByName(ownerApi, roleName);
  expect(profile.execution_target).toEqual({ mode: 't3_provider_instance', provider_instance_id: 'codex_review', model: 'qa-review-model' });

  const t3 = await qaMocks.t3Journal();
  const searchCall = t3.journal.find((entry) => entry.tool === 'orchestrator_capabilities'
    && entry.outcome === 'success'
    && entry.capability_search === 'qa-review-model');
  expect(searchCall?.provider_inventory).toContainEqual(expect.objectContaining({
    providerInstanceId: 'codex_review',
    omittedModels: 0,
    models: [expect.objectContaining({ id: 'qa-review-model' })],
  }));
  expect(t3.unexpected).toEqual([]);
  recordEvidence(
    'Bei einem gekürzten T3-Modellkatalog wählt Falkenwarte kein möglicherweise falsches Modell automatisch aus; eine gezielte Suche kann die gewünschte Modell-ID laden.',
    'Die Browseransicht zeigte qa-review-featured zunächst als gekürzte Modellliste mit ausgelassenen Treffern, ließ das Speichern ohne Auswahl gesperrt und lud nach Suche nach qa-review-model den gezielten Treffer. Die Agentrollen-API speicherte codex_review und qa-review-model; der T3-Mock protokollierte den weitergereichten Suchbegriff und den Treffer.',
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
