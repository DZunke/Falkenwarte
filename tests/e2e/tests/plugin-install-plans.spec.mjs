import { readFile } from 'node:fs/promises';
import { expect, recordEvidence, test } from '../support/fixtures.mjs';

const QA_PLUGIN = 'falkenwarte.qa-bridge-dependent';
const LINK_NOTES = 'falkenwarte.link-notes';

async function readPlugin(ownerApi, pluginId, state, message) {
  let current;
  await expect.poll(async () => {
    const result = await ownerApi.get(`/plugins/${pluginId}`);
    current = result.data;
    return result.response.status() === 200 && current.state === state;
  }, { timeout: 45_000, message }).toBe(true);
  return current;
}

async function exportPlanJson(page, card) {
  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'JSON exportieren' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  return { name: download.suggestedFilename(), data: JSON.parse(await readFile(path, 'utf8')) };
}

test('Plugin-Pläne lassen sich in der Oberfläche erstellen, prüfen, zurücknehmen und als JSON exportieren', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({ type: 'acceptance', description: 'A17' });
  await ownerPage.goto('/#/plugins');
  await expect(ownerPage.getByRole('heading', { name: 'Erweiterungen' })).toBeVisible();

  const installId = 'qa.example-plan';
  await ownerPage.locator('#install-plugin-id').fill(installId);
  await ownerPage.locator('#install-version').fill('1.2.3');
  await ownerPage.getByRole('button', { name: 'Installationsplan erstellen' }).click();
  const installCard = ownerPage.locator('article').filter({ hasText: installId });
  await expect(installCard.getByRole('button', { name: 'JSON exportieren' })).toBeVisible();
  const plansAfterInstall = (await ownerApi.get('/plugin-install-plans?limit=100')).data.items;
  const installPlan = plansAfterInstall.find((plan) => plan.plugin_id === installId);
  expect(installPlan?.operation).toBe('install');
  expect(installPlan?.status).toBe('prepared');
  const installExport = await exportPlanJson(ownerPage, installCard);
  expect(installExport.name).toBe(`install-${installId}-plan.json`);
  expect(installExport.data).toMatchObject({ id: installPlan.id, operation: 'install', plugin_id: installId, status: 'prepared' });

  const legacy = await ownerApi.post('/plugin-install-plans', {
    plugin_id: 'qa.example-legacy',
    target_version: '0.9.0',
    source: 'local_build',
  });
  expect(legacy.response.status(), JSON.stringify(legacy.data)).toBe(201);
  expect(legacy.data.operation).toBe('install');

  let linkNotes = await readPlugin(ownerApi, LINK_NOTES, 'installed_disabled', 'Linknotizen müssen zunächst deaktiviert sein.');
  const activation = await ownerApi.post(`/plugins/${LINK_NOTES}/activate`, {
    acknowledged_contract_version: linkNotes.contract_version,
  }, { version: linkNotes.version });
  expect(activation.response.status(), JSON.stringify(activation.data)).toBe(202);
  linkNotes = await readPlugin(ownerApi, LINK_NOTES, 'enabled', 'Linknotizen müssen ohne externe Verbindung aktivierbar sein.');
  const activeRemoval = await ownerApi.post('/plugin-install-plans', { operation: 'remove', plugin_id: LINK_NOTES });
  expect(activeRemoval.response.status(), JSON.stringify(activeRemoval.data)).toBe(409);
  expect(activeRemoval.data.code).toBe('plugin_state_conflict');

  const drain = await ownerApi.post(`/plugins/${LINK_NOTES}/drain`, {
    policy: 'finish_active',
    reason: 'Der gespeicherte Planlauf prüft die Sperre aktiver Fähigkeiten.',
  }, { version: linkNotes.version });
  expect(drain.response.status(), JSON.stringify(drain.data)).toBe(202);
  expect(drain.data.action_url).toBe(`${ownerApi.apiPrefix}/actions/${drain.data.action_id}`);
  await ownerApi.waitForSucceededAction(drain.data.action_id, 'Der Linknotizen-Drain muss abgeschlossen sein, bevor das Plugin deaktiviert wird.');
  linkNotes = await readPlugin(ownerApi, LINK_NOTES, 'disabled', 'Linknotizen müssen vor der Entfernung sicher deaktiviert sein.');
  const deactivate = await ownerApi.post(`/plugins/${LINK_NOTES}/deactivate`, {
    reason: 'Der gespeicherte Planlauf stellt den ursprünglichen sicheren Zustand wieder her.',
  }, { version: linkNotes.version });
  expect(deactivate.response.status(), JSON.stringify(deactivate.data)).toBe(202);
  await readPlugin(ownerApi, LINK_NOTES, 'installed_disabled', 'Linknotizen sollen nach dem Test deaktiviert bleiben.');

  await ownerPage.locator('#plan-operation').click();
  await ownerPage.getByRole('option', { name: 'Entfernung' }).click();
  await ownerPage.locator('#remove-plugin').click();
  await ownerPage.getByRole('option', { name: new RegExp(QA_PLUGIN) }).click();
  await ownerPage.getByRole('button', { name: 'Entfernungsplan erstellen' }).click();

  const pendingPlugin = await readPlugin(ownerApi, QA_PLUGIN, 'uninstall_pending', 'Ein vorbereiteter Entfernungsplan muss die Fähigkeit sperren.');
  expect(pendingPlugin.removal_plan_id).toBeTruthy();
  const removalPlanResult = await ownerApi.get(`/plugin-install-plans/${pendingPlugin.removal_plan_id}`);
  expect(removalPlanResult.response.status(), JSON.stringify(removalPlanResult.data)).toBe(200);
  const removalPlan = removalPlanResult.data;
  expect(removalPlan).toMatchObject({ operation: 'remove', plugin_id: QA_PLUGIN, status: 'prepared' });
  expect(removalPlan.steps.map((step) => step.kind)).toContain('preserve_data');

  const removalCard = ownerPage.locator('article').filter({ hasText: QA_PLUGIN }).filter({ hasText: 'Entfernung' });
  const removalExport = await exportPlanJson(ownerPage, removalCard);
  expect(removalExport.name).toBe(`remove-${QA_PLUGIN}-plan.json`);
  expect(removalExport.data).toEqual(removalPlan);

  await removalCard.getByRole('button', { name: 'Plan zurücknehmen' }).click();
  await expect.poll(async () => (await ownerApi.get(`/plugin-install-plans/${removalPlan.id}`)).data.status).toBe('cancelled');
  await readPlugin(ownerApi, QA_PLUGIN, 'installed_disabled', 'Zurücknehmen muss den vorherigen sicheren Zustand wiederherstellen.');

  recordEvidence(
    'Paketänderungen lassen sich über die Plugin-Oberfläche planen und als gespeicherte JSON-Ressource exportieren. Aktive Fähigkeiten bleiben vor Entfernungsplänen geschützt; ein zurückgenommener Plan stellt den vorherigen sicheren Zustand wieder her.',
    `Der Browser erstellte Installations- und Entfernungspläne und lud beide als JSON herunter. Der Export entsprach jeweils GET /plugin-install-plans/{plan_id}; ein Legacy-Installationsaufruf ohne operation blieb Installation. Ein aktives Linknotizen-Plugin erhielt HTTP 409 (${activeRemoval.data.code}); nach Deaktivierung wechselte der QA-Pluginstatus zu uninstall_pending und nach Zurücknahme zu installed_disabled.`,
  );
});
