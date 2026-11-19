import { expect, recordEvidence, test } from '../support/fixtures.mjs';

const definitions = [
  { label: 'Kurzbeschreibung', key: 'qa.short_description', value_type: 'text', required: true },
  { label: 'Aufwand', key: 'qa.estimate', value_type: 'number', required: true },
  { label: 'Freigegeben', key: 'qa.approved', value_type: 'boolean', required: false },
  { label: 'Zieldatum', key: 'qa.target_date', value_type: 'date', required: true },
  { label: 'Statuswahl', key: 'qa.stage', value_type: 'choice', required: true, choices: ['Planung', 'Veröffentlicht'] },
  { label: 'Bereiche', key: 'qa.areas', value_type: 'multi_choice', required: false, choices: ['Web', 'API', 'Dokumentation'] },
  { label: 'Historische Notiz', key: 'qa.legacy_note', value_type: 'text', required: false },
];

async function defineField(ownerPage, definitionsDialog, field) {
  await definitionsDialog.getByRole('button', { name: 'Zusatzfeld anlegen', exact: true }).click();
  const editor = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: 'Zusatzfeld anlegen', exact: true }) });
  await editor.getByLabel('Feldname').fill(field.label);
  await editor.getByLabel('Schlüssel').fill(field.key);
  await editor.getByLabel('Feldtyp').click();
  await ownerPage.getByRole('option', { name: ({ text: 'Text', number: 'Zahl', boolean: 'Ja/Nein', date: 'Datum', choice: 'Auswahl', multi_choice: 'Mehrfachauswahl' })[field.value_type], exact: true }).click();
  if (field.required) await editor.getByRole('checkbox', { name: 'Erforderlich' }).check();
  if (field.choices) await editor.getByLabel('Auswahlen').fill(field.choices.join('\n'));
  await editor.getByRole('button', { name: 'Feld speichern', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(definitionsDialog.getByRole('heading', { name: field.label, exact: true })).toBeVisible();
}

test('project field definitions and typed values are available across ticket forms', async ({ ownerApi, ownerPage }) => {
  const project = await ownerApi.createProject({ name: 'Projektfelder im Ticketformular' });
  const board = await ownerApi.ensureDefaultBoard(project.id);

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByRole('button', { name: 'Zusatzfelder', exact: true }).click();
  const definitionsDialog = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: 'Projektfelder', exact: true }) });
  await expect(definitionsDialog.getByText('Noch keine Zusatzfelder angelegt.')).toBeVisible();
  for (const field of definitions) await defineField(ownerPage, definitionsDialog, field);
  await definitionsDialog.getByRole('button', { name: 'Schließen', exact: true }).click();

  await ownerPage.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  const createDialog = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: 'Ticket anlegen', exact: true }) });
  const createButton = createDialog.getByRole('button', { name: 'Ticket anlegen', exact: true });
  await expect(createDialog.getByLabel('Kurzbeschreibung')).toBeVisible();
  await expect(createButton).toBeDisabled();
  await createDialog.getByLabel('Titel').fill('Ticket mit typisierten Projektangaben');
  await createDialog.getByLabel('Kurzbeschreibung').fill('Im Browser eingegebener Wert');
  await createDialog.getByLabel('Aufwand').fill('2.5');
  await createDialog.getByLabel('Freigegeben').click();
  await ownerPage.getByRole('option', { name: 'Ja', exact: true }).click();
  await createDialog.getByLabel('Zieldatum').fill('2026-12-01');
  await createDialog.getByLabel('Statuswahl').click();
  await ownerPage.getByRole('option', { name: 'Veröffentlicht', exact: true }).click();
  await createDialog.getByRole('checkbox', { name: 'Web' }).check();
  await createDialog.getByRole('checkbox', { name: 'API' }).check();
  await createDialog.getByLabel('Historische Notiz').fill('Bleibt nach Deaktivierung erhalten');
  await expect(createButton).toBeEnabled();
  await createButton.click();

  const taskTitle = 'Ticket mit typisierten Projektangaben';
  await expect(ownerPage.getByRole('heading', { name: taskTitle, exact: true }).last()).toBeVisible();
  const boardView = await ownerApi.get(`/boards/${board.id}/view?limit_per_column=100`);
  expect(boardView.response.status(), JSON.stringify(boardView.data)).toBe(200);
  const createdCard = boardView.data.columns.flatMap((column) => column.items).find((task) => task.title === taskTitle);
  expect(createdCard).toBeTruthy();
  let currentTask = await ownerApi.get(`/tasks/${createdCard.id}`);
  expect(currentTask.response.status(), JSON.stringify(currentTask.data)).toBe(200);
  expect(currentTask.data.custom_fields).toEqual({
    'qa.short_description': { type: 'text', value: 'Im Browser eingegebener Wert' },
    'qa.estimate': { type: 'number', value: 2.5 },
    'qa.approved': { type: 'boolean', value: true },
    'qa.target_date': { type: 'date', value: '2026-12-01' },
    'qa.stage': { type: 'choice', value: 'Veröffentlicht' },
    'qa.areas': { type: 'multi_choice', value: ['Web', 'API'] },
    'qa.legacy_note': { type: 'text', value: 'Bleibt nach Deaktivierung erhalten' },
  });

  await ownerPage.keyboard.press('Escape');
  await ownerPage.getByRole('button', { name: 'Zusatzfelder', exact: true }).click();
  const updatedDefinitionsDialog = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: 'Projektfelder', exact: true }) });
  await updatedDefinitionsDialog.getByRole('button', { name: 'Feld bearbeiten: Historische Notiz', exact: true }).click();
  const editDefinitionDialog = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: 'Projektfeld bearbeiten', exact: true }) });
  await editDefinitionDialog.getByRole('checkbox', { name: 'Aktiv' }).uncheck();
  await editDefinitionDialog.getByRole('button', { name: 'Feld speichern', exact: true }).click();
  await expect(editDefinitionDialog).toBeHidden();
  await updatedDefinitionsDialog.getByRole('button', { name: 'Schließen', exact: true }).click();

  const taskCard = ownerPage.locator('[aria-roledescription="Ticketkarte"]').filter({ hasText: taskTitle });
  await taskCard.getByRole('button').first().click();
  const taskSheet = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: taskTitle, exact: true }) }).last();
  await taskSheet.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const editTaskDialog = ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('heading', { name: 'Ticket bearbeiten', exact: true }) });
  await expect(editTaskDialog.getByText('Historische Notiz', { exact: true })).toBeVisible();
  await expect(editTaskDialog.getByText('Bleibt nach Deaktivierung erhalten', { exact: true })).toBeVisible();
  await editTaskDialog.getByLabel('Titel').fill('Ticket mit geänderten Projektangaben');
  await editTaskDialog.getByLabel('Kurzbeschreibung').fill('Der aktive Wert wurde bearbeitet');
  await editTaskDialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(editTaskDialog).toBeHidden();

  currentTask = await ownerApi.get(`/tasks/${createdCard.id}`);
  expect(currentTask.response.status(), JSON.stringify(currentTask.data)).toBe(200);
  expect(currentTask.data.title).toBe('Ticket mit geänderten Projektangaben');
  expect(currentTask.data.custom_fields['qa.short_description']).toEqual({ type: 'text', value: 'Der aktive Wert wurde bearbeitet' });
  expect(currentTask.data.custom_fields['qa.legacy_note']).toEqual({ type: 'text', value: 'Bleibt nach Deaktivierung erhalten' });
  await expect(taskSheet.getByText('Historische Notiz', { exact: true })).toBeVisible();
  await expect(taskSheet.getByText('Bleibt nach Deaktivierung erhalten', { exact: true })).toBeVisible();

  recordEvidence(
    'Der Eigentümer kann typisierte Projektfelder definieren und ihre Werte direkt im normalen Ticketformular pflegen.',
    'Die UI legte alle sechs Feldtypen an, blockierte das Ticket bis die erforderlichen Werte gesetzt waren, speicherte die typisierten Antworten und erhielt eine vorhandene historische Notiz schreibgeschützt, nachdem das Feld deaktiviert und das Ticket erneut bearbeitet wurde.',
  );
});
