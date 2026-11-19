import { expect, recordEvidence, test } from '../support/fixtures.mjs';

test('A17 link note settings preserve edits, reject stale writes and allow an empty label filter', async ({ ownerApi, ownerPage }) => {
  const pluginId = 'falkenwarte.link-notes';
  const route = '/plugins/' + pluginId + '/config';
  const read = await ownerApi.get(route);
  expect(read.response.status(), JSON.stringify(read.data)).toBe(200);
  const initial = read.data;
  const project = await ownerApi.createProject({ name: 'Konfiguration Linknotizen' });
  const label = await ownerApi.createLabel(project.id, { name: 'Quellen', key: 'topic.quellen', color: '#638165' });
  const save = (labels, version) => ownerApi.put(route, { schema_id: initial.schema_id, values: { enabled_labels: labels } }, { version });
  const first = await save([label.id], initial.plugin_version);
  expect(first.response.status(), JSON.stringify(first.data)).toBe(200);
  expect(first.data.version).toBeGreaterThan(initial.plugin_version);
  const stale = await save([], initial.plugin_version);
  expect(stale.response.status()).toBe(412);
  expect((await ownerApi.get(route)).data.values.enabled_labels).toEqual([label.id]);

  await ownerPage.goto('/#/plugins');
  await ownerPage.getByRole('button').filter({ hasText: pluginId }).click();
  const filter = ownerPage.getByLabel(/Nur für diese Label-IDs/);
  await expect(filter).toHaveValue(label.id);
  await filter.fill('');
  const saved = ownerPage.waitForResponse((response) => response.url().endsWith(route) && response.request().method() === 'PUT');
  await ownerPage.getByRole('button', { name: 'Einstellungen speichern' }).click();
  expect((await saved).status()).toBe(200);
  await expect.poll(async () => (await ownerApi.get(route)).data.values.enabled_labels).toEqual([]);
  await ownerPage.reload();
  await expect(filter).toHaveValue('');
  recordEvidence('Neue Linknotizen-Einstellungen erhalten eine eigene Revision. Ein gespeicherter Filter lässt sich im Browser entfernen.', 'Eine zweite Änderung mit der alten Revision erhielt HTTP 412. Nach dem Leeren des Label-Filters zeigte die API eine leere Liste und der Browser ein leeres Feld, auch nach dem Neuladen.');
});
