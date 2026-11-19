import { randomUUID } from 'node:crypto';
import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('the task execution tab explains blockers when no T3 runtime is configured', async ({ ownerApi, ownerPage }) => {
  const projectSuffix = randomUUID().slice(0, 8);
  const project = await ownerApi.createProject({ name: `Ausführung ohne T3 ${projectSuffix}` });
  const board = await ownerApi.ensureDefaultBoard(project.id);
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const backlog = statuses.data.items.find((status) => status.category === 'backlog');
  expect(backlog).toBeTruthy();

  const title = 'Ausführung ohne T3-Auftrag prüfen';
  const task = await ownerApi.createTask(project.id, { title, status_id: backlog.id });
  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByRole('button', { name: board.name, exact: true }).click();
  await ownerPage.getByText(title, { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: title })).toBeVisible();
  await ownerPage.getByRole('tab', { name: 'Ausführung' }).click();

  const executionPanel = ownerPage.getByRole('tabpanel', { name: 'Ausführung' });
  await expect(executionPanel).toContainText('Startbedingungen');
  await expect(executionPanel).toContainText('Verschiebe das Ticket zuerst in einen bearbeitbaren Status.');
  await expect(executionPanel).toContainText('Für dieses Projekt ist kein Rollenprofil freigegeben.');
  await expect(executionPanel).toContainText('Für dieses Projekt ist kein aktiver Workflow verfügbar.');
  await expect(executionPanel.getByRole('button', { name: 'Einzellauf anfordern' })).toBeDisabled();
  await expect(executionPanel.getByRole('button', { name: 'Workflow starten' })).toHaveCount(0);
  await expect.poll(async () => (await ownerApi.get(`/tasks/${task.id}`)).data.status_category).toBe('backlog');

  recordEvidence(
    'Die Ausführungsansicht zeigt Startblockaden und erlaubt keinen versehentlichen Start ohne startbereiten Status, Rollenprofil oder T3-Konfiguration.',
    `Das Ticket ${task.id} blieb im Status backlog. Der Browser zeigte die Blockade, das fehlende Rollenprofil und den fehlenden aktiven Workflow; beide Startschaltflächen waren deaktiviert. Es wurde kein T3-Auftrag angefordert.`,
  );
});
