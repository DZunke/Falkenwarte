import { test, expect, recordEvidence } from '../support/fixtures.mjs';
import { loadOwnerFixtureContext } from '../support/fixture-loader.mjs';

function metric(values, key) {
  const result = values.find((item) => item.key === key);
  expect(result, `Metric ${key} was not returned.`).toBeTruthy();
  return result;
}

test('A16 metric history is reproducible through public API and browser', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({
    type: 'expected',
    description: 'Der ausdrücklich geladene E2E-Kontext erzeugt einen reproduzierbaren Ticketverlauf über öffentliche APIs; der Browser zeigt dieselben Kennzahlen mit ihrer Stichprobe.',
  });

  const context = await loadOwnerFixtureContext(ownerApi);
  const project = context.projects.falkenwarte;
  const params = new URLSearchParams({
    project_id: project.id,
    from: context.metricWindow.from,
    to: context.metricWindow.to,
    grain: 'total',
  });
  const response = await ownerApi.get(`/metrics?${params.toString()}`);
  expect(response.response.status(), JSON.stringify(response.data)).toBe(200);

  const throughput = metric(response.data.values, 'throughput');
  const leadTime = metric(response.data.values, 'lead_time_seconds');
  const cycleTime = metric(response.data.values, 'cycle_time_seconds');
  const blockedTime = metric(response.data.values, 'blocked_time_seconds');
  const history = await ownerApi.get(`/history?resource_type=task&resource_id=${context.tasks.metric_cycle.id}&limit=100`);
  expect(history.response.status(), JSON.stringify(history.data)).toBe(200);
  const eventParams = new URLSearchParams({ project_id: project.id, limit: '100' });
  const events = await ownerApi.get(`/events?${eventParams.toString()}`);
  expect(events.response.status(), JSON.stringify(events.data)).toBe(200);
  const diagnostic = JSON.stringify({
    requested_window: { from: params.get('from'), to: params.get('to') },
    response_window: { from: response.data.from, to: response.data.to },
    computed_at: response.data.computed_at,
    data_through: response.data.data_through,
    throughput,
    task_history: history.data.items.map((item) => ({ recorded_at: item.recorded_at, summary: item.summary, changes: item.changes })),
    task_change_events: events.data.items.map((item) => item.change).filter((change) => change.resource_id === context.tasks.metric_cycle.id),
  });
  expect(throughput.value, diagnostic).toBe(2);
  expect(leadTime.value).toBe(302_400);
  expect(leadTime.sample_size).toBe(2);
  expect(cycleTime.value).toBe(216_000);
  expect(cycleTime.sample_size).toBe(2);
  expect(blockedTime.value).toBe(86_400);
  expect(blockedTime.sample_size).toBe(1);
  expect(response.data.data_through).toContain('2026-01-10T09:00:00');

  await ownerPage.goto('/#/metrics');
  await expect(ownerPage.getByRole('heading', { name: 'Metriken' })).toBeVisible();
  const selects = ownerPage.getByRole('combobox');
  await selects.nth(0).click();
  await ownerPage.getByRole('option', { name: 'Falkenwarte', exact: true }).click();
  await ownerPage.getByLabel('Von').fill('2026-01-01');
  await ownerPage.getByLabel('Bis').fill('2026-01-10');
  await selects.nth(1).click();
  await ownerPage.getByRole('option', { name: 'Gesamt', exact: true }).click();

  const table = ownerPage.getByRole('table');
  await expect(table.getByRole('row').filter({ hasText: 'Abgeschlossene Tickets' })).toContainText('2');
  await expect(table.getByRole('row').filter({ hasText: 'Lead-Time bis Abschluss' })).toContainText(/3[,.]5 Tage/);
  await expect(table.getByRole('row').filter({ hasText: 'Cycle-Time ab Arbeitsbeginn' })).toContainText(/2[,.]5 Tage/);
  await expect(table.getByRole('row').filter({ hasText: 'Median Blockadezeit' })).toContainText('1 Tage');

  recordEvidence(
    'Kennzahlen werden aus einem versionierten, über öffentliche API-Aktionen geladenen Verlauf berechnet und im Browser angezeigt.',
    `Das Ticket wurde am 1. Januar angelegt, am 2. Januar begonnen, vom 3. bis 4. Januar blockiert, am 5. Januar abgeschlossen, am 7. Januar wiedereröffnet, am 8. Januar erneut begonnen und am 10. Januar abgeschlossen. Die API lieferte zwei Abschlüsse, 84 Stunden mediane Lead-Time, 60 Stunden mediane Cycle-Time und 24 Stunden Blockadezeit; Chromium zeigte die Werte für Projekt ${project.id}.`,
  );
});
