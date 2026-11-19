import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, recordEvidence } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

async function expectWithinMobileViewport(locator, label) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  expect(bounds, `${label} has no rendered bounds`).toBeTruthy();
  expect(bounds.x, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width, `${label} extends past the right edge`).toBeLessThanOrEqual(391);
}

test('A01 A21 owner creates a project and completes a ticket in the browser', async ({ ownerPage }) => {
  test.info().annotations.push({ type: 'expected', description: 'Der Eigentümer legt Projekt, Board, Label und Ticket bei mobiler Breite und 200 Prozent Grundschrift an, bearbeitet Links und Ticket, nutzt Tastatursteuerung und schließt das Ticket ohne Agentenlauf ab.' });
  const projectSuffix = randomUUID().slice(0, 8);
  const labelName = `Bedienbarkeit ${projectSuffix}`;
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto('/#/projects');
  await ownerPage.addStyleTag({ content: ':root { font-size: 200% !important; }' });
  expect(await ownerPage.locator('html').evaluate((element) => getComputedStyle(element).fontSize)).toBe('32px');
  await expect(ownerPage.locator('#main-content').getByRole('heading', { name: 'Projekte' })).toBeVisible();
  const createProjectButton = ownerPage.getByRole('button', { name: 'Projekt anlegen' }).first();
  await expectWithinMobileViewport(createProjectButton, 'Project creation button');
  await createProjectButton.focus();
  await ownerPage.keyboard.press('Enter');
  await expectWithinMobileViewport(ownerPage.getByRole('dialog'), 'Project creation dialog');
  await ownerPage.getByLabel('Name', { exact: true }).fill(`Browser Bedienbarkeit ${projectSuffix}`);
  await ownerPage.getByLabel('Kurzname').fill(`browser-bedienbarkeit-${projectSuffix}`);
  await ownerPage.getByLabel('Beschreibung').fill('Projekt und Ticket vollständig in der Falkenwarte-Oberfläche verwalten.');
  const projectSubmit = ownerPage.getByRole('button', { name: 'Projekt anlegen', exact: true }).last();
  await projectSubmit.focus();
  await ownerPage.keyboard.press('Enter');

  await expect(ownerPage).toHaveURL(/#\/project\/[0-9a-f-]+\/board$/i);
  const projectId = new URL(ownerPage.url()).hash.match(/^#\/project\/([^/]+)\/board$/i)?.[1];
  expect(projectId).toBeTruthy();
  await expectWithinMobileViewport(ownerPage.locator('#main-content').getByRole('heading', { name: `Browser Bedienbarkeit ${projectSuffix}` }), 'Project heading');
  const setupBoard = ownerPage.getByRole('button', { name: 'Board einrichten' }).first();
  await expectWithinMobileViewport(setupBoard, 'Board setup button');
  await setupBoard.focus();
  await ownerPage.keyboard.press('Enter');
  await expectWithinMobileViewport(ownerPage.getByRole('dialog'), 'Board setup dialog');
  await ownerPage.getByRole('button', { name: 'Board erstellen', exact: true }).click();
  const newTicketButton = ownerPage.getByRole('button', { name: 'Neues Ticket' });
  await expect(newTicketButton).toBeEnabled();
  await expectWithinMobileViewport(newTicketButton, 'New ticket button');

  await ownerPage.goto('/#/labels');
  await expect(ownerPage.locator('#main-content').getByRole('heading', { name: 'Labels' })).toBeVisible();
  const projectPicker = ownerPage.getByRole('combobox').first();
  await projectPicker.click();
  await ownerPage.getByRole('option', { name: `Browser Bedienbarkeit ${projectSuffix}`, exact: true }).click();
  const labelCreateButton = ownerPage.getByRole('button', { name: 'Label anlegen' });
  await expectWithinMobileViewport(labelCreateButton, 'Label creation button');
  await labelCreateButton.click();
  await ownerPage.getByLabel('Name', { exact: true }).fill(labelName);
  await ownerPage.getByLabel('Stabiler Schlüssel').fill(`bedienbarkeit-${projectSuffix}`);
  await ownerPage.getByLabel('Beschreibung').fill('Themenlabel für den mobilen Browserablauf.');
  await ownerPage.getByRole('button', { name: 'Speichern', exact: true }).last().click();
  await expect(ownerPage.getByText(labelName, { exact: true })).toBeVisible();
  await ownerPage.getByRole('button', { name: `${labelName} bearbeiten` }).click();
  await ownerPage.getByLabel('Name', { exact: true }).fill(`${labelName} geprüft`);
  await ownerPage.getByLabel('Beschreibung').fill('Geprüftes Themenlabel für den mobilen Browserablauf.');
  await ownerPage.getByRole('button', { name: 'Speichern', exact: true }).last().click();
  await expect(ownerPage.getByText(`${labelName} geprüft`, { exact: true })).toBeVisible();

  await ownerPage.goto(`/#/project/${projectId}/board`);

  await newTicketButton.focus();
  await ownerPage.keyboard.press('Enter');
  await expect(ownerPage.getByRole('heading', { name: 'Ticket anlegen' })).toBeVisible();
  await expectWithinMobileViewport(ownerPage.getByRole('dialog'), 'New ticket dialog');
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
  await expectWithinMobileViewport(ownerPage.getByRole('heading', { name: 'Ein menschlicher Browserablauf' }), 'Ticket heading');
  await expect(ownerPage.getByRole('heading', { name: 'Ein menschlicher Browserablauf' })).toBeVisible();
  await expect(ownerPage.getByText('Die Änderung wird im Board sichtbar.', { exact: true })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Link hinzufügen' }).click();
  await ownerPage.getByLabel('Sammlung', { exact: true }).fill('Browserablauf');
  await ownerPage.getByLabel('Titel', { exact: true }).fill('Bedienbarkeitsnotiz');
  await ownerPage.getByLabel('URL', { exact: true }).fill('https://example.org/falkenwarte-ui');
  await ownerPage.getByRole('button', { name: 'Link registrieren' }).click();
  await expect(ownerPage.getByText('Bedienbarkeitsnotiz', { exact: true })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Link bearbeiten' }).click();
  await ownerPage.getByLabel('Titel', { exact: true }).fill('Geprüfte Bedienbarkeitsnotiz');
  await ownerPage.getByLabel('URL', { exact: true }).fill('https://example.org/falkenwarte-ui-reviewed');
  await ownerPage.getByRole('button', { name: 'Link speichern' }).click();
  await expect(ownerPage.getByText('Geprüfte Bedienbarkeitsnotiz', { exact: true })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await ownerPage.getByLabel('Titel', { exact: true }).last().fill('Ein bearbeiteter Browserablauf');
  await ownerPage.getByLabel('Beschreibung', { exact: true }).last().fill('Die Änderung wurde von Hand im Ticket-Sheet gespeichert.');
  await ownerPage.getByRole('checkbox', { name: `${labelName} geprüft` }).check();
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

  await ownerPage.keyboard.press('Escape');
  await expectWithinMobileViewport(newTicketButton, 'New ticket button after closing sheet');
  await expect(ownerPage.getByText('Ein bearbeiteter Browserablauf', { exact: true })).toBeVisible();
  const taskFilter = ownerPage.getByRole('textbox', { name: 'Tickets filtern' });
  await taskFilter.fill('Ein bearbeiteter Browserablauf');
  await expect(ownerPage.getByText('Ein bearbeiteter Browserablauf', { exact: true })).toBeVisible();
  await taskFilter.fill('Dieser Tickettext existiert nicht');
  await expect(ownerPage.getByText('Ein bearbeiteter Browserablauf', { exact: true })).toHaveCount(0);
  await taskFilter.clear();
  await expect(ownerPage.getByText('Ein bearbeiteter Browserablauf', { exact: true })).toBeVisible();
  await ownerPage.locator('.falkenwarte-scrollbar').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(ownerPage.getByRole('heading', { name: 'Erledigt', exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Ein bearbeiteter Browserablauf', { exact: true })).toBeVisible();
  const publicResults = process.env.FALKENWARTE_QA_RESULTS_DIR ?? path.resolve('tests/e2e/results');
  const publicDirectory = path.join(publicResults, 'public');
  await mkdir(publicDirectory, { recursive: true });
  const boardScreenshot = path.join(publicDirectory, 'board.png');
  await ownerPage.screenshot({ path: boardScreenshot, fullPage: true });

  recordEvidence(
    'Der Eigentümer kann Projekt, Board, Label, Ticket und Link ohne Agentenlauf über die Oberfläche anlegen, bearbeiten, filtern und abschließen. Die Oberfläche bleibt bei mobiler Breite und 200 Prozent Grundschrift bedienbar.',
    `Chromium mit 390×844 Pixeln und 200 Prozent Grundschrift erstellte Projekt Browser Bedienbarkeit ${projectSuffix}, richtete das Board ein, erstellte und bearbeitete das Label ${labelName} geprüft, legte Ticket ${taskId} mit einem Kriterium an, registrierte und bearbeitete eine passive HTTPS-Referenz, änderte Titel/Beschreibung und Labelzuordnung, filterte das Board, registrierte eine manuelle Meldung, bestätigte das Kriterium mit Begründung und setzte den Status auf done. Tastatur-Enter öffnete Projekt-, Board- und Ticketdialoge; Escape schloss das Ticket-Sheet. Die öffentliche API bestätigte origin=manual und ${history.items.length} Verlaufsrevisionen. Ein unkritischer Browserboard-Screenshot liegt unter public/board.png.`,
  );
});
