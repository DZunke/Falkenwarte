import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

const defaultRunPolicy = {
  require_external_settled: true,
  required_evidence_kinds: [],
  required_criterion_ids: [],
  require_human_phase_decision: false,
  require_human_confirmed_evidence: false,
};

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

async function configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, name) {
  const connectionResult = await ownerApi.post('/connections', {
    name: `${name} ${randomUUID().slice(0, 6)}`,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(connectionResult.response.status(), JSON.stringify(connectionResult.data)).toBe(201);
  const connection = connectionResult.data;
  const callback = new URL('/auth/t3/callback', baseURL).toString();
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, { redirect_uri: callback }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Die Browser-OAuth-Anmeldung muss T3 autorisieren.');
  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  const readyConnection = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der produktive MCP-Adapter muss den T3-Mock erfolgreich prüfen.');
  const currentProject = await ownerApi.get(`/projects/${project.id}`);
  expect(currentProject.response.status(), JSON.stringify(currentProject.data)).toBe(200);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: currentProject.data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
  return { connection: readyConnection, binding: binding.data };
}

async function createProfile(ownerApi, project, connection, name, role, prompt) {
  const result = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role,
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: prompt,
    enabled: true,
    default_run_completion_policy: defaultRunPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data;
}

async function createReportingAgent(ownerApi, project, baseURL) {
  const token = await ownerApi.createTechnicalToken({
    label: `M4 Workflow ${randomUUID().slice(0, 8)}`,
    projectIds: [project.id],
    capabilities: ['runs.report'],
  });
  const simulator = await createAgentSimulator(baseURL, token.token);
  return { token, ...simulator };
}

async function createReadyTask(ownerApi, projectId, values) {
  await ownerApi.ensureDefaultBoard(projectId);
  const statuses = await ownerApi.get(`/projects/${projectId}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const ready = statuses.data.items.find((status) => status.category === 'ready');
  expect(ready).toBeTruthy();
  return ownerApi.createTask(projectId, { ...values, status_id: ready.id });
}

async function createWorkflow(ownerApi, projectId, name, stages, transitions, maxRepairRounds) {
  const result = await ownerApi.post('/workflows', {
    project_id: projectId,
    name,
    preset_id: 'manual',
    stages,
    transitions,
    limits: { max_repair_rounds: maxRepairRounds, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data.workflow ?? result.data;
}

async function startWorkflow(ownerApi, task, workflow) {
  const start = await ownerApi.post(`/tasks/${task.id}/workflow-instances`, {
    workflow_id: workflow.id,
    definition_version: workflow.definition_version,
    task_revision: task.version,
  }, { version: task.version });
  expect(start.response.status(), JSON.stringify(start.data)).toBe(202);
  const instanceId = start.data.resource?.id ?? start.data.instance_id;
  expect(instanceId).toBeTruthy();
  return await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (instance) => instance.run_ids.length >= 1, 'Der erste Workflow-Run muss angelegt werden.');
}

async function submitReport(ownerApi, agent, runId, taskRevision, { outcome = 'reported_success', summary, label, text }) {
  const run = await readUntil(ownerApi, `/runs/${runId}`, (item) => ['running', 'verifying'].includes(item.state) && Boolean(item.attempts[0]?.external_thread_id), 'Der zugehörige T3-Run muss gestartet und beobachtbar sein.');
  expect(run.snapshot.task_revision).toBe(taskRevision);
  const taskId = run.task_id;
  const attemptIdentity = run.attempts.map((attempt) => ({ attempt_no: attempt.attempt_no, dispatch_id: attempt.dispatch_id }));
  const reportId = randomUUID();
  const clientRequestId = randomUUID();
  const payload = Object.freeze({
    run_id: runId,
    report_id: reportId,
    attempt_no: run.attempt_no,
    task_revision: taskRevision,
    outcome,
    summary,
    artifacts: [{ kind: 'note', label, text }],
    client_request_id: clientRequestId,
  });
  let reportResult;
  let expectedVersion = run.version;
  for (let submission = 0; submission < 3; submission += 1) {
    reportResult = await agent.call('runs_report_result', { ...payload, expected_version: expectedVersion });
    if (!reportResult?.isError) break;

    const problem = reportResult.structuredContent;
    const isRunVersionConflict = problem?.status === 412
      && problem?.code === 'version_conflict'
      && Number.isInteger(problem?.current_version);
    expect(isRunVersionConflict, JSON.stringify(problem)).toBe(true);
    expect(submission, 'Der Report darf höchstens zweimal nach einem konkreten Versionskonflikt erneut gelesen und gesendet werden.').toBeLessThan(2);

    const latestResponse = await ownerApi.get(`/runs/${runId}`);
    expect(latestResponse.response.status(), JSON.stringify(latestResponse.data)).toBe(200);
    const latest = latestResponse.data;
    expect(latest.id).toBe(run.id);
    expect(latest.project_id).toBe(run.project_id);
    expect(latest.task_id).toBe(taskId);
    expect(latest.version).toBeGreaterThan(expectedVersion);
    expect(latest.version).toBeGreaterThanOrEqual(problem.current_version);
    expect(latest.attempt_no).toBe(run.attempt_no);
    expect(latest.snapshot.task_revision).toBe(taskRevision);
    expect(latest.attempts.map((attempt) => ({ attempt_no: attempt.attempt_no, dispatch_id: attempt.dispatch_id }))).toEqual(attemptIdentity);
    expect(['running', 'verifying']).toContain(latest.state);
    expect(latest.report_ids ?? []).toEqual(run.report_ids ?? []);

    const latestTask = await ownerApi.get(`/tasks/${taskId}`);
    expect(latestTask.response.status(), JSON.stringify(latestTask.data)).toBe(200);
    expect(latestTask.data.id).toBe(taskId);
    expect(latestTask.data.version).toBe(taskRevision);

    const existingReport = await ownerApi.get(`/runs/${runId}/result-reports/${reportId}`);
    expect(existingReport.response.status(), JSON.stringify(existingReport.data)).toBe(404);
    expectedVersion = latest.version;
  }
  expect(reportResult?.isError, JSON.stringify(reportResult?.structuredContent)).toBe(false);

  const reportedRun = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.report_ids?.includes(reportId) === true, 'Der Ergebnisbericht muss dauerhaft diesem Run zugeordnet werden.');
  const storedReport = await readUntil(ownerApi, `/runs/${runId}/result-reports/${reportId}`, (item) => item.id === reportId, 'Der gespeicherte Ergebnisbericht muss öffentlich lesbar sein.');
  expect(storedReport.run_id).toBe(runId);
  expect(storedReport.attempt_no).toBe(run.attempt_no);
  expect(storedReport.task_revision).toBe(taskRevision);
  expect(storedReport.outcome).toBe(outcome);
  expect(storedReport.summary).toBe(summary);
  expect(storedReport.accepted_for_reconciliation).toBe(true);
  return { run: reportedRun, report: storedReport, reportId };
}

test('M4 implementation hands a frozen report to review and the owner completes the ticket separately', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(240_000);
  test.info().annotations.push({ type: 'acceptance', description: 'A12' });
  test.info().annotations.push({ type: 'scenario', description: 'E24' });
  test.info().annotations.push({ type: 'expected', description: 'Ein akzeptierter Implementierungslauf friert Report, Attempt, Aufgabenrevision und gemeldete Evidenz für eine eigene Reviewrolle ein. Die Reviewphase und ihr Phasenbeschluss schließen das Ticket nicht; der Eigentümer muss die strengere Ticketpolicy separat erfüllen.' });
  await qaMocks.setT3Scenario('default');
  const project = await ownerApi.createProject({ name: `M4 Übergabekette ${randomUUID().slice(0, 6)}` });
  const projectRead = await ownerApi.get(`/projects/${project.id}`);
  const strictPolicy = await ownerApi.patch(`/projects/${project.id}`, {
    completion_policy: {
      required_evidence_kinds: ['note'],
      require_human_approval: false,
      require_review: true,
      require_human_confirmed_criteria: true,
    },
  }, { version: projectRead.data.version });
  expect(strictPolicy.response.status(), JSON.stringify(strictPolicy.data)).toBe(200);
  const { connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, 'M4 T3 Übergabekette');
  const implementer = await createProfile(ownerApi, project, connection, 'M4 Umsetzung', 'Implementierung', 'Rolle: Umsetzung. Melde den erledigten Auftrag und die erstellte Ergebnisnotiz.');
  const reviewer = await createProfile(ownerApi, project, connection, 'M4 Review', 'Review', 'Rolle: Review. Prüfe die Übergabe und melde einen eigenen Reviewbericht.');
  const taskTitle = 'M4 Umsetzung und Review getrennt abnehmen';
  const taskResult = await createReadyTask(ownerApi, project.id, {
    title: taskTitle,
    description: 'Die Implementierungsrolle meldet ihr Ergebnis. Eine getrennte Reviewrolle prüft die Übergabe. Der Eigentümer bestätigt danach Ticketkriterium und Reviewnachweis.',
    criteria: [{ text: 'Die getrennte Reviewmeldung ist als Ergebnisnachweis gespeichert.', is_required: true }],
    link_collections: [{
      name: 'Freigegebene Quelle',
      kind: 'reference',
      links: [{ title: 'Abnahmequelle', url: 'https://example.test/m4/handoff', kind: 'documentation', relation: 'references' }],
    }],
  });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const criterion = task.criteria[0];
  const workflow = await createWorkflow(ownerApi, project.id, 'M4 Umsetzung → Review', [
    { id: 'implementation', kind: 'implementation', name: 'Umsetzung', agent_profile_id: implementer.id, entry_conditions: [], run_completion_policy: defaultRunPolicy },
    { id: 'review', kind: 'review', name: 'Review', agent_profile_id: reviewer.id, entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: { ...defaultRunPolicy, required_evidence_kinds: ['note'], require_human_phase_decision: true } },
  ], [
    { from_stage_id: 'implementation', to_stage_id: 'review', on: 'accepted', conditions: [] },
  ], 1);
  const instance = await startWorkflow(ownerApi, task, workflow);
  const firstRunId = instance.run_ids[0];
  const reporter = await createReportingAgent(ownerApi, project, baseURL);
  try {
    const implementationSummary = 'Umsetzung meldet die angeforderte Änderung und hinterlässt eine eigene Agentennotiz.';
    const implementationText = 'Agentennotiz Umsetzung: Das Ergebnis wurde erstellt und zur getrennten Reviewrolle übergeben.';
    const implementationResult = await submitReport(ownerApi, reporter.agent, firstRunId, task.version, {
      summary: implementationSummary,
      label: 'Umsetzungsbericht',
      text: implementationText,
    });
    const implementationRun = await readUntil(ownerApi, `/runs/${firstRunId}`, (run) => run.state === 'succeeded', 'Die Umsetzungsphase muss nach T3-Ende und Agentmeldung erfolgreich sein.');
    expect(implementationRun.stage).toBe('implementation');
    expect(implementationRun.snapshot.agent_profile_id).toBe(implementer.id);
    expect(implementationResult.report.evidence_ids).toHaveLength(1);
    const implementationEvidenceId = implementationResult.report.evidence_ids[0];

    const withReviewRun = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (item) => item.run_ids.length === 2, 'Der akzeptierte Umsetzungsbericht muss genau eine getrennte Reviewphase starten.');
    const reviewRunId = withReviewRun.run_ids[1];
    const reviewRun = await readUntil(ownerApi, `/runs/${reviewRunId}`, (run) => run.stage === 'review' && run.snapshot.agent_profile_id === reviewer.id, 'Die zweite Phase muss das eigene Reviewprofil eingefroren haben.');
    expect(reviewRun.snapshot).toMatchObject({
      handoff_source_run_id: firstRunId,
      handoff_snapshot: {
        source_report_id: implementationResult.reportId,
        source_result_digest: implementationRun.result_digest,
        source_attempt_id: implementationRun.attempts[0].dispatch_id,
        source_attempt_no: implementationRun.attempt_no,
        task_revision_id: task.version,
        summary: implementationSummary,
        outcome: 'reported_success',
        context_summary: expect.stringContaining(taskTitle),
        open_questions: [],
        reported_evidence_ids: [implementationEvidenceId],
        link_collections: [expect.objectContaining({ name: 'Freigegebene Quelle', task_version: task.version })],
      },
    });
    const handoff = await ownerApi.get(`/tasks/${task.id}/handoff?source_run_id=${encodeURIComponent(firstRunId)}`);
    expect(handoff.response.status(), JSON.stringify(handoff.data)).toBe(200);
    expect(handoff.data.source_run_id).toBe(firstRunId);
    expect(handoff.data.reported_evidence_ids).toContain(implementationEvidenceId);
    expect(handoff.data.link_collections[0].links[0].title).toBe('Abnahmequelle');

    const reviewSummary = 'Review meldet die Übergabe anhand des eingefrorenen Umsetzungsberichts als angenommen.';
    const reviewText = 'Agentennotiz Review: Die gemeldete Übergabe wurde anhand des eingefrorenen Quellenstands geprüft.';
    const reviewResult = await submitReport(ownerApi, reporter.agent, reviewRunId, task.version, {
      summary: reviewSummary,
      label: 'Reviewbericht',
      text: reviewText,
    });
    expect(reviewResult.report.evidence_ids).toHaveLength(1);
    const reviewEvidenceId = reviewResult.report.evidence_ids[0];
    const awaitingPhaseDecision = await readUntil(ownerApi, `/runs/${reviewRunId}`, (run) => run.state === 'verifying' && run.status_reason?.includes('Eigentümerentscheidung'), 'Die Reviewphase muss ihre eigene Ownerentscheidung abwarten.');
    const approvalRequest = await ownerApi.post(`/runs/${reviewRunId}/approvals`, {
      kind: 'completion',
      result_digest: awaitingPhaseDecision.result_digest,
      reason: 'Gemeldeten Abschluss der Reviewphase prüfen.',
    }, { version: awaitingPhaseDecision.version });
    expect(approvalRequest.response.status(), JSON.stringify(approvalRequest.data)).toBe(201);
    const approvalDecision = await ownerApi.post(`/approvals/${approvalRequest.data.id}/decision`, {
      decision: 'approved',
      result_digest: awaitingPhaseDecision.result_digest,
      reason: 'Die Reviewphase ist als Agentenmeldung angenommen.',
    }, { version: approvalRequest.data.version });
    expect(approvalDecision.response.status(), JSON.stringify(approvalDecision.data)).toBe(200);
    await readUntil(ownerApi, `/runs/${reviewRunId}`, (run) => run.state === 'succeeded', 'Die Reviewphase muss unabhängig von der Ticketentscheidung abschließen.');
    const succeededWorkflow = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (item) => item.state === 'succeeded', 'Der zweiphasige Workflow muss nach der Reviewentscheidung enden.');
    expect(succeededWorkflow.run_ids).toEqual([firstRunId, reviewRunId]);

    const stillOpenTask = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(stillOpenTask.status_category).toBe('ready');
    const statuses = (await ownerApi.get(`/projects/${project.id}/statuses`)).data.items;
    const doneStatus = statuses.find((status) => status.category === 'done');
    const blockedCompletion = await ownerApi.post(`/tasks/${task.id}/move`, { status_id: doneStatus.id }, { version: stillOpenTask.version });
    expect(blockedCompletion.response.status(), JSON.stringify(blockedCompletion.data)).toBe(409);
    expect(blockedCompletion.data.code).toBe('completion_policy_unsatisfied');

    const attachReviewEvidence = await ownerApi.post(`/tasks/${task.id}/criteria/${criterion.id}/evidence`, { evidence_ids: [reviewEvidenceId] }, { version: stillOpenTask.version });
    expect(attachReviewEvidence.response.status(), JSON.stringify(attachReviewEvidence.data)).toBe(200);
    const confirmCriterion = await ownerApi.post(`/tasks/${task.id}/criteria/${criterion.id}/review`, {
      decision: 'human_confirmed',
      evidence_ids: [reviewEvidenceId],
      reason: 'Der Eigentümer bestätigt das Kriterium anhand des getrennten Reviewberichts.',
    }, { version: attachReviewEvidence.data.version });
    expect(confirmCriterion.response.status(), JSON.stringify(confirmCriterion.data)).toBe(200);
    const reviewEvidence = await ownerApi.get(`/evidence/${reviewEvidenceId}`);
    expect(reviewEvidence.response.status(), JSON.stringify(reviewEvidence.data)).toBe(200);
    const confirmEvidence = await ownerApi.post(`/evidence/${reviewEvidenceId}/review`, {
      decision: 'human_confirmed',
      reason: 'Der Reviewbericht ist für die Ticketabnahme ausdrücklich bestätigt.',
    }, { version: reviewEvidence.data.version });
    expect(confirmEvidence.response.status(), JSON.stringify(confirmEvidence.data)).toBe(200);

    await ownerPage.goto(`/#/project/${project.id}/board?task=${task.id}`);
    await expect(ownerPage.getByRole('heading', { name: taskTitle })).toBeVisible();
    await ownerPage.getByRole('tab', { name: 'Ausführung' }).click();
    const execution = ownerPage.getByRole('tabpanel', { name: 'Ausführung' });
    await execution.getByRole('button', { name: /^review · Versuch 1/ }).click();
    const frozen = execution.locator('details').filter({ hasText: 'Übergabe aus der vorigen Phase' });
    await frozen.locator('summary').click();
    await expect(frozen.getByText(implementationSummary, { exact: true })).toBeVisible();
    await expect(frozen.getByRole('link', { name: 'Abnahmequelle' })).toHaveAttribute('href', 'https://example.test/m4/handoff');
    await frozen.getByRole('button', { name: 'Ausgangslauf und Nachweise ansehen' }).click();
    await expect(execution.getByRole('heading', { name: 'implementation · Versuch 1' })).toBeVisible();
    await ownerPage.getByRole('tab', { name: 'Details' }).click();
    const statusPicker = ownerPage.getByRole('combobox', { name: 'Ticketstatus' });
    await statusPicker.click();
    await ownerPage.getByRole('option', { name: 'Erledigt', exact: true }).click();
    const completedTask = await readUntil(ownerApi, `/tasks/${task.id}`, (item) => item.status_category === 'done', 'Erst nach Ownerbestätigung von Reviewnachweis und Pflichtkriterium darf das Ticket erledigt werden.');
    await expect(ownerPage.getByRole('combobox', { name: 'Ticketstatus' })).toContainText('Erledigt');
    expect(completedTask.criteria[0]).toMatchObject({ state: 'human_confirmed', reviewed_by: { kind: 'owner' } });
    const evidencePage = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidencePage.response.status(), JSON.stringify(evidencePage.data)).toBe(200);
    expect(evidencePage.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: implementationEvidenceId, run_id: firstRunId, review_status: 'reported' }),
      expect.objectContaining({ id: reviewEvidenceId, run_id: reviewRunId, review_status: 'human_confirmed' }),
    ]));
    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    expect(t3.accepted_launches).toHaveLength(2);
    const reviewerLaunch = t3.accepted_launches.find((launch) => launch.payload.message.includes('Übergabe aus Lauf'));
    expect(reviewerLaunch?.payload.message).toContain(firstRunId);
    expect(reviewerLaunch?.payload.message).toContain(implementationResult.reportId);
    expect(reviewerLaunch?.payload.message).toContain(implementationSummary);
    expect(reviewerLaunch?.payload.message).toContain(implementationEvidenceId);
    recordEvidence(
      'M4: Umsetzung → Review ist eine echte, eingefrorene Übergabe mit zwei T3-Runs, getrennten Reports/Evidenzen und separatem Ticketabschluss.',
      `T3 startete getrennte Profile ${implementer.id} und ${reviewer.id} genau zweimal. Run ${reviewRunId} fror source_run_id=${firstRunId}, Report ${implementationResult.reportId}, Dispatchversuch ${implementationRun.attempts[0].dispatch_id}, Aufgabenrevision ${task.version} und Evidence ${implementationEvidenceId} ein; dieselben Übergabedaten standen im echten Reviewer-Launchtext. Report ${reviewResult.reportId} und Evidence ${reviewEvidenceId} blieben dem Review-Run zugeordnet. Die Reviewphase und ihr Ownerbeschluss schlossen Workflow ${instance.id}, während Ticket ${task.id} ready blieb. Der separate Browserabschluss war zunächst wegen completion_policy_unsatisfied gesperrt und gelang erst nach Ownerbestätigung von Review-Evidence und Pflichtkriterium.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});

test('M4 stops the configured repair loop at its limit without launching another T3 run', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(240_000);
  test.info().annotations.push({ type: 'acceptance', description: 'A12' });
  test.info().annotations.push({ type: 'scenario', description: 'E25' });
  test.info().annotations.push({ type: 'expected', description: 'Ein Workflow mit max_repair_rounds=1 darf genau einen Folgelauf nach needs_changes anlegen und muss nach dessen zweitem Änderungsbericht pausieren, ohne dritten T3-Launch.' });
  await qaMocks.setT3Scenario('default');
  const project = await ownerApi.createProject({ name: `M4 Reparaturlimit ${randomUUID().slice(0, 6)}` });
  const { connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, 'M4 Reparaturlimit T3');
  const implementer = await createProfile(ownerApi, project, connection, 'M4 Reparatur', 'Implementierung', 'Rolle: Reparatur. Berichte, ob eine weitere Reparaturrunde nötig ist.');
  const taskResult = await createReadyTask(ownerApi, project.id, {
    title: 'M4 konfigurierte Reparaturrunde begrenzen',
    description: 'Eine einzelne Reparatur ist erlaubt; nach dem zweiten Änderungsbedarf muss der Ablauf nachvollziehbar pausieren.',
  });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const workflow = await createWorkflow(ownerApi, project.id, 'M4 maximal eine Reparaturrunde', [
    { id: 'implementation', kind: 'implementation', name: 'Bearbeitung', agent_profile_id: implementer.id, entry_conditions: [], run_completion_policy: defaultRunPolicy },
  ], [
    { from_stage_id: 'implementation', to_stage_id: 'implementation', on: 'needs_changes', conditions: [] },
  ], 1);
  const instance = await startWorkflow(ownerApi, task, workflow);
  const reporter = await createReportingAgent(ownerApi, project, baseURL);
  try {
    const reportIds = [];
    for (let index = 0; index < 2; index += 1) {
      const current = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (item) => item.run_ids.length === index + 1, `Reparaturlauf ${index + 1} muss verfügbar sein.`);
      const runId = current.run_ids[index];
      const result = await submitReport(ownerApi, reporter.agent, runId, task.version, {
        outcome: 'needs_changes',
        summary: `Die Implementierungsrolle meldet Änderungsbedarf ${index + 1}.`,
        label: `Reparaturbericht ${index + 1}`,
        text: `Gespeicherte Agentenmeldung ${index + 1}: Eine weitere Reparatur ist erforderlich.`,
      });
      reportIds.push(result.reportId);
      if (0 === index) {
        const next = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (item) => item.run_ids.length === 2 && item.repair_round === 1 && item.state === 'running', 'Die eine konfigurierte Reparaturrunde darf genau einen Folgelauf starten.');
        expect(next.run_ids).toHaveLength(2);
        const repairRun = await ownerApi.get(`/runs/${next.run_ids[1]}`);
        expect(repairRun.data.snapshot.handoff_source_run_id).toBe(runId);
        expect(repairRun.data.snapshot.handoff_snapshot.source_report_id).toBe(result.reportId);
      }
    }
    const paused = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (item) => item.state === 'paused', 'Nach Ausschöpfen des konfigurierten Reparaturlimits muss der Workflow anhalten.');
    expect(paused.current_stage_id).toBe('implementation');
    expect(paused.repair_round).toBe(1);
    expect(paused.pause_reason).toBe('Die konfigurierte Zahl der Reparaturrunden ist erreicht.');
    expect(paused.run_ids).toHaveLength(2);
    expect(paused.run_ids).toHaveLength(new Set(paused.run_ids).size);
    const reports = await Promise.all(paused.run_ids.map((runId, index) => ownerApi.get(`/runs/${runId}/result-reports/${reportIds[index]}`)));
    expect(reports.map((result) => result.data.id)).toEqual(reportIds);
    expect(reports.map((result) => result.data.outcome)).toEqual(['needs_changes', 'needs_changes']);
    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    expect(t3.accepted_launches).toHaveLength(2);
    expect(paused.run_ids).toHaveLength(t3.accepted_launches.length);
    recordEvidence(
      'M4: `max_repair_rounds=1` erlaubt genau einen Reparatur-Folgelauf und stoppt vor einem dritten T3-Launch.',
      `Workflow ${instance.id} speicherte zwei unterschiedliche needs_changes-Reports und zwei T3-Launches. repair_round blieb bei 1; die Instanz pausierte mit workflow_repair_limit, ohne dritten Run oder externe Zusatzarbeit anzulegen.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});
