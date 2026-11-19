import { test, expect, recordEvidence } from '../support/fixtures.mjs';

function boardPayload(name, status, wipLimit = null) {
  const columns = Array.isArray(status) ? status : [status];
  return {
    name,
    config: {
      filter: {},
      sort: 'manual',
      group_by: 'status',
      swimlane_by: 'none',
      visible_fields: ['key', 'title', 'priority'],
    },
    columns: columns.map((column) => ({
      name: column.name,
      status_ids: column.status_ids ?? [column.id],
      default_drop_status_id: column.default_drop_status_id ?? column.id,
      wip_limit: wipLimit,
      wip_policy: 'block',
    })),
  };
}

async function createBoard(ownerApi, projectId, name, status, wipLimit = null) {
  const created = await ownerApi.post(`/projects/${projectId}/boards`, boardPayload(name, status, wipLimit));
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  return created.data;
}

async function readTask(ownerApi, taskId) {
  const response = await ownerApi.get(`/tasks/${taskId}`);
  expect(response.response.status(), JSON.stringify(response.data)).toBe(200);
  return response.data;
}

async function move(ownerApi, taskId, statusId, version, boardId, neighbors = {}) {
  return ownerApi.post(`/tasks/${taskId}/move`, {
    status_id: statusId,
    ...(boardId ? { board_id: boardId } : {}),
    ...neighbors,
  }, { version });
}

async function boardTaskOrder(ownerApi, board, columnIndex = 0) {
  const response = await ownerApi.get(`/boards/${board.id}/view?limit_per_column=100`);
  expect(response.response.status(), JSON.stringify(response.data)).toBe(200);
  const column = response.data.columns.find((entry) => entry.column_id === board.columns[columnIndex].id);
  expect(column, `Board ${board.id} did not return its configured column.`).toBeTruthy();
  return column.items.map((task) => task.id);
}

test('A07 the same tasks have independent order on two manual boards', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({ type: 'acceptance_ids', description: 'A07' });
  const project = await ownerApi.createProject({ name: 'Board-Reihenfolge A07' });
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const backlog = statuses.data.items.find((status) => status.category === 'backlog');
  const active = statuses.data.items.find((status) => status.category === 'active');
  expect(backlog).toBeTruthy();
  expect(active).toBeTruthy();

  const firstBoard = await createBoard(ownerApi, project.id, 'Board Eins', [backlog, active]);
  const secondBoard = await createBoard(ownerApi, project.id, 'Board Zwei', [backlog, active]);
  const tasks = [];
  for (const title of ['Unabhängige Karte A', 'Unabhängige Karte B', 'Unabhängige Karte C']) {
    tasks.push(await ownerApi.createTask(project.id, { title }));
  }

  for (const board of [firstBoard, secondBoard]) {
    for (const task of tasks) {
      const current = await readTask(ownerApi, task.id);
      const positioned = await move(ownerApi, task.id, backlog.id, current.version, board.id);
      expect(positioned.response.status(), JSON.stringify(positioned.data)).toBe(200);
    }
  }

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByRole('button', { name: 'Board Eins', exact: true }).click();
  const firstTask = await readTask(ownerApi, tasks[0].id);
  await ownerPage.getByRole('button', { name: `Aktionen für ${firstTask.key}` }).click();
  await ownerPage.getByRole('menuitem', { name: active.name, exact: true }).click();
  await expect.poll(async () => (await readTask(ownerApi, tasks[0].id)).status_id).toBe(active.id);

  const secondCard = ownerPage.locator('[aria-roledescription="Ticketkarte"]').filter({ hasText: 'Unabhängige Karte B' });
  const thirdCard = ownerPage.locator('[aria-roledescription="Ticketkarte"]').filter({ hasText: 'Unabhängige Karte C' });
  await expect(secondCard).toBeVisible();
  await expect(thirdCard).toBeVisible();
  await secondCard.dragTo(thirdCard);

  await expect.poll(async () => boardTaskOrder(ownerApi, firstBoard)).toEqual([tasks[2].id, tasks[1].id]);
  expect(await boardTaskOrder(ownerApi, firstBoard, 1)).toEqual([tasks[0].id]);
  expect(await boardTaskOrder(ownerApi, secondBoard)).toEqual([tasks[1].id, tasks[2].id]);
  expect(await boardTaskOrder(ownerApi, secondBoard, 1)).toEqual([tasks[0].id]);

  const groupedBoard = await createBoard(ownerApi, project.id, 'Board Sammelspalte', [{
    name: 'Alle Aufgaben',
    status_ids: [backlog.id, active.id],
    default_drop_status_id: active.id,
  }]);
  expect(groupedBoard.columns[0].status_ids).toEqual([backlog.id, active.id]);
  const groupedDrop = await ownerApi.createTask(project.id, { title: 'Sammelspalte mit Zielstatus', status_id: backlog.id });
  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: 'Board Sammelspalte', exact: true }).waitFor();
  await ownerPage.getByRole('button', { name: 'Board Sammelspalte', exact: true }).click();
  const groupedDropCard = ownerPage.locator('[aria-roledescription="Ticketkarte"]').filter({ hasText: 'Sammelspalte mit Zielstatus' });
  const groupedTargetCard = ownerPage.locator('[aria-roledescription="Ticketkarte"]').filter({ hasText: 'Unabhängige Karte C' });
  await expect(groupedDropCard).toBeVisible();
  await expect(groupedTargetCard).toBeVisible();
  await groupedDropCard.dragTo(groupedTargetCard);
  await expect.poll(async () => (await readTask(ownerApi, groupedDrop.id)).status_id).toBe(active.id);

  recordEvidence(
    'Dieselben Tickets erscheinen auf beiden Boards, während ihre manuelle Reihenfolge pro Board unabhängig bleibt.',
    `Die UI verschob Ticket ${tasks[0].id} in den aktiven Status, der auf beiden Boards sichtbar wurde. Ein UI-Drag ordnete die übrigen Karten auf Board Eins zu C, B um; Board Zwei behielt B, C. Ein Drop in die Sammelspalte setzte ${groupedDrop.id} entsprechend ihrer Konfiguration in den aktiven Status.`,
  );
});

