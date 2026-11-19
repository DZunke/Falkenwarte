import { randomUUID } from 'node:crypto';
import { test, expect, recordEvidence } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

test('A01 A21 owner creates a project and completes a ticket in the browser', async ({ ownerPage }) => {
  test.info().annotations.push({ type: 'expected', description: 'Der Eigentümer legt Projekt, Board und Ticket in der Oberfläche an, bearbeitet die Aufgabe, bestätigt eine Meldung und schließt sie ohne Agentenlauf ab.' });
  const projectSuffix = randomUUID().slice(0, 8);
  await ownerPage.goto('/#/projects');
  await expect(ownerPage.getByRole('heading', { name: 'Projekte' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Projekt anlegen' }).first().click();
  await ownerPage.getByLabel('Name', { exact: true }).fill(`Browser Bedienbarkeit ${projectSuffix}`);
  await ownerPage.getByLabel('Kurzname').fill(`browser-bedienbarkeit-${projectSuffix}`);
  await ownerPage.getByLabel('Beschreibung').fill('Projekt und Ticket vollständig in der Falkenwarte-Oberfläche verwalten.');
  await ownerPage.getByRole('button', { name: 'Projekt anlegen', exact: true }).last().click();

  await expect(ownerPage).toHaveURL(/#\/project\/[0-9a-f-]+\/board$/i);
  await expect(ownerPage.getByRole('heading', { name: `Browser Bedienbarkeit ${projectSuffix}` })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Board einrichten' }).first().click();
  await ownerPage.getByRole('button', { name: 'Board erstellen', exact: true }).click();
  await expect(ownerPage.getByRole('button', { name: 'Neues Ticket' })).toBeEnabled();

  await ownerPage.getByRole('button', { name: 'Neues Ticket' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Ticket anlegen' })).toBeVisible();
  await ownerPage.getByLabel('Titel', { exact: true }).fill('Ein menschlicher Browserablauf');
  await ownerPage.getByLabel('Beschreibung', { exact: true }).fill('Die Aufgabe wird ohne Agent und ohne externen KI-Zugang erledigt.');
  await ownerPage.getByLabel('Erfolgskriterien').fill('Die Änderung wird im Board sichtbar.');
  const createdResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'POST' && /\/projects\/[^/]+\/tasks$/.test(new URL(response.url()).pathname));
  await ownerPage.getByRole('button', { name: 'Ticket anlegen', exact: true }).last().click();
  const createResponse = await createdResponsePromise;
  expect(createResponse.status()).toBe(201);
  const receipt = await createResponse.json();
  const taskId = receipt.task_id;
  expect(taskId).toBeTruthy();
  await expect(ownerPage.getByRole('heading', { name: 'Ein menschlicher Browserablauf' })).toBeVisible();
  await expect(ownerPage.getByText('Die Änderung wird im Board sichtbar.', { exact: true })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Bearbeiten' }).click();
  await ownerPage.getByLabel('Titel', { exact: true }).last().fill('Ein bearbeiteter Browserablauf');
  await ownerPage.getByLabel('Beschreibung', { exact: true }).last().fill('Die Änderung wurde von Hand im Ticket-Sheet gespeichert.');
  await ownerPage.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Ein bearbeiteter Browserablauf' })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Meldung hinzufügen' }).click();
  await ownerPage.getByLabel('Bezeichnung').fill('Manuelle Sichtprüfung');
  await ownerPage.getByLabel('Meldung', { exact: true }).fill('Das aktuelle Projekt bleibt nach dem Wechsel sichtbar.');
  await ownerPage.getByRole('checkbox').click();
  await ownerPage.getByRole('button', { name: 'Meldung speichern' }).click();
  await expect(ownerPage.getByRole('button', { name: 'Bestätigen' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Bestätigen' }).click();
  await ownerPage.getByLabel('Begründung').fill('Die gemeldete Darstellung entspricht dem vereinbarten Kriterium.');
  await ownerPage.getByRole('button', { name: 'Fachlich bestätigen' }).click();
  await expect(ownerPage.getByText('Menschlich bestätigt')).toBeVisible();

  await ownerPage.getByRole('combobox').first().click();
  await ownerPage.getByRole('option', { name: 'Erledigt', exact: true }).click();
  await expect.poll(async () => {
    const response = await ownerPage.request.get(`${apiPrefix}/tasks/${taskId}`);
    if (!response.ok()) return null;
    return (await response.json()).status_category;
  }, { timeout: 15_000 }).toBe('done');

  const finalTaskResponse = await ownerPage.request.get(`${apiPrefix}/tasks/${taskId}`);
  const finalTask = await finalTaskResponse.json();
  expect(finalTask.title).toBe('Ein bearbeiteter Browserablauf');
  expect(finalTask.origin).toBe('manual');
  const historyResponse = await ownerPage.request.get(`${apiPrefix}/history?resource_type=task&resource_id=${taskId}&limit=100`);
  expect(historyResponse.status()).toBe(200);
  const history = await historyResponse.json();
  expect(history.items.length).toBeGreaterThanOrEqual(3);

  recordEvidence(
    'Der Eigentümer kann Projekt, Board und Ticket ohne Agentenlauf über die Oberfläche anlegen, bearbeiten und abschließen. Änderungen bleiben im Ticketverlauf nachvollziehbar.',
    `Chromium erstellte Projekt Browser Bedienbarkeit ${projectSuffix}, richtete das Board ein, legte Ticket ${taskId} mit einem Kriterium an, änderte Titel und Beschreibung über das Ticket-Sheet, registrierte eine manuelle Meldung, bestätigte das Kriterium mit Begründung und setzte den Status über die sichtbare Auswahl auf done. Die öffentliche API bestätigte origin=manual und ${history.items.length} Verlaufsrevisionen.`,
  );
});
