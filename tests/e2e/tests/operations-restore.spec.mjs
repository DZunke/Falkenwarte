import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, recordEvidence, test } from '../support/fixtures.mjs';

test('A20 restore restarts the single service and blocks T3 starts until inventory is resolved', async ({ ownerApi, ownerPage, qaMocks, baseURL }) => {
  test.setTimeout(270_000);
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'falkenwarte-a20-'));

  try {
    const project = await ownerApi.createProject({ name: 'A20 Wiederherstellung' });
    await ownerApi.ensureDefaultBoard(project.id);
    const statuses = await ownerApi.get('/projects/' + project.id + '/statuses');
    expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
    const readyStatus = statuses.data.items.find((status) => status.category === 'ready');
    expect(readyStatus, 'A20 benötigt eine startbereite Ticketkategorie.').toBeTruthy();
    const originalTitle = 'Externer T3-Auftrag vor dem Sicherungsstand';
    const task = await ownerApi.createTask(project.id, {
      title: originalTitle,
      status_id: readyStatus.id,
      description: 'Dieser fachliche Zustand muss nach dem SQLite-Restore erhalten bleiben.',
    });

    const connectionResponse = await ownerApi.post('/connections', {
      name: 'A20 zustandsbehafteter T3-Mock',
      bridge_id: 't3.mcp.v0_1_10',
      canonical_url: 'http://t3-mock:4311',
    });
    expect(connectionResponse.response.status(), JSON.stringify(connectionResponse.data)).toBe(201);
    let connection = connectionResponse.data;
    const oauth = await ownerApi.post('/connections/' + connection.id + '/oauth/start', {
      redirect_uri: new URL('/auth/t3/callback', baseURL).toString(),
    }, { version: connection.version });
    expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
    await ownerPage.goto(oauth.data.authorization_url);
    await expect(ownerPage).toHaveURL(/#\/agents/);
    await expect.poll(async () => (await ownerApi.get('/connections/' + connection.id)).data.auth_status, { timeout: 20_000 }).toBe('valid');

    connection = (await ownerApi.get('/connections/' + connection.id)).data;
    const connectionCheck = await ownerApi.post('/connections/' + connection.id + '/check', {}, { version: connection.version });
    expect(connectionCheck.response.status(), JSON.stringify(connectionCheck.data)).toBe(202);
    expect(connectionCheck.data).toMatchObject({
      action_url: `/api/v1/actions/${connectionCheck.data.action_id}`,
      resource: { resource_type: 'connection', id: connection.id, url: `/api/v1/connections/${connection.id}` },
    });
    const checkAction = await ownerApi.get('/actions/' + connectionCheck.data.action_id);
    expect(checkAction.response.status(), JSON.stringify(checkAction.data)).toBe(200);
    expect(checkAction.data.id).toBe(connectionCheck.data.action_id);
    await expect.poll(async () => (await ownerApi.get('/connections/' + connection.id)).data.health, { timeout: 30_000 }).toBe('ready');
    const remoteProjects = await ownerApi.get('/connections/' + connection.id + '/projects');
    expect(remoteProjects.response.status(), JSON.stringify(remoteProjects.data)).toBe(200);
    expect(remoteProjects.data.items.map((remote) => remote.external_project_id)).toContain('qa-t3-project-1');

    const currentProject = (await ownerApi.get('/projects/' + project.id)).data;
    const binding = await ownerApi.put('/projects/' + project.id + '/binding', {
      connection_id: connection.id,
      external_project_id: 'qa-t3-project-1',
      max_active_runs: 1,
    }, { version: currentProject.version });
    expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
    const profileResponse = await ownerApi.post('/agent-profiles', {
      name: 'A20 Laufbeobachtung',
      icon_key: 'bot',
      role: 'A20 externer Lauf',
      connection_id: connection.id,
      allowed_project_ids: [project.id],
      max_parallel_runs: 1,
      enabled: true,
      execution_target: { mode: 't3_project_default' },
    });
    expect(profileResponse.response.status(), JSON.stringify(profileResponse.data)).toBe(201);
    const profile = profileResponse.data;

    await qaMocks.setT3Scenario('run_pending');
    const currentTask = (await ownerApi.get('/tasks/' + task.id)).data;
    const runRequest = await ownerApi.post('/tasks/' + task.id + '/runs', {
      agent_profile_id: profile.id,
      stage: 'work',
      task_revision: currentTask.version,
    }, { version: currentTask.version });
    expect(runRequest.response.status(), JSON.stringify(runRequest.data)).toBe(202);
    const runId = runRequest.data.run_id ?? runRequest.data.resource?.id;
    expect(runId).toBeTruthy();
    let restoredRun;
    await expect.poll(async () => {
      const runResponse = await ownerApi.get('/runs/' + runId);
      restoredRun = runResponse.data;
      return runResponse.response.status() === 200
        && ['running', 'reconciling'].includes(restoredRun.state)
        && Boolean(restoredRun.attempts?.[0]?.external_thread_id)
        && Boolean(restoredRun.attempts?.[0]?.external_dispatch_run_id);
    }, { timeout: 40_000 }).toBe(true);
    const knownThreadId = restoredRun.attempts[0].external_thread_id;
    const knownExternalRunId = restoredRun.attempts[0].external_dispatch_run_id;

    const backupRequest = await ownerApi.post('/backups', { include_artifacts: false });
    expect(backupRequest.response.status(), JSON.stringify(backupRequest.data)).toBe(202);
    const backupId = backupRequest.data.resource?.id;
    expect(backupId).toBeTruthy();
    let backup;
    await expect.poll(async () => {
      const response = await ownerApi.get('/backups/' + backupId);
      backup = response.data;
      return response.response.status() === 200 && backup.status === 'ready';
    }, { timeout: 60_000 }).toBe(true);
    expect(backup.manifest.schema_version).toMatch(/^DoctrineMigrations\\Version\d+$/);
    expect(backup.manifest.plugin_versions).toContainEqual({ plugin_id: 'falkenwarte.link-notes', version: '1.0.0' });
    expect(backup.manifest.plugin_versions).toContainEqual({ plugin_id: 'falkenwarte.t3-mcp-bridge', version: '1.0.0' });
    expect(backup.manifest.artifact_count).toBe(0);

    const archiveResponse = await ownerApi.context.get(ownerApi.apiPrefix + '/backups/' + backupId + '/content');
    expect(archiveResponse.status()).toBe(200);
    expect(archiveResponse.headers()['content-type']).toContain('application/zip');
    expect(archiveResponse.headers()['content-disposition']).toContain(backupId + '.zip');
    const archivePath = path.join(workDirectory, 'a20-backup.zip');
    await writeFile(archivePath, await archiveResponse.body(), { mode: 0o600 });
    execFileSync('unzip', ['-tq', archivePath], { stdio: 'pipe' });
    const embeddedManifest = JSON.parse(execFileSync('unzip', ['-p', archivePath, 'manifest.json'], { maxBuffer: 1_048_576 }).toString('utf8'));
    expect(embeddedManifest).toEqual(backup.manifest);
    const databaseBytes = execFileSync('unzip', ['-p', archivePath, 'database.sqlite'], { maxBuffer: 128 * 1024 * 1024 });
    expect(createHash('sha256').update(databaseBytes).digest('hex')).toBe(backup.manifest.database_sha256);

    await ownerPage.goto('/#/settings');
    await expect(ownerPage.getByText('Backup und Wiederherstellung', { exact: true })).toBeVisible();
    await expect(ownerPage.getByText(new RegExp(backup.manifest.database_sha256))).toBeVisible();
    await ownerPage.locator('#maintenance-mode').check();
    await ownerPage.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    await expect.poll(async () => (await ownerApi.get('/settings')).data.maintenance_mode).toBe(true);

    const taskBeforeEdit = (await ownerApi.get('/tasks/' + task.id)).data;
    const edited = await ownerApi.patch('/tasks/' + task.id, { title: 'Nach dem Backup geänderter Stand' }, { version: taskBeforeEdit.version });
    expect(edited.response.status(), JSON.stringify(edited.data)).toBe(200);
    const lateExternal = await qaMocks.createExternalT3Activity({
      threadId: 'qa-external-thread-restore',
      runId: 'qa-external-run-restore',
      externalProjectId: 'qa-t3-project-1',
    });
    expect(lateExternal.status).toBe('running');

    const restoreRequest = await ownerApi.post('/backups/' + backupId + '/restore', {
      database_sha256: backup.manifest.database_sha256,
      reason: 'A20 prüft den echten Supervisor-Restore und die anschließende T3-Inventur.',
    }, { version: backup.version });
    expect(restoreRequest.response.status(), JSON.stringify(restoreRequest.data)).toBe(202);

    await expect.poll(async () => {
      try {
        return (await ownerApi.context.get('/healthz', { timeout: 4_000 })).status();
      } catch {
        return 0;
      }
    }, { timeout: 120_000, intervals: [500, 1000, 2000, 4000] }).toBe(200);

    let inventory;
    await expect.poll(async () => {
      const response = await ownerApi.get('/recovery/inventory');
      inventory = response.data;
      return response.response.status() === 200 && Boolean(inventory.gate);
    }, { timeout: 45_000 }).toBe(true);
    expect(inventory.gate.backup_id).toBe(backupId);
    const knownEntry = inventory.entries.find((entry) => entry.entry_kind === 'known_run');
    const unlistedEntry = inventory.entries.find((entry) => entry.entry_kind === 'unlisted_external_activity');
    expect(knownEntry).toMatchObject({ run_id: runId, external_thread_id: knownThreadId, external_run_id: knownExternalRunId });
    expect(unlistedEntry).toMatchObject({ status: 'owner_review_required', external_project_id: 'qa-t3-project-1' });

    const bridgePluginId = 'falkenwarte.t3-mcp-bridge';
    let bridgePlugin = (await ownerApi.get('/plugins/' + bridgePluginId)).data;
    const startDrain = await ownerApi.post('/plugins/' + bridgePluginId + '/drain', {
      policy: 'finish_active',
      reason: 'A18 prüft bekannte und unbekannte T3-Aktivität nach einem Restore.',
    }, { version: bridgePlugin.version });
    expect(startDrain.response.status(), JSON.stringify(startDrain.data)).toBe(202);
    await expect.poll(async () => {
      bridgePlugin = (await ownerApi.get('/plugins/' + bridgePluginId)).data;
      return [bridgePlugin.state, bridgePlugin.active_run_count, bridgePlugin.unresolved_external_activity_count];
    }, { timeout: 30_000, message: 'Bekannter Run und unbekannte T3-Aktivität müssen den Bridge-Drain offen halten.' }).toEqual(['draining', 1, 1]);

    const restoredTask = await ownerApi.get('/tasks/' + task.id);
    expect(restoredTask.response.status()).toBe(200);
    expect(restoredTask.data.title).toBe(originalTitle);
    const blockedStart = await ownerApi.post('/tasks/' + task.id + '/runs', {
      agent_profile_id: profile.id,
      stage: 'work',
      task_revision: restoredTask.data.version,
    }, { version: restoredTask.data.version });
    expect(blockedStart.response.status(), JSON.stringify(blockedStart.data)).toBe(409);
    expect(blockedStart.data.code).toBe('recovery_inventory_required');

    await ownerPage.goto('/#/settings');
    await expect(ownerPage.getByRole('heading', { name: 'T3-Abgleich nach Wiederherstellung' })).toBeVisible();
    await expect(ownerPage.getByText('Inventur erforderlich · neue Starts sind gesperrt')).toBeVisible();
    await expect(ownerPage.getByText(/Grund: A20 prüft den echten Supervisor-Restore und die anschließende T3-Inventur\./)).toBeVisible();
    await ownerPage.locator('#recovery-confirm-reason').fill('Bekannter Backup-Run und später gestarteter T3-Run sind geklärt; das T3-Projektjournal wurde vollständig geprüft.');
    await expect(ownerPage.getByRole('button', { name: 'T3-Inventur abschließen und Starts freigeben' })).toBeDisabled();
    const knownCard = ownerPage.getByRole('article', { name: 'Bekannter Falkenwarte-Auftrag' });
    await expect(knownCard.getByText(/Dieser Falkenwarte-Auftrag ist noch aktiv/)).toBeVisible();
    await expect(knownCard.getByRole('button', { name: 'Eintrag als geklärt markieren' })).toBeDisabled();

    await qaMocks.completeExternalT3Activity({ threadId: knownThreadId, runId: knownExternalRunId, status: 'failed' });
    await qaMocks.completeExternalT3Activity({ threadId: lateExternal.thread_id, runId: lateExternal.run_id, status: 'failed' });
    await expect.poll(async () => (await ownerApi.get('/runs/' + runId)).data.state, { timeout: 40_000 }).toBe('failed');

    await ownerPage.locator('#recovery-project').click();
    await ownerPage.getByRole('option', { name: project.name }).click();
    await expect(ownerPage.getByText(/qa-t3-project-1/)).toBeVisible();
    await ownerPage.locator('#recovery-thread-id').fill(lateExternal.thread_id);
    await ownerPage.locator('#recovery-run-id').fill(lateExternal.run_id);
    await ownerPage.locator('#recovery-registration-reason').fill('Der nach dem Backup in T3 sichtbare Lauf wurde einzeln geprüft und in die Inventur aufgenommen.');
    await ownerPage.getByRole('button', { name: 'T3-Auftrag registrieren' }).click();
    let lateEntry;
    await expect.poll(async () => {
      const response = await ownerApi.get('/recovery/inventory');
      inventory = response.data;
      lateEntry = inventory.entries.find((entry) => entry.entry_kind === 'registered_external_start');
      return lateEntry?.status === 'stopped';
    }, { timeout: 40_000 }).toBe(true);

    bridgePlugin = (await ownerApi.get('/plugins/' + bridgePluginId)).data;
    const checkUnknownActivity = await ownerApi.post('/plugins/' + bridgePluginId + '/drain', {
      policy: 'finish_active',
      reason: 'A18 prüft, dass die unaufgelöste Projektinventur den Drain weiter blockiert.',
    }, { version: bridgePlugin.version });
    expect(checkUnknownActivity.response.status(), JSON.stringify(checkUnknownActivity.data)).toBe(202);
    await expect.poll(async () => {
      bridgePlugin = (await ownerApi.get('/plugins/' + bridgePluginId)).data;
      return [bridgePlugin.state, bridgePlugin.active_run_count, bridgePlugin.unresolved_external_activity_count];
    }, { timeout: 30_000, message: 'Auch nach Ende des bekannten Runs muss die unbekannte T3-Aktivität den Drain offen halten.' }).toEqual(['draining', 0, 1]);

    await ownerPage.getByRole('button', { name: 'Aktuellen Stand laden' }).click();
    await expect(knownCard.getByRole('button', { name: 'Eintrag als geklärt markieren' })).toBeEnabled();
    await knownCard.locator(`#recovery-reason-${knownEntry.id}`).fill('Der gespeicherte T3-Run wurde nach dem Restore erneut gelesen und meldet failed; er kann nicht weiterlaufen.');
    await knownCard.getByRole('button', { name: 'Eintrag als geklärt markieren' }).click();
    await expect(knownCard.getByText('Geklärt')).toBeVisible();

    const lateCard = ownerPage.getByRole('article', { name: 'Nachträglich registrierter T3-Auftrag' });
    await expect(lateCard.getByText('In T3 beendet')).toBeVisible();
    await lateCard.locator(`#recovery-reason-${lateEntry.id}`).fill('Der nachträglich bekannte T3-Run wurde erneut gelesen und als failed beobachtet.');
    await lateCard.getByRole('button', { name: 'Eintrag als geklärt markieren' }).click();
    await expect(lateCard.getByText('Geklärt')).toBeVisible();

    const unlistedCard = ownerPage.getByRole('article', { name: 'T3-Projektaktivität prüfen' });
    await unlistedCard.locator(`#recovery-reason-${unlistedEntry.id}`).fill('Das T3-Projektjournal wurde geprüft; der einzige spätere Lauf ist bereits als eigener Eintrag registriert.');
    await unlistedCard.getByRole('button', { name: 'Eintrag als geklärt markieren' }).click();
    await expect(unlistedCard.getByText('Projekt geprüft, keine weiteren Aufträge offen')).toBeVisible();
    await expect(ownerPage.getByRole('button', { name: 'T3-Inventur abschließen und Starts freigeben' })).toBeEnabled();
    await ownerPage.getByRole('button', { name: 'T3-Inventur abschließen und Starts freigeben' }).click();
    await expect(ownerPage.getByText('Keine offene Wiederherstellungsinventur.')).toBeVisible();
    expect((await ownerApi.get('/recovery/inventory')).data).toEqual({ status: 'clear', entries: [] });

    bridgePlugin = (await ownerApi.get('/plugins/' + bridgePluginId)).data;
    const finishBridgeDrain = await ownerApi.post('/plugins/' + bridgePluginId + '/drain', {
      policy: 'finish_active',
      reason: 'A18 beendet den Bridge-Drain erst nach vollständiger Inventur.',
    }, { version: bridgePlugin.version });
    expect(finishBridgeDrain.response.status(), JSON.stringify(finishBridgeDrain.data)).toBe(202);
    await expect.poll(async () => (await ownerApi.get('/plugins/' + bridgePluginId)).data.state, { timeout: 30_000 }).toBe('disabled');
    bridgePlugin = (await ownerApi.get('/plugins/' + bridgePluginId)).data;
    const deactivateBridge = await ownerApi.post('/plugins/' + bridgePluginId + '/deactivate', {
      reason: 'A18 Bridge nach geklärter Inventur deaktivieren.',
    }, { version: bridgePlugin.version });
    expect(deactivateBridge.response.status(), JSON.stringify(deactivateBridge.data)).toBe(202);
    await expect.poll(async () => (await ownerApi.get('/plugins/' + bridgePluginId)).data.state, { timeout: 10_000 }).toBe('installed_disabled');

    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    recordEvidence(
      'Backup ' + backupId + ' enthielt App-Schema ' + backup.manifest.schema_version + ', Linknotizen ' + backup.manifest.plugin_versions.find((item) => item.plugin_id === 'falkenwarte.link-notes')?.version + ' und T3-Bridge ' + backup.manifest.plugin_versions.find((item) => item.plugin_id === 'falkenwarte.t3-mcp-bridge')?.version + '; ZIP-CRC und SQLite-SHA-256 stimmten. Nach Neustart wurde Ticket "' + originalTitle + '" aus dem Snapshot wiederhergestellt, Run ' + runId + ' samt T3-Thread ' + knownThreadId + ' abgeglichen und der zusätzliche T3-Lauf ' + lateExternal.thread_id + ' einzeln registriert. Neue Starts erhielten recovery_inventory_required; bekannte und unbekannte externe Aktivität hielten Plugin ' + bridgePluginId + ' im Drain, bis alle drei begründeten Entscheidungen das Gate lösten.',
      { t3: journal },
    );
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
});