test('A06 restoring a task revision creates a new revision with its reason', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({ type: 'acceptance_ids', description: 'A06' });
  const project = await ownerApi.createProject({ name: 'Historie und Wiederherstellung A06' });
  await ownerApi.ensureDefaultBoard(project.id);
  const task = await ownerApi.createTask(project.id, { title: 'Ursprünglicher Titel' });
  const original = await readTask(ownerApi, task.id);
  const changed = await ownerApi.patch(`/tasks/${task.id}`, { title: 'Aktueller Titel' }, { version: original.version });
  expect(changed.response.status(), JSON.stringify(changed.data)).toBe(200);

  const beforeHistory = await ownerApi.get(`/history?resource_type=task&resource_id=${task.id}&limit=100`);
  expect(beforeHistory.response.status(), JSON.stringify(beforeHistory.data)).toBe(200);
  const originalRevision = beforeHistory.data.items.find((revision) => revision.summary === 'task.created');
  expect(originalRevision?.restorable).toBe(true);

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByText('Aktueller Titel', { exact: true }).click();
  await ownerPage.getByRole('tab', { name: 'Verlauf' }).click();
  const originalEntry = ownerPage.getByText(originalRevision.summary, { exact: true }).locator('xpath=../..');
  await originalEntry.getByRole('button', { name: 'Wiederherstellen' }).click();
  const reason = 'Der freigegebene Ausgangsstand soll als neue Revision wiederhergestellt werden.';
  await ownerPage.getByLabel('Grund', { exact: true }).fill(reason);
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Wiederherstellen', exact: true }).click();

  await expect.poll(async () => (await readTask(ownerApi, task.id)).title).toBe('Ursprünglicher Titel');
  await expect(ownerPage.getByText(`Grund: ${reason}`, { exact: true })).toBeVisible();
  const afterHistory = await ownerApi.get(`/history?resource_type=task&resource_id=${task.id}&limit=100`);
  expect(afterHistory.response.status(), JSON.stringify(afterHistory.data)).toBe(200);
  expect(afterHistory.data.items.some((revision) => revision.id === originalRevision.id)).toBe(true);
  const restoredRevision = afterHistory.data.items.find((revision) => revision.reason === reason);
  expect(restoredRevision).toBeTruthy();
  expect(restoredRevision.id).not.toBe(originalRevision.id);
  expect(restoredRevision.resource.id).toBe(task.id);
  expect(Object.keys(restoredRevision).some((key) => key.startsWith('_'))).toBe(false);

  recordEvidence(
    'Die Wiederherstellung erhält die alte Revision, erstellt eine neue Revision mit Akteur und Ursache und zeigt den Grund im Ticketverlauf.',
    `Die UI stellte den ursprünglichen Titel wieder her. Die alte Revision ${originalRevision.id} blieb erhalten; die neue Revision ${restoredRevision.id} zeigte den Wiederherstellungsgrund. Die öffentliche Revision enthielt keine internen Snapshotfelder.`,
  );
});

