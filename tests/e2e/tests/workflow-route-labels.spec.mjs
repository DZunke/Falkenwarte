import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

const runPolicy = {
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

function displayedDateTime(value) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function candidateMatchesEvent(candidate, event) {
  return candidate.from_stage_id === event.from_stage_id
    && candidate.to_stage_id === event.to_stage_id
    && candidate.on === event.outcome
    && (candidate.route_label_id ?? null) === (event.route_label_id ?? null);
}

async function configureT3(ownerApi, ownerPage, baseURL, qaMocks, project) {
  const created = await ownerApi.post('/connections', {
    name: `Route labels ${randomUUID().slice(0, 8)}`,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, {
    redirect_uri: new URL('/auth/t3/callback', baseURL).toString(),
  }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Die Browser-OAuth-Anmeldung muss T3 autorisieren.');
  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der MCP-Adapter muss den T3-Mock erfolgreich prüfen.');
  const projectRead = await ownerApi.get(`/projects/${project.id}`);
  expect(projectRead.response.status(), JSON.stringify(projectRead.data)).toBe(200);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: projectRead.data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
  return connection;
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
    default_run_completion_policy: runPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data;
}

async function createReporter(ownerApi, baseURL, projectId) {
  const token = await ownerApi.createTechnicalToken({
    label: `Workflowroute ${randomUUID().slice(0, 8)}`,
    projectIds: [projectId],
    capabilities: ['tasks.read', 'runs.read', 'runs.report'],
  });
  return { token, ...await createAgentSimulator(baseURL, token.token) };
}

async function boardTargets(ownerApi, projectId) {
  const board = await ownerApi.ensureDefaultBoard(projectId);
  const statuses = await ownerApi.get(`/projects/${projectId}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const targets = {};
  for (const category of ['ready', 'active', 'review']) {
    const status = statuses.data.items.find((item) => item.category === category);
    const column = board.columns.find((item) => item.status_ids.includes(status?.id));
    expect(status, `Das Projekt muss einen Status ${category} besitzen.`).toBeTruthy();
    expect(column, `Das Board muss eine Spalte für ${category} besitzen.`).toBeTruthy();
    targets[category] = { board_id: board.id, column_id: column.id };
  }
  return { board, targets, statuses: statuses.data.items };
}

async function createWorkflow(ownerApi, projectId, name, stages, transitions, maxRepairRounds = 2) {
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

function stage(id, name, profile, boardTarget) {
  return {
    id,
    kind: 'agent_run',
    name,
    agent_profile_id: profile.id,
    entry_conditions: [],
    run_completion_policy: runPolicy,
    instructions: `Führe die Phase ${name} aus und dokumentiere das Ergebnis.`,
    board_target: boardTarget,
  };
}

async function createReadyTask(ownerApi, projectId, board, values = {}) {
  const status = board.statuses.find((item) => item.category === 'ready');
  expect(status).toBeTruthy();
  return ownerApi.createTask(projectId, { title: 'Workflowroute prüfen', ...values, status_id: status.id });
}

async function startWorkflow(ownerApi, task, workflow) {
  const result = await ownerApi.post(`/tasks/${task.id}/workflow-instances`, {
    workflow_id: workflow.id,
    definition_version: workflow.definition_version,
    task_revision: task.version,
  }, { version: task.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(202);
  const instanceId = result.data.resource?.id ?? result.data.instance_id;
  expect(instanceId).toBeTruthy();
  return readUntil(ownerApi, `/workflow-instances/${instanceId}`, (instance) => instance.run_ids.length >= 1, 'Der erste Workflowlauf muss angelegt werden.');
}

async function runningRun(ownerApi, runId) {
  return readUntil(ownerApi, `/runs/${runId}`, (run) => ['running', 'verifying'].includes(run.state) && Boolean(run.attempts[0]?.external_thread_id), 'Der T3-Auftrag muss gestartet und beobachtbar sein.');
}

async function submitReport(ownerApi, agent, runId, options) {
  const { outcome = 'reported_success', summary, openQuestions = [], routeLabelId, reportId = randomUUID() } = options;
  const initialRun = await runningRun(ownerApi, runId);
  let expectedVersion = initialRun.version;
  let result;
  for (let submission = 0; submission < 3; submission += 1) {
    const payload = {
      run_id: runId,
      report_id: reportId,
      attempt_no: initialRun.attempt_no,
      task_revision: initialRun.snapshot.task_revision,
      outcome,
      summary,
      open_questions: openQuestions,
      artifacts: [{ kind: 'note', label: `Ergebnis ${initialRun.stage}`, text: summary }],
      client_request_id: randomUUID(),
      expected_version: expectedVersion,
    };
    if (Object.hasOwn(options, 'routeLabelId')) payload.route_label_id = routeLabelId;
    result = await agent.call('runs_report_result', payload);
    if (!result.isError) break;

    const problem = result.structuredContent;
    expect(problem, JSON.stringify(problem)).toMatchObject({ status: 412, code: 'version_conflict' });
    expect(submission, 'Der Bericht darf höchstens nach zwei konkreten Runversionskonflikten erneut gesendet werden.').toBeLessThan(2);
    const latest = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.version > expectedVersion, 'Ein konkreter Runversionskonflikt muss einen neueren Laufstand liefern.');
    expect(latest.snapshot.task_revision).toBe(initialRun.snapshot.task_revision);
    expect(latest.attempt_no).toBe(initialRun.attempt_no);
    expect(latest.report_ids ?? []).toEqual(initialRun.report_ids ?? []);
    expect(['running', 'verifying']).toContain(latest.state);
    expectedVersion = latest.version;
  }
  expect(result?.isError, JSON.stringify(result?.structuredContent)).toBe(false);
  const report = await readUntil(ownerApi, `/runs/${runId}/result-reports/${reportId}`, (item) => item.id === reportId, 'Der Ergebnisbericht muss öffentlich lesbar sein.');
  expect(report).toMatchObject({ run_id: runId, task_revision: initialRun.snapshot.task_revision, accepted_for_reconciliation: true });
  const expectedState = 'reported_success' === outcome ? 'succeeded' : 'failed';
  const settledRun = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.state === expectedState, 'T3-Abschluss und Agentenbericht müssen den Phasenlauf abschließen.');
  return { initialRun, settledRun, report, reportId };
}

async function taskOnBoardColumn(ownerApi, boardId, columnId, taskId) {
  const result = await ownerApi.get(`/boards/${boardId}/view?limit_per_column=100`);
  expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
  const column = result.data.columns.find((item) => item.column_id === columnId);
  expect(column).toBeTruthy();
  return column.items.some((item) => item.id === taskId);
}

async function taskFlow(ownerApi, taskId, instanceId) {
  const flow = await ownerApi.get(`/tasks/${taskId}/flow?limit=100`);
  expect(flow.response.status(), JSON.stringify(flow.data)).toBe(200);
  const instance = flow.data.items.find((item) => item.kind === 'workflow_instance' && item.id === instanceId);
  expect(instance, 'Der öffentliche Ticketablauf muss die Workflowinstanz enthalten.').toBeTruthy();
  return instance;
}

async function setTopicLabels(ownerApi, task, labels) {
  const primary = labels[0]?.id ?? null;
  const result = await ownerApi.put(`/tasks/${task.id}/labels`, {
    label_ids: labels.map((label) => label.id),
    primary_topic_label_id: primary,
    reason: 'Die Eigentümerin hat den passenden Workflowzweig nach der Abklärung ausgewählt.',
    routing_application: 'next_instance',
  }, { version: task.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
  return result.data;
}

async function resumeWorkflow(ownerApi, instance) {
  const result = await ownerApi.post(`/workflow-instances/${instance.id}/control`, {
    action: 'resume',
    reason: 'Die Themenlabels wurden geklärt; setze die gewählte Route fort.',
  }, { version: instance.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(202);
  return readUntil(ownerApi, `/workflow-instances/${instance.id}`, (current) => current.run_ids.length > instance.run_ids.length, 'Die korrigierte Route muss eine neue Phase starten.');
}

test('reporting role selects a frozen route back to Discovery with its report handoff', async ({ ownerApi, ownerPage, baseURL, qaMocks }, testInfo) => {
  test.setTimeout(240_000);
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 6);
  const project = await ownerApi.createProject({ name: `Workflowroute explizit ${suffix}` });
  const connection = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project);
  const { board, targets, statuses } = await boardTargets(ownerApi, project.id);
  const discovery = await createProfile(ownerApi, project, connection, `Discovery ${suffix}`, 'Discovery', 'Lege eine belastbare Recherche an.');
  const reporting = await createProfile(ownerApi, project, connection, `Reporting ${suffix}`, 'Reporting', 'Prüfe die Recherche und wähle die fachlich passende Rückroute.');
  const labelA = await ownerApi.createLabel(project.id, { name: `Discovery ${suffix}`, key: `discovery-${suffix}`, color: '#315B77' });
  const labelB = await ownerApi.createLabel(project.id, { name: `Recherche erweitern ${suffix}`, key: `research-${suffix}`, color: '#7765A3' });
  const labelC = await ownerApi.createLabel(project.id, { name: `Quelle gegenprüfen ${suffix}`, key: `source-check-${suffix}`, color: '#39785B' });
  const workflow = await createWorkflow(ownerApi, project.id, `Redaktionelle Route ${suffix}`, [
    stage('discovery', 'Discovery', discovery, targets.ready),
    stage('reporting', 'Reporting', reporting, targets.review),
    stage('research', 'Recherche vertiefen', discovery, targets.active),
    stage('fallback', 'Redaktionelle Klärung', discovery, targets.ready),
  ], [
    { from_stage_id: 'discovery', to_stage_id: 'reporting', on: 'accepted', conditions: [] },
    { from_stage_id: 'reporting', to_stage_id: 'discovery', on: 'needs_changes', route_label_id: labelA.id, conditions: [] },
    { from_stage_id: 'reporting', to_stage_id: 'discovery', on: 'needs_changes', route_label_id: labelB.id, conditions: [] },
    { from_stage_id: 'reporting', to_stage_id: 'discovery', on: 'needs_changes', route_label_id: labelC.id, conditions: [] },
    { from_stage_id: 'reporting', to_stage_id: 'fallback', on: 'needs_changes', conditions: [] },
  ]);
  const createdTask = await createReadyTask(ownerApi, project.id, { statuses });
  const task = (await ownerApi.get(`/tasks/${createdTask.id}`)).data;
  const discoveryReporter = await createReporter(ownerApi, baseURL, project.id);
  const instance = await startWorkflow(ownerApi, task, workflow);
  const firstRunId = instance.run_ids[0];
  const firstRun = await runningRun(ownerApi, firstRunId);
  expect(firstRun.snapshot).toMatchObject({ agent_profile_id: discovery.id, stage_name: 'Discovery' });
  expect(firstRun.snapshot.workflow_routes).toEqual(expect.arrayContaining([
    expect.objectContaining({ on: 'accepted', to_stage_id: 'reporting', is_default: true, route_label_id: null }),
  ]));
  let discoveryResult;
  try {
    discoveryResult = await submitReport(ownerApi, discoveryReporter.agent, firstRunId, {
      summary: 'Die Discovery hat die Ausgangslage gesammelt und zur redaktionellen Prüfung übergeben.',
    });
  } finally {
    await discoveryReporter.close();
  }
  const withReporting = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (current) => current.run_ids.length === 2, 'Die angenommene Discovery muss die Reportingrolle starten.');
  const reportingRunId = withReporting.run_ids[1];
  const reportingRun = await runningRun(ownerApi, reportingRunId);
  expect(reportingRun.snapshot).toMatchObject({ agent_profile_id: reporting.id, stage_name: 'Reporting', stage_board_target: targets.review });
  expect(reportingRun.snapshot.workflow_routes).toEqual(expect.arrayContaining([
    expect.objectContaining({ on: 'needs_changes', to_stage_id: 'discovery', route_label_id: labelA.id, route_label_name: labelA.name }),
    expect.objectContaining({ on: 'needs_changes', to_stage_id: 'discovery', route_label_id: labelB.id, route_label_name: labelB.name }),
    expect.objectContaining({ on: 'needs_changes', to_stage_id: 'discovery', route_label_id: labelC.id, route_label_name: labelC.name }),
    expect.objectContaining({ on: 'needs_changes', to_stage_id: 'fallback', is_default: true, route_label_id: null }),
  ]));
  expect((await ownerApi.get(`/tasks/${task.id}`)).data.status_category).toBe('review');
  expect(await taskOnBoardColumn(ownerApi, board.id, targets.review.column_id, task.id)).toBe(true);
  const reporter = await createReporter(ownerApi, baseURL, project.id);
  try {
    const reportId = randomUUID();
    const beforeInvalid = (await ownerApi.get(`/runs/${reportingRunId}`)).data;
    const taskBeforeInvalid = (await ownerApi.get(`/tasks/${task.id}`)).data;
    const evidenceBeforeInvalid = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidenceBeforeInvalid.response.status(), JSON.stringify(evidenceBeforeInvalid.data)).toBe(200);
    const existingEvidenceIds = evidenceBeforeInvalid.data.items.map((item) => item.id).sort();
    const invalid = await reporter.agent.callRaw('runs_report_result', {
      run_id: reportingRunId,
      report_id: reportId,
      attempt_no: reportingRun.attempt_no,
      task_revision: reportingRun.snapshot.task_revision,
      outcome: 'needs_changes',
      summary: 'Der ungültige Routeversuch darf nichts speichern.',
      open_questions: ['Welche Recherchequelle fehlt noch?'],
      artifacts: [{ kind: 'note', label: 'Nicht speichern', text: 'Die Route-ID gehört zu keiner eingefrorenen Option.' }],
      route_label_id: randomUUID(),
      client_request_id: randomUUID(),
      expected_version: beforeInvalid.version,
    });
    expect(invalid.response.status(), JSON.stringify(invalid.data)).toBe(200);
    expect(invalid.data?.error).toBeUndefined();
    expect(invalid.data?.result?.isError).toBe(true);
    expect(invalid.data?.result?.structuredContent).toMatchObject({ status: 409, code: 'workflow_route_unavailable' });
    expect((await ownerApi.get(`/runs/${reportingRunId}`)).data).toMatchObject({ version: beforeInvalid.version, report_ids: [] });
    expect((await ownerApi.get(`/tasks/${task.id}`)).data.version).toBe(taskBeforeInvalid.version);
    expect((await ownerApi.get(`/runs/${reportingRunId}/result-reports/${reportId}`)).response.status()).toBe(404);
    const evidenceAfterRejection = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidenceAfterRejection.response.status(), JSON.stringify(evidenceAfterRejection.data)).toBe(200);
    expect(evidenceAfterRejection.data.items.map((item) => item.id).sort()).toEqual(existingEvidenceIds);
    expect(evidenceAfterRejection.data.items.map((item) => item.label)).not.toContain('Nicht speichern');
    const flowAfterRejection = await taskFlow(ownerApi, task.id, instance.id);
    expect(flowAfterRejection.runs.map((run) => run.id)).toEqual([firstRunId, reportingRunId]);
    expect(flowAfterRejection.selected_transitions).toHaveLength(1);

    const validResult = await submitReport(ownerApi, reporter.agent, reportingRunId, {
      outcome: 'needs_changes',
      summary: 'Das Reporting schickt die Recherche gezielt an Discovery zurück.',
      openQuestions: ['Welche Quelle belegt die noch offene Chronologie?'],
      routeLabelId: labelA.id,
      reportId,
    });
    expect(validResult.report).toMatchObject({ route_label_id: labelA.id, route_label_name: labelA.name, outcome: 'needs_changes' });
    const withDiscovery = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (current) => current.run_ids.length === 3, 'Die ausgewählte Route muss die vorherige Discoveryrolle erneut starten.');
    const returnedRunId = withDiscovery.run_ids[2];
    const returnedRun = await runningRun(ownerApi, returnedRunId);
    const returnedTask = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(returnedRun.snapshot).toMatchObject({
      agent_profile_id: discovery.id,
      stage_name: 'Discovery',
      stage_board_target: targets.ready,
      task_revision: returnedTask.version,
      handoff_source_run_id: reportingRunId,
      handoff_snapshot: {
        source_report_id: reportId,
        task_revision_id: reportingRun.snapshot.task_revision,
        outcome: 'needs_changes',
        open_questions: ['Welche Quelle belegt die noch offene Chronologie?'],
      },
    });
    expect(returnedRun.snapshot.handoff_snapshot.reported_evidence_ids).toEqual(validResult.report.evidence_ids);
    expect(returnedTask.status_category).toBe('ready');
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.ready.column_id, task.id)).toBe(true);
    const finalFlow = await taskFlow(ownerApi, task.id, instance.id);
    expect(finalFlow.selected_transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_stage_id: 'reporting',
        to_stage_id: 'discovery',
        outcome: 'needs_changes',
        route_label_id: labelA.id,
        route_label_name: labelA.name,
        source_run_id: reportingRunId,
        report_id: reportId,
      }),
    ]));
    expect(finalFlow.runs.at(-1)).toMatchObject({ id: returnedRunId, handoff: expect.objectContaining({ source_report_id: reportId }) });

    await ownerPage.goto(`/#/project/${project.id}/board?task=${task.id}&tab=flow`);
    await expect(ownerPage.getByRole('heading', { name: task.title })).toBeVisible();
    await expect(ownerPage.getByRole('tab', { name: 'Ablauf' })).toHaveAttribute('aria-selected', 'true');
    const flowPanel = ownerPage.getByRole('tabpanel', { name: 'Ablauf' });
    await expect(flowPanel.getByText(`Workflow: ${workflow.name} · Version ${workflow.definition_version}`, { exact: true })).toBeVisible();
    const workflowGraph = flowPanel.getByTestId(`task-flow-workflow-graph-${instance.id}`).getByTestId('workflow-editor-graph');
    await expect(workflowGraph.getByTestId('workflow-graph-stage-discovery')).toContainText('Aktuell');
    await expect(workflowGraph.getByTestId('workflow-graph-stage-reporting')).toContainText('Erledigt');
    await expect(workflowGraph.getByTestId('workflow-graph-stage-research')).toContainText('Offen');
    const plannedEdges = workflowGraph.locator('[data-testid^="workflow-graph-planned-transition-"]');
    const selectedCandidateIndexes = finalFlow.candidate_transitions.flatMap((candidate, index) =>
      finalFlow.selected_transitions.some((event) => candidateMatchesEvent(candidate, event)) ? [index] : []);
    expect(selectedCandidateIndexes).toHaveLength(finalFlow.selected_transitions.length);
    for (const index of selectedCandidateIndexes) {
      await expect(workflowGraph.getByTestId(`workflow-graph-planned-transition-${index}`)).toHaveCount(0);
    }
    await expect(plannedEdges).toHaveCount(finalFlow.candidate_transitions.length - new Set(selectedCandidateIndexes).size);
    const alternativeIndexes = [labelB.id, labelC.id].map((routeLabelId) => finalFlow.candidate_transitions.findIndex((transition) => transition.route_label_id === routeLabelId));
    expect(alternativeIndexes.every((index) => index >= 0)).toBe(true);
    for (const index of alternativeIndexes) {
      expect(finalFlow.selected_transitions.some((event) => candidateMatchesEvent(finalFlow.candidate_transitions[index], event))).toBe(false);
    }
    const defaultAlternativeIndex = finalFlow.candidate_transitions.findIndex((transition) => transition.from_stage_id === 'reporting' && transition.to_stage_id === 'fallback' && !transition.route_label_id);
    expect(defaultAlternativeIndex).toBeGreaterThanOrEqual(0);
    expect(finalFlow.selected_transitions.some((event) => candidateMatchesEvent(finalFlow.candidate_transitions[defaultAlternativeIndex], event))).toBe(false);
    const sourceStageIndex = finalFlow.phases.findIndex((phase) => phase.id === 'reporting');
    const targetStageIndex = finalFlow.phases.findIndex((phase) => phase.id === 'discovery');
    expect(sourceStageIndex).toBeGreaterThanOrEqual(0);
    expect(targetStageIndex).toBeGreaterThanOrEqual(0);
    const routeBundle = workflowGraph.getByTestId(`workflow-graph-route-bundle-${sourceStageIndex}-${targetStageIndex}`);
    await expect(routeBundle).toBeVisible();
    await expect(routeBundle).toContainText(/2 (weitere )?Routen/);
    await routeBundle.click();
    const routeBundleDetails = ownerPage.getByTestId(`workflow-graph-route-bundle-detail-${sourceStageIndex}-${targetStageIndex}`);
    await expect(routeBundleDetails).toBeVisible();
    await expect(routeBundleDetails).not.toContainText(labelA.name);
    const alternativeItems = alternativeIndexes.map((index) => ownerPage.getByTestId(`workflow-graph-route-bundle-item-${sourceStageIndex}-${targetStageIndex}-${index}`));
    for (const [position, alternative] of alternativeItems.entries()) {
      const label = position === 0 ? labelB : labelC;
      await expect(alternative).toBeVisible();
      await expect(alternative).toContainText(label.name);
      await expect(alternative).toContainText('Möglich');
    }
    const instanceBeforeInspectingAlternative = await ownerApi.get(`/workflow-instances/${instance.id}`);
    expect(instanceBeforeInspectingAlternative.data.run_ids).toHaveLength(3);
    await alternativeItems[0].click();
    await expect(routeBundleDetails).toContainText(labelB.name);
    const selectedPlannedRoute = ownerPage.getByTestId(`workflow-graph-route-bundle-selection-${sourceStageIndex}-${targetStageIndex}`);
    await expect(selectedPlannedRoute).toContainText(labelB.name);
    await expect(selectedPlannedRoute).toContainText('Wird erst nach einer tatsächlichen Auswahl ausgeführt.');
    await alternativeItems[1].click();
    await expect(routeBundleDetails).toContainText(labelC.name);
    await expect(selectedPlannedRoute).toContainText(labelC.name);
    expect((await ownerApi.get(`/workflow-instances/${instance.id}`)).data.run_ids).toHaveLength(3);
    expect((await taskFlow(ownerApi, task.id, instance.id)).selected_transitions).toEqual(finalFlow.selected_transitions);
    await routeBundle.click();
    await expect(routeBundleDetails).toBeHidden();
    const plannedDefaultAlternative = workflowGraph.getByTestId(`workflow-graph-planned-transition-${defaultAlternativeIndex}`);
    await expect(plannedDefaultAlternative).toBeVisible();
    await expect(plannedDefaultAlternative).toHaveAccessibleName(/Möglich/);
    await expect(plannedDefaultAlternative).toHaveAccessibleName(/Standardroute/);
    const actualRoute = workflowGraph.locator('[data-testid^="workflow-graph-run-route-"]').filter({ hasText: labelA.name });
    await expect(actualRoute).toHaveCount(1);
    await expect(actualRoute).toHaveAccessibleName(/1 tatsächliche Besuche/);
    await actualRoute.click();
    const activityDetails = flowPanel.getByTestId('task-flow-activity-details');
    await expect(activityDetails).toBeVisible();
    await expect(activityDetails).toContainText(`Themenlabel: ${labelA.name}`);
    const selectedReport = activityDetails.getByTestId(`task-flow-report-${reportId}`);
    await expect(selectedReport).toContainText(validResult.report.summary);
    await expect(selectedReport).toContainText(labelA.name);
    const actualTransition = finalFlow.selected_transitions.find((transition) => transition.report_id === reportId);
    expect(actualTransition).toBeTruthy();
    await expect(activityDetails).toContainText(displayedDateTime(actualTransition.selected_at));
    await expect(selectedReport).toContainText(displayedDateTime(validResult.report.received_at));
    const reportingFlowRun = finalFlow.runs.find((run) => run.id === reportingRunId);
    expect(reportingFlowRun?.handoff).toBeTruthy();
    const selectedHandoff = activityDetails.getByTestId(`task-flow-run-details-${reportingRunId}`).locator('details').filter({ hasText: 'Übergabeprotokoll ansehen' });
    await expect(selectedHandoff).toHaveCount(1);
    await expect(selectedHandoff).toHaveAttribute('open', '');
    await expect(selectedHandoff).toContainText(discoveryResult.report.summary);
    await expect(selectedHandoff).toContainText(`Herkunft: Versuch ${reportingFlowRun.handoff.source_attempt_no} · Ticketrevision ${reportingFlowRun.handoff.task_revision}`);
    await expect(selectedHandoff).toContainText(displayedDateTime(discoveryResult.report.received_at));
    await testInfo.attach('ticket-flow-selected-route-handoff', { body: await ownerPage.screenshot({ fullPage: true }), contentType: 'image/png' });

    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    expect(journal.accepted_launches).toHaveLength(3);
    const reportingLaunch = journal.accepted_launches.find((launch) => launch.payload.message.includes(`Run-ID: ${reportingRunId}\n`));
    expect(reportingLaunch?.payload.message).toContain(`${labelA.name} (route_label_id: ${labelA.id})`);
    expect(reportingLaunch?.payload.message).toContain(`${labelB.name} (route_label_id: ${labelB.id})`);
    expect(reportingLaunch?.payload.message).toContain(`${labelC.name} (route_label_id: ${labelC.id})`);
    recordEvidence(
      'Die Reportingrolle wählt eine eingefrorene Themenroute zurück zur vorherigen Discoveryphase.',
      `Run ${reportingRunId} bot drei benannte Topicrouten und den Standardweg im Dispatch an. Eine fremde Route-ID wurde mit 409 ohne Report, Evidenz, Taskrevision oder Workflowänderung abgewiesen. Die gültige Route ${labelA.name} startete Discovery erneut, setzte das Ticket zurück auf ready und übergab Report, Quellrevision, Nachweis-ID und offene Frage unverändert. Im Ticketablauf blieben die Alternativen ${labelB.name} und ${labelC.name} als bedienbare Bündeloptionen sichtbar; ihre Auswahl änderte weder den Lauf noch die Historie.`,
      { t3: journal },
    );
  } finally {
    await reporter.close();
  }
});

test('topic labels select one route, while ambiguity or a missing route waits for owner correction', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(360_000);
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 6);
  const project = await ownerApi.createProject({ name: `Workflowroute automatisch ${suffix}` });
  const connection = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project);
  const { board, targets, statuses } = await boardTargets(ownerApi, project.id);
  const discovery = await createProfile(ownerApi, project, connection, `Discovery ${suffix}`, 'Discovery', 'Bearbeite die nächste Phase auf Basis der Übergabe.');
  const reporting = await createProfile(ownerApi, project, connection, `Reporting ${suffix}`, 'Reporting', 'Melde Änderungsbedarf mit einer konkreten Route, sofern sie eindeutig ist.');
  const labelA = await ownerApi.createLabel(project.id, { name: `Discovery ${suffix}`, key: `discovery-${suffix}`, color: '#315B77' });
  const labelB = await ownerApi.createLabel(project.id, { name: `Recherche ${suffix}`, key: `research-${suffix}`, color: '#7765A3' });
  const reportStage = stage('reporting', 'Reporting', reporting, targets.review);
  const discoveryStage = stage('discovery', 'Discovery', discovery, targets.ready);
  const researchStage = stage('research', 'Recherche vertiefen', discovery, targets.active);
  const defaultStage = stage('default', 'Redaktionelle Klärung', discovery, targets.ready);
  const automaticWorkflow = await createWorkflow(ownerApi, project.id, `Automatische Route ${suffix}`, [reportStage, discoveryStage, researchStage, defaultStage], [
    { from_stage_id: 'reporting', to_stage_id: 'discovery', on: 'needs_changes', route_label_id: labelA.id, conditions: [] },
    { from_stage_id: 'reporting', to_stage_id: 'research', on: 'needs_changes', route_label_id: labelB.id, conditions: [] },
    { from_stage_id: 'reporting', to_stage_id: 'default', on: 'needs_changes', conditions: [] },
  ]);
  const reporter = await createReporter(ownerApi, baseURL, project.id);
  try {
    const labelTask = await createReadyTask(ownerApi, project.id, { statuses }, { label_ids: [labelB.id], title: `Eindeutiges Thema ${suffix}` });
    const labelTaskState = (await ownerApi.get(`/tasks/${labelTask.id}`)).data;
    const labelInstance = await startWorkflow(ownerApi, labelTaskState, automaticWorkflow);
    const labelRunId = labelInstance.run_ids[0];
    const labelResult = await submitReport(ownerApi, reporter.agent, labelRunId, {
      outcome: 'needs_changes',
      summary: 'Das Thema der Aufgabe passt eindeutig zur Recherchevertiefung.',
    });
    expect(labelResult.report).not.toHaveProperty('route_label_id');
    const withResearch = await readUntil(ownerApi, `/workflow-instances/${labelInstance.id}`, (current) => current.run_ids.length === 2, 'Ein einziges passendes Themenlabel muss seine Phase auswählen.');
    const researchRunId = withResearch.run_ids[1];
    const researchRun = await runningRun(ownerApi, researchRunId);
    expect(researchRun).toMatchObject({ stage: 'research', snapshot: { agent_profile_id: discovery.id, stage_name: 'Recherche vertiefen' } });
    const researchFlow = await taskFlow(ownerApi, labelTask.id, labelInstance.id);
    expect(researchFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: labelB.id, route_label_name: labelB.name, to_stage_id: 'research' });
    expect((await ownerApi.get(`/tasks/${labelTask.id}`)).data.status_category).toBe('active');
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.active.column_id, labelTask.id)).toBe(true);
    await submitReport(ownerApi, reporter.agent, researchRunId, { summary: 'Die Recherchevertiefung ist abgeschlossen.' });
    await readUntil(ownerApi, `/workflow-instances/${labelInstance.id}`, (current) => current.state === 'succeeded', 'Die gewählte Recherchephase muss abschließen.');

    const defaultTask = await createReadyTask(ownerApi, project.id, { statuses }, { title: `Standardroute ${suffix}` });
    const defaultTaskState = (await ownerApi.get(`/tasks/${defaultTask.id}`)).data;
    const defaultInstance = await startWorkflow(ownerApi, defaultTaskState, automaticWorkflow);
    const defaultRunId = defaultInstance.run_ids[0];
    const defaultResult = await submitReport(ownerApi, reporter.agent, defaultRunId, {
      outcome: 'needs_changes',
      summary: 'Kein Themenlabel passt; der konfigurierte Standardweg soll greifen.',
    });
    expect(defaultResult.report).not.toHaveProperty('route_label_id');
    const withDefault = await readUntil(ownerApi, `/workflow-instances/${defaultInstance.id}`, (current) => current.run_ids.length === 2, 'Ohne passendes Themenlabel muss der konfigurierte Standardweg greifen.');
    const defaultTargetRunId = withDefault.run_ids[1];
    const defaultTargetRun = await runningRun(ownerApi, defaultTargetRunId);
    expect(defaultTargetRun).toMatchObject({ stage: 'default', snapshot: { stage_name: 'Redaktionelle Klärung' } });
    const defaultFlow = await taskFlow(ownerApi, defaultTask.id, defaultInstance.id);
    expect(defaultFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: null, to_stage_id: 'default' });
    await submitReport(ownerApi, reporter.agent, defaultTargetRunId, { summary: 'Die Standardklärung ist abgeschlossen.' });
    await readUntil(ownerApi, `/workflow-instances/${defaultInstance.id}`, (current) => current.state === 'succeeded', 'Die Standardphase muss abschließen.');

    const conflictTask = await createReadyTask(ownerApi, project.id, { statuses }, { label_ids: [labelA.id, labelB.id], title: `Mehrdeutige Route ${suffix}` });
    const conflictTaskState = (await ownerApi.get(`/tasks/${conflictTask.id}`)).data;
    const conflictInstance = await startWorkflow(ownerApi, conflictTaskState, automaticWorkflow);
    const conflictRunId = conflictInstance.run_ids[0];
    await submitReport(ownerApi, reporter.agent, conflictRunId, {
      outcome: 'needs_changes',
      summary: 'Zwei zugeordnete Themenlabels zeigen auf verschiedene Phasen.',
    });
    const pausedConflict = await readUntil(ownerApi, `/workflow-instances/${conflictInstance.id}`, (current) => current.state === 'paused', 'Mehrere passende Themenlabels müssen vor einer beliebigen Auswahl pausieren.');
    expect(pausedConflict.run_ids).toEqual([conflictRunId]);
    expect(pausedConflict.pause_reason).toContain(labelA.name);
    expect(pausedConflict.pause_reason).toContain(labelB.name);
    const correctedConflictTask = await setTopicLabels(ownerApi, (await ownerApi.get(`/tasks/${conflictTask.id}`)).data, [labelA]);
    expect(correctedConflictTask.label_ids).toContain(labelA.id);
    expect(correctedConflictTask.label_ids).not.toContain(labelB.id);
    const resumedConflict = await resumeWorkflow(ownerApi, pausedConflict);
    const correctedRouteRunId = resumedConflict.run_ids[1];
    const correctedRouteRun = await runningRun(ownerApi, correctedRouteRunId);
    expect(correctedRouteRun).toMatchObject({ stage: 'discovery', snapshot: { agent_profile_id: discovery.id } });
    const correctedConflictFlow = await taskFlow(ownerApi, conflictTask.id, conflictInstance.id);
    expect(correctedConflictFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: labelA.id, route_label_name: labelA.name, to_stage_id: 'discovery' });
    expect((await ownerApi.get(`/tasks/${conflictTask.id}`)).data.status_category).toBe('ready');
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.ready.column_id, conflictTask.id)).toBe(true);
    await submitReport(ownerApi, reporter.agent, correctedRouteRunId, { summary: 'Die nach Korrektur eindeutige Discoveryroute ist abgeschlossen.' });
    await readUntil(ownerApi, `/workflow-instances/${conflictInstance.id}`, (current) => current.state === 'succeeded', 'Die korrigierte benannte Route muss abschließen.');

    const noDefaultWorkflow = await createWorkflow(ownerApi, project.id, `Route ohne Standard ${suffix}`, [reportStage, discoveryStage, researchStage], [
      { from_stage_id: 'reporting', to_stage_id: 'discovery', on: 'needs_changes', route_label_id: labelA.id, conditions: [] },
      { from_stage_id: 'reporting', to_stage_id: 'research', on: 'needs_changes', route_label_id: labelB.id, conditions: [] },
    ]);
    const missingRouteTask = await createReadyTask(ownerApi, project.id, { statuses }, { title: `Route fehlt ${suffix}` });
    const missingRouteTaskState = (await ownerApi.get(`/tasks/${missingRouteTask.id}`)).data;
    const missingRouteInstance = await startWorkflow(ownerApi, missingRouteTaskState, noDefaultWorkflow);
    const missingRouteRunId = missingRouteInstance.run_ids[0];
    await submitReport(ownerApi, reporter.agent, missingRouteRunId, {
      outcome: 'needs_changes',
      summary: 'Für dieses Ticket fehlt eine eindeutige Themenroute.',
    });
    const pausedMissing = await readUntil(ownerApi, `/workflow-instances/${missingRouteInstance.id}`, (current) => current.state === 'paused', 'Ohne passendes Themenlabel und ohne Standardroute muss die Workflowinstanz warten.');
    expect(pausedMissing.run_ids).toEqual([missingRouteRunId]);
    expect(pausedMissing.pause_reason).toContain('kein Standardübergang');
    const correctedMissingTask = await setTopicLabels(ownerApi, (await ownerApi.get(`/tasks/${missingRouteTask.id}`)).data, [labelA]);
    expect(correctedMissingTask.primary_topic_label_id).toBe(labelA.id);
    const resumedMissing = await resumeWorkflow(ownerApi, pausedMissing);
    const missingTargetRunId = resumedMissing.run_ids[1];
    expect(await runningRun(ownerApi, missingTargetRunId)).toMatchObject({ stage: 'discovery', snapshot: { agent_profile_id: discovery.id } });
    const correctedMissingFlow = await taskFlow(ownerApi, missingRouteTask.id, missingRouteInstance.id);
    expect(correctedMissingFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: labelA.id, route_label_name: labelA.name, to_stage_id: 'discovery' });
    expect((await ownerApi.get(`/tasks/${missingRouteTask.id}`)).data.status_category).toBe('ready');
    await submitReport(ownerApi, reporter.agent, missingTargetRunId, { summary: 'Die nach Eigentümerkorrektur eindeutige Discoveryroute ist abgeschlossen.' });
    await readUntil(ownerApi, `/workflow-instances/${missingRouteInstance.id}`, (current) => current.state === 'succeeded', 'Die korrigierte Route ohne Standardweg muss abschließen.');

    const labelFlow = await taskFlow(ownerApi, labelTask.id, labelInstance.id);
    expect(labelFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: labelB.id, route_label_name: labelB.name, outcome: 'needs_changes' });
    const conflictFlow = await taskFlow(ownerApi, conflictTask.id, conflictInstance.id);
    expect(conflictFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: labelA.id, route_label_name: labelA.name });
    const missingFlow = await taskFlow(ownerApi, missingRouteTask.id, missingRouteInstance.id);
    expect(missingFlow.selected_transitions.at(-1)).toMatchObject({ route_label_id: labelA.id, route_label_name: labelA.name });
    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    expect(journal.accepted_launches).toHaveLength(8);
    recordEvidence(
      'Automatische Workflowrouten beachten eindeutige Themenlabels und warten bei widersprüchlicher oder fehlender Auswahl auf die Eigentümerin.',
      `Das Label ${labelB.name} wählte die vertiefende Recherche, ein Ticket ohne Routenlabel nahm den konfigurierten Standardweg. Die mehrdeutigen Labels ${labelA.name} und ${labelB.name} pausierten ohne Zusatzlauf; nach Entfernung des Konflikts wurde ${labelA.name} verwendet. Ein Workflow ohne Standardroute pausierte ebenfalls, bis die Eigentümerin ${labelA.name} zuordnete. Alle korrigierten Tickets wechselten beim Phaseneintritt auf das jeweilige Boardziel.`,
      { t3: journal },
    );
  } finally {
    await reporter.close();
  }
});

