import { randomUUID } from 'node:crypto';
import { request as playwrightRequest } from '@playwright/test';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

async function findToken(ownerApi, tokenId) {
  let cursor;
  do {
    const page = await ownerApi.get(`/tokens?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(page.response.status()).toBe(200);
    const match = page.data.items.find((token) => token.id === tokenId);
    if (match) return match;
    cursor = page.data.next_cursor;
  } while (cursor);

  return undefined;
}

test('Technische Tokens können alle Projekte freigeben, bleiben berechtigungsbegrenzt und widerrufbar', async ({ ownerApi, ownerPage, baseURL }) => {
  const suffix = randomUUID().slice(0, 6);
  const globalLabel = `Globale QA ${suffix}`;
  const projectA = await ownerApi.createProject({ name: `Token Projekt A ${suffix}` });
  const projectB = await ownerApi.createProject({ name: `Token Projekt B ${suffix}` });
  const taskA = await ownerApi.createTask(projectA.id, { title: `Tokenfreigabe A ${suffix}` });
  const taskB = await ownerApi.createTask(projectB.id, { title: `Tokenfreigabe B ${suffix}` });

  let globalMetadata;
  let scopedMetadata;
  let globalContext;
  let scopedContext;
  let globalAgent;
  let globalRevoked = false;
  try {
    await ownerPage.goto('/#/settings');
    await expect(ownerPage.getByText('Technische Principals', { exact: true })).toBeVisible();
    await ownerPage.getByLabel('Tokenname').fill(globalLabel);
    const allProjectsCheckbox = ownerPage.getByTestId('token-all-projects-checkbox');
    await allProjectsCheckbox.check();
    await expect(ownerPage.getByText('Gilt für alle vorhandenen und künftig angelegten Projekte. Deine Einzelauswahl bleibt beim Umschalten gespeichert.', { exact: true })).toBeVisible();
    await expect(ownerPage.getByLabel('Tickets lesen')).toBeChecked();
    const issueButton = ownerPage.getByRole('button', { name: 'Token ausstellen', exact: true });
    await expect(issueButton).toBeEnabled();
    const issueResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `${apiPrefix}/tokens`);
    await issueButton.click();
    const issueResponse = await issueResponsePromise;
    expect(issueResponse.status()).toBe(201);
    const issued = await issueResponse.json();
    const globalToken = issued.token;
    globalMetadata = issued.metadata;
    expect(typeof globalToken === 'string' && globalToken.length > 0).toBe(true);
    expect(globalMetadata).toMatchObject({ label: globalLabel, all_projects: true, project_ids: [], capabilities: ['tasks.read'] });
    await ownerPage.getByRole('button', { name: 'Anzeige schließen', exact: true }).click();

    const tokenRow = ownerPage.getByText(globalLabel, { exact: true }).locator('..').locator('..');
    await expect(tokenRow).toContainText('Alle Projekte');
    const listedGlobal = await findToken(ownerApi, globalMetadata.id);
    expect(listedGlobal).toMatchObject({ all_projects: true, project_ids: [], capabilities: ['tasks.read'], revoked: false });
    expect(Object.hasOwn(listedGlobal, 'token')).toBe(false);

    globalContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${globalToken}`, Accept: 'application/json' },
    });
    for (const task of [taskA, taskB]) {
      const readable = await globalContext.get(`${apiPrefix}/tasks/${task.id}`);
      expect(readable.status()).toBe(200);
      expect((await readable.json()).id).toBe(task.id);
    }

    const futureProject = await ownerApi.createProject({ name: `Token Projekt nach Ausstellung ${suffix}` });
    const futureTask = await ownerApi.createTask(futureProject.id, { title: `Spätere Tokenfreigabe ${suffix}` });
    const futureRead = await globalContext.get(`${apiPrefix}/tasks/${futureTask.id}`);
    expect(futureRead.status()).toBe(200);
    expect((await futureRead.json()).id).toBe(futureTask.id);
    globalAgent = await createAgentSimulator(baseURL, globalToken);
    const handoff = await globalAgent.agent.call('task_handoff_get', { task_id: futureTask.id });
    expect(handoff.isError).toBe(false);
    expect(handoff.structuredContent).toMatchObject({
      task: { id: futureTask.id, project_id: futureProject.id },
      source_run_id: null,
    });

    const futureTaskState = await ownerApi.get(`/tasks/${futureTask.id}`);
    expect(futureTaskState.response.status()).toBe(200);
    const mutation = await globalContext.patch(`${apiPrefix}/tasks/${futureTask.id}`, {
      headers: { 'If-Match': `"${futureTaskState.data.version}"` },
      data: { title: `Nicht geändert ${suffix}` },
    });
    expect(mutation.status()).toBe(403);
    const unchanged = await ownerApi.get(`/tasks/${futureTask.id}`);
    expect(unchanged.response.status()).toBe(200);
    expect(unchanged.data.title).toBe(`Spätere Tokenfreigabe ${suffix}`);

    const scoped = await ownerApi.createTechnicalToken({
      label: `Einzelprojekt QA ${suffix}`,
      projectIds: [projectA.id],
      capabilities: ['tasks.read'],
    });
    scopedMetadata = scoped.metadata;
    expect(scopedMetadata).toMatchObject({ all_projects: false, project_ids: [projectA.id] });
    scopedContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${scoped.token}`, Accept: 'application/json' },
    });
    expect((await scopedContext.get(`${apiPrefix}/tasks/${taskA.id}`)).status()).toBe(200);
    expect([403, 404]).toContain((await scopedContext.get(`${apiPrefix}/tasks/${taskB.id}`)).status());
    expect([403, 404]).toContain((await scopedContext.get(`${apiPrefix}/tasks/${futureTask.id}`)).status());

    const revoked = await ownerApi.send('DELETE', `/tokens/${globalMetadata.id}`, undefined, {
      mutation: true,
      version: globalMetadata.version,
    });
    expect(revoked.response.status()).toBe(200);
    globalRevoked = true;
    expect(revoked.data.revoked).toBe(true);
    expect((await globalContext.get(`${apiPrefix}/tasks/${taskA.id}`)).status()).toBe(401);

    recordEvidence(
      'Ein über die Oberfläche ausgestelltes technisches Token kann alle vorhandenen und später angelegten Projekte lesen; sein Capability-Satz begrenzt Schreibzugriffe, ein Einzelprojekt-Token bleibt auf seine Auswahl begrenzt, und Widerruf beendet den Zugriff.',
      `Das globale Token las Aufgaben in den bereits vorhandenen Projekten ${projectA.id} und ${projectB.id} sowie im nach der Ausgabe erstellten Projekt ${futureProject.id}; die MCP-Fassade lieferte für dessen Aufgabe zusätzlich den kuratierten task_handoff_get-Kontext. Ein Schreibversuch mit ausschließlich tasks.read erhielt HTTP 403 und ließ den Titel unverändert. Das Einzelprojekt-Token las Projekt A, wurde für Projekt B und das spätere Projekt abgewiesen. Nach dem Widerruf erhielt das globale Token HTTP 401. Kein Tokenwert wurde in den Abnahmenachweis übernommen.`,
    );
  } finally {
    await globalAgent?.close();
    await globalContext?.dispose();
    await scopedContext?.dispose();
    if (scopedMetadata) {
      await ownerApi.send('DELETE', `/tokens/${scopedMetadata.id}`, undefined, {
        mutation: true,
        version: scopedMetadata.version,
      });
    }
    if (globalMetadata && !globalRevoked) {
      await ownerApi.send('DELETE', `/tokens/${globalMetadata.id}`, undefined, {
        mutation: true,
        version: globalMetadata.version,
      });
    }
  }
});
