import { randomUUID } from 'node:crypto';
import { authorizeT3InBrowser, expect, recordEvidence, test } from '../support/fixtures.mjs';

async function createReadyT3Connection(ownerApi, ownerPage, baseURL, qaMocks, name) {
  await qaMocks.setT3Scenario('default');
  const created = await ownerApi.post('/connections', {
    name,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);

  await ownerPage.goto('/#/agents');
  await ownerPage.getByRole('button', { name: new RegExp(name) }).click();
  await authorizeT3InBrowser(ownerPage, baseURL, qaMocks.t3URL);
  await expect.poll(async () => (await ownerApi.get(`/connections/${created.data.id}`)).data.auth_status).toBe('valid');

  const checkResponse = ownerPage.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/connections/${created.data.id}/check`),
  );
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  const check = await (await checkResponse).json();
  await ownerApi.waitForSucceededAction(check.action_id, 'Die T3-Verbindung muss vor dem Projektbinding erfolgreich geprüft sein.');
  await expect(ownerPage.getByTestId('connection-check-result')).toContainText('Prüfung erfolgreich');

  return created.data;
}

async function loadT3Projects(ownerPage, connection) {
  await ownerPage.reload();
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: /Projekte laden/ })).toBeEnabled();
  const projectsResponse = ownerPage.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'GET'
      && pathname.endsWith(`/connections/${connection.id}/projects`);
  });
  await ownerPage.getByRole('button', { name: /Projekte laden/ }).click();
  const response = await projectsResponse;
  expect(response.status()).toBe(200);

  return response.json();
}

async function openBindingDialog(ownerPage, remoteProject) {
  const row = ownerPage.getByTestId('t3-project-row').filter({ hasText: remoteProject.title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Projekt verbinden' }).click();
  const dialog = ownerPage.getByTestId('t3-project-binding-dialog');
  await expect(dialog).toBeVisible();

  return { dialog, row };
}

test('a loaded T3 project can be bound to an existing Falkenwarte project and remains bound after reload', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(90_000);
  const suffix = randomUUID().slice(0, 8);
  const project = await ownerApi.createProject({ name: `Morgenwacht ${suffix}`, slug: `morgenwacht-${suffix}` });
  const connection = await createReadyT3Connection(ownerApi, ownerPage, baseURL, qaMocks, `T3 Morgenwacht ${suffix}`);
  const remoteProjects = await loadT3Projects(ownerPage, connection);
  expect(remoteProjects.items).toContainEqual({
    external_project_id: 'qa-t3-project-1',
    title: 'QA T3 Project',
    workspace_label: '/qa/workspace',
  });

  const firstPage = await ownerApi.get(`/connections/${connection.id}/projects?limit=1`);
  expect(firstPage.response.status()).toBe(200);
  expect(firstPage.data).toMatchObject({
    next_cursor: '1',
    has_more: true,
  });
  expect(firstPage.data.items).toEqual([remoteProjects.items[0]]);

  const secondPage = await ownerApi.get(`/connections/${connection.id}/projects?cursor=${encodeURIComponent(firstPage.data.next_cursor)}&limit=1`);
  expect(secondPage.response.status()).toBe(200);
  expect(secondPage.data).toMatchObject({
    next_cursor: null,
    has_more: false,
    items: [{
      external_project_id: 'qa-t3-project-2',
      title: 'QA Archive',
      workspace_label: '/qa/second-workspace',
    }],
  });

  const { dialog, row } = await openBindingDialog(ownerPage, remoteProjects.items[0]);
  await dialog.getByRole('button', { name: 'Vorhandenes Projekt wählen' }).click();
  const projectPicker = dialog.getByRole('combobox', { name: 'Falkenwarte-Projekt' });
  await projectPicker.click();
  await ownerPage.getByRole('option', { name: project.name }).click();

  const bindingWrite = ownerPage.waitForResponse((response) =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/projects/${project.id}/binding`,
  );
  await dialog.getByRole('button', { name: 'Projekt verbinden' }).click();
  const writeResponse = await bindingWrite;
  expect(writeResponse.status()).toBe(200);
  expect(writeResponse.request().headers()['if-match']).toBe(`"${project.version}"`);
  expect(await writeResponse.json()).toMatchObject({
    project_id: project.id,
    connection_id: connection.id,
    external_project_id: remoteProjects.items[0].external_project_id,
    active: true,
  });

  await expect(row.getByTestId('t3-project-binding')).toContainText(project.name);
  await expect(row.getByRole('link', { name: `${project.name} öffnen` })).toHaveAttribute('href', `#/project/${project.id}/board`);
  await expect(row.getByRole('button', { name: 'Projekt verbinden' })).toHaveCount(0);

  const storedBinding = await ownerApi.get(`/projects/${project.id}/binding`);
  expect(storedBinding.response.status()).toBe(200);
  expect(storedBinding.data).toMatchObject({
    project_id: project.id,
    connection_id: connection.id,
    external_project_id: remoteProjects.items[0].external_project_id,
    active: true,
  });

  await ownerPage.reload();
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
  await ownerPage.getByRole('button', { name: /Projekte laden/ }).click();
  const persistedRow = ownerPage.getByTestId('t3-project-row').filter({ hasText: remoteProjects.items[0].title });
  await expect(persistedRow.getByTestId('t3-project-binding')).toContainText(project.name);
  await expect(persistedRow.getByRole('button', { name: 'Projekt verbinden' })).toHaveCount(0);

  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await expect(persistedRow.getByRole('link', { name: `${project.name} öffnen` })).toBeVisible();
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await persistedRow.getByRole('link', { name: 'Agentrolle einrichten' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Agentrollen' })).toBeVisible();
  await expect(ownerPage.getByRole('combobox', { name: 'T3-Verbindung' })).toContainText(connection.name);
  await expect(ownerPage.getByRole('checkbox', { name: project.name })).toBeChecked();
  await expect(ownerPage.getByRole('combobox', { name: 'Ausführungsziel in T3' })).toContainText('T3-Projektstandard');

  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  expect(t3.journal.map((entry) => entry.tool)).toContain('t3_project_list');
  recordEvidence(
    'Ein T3-Projekt lässt sich im Browser mit einem vorhandenen Falkenwarte-Projekt verbinden.',
    `T3-Projekt ${remoteProjects.items[0].external_project_id} wurde per OAuth, erfolgreicher Verbindungsprüfung und Projektliste ausgewählt. Der Browser schrieb das Binding mit If-Match der Projektversion. Öffentliche API und Oberfläche bestätigten dieselbe Verbindung nach Reload. Die gebundene Zeile bot keine erneute Bindungsaktion an und blieb in mobiler Breite bedienbar.`,
    { t3 },
  );
});

test('the first T3 project can create and bind its Falkenwarte project in the browser', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(90_000);
  const initialProjects = await ownerApi.get('/projects?limit=100');
  expect(initialProjects.response.status()).toBe(200);
  expect(initialProjects.data.items).toEqual([]);

  const connection = await createReadyT3Connection(ownerApi, ownerPage, baseURL, qaMocks, 'T3 Morgenwacht Erstaufbau');
  const remoteProjects = await loadT3Projects(ownerPage, connection);
  expect(remoteProjects.items).toHaveLength(2);
  const remoteProject = remoteProjects.items[0];
  const { dialog, row } = await openBindingDialog(ownerPage, remoteProject);

  await dialog.getByRole('button', { name: 'Neues Falkenwarte-Projekt anlegen' }).click();
  const projectName = dialog.getByRole('textbox', { name: 'Projektname' });
  const slug = dialog.getByRole('textbox', { name: 'Kurzname' });
  await expect(projectName).toHaveValue(remoteProject.title);
  await expect(slug).not.toHaveValue('');
  await projectName.fill('Morgenwacht');
  await slug.fill('morgenwacht-browser');

  const slugBlocker = await ownerApi.createProject({ name: 'Anderes Projekt', slug: 'morgenwacht-browser' });
  expect(slugBlocker.slug).toBe('morgenwacht-browser');
  const conflictingCreate = ownerPage.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/projects',
  );
  await dialog.getByRole('button', { name: 'Projekt anlegen und verbinden' }).click();
  const conflictResponse = await conflictingCreate;
  expect(conflictResponse.status()).toBe(409);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(projectName).toHaveValue('Morgenwacht');
  await expect(slug).toHaveValue('morgenwacht-browser');
  const projectListAfterConflict = await ownerApi.get('/projects?limit=100');
  expect(projectListAfterConflict.data.items.filter((item) => item.name === 'Morgenwacht')).toHaveLength(0);

  await slug.fill(`morgenwacht-${randomUUID().slice(0, 8)}`);
  const projectCreate = ownerPage.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/projects',
  );
  const bindingWrite = ownerPage.waitForResponse((response) =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/binding'),
  );
  await dialog.getByRole('button', { name: 'Projekt anlegen und verbinden' }).click();
  const createdResponse = await projectCreate;
  expect(createdResponse.status()).toBe(201);
  const project = await createdResponse.json();
  const savedBinding = await bindingWrite;
  expect(savedBinding.status()).toBe(200);
  expect(savedBinding.request().headers()['if-match']).toBe(`"${project.version}"`);
  expect(await savedBinding.json()).toMatchObject({
    project_id: project.id,
    connection_id: connection.id,
    external_project_id: remoteProject.external_project_id,
    active: true,
  });

  await expect.poll(async () => {
    const result = await ownerApi.get(`/projects/${project.id}/binding`);
    return result.response.status() === 200 ? result.data : null;
  }).toMatchObject({
    project_id: project.id,
    connection_id: connection.id,
    external_project_id: remoteProject.external_project_id,
    active: true,
  });
  const binding = await ownerApi.get(`/projects/${project.id}/binding`);
  expect(binding.response.status()).toBe(200);
  expect(binding.data.project_id).toBe(project.id);

  await expect(row.getByTestId('t3-project-binding')).toContainText('Morgenwacht');
  await expect(row.getByRole('link', { name: 'Morgenwacht öffnen' })).toHaveAttribute('href', `#/project/${project.id}/board`);
  await expect(row.getByRole('button', { name: 'Projekt verbinden' })).toHaveCount(0);

  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: /Projekte laden/ }).click();
  const persistedRow = ownerPage.getByTestId('t3-project-row').filter({ hasText: remoteProject.title });
  await expect(persistedRow.getByTestId('t3-project-binding')).toContainText('Morgenwacht');
  await expect(persistedRow.getByRole('link', { name: 'Morgenwacht öffnen' })).toBeVisible();

  await persistedRow.getByRole('link', { name: 'Agentrolle einrichten' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Agentrollen' })).toBeVisible();
  await expect(ownerPage.getByRole('combobox', { name: 'T3-Verbindung' })).toContainText(connection.name);
  await expect(ownerPage.getByRole('checkbox', { name: 'Morgenwacht' })).toBeChecked();
  await expect(ownerPage.getByRole('combobox', { name: 'Ausführungsziel in T3' })).toContainText('T3-Projektstandard');

  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  expect(t3.journal.map((entry) => entry.tool)).toContain('t3_project_list');
  recordEvidence(
    'Bei der ersten Einrichtung entstehen das Falkenwarte-Projekt und seine T3-Verbindung gemeinsam im Browser.',
    `Ohne vorheriges Falkenwarte-Projekt legte die T3-Projektreferenz ${remoteProject.external_project_id} das Projekt Morgenwacht an. Ein zwischenzeitlicher Slugkonflikt ließ das Formular mit seinen Werten geöffnet und erzeugte kein doppeltes Projekt. Der Browser speicherte anschließend Projekt und Binding. Oberfläche und API zeigten es nach erneutem Laden; die Agentrolleneinrichtung übernahm Projekt, T3-Verbindung und T3-Projektstandard ohne Providerauswahl.`,
    { t3 },
  );
});
