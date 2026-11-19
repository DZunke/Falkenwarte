import { request as playwrightRequest } from '@playwright/test';
import { test, expect, createAgentSimulator, recordEvidence } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

test('A01 A04 A06 A14 A21 project, ticket, history and browser board', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({ type: 'expected', description: 'Projektidentität und Archivierung bleiben getrennt; Ticketänderung, Konflikt, Wiederherstellung und Boarddarstellung stimmen über JSON und Browser überein.' });
  const project = await ownerApi.createProject({ name: 'Browser QA Falkenwarte', color: '#B8914C', icon: 'bird' });
  const otherProject = await ownerApi.createProject({ name: 'Browser QA Hausarchiv', color: '#7C97B6', icon: 'archive' });
  await ownerApi.ensureDefaultBoard(project.id);
  const initialTitle = 'Filterwechsel zeigt noch den alten Projektfilter';
  const task = await ownerApi.createTask(project.id, {
    title: initialTitle,
    description: 'Ein Browser-E2E-Ticket mit einer vollständigen menschlichen Bearbeitungsspur.',
    criteria: [{ text: 'Der sichtbare Projektfilter entspricht der Auswahl.', is_required: true }],
  });

  const firstRead = await ownerApi.get(`/tasks/${task.id}`);
  expect(firstRead.response.status(), JSON.stringify(firstRead.data)).toBe(200);
  const initial = firstRead.data;
  const updated = await ownerApi.patch(`/tasks/${task.id}`, { title: 'Projektfilter zeigt die aktuelle Auswahl' }, { version: initial.version });
  expect(updated.response.status(), JSON.stringify(updated.data)).toBe(200);
  expect(updated.data.title).toBe('Projektfilter zeigt die aktuelle Auswahl');

  const stale = await ownerApi.patch(`/tasks/${task.id}`, { title: 'Veralteter Schreibversuch' }, { version: initial.version });
  expect(stale.response.status(), JSON.stringify(stale.data)).toBe(412);
  const afterConflict = await ownerApi.get(`/tasks/${task.id}`);
  expect(afterConflict.response.status()).toBe(200);
  expect(afterConflict.data.title).toBe('Projektfilter zeigt die aktuelle Auswahl');

  const failpoint = await ownerApi.patch(`/tasks/${task.id}`, { title: 'Änderung vor Commit verworfen' }, {
    version: afterConflict.data.version,
    headers: { 'X-Test-Failpoint': 'before_commit' },
  });
  expect(failpoint.response.status()).toBeGreaterThanOrEqual(500);
  const afterFailure = await ownerApi.get(`/tasks/${task.id}`);
  expect(afterFailure.data.version).toBe(afterConflict.data.version);
  expect(afterFailure.data.title).toBe(afterConflict.data.title);

  const history = await ownerApi.get(`/history?resource_type=task&resource_id=${encodeURIComponent(task.id)}&limit=100`);
  expect(history.response.status(), JSON.stringify(history.data)).toBe(200);
  expect(history.data.items.length).toBeGreaterThanOrEqual(2);
  expect(history.data.items.every((revision) => revision.project_id === project.id)).toBe(true);
  const oldestRevision = [...history.data.items].sort((left, right) => left.recorded_at.localeCompare(right.recorded_at))[0];
  const restore = await ownerApi.post(`/history/${oldestRevision.id}/restore`, { reason: 'QA prüft die freigegebene Wiederherstellung.' }, {
    version: afterFailure.data.version,
  });
  expect([200, 202], JSON.stringify(restore.data)).toContain(restore.response.status());
  await expect.poll(async () => (await ownerApi.get(`/tasks/${task.id}`)).data.title, { timeout: 20_000 }).toBe(initialTitle);
  const restored = await ownerApi.get(`/tasks/${task.id}`);
  expect(restored.response.status()).toBe(200);
  expect(restored.data.title).toBe(initialTitle);
  expect(restored.data.version).toBeGreaterThan(afterFailure.data.version);

  const projectView = await ownerApi.get(`/projects/${project.id}`);
  expect(projectView.response.status()).toBe(200);
  const projectRename = await ownerApi.patch(`/projects/${project.id}`, {
    name: 'Browser QA Falkenwarte aktualisiert', color: '#A77B36', icon_key: 'bird',
  }, { version: projectView.data.version });
  expect(projectRename.response.status(), JSON.stringify(projectRename.data)).toBe(200);

  const secondProject = await ownerApi.get(`/projects/${otherProject.id}`);
  const archive = await ownerApi.post(`/projects/${otherProject.id}/archive`, {
    archived: true,
    reason: 'Projekttrennung und Archivierung in der Abnahme prüfen.',
  }, { version: secondProject.data.version });
  expect(archive.response.status(), JSON.stringify(archive.data)).toBe(200);
  const archivedProject = await ownerApi.get(`/projects/${otherProject.id}`);
  expect(archivedProject.data.archived).toBe(true);

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await expect(ownerPage.getByRole('heading', { name: 'Browser QA Falkenwarte aktualisiert' })).toBeVisible();
  await expect(ownerPage.getByText(initialTitle, { exact: true })).toBeVisible();
  await ownerPage.getByText(initialTitle, { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: initialTitle })).toBeVisible();

  recordEvidence(
    'Projekte bleiben getrennt, Projektidentität wird geändert und archiviert, Ticketrevisionen sind atomar und wiederherstellbar, veraltete Änderungen zeigen einen Konflikt, und der Browser zeigt das Ticket im Projektboard.',
    `Projekt ${project.id} wurde aktualisiert; ${otherProject.id} wurde archiviert; Task ${task.id} wurde über die echte JSON-API geändert, ein veralteter Schreibversuch erhielt HTTP 412, ein Commit-Failpoint ließ Version ${afterFailure.data.version} unverändert, History enthielt ${history.data.items.length} Revisionen und die Wiederherstellung erzeugte Version ${restored.data.version}. Das Browserboard und Ticket-Sheet zeigten den wiederhergestellten Titel.`,
  );
});

