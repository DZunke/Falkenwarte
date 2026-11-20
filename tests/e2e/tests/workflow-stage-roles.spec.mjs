import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';
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

async function configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, name, maxActiveRuns = 1) {
  const created = await ownerApi.post('/connections', {
    name: name + ' ' + randomUUID().slice(0, 6),
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;
  const callback = new URL('/auth/t3/callback', baseURL).toString();
  const oauth = await ownerApi.post('/connections/' + connection.id + '/oauth/start', { redirect_uri: callback }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, '/connections/' + connection.id, (item) => item.auth_status === 'valid', 'Die Browser-OAuth-Anmeldung muss T3 autorisieren.');
  const check = await ownerApi.post('/connections/' + connection.id + '/check', {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  const readyConnection = await readUntil(ownerApi, '/connections/' + connection.id, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der MCP-Adapter muss den T3-Mock erfolgreich prüfen.');
  const currentProject = await ownerApi.get('/projects/' + project.id);
  expect(currentProject.response.status(), JSON.stringify(currentProject.data)).toBe(200);
  const binding = await ownerApi.put('/projects/' + project.id + '/binding', {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: maxActiveRuns,
  }, { version: currentProject.data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
  return { connection: readyConnection, binding: binding.data };
}

async function createProfile(ownerApi, projectIds, connection, name, role, prompt = 'Arbeite ausschließlich in der zugewiesenen Phase.') {
  const created = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role,
    connection_id: connection.id,
    allowed_project_ids: projectIds,
    max_parallel_runs: 1,
    prompt_template: prompt,
    enabled: true,
    default_run_completion_policy: runPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  return created.data;
}

async function createReadyTask(ownerApi, projectId, values) {
  await ownerApi.ensureDefaultBoard(projectId);
  const statuses = await ownerApi.get('/projects/' + projectId + '/statuses');
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const ready = statuses.data.items.find((status) => status.category === 'ready');
  expect(ready).toBeTruthy();
  return ownerApi.createTask(projectId, { ...values, status_id: ready.id });
}

async function boardTargets(ownerApi, projectId) {
  const board = await ownerApi.ensureDefaultBoard(projectId);
  const statuses = await ownerApi.get('/projects/' + projectId + '/statuses');
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const byCategory = {};
  for (const category of ['ready', 'active', 'review']) {
    const status = statuses.data.items.find((item) => item.category === category);
    const column = board.columns.find((item) => item.status_ids.includes(status?.id));
    expect(status, 'A default board must have a ' + category + ' status.').toBeTruthy();
    expect(column, 'A default board must expose the ' + category + ' status in a column.').toBeTruthy();
    byCategory[category] = {
      board_id: board.id,
      column_id: column.id,
      option: column.name + ' · ' + ({ ready: 'Bereit', active: 'In Arbeit', review: 'Review' })[category],
      column,
    };
  }
  return { board, targets: byCategory };
}

async function selectOption(page, select, optionName) {
  await select.click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

function apiBoardTarget(target) {
  return { board_id: target.board_id, column_id: target.column_id };
}

async function chooseRole(page, editor, prefix, stageId, profile) {
  const select = editor.getByTestId('workflow-' + prefix + '-stage-agent-role-' + stageId);
  await selectOption(page, select, profile.name + ' · ' + profile.role);
  await expect(select).toContainText(profile.name);
}

async function createWorkflowInUi(ownerPage, ownerApi, { project, name, stages, targets, useTwoStageTemplate = false, repairRoute = null }) {
  await ownerPage.goto('/#/workflows');
  await expect(ownerPage.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  const editor = ownerPage.getByTestId('workflow-editor-create');
  await expect(editor).toBeVisible();
  if (useTwoStageTemplate) {
    await editor.getByRole('button', { name: 'Zwei-Phasen-Vorlage verwenden', exact: true }).click();
  }
  await selectOption(ownerPage, editor.getByLabel('Projekt'), project.name);
  await editor.getByLabel('Workflowname').fill(name);

  const initialStageCount = useTwoStageTemplate ? 2 : 1;

  for (let index = 0; index < stages.length; index += 1) {
    if (index >= initialStageCount) await editor.getByRole('button', { name: 'Phase hinzufügen', exact: true }).click();
    const phaseNumber = index + 1;
    const stage = stages[index];
    await editor.getByLabel('Name der Phase ' + phaseNumber).fill(stage.name);
    if (stage.kind) {
      await selectOption(ownerPage, editor.getByLabel('Art der Phase').nth(index), stage.kind === 'review' ? 'Reviewphase' : 'Arbeitsphase');
    }
    if (stage.profile) {
      const roleSelect = editor.getByLabel('Agentrolle für Phase ' + phaseNumber);
      await selectOption(ownerPage, roleSelect, stage.profile.name + ' · ' + stage.profile.role);
    }
    const instructions = editor.getByLabel('Auftrag für diese Phase').nth(index);
    await instructions.fill(stage.instructions);
    const boardTarget = editor.getByLabel('Boardspalte bei Phasenstart für Phase ' + phaseNumber);
    await selectOption(ownerPage, boardTarget, targets[stage.boardCategory].option);
  }

  if (repairRoute) {
    const stageRows = editor.locator('article[data-testid^="workflow-create-stage-"]');
    const stageIds = await stageRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid').replace('workflow-create-stage-', '')));
    const transitionRows = editor.locator('article[data-testid^="workflow-create-transition-"]');
    const transitionIndex = await transitionRows.count();
    await editor.getByRole('button', { name: 'Übergang hinzufügen', exact: true }).click();
    const transitionRow = editor.getByTestId('workflow-create-transition-' + transitionIndex);
    await selectOption(ownerPage, transitionRow.getByLabel('Von Phase'), stages[repairRoute.fromStageIndex].name + ' · ' + stageIds[repairRoute.fromStageIndex]);
    await expect(transitionRow.getByLabel('Ergebnis')).toContainText('Änderungen nötig');
    await expect(transitionRow.getByLabel('Zu Phase')).toContainText(stages[repairRoute.toStageIndex].name);
  }

  const firstRole = editor.getByLabel('Agentrolle für Phase 1');
  await firstRole.click();
  await expect(ownerPage.getByRole('option', { name: /Projektfremde Rolle/ })).toHaveCount(0);
  await ownerPage.keyboard.press('Escape');

  const createResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === apiPrefix + '/workflows');
  await editor.getByRole('button', { name: 'Workflow anlegen', exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  await expect(ownerPage.getByText('Workflow angelegt', { exact: true })).toBeVisible();
  const createdBody = await createResponse.json();
  const createdWorkflow = createdBody.workflow ?? createdBody;
  const workflowResult = await ownerApi.get('/workflows/' + createdWorkflow.id);
  expect(workflowResult.response.status(), JSON.stringify(workflowResult.data)).toBe(200);
  return { editor, workflow: workflowResult.data };
}

async function createTechnicalReporter(ownerApi, baseURL, projectId) {
  const token = await ownerApi.createTechnicalToken({
    label: 'Workflow stage E2E ' + randomUUID().slice(0, 8),
    projectIds: [projectId],
    capabilities: ['tasks.read', 'runs.read', 'runs.report'],
  });
  return { token, ...await createAgentSimulator(baseURL, token.token) };
}

async function startWorkflow(ownerApi, task, workflow, definitionVersion = workflow.definition_version) {
  const result = await ownerApi.post('/tasks/' + task.id + '/workflow-instances', {
    workflow_id: workflow.id,
    definition_version: definitionVersion,
    task_revision: task.version,
  }, { version: task.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(202);
  const instanceId = result.data.resource?.id ?? result.data.instance_id;
  expect(instanceId).toBeTruthy();
  return readUntil(ownerApi, '/workflow-instances/' + instanceId, (instance) => instance.run_ids.length >= 1, 'Der erste Phasenlauf muss angelegt werden.');
}

async function submitReport(ownerApi, agent, runId, taskRevision, { summary, label, text }) {
  let run = await readUntil(ownerApi, '/runs/' + runId, (item) => ['running', 'verifying'].includes(item.state) && Boolean(item.attempts[0]?.external_thread_id), 'Der zugehörige T3-Lauf muss gestartet und beobachtbar sein.');
  expect(run.snapshot.task_revision).toBe(taskRevision);
  const reportId = randomUUID();
  let result;
  for (let submission = 0; submission < 3; submission += 1) {
    result = await agent.call('runs_report_result', {
      run_id: runId,
      report_id: reportId,
      attempt_no: run.attempt_no,
      task_revision: taskRevision,
      outcome: 'reported_success',
      summary,
      artifacts: [{ kind: 'note', label, text }],
      client_request_id: randomUUID(),
      expected_version: run.version,
    });
    if (!result.isError) break;
    const problem = result.structuredContent;
    expect(problem?.status, JSON.stringify(problem)).toBe(412);
    run = await readUntil(ownerApi, '/runs/' + runId, (item) => item.version > run.version, 'Ein konkreter Runversionskonflikt muss zu einem neuen Laufstand führen.');
    expect(run.snapshot.task_revision).toBe(taskRevision);
  }
  expect(result?.isError, JSON.stringify(result?.structuredContent)).toBe(false);
  const report = await readUntil(ownerApi, '/runs/' + runId + '/result-reports/' + reportId, (item) => item.id === reportId, 'Die Agentenmeldung muss gespeichert werden.');
  expect(report).toMatchObject({ run_id: runId, task_revision: taskRevision, accepted_for_reconciliation: true });
  return { report, reportId };
}

async function approvePhaseIfRequired(ownerApi, runId) {
  const run = await readUntil(ownerApi, '/runs/' + runId, (item) => item.state === 'verifying' || item.state === 'succeeded', 'Die Reviewphase muss ihren fachlichen Abschlussstatus erreichen.');
  if (run.state === 'succeeded') return run;
  if (!String(run.status_reason ?? '').includes('Eigentümerentscheidung')) {
    return readUntil(ownerApi, '/runs/' + runId, (item) => item.state === 'succeeded', 'Die Reviewphase muss nach dem externen Abschluss automatisch enden.');
  }
  const request = await ownerApi.post('/runs/' + runId + '/approvals', {
    kind: 'completion',
    result_digest: run.result_digest,
    reason: 'Die gemeldete Reviewphase wurde für den nächsten Workflowabschnitt geprüft.',
  }, { version: run.version });
  expect(request.response.status(), JSON.stringify(request.data)).toBe(201);
  const decision = await ownerApi.post('/approvals/' + request.data.id + '/decision', {
    decision: 'approved',
    result_digest: run.result_digest,
    reason: 'Die nächste Phase darf mit dem eingefrorenen Reviewbericht starten.',
  }, { version: request.data.version });
  expect(decision.response.status(), JSON.stringify(decision.data)).toBe(200);
  return readUntil(ownerApi, '/runs/' + runId, (item) => item.state === 'succeeded', 'Die freigegebene Reviewphase muss enden.');
}

async function taskOnBoardColumn(ownerApi, boardId, columnId, taskId) {
  const result = await ownerApi.get('/boards/' + boardId + '/view?limit_per_column=100');
  expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
  const column = result.data.columns.find((item) => item.column_id === columnId);
  expect(column, 'The configured target column must be present in the board read model.').toBeTruthy();
  return column.items.some((item) => item.id === taskId);
}

async function launchForRun(qaMocks, runId) {
  const journal = await qaMocks.t3Journal();
  return journal.accepted_launches.find((launch) => launch.payload.message.includes('Run-ID: ' + runId + '\n'));
}

test('UI creates a three-phase workflow with project-filtered roles and dispatches each named phase to its own role', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(360_000);
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 6);
  const project = await ownerApi.createProject({ name: 'Redaktion Rollen ' + suffix });
  const otherProject = await ownerApi.createProject({ name: 'Andere Projektrollen ' + suffix });
  const { connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, 'Workflow Phasen');
  const { board, targets } = await boardTargets(ownerApi, project.id);
  const workRole = await createProfile(ownerApi, [project.id], connection, 'Redaktion ' + suffix, 'Redaktion', 'Rollenprompt für den Entwurf: erstelle eine prüfbare Fassung.');
  const reviewRole = await createProfile(ownerApi, [project.id], connection, 'Lektorat ' + suffix, 'Lektorat', 'Rollenprompt für das Lektorat: prüfe den Entwurf.');
  const publishRole = await createProfile(ownerApi, [project.id], connection, 'Freigabe ' + suffix, 'Freigabe', 'Rollenprompt für die Ausgabe: prüfe die freigegebene Fassung.');
  await createProfile(ownerApi, [otherProject.id], connection, 'Projektfremde Rolle ' + suffix, 'Projektfremd');

  const workInstructions = 'Entwirf den Beitrag und übergib die konkrete Fassung an das Lektorat.';
  const reviewInstructions = 'Prüfe die Fassung und begründe die Annahme oder den Änderungsbedarf.';
  const publishInstructions = 'Prüfe die freigegebene Fassung abschließend für die Zeitungsausgabe.';
  const { workflow } = await createWorkflowInUi(ownerPage, ownerApi, {
    project,
    name: 'Redaktion Dreiphasenablauf ' + suffix,
    targets,
    repairRoute: { fromStageIndex: 2, toStageIndex: 1 },
    stages: [
      { name: 'Entwurf', profile: workRole, instructions: workInstructions, boardCategory: 'active' },
      { name: 'Redaktionsprüfung', profile: reviewRole, instructions: reviewInstructions, boardCategory: 'review' },
      { name: 'Ausgabefreigabe', kind: 'review', profile: publishRole, instructions: publishInstructions, boardCategory: 'ready' },
    ],
  });

  expect(workflow).toMatchObject({ project_id: project.id, preset_id: 'manual', definition_version: 1, enabled: true });
  expect(workflow.stages).toHaveLength(3);
  const stageIds = workflow.stages.map((stage) => stage.id);
  expect(new Set(stageIds).size).toBe(3);
  expect(workflow.stages.map((stage) => ({
    id: stage.id,
    kind: stage.kind,
    name: stage.name,
    agent_profile_id: stage.agent_profile_id,
    instructions: stage.instructions,
    board_target: stage.board_target,
  }))).toEqual([
    expect.objectContaining({ id: stageIds[0], kind: 'agent_run', name: 'Entwurf', agent_profile_id: workRole.id, instructions: workInstructions, board_target: apiBoardTarget(targets.active) }),
    expect.objectContaining({ id: stageIds[1], kind: 'agent_run', name: 'Redaktionsprüfung', agent_profile_id: reviewRole.id, instructions: reviewInstructions, board_target: apiBoardTarget(targets.review) }),
    expect.objectContaining({ id: stageIds[2], kind: 'review', name: 'Ausgabefreigabe', agent_profile_id: publishRole.id, instructions: publishInstructions, board_target: apiBoardTarget(targets.ready) }),
  ]);
  expect(workflow.transitions).toEqual(expect.arrayContaining([
    expect.objectContaining({ from_stage_id: stageIds[0], to_stage_id: stageIds[1], on: 'accepted' }),
    expect.objectContaining({ from_stage_id: stageIds[1], to_stage_id: stageIds[2], on: 'accepted' }),
    expect.objectContaining({ from_stage_id: stageIds[2], to_stage_id: stageIds[1], on: 'needs_changes' }),
  ]));
  const versionOne = await ownerApi.get('/workflows/' + workflow.id + '/versions/1');
  expect(versionOne.response.status(), JSON.stringify(versionOne.data)).toBe(200);
  expect(versionOne.data.stages.map((stage) => stage.name)).toEqual(['Entwurf', 'Redaktionsprüfung', 'Ausgabefreigabe']);

  const taskResult = await createReadyTask(ownerApi, project.id, {
    title: 'Dreiphasenablauf ' + suffix,
    description: 'Der Auftrag soll sichtbar durch Entwurf, Redaktionsprüfung und Ausgabefreigabe laufen.',
  });
  const task = (await ownerApi.get('/tasks/' + taskResult.id)).data;
  const instance = await startWorkflow(ownerApi, task, workflow);
  const firstRunId = instance.run_ids[0];
  const firstRun = await readUntil(ownerApi, '/runs/' + firstRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Die Entwurfsphase muss tatsächlich über T3 starten.');
  expect(firstRun.stage).toBe(stageIds[0]);
  const afterWorkEntry = await ownerApi.get('/tasks/' + task.id);
  expect(afterWorkEntry.data.status_category).toBe('active');
  expect(firstRun.snapshot).toMatchObject({
    agent_profile_id: workRole.id,
    task_revision: afterWorkEntry.data.version,
    workflow_version: 1,
    stage_name: 'Entwurf',
    stage_instructions: workInstructions,
    stage_board_target: apiBoardTarget(targets.active),
  });
  expect(await taskOnBoardColumn(ownerApi, board.id, targets.active.column_id, task.id)).toBe(true);
  const activeFlow = await ownerApi.get('/tasks/' + task.id + '/flow?limit=100');
  expect(activeFlow.response.status(), JSON.stringify(activeFlow.data)).toBe(200);
  const activeFlowInstance = activeFlow.data.items.find((item) => item.kind === 'workflow_instance' && item.id === instance.id);
  expect(activeFlowInstance?.phases).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: stageIds[0], name: 'Entwurf', kind: 'agent_run', agent_profile_id: workRole.id, instructions: workInstructions, board_target: apiBoardTarget(targets.active) }),
    expect.objectContaining({ id: stageIds[1], name: 'Redaktionsprüfung', kind: 'agent_run', agent_profile_id: reviewRole.id, instructions: reviewInstructions, board_target: apiBoardTarget(targets.review) }),
    expect.objectContaining({ id: stageIds[2], name: 'Ausgabefreigabe', kind: 'review', agent_profile_id: publishRole.id, instructions: publishInstructions, board_target: apiBoardTarget(targets.ready) }),
  ]));
  const reporter = await createTechnicalReporter(ownerApi, baseURL, project.id);
  try {
    const firstReport = await submitReport(ownerApi, reporter.agent, firstRunId, afterWorkEntry.data.version, {
      summary: 'Der Entwurf ist fertig und an das Lektorat übergeben.',
      label: 'Entwurfsbericht',
      text: 'Die Redaktion hat die angeforderte Fassung erstellt.',
    });
    await readUntil(ownerApi, '/runs/' + firstRunId, (run) => run.state === 'succeeded', 'Der Entwurfsbericht muss angenommen werden.');

    const afterReviewEntry = await readUntil(ownerApi, '/workflow-instances/' + instance.id, (current) => current.run_ids.length === 2, 'Die angenommene Entwurfsphase muss die Reviewphase starten.');
    const reviewRunId = afterReviewEntry.run_ids[1];
    const reviewRun = await readUntil(ownerApi, '/runs/' + reviewRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Die Redaktionsprüfung muss tatsächlich über T3 starten.');
    expect(reviewRun.stage).toBe(stageIds[1]);
    const afterReviewMove = await ownerApi.get('/tasks/' + task.id);
    expect(afterReviewMove.data.status_category).toBe('review');
    expect(reviewRun.snapshot).toMatchObject({
      agent_profile_id: reviewRole.id,
      task_revision: afterReviewMove.data.version,
      stage_name: 'Redaktionsprüfung',
      stage_instructions: reviewInstructions,
      stage_board_target: apiBoardTarget(targets.review),
      handoff_source_run_id: firstRunId,
    });
    expect(reviewRun.snapshot.handoff_snapshot).toMatchObject({
      source_report_id: firstReport.reportId,
      source_attempt_no: firstRun.attempt_no,
      task_revision_id: afterWorkEntry.data.version,
    });
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.review.column_id, task.id)).toBe(true);

    const secondReport = await submitReport(ownerApi, reporter.agent, reviewRunId, afterReviewMove.data.version, {
      summary: 'Die Fassung wurde für die Ausgabe geprüft.',
      label: 'Lektoratsbericht',
      text: 'Das Lektorat hat die Fassung angenommen.',
    });
    await approvePhaseIfRequired(ownerApi, reviewRunId);
    const withPublishRun = await readUntil(ownerApi, '/workflow-instances/' + instance.id, (current) => current.run_ids.length === 3, 'Die angenommene Reviewphase muss die Ausgabefreigabe starten.');
    const publishRunId = withPublishRun.run_ids[2];
    const publishRun = await readUntil(ownerApi, '/runs/' + publishRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Die Ausgabefreigabe muss tatsächlich über T3 starten.');
    expect(publishRun.stage).toBe(stageIds[2]);
    const afterPublishMove = await ownerApi.get('/tasks/' + task.id);
    expect(afterPublishMove.data.status_category).toBe('ready');
    expect(publishRun.snapshot).toMatchObject({
      agent_profile_id: publishRole.id,
      stage_kind: 'review',
      task_revision: afterPublishMove.data.version,
      stage_name: 'Ausgabefreigabe',
      stage_instructions: publishInstructions,
      stage_board_target: apiBoardTarget(targets.ready),
      handoff_source_run_id: reviewRunId,
    });
    expect(publishRun.snapshot.handoff_snapshot).toMatchObject({
      source_report_id: secondReport.reportId,
      source_attempt_no: reviewRun.attempt_no,
      task_revision_id: afterReviewMove.data.version,
    });
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.ready.column_id, task.id)).toBe(true);

    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    expect(journal.accepted_launches).toHaveLength(3);
    const workLaunch = await launchForRun(qaMocks, firstRunId);
    const reviewLaunch = await launchForRun(qaMocks, reviewRunId);
    const publishLaunch = await launchForRun(qaMocks, publishRunId);
    expect(workLaunch?.payload.message).toContain('Entwurf');
    expect(workLaunch?.payload.message).toContain(workInstructions);
    expect(workLaunch?.payload.message).toContain('Rollenprompt für den Entwurf: erstelle eine prüfbare Fassung.');
    expect(workLaunch?.payload.message).not.toContain(reviewInstructions);
    expect(workLaunch?.payload.message).not.toContain(publishInstructions);
    expect(reviewLaunch?.payload.message).toContain('Redaktionsprüfung');
    expect(reviewLaunch?.payload.message).toContain(reviewInstructions);
    expect(reviewLaunch?.payload.message).toContain('Rollenprompt für das Lektorat: prüfe den Entwurf.');
    expect(reviewLaunch?.payload.message).not.toContain(workInstructions);
    expect(reviewLaunch?.payload.message).not.toContain(publishInstructions);
    expect(publishLaunch?.payload.message).toContain('Ausgabefreigabe');
    expect(publishLaunch?.payload.message).toContain(publishInstructions);
    expect(publishLaunch?.payload.message).toContain('Rollenprompt für die Ausgabe: prüfe die freigegebene Fassung.');
    expect(publishLaunch?.payload.message).not.toContain(workInstructions);
    expect(publishLaunch?.payload.message).not.toContain(reviewInstructions);

    recordEvidence(
      'Die Oberfläche erstellt und startet einen dreiphasigen Redaktionsablauf mit getrennten Rollen, Phasenaufträgen und Boardzielen.',
      'Die öffentliche UI speicherte Workflowversion ' + workflow.definition_version + ' für Projekt ' + project.id + ' mit drei benannten Phasen. T3 nahm genau drei Starts für Rollen ' + workRole.id + ', ' + reviewRole.id + ' und ' + publishRole.id + ' an. Die gespeicherten Run-Snapshots und Launchtexte enthielten jeweils nur den Auftrag der gestarteten Phase; die Taskrevision und das Board wechselten beim Eintritt in active, review und ready. Übergaben behielten den jeweiligen Report und die Quellrevision.',
      { t3: journal },
    );
  } finally {
    await reporter.close();
  }
});

test('UI versions a same-role two-phase template into separate work and review roles without rewriting version one', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(300_000);
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 6);
  const project = await ownerApi.createProject({ name: 'Redaktion Versionsprüfung ' + suffix });
  const { connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, 'Workflowversion');
  const { board, targets } = await boardTargets(ownerApi, project.id);
  const sameRole = await createProfile(ownerApi, [project.id], connection, 'Redaktion Allgemein ' + suffix, 'Redaktion', 'Gemeinsames Vorlagenprofil für Umsetzung und Review.');
  const workRole = await createProfile(ownerApi, [project.id], connection, 'Redaktion Umsetzung ' + suffix, 'Implementierung', 'Spezifischer Rollenprompt: Zeitungsauftrag umsetzen.');
  const reviewRole = await createProfile(ownerApi, [project.id], connection, 'Redaktion Review ' + suffix, 'Review', 'Spezifischer Rollenprompt: Zeitungsauftrag unabhängig prüfen.');

  const originalInstructions = [
    'Bearbeite den Zeitungsauftrag im gemeinsamen Ausgangsprofil.',
    'Prüfe den Zeitungsauftrag im gemeinsamen Ausgangsprofil.',
  ];
  const created = await createWorkflowInUi(ownerPage, ownerApi, {
    project,
    name: 'Redaktion Vorlage ' + suffix,
    targets,
    useTwoStageTemplate: true,
    stages: [
      { name: 'Bearbeitung', profile: sameRole, instructions: originalInstructions[0], boardCategory: 'active' },
      { name: 'Review', profile: sameRole, instructions: originalInstructions[1], boardCategory: 'review' },
    ],
  });
  const workflowV1 = created.workflow;
  expect(workflowV1).toMatchObject({ project_id: project.id, preset_id: 'two-stage-review', definition_version: 1 });
  expect(workflowV1.stages.map((stage) => stage.agent_profile_id)).toEqual([sameRole.id, sameRole.id]);
  const oldVersionBefore = await ownerApi.get('/workflows/' + workflowV1.id + '/versions/1');
  expect(oldVersionBefore.response.status(), JSON.stringify(oldVersionBefore.data)).toBe(200);
  expect(oldVersionBefore.data.id).toBe(workflowV1.id);

  const card = ownerPage.getByTestId('workflow-card-' + workflowV1.id);
  await card.getByRole('button', { name: 'Workflow bearbeiten', exact: true }).click();
  const editor = ownerPage.getByTestId('workflow-editor-' + workflowV1.id);
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Workflowname')).toHaveValue(workflowV1.name);
  await chooseRole(ownerPage, editor, workflowV1.id, 'work', workRole);
  await chooseRole(ownerPage, editor, workflowV1.id, 'review', reviewRole);
  await editor.getByLabel('Automatische Überarbeitungsrunden').fill('0');
  await editor.getByTestId('workflow-' + workflowV1.id + '-stage-instructions-work').fill('Setze den Auftrag als Redaktion um und dokumentiere das konkrete Ergebnis.');
  await editor.getByTestId('workflow-' + workflowV1.id + '-stage-instructions-review').fill('Prüfe den eingefrorenen Umsetzungsbericht unabhängig und begründet.');
  await selectOption(ownerPage, editor.getByLabel('Boardspalte bei Phasenstart für Phase 2'), 'Spalte beibehalten');

  const replaceResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === apiPrefix + '/workflows/' + workflowV1.id);
  await editor.getByRole('button', { name: 'Workflowversion speichern', exact: true }).click();
  const replaceResponse = await replaceResponsePromise;
  expect(replaceResponse.status()).toBe(200);
  expect(replaceResponse.request().headers()['if-match']).toBe('"' + workflowV1.version + '"');
  const write = replaceResponse.request().postDataJSON();
  expect(write).toMatchObject({
    project_id: project.id,
    name: workflowV1.name,
    preset_id: 'two-stage-review',
    enabled: true,
    stages: expect.arrayContaining([
      expect.objectContaining({ id: 'work', agent_profile_id: workRole.id }),
      expect.objectContaining({ id: 'review', agent_profile_id: reviewRole.id }),
    ]),
    transitions: workflowV1.transitions,
    limits: { ...workflowV1.limits, max_repair_rounds: 0 },
  });
  expect(write.stages.find((stage) => stage.id === 'review')).not.toHaveProperty('board_target');
  await expect(ownerPage.getByText('Workflowversion gespeichert', { exact: true })).toBeVisible();

  const currentWorkflowResult = await ownerApi.get('/workflows/' + workflowV1.id);
  expect(currentWorkflowResult.response.status(), JSON.stringify(currentWorkflowResult.data)).toBe(200);
  const workflowV2 = currentWorkflowResult.data;
  expect(workflowV2).toMatchObject({ definition_version: workflowV1.definition_version + 1, project_id: project.id });
  expect(workflowV2.limits.max_repair_rounds).toBe(0);
  expect(workflowV2.stages.map((stage) => stage.agent_profile_id)).toEqual([workRole.id, reviewRole.id]);
  expect(workflowV2.stages.map((stage) => stage.instructions)).toEqual([
    'Setze den Auftrag als Redaktion um und dokumentiere das konkrete Ergebnis.',
    'Prüfe den eingefrorenen Umsetzungsbericht unabhängig und begründet.',
  ]);
  expect(workflowV2.limits).toMatchObject({ ...workflowV1.limits, max_repair_rounds: 0 });
  expect(workflowV2.stages.map((stage) => stage.board_target)).toEqual([apiBoardTarget(targets.active), undefined]);
  const oldVersionAfter = await ownerApi.get('/workflows/' + workflowV1.id + '/versions/1');
  expect(oldVersionAfter.response.status(), JSON.stringify(oldVersionAfter.data)).toBe(200);
  expect(oldVersionAfter.data.id).toBe(workflowV1.id);
  expect(oldVersionAfter.data).toMatchObject({
    id: workflowV1.id,
    definition_version: 1,
    preset_id: 'two-stage-review',
    stages: oldVersionBefore.data.stages,
    transitions: oldVersionBefore.data.transitions,
    limits: oldVersionBefore.data.limits,
  });
  expect(oldVersionAfter.data.stages.map((stage) => stage.agent_profile_id)).toEqual([sameRole.id, sameRole.id]);
  expect(oldVersionAfter.data.stages.map((stage) => stage.instructions)).toEqual(originalInstructions);
  expect(oldVersionAfter.data.limits.max_repair_rounds).toBe(2);

  const frozenTaskResult = await createReadyTask(ownerApi, project.id, {
    title: 'Redaktion eingefrorene Version ' + suffix,
    description: 'Dieser Start liest Version 1 nach Veröffentlichung der neuen Workflowversion.',
  });
  const frozenTask = (await ownerApi.get('/tasks/' + frozenTaskResult.id)).data;
  const frozenInstance = await startWorkflow(ownerApi, frozenTask, workflowV2, 1);
  expect(frozenInstance).toMatchObject({ workflow_id: workflowV1.id, definition_version: 1 });
  const frozenRunId = frozenInstance.run_ids[0];
  const frozenRun = await readUntil(ownerApi, '/runs/' + frozenRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Ein expliziter Start der alten Version muss ihre gemeinsame Rolle verwenden.');
  expect(frozenRun.snapshot).toMatchObject({
    workflow_version: 1,
    agent_profile_id: sameRole.id,
    stage_name: 'Bearbeitung',
    stage_instructions: originalInstructions[0],
    stage_board_target: apiBoardTarget(targets.active),
  });
  const frozenFlow = await ownerApi.get('/tasks/' + frozenTask.id + '/flow?limit=100');
  expect(frozenFlow.response.status(), JSON.stringify(frozenFlow.data)).toBe(200);
  expect(frozenFlow.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: 'workflow_instance',
      id: frozenInstance.id,
      workflow_id: workflowV1.id,
      definition_version: 1,
      phases: expect.arrayContaining([
        expect.objectContaining({ id: 'work', agent_profile_id: sameRole.id, instructions: originalInstructions[0], board_target: apiBoardTarget(targets.active) }),
        expect.objectContaining({ id: 'review', agent_profile_id: sameRole.id, instructions: originalInstructions[1], board_target: apiBoardTarget(targets.review) }),
      ]),
    }),
  ]));

  const reporter = await createTechnicalReporter(ownerApi, baseURL, project.id);
  try {
    const frozenActiveTask = await ownerApi.get('/tasks/' + frozenTask.id);
    expect(frozenActiveTask.data.status_category).toBe('active');
    const frozenWorkReport = await submitReport(ownerApi, reporter.agent, frozenRunId, frozenActiveTask.data.version, {
      summary: 'Die eingefrorene Bearbeitungsphase ist abgeschlossen.',
      label: 'Vorlagenbericht',
      text: 'Version 1 behält den gemeinsamen Ausgangsauftrag.',
    });
    await readUntil(ownerApi, '/runs/' + frozenRunId, (run) => run.state === 'succeeded', 'Der Lauf aus Version 1 muss abgeschlossen sein, bevor die nächste T3-Phase startet.');
    const withFrozenReview = await readUntil(ownerApi, '/workflow-instances/' + frozenInstance.id, (current) => current.run_ids.length === 2, 'Version 1 muss nach der Bearbeitung ihre Reviewphase starten.');
    const frozenReviewRunId = withFrozenReview.run_ids[1];
    const frozenReviewRun = await readUntil(ownerApi, '/runs/' + frozenReviewRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Die eingefrorene Reviewphase muss abgeschlossen werden, bevor Version 2 startet.');
    const frozenReviewTask = await ownerApi.get('/tasks/' + frozenTask.id);
    expect(frozenReviewTask.data.status_category).toBe('review');
    expect(frozenReviewRun.snapshot).toMatchObject({
      workflow_version: 1,
      agent_profile_id: sameRole.id,
      stage_name: 'Review',
      stage_instructions: originalInstructions[1],
      stage_board_target: apiBoardTarget(targets.review),
      handoff_source_run_id: frozenRunId,
      handoff_snapshot: {
        source_report_id: frozenWorkReport.reportId,
        task_revision_id: frozenActiveTask.data.version,
      },
    });
    await submitReport(ownerApi, reporter.agent, frozenReviewRunId, frozenReviewTask.data.version, {
      summary: 'Die eingefrorene Vorlage wurde geprüft.',
      label: 'Vorlagenreview',
      text: 'Die alte Version behielt ihre gemeinsame Reviewrolle.',
    });
    await approvePhaseIfRequired(ownerApi, frozenReviewRunId);
    await readUntil(ownerApi, '/workflow-instances/' + frozenInstance.id, (current) => current.state === 'succeeded', 'Version 1 muss vollständig enden, bevor die neue Version gestartet wird.');

    const taskResult = await createReadyTask(ownerApi, project.id, {
      title: 'Redaktion versionierter Rollenlauf ' + suffix,
      description: 'Eine getrennte Redaktionsrolle setzt den Auftrag um, anschließend prüft eine zweite Rolle die Übergabe.',
    });
    const task = (await ownerApi.get('/tasks/' + taskResult.id)).data;
    const instance = await startWorkflow(ownerApi, task, workflowV2);
    expect(instance.definition_version).toBe(2);
    const workRunId = instance.run_ids[0];
    const workRun = await readUntil(ownerApi, '/runs/' + workRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Die neue Workversion muss die Redaktionsrolle starten.');
    const activeTask = await ownerApi.get('/tasks/' + task.id);
    expect(activeTask.data.status_category).toBe('active');
    expect(workRun.snapshot).toMatchObject({
      workflow_version: 2,
      agent_profile_id: workRole.id,
      stage_name: 'Bearbeitung',
      stage_instructions: 'Setze den Auftrag als Redaktion um und dokumentiere das konkrete Ergebnis.',
      stage_board_target: apiBoardTarget(targets.active),
      task_revision: activeTask.data.version,
    });
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.active.column_id, task.id)).toBe(true);

    const report = await submitReport(ownerApi, reporter.agent, workRunId, activeTask.data.version, {
      summary: 'Die Umsetzung ist abgeschlossen und der Reviewrolle übergeben.',
      label: 'Umsetzungsbericht',
      text: 'Die Redaktion hat eine prüfbare Fassung erstellt.',
    });
    await readUntil(ownerApi, '/runs/' + workRunId, (run) => run.state === 'succeeded', 'Der Work-Run der neuen Workflowversion muss erfolgreich enden.');
    const withReview = await readUntil(ownerApi, '/workflow-instances/' + instance.id, (current) => current.run_ids.length === 2, 'Der akzeptierte Work-Report muss die Reviewrolle starten.');
    const reviewRunId = withReview.run_ids[1];
    const reviewRun = await readUntil(ownerApi, '/runs/' + reviewRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Die Reviewrolle muss als eigener T3-Run starten.');
    const reviewTask = await ownerApi.get('/tasks/' + task.id);
    expect(reviewTask.data).toMatchObject({ status_category: 'active', version: activeTask.data.version });
    expect(reviewRun.snapshot).toMatchObject({
      workflow_version: 2,
      agent_profile_id: reviewRole.id,
      stage_name: 'Review',
      stage_instructions: 'Prüfe den eingefrorenen Umsetzungsbericht unabhängig und begründet.',
      task_revision: reviewTask.data.version,
      handoff_source_run_id: workRunId,
      handoff_snapshot: {
        source_report_id: report.reportId,
        source_attempt_no: workRun.attempt_no,
        task_revision_id: activeTask.data.version,
      },
    });
    expect(reviewRun.snapshot).not.toHaveProperty('stage_board_target');
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.active.column_id, task.id)).toBe(true);

    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    expect(journal.accepted_launches).toHaveLength(4);
    const frozenLaunch = await launchForRun(qaMocks, frozenRunId);
    const frozenReviewLaunch = await launchForRun(qaMocks, frozenReviewRunId);
    const workLaunch = await launchForRun(qaMocks, workRunId);
    const reviewLaunch = await launchForRun(qaMocks, reviewRunId);
    expect(frozenLaunch?.payload.message).toContain('Bearbeitung');
    expect(frozenLaunch?.payload.message).toContain(originalInstructions[0]);
    expect(frozenLaunch?.payload.message).toContain('Gemeinsames Vorlagenprofil für Umsetzung und Review.');
    expect(frozenLaunch?.payload.message).not.toContain('Setze den Auftrag als Redaktion um');
    expect(frozenReviewLaunch?.payload.message).toContain('Review');
    expect(frozenReviewLaunch?.payload.message).toContain(originalInstructions[1]);
    expect(frozenReviewLaunch?.payload.message).toContain('Gemeinsames Vorlagenprofil für Umsetzung und Review.');
    expect(frozenReviewLaunch?.payload.message).not.toContain('Prüfe den eingefrorenen Umsetzungsbericht unabhängig und begründet.');
    expect(workLaunch?.payload.message).toContain('Bearbeitung');
    expect(workLaunch?.payload.message).toContain('Setze den Auftrag als Redaktion um');
    expect(workLaunch?.payload.message).toContain('Spezifischer Rollenprompt: Zeitungsauftrag umsetzen.');
    expect(workLaunch?.payload.message).not.toContain('Prüfe den eingefrorenen Umsetzungsbericht');
    expect(reviewLaunch?.payload.message).toContain('Review');
    expect(reviewLaunch?.payload.message).toContain('Prüfe den eingefrorenen Umsetzungsbericht unabhängig und begründet.');
    expect(reviewLaunch?.payload.message).toContain('Spezifischer Rollenprompt: Zeitungsauftrag unabhängig prüfen.');
    expect(reviewLaunch?.payload.message).not.toContain('Setze den Auftrag als Redaktion um');

    recordEvidence(
      'Ein gespeicherter Zwei-Phasen-Workflow wird über die UI versioniert, ohne die alte Rollen- und Anweisungssnapshot-Version umzuschreiben.',
      'Version 1 behielt die gemeinsame Rolle ' + sameRole.id + ' und beide ursprünglichen Phasenaufträge; beide alten Phasen wurden nacheinander abgeschlossen, bevor der nächste T3-Start erfolgte. Die UI speicherte Version 2 mit Rollen ' + workRole.id + ' und ' + reviewRole.id + '; die API bestätigte If-Match der vorher gelesenen Workflowversion. Der echte T3-Dispatch startete in Version 2 zuerst die Workrolle und nach deren Report die getrennte Reviewrolle. Beim Reviewstart wurde das entfernte Boardziel nicht angewendet: Status, Taskrevision und Boardposition blieben auf der Workphase. Die Run-Snapshots bewahrten den Quellreport mit seiner ursprünglichen Revision.',
      { t3: journal },
    );
  } finally {
    await reporter.close();
  }
});

