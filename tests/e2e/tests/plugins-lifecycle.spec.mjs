import { randomUUID } from 'node:crypto';
import { authorizeT3InBrowser, createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

const LINK_NOTES = 'falkenwarte.link-notes';
const T3_BRIDGE = 'falkenwarte.t3-mcp-bridge';
const QA_DEPENDENT = 'falkenwarte.qa-bridge-dependent';
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

async function openPlugin(ownerPage, pluginId) {
  await ownerPage.goto('/#/plugins');
  await expect(ownerPage.getByRole('heading', { name: 'Erweiterungen' })).toBeVisible();
  await ownerPage.getByRole('button').filter({ hasText: pluginId }).click();
}

async function activateInBrowser(ownerPage, ownerApi, pluginId) {
  await openPlugin(ownerPage, pluginId);
  await ownerPage.getByRole('button', { name: 'Aktivieren', exact: true }).click();
  const plugin = await readUntil(ownerApi, `/plugins/${pluginId}`, (item) => item.state === 'enabled', `${pluginId} muss aktiviert sein.`);
  await expect(ownerPage.getByRole('button', { name: 'Drain starten', exact: true })).toBeVisible();
  return plugin;
}

async function drainAndDeactivateInBrowser(ownerPage, ownerApi, pluginId) {
  await openPlugin(ownerPage, pluginId);
  await ownerPage.getByRole('button', { name: 'Drain starten', exact: true }).click();
  await readUntil(ownerApi, `/plugins/${pluginId}`, (item) => item.state === 'disabled', `${pluginId} muss nach dem Drain deaktiviert sein.`);
  await expect(ownerPage.getByRole('button', { name: 'Deaktivieren', exact: true })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Deaktivieren', exact: true }).click();
  return readUntil(ownerApi, `/plugins/${pluginId}`, (item) => item.state === 'installed_disabled', `${pluginId} muss installiert und deaktiviert bleiben.`);
}

test('A17 Linknotizen bleiben über Browser, API und MCP verfügbar und behalten Revisionen nach Deaktivierung', async ({ ownerApi, ownerPage, baseURL }) => {
  test.setTimeout(150_000);
  const project = await ownerApi.createProject({ name: 'A17 Linknotizen-Lifecycle' });
  await ownerApi.ensureDefaultBoard(project.id);
  const taskResult = await ownerApi.createTask(project.id, {
    title: 'Lokale Notiz zu einer registrierten Quelle',
    link_collections: [{
      name: 'Quellen',
      kind: 'reference',
      links: [{ title: 'Abnahmekonzept', url: 'https://example.test/falkenwarte/acceptance', kind: 'documentation', relation: 'references' }],
    }],
  });
  const task = await readUntil(ownerApi, `/tasks/${taskResult.id}`, (item) => Array.isArray(item.link_collection_ids), 'Das Ticket mit registriertem Link muss lesbar sein.');

  const activated = await activateInBrowser(ownerPage, ownerApi, LINK_NOTES);
  expect(activated.ui_contributions).toContainEqual(expect.objectContaining({ slot: 'task.tabs', component_id: 'link-notes.tab', label: 'Linknotizen' }));

  await ownerPage.goto(`/#/project/${project.id}/board?task=${task.id}`);
  await expect(ownerPage.getByRole('heading', { name: task.title })).toBeVisible();
  await ownerPage.getByRole('tab', { name: 'Linknotizen' }).click();
  const notesPanel = ownerPage.getByRole('tabpanel', { name: 'Linknotizen' });
  await notesPanel.getByLabel('Ticketlink').click();
  await ownerPage.getByRole('option', { name: 'Abnahmekonzept', exact: true }).click();
  const originalNote = 'Diese Referenz enthält die fachlichen Prüfpunkte für die nächste Abnahme.';
  await notesPanel.getByRole('textbox', { name: 'Notiz', exact: true }).fill(originalNote);
  await ownerPage.getByRole('button', { name: 'Ergänzen', exact: true }).click();
  await expect(ownerPage.getByText(originalNote, { exact: true })).toBeVisible();

  const token = await ownerApi.createTechnicalToken({
    label: `A17 Linknotizen ${randomUUID().slice(0, 8)}`,
    projectIds: [project.id],
    capabilities: ['tasks.read', 'links.notes.write'],
  });
  const simulator = await createAgentSimulator(baseURL, token.token);
  try {
    const toolNames = (await simulator.agent.listTools()).map((tool) => tool.name);
    expect(toolNames).toContain('link_notes_list');
    expect(toolNames).toContain('link_note_update');
    const listed = await simulator.agent.call('link_notes_list', { task_id: task.id });
    expect(listed.structuredContent.items).toHaveLength(1);
    expect(listed.structuredContent.items[0].note).toBe(originalNote);

    const currentTask = (await ownerApi.get(`/tasks/${task.id}`)).data;
    const updatedNote = 'Die Referenz bleibt lokal; externe Inhalte werden nicht geladen.';
    const updated = await simulator.agent.call('link_note_update', {
      task_id: task.id,
      note_id: listed.structuredContent.items[0].id,
      note: updatedNote,
      client_request_id: `a17-update-${randomUUID()}`,
      expected_version: currentTask.version,
    });
    expect(updated.structuredContent.note).toBe(updatedNote);
    expect(updated.structuredContent.history.map((entry) => entry.change)).toEqual(['created', 'updated']);

    await drainAndDeactivateInBrowser(ownerPage, ownerApi, LINK_NOTES);
    const disabled = await ownerApi.get(`/plugins/${LINK_NOTES}`);
    expect(disabled.response.status()).toBe(200);
    expect(disabled.data.state).toBe('installed_disabled');

    const disabledTools = (await simulator.agent.listTools()).map((tool) => tool.name);
    expect(disabledTools).not.toContain('link_notes_list');
    expect(disabledTools).not.toContain('link_note_update');
    const deniedWrite = await ownerApi.post(`/tasks/${task.id}/link-notes`, {
      link_id: listed.structuredContent.items[0].link_id,
      note: 'Darf bei deaktivierter Erweiterung nicht gespeichert werden.',
    }, { version: currentTask.version });
    expect(deniedWrite.response.status(), JSON.stringify(deniedWrite.data)).toBe(409);
    expect(deniedWrite.data.code).toBe('capability_unavailable');

    const retained = await ownerApi.get(`/tasks/${task.id}/link-notes`);
    expect(retained.response.status(), JSON.stringify(retained.data)).toBe(200);
    expect(retained.data.items[0].note).toBe(updatedNote);
    expect(retained.data.items[0].history.map((entry) => entry.change)).toEqual(['created', 'updated']);
    await ownerPage.goto(`/#/project/${project.id}/board?task=${task.id}`);
    await ownerPage.getByRole('tab', { name: 'Linknotizen' }).click();
    await expect(ownerPage.getByText('Erweiterung deaktiviert · Notizen bleiben lesbar')).toBeVisible();
    await expect(ownerPage.getByText(updatedNote, { exact: true })).toBeVisible();
    await expect(ownerPage.getByRole('button', { name: 'Notiz bearbeiten' })).toHaveCount(0);

    await activateInBrowser(ownerPage, ownerApi, LINK_NOTES);
    expect((await simulator.agent.listTools()).map((tool) => tool.name)).toContain('link_notes_list');
    const reenabledNotes = await simulator.agent.call('link_notes_list', { task_id: task.id });
    expect(reenabledNotes.structuredContent.items[0].history.map((entry) => entry.change)).toEqual(['created', 'updated']);
    recordEvidence(
      'A17: Die installierte Linknotizen-Erweiterung aktiviert ihre Browser-Ansicht und MCP-Werkzeuge, sperrt Schreibzugriffe nach Deaktivierung und erhält Daten samt Revisionen.',
      `Owner-Browser legte die Notiz zu einem bereits registrierten Ticketlink an. Eine technische MCP-Sitzung las und änderte sie; history=${updated.structuredContent.history.map((entry) => entry.change).join(',')}. Nach Drain/Deaktivierung fehlten die MCP-Werkzeuge, API-Schreiben erhielt capability_unavailable, Browser und API konnten die Historie lesen. Nach Reaktivierung waren MCP-Werkzeuge und beide Revisionen wieder verfügbar.`,
    );
  } finally {
    await simulator.close();
  }
});

async function createT3Connection(ownerApi, ownerPage, baseURL, qaMocks, name) {
  const created = await ownerApi.post('/connections', {
    name,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;
  await ownerPage.goto('/#/agents');
  await ownerPage.locator('main').getByRole('button', { name: new RegExp(name) }).click();
  await authorizeT3InBrowser(ownerPage, baseURL, qaMocks.t3URL);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Der T3-Mock muss über den Browser angemeldet sein.');
  await ownerPage.locator('main').getByRole('button', { name: new RegExp(name) }).click();
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect.poll(async () => {
    const check = await ownerApi.get(`/connections/${connection.id}/check`);
    return check.response.status() === 200
      ? [check.data.network, check.data.authentication, check.data.mcp_handshake, check.data.capabilities].join(':')
      : null;
  }, { timeout: 45_000 }).toBe('ok:ok:ok:ok');
  return readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Die Verbindung und Fähigkeiten müssen bereit sein.');
}

async function bindProject(ownerApi, project, connectionId) {
  const latestProject = (await ownerApi.get(`/projects/${project.id}`)).data;
  const result = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connectionId,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: latestProject.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
  return result.data;
}

async function createProfile(ownerApi, name, project, connectionId) {
  const result = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role: 'A18 Lifecycle-Prüfung',
    connection_id: connectionId,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Prüfe den isolierten A18-Lifecycle-Auftrag.',
    enabled: true,
    default_run_completion_policy: runPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data;
}

test('A18 T3-Bridge-Drain sperrt neue Starts, hält aktive Runs beobachtbar und berücksichtigt Abhängigkeiten', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(180_000);
  const connection = await createT3Connection(ownerApi, ownerPage, baseURL, qaMocks, 'A18 Bridge-Lifecycle');
  const projectA = await ownerApi.createProject({ name: 'A18 Aktiver Lauf' });
  const projectB = await ownerApi.createProject({ name: 'A18 Gesperrter Start' });
  for (const project of [projectA, projectB]) await ownerApi.ensureDefaultBoard(project.id);
  const bindingA = await bindProject(ownerApi, projectA, connection.id);
  await bindProject(ownerApi, projectB, connection.id);
  const profileA = await createProfile(ownerApi, 'A18 Aktive Rolle', projectA, connection.id);
  const profileB = await createProfile(ownerApi, 'A18 Neue Rolle', projectB, connection.id);
  const readyA = (await ownerApi.get(`/projects/${projectA.id}/statuses`)).data.items.find((status) => status.category === 'ready');
  const readyB = (await ownerApi.get(`/projects/${projectB.id}/statuses`)).data.items.find((status) => status.category === 'ready');
  const taskA = await ownerApi.createTask(projectA.id, { title: 'A18 laufender T3-Auftrag', status_id: readyA.id });
  const taskB = await ownerApi.createTask(projectB.id, { title: 'A18 neuer T3-Auftrag', status_id: readyB.id });
  const runTask = (await ownerApi.get(`/tasks/${taskA.id}`)).data;
  await qaMocks.setT3Scenario('run_pending');
  const acceptedRun = await ownerApi.post(`/tasks/${taskA.id}/runs`, {
    agent_profile_id: profileA.id,
    stage: 'implementation',
    task_revision: runTask.version,
  }, { version: runTask.version });
  expect(acceptedRun.response.status(), JSON.stringify(acceptedRun.data)).toBe(202);
  const runId = acceptedRun.data.run_id ?? acceptedRun.data.resource?.id;
  expect(runId).toBeTruthy();
  const activeRun = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id) && Boolean(run.attempts[0]?.external_dispatch_run_id), 'Der Mock-T3-Auftrag muss aktiv und von außen beobachtbar sein.');
  expect(activeRun.snapshot.project_binding_id).toBe(bindingA.id);
  expect(activeRun.snapshot.bridge_plugin_id).toBe(T3_BRIDGE);

  const dependent = await ownerApi.get(`/plugins/${QA_DEPENDENT}`);
  expect(dependent.response.status(), JSON.stringify(dependent.data)).toBe(200);
  const dependentActivation = await ownerApi.post(`/plugins/${QA_DEPENDENT}/activate`, {
    acknowledged_contract_version: dependent.data.contract_version,
  }, { version: dependent.data.version });
  expect(dependentActivation.response.status(), JSON.stringify(dependentActivation.data)).toBe(202);
  await readUntil(ownerApi, `/plugins/${QA_DEPENDENT}`, (plugin) => plugin.state === 'enabled', 'Das abhängige QA-Plugin muss aktiviert sein.');

  let bridge = (await ownerApi.get(`/plugins/${T3_BRIDGE}`)).data;
  const draining = await ownerApi.post(`/plugins/${T3_BRIDGE}/drain`, {
    policy: 'finish_active',
    reason: 'A18 prüft, dass neue Starts gesperrt und aktive T3-Aufträge weiter beobachtet werden.',
  }, { version: bridge.version });
  expect(draining.response.status(), JSON.stringify(draining.data)).toBe(202);
  bridge = await readUntil(ownerApi, `/plugins/${T3_BRIDGE}`, (plugin) => plugin.state === 'draining' && plugin.active_run_count === 1, 'Bridge muss mit einem gebundenen aktiven Lauf im Drain bleiben.');
  await ownerPage.goto('/#/plugins');
  await ownerPage.getByRole('button').filter({ hasText: T3_BRIDGE }).click();
  await expect(ownerPage.getByText('Lässt aktive Arbeit auslaufen', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Aktive Aufträge', { exact: true }).locator('..')).toContainText('1');
  await expect(ownerPage.getByText('Wartende Arbeit', { exact: true }).locator('..')).toContainText('0');
  await expect(ownerPage.getByText('Ungeklärte externe Aktivitäten', { exact: true }).locator('..')).toContainText('0');
  await expect(ownerPage.getByText(/abhängigen Erweiterungen.*QA: Abhängiges Bridge-Plugin/)).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Drain erneut prüfen', exact: true }).click();
  bridge = await readUntil(ownerApi, `/plugins/${T3_BRIDGE}`, (plugin) => plugin.state === 'draining' && plugin.active_run_count === 1, 'Der Browser-Drain darf einen extern aktiven Run nicht als beendet werten.');

  const blockedTask = (await ownerApi.get(`/tasks/${taskB.id}`)).data;
  const blockedStart = await ownerApi.post(`/tasks/${taskB.id}/runs`, {
    agent_profile_id: profileB.id,
    stage: 'implementation',
    task_revision: blockedTask.version,
  }, { version: blockedTask.version });
  expect(blockedStart.response.status(), JSON.stringify(blockedStart.data)).toBe(409);
  expect(blockedStart.data.code).toBe('capability_unavailable');
  const launchJournal = await qaMocks.t3Journal();
  expect(launchJournal.accepted_launches).toHaveLength(1);

  bridge = (await ownerApi.get(`/plugins/${T3_BRIDGE}`)).data;
  const cancelRequest = await ownerApi.post(`/plugins/${T3_BRIDGE}/drain`, {
    policy: 'request_cancel',
    reason: 'A18 fordert den bestätigten T3-Abbruch für bereits gestartete Provider-Runs an.',
  }, { version: bridge.version });
  expect(cancelRequest.response.status(), JSON.stringify(cancelRequest.data)).toBe(202);
  const endedRun = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'cancelled', 'Der T3-Abbruch darf erst nach externer Beobachtung als beendet gelten.');
  expect(endedRun.snapshot.bridge_plugin_id).toBe(T3_BRIDGE);
  const cancelJournal = await qaMocks.t3Journal();
  const cancelToolIndex = cancelJournal.journal.findIndex((entry) => entry.tool === 't3_thread_interrupt');
  const observationToolIndex = cancelJournal.journal.findIndex((entry, index) => index > cancelToolIndex && entry.tool === 't3_thread_read');
  expect(cancelToolIndex).toBeGreaterThanOrEqual(0);
  expect(observationToolIndex).toBeGreaterThan(cancelToolIndex);

  bridge = await readUntil(ownerApi, `/plugins/${T3_BRIDGE}`, (plugin) => plugin.state === 'disabled', 'Nach externer Beobachtung des T3-Endes muss der Drain automatisch abschließen.');
  await expect(ownerPage.getByRole('button', { name: 'Deaktivieren', exact: true })).toBeDisabled();
  const blockedDeactivate = await ownerApi.post(`/plugins/${T3_BRIDGE}/deactivate`, {
    reason: 'A18 Abhängigkeitsschutz prüfen.',
  }, { version: bridge.version });
  expect(blockedDeactivate.response.status(), JSON.stringify(blockedDeactivate.data)).toBe(409);
  expect(blockedDeactivate.data.code).toBe('plugin_dependency_active');

  const dependentState = (await ownerApi.get(`/plugins/${QA_DEPENDENT}`)).data;
  const dependentDrain = await ownerApi.post(`/plugins/${QA_DEPENDENT}/drain`, {
    policy: 'finish_active',
    reason: 'A18 QA-Abhängigkeit kontrolliert stilllegen.',
  }, { version: dependentState.version });
  expect(dependentDrain.response.status(), JSON.stringify(dependentDrain.data)).toBe(202);
  const dependentDisabled = await readUntil(ownerApi, `/plugins/${QA_DEPENDENT}`, (plugin) => plugin.state === 'disabled', 'Das abhängige Plugin muss nach seinem Drain deaktiviert sein.');
  const dependentDeactivation = await ownerApi.post(`/plugins/${QA_DEPENDENT}/deactivate`, {
    reason: 'A18 QA-Abhängigkeit nach dem Drain deaktivieren.',
  }, { version: dependentDisabled.version });
  expect(dependentDeactivation.response.status(), JSON.stringify(dependentDeactivation.data)).toBe(202);
  await readUntil(ownerApi, `/plugins/${QA_DEPENDENT}`, (plugin) => plugin.state === 'installed_disabled', 'Die Abhängigkeit muss deaktiviert bleiben.');

  bridge = (await ownerApi.get(`/plugins/${T3_BRIDGE}`)).data;
  const deactivation = await ownerApi.post(`/plugins/${T3_BRIDGE}/deactivate`, {
    reason: 'A18 Bridge nach bestätigtem Drain deaktivieren.',
  }, { version: bridge.version });
  expect(deactivation.response.status(), JSON.stringify(deactivation.data)).toBe(202);
  await readUntil(ownerApi, `/plugins/${T3_BRIDGE}`, (plugin) => plugin.state === 'installed_disabled', 'Die Bridge muss nach erfolgreichem Drain deaktiviert sein.');
  const finalRun = (await ownerApi.get(`/runs/${runId}`)).data;
  expect(finalRun.state).toBe('cancelled');
  expect(finalRun.snapshot.bridge_plugin_id).toBe(T3_BRIDGE);
  expect((await qaMocks.t3Journal()).accepted_launches).toHaveLength(1);

  recordEvidence(
    'A18: Die Bridge nimmt während Drain keine neuen Starts an, fordert bei request_cancel einen externen Abbruch an, wartet die T3-Beobachtung ab und berücksichtigt aktive Abhängigkeiten.',
    `T3 Run ${runId} blieb mit snapshot.bridge_plugin_id=${finalRun.snapshot.bridge_plugin_id} der Bridge zugeordnet. Der zweite Projektstart erhielt während state=draining capability_unavailable. Der Browser zeigte aktive Aufträge=1, wartende Arbeit=0, ungeklärte externe Aktivitäten=0 und den Namen des abhängigen QA-Plugins; „Drain erneut prüfen“ ließ den Run offen. Die explizite request_cancel-Policy führte zu t3_thread_interrupt; erst das nachfolgende t3_thread_read bestätigte cancelled und gab den Drain frei. Deaktivierung mit aktiver Abhängigkeit erhielt plugin_dependency_active; erst nach ihrem Drain konnte die Bridge deaktiviert werden.`,
    { t3: cancelJournal },
  );
});