test('A08 simultaneous moves respect project WIP and dependency cycles are rejected', async ({ ownerApi }) => {
  test.info().annotations.push({ type: 'acceptance_ids', description: 'A08' });
  const project = await ownerApi.createProject({ name: 'WIP-Grenze A08' });
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const backlog = statuses.data.items.find((status) => status.category === 'backlog');
  const active = statuses.data.items.find((status) => status.category === 'active');
  expect(backlog).toBeTruthy();
  expect(active).toBeTruthy();
  const board = await createBoard(ownerApi, project.id, 'Harte WIP-Grenze', active, 1);
  const first = await ownerApi.createTask(project.id, { title: 'Gleichzeitige Karte Eins' });
  const second = await ownerApi.createTask(project.id, { title: 'Gleichzeitige Karte Zwei' });
  const firstState = await readTask(ownerApi, first.id);
  const secondState = await readTask(ownerApi, second.id);

  const results = await Promise.all([
    move(ownerApi, first.id, active.id, firstState.version),
    move(ownerApi, second.id, active.id, secondState.version),
  ]);
  const statusesObserved = results.map((result) => result.response.status()).sort();
  expect(statusesObserved).toEqual([200, 409]);

  const boardResponse = await ownerApi.get(`/boards/${board.id}/view?limit_per_column=100`);
  expect(boardResponse.response.status(), JSON.stringify(boardResponse.data)).toBe(200);
  const activeColumn = boardResponse.data.columns.find((column) => column.column_id === board.columns[0].id);
  expect(activeColumn.items).toHaveLength(1);
  const winnerIndex = results.findIndex((result) => result.response.status() === 200);
  const winnerId = [first.id, second.id][winnerIndex];
  const loserId = [first.id, second.id][1 - winnerIndex];

  const loser = await readTask(ownerApi, loserId);
  const bypassAttempt = await move(ownerApi, loserId, active.id, loser.version);
  expect(bypassAttempt.response.status(), JSON.stringify(bypassAttempt.data)).toBe(409);
  expect((await readTask(ownerApi, winnerId)).status_category).toBe('active');
  expect((await readTask(ownerApi, loserId)).status_category).toBe('backlog');

  const stale = await move(ownerApi, winnerId, backlog.id, [firstState, secondState][winnerIndex].version);
  expect(stale.response.status(), JSON.stringify(stale.data)).toBe(412);

  const dependency = await ownerApi.put(`/tasks/${first.id}/dependencies`, { depends_on_task_ids: [second.id] }, { version: (await readTask(ownerApi, first.id)).version });
  expect(dependency.response.status(), JSON.stringify(dependency.data)).toBe(200);
  const cycle = await ownerApi.put(`/tasks/${second.id}/dependencies`, { depends_on_task_ids: [first.id] }, { version: (await readTask(ownerApi, second.id)).version });
  expect(cycle.response.status(), JSON.stringify(cycle.data)).toBe(409);

  recordEvidence(
    'Zwei gleichzeitige Änderungen können das harte Projekt-WIP nicht überschreiten; der Versionskonflikt und ein Abhängigkeitszyklus werden abgewiesen.',
    `Zwei öffentliche Move-Aufrufe lieferten HTTP ${statusesObserved.join(' und ')}. Board ${board.id} zeigte eine aktive Karte; ein weiterer Move ohne board_id erhielt HTTP 409, ein veralteter If-Match-Versuch HTTP 412 und der zweite Schritt des Abhängigkeitszyklus HTTP ${cycle.response.status()}.`,
  );
});

test('A14 a stale Ticket Sheet save reports the conflict and loads the latest server version', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({ type: 'acceptance_ids', description: 'A14' });
  const project = await ownerApi.createProject({ name: 'Ticketkonflikt A14' });
  await ownerApi.ensureDefaultBoard(project.id);
  const task = await ownerApi.createTask(project.id, {
    title: 'Noch nicht extern geändert',
    description: 'Ein offenes Ticket-Sheet soll einen echten Versionskonflikt erkennen.',
  });

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByText('Noch nicht extern geändert', { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Noch nicht extern geändert' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Bearbeiten' }).click();
  await ownerPage.getByLabel('Titel', { exact: true }).fill('Veralteter Formularentwurf');

  const original = await readTask(ownerApi, task.id);
  const parallel = await ownerApi.patch(`/tasks/${task.id}`, { title: 'Aktueller Stand vom zweiten Client' }, { version: original.version });
  expect(parallel.response.status(), JSON.stringify(parallel.data)).toBe(200);

  await ownerPage.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(ownerPage.getByRole('alert')).toContainText('Der aktuelle Ticketstand wurde neu geladen');
  await expect.poll(async () => (await readTask(ownerApi, task.id)).title).toBe('Aktueller Stand vom zweiten Client');
  await ownerPage.getByRole('button', { name: 'Formular mit aktuellem Stand laden' }).click();
  await expect(ownerPage.getByLabel('Titel', { exact: true })).toHaveValue('Aktueller Stand vom zweiten Client');
  expect((await readTask(ownerApi, task.id)).title).toBe('Aktueller Stand vom zweiten Client');

  recordEvidence(
    'Das Ticket-Sheet zeigt einen verständlichen Konflikt, übernimmt den aktuellen Serverstand und speichert keinen veralteten Entwurf.',
    `Ein paralleler JSON-Client aktualisierte Ticket ${task.id}. Der sichtbare Sheet-Schreibversuch blieb als Entwurf erhalten, zeigte die Konflikterklärung und lud auf ausdrückliche Auswahl den aktuellen Titel; die öffentliche API behielt diesen Titel.`,
  );
});
