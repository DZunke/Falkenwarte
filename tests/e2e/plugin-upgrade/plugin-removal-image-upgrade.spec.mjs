import { expect, recordEvidence, test } from '../support/fixtures.mjs';

const phase = process.env.FALKENWARTE_PLUGIN_UPGRADE_PHASE;
const pluginId = 'falkenwarte.qa-bridge-dependent';
const marker = 'qa-retained-through-image-upgrade-v1';

if (!['prepare', 'verify', 'readback', 'verify-after-readback'].includes(phase)) {
  throw new Error('Set FALKENWARTE_PLUGIN_UPGRADE_PHASE to prepare, verify, readback or verify-after-readback for the isolated image-upgrade scenario.');
}

async function readPlugin(ownerApi, state, message) {
  let current;
  await expect.poll(async () => {
    const result = await ownerApi.get(`/plugins/${pluginId}`);
    current = result.data;
    return result.response.status() === 200 && current.state === state;
  }, { timeout: 60_000, message }).toBe(true);
  return current;
}

async function prepareRemoval(ownerPage) {
  await ownerPage.goto('/#/plugins');
  await expect(ownerPage.getByRole('heading', { name: 'Erweiterungen' })).toBeVisible();
  await ownerPage.locator('#plan-operation').click();
  await ownerPage.getByRole('option', { name: 'Entfernung' }).click();
  await ownerPage.locator('#remove-plugin').click();
  await ownerPage.getByRole('option', { name: new RegExp(pluginId) }).click();
  await ownerPage.getByRole('button', { name: 'Entfernungsplan erstellen' }).click();
}

