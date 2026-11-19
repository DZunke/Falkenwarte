import { randomUUID } from 'node:crypto';
import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('A01 A21 dashboard opens a new human ticket in the selected active project before a board exists', async ({ ownerApi, ownerPage }) => {
  const suffix = randomUUID().slice(0, 8);
  const project = await ownerApi.createProject({ name: `Werkstatt ${suffix}` });
  await ownerApi.createProject({ name: `Bibliothek ${suffix}` });
  const archived = await ownerApi.createProject({ name: `Archiv ${suffix}` });
  const result = await ownerApi.post(`/projects/${archived.id}/archive`, { archived: true, reason: 'Abgeschlossener Projektbereich' }, { version: archived.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
  await ownerPage.goto('/#/dashboard');
  await ownerPage.getByRole('button', { name: 'Neues Ticket' }).click();
  const selector = ownerPage.getByRole('dialog', { name: 'Projekt für das neue Ticket' });
  await expect(selector.getByRole('link', { name: archived.name })).toHaveCount(0);
  await selector.getByRole('link', { name: project.name }).click();
  await expect(ownerPage).toHaveURL(new RegExp(project.id + '/board\\?new=1$'));
  const ticket = ownerPage.getByRole('dialog', { name: 'Ticket anlegen' });
  await ticket.getByLabel('Titel', { exact: true }).fill('Beschläge prüfen');
  await ticket.getByLabel('Beschreibung').fill('Alle vier Beschläge von Hand kontrollieren.');
  const creation = ownerPage.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/projects/' + project.id + '/tasks'));
  await ticket.getByRole('button', { name: 'Ticket anlegen', exact: true }).click();
  const receipt = await (await creation).json();
  await expect(ownerPage.getByRole('heading', { name: 'Beschläge prüfen' })).toBeVisible();
  const saved = await ownerApi.get('/tasks/' + receipt.task_id);
  expect(saved.response.status()).toBe(200);
  expect(saved.data).toMatchObject({ project_id: project.id, title: 'Beschläge prüfen', origin: 'manual' });
  recordEvidence('Ein manuelles Ticket lässt sich direkt aus der Übersicht im gewählten Projekt anlegen.', 'Chromium bot im Projektdialog aktive Projekte an, öffnete das neue Ticket ohne eingerichtetes Board und der öffentliche Ticketabruf bestätigte Projekt und Herkunft.');
});