test('a blocked default route back to a visited earlier phase consumes the repair limit', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(240_000);
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 6);
  const project = await ownerApi.createProject({ name: `Workflowroute Rückkehr ${suffix}` });
  const connection = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project);
  const { targets, statuses } = await boardTargets(ownerApi, project.id);
  const implementation = await createProfile(ownerApi, project, connection, `Bearbeitung ${suffix}`, 'Implementation', 'Setze den fachlichen Auftrag um.');
  const review = await createProfile(ownerApi, project, connection, `Review ${suffix}`, 'Review', 'Prüfe den aktuellen Arbeitsstand.');
  const workflow = await createWorkflow(ownerApi, project.id, `Blockierte Standardrückkehr ${suffix}`, [
    stage('implementation', 'Bearbeitung', implementation, targets.active),
    stage('review', 'Prüfung', review, targets.review),
  ], [
    { from_stage_id: 'implementation', to_stage_id: 'review', on: 'accepted', conditions: [] },
    { from_stage_id: 'review', to_stage_id: 'implementation', on: 'blocked', conditions: [] },
  ], 0);
  expect(workflow.transitions.find((transition) => transition.on === 'blocked')).not.toHaveProperty('route_label_id');
  const task = (await ownerApi.get(`/tasks/${(await createReadyTask(ownerApi, project.id, { statuses })).id}`)).data;
  const reporter = await createReporter(ownerApi, baseURL, project.id);
  try {
    const instance = await startWorkflow(ownerApi, task, workflow);
    const implementationRunId = instance.run_ids[0];
    await submitReport(ownerApi, reporter.agent, implementationRunId, {
      summary: 'Die Bearbeitung ist für die unabhängige Prüfung bereit.',
    });
    const inReview = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (current) => current.run_ids.length === 2, 'Die erfolgreiche Bearbeitung muss die Prüfungsphase starten.');
    const reviewRunId = inReview.run_ids[1];
    const reviewRun = await runningRun(ownerApi, reviewRunId);
    expect(reviewRun.snapshot.workflow_routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ on: 'blocked', to_stage_id: 'implementation', is_default: true, route_label_id: null }),
    ]));
    const blocked = await submitReport(ownerApi, reporter.agent, reviewRunId, {
      outcome: 'blocked',
      summary: 'Die Prüfung kann wegen einer ungeklärten Voraussetzung nicht fortfahren.',
      openQuestions: ['Welche Voraussetzung muss zuerst erfüllt sein?'],
    });
    expect(blocked.settledRun.state).toBe('failed');
    const paused = await readUntil(ownerApi, `/workflow-instances/${instance.id}`, (current) => current.state === 'paused' && current.repair_decision_run_id === reviewRunId, 'Die Rückkehr über den Standardweg muss die Reparaturgrenze auslösen.');
    expect(paused).toMatchObject({
      repair_round: 0,
      repair_decision_run_id: reviewRunId,
      repair_decision_stage_name: 'Bearbeitung',
      run_ids: [implementationRunId, reviewRunId],
    });
    expect(paused.pause_reason).toContain('Reparaturrunden');
    const flow = await taskFlow(ownerApi, task.id, instance.id);
    expect(flow.selected_transitions).toHaveLength(1);
    expect(flow.selected_transitions[0]).toMatchObject({
      from_stage_id: 'implementation',
      to_stage_id: 'review',
      outcome: 'accepted',
    });
    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    expect(journal.accepted_launches).toHaveLength(2);
    recordEvidence(
      'Auch eine blockierte Standardroute zurück zu einer besuchten früheren Phase benötigt die konfigurierte Überarbeitungsfreigabe.',
      `Die Prüfungsphase ${reviewRunId} meldete blocked. Der eingefrorene Standardübergang führte zurück zur zuvor besuchten Phase Bearbeitung, zählte gegen max_repair_rounds=0 und pausierte mit einer konkreten Eigentümerentscheidung, ohne einen dritten T3-Lauf zu starten.`,
      { t3: journal },
    );
  } finally {
    await reporter.close();
  }
});
