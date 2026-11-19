import { request as playwrightRequest } from '@playwright/test';
import { expect, recordEvidence, test } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';
const linkNotesPluginId = 'falkenwarte.link-notes';
const retainedFieldKey = `${linkNotesPluginId}.review_text`;
const secretFieldKey = `${linkNotesPluginId}.api_key`;

async function readUntil(ownerApi, route, matches, message, timeout = 45_000) {
  let current;
  await expect.poll(async () => {
    const result = await ownerApi.get(route);
    if (result.response.status() !== 200) return false;
    current = result.data;
    return matches(current);
  }, { timeout, message }).toBe(true);
  return current;
}

async function ensureResponse(result, status, operation) {
  expect(result.response.status(), `${operation}: ${JSON.stringify(result.data)}`).toBe(status);
  return result.data;
}

test('A06 plugin-owned field history remains readable and restorable after plugin deactivation', async ({ ownerApi, ownerPage, baseURL }) => {
  test.setTimeout(150_000);
  test.info().annotations.push({
    type: 'expected',
    description: 'Ein Pluginfeld bleibt in alten Taskrevisionen lesbar und fachlich wiederherstellbar, ohne das deaktivierte Plugin zu aktivieren oder fremde Projektdaten und geheimnisartige Werte offenzulegen.',
  });

  const project = await ownerApi.createProject({ name: 'A06 Pluginfeld-Verlauf' });
  await ownerApi.ensureDefaultBoard(project.id);
  const otherProject = await ownerApi.createProject({ name: 'A06 getrenntes Projekt' });
  await ownerApi.ensureDefaultBoard(otherProject.id);

  let plugin = await readUntil(ownerApi, `/plugins/${linkNotesPluginId}`, (item) => item.state === 'installed_disabled', 'Linknotizen müssen installiert und deaktiviert sein.');
  const activation = await ownerApi.post(`/plugins/${linkNotesPluginId}/activate`, {
    acknowledged_contract_version: plugin.contract_version,
  }, { version: plugin.version });
  expect(activation.response.status(), JSON.stringify(activation.data)).toBe(202);
  plugin = await readUntil(ownerApi, `/plugins/${linkNotesPluginId}`, (item) => item.state === 'enabled', 'Linknotizen müssen aktiviert sein.');

  const retainedDefinition = await ownerApi.post(`/projects/${project.id}/custom-fields`, {
    key: retainedFieldKey,
    plugin_id: linkNotesPluginId,
    label: 'Frühere Review-Notiz',
    value_type: 'text',
    required: false,
    choices: [],
    active: true,
  });
  const retained = await ensureResponse(retainedDefinition, 201, 'create retained plugin field');
  const secretDefinition = await ownerApi.post(`/projects/${project.id}/custom-fields`, {
    key: secretFieldKey,
    plugin_id: linkNotesPluginId,
    label: 'Geheimnisähnliches Feld',
    value_type: 'text',
    required: false,
    choices: [],
    active: true,
  });
  const secret = await ensureResponse(secretDefinition, 201, 'create secret-like plugin field');
  expect(retained.plugin_id).toBe(linkNotesPluginId);
  expect(secret.plugin_id).toBe(linkNotesPluginId);

  const taskResult = await ownerApi.createTask(project.id, { title: 'Review-Notiz vor Plugin-Deaktivierung' });
  const task = await readUntil(ownerApi, `/tasks/${taskResult.id}`, (item) => item.version > 0, 'Das A06-Ticket muss lesbar sein.');
  const secretMarker = 'qa-secret-sentinel-7d6b82';
  const fieldUpdate = await ownerApi.patch(`/tasks/${task.id}`, {
    custom_fields: {
      [retainedFieldKey]: { type: 'text', value: 'Begründung aus der alten Pluginversion' },
      [secretFieldKey]: { type: 'text', value: secretMarker },
    },
  }, { version: task.version });
  expect(fieldUpdate.response.status(), JSON.stringify(fieldUpdate.data)).toBe(200);

  const taskHistory = async () => ownerApi.get(`/history?resource_type=task&resource_id=${encodeURIComponent(task.id)}&limit=100`);
  const historyBeforeDeactivation = await taskHistory();
  expect(historyBeforeDeactivation.response.status(), JSON.stringify(historyBeforeDeactivation.data)).toBe(200);
  const valueRevision = historyBeforeDeactivation.data.items.find((revision) =>
    revision.custom_field_values?.some((field) => field.key === retainedFieldKey && field.value.value === 'Begründung aus der alten Pluginversion'));
  expect(valueRevision, 'The public revision should preserve the historical plugin-owned text.').toBeTruthy();
  expect(valueRevision.custom_field_values.map((field) => field.key)).toContain(retainedFieldKey);
  expect(valueRevision.custom_field_values.map((field) => field.key)).not.toContain(secretFieldKey);
  expect(JSON.stringify(valueRevision)).not.toContain(secretMarker);
  const revisionDetail = await ownerApi.get(`/history/${valueRevision.id}`);
  expect(revisionDetail.response.status(), JSON.stringify(revisionDetail.data)).toBe(200);
  expect(revisionDetail.data.custom_field_values).toContainEqual(expect.objectContaining({
    key: retainedFieldKey,
    label: 'Frühere Review-Notiz',
    value: { type: 'text', value: 'Begründung aus der alten Pluginversion' },
  }));
  expect(JSON.stringify(revisionDetail.data)).not.toContain(secretMarker);

  const drain = await ownerApi.post(`/plugins/${linkNotesPluginId}/drain`, {
    policy: 'finish_active',
    reason: 'A06 prüft die Lesbarkeit historischer Pluginfelder.',
  }, { version: plugin.version });
  expect(drain.response.status(), JSON.stringify(drain.data)).toBe(202);
  plugin = await readUntil(ownerApi, `/plugins/${linkNotesPluginId}`, (item) => item.state === 'disabled', 'Der Plugin-Drain ohne aktive Arbeit muss abschließen.');
  const deactivate = await ownerApi.post(`/plugins/${linkNotesPluginId}/deactivate`, {
    reason: 'A06 prüft den Zustand nach Plugin-Deaktivierung.',
  }, { version: plugin.version });
  expect(deactivate.response.status(), JSON.stringify(deactivate.data)).toBe(202);
  plugin = await readUntil(ownerApi, `/plugins/${linkNotesPluginId}`, (item) => item.state === 'installed_disabled', 'Das Plugin muss installiert, aber deaktiviert bleiben.');

  const definitions = await ownerApi.get(`/projects/${project.id}/custom-fields?limit=100`);
  expect(definitions.response.status(), JSON.stringify(definitions.data)).toBe(200);
  expect(definitions.data.items.find((field) => field.id === retained.id)).toMatchObject({ plugin_id: linkNotesPluginId, active: false });
  expect(definitions.data.items.find((field) => field.id === secret.id)).toMatchObject({ plugin_id: linkNotesPluginId, active: false });

  const afterDisable = await ownerApi.get(`/tasks/${task.id}`);
  expect(afterDisable.response.status(), JSON.stringify(afterDisable.data)).toBe(200);
  const unrelatedUpdate = await ownerApi.patch(`/tasks/${task.id}`, { title: 'Unveränderte Notiz trotz deaktiviertem Plugin' }, { version: afterDisable.data.version });
  expect(unrelatedUpdate.response.status(), JSON.stringify(unrelatedUpdate.data)).toBe(200);
  expect(unrelatedUpdate.data.custom_fields[retainedFieldKey]).toEqual({ type: 'text', value: 'Begründung aus der alten Pluginversion' });

  const rejectedFieldEdit = await ownerApi.patch(`/tasks/${task.id}`, {
    custom_fields: { [retainedFieldKey]: { type: 'text', value: 'Neuer Text ist nicht zulässig' } },
  }, { version: unrelatedUpdate.data.version });
  expect(rejectedFieldEdit.response.status(), JSON.stringify(rejectedFieldEdit.data)).toBe(409);
  expect(rejectedFieldEdit.data.code).toBe('custom_field_inactive');
  const rejectedNewTask = await ownerApi.post(`/projects/${project.id}/tasks`, {
    title: 'Neuer Eintrag mit inaktivem Pluginfeld',
    custom_fields: { [retainedFieldKey]: { type: 'text', value: 'Darf nicht angenommen werden' } },
  });
  expect(rejectedNewTask.response.status(), JSON.stringify(rejectedNewTask.data)).toBe(422);

  const restore = await ownerApi.post(`/history/${valueRevision.id}/restore`, {
    reason: 'Den früheren, sicheren fachlichen Pluginfeldwert wiederherstellen.',
  }, { version: unrelatedUpdate.data.version });
  expect([200, 202], JSON.stringify(restore.data)).toContain(restore.response.status());
  const restoredTask = await readUntil(ownerApi, `/tasks/${task.id}`, (item) => item.title === 'Review-Notiz vor Plugin-Deaktivierung', 'Die erlaubten historischen Fachfelder müssen wiederhergestellt werden.');
  expect(restoredTask.custom_fields[retainedFieldKey]).toEqual({ type: 'text', value: 'Begründung aus der alten Pluginversion' });
  expect((await readUntil(ownerApi, `/plugins/${linkNotesPluginId}`, (item) => item.state === 'installed_disabled', 'Die Feldwiederherstellung darf das Plugin nicht reaktivieren.')).state).toBe('installed_disabled');
  const afterRestoreDefinitions = await ownerApi.get(`/projects/${project.id}/custom-fields?limit=100`);
  expect(afterRestoreDefinitions.data.items.find((field) => field.id === retained.id).active).toBe(false);
  const finalHistory = await taskHistory();
  expect(finalHistory.response.status(), JSON.stringify(finalHistory.data)).toBe(200);
  const restoreRevision = finalHistory.data.items.find((revision) => revision.summary === 'task.history_restored');
  expect(restoreRevision).toMatchObject({ actor: { kind: 'owner' }, reason: 'Den früheren, sicheren fachlichen Pluginfeldwert wiederherstellen.' });
  expect(restoreRevision.custom_field_values).toContainEqual(expect.objectContaining({
    key: retainedFieldKey,
    value: { type: 'text', value: 'Begründung aus der alten Pluginversion' },
  }));
  expect(JSON.stringify(finalHistory.data)).not.toContain(secretMarker);
  expect(restoreRevision.custom_field_values.map((field) => field.key)).not.toContain(secretFieldKey);

  const otherField = await ownerApi.post(`/projects/${otherProject.id}/custom-fields`, {
    key: 'other_plugin.private_note',
    label: 'Fremde Projektnotiz',
    value_type: 'text',
    required: false,
    choices: [],
    active: true,
  });
  const otherDefinition = await ensureResponse(otherField, 201, 'create other project field');
  const otherTask = await ownerApi.createTask(otherProject.id, { title: 'Nicht freigegebene Projektgeschichte' });
  const otherInitial = await ownerApi.get(`/tasks/${otherTask.id}`);
  const otherUpdate = await ownerApi.patch(`/tasks/${otherTask.id}`, {
    custom_fields: { [otherDefinition.key]: { type: 'text', value: 'Nur Hausarchiv darf dies sehen' } },
  }, { version: otherInitial.data.version });
  expect(otherUpdate.response.status(), JSON.stringify(otherUpdate.data)).toBe(200);
  const otherHistory = await ownerApi.get(`/history?resource_type=task&resource_id=${encodeURIComponent(otherTask.id)}&limit=100`);
  expect(otherHistory.response.status(), JSON.stringify(otherHistory.data)).toBe(200);
  const otherRevision = otherHistory.data.items.find((revision) => revision.custom_field_values?.some((field) => field.key === otherDefinition.key));
  expect(otherRevision).toBeTruthy();

  const issued = await ownerApi.createTechnicalToken({
    label: 'A06 nur History im ersten Projekt',
    projectIds: [project.id],
    capabilities: ['history.read'],
  });
  const scoped = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${issued.token}`, Accept: 'application/json' },
  });
  try {
    const hiddenList = await scoped.get(`${apiPrefix}/history?resource_type=task&resource_id=${encodeURIComponent(otherTask.id)}&limit=100`);
    expect(hiddenList.status()).toBe(200);
    expect((await hiddenList.json()).items).toEqual([]);
    const hiddenRevision = await scoped.get(`${apiPrefix}/history/${otherRevision.id}`);
    expect([403, 404]).toContain(hiddenRevision.status());
    expect(await hiddenRevision.text()).not.toContain('Nur Hausarchiv darf dies sehen');
  } finally {
    await scoped.dispose();
  }

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await expect(ownerPage.getByRole('heading', { name: project.name })).toBeVisible();
  await ownerPage.getByText(restoredTask.title, { exact: true }).click();
  await ownerPage.getByRole('tab', { name: 'Verlauf' }).click();
  await expect(ownerPage.getByText('Frühere Review-Notiz', { exact: true }).first()).toBeVisible();
  await expect(ownerPage.getByText('Begründung aus der alten Pluginversion', { exact: true }).first()).toBeVisible();
  await expect(ownerPage.getByText(secretMarker, { exact: true })).toHaveCount(0);

  recordEvidence(
    'Ein deaktiviertes Pluginfeld bleibt als sicherer historischer Fachwert lesbar und kann über den Eigentümerverlauf wiederhergestellt werden, ohne Pluginaktivierung, fremde Projektgeschichte oder geheimnisartige Feldwerte offenzulegen.',
    `Das aktive Plugin ${linkNotesPluginId} gehörte den Feldern ${retainedFieldKey} und ${secretFieldKey}. Nach regulärem Drain/Deaktivierung blieben die Definitionen effektiv inaktiv; unabhängige Taskänderungen erhielten den alten Wert, Feldänderungen und neue Feldbelegungen wurden abgewiesen. Restore erzeugte eine neue Owner-Revision mit Grund, setzte den alten Titel und den lesbaren Feldwert zurück, ließ das Plugin deaktiviert und entfernte den geheimnisartigen Sentinel aus allen Historyantworten. Ein auf Projekt ${project.id} beschränkter Principal erhielt keine History von Projekt ${otherProject.id}; der Browser zeigte den alten Feldnamen und Wert im Verlauf.`,
  );
});