if (phase === 'prepare') {
  test('QA-Plugin wird für den kontrollierten Imagewechsel vorbereitet', async ({ ownerApi, ownerPage }) => {
    test.info().annotations.push({ type: 'acceptance', description: 'A17' });
    const configuration = await ownerApi.get(`/plugins/${pluginId}/config`);
    expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);
    const saved = await ownerApi.put(`/plugins/${pluginId}/config`, {
      schema_id: configuration.data.schema_id,
      values: { retention_marker: marker },
    }, { version: configuration.data.plugin_version });
    expect(saved.response.status(), JSON.stringify(saved.data)).toBe(200);

    await prepareRemoval(ownerPage);
    const pending = await readPlugin(ownerApi, 'uninstall_pending', 'Die Vorbereitung muss das Plugin bis zum Imagewechsel sperren.');
    expect(pending.removal_plan_id).toBeTruthy();
    const plan = await ownerApi.get(`/plugin-install-plans/${pending.removal_plan_id}`);
    expect(plan.response.status(), JSON.stringify(plan.data)).toBe(200);
    expect(plan.data).toMatchObject({ operation: 'remove', plugin_id: pluginId, status: 'prepared' });
    recordEvidence(
      'Ein gespeicherter Entfernungsplan sperrt ein deaktiviertes Plugin und hält Plugin-Konfiguration sowie den Plan für einen späteren Imagewechsel bereit.',
      `Der Browser erstellte den Entfernungsplan ${plan.data.id}. Der Pluginstatus ist ${pending.state}; die nicht leere Einstellung retention_marker wurde über die öffentliche Konfigurations-API gespeichert.`,
    );
  });
} else if (phase === 'readback') {
  test('Vorhandene QA-Imagekonfiguration bleibt nach der Entfernung erhalten', async ({ ownerApi }) => {
    test.info().annotations.push({ type: 'acceptance', description: 'A17' });
    const removed = await readPlugin(ownerApi, 'removed', 'Der persistierte Tombstone muss auch beim erneuten Laden der alten Definition bestehen bleiben.');
    expect(removed.configuration_retained).toBe(true);
    const configuration = await ownerApi.get(`/plugins/${pluginId}/config`);
    expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);
    expect(configuration.data.values.retention_marker).toBe(marker);
    const plan = await ownerApi.get(`/plugin-install-plans/${removed.removal_plan_id}`);
    expect(plan.response.status()).toBe(200);
    expect(plan.data.status).toBe('completed');
    recordEvidence(
      'Ein zuvor gespeicherter Pluginwert bleibt auch beim Lesen mit der früheren Paketdefinition erhalten; der abgeschlossene Entfernungszustand wird dadurch nicht rückgängig gemacht.',
      `Das QA-Image las retention_marker über GET /plugins/${pluginId}/config mit dem ursprünglichen Wert. Der Pluginstatus blieb removed und der Plan blieb completed.`,
    );
  });
} else {
  test('Pluginentfernung bleibt nach dem Imagewechsel und erneutem Neustart historisiert', async ({ ownerApi, ownerPage }) => {
    test.info().annotations.push({ type: 'acceptance', description: 'A17' });
    const removed = await readPlugin(ownerApi, 'removed', 'Maintenance muss die Entfernung nach dem Wechsel in ein Image ohne Manifest persistieren.');
    expect(removed.configuration_retained).toBe(true);
    expect(removed.removal_plan_id).toBeTruthy();

    await expect.poll(async () => {
      const result = await ownerApi.get(`/plugin-install-plans/${removed.removal_plan_id}`);
      return result.data?.completed_at ?? null;
    }, { timeout: 60_000, message: 'Maintenance muss den abgeschlossenen Imagewechsel dauerhaft am Plan vermerken.' }).not.toBeNull();
    const planResult = await ownerApi.get(`/plugin-install-plans/${removed.removal_plan_id}`);
    expect(planResult.response.status(), JSON.stringify(planResult.data)).toBe(200);
    expect(planResult.data).toMatchObject({ operation: 'remove', plugin_id: pluginId, status: 'completed' });
    expect(planResult.data.completed_at).toBeTruthy();

    const oldConfiguration = await ownerApi.get(`/plugins/${pluginId}/config`);
    expect(oldConfiguration.response.status()).toBe(404);
    let historyResult;
    await expect.poll(async () => {
      historyResult = await ownerApi.get(`/history?resource_type=plugin&resource_id=${encodeURIComponent(pluginId)}&limit=100`);
      return historyResult.response.status() === 200 && historyResult.data.items.some((revision) => revision.summary === 'PluginRemovalCompleted');
    }, { timeout: 60_000, message: 'Der Persistenzlauf muss eine Pluginrevision für den Imagewechsel erzeugen.' }).toBe(true);
    const completionRevision = historyResult.data.items.find((revision) => revision.summary === 'PluginRemovalCompleted');
    expect(completionRevision?.changes).toContainEqual(expect.objectContaining({
      path: '/state',
      before: { type: 'text', value: 'uninstall_pending' },
      after: { type: 'text', value: 'removed' },
    }));

    let eventPage;
    await expect.poll(async () => {
      eventPage = await ownerApi.get('/events?limit=100');
      return eventPage.response.status() === 200 && eventPage.data.items.some((item) =>
        item.change?.resource_type === 'plugin'
        && item.change?.resource_id === pluginId
        && item.change?.action_id === removed.removal_plan_id,
      );
    }, { timeout: 45_000, message: 'Der öffentliche Event-Catch-up muss den mit dem Plan korrelierten Pluginwechsel enthalten.' }).toBe(true);

    await ownerPage.goto('/#/plugins');
    await ownerPage.getByRole('button').filter({ hasText: pluginId }).click();
    await expect(ownerPage.getByText('Die gespeicherte Pluginkonfiguration bleibt erhalten; der entfernte Code wird nicht geladen.')).toBeVisible();
    const planCard = ownerPage.locator('article').filter({ hasText: pluginId }).filter({ hasText: 'Entfernung' });
    await expect(planCard.getByText('Entfernt', { exact: true })).toBeVisible();

    recordEvidence(
      'Ein Image ohne Pluginmanifest schließt den vorbereiteten Entfernungsplan ab, erhält gespeicherte Plugin-Daten und macht den Zustandswechsel in der Historie sichtbar.',
      `Nach dem Wechsel zeigte GET /plugins/${pluginId} den Zustand removed und configuration_retained=true. Der Plan ${removed.removal_plan_id} ist completed; die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan.`,
    );
  });
}