test('A02 A13 project-scoped JSON and MCP principals share access rules', async ({ ownerApi, baseURL }) => {
  test.info().annotations.push({ type: 'expected', description: 'Ein projektgebundener Principal erhält denselben Ressourcenzugriff über JSON und MCP, und fremde Projekte bleiben auf beiden Wegen gesperrt.' });
  const projectA = await ownerApi.createProject({ name: 'Principal Projekt A', color: '#B8914C' });
  const projectB = await ownerApi.createProject({ name: 'Principal Projekt B', color: '#7C97B6' });
  const taskA = await ownerApi.createTask(projectA.id, { title: 'Erlaubtes Agententicket' });
  const taskB = await ownerApi.createTask(projectB.id, { title: 'Fremdes Agententicket' });
  const issued = await ownerApi.createTechnicalToken({
    label: 'QA Principal Projekt A',
    projectIds: [projectA.id],
    capabilities: ['projects.read', 'tasks.read'],
  });

  const agentContext = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${issued.token}`, Accept: 'application/json' },
  });
  const agent = await createAgentSimulator(baseURL, issued.token);
  try {
    const jsonAllowed = await agentContext.get(`${apiPrefix}/tasks/${taskA.id}`);
    expect(jsonAllowed.status()).toBe(200);
    expect((await jsonAllowed.json()).title).toBe('Erlaubtes Agententicket');

    const jsonDenied = await agentContext.get(`${apiPrefix}/tasks/${taskB.id}`);
    expect([403, 404]).toContain(jsonDenied.status());

    const tools = await agent.agent.listTools();
    expect(tools.map((tool) => tool.name)).toContain('tasks_get');
    const allowedTool = await agent.agent.call('tasks_get', { task_id: taskA.id });
    expect(allowedTool.isError).toBe(false);
    expect(allowedTool.structuredContent.title).toBe('Erlaubtes Agententicket');
    const deniedTool = await agent.agent.call('tasks_get', { task_id: taskB.id });
    expect(deniedTool.isError).toBe(true);

    recordEvidence(
      'Der auf Projekt A begrenzte Principal liest dasselbe Ticket über JSON und MCP, während Projekt B über beide Grenzen gesperrt ist.',
      `JSON und MCP erlaubten Task ${taskA.id}; JSON antwortete mit HTTP ${jsonDenied.status()} für Task ${taskB.id}; der MCP-Aufruf lieferte isError=${deniedTool.isError}.`,
    );
  } finally {
    await agent.close();
    await agentContext.dispose();
  }
});
