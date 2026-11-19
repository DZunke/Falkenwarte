import { test, expect, recordEvidence } from '../support/fixtures.mjs';
import { loadOwnerFixtureContext } from '../support/fixture-loader.mjs';

function metric(values, key) {
  const result = values.find((item) => item.key === key);
  expect(result, `Metric ${key} was not returned.`).toBeTruthy();
  return result;
}

test('A16 metric history is reproducible through public API and browser', async ({ ownerApi, ownerPage, qaMocks }) => {
  test.info().annotations.push({
    type: 'expected',
    description: 'Projekt- und Gesamtmetriken unterscheiden sich nachvollziehbar; Wiedereröffnung und Abbruch werden getrennt, Anbieterabrechnung bleibt unbekannt, und der öffentliche Rebuild schließt ohne Run- oder Ticketnebenwirkung ab.',
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
  const globalParams = new URLSearchParams({
    from: context.metricWindow.from,
    to: context.metricWindow.to,
    grain: 'total',
  });
  const globalResponse = await ownerApi.get(`/metrics?${globalParams.toString()}`);
  expect(globalResponse.response.status(), JSON.stringify(globalResponse.data)).toBe(200);

  const throughput = metric(response.data.values, 'throughput');
  const projectOpen = metric(response.data.values, 'open_tasks');
  const leadTime = metric(response.data.values, 'lead_time_seconds');
  const cycleTime = metric(response.data.values, 'cycle_time_seconds');
  const blockedTime = metric(response.data.values, 'blocked_time_seconds');
  const providerCost = metric(response.data.values, 'provider_cost');
  const globalThroughput = metric(globalResponse.data.values, 'throughput');
  const globalOpen = metric(globalResponse.data.values, 'open_tasks');
  const globalProviderCost = metric(globalResponse.data.values, 'provider_cost');
  const history = await ownerApi.get(`/history?resource_type=task&resource_id=${context.tasks.metric_cycle.id}&limit=100`);
  expect(history.response.status(), JSON.stringify(history.data)).toBe(200);
  const cancelledHistory = await ownerApi.get(`/history?resource_type=task&resource_id=${context.tasks.metric_cancelled.id}&limit=100`);
  expect(cancelledHistory.response.status(), JSON.stringify(cancelledHistory.data)).toBe(200);
  const cancelledTask = await ownerApi.get(`/tasks/${context.tasks.metric_cancelled.id}`);
  expect(cancelledTask.response.status(), JSON.stringify(cancelledTask.data)).toBe(200);
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
  expect(projectOpen.value).toBe(0);
  expect(globalResponse.data.project_id).toBeNull();
  expect(globalThroughput.value).toBe(2);
  expect(globalOpen.value).toBe(1);
  expect(globalResponse.data.values.some((item) => item.key === 'provider_cost' && item.value === 0)).toBe(false);
  for (const cost of [providerCost, globalProviderCost]) {
    expect(cost.value).toBeNull();
    expect(cost.unit).toBe('currency');
    expect(cost.currency).toBeNull();
    expect(cost.sample_size).toBe(0);
    expect(cost.quality).toBe('unavailable');
    expect(cost.reason).toContain('Kosten bleiben unbekannt');
  }
  const cycleChanges = history.data.items.flatMap((item) => item.changes ?? []);
  expect(cycleChanges.filter((change) => change.path === '/status_category' && change.after.value === 'done')).toHaveLength(2);
  expect(cycleChanges.some((change) => change.path === '/status_category' && change.before.value === 'done' && change.after.value === 'ready')).toBe(true);
  const cancellationChanges = cancelledHistory.data.items.flatMap((item) => item.changes ?? []);
  expect(cancelledTask.data.status_category).toBe('cancelled');
  expect(cancellationChanges.some((change) => change.path === '/status_category' && change.after.value === 'cancelled')).toBe(true);
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
  await expect(table.getByRole('row').filter({ hasText: 'Offene Tickets' })).toContainText('0');
  await expect(table.getByRole('row').filter({ hasText: 'Lead-Time bis Abschluss' })).toContainText(/3[,.]5 Tage/);
  await expect(table.getByRole('row').filter({ hasText: 'Cycle-Time ab Arbeitsbeginn' })).toContainText(/2[,.]5 Tage/);
  await expect(table.getByRole('row').filter({ hasText: 'Median Blockadezeit' })).toContainText('1 Tage');
  const costRow = table.getByRole('row').filter({ hasText: 'Anbieterkosten' });
  await expect(costRow).toContainText('Noch keine Daten');
  await expect(costRow).toContainText('Keine Daten');
  await expect(costRow).toContainText('Kosten bleiben unbekannt');
  await selects.nth(0).click();
  await ownerPage.getByRole('option', { name: 'Alle erreichbaren Projekte', exact: true }).click();
  await expect(table.getByRole('row').filter({ hasText: 'Offene Tickets' })).toContainText('1');
  await expect(table.getByRole('row').filter({ hasText: 'Abgeschlossene Tickets' })).toContainText('2');

  const runParams = new URLSearchParams({ project_id: project.id, limit: '100' });
  const runsBefore = await ownerApi.get(`/runs?${runParams.toString()}`);
  expect(runsBefore.response.status(), JSON.stringify(runsBefore.data)).toBe(200);
  expect(runsBefore.data.items).toEqual([]);
  const taskBeforeRebuild = await ownerApi.get(`/tasks/${context.tasks.metric_cycle.id}`);
  expect(taskBeforeRebuild.response.status(), JSON.stringify(taskBeforeRebuild.data)).toBe(200);
  const rebuild = await ownerApi.post('/metrics/rebuild');
  expect(rebuild.response.status(), JSON.stringify(rebuild.data)).toBe(202);
  let rebuildAction;
  await expect.poll(async () => {
    const current = await ownerApi.get(`/actions/${rebuild.data.action_id}`);
    if (current.response.status() !== 200) return null;
    rebuildAction = current.data;
    return rebuildAction.status;
  }, { timeout: 45_000, message: 'Der Metrik-Rebuild muss als lokale Action abschließen.' }).toBe('succeeded');
  expect(rebuildAction.type).toBe('metrics_rebuild');
  const runsAfter = await ownerApi.get(`/runs?${runParams.toString()}`);
  expect(runsAfter.response.status(), JSON.stringify(runsAfter.data)).toBe(200);
  expect(runsAfter.data.items).toEqual([]);
  const taskAfterRebuild = await ownerApi.get(`/tasks/${context.tasks.metric_cycle.id}`);
  expect(taskAfterRebuild.response.status(), JSON.stringify(taskAfterRebuild.data)).toBe(200);
  expect(taskAfterRebuild.data.version).toBe(taskBeforeRebuild.data.version);
  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  expect(t3.accepted_launches).toEqual([]);
  expect(t3.journal.some((entry) => entry.tool === 't3_thread_launch')).toBe(false);

  recordEvidence(
    'Projekt- und Gesamtmetriken zeigen einen nachvollziehbaren Verlauf; Abbruch und Wiedereröffnung bleiben getrennt, unbekannte Kosten bleiben null/unbekannt, und der öffentliche Rebuild verändert keine Tickets oder startet keine Agents.',
    `Für Projekt ${project.id} ergaben zwei tatsächliche Abschluss-Episoden 84 Stunden mediane Lead-Time, 60 Stunden mediane Cycle-Time und 24 Stunden Blockadezeit. Das global sichtbare offene Ticket aus Hausarchiv erhöhte nur den Gesamtwert der offenen Tickets auf 1; das abgebrochene Ticket in Falkenwarte erhöhte den Durchsatz nicht. API und UI zeigten Anbieterkosten mit value=null, currency=null und sample_size=0. Der Rebuild-Action ${rebuildAction.id} endete succeeded; Ticketversionen und Runliste blieben unverändert, T3 registrierte keinen Launch.`,
    { t3 },
  );
});
