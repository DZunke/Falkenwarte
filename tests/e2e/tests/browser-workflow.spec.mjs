import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createAgentSimulator, test, expect, recordEvidence } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

async function expectWithinMobileViewport(locator, label) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  expect(bounds, `${label} has no rendered bounds`).toBeTruthy();
  expect(bounds.x, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width, `${label} extends past the right edge`).toBeLessThanOrEqual(391);
}

async function readUntil(ownerApi, route, matches, description, timeout = 45_000) {
  let current;
  await expect.poll(async () => {
    const result = await ownerApi.get(route);
    if (result.response.status() !== 200) return false;
    current = result.data;
    return matches(current);
  }, { timeout, message: description }).toBe(true);
  return current;
}

test('A01 A21 owner creates a project and completes a ticket in the browser', async ({ ownerPage }) => {
  test.info().annotations.push({ type: 'expected', description: 'Der Eigentümer legt Projekt, Board, Label und Ticket bei mobiler Breite und 200 Prozent Grundschrift an, bearbeitet Links und Ticket, nutzt Tastatursteuerung und schließt das Ticket ohne Agentenlauf ab.' });
  const projectSuffix = randomUUID().slice(0, 8);
  const labelName = `Bedienbarkeit ${projectSuffix}`;
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto('/#/projects');
  const enlargedText = await ownerPage.addStyleTag({ content: ':root { font-size: 200% !important; }' });
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
  await ownerPage.getByRole('tab', { name: 'Ablauf' }).click();
  const initialFlow = ownerPage.getByRole('tabpanel', { name: 'Ablauf' });
  await expect(initialFlow.getByRole('heading', { name: 'Ticketstand' })).toBeVisible();
  await expect(initialFlow.getByRole('heading', { name: 'Erfolgskriterien des Tickets' })).toBeVisible();
  await expect(initialFlow.getByRole('heading', { name: 'Workflows und Agentenläufe' })).toBeVisible();
  await expect(initialFlow.getByText('Für dieses Ticket gibt es noch keinen Workflow oder Einzellauf.', { exact: true })).toBeVisible();
  await expect(initialFlow.getByRole('button', { name: 'Ausführung öffnen' })).toBeVisible();
  await expect(initialFlow.getByText('Die Änderung wird im Board sichtbar.', { exact: true })).toBeVisible();
  await expect(initialFlow.getByText('Offen', { exact: true })).toBeVisible();
  await ownerPage.getByRole('tab', { name: 'Details' }).click();

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
  await ownerPage.getByRole('tab', { name: 'Ablauf' }).click();
  const completedFlow = ownerPage.getByRole('tabpanel', { name: 'Ablauf' });
  await expect(completedFlow.getByText('Bestätigt', { exact: true })).toBeVisible();
  await expect(completedFlow.getByText('Die Änderung wird im Board sichtbar.', { exact: true })).toBeVisible();

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
  await expectWithinMobileViewport(taskFilter, 'Boardfilter bei vergrößerter Schrift');
  await enlargedText.evaluate((style) => style.remove());
  await ownerPage.setViewportSize({ width: 1440, height: 960 });
  await ownerPage.evaluate(() => window.scrollTo(0, 0));
  await expect(ownerPage.getByRole('heading', { name: `Browser Bedienbarkeit ${projectSuffix}` })).toBeVisible();
  const boardScreenshot = path.join(publicDirectory, 'board.png');
  await ownerPage.screenshot({ path: boardScreenshot, fullPage: true });

  recordEvidence(
    'Der Eigentümer kann Projekt, Board, Label, Ticket und Link ohne Agentenlauf über die Oberfläche anlegen, bearbeiten, filtern und abschließen. Die Oberfläche bleibt bei mobiler Breite und 200 Prozent Grundschrift bedienbar.',
    `Chromium mit 390×844 Pixeln und 200 Prozent Grundschrift erstellte Projekt Browser Bedienbarkeit ${projectSuffix}, richtete das Board ein, erstellte und bearbeitete das Label ${labelName} geprüft, legte Ticket ${taskId} mit einem Kriterium an, registrierte und bearbeitete eine passive HTTPS-Referenz, änderte Titel/Beschreibung und Labelzuordnung, filterte das Board, registrierte eine manuelle Meldung, bestätigte das Kriterium mit Begründung und setzte den Status auf done. Tastatur-Enter öffnete Projekt-, Board- und Ticketdialoge; Escape schloss das Ticket-Sheet. Die öffentliche API bestätigte origin=manual und ${history.items.length} Verlaufsrevisionen. Ein unkritischer Browserboard-Screenshot liegt unter public/board.png.`,
  );
});

