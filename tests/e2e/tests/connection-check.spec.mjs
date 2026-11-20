import { randomUUID } from 'node:crypto';
import { authorizeT3InBrowser, expect, recordEvidence, test } from '../support/fixtures.mjs';

test('the integrations page shows the asynchronous connection-check result without T3 authorization', async ({ ownerApi, ownerPage }) => {
  const suffix = randomUUID().slice(0, 8);
  const connectionName = `T3 ohne Zugang ${suffix}`;
  const created = await ownerApi.post('/connections', {
    name: connectionName,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: 'https://127.0.0.1:1',
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;
  expect(connection.auth_status).toBe('missing');

  await ownerPage.goto('/#/agents');
  const connectionCard = ownerPage.getByRole('button', { name: new RegExp(connectionName) });
  await expect(connectionCard).toBeVisible();
  await connectionCard.click();
  const acceptedResponse = ownerPage.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith(`/connections/${connection.id}/check`),
  );
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  const accepted = await (await acceptedResponse).json();
  expect(accepted.status).toBe('accepted');
  expect(accepted.action_id).toBeTruthy();

  const result = ownerPage.getByTestId('connection-check-result');
  await expect(result).toContainText('Prüfung fehlgeschlagen', { timeout: 20_000 });
  await expect(result).toContainText(`Auftrag ${accepted.action_id}`);
  await expect(result).toContainText('Für die T3-Prüfung fehlt eine gültige OAuth-Anmeldung.');
  await expect(result).toContainText('Autorisierung');
  await expect(result).toContainText('Fehlgeschlagen');

  await expect.poll(async () => {
    const latest = await ownerApi.get(`/connections/${connection.id}/check`);
    return latest.response.status() === 200 ? latest.data.status : null;
  }, { timeout: 20_000 }).toBe('failed');
  const latest = await ownerApi.get(`/connections/${connection.id}/check`);
  expect(latest.data).toMatchObject({
    status: 'failed',
    network: 'not_checked',
    authentication: 'failed',
    mcp_handshake: 'not_checked',
    capabilities: 'not_checked',
  });

  recordEvidence(
    'Die Integrationsseite zeigt den angenommenen asynchronen Prüfauftrag und sein Ergebnis ohne aktive T3-Autorisierung.',
    `Der öffentliche Browserweg zeigte Aktion ${accepted.action_id}, den fehlgeschlagenen Autorisierungsschritt und die verständliche Diagnose. Der öffentliche Check-Record bestätigte status=failed; Netzwerk und MCP wurden wegen fehlender Anmeldung nicht aufgerufen.`,
  );
});

test('the integrations page restores implicit selection after T3 authorization and reload', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(90_000);
  await qaMocks.setT3Scenario('default');
  const connectionName = `T3 nach Anmeldung ${randomUUID().slice(0, 8)}`;
  const created = await ownerApi.post('/connections', {
    name: connectionName,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: 'http://t3-mock:4311',
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;

  await ownerPage.goto('/#/agents');
  const connectionCard = ownerPage.getByRole('button', { name: new RegExp(connectionName) });
  await expect(connectionCard).toBeVisible();
  await connectionCard.click();
  await authorizeT3InBrowser(ownerPage, baseURL, qaMocks.t3URL);
  await expect.poll(async () => (await ownerApi.get(`/connections/${connection.id}`)).data.auth_status).toBe('valid');

  await ownerPage.reload();
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: new RegExp(connectionName) })).toBeVisible();
  const projectLoad = ownerPage.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'GET' && pathname.includes('/connections/') && pathname.endsWith('/projects');
  });
  await ownerPage.getByRole('button', { name: 'Projekte laden' }).click();
  const projectResponse = await projectLoad;
  expect(new URL(projectResponse.url()).pathname).toBe(`${ownerApi.apiPrefix}/connections/${connection.id}/projects`);
  expect(projectResponse.status()).toBe(200);
  expect((await projectResponse.json()).items).toContainEqual({
    external_project_id: 'qa-t3-project-1',
    title: 'QA T3 Project',
    workspace_label: '/qa/workspace',
  });
  await expect(ownerPage.getByText('QA T3 Project', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText(/qa-t3-project-1/)).toBeVisible();

  const previousCheck = await ownerApi.get(`/connections/${connection.id}/check`);
  expect(previousCheck.response.status()).toBe(404);
  const checkPost = ownerPage.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === `${ownerApi.apiPrefix}/connections/${connection.id}/check`,
  );
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  const checkResponse = await checkPost;
  expect(checkResponse.status()).toBe(202);
  const accepted = await checkResponse.json();
  expect(accepted.status).toBe('accepted');
  expect(accepted.action_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await ownerApi.waitForSucceededAction(accepted.action_id, 'Die Browser-Verbindungsprüfung muss als Action abgeschlossen werden.');

  const result = ownerPage.getByTestId('connection-check-result');
  await expect(result).toContainText('Prüfung erfolgreich', { timeout: 30_000 });
  await expect(result).toContainText(`Auftrag ${accepted.action_id}`);
  await expect(result.locator('dd')).toHaveText(['Bestanden', 'Bestanden', 'Bestanden', 'Bestanden']);
  const finalCheck = await ownerApi.get(`/connections/${connection.id}/check`);
  expect(finalCheck.response.status()).toBe(200);
  expect(finalCheck.data).toMatchObject({
    status: 'succeeded',
    network: 'ok',
    authentication: 'ok',
    mcp_handshake: 'ok',
    capabilities: 'ok',
  });
  expect(finalCheck.data.snapshot_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await expect(result).toContainText(`Fähigkeitssnapshot ${finalCheck.data.snapshot_id}`);

  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  expect(t3.journal.map((entry) => entry.tool)).toContain('t3_project_list');
  expect(t3.journal.map((entry) => entry.tool)).toContain('orchestrator_capabilities');
  recordEvidence(
    'Nach OAuth-Rückkehr und Reload lädt die Integrationsseite T3-Projekte und zeigt das vollständige Ergebnis der asynchronen Verbindungsprüfung mit impliziter Standardauswahl.',
    `Ohne Kartenklick nach dem Reload rief der Browser /connections/${connection.id}/projects erfolgreich ab und zeigte QA T3 Project. Der angenommene Prüfauftrag ${accepted.action_id} erreichte succeeded; API und Browser zeigten Netzwerk, Autorisierung, MCP und Fähigkeiten als erfolgreich. Der T3-Mock protokollierte Projektliste und Fähigkeiten ohne unerwartete Aufrufe.`,
    { t3 },
  );
});