test('a workflow pauses before T3 launch when its configured start column is at a blocking WIP limit', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  await qaMocks.setT3Scenario('default');
  const project = await ownerApi.createProject({ name: 'Workflow WIP-Ziel ' + randomUUID().slice(0, 6) });
  await ownerApi.ensureDefaultBoard(project.id);
  const { connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, 'Workflow WIP');
  const statuses = await ownerApi.get('/projects/' + project.id + '/statuses');
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const activeStatus = statuses.data.items.find((status) => status.category === 'active');
  const readyStatus = statuses.data.items.find((status) => status.category === 'ready');
  const board = await ownerApi.get('/projects/' + project.id + '/boards');
  expect(board.response.status(), JSON.stringify(board.data)).toBe(200);
  const activeColumn = board.data.items[0].columns.find((column) => column.status_ids.includes(activeStatus.id));
  expect(activeColumn).toBeTruthy();
  const boardState = await ownerApi.get('/boards/' + board.data.items[0].id);
  expect(boardState.response.status(), JSON.stringify(boardState.data)).toBe(200);
  const limitedColumns = boardState.data.columns.map((column) => ({
    id: column.id,
    name: column.name,
    status_ids: column.status_ids,
    default_drop_status_id: column.default_drop_status_id,
    wip_limit: column.id === activeColumn.id ? 1 : column.wip_limit,
    wip_policy: column.id === activeColumn.id ? 'block' : column.wip_policy,
  }));
  const limited = await ownerApi.put('/boards/' + boardState.data.id + '/columns', { columns: limitedColumns }, { version: boardState.data.version });
  expect(limited.response.status(), JSON.stringify(limited.data)).toBe(200);
  const blockerCreated = await createReadyTask(ownerApi, project.id, { title: 'Belegt die aktive Workflowspalte' });
  const blockerState = await ownerApi.get('/tasks/' + blockerCreated.id);
  expect(blockerState.response.status(), JSON.stringify(blockerState.data)).toBe(200);
  const blockerMove = await ownerApi.post('/tasks/' + blockerCreated.id + '/move', {
    status_id: activeStatus.id,
    board_id: board.data.items[0].id,
  }, { version: blockerState.data.version });
  expect(blockerMove.response.status(), JSON.stringify(blockerMove.data)).toBe(200);
  const blocker = await ownerApi.get('/tasks/' + blockerCreated.id);
  expect(blocker.data.status_category).toBe('active');
  const taskResult = await ownerApi.createTask(project.id, { title: 'Soll wegen WIP vor T3 warten', status_id: readyStatus.id });
  const taskBefore = await ownerApi.get('/tasks/' + taskResult.id);
  expect(taskBefore.response.status(), JSON.stringify(taskBefore.data)).toBe(200);
  const profile = await createProfile(ownerApi, [project.id], connection, 'WIP Phasenrolle', 'Implementierung');
  const definition = await ownerApi.post('/workflows', {
    project_id: project.id,
    name: 'WIP Ziel blockiert vor Dispatch',
    preset_id: 'manual',
    stages: [{
      id: 'work',
      kind: 'agent_run',
      name: 'Arbeit',
      agent_profile_id: profile.id,
      entry_conditions: [],
      run_completion_policy: runPolicy,
      instructions: 'Starte erst, wenn die aktive Spalte den Auftrag annehmen kann.',
      board_target: { board_id: boardState.data.id, column_id: activeColumn.id },
    }],
    transitions: [],
    limits: { max_repair_rounds: 0, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(definition.response.status(), JSON.stringify(definition.data)).toBe(201);
  const workflow = definition.data.workflow ?? definition.data;
  const started = await ownerApi.post('/tasks/' + taskResult.id + '/workflow-instances', {
    workflow_id: workflow.id,
    definition_version: workflow.definition_version,
    task_revision: taskBefore.data.version,
  }, { version: taskBefore.data.version });
  expect(started.response.status(), JSON.stringify(started.data)).toBe(202);
  const instanceId = started.data.resource?.id ?? started.data.instance_id;
  const paused = await readUntil(ownerApi, '/workflow-instances/' + instanceId, (instance) => instance.state === 'paused', 'Die WIP-Grenze muss den Phasenstart kontrolliert pausieren.');
  expect(paused.run_ids).toEqual([]);
  expect(paused.pause_reason).toContain('WIP-Grenze');
  const unchangedTask = await ownerApi.get('/tasks/' + taskResult.id);
  expect(unchangedTask.data).toMatchObject({
    version: taskBefore.data.version,
    status_id: readyStatus.id,
    status_category: 'ready',
  });
  expect((await ownerApi.get('/tasks/' + blocker.data.id)).data.status_category).toBe('active');
  const journal = await qaMocks.t3Journal();
  expect(journal.unexpected).toEqual([]);
  expect(journal.accepted_launches).toHaveLength(0);

  recordEvidence(
    'Ein blockierendes Workflow-Boardziel pausiert vor der externen Arbeit und verändert weder Ticketrevision noch T3-Launchzahl.',
    'Die aktive Boardspalte war durch Ticket ' + blocker.data.id + ' vollständig belegt. Workflowinstanz ' + instanceId + ' pausierte mit null Runs; Ticket ' + taskResult.id + ' blieb in Revision ' + taskBefore.data.version + ' im Status ready. Der T3-Mock nahm keinen Agentenstart an.',
    { t3: journal },
  );
});

test('an archived project blocks the next workflow stage without moving the task or launching another T3 run', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(180_000);
  await qaMocks.setT3Scenario('default');
  const project = await ownerApi.createProject({ name: 'Workflow Archivierung ' + randomUUID().slice(0, 6) });
  const { connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, project, 'Workflow Archivierung');
  const { board, targets } = await boardTargets(ownerApi, project.id);
  const profile = await createProfile(ownerApi, [project.id], connection, 'Archivierungsrolle', 'Implementierung');
  const created = await createReadyTask(ownerApi, project.id, { title: 'Kein Folgestart im archivierten Projekt' });
  const task = await ownerApi.get('/tasks/' + created.id);
  expect(task.response.status(), JSON.stringify(task.data)).toBe(200);
  const workflowResponse = await ownerApi.post('/workflows', {
    project_id: project.id,
    name: 'Archivierung zwischen Workflowphasen',
    preset_id: 'manual',
    stages: [
      {
        id: 'work',
        kind: 'agent_run',
        name: 'Bearbeitung',
        agent_profile_id: profile.id,
        entry_conditions: [],
        run_completion_policy: runPolicy,
        board_target: apiBoardTarget(targets.active),
      },
      {
        id: 'review',
        kind: 'review',
        name: 'Review',
        agent_profile_id: profile.id,
        entry_conditions: [{ type: 'run_succeeded' }],
        run_completion_policy: runPolicy,
        board_target: apiBoardTarget(targets.review),
      },
    ],
    transitions: [{ from_stage_id: 'work', to_stage_id: 'review', on: 'accepted', conditions: [] }],
    limits: { max_repair_rounds: 1, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(workflowResponse.response.status(), JSON.stringify(workflowResponse.data)).toBe(201);
  const workflow = workflowResponse.data.workflow ?? workflowResponse.data;
  const instance = await startWorkflow(ownerApi, task.data, workflow);
  const workRunId = instance.run_ids[0];
  await readUntil(ownerApi, '/runs/' + workRunId, (run) => run.state === 'running' && Boolean(run.attempts[0]?.external_thread_id), 'Der Arbeitslauf muss vor der Projektarchivierung über T3 starten.');
  const activeTask = await ownerApi.get('/tasks/' + created.id);
  expect(activeTask.data.status_category).toBe('active');
  const projectBeforeArchive = await ownerApi.get('/projects/' + project.id);
  expect(projectBeforeArchive.response.status()).toBe(200);
  const archive = await ownerApi.post('/projects/' + project.id + '/archive', { archived: true, reason: 'Der Projektbereich wird während der laufenden Phase geschlossen.' }, { version: projectBeforeArchive.data.version });
  expect(archive.response.status(), JSON.stringify(archive.data)).toBe(200);

  const reporter = await createTechnicalReporter(ownerApi, baseURL, project.id);
  try {
    const report = await submitReport(ownerApi, reporter.agent, workRunId, activeTask.data.version, {
      summary: 'Der aktuelle Auftrag ist erledigt, der nächste Phasenstart muss die Projektarchivierung beachten.',
      label: 'Arbeitsbericht',
      text: 'Der erste Workflowabschnitt ist abgeschlossen.',
    });
    await readUntil(ownerApi, '/runs/' + workRunId, (run) => run.state === 'succeeded', 'Der bestehende Lauf darf trotz Projektarchivierung abgeschlossen werden.');
    const paused = await readUntil(ownerApi, '/workflow-instances/' + instance.id, (current) => current.state === 'paused' && current.run_ids.length === 1, 'Die Folgephase muss vor Taskbewegung und T3-Start pausieren.');
    expect(paused.pause_reason).toContain('archivierten Projekt');
    const afterPause = await ownerApi.get('/tasks/' + created.id);
    expect(afterPause.data).toMatchObject({ version: activeTask.data.version, status_category: 'active' });
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.active.column_id, created.id)).toBe(true);
    expect(await taskOnBoardColumn(ownerApi, board.id, targets.review.column_id, created.id)).toBe(false);
    expect(report.report.accepted_for_reconciliation).toBe(true);

    const journal = await qaMocks.t3Journal();
    expect(journal.unexpected).toEqual([]);
    expect(journal.accepted_launches).toHaveLength(1);
    expect(await launchForRun(qaMocks, workRunId)).toBeTruthy();

    recordEvidence(
      'Ein archiviertes Projekt hält die nächste Workflowphase vor Boardbewegung und T3-Start an, während der bereits laufende Agentenauftrag seinen Bericht abschließen darf.',
      'Der bestehende Arbeitslauf ' + workRunId + ' endete mit einem angenommenen Bericht. Beim Eintritt in die Reviewphase erkannte die Startfreigabe das archivierte Projekt und pausierte die Workflowinstanz ' + instance.id + ' ohne zweiten Run. Ticketversion ' + activeTask.data.version + ', Status active und die aktive Boardspalte blieben unverändert; T3 nahm genau einen Launch an.',
      { t3: journal },
    );
  } finally {
    await reporter.close();
  }
});