test('an owner links an existing run report to both criteria, confirms them, and preserves its current evidence status after closing the ticket', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(180_000);
  const project = await ownerApi.createProject({ name: 'Prüfbericht zuordnen' });
  const board = await ownerApi.ensureDefaultBoard(project.id);
  const criteria = ['Abhängigkeiten installiert', 'Tests erfolgreich'];
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status()).toBe(200);
  const readyStatus = statuses.data.items.find((status) => status.category === 'ready');
  expect(readyStatus).toBeTruthy();
  const task = await ownerApi.createTask(project.id, {
    title: 'Vorhandenen Nachweis abnehmen',
    status_id: readyStatus.id,
    criteria: criteria.map((text) => ({ text, is_required: true })),
  });
  const taskPath = `/tasks/${task.id}`;
  const current = await ownerApi.get(taskPath);
  const connectionResult = await ownerApi.post('/connections', {
    name: `Prüfbericht T3 ${randomUUID().slice(0, 6)}`,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(connectionResult.response.status(), JSON.stringify(connectionResult.data)).toBe(201);
  const connection = connectionResult.data;
  const callback = new URL('/auth/t3/callback', baseURL).toString();
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, { redirect_uri: callback }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Die Browserautorisierung muss die T3-Verbindung freigeben.');
  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Die T3-Verbindung muss ihren MCP-Handshake abschließen.');
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: (await ownerApi.get(`/projects/${project.id}`)).data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);

  const profileResult = await ownerApi.post('/agent-profiles', {
    name: 'Prüfbericht Agentenrolle',
    icon_key: 'bot',
    role: 'Implementierung',
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Melde den tatsächlichen Abschluss der Installation und Tests.',
    enabled: true,
    default_run_completion_policy: {
      require_external_settled: true,
      required_evidence_kinds: [],
      required_criterion_ids: [],
      require_human_phase_decision: false,
      require_human_confirmed_evidence: false,
    },
    execution_target: { mode: 't3_project_default' },
  });
  expect(profileResult.response.status(), JSON.stringify(profileResult.data)).toBe(201);
  const started = await ownerApi.post(`/tasks/${task.id}/runs`, {
    agent_profile_id: profileResult.data.id,
    stage: 'implementation',
    task_revision: current.data.version,
  }, { version: current.data.version });
  expect(started.response.status(), JSON.stringify(started.data)).toBe(202);
  const runId = started.data.run_id ?? started.data.resource?.id;
  expect(runId).toBeTruthy();
  const run = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.state === 'verifying', 'Der Testlauf muss seine agentengemeldeten Nachweise annehmen können.');

  const reportToken = await ownerApi.createTechnicalToken({
    label: `Prüfbericht ${randomUUID().slice(0, 8)}`,
    projectIds: [project.id],
    capabilities: ['runs.report'],
  });
  const reporter = await createAgentSimulator(baseURL, reportToken.token);
  const reportId = randomUUID();
  const evidenceLabel = 'Agentenbericht Installation und Tests';
  const unassignedRunEvidenceLabel = 'Zweiter unzugeordneter Prüfbericht';
  let reportEvidenceIds = [];
  try {
    const report = await reporter.agent.call('runs_report_result', {
      run_id: run.id,
      report_id: reportId,
      attempt_no: run.attempt_no,
      task_revision: current.data.version,
      outcome: 'reported_success',
      summary: 'Installation und Tests wurden abgeschlossen.',
      artifacts: [
        { kind: 'test_report', label: evidenceLabel, text: 'Installation erfolgreich. Tests bestanden.' },
        { kind: 'test_report', label: unassignedRunEvidenceLabel, text: 'Ein weiterer Nachweis aus demselben weiterhin gültigen Ergebnisbericht.' },
      ],
      client_request_id: randomUUID(),
      expected_version: run.version,
    });
    expect(report.isError, JSON.stringify(report.structuredContent)).toBe(false);
    const storedReport = await readUntil(ownerApi, `/runs/${runId}/result-reports/${reportId}`, (item) => item.id === reportId, 'Der echte Ergebnisbericht muss lesbar sein.');
    expect(storedReport.evidence_ids).toHaveLength(2);
    expect(storedReport.task_revision).toBe(current.data.version);
    reportEvidenceIds = storedReport.evidence_ids;
  } finally {
    await reporter.close();
  }

  await ownerPage.goto(`/#/project/${project.id}/board`);
  await ownerPage.getByRole('button', { name: board.name, exact: true }).click();
  await ownerPage.getByText('Vorhandenen Nachweis abnehmen', { exact: true }).click();
  const details = ownerPage.getByRole('tabpanel', { name: 'Details' });
  const assignableEvidence = details.locator('div.rounded-lg.border.p-3').filter({ hasText: evidenceLabel });
  await expect(assignableEvidence).toContainText('Gemeldet');
  await assignableEvidence.getByRole('button', { name: 'Kriterien zuordnen', exact: true }).click();
  const dialog = ownerPage.getByRole('dialog', { name: 'Kriterien zuordnen' });
  for (const criterion of criteria) {
    await dialog.getByRole('checkbox', { name: criterion, exact: true }).check();
  }
  await dialog.getByRole('button', { name: 'Zuordnung speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await ownerApi.get(taskPath)).data.criteria.map((item) => [item.state, item.evidence_ids]))
    .toEqual(criteria.map(() => ['reported', [reportEvidenceIds[0]]]));

  for (const criterion of criteria) {
    await details.getByRole('button', { name: 'Bestätigen', exact: true }).first().click();
    await ownerPage.getByLabel('Begründung').fill(`Der Prüfbericht belegt: ${criterion}.`);
    await ownerPage.getByRole('button', { name: 'Fachlich bestätigen', exact: true }).click();
    await expect(ownerPage.getByRole('dialog', { name: 'Kriterium bestätigen' })).not.toBeVisible();
  }
  await ownerPage.getByRole('combobox', { name: 'Ticketstatus' }).click();
  await ownerPage.getByRole('option', { name: 'Erledigt', exact: true }).click();
  await expect.poll(async () => (await ownerApi.get(taskPath)).data.status_category).toBe('done');
  const evidenceList = await ownerApi.get(`/evidence?task_id=${task.id}`);
  expect(evidenceList.response.status(), JSON.stringify(evidenceList.data)).toBe(200);
  expect(evidenceList.data.items).toHaveLength(2);
  const assignedEvidence = evidenceList.data.items.find((item) => item.label === evidenceLabel);
  const unassignedRunEvidence = evidenceList.data.items.find((item) => item.label === unassignedRunEvidenceLabel);
  expect(assignedEvidence).toMatchObject({ run_id: runId, review_status: 'reported' });
  expect(unassignedRunEvidence).toMatchObject({ run_id: runId, review_status: 'reported', task_revision: current.data.version });
  expect(assignedEvidence.current_for_task).toBe(true);
  expect(unassignedRunEvidence.current_for_task).toBe(true);
  const completedTask = (await ownerApi.get(taskPath)).data;
  expect(completedTask.status_category).toBe('done');
  expect(completedTask.criteria).toEqual(criteria.map((text, index) => expect.objectContaining({
    text,
    state: 'human_confirmed',
    evidence_ids: [assignedEvidence.id],
  })));
  expect(assignedEvidence.task_revision).not.toBe(completedTask.version);
  expect(assignedEvidence.task_revision).toBeLessThan(completedTask.version);
  expect(unassignedRunEvidence.task_revision).not.toBe(completedTask.version);

  await ownerPage.keyboard.press('Escape');
  await ownerPage.getByText('Vorhandenen Nachweis abnehmen', { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Vorhandenen Nachweis abnehmen', exact: true })).toBeVisible();
  const reopenedDetails = ownerPage.getByRole('tabpanel', { name: 'Details' });
  const assignedCard = reopenedDetails.locator('div.rounded-lg.border.p-3').filter({ hasText: evidenceLabel });
  await expect(assignedCard).toContainText('Bereits zugeordnet: Abhängigkeiten installiert · Tests erfolgreich');
  await expect(assignedCard).toContainText(`Nachweis aus Ticketversion ${assignedEvidence.task_revision}.`);
  await expect(assignedCard.getByText('Gemeldet', { exact: true })).toBeVisible();
  await expect(assignedCard.getByText('Veraltet', { exact: true })).toHaveCount(0);
  await expect(assignedCard.getByText(/Dieser Nachweis bezieht sich auf Ticketversion/)).toHaveCount(0);
  await expect(assignedCard.getByRole('button', { name: 'Kriterien zuordnen', exact: true })).toHaveCount(0);
  const unassignedRunCard = reopenedDetails.locator('div.rounded-lg.border.p-3').filter({ hasText: unassignedRunEvidenceLabel });
  await expect(unassignedRunCard).toContainText(`Nachweis aus Ticketversion ${unassignedRunEvidence.task_revision}.`);
  await expect(unassignedRunCard.getByText('Gemeldet', { exact: true })).toBeVisible();
  await expect(unassignedRunCard.getByText('Veraltet', { exact: true })).toHaveCount(0);
  await expect(unassignedRunCard.getByText(/Dieser Nachweis bezieht sich auf Ticketversion/)).toHaveCount(0);

  const manualStaleLabel = 'Manueller Nachweis zur alten Beschreibung';
  const manualEvidence = await ownerApi.post(`${taskPath}/evidence`, {
    task_id: task.id,
    task_revision: completedTask.version,
    run_id: null,
    attempt_no: null,
    artifact: { kind: 'note', label: manualStaleLabel, text: 'Dieser Hinweis beschreibt den Ticketstand vor der späteren inhaltlichen Änderung.' },
    criterion_ids: [],
  }, { version: completedTask.version });
  expect(manualEvidence.response.status(), JSON.stringify(manualEvidence.data)).toBe(201);
  await ownerPage.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await ownerPage.getByLabel('Beschreibung', { exact: true }).last().fill('Die Erfolgskriterien und der vereinbarte Lieferumfang wurden inhaltlich grundlegend geändert.');
  await ownerPage.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  const changedTask = await readUntil(ownerApi, taskPath, (item) => item.description === 'Die Erfolgskriterien und der vereinbarte Lieferumfang wurden inhaltlich grundlegend geändert.', 'Die inhaltliche Änderung muss eine neue Ticketrevision erzeugen.');
  expect(changedTask.version).toBeGreaterThan(completedTask.version);
  expect(changedTask.status_category).toBe('done');
  const afterDescriptionChange = await ownerApi.get(`/evidence?task_id=${task.id}`);
  expect(afterDescriptionChange.response.status(), JSON.stringify(afterDescriptionChange.data)).toBe(200);
  const changedManualEvidence = afterDescriptionChange.data.items.find((item) => item.label === manualStaleLabel);
  expect(changedManualEvidence).toMatchObject({ run_id: null, current_for_task: false, task_revision: completedTask.version });

  await ownerPage.keyboard.press('Escape');
  await ownerPage.getByText('Vorhandenen Nachweis abnehmen', { exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Vorhandenen Nachweis abnehmen', exact: true })).toBeVisible();
  const finalDetails = ownerPage.getByRole('tabpanel', { name: 'Details' });
  const actuallyStaleCard = finalDetails.locator('div.rounded-lg.border.p-3').filter({ hasText: manualStaleLabel });
  await expect(actuallyStaleCard.getByText('Veraltet', { exact: true })).toBeVisible();
  await expect(actuallyStaleCard.getByText(/Dieser Nachweis bezieht sich auf Ticketversion .* Er lässt sich nicht zuordnen\./)).toBeVisible();
  await expect(actuallyStaleCard.getByRole('button', { name: 'Kriterien zuordnen', exact: true })).toHaveCount(0);
  recordEvidence(
    'Run-Nachweise bleiben nach einem reinen Statuswechsel gültig, auch ohne Kriterienzuordnung; nach substanzieller Änderung des Ticketinhalts wird ein manueller Nachweis älterer Revision sichtbar veraltet.',
    `Der Browserlauf erzeugte einen echten T3-Run und Ergebnisbericht für Ticketrevision ${current.data.version}. Ein Nachweis wurde manuell beiden Kriterien zugeordnet und beide wurden fachlich bestätigt. Nach dem Statuswechsel Bereit→Erledigt und erneutem Öffnen standen beide Kriterien auf human_confirmed. Beide Nachweise desselben weiterhin gültigen Runs waren ohne Badge „Veraltet“ und ohne veraltete Zuordnungswarnung sichtbar; der zugeordnete Nachweis zeigte zusätzlich „Nachweis aus Ticketversion ${assignedEvidence.task_revision}.“ Nach einer inhaltlichen Änderung der Ticketbeschreibung wurde ein danach manuell registrierter, unzugeordneter Nachweis der vorherigen Beschreibung mit „Veraltet“ und dem Hinweis, dass er sich nicht zuordnen lässt, angezeigt.`,
  );
});
