import { test, expect, recordEvidence } from '../support/fixtures.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('A19 production container boots and preserves human tickets across restart', async ({ ownerApi, ownerPage }) => {
  const stored = path.join(process.env.FALKENWARTE_QA_RESULTS_DIR, 'production-task.json');
  if (process.env.FALKENWARTE_VERIFY_RESTART === '1') {
    const { taskId, projectId } = JSON.parse(await readFile(stored, 'utf8'));
    const read = await ownerApi.get('/tasks/' + taskId);
    expect(read.response.status()).toBe(200);
    expect(read.data.title).toBe('Manuell aktualisiertes Ticket');
    await ownerPage.goto('/#/project/' + projectId + '/board');
    await expect(ownerPage.getByText(read.data.title, { exact: true })).toBeVisible();
    recordEvidence('Ticket und Projektboard bleiben beim Neustart erhalten.', 'Nach dem Stoppen und Starten des einzigen Produktcontainers waren dieselbe Ticket-ID und die gespeicherte Änderung im Browser und über die API lesbar.');
    return;
  }
  const health = await ownerApi.get('/health');
  expect(health.data.status).toBe('ok');
  const connections = await ownerApi.get('/connections');
  expect(connections.data.items).toEqual([]);
  const project = await ownerApi.createProject({ name: 'Manuelle Arbeit' });
  await ownerApi.ensureDefaultBoard(project.id);
  const task = await ownerApi.createTask(project.id, { title: 'Ohne externe Konfiguration' });
  const read = await ownerApi.get('/tasks/' + task.id);
  const updated = await ownerApi.patch('/tasks/' + task.id, { title: 'Manuell aktualisiertes Ticket' }, {
    version: read.data.version, headers: { 'X-Test-Failpoint': 'before_commit' },
  });
  expect(updated.response.status()).toBe(200);
  await ownerPage.goto('/#/project/' + project.id + '/board');
  await expect(ownerPage.getByText(updated.data.title, { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
  await ownerPage.getByText(updated.data.title, { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: updated.data.title })).toBeVisible();
  await writeFile(stored, JSON.stringify({ taskId: task.id, projectId: project.id }));
  recordEvidence('Der Produktcontainer bedient den Browser ohne T3-/Decisions-Zugänge und ignoriert den QA-Fehlerpunkt.', 'Ein menschlich erstelltes Ticket war im privaten Live-Board sichtbar. Die Produktions-App akzeptierte die Änderung trotz Testheader und hatte keine eingerichtete T3-Verbindung.');
});
