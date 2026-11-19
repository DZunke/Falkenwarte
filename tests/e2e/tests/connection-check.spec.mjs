import { randomUUID } from 'node:crypto';
import { expect, recordEvidence, test } from '../support/fixtures.mjs';

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
