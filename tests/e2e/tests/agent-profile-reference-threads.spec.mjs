import { randomUUID } from 'node:crypto';
import { authorizeT3InBrowser, expect, recordEvidence, test } from '../support/fixtures.mjs';

const activeProviderIds = ['codex', 'codex_general', 'codex_review'];
const activeProviderLabels = ['Codex · codex', 'Codex Allgemein · codex_general', 'Codex Review · codex_review'];
const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

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

async function visibleProviderOptions(ownerPage) {
  const picker = ownerPage.getByLabel('Providerinstanz aus T3');
  await expect(picker).toBeVisible();
  await picker.click();
  const options = ownerPage.getByRole('option');
  await expect(options).toHaveCount(activeProviderIds.length);
  await expect(options).toHaveText(activeProviderLabels);
  await ownerPage.keyboard.press('Escape');
}

async function refreshProviderInventoryFromBrowser(ownerPage, connectionId, search, button, qaMocks) {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const journalBookmark = (await qaMocks.t3Journal()).journal.length;
  const requestPromise = ownerPage.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'GET'
      && url.pathname === `${apiPrefix}/connections/${connectionId}/providers`
      && url.searchParams.get('search') === search;
  });
  await button.click();
  const request = await requestPromise;
  const response = await request.response();
  expect(response, 'The clicked refresh must complete the matching browser GET.').toBeTruthy();
  expect(response.status()).toBe(200);
  const inventory = await response.json();
  const newNativeEntries = (await qaMocks.t3Journal()).journal.slice(journalBookmark);
  const matchingNativeRefreshes = newNativeEntries.filter((entry) => entry.tool === 'orchestrator_capabilities'
    && entry.outcome === 'success'
    && entry.capability_search === search).at(-1);
  expect(matchingNativeRefreshes, 'The refreshed browser response must be backed by a new native T3 inventory entry.').toBeTruthy();

  return { inventory, nativeRefresh: matchingNativeRefreshes };
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
  const snapshot = await ownerApi.get(`/connections/${connection.id}/capabilities`);
  expect(snapshot.response.status(), JSON.stringify(snapshot.data)).toBe(200);
  expect(snapshot.data.providers).toHaveLength(5);
  expect(snapshot.data.providers.map((provider) => provider.provider_instance_id)).toEqual([
    'codex', 'codex_general', 'codex_review', 'codex_disabled', 'qa_uninstalled_agent',
  ]);
  expect(snapshot.data.providers.find((provider) => provider.provider_instance_id === 'codex_disabled')).toMatchObject({
    available: false,
    models: [expect.objectContaining({ id: 'qa-disabled-model' })],
  });
  expect(snapshot.data.providers.find((provider) => provider.provider_instance_id === 'qa_uninstalled_agent')).toMatchObject({
    available: false,
    models: [expect.objectContaining({ id: 'qa-uninstalled-model' })],
  });
  const nativeInventory = (await qaMocks.t3Journal()).journal.find((entry) => entry.tool === 'orchestrator_capabilities' && entry.outcome === 'success');
  expect(nativeInventory.provider_inventory).toHaveLength(5);
  expect(nativeInventory.provider_inventory.every((provider) => !Object.hasOwn(provider, 'available') && !Object.hasOwn(provider, 'enabled') && !Object.hasOwn(provider, 'installed'))).toBe(true);
  expect(nativeInventory.provider_inventory.find((provider) => provider.providerInstanceId === 'codex_disabled')).toMatchObject({
    canRunChildTask: false,
    constraints: ['Provider instance is disabled.'],
    models: [expect.objectContaining({ id: 'qa-disabled-model' })],
  });
  expect(nativeInventory.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_uninstalled_agent')).toMatchObject({
    canRunChildTask: false,
    constraints: ['Provider executable is not installed.'],
    models: [expect.objectContaining({ id: 'qa-uninstalled-model' })],
  });
  const inventory = await ownerApi.get(`/connections/${connection.id}/providers`);
  expect(inventory.response.status(), JSON.stringify(inventory.data)).toBe(200);
  expect(inventory.data.providers.map((provider) => provider.provider_instance_id)).toEqual(activeProviderIds);
  expect(inventory.data.providers.every((provider) => provider.available)).toBe(true);
  const generalProvider = inventory.data.providers.find((provider) => provider.provider_instance_id === 'codex_general');
  const reviewProvider = inventory.data.providers.find((provider) => provider.provider_instance_id === 'codex_review');
  expect(generalProvider).toMatchObject({ display_name: 'Codex Allgemein', available: true });
  expect(generalProvider.models.map((model) => model.id)).toEqual(['qa-general-model', 'qa-general-fast']);
  expect(generalProvider.models.find((model) => model.id === 'qa-general-model').reasoning).toEqual({
    option_id: 'reasoningEffort',
    values: ['low', 'medium'],
    default: 'low',
  });
  expect(reviewProvider).toMatchObject({ display_name: 'Codex Review', available: true });
  expect(reviewProvider.models.map((model) => model.id)).toEqual(['qa-review-featured', 'qa-review-model']);
  expect(reviewProvider.models.find((model) => model.id === 'qa-review-model').reasoning).toEqual({
    option_id: 'reasoningEffort',
    values: ['low', 'medium', 'high'],
    default: 'medium',
  });

  await openRoles(ownerPage);
  await selectRoleConnectionAndProject(ownerPage, connection.name, project.name);
  await ownerPage.getByLabel('Ausführungsziel in T3').click();
  await ownerPage.getByRole('option', { name: 'T3-Providerinstanz', exact: true }).click();
  await visibleProviderOptions(ownerPage);

  const targets = [
    { label: 'Codex Allgemein · codex_general', providerInstanceId: 'codex_general', model: 'qa-general-model', modelOption: 'QA General Model · qa-general-model', roleName: 'Codex Allgemein Rolle', reasoningOptions: ['T3-Standard', 'low', 'medium'], reasoning: 'T3-Standard' },
    { label: 'Codex Review · codex_review', providerInstanceId: 'codex_review', model: 'qa-review-model', modelOption: 'QA Review Model · qa-review-model', roleName: 'Codex Review Rolle', reasoningOptions: ['T3-Standard', 'low', 'medium', 'high'], reasoning: 'high' },
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
    await expect(modelPicker).toContainText('Modell wählen');
    await ownerPage.getByLabel('Name').fill(target.roleName);
    await ownerPage.getByLabel(project.name, { exact: true }).check();
    const createButton = ownerPage.getByRole('button', { name: 'Rolle anlegen', exact: true });
    await expect(createButton).toBeDisabled();
    await modelPicker.click();
    await ownerPage.getByRole('option', { name: target.modelOption, exact: true }).click();
    await expect(modelPicker).toContainText(target.model);
    const reasoningPicker = ownerPage.getByTestId('provider-reasoning-picker');
    await expect(reasoningPicker).toBeVisible();
    await expect(ownerPage.getByText(new RegExp(`Gemeldeter T3-Standard: ${target.providerInstanceId === 'codex_general' ? 'low' : 'medium'}\\.`))).toBeVisible();
    await reasoningPicker.click();
    await expect(ownerPage.getByRole('option')).toHaveText(target.reasoningOptions);
    await ownerPage.getByRole('option', { name: target.reasoning, exact: true }).click();
    await expect(createButton).toBeEnabled();
    const creation = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === apiPrefix + '/agent-profiles');
    await createButton.click();
    const created = await creation;
    expect(created.status()).toBe(201);
    expect((await created.json()).name).toBe(target.roleName);
    const profile = await roleByName(ownerApi, target.roleName);
    expect(profile).toBeTruthy();
    const expectedTarget = {
      mode: 't3_provider_instance',
      provider_instance_id: target.providerInstanceId,
      model: target.model,
      ...(target.reasoning === 'T3-Standard' ? {} : { reasoning: { option_id: 'reasoningEffort', value: target.reasoning } }),
    };
    expect(profile.execution_target).toEqual(expectedTarget);
    await expect(ownerPage.getByRole('article').filter({ hasText: target.roleName })).toContainText(`Providerinstanz ${target.providerInstanceId} · Modell ${target.model}`);
    await expect(ownerPage.getByRole('article').filter({ hasText: target.roleName })).toContainText(`Reasoning-Level ${target.reasoning}`);
  }

  const inactiveModelSearch = await ownerApi.get(`/connections/${connection.id}/providers?search=qa-disabled-model`);
  expect(inactiveModelSearch.response.status(), JSON.stringify(inactiveModelSearch.data)).toBe(200);
  expect(inactiveModelSearch.data.providers.map((provider) => provider.provider_instance_id)).toEqual(activeProviderIds);
  expect(inactiveModelSearch.data.providers.every((provider) => provider.models.length === 0)).toBe(true);
  const modelSearch = ownerPage.getByLabel('Modellsuche in T3');
  await modelSearch.fill('qa-disabled-model');
  await ownerPage.getByRole('button', { name: 'Modelle suchen', exact: true }).click();
  await visibleProviderOptions(ownerPage);

  const { inventory: refreshedSearchInventory, nativeRefresh: searchedNativeRefresh } = await refreshProviderInventoryFromBrowser(
    ownerPage,
    connection.id,
    'qa-disabled-model',
    ownerPage.getByRole('button', { name: 'Provider neu laden', exact: true }),
    qaMocks,
  );
  expect(refreshedSearchInventory.providers.map((provider) => provider.provider_instance_id)).toEqual(activeProviderIds);
  expect(refreshedSearchInventory.providers.every((provider) => provider.models.length === 0)).toBe(true);
  expect(searchedNativeRefresh.provider_inventory.find((provider) => provider.providerInstanceId === 'codex_disabled').models)
    .toContainEqual(expect.objectContaining({ id: 'qa-disabled-model' }));
  await expect(ownerPage.getByText('T3-Inventar wird aktualisiert…', { exact: true })).toHaveCount(0);
  await visibleProviderOptions(ownerPage);

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
  const providerPicker = editor.getByLabel('Providerinstanz aus T3');
  await providerPicker.click();
  await ownerPage.getByRole('option', { name: targets[1].label, exact: true }).click();
  const editedModelPicker = editor.getByLabel('Modell aus T3');
  await expect(editedModelPicker).toContainText('Modell wählen');
  const saveTargetButton = editor.getByRole('button', { name: 'Ausführungsziel speichern', exact: true });
  await expect(saveTargetButton).toBeDisabled();
  await editedModelPicker.click();
  await ownerPage.getByRole('option', { name: targets[1].modelOption, exact: true }).click();
  await expect(editedModelPicker).toContainText(targets[1].model);
  const editedReasoningPicker = editor.getByTestId('provider-reasoning-picker');
  await expect(editedReasoningPicker).toBeVisible();
  await editedReasoningPicker.click();
  await expect(ownerPage.getByRole('option')).toHaveText(targets[1].reasoningOptions);
  await ownerPage.getByRole('option', { name: 'high', exact: true }).click();
  await expect(saveTargetButton).toBeEnabled();
  await saveTargetButton.click();
  await expect.poll(async () => (await roleByName(ownerApi, targets[0].roleName))?.execution_target, {
    timeout: 45_000,
    message: 'Die vorhandene Rolle muss auf die zweite T3-Providerinstanz umgestellt werden.',
  }).toEqual({
    mode: 't3_provider_instance',
    provider_instance_id: targets[1].providerInstanceId,
    model: targets[1].model,
    reasoning: { option_id: 'reasoningEffort', value: 'high' },
  });
  const changedProfile = await roleByName(ownerApi, targets[0].roleName);
  for (const field of preservedFields) expect(changedProfile[field]).toEqual(originalValues[field]);
  expect(changedProfile.version).toBe(generalProfile.version + 1);

  await qaMocks.setT3Scenario('reasoning_option_missing');
  await generalArticle.getByRole('button', { name: 'Ausführungsziel ändern', exact: true }).click();
  const staleReasoningEditor = ownerPage.getByTestId(`profile-target-editor-${generalProfile.id}`);
  const { inventory: refreshedStaleInventory, nativeRefresh: staleCapability } = await refreshProviderInventoryFromBrowser(
    ownerPage,
    connection.id,
    null,
    staleReasoningEditor.getByRole('button', { name: 'Provider neu laden', exact: true }),
    qaMocks,
  );
  expect(refreshedStaleInventory.providers.find((provider) => provider.provider_instance_id === 'codex_review').models)
    .toContainEqual(expect.objectContaining({ id: 'qa-review-model' }));
  expect(staleCapability.provider_inventory.find((provider) => provider.providerInstanceId === 'codex_review').models
    .find((model) => model.id === 'qa-review-model')).not.toHaveProperty('options');
  await expect(staleReasoningEditor.getByText(/Gespeichertes Reasoning-Level „high“ \(Option reasoningEffort\)/)).toBeVisible();
  const staleReasoningPicker = staleReasoningEditor.getByTestId('provider-reasoning-picker');
  const staleSaveButton = staleReasoningEditor.getByRole('button', { name: 'Ausführungsziel speichern', exact: true });
  await expect(staleSaveButton).toBeDisabled();
  await staleReasoningPicker.click();
  await expect(ownerPage.getByRole('option')).toHaveText(['T3-Standard']);
  await ownerPage.getByRole('option', { name: 'T3-Standard', exact: true }).click();
  await expect(staleSaveButton).toBeEnabled();
  await staleSaveButton.click();
  await expect.poll(async () => (await roleByName(ownerApi, targets[0].roleName))?.execution_target, {
    timeout: 45_000,
    message: 'Die veraltete Reasoning-Auswahl muss nur nach bewusster Wahl von T3-Standard entfernt werden.',
  }).toEqual({ mode: 't3_provider_instance', provider_instance_id: targets[1].providerInstanceId, model: targets[1].model });
  const removedReasoningProfile = await roleByName(ownerApi, targets[0].roleName);
  for (const field of preservedFields) expect(removedReasoningProfile[field]).toEqual(originalValues[field]);
  expect(removedReasoningProfile.version).toBe(generalProfile.version + 2);
  await qaMocks.setT3Scenario('default');

  await qaMocks.setT3Scenario('provider_signals');
  const signalInventory = await ownerApi.get(`/connections/${connection.id}/providers`);
  expect(signalInventory.response.status(), JSON.stringify(signalInventory.data)).toBe(200);
  expect(signalInventory.data.providers.map((provider) => provider.provider_instance_id)).toEqual(['qa_native_signal', 'qa_legacy_signal']);
  expect(signalInventory.data.providers.every((provider) => provider.available)).toBe(true);
  const signalJournal = (await qaMocks.t3Journal()).journal.filter((entry) => entry.tool === 'orchestrator_capabilities').at(-1);
  expect(signalJournal.provider_inventory).toHaveLength(7);
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_native_signal')).toMatchObject({ canRunChildTask: true });
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_legacy_signal')).toMatchObject({ available: true });
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_no_signal')).not.toHaveProperty('available');
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_native_string')).toMatchObject({ canRunChildTask: 'true' });
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_legacy_string')).toMatchObject({ available: 'true' });
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_native_overruled')).toMatchObject({ canRunChildTask: true, available: false });
  expect(signalJournal.provider_inventory.find((provider) => provider.providerInstanceId === 'qa_legacy_overruled')).toMatchObject({ canRunChildTask: false, available: true });
  await qaMocks.setT3Scenario('default');

  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  recordEvidence(
    'Agentrollen speichern das T3-gemeldete Reasoning-Level pro Modell und entfernen veraltete Werte nur nach bewusster Auswahl.',
    'Die API und Browserauswahl zeigten für qa-general-model nur low/medium und für qa-review-model zusätzlich high, jeweils aus dem nativen Modellinventar. Die erste Rolle speicherte T3-Standard ohne Reasoning-Wert; die zweite speicherte reasoningEffort/high. Beim Bearbeiten wechselte eine vorhandene Rolle auf das Review-Modell und high, wobei übrige Profilfelder erhalten blieben. Als T3 den Wert nicht mehr anbot, blockierte die Oberfläche das Speichern, zeigte gespeicherten Wert und Option-ID und erlaubte nach Auswahl von T3-Standard die gezielte Entfernung. Der getrennte Providerfall enthielt drei aktive und zwei inaktive T3-Instanzen; Suche und Refresh schlossen inaktive Slugs weiter aus. Die API-Signalvariante zeigte natives und Legacy-Verfügbarkeitssignal sowie ausgeschlossene fehlende, falsch typisierte oder widersprüchliche Signale.',
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
  const roleName = 'Gezielte Modellrolle';
  await ownerPage.getByLabel('Name').fill(roleName);
  const createButton = ownerPage.getByRole('button', { name: 'Rolle anlegen', exact: true });
  await expect(createButton).toBeDisabled();

  const search = ownerPage.getByLabel('Modellsuche in T3');
  await search.fill('qa-review-model');
  await ownerPage.getByRole('button', { name: 'Modelle suchen', exact: true }).click();
  await expect(modelPicker).toContainText('qa-review-model');
  await modelPicker.click();
  await ownerPage.getByRole('option', { name: 'QA Review Model · qa-review-model', exact: true }).click();
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(ownerPage.getByText('Rolle angelegt', { exact: true })).toBeVisible();
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
    'Die Browseransicht zeigte qa-review-featured zunächst als gekürzte Modellliste mit ausgelassenen Treffern, ließ das Speichern ohne Auswahl gesperrt und lud nach Suche nach qa-review-model den gezielten Treffer. Das Modell wurde ausdrücklich im Auswahlfeld gewählt; die Agentrollen-API speicherte codex_review und qa-review-model. Der T3-Mock protokollierte den weitergereichten Suchbegriff und den Treffer.',
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
