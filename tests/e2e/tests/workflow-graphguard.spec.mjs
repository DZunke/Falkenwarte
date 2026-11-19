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
  try {
    await expect.poll(async () => {
      const result = await ownerApi.get(route);
      if (result.response.status() !== 200) return false;
      current = result.data;
      return matches(current);
    }, { timeout, message: description }).toBe(true);
  } catch (error) {
    throw new Error(`${description}\nZuletzt beobachteter öffentlicher API-Stand: ${JSON.stringify(current)}`, { cause: error });
  }
  return current;
}

async function createReadyTask(ownerApi, projectId) {
  await ownerApi.ensureDefaultBoard(projectId);
  const statuses = await ownerApi.get(`/projects/${projectId}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const ready = statuses.data.items.find((item) => item.category === 'ready');
  expect(ready).toBeTruthy();
  return ownerApi.createTask(projectId, {
    title: 'A12 Graphguard wartet auf geprüften Nachweis',
    status_id: ready.id,
  });
}

async function createReporter(ownerApi, baseURL, projectId) {
  const issued = await ownerApi.createTechnicalToken({
    label: `A12 Graphguard ${randomUUID().slice(0, 8)}`,
    projectIds: [projectId],
    capabilities: ['runs.report'],
  });
  return createAgentSimulator(baseURL, issued.token);
}

async function reportRun(agent, ownerApi, runId, task, reportId) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await ownerApi.get(`/runs/${runId}`);
    expect(latest.response.status(), JSON.stringify(latest.data)).toBe(200);
    result = await agent.call('runs_report_result', {
      run_id: runId,
      report_id: reportId,
      attempt_no: latest.data.attempt_no,
      task_revision: task.version,
      outcome: 'reported_success',
      summary: 'Der T3-Agent meldet einen Ergebnisstand mit einem menschlich zu prüfenden Nachweis.',
      artifacts: [{
        kind: 'note',
        label: 'Graphguard-Nachweis',
        text: 'Dieser gemeldete Nachweis ist noch nicht menschlich bestätigt.',
      }],
      client_request_id: randomUUID(),
      expected_version: latest.data.version,
    });
    if (!result.isError || result.structuredContent?.status !== 412) break;
  }
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return result.structuredContent;
}

test('A12 accepted workflow transition stays paused until its evidence condition is confirmed', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.info().annotations.push({ type: 'scenario', description: 'E23' });
  test.setTimeout(180_000);
  test.info().annotations.push({ type: 'acceptance', description: 'A12' });
  const project = await ownerApi.createProject({ name: 'A12 Graphguard Bedingung' });
  await ownerApi.ensureDefaultBoard(project.id);

  const connectionResult = await ownerApi.post('/connections', {
    name: 'A12 Graphguard T3',
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(connectionResult.response.status(), JSON.stringify(connectionResult.data)).toBe(201);
  const connection = connectionResult.data;
  const callback = new URL('/auth/t3/callback', baseURL).toString();
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, { redirect_uri: callback }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Der Browser-OAuth-Fluss muss die T3-Verbindung autorisieren.');

  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der echte MCP-Handshake muss alle T3-Fähigkeiten bestätigen.');
  const checkRecord = await ownerApi.get(`/connections/${connection.id}/check`);
  expect(checkRecord.response.status(), JSON.stringify(checkRecord.data)).toBe(200);
  expect([checkRecord.data.network, checkRecord.data.authentication, checkRecord.data.mcp_handshake, checkRecord.data.capabilities]).toEqual(['ok', 'ok', 'ok', 'ok']);

  const latestProject = await ownerApi.get(`/projects/${project.id}`);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: latestProject.data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);

  const profileResult = await ownerApi.post('/agent-profiles', {
    name: 'A12 Graphguard Rolle',
    icon_key: 'bot',
    role: 'Phasenbearbeitung',
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Melde das Ergebnis mit einer aussagekräftigen Notiz.',
    enabled: true,
    default_run_completion_policy: runPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(profileResult.response.status(), JSON.stringify(profileResult.data)).toBe(201);

  const stages = [
    {
      id: 'implementation',
      kind: 'implementation',
      name: 'Bearbeitung',
      agent_profile_id: profileResult.data.id,
      entry_conditions: [],
      run_completion_policy: runPolicy,
    },
    {
      id: 'review',
      kind: 'review',
      name: 'Prüfung',
      agent_profile_id: profileResult.data.id,
      entry_conditions: [{ type: 'run_succeeded' }],
      run_completion_policy: { ...runPolicy, require_human_phase_decision: true },
    },
    {
      id: 'release',
      kind: 'approval',
      name: 'Freigabe',
      agent_profile_id: profileResult.data.id,
      entry_conditions: [],
      run_completion_policy: runPolicy,
    },
  ];
  const transitions = [
    {
      from_stage_id: 'implementation',
      to_stage_id: 'review',
      on: 'accepted',
      conditions: [{ type: 'required_evidence_human_confirmed', evidence_kind: 'note' }],
    },
    { from_stage_id: 'implementation', to_stage_id: 'implementation', on: 'needs_changes', conditions: [] },
    {
      from_stage_id: 'review',
      to_stage_id: 'release',
      on: 'accepted',
      conditions: [{ type: 'review_report_accepted' }, { type: 'human_approval_granted' }],
    },
    { from_stage_id: 'review', to_stage_id: 'implementation', on: 'needs_changes', conditions: [] },
  ];
  const workflowWrite = {
    project_id: project.id,
    name: 'A12 Bedingungsgebundener Übergang',
    preset_id: 'manual',
    stages,
    transitions,
    limits: { max_repair_rounds: 1, max_depth: 3, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  };
  const invalidFirstStage = await ownerApi.post('/workflows', {
    ...workflowWrite,
    name: 'A12 ungültiger erster Stageabschluss',
    stages: [{ ...stages[0], entry_conditions: [{ type: 'run_succeeded' }] }, stages[1], stages[2]],
  });
  expect(invalidFirstStage.response.status(), JSON.stringify(invalidFirstStage.data)).toBe(422);
  expect(invalidFirstStage.data.code).toBe('workflow_condition_future_stage');
  const invalidMissingReview = await ownerApi.post('/workflows', {
    ...workflowWrite,
    name: 'A12 ungültige fehlende Vorprüfung',
    stages: [stages[0], stages[2]],
    transitions: [{
      from_stage_id: 'implementation',
      to_stage_id: 'release',
      on: 'accepted',
      conditions: [{ type: 'review_report_accepted' }],
    }],
  });
  expect(invalidMissingReview.response.status(), JSON.stringify(invalidMissingReview.data)).toBe(422);
  expect(invalidMissingReview.data.code).toBe('workflow_condition_future_stage');

  const validGraphResult = await ownerApi.post('/workflows', workflowWrite);
  expect(validGraphResult.response.status(), JSON.stringify(validGraphResult.data)).toBe(201);
  const validGraph = validGraphResult.data.workflow ?? validGraphResult.data;
  const runtimeWorkflowResult = await ownerApi.post('/workflows', {
    ...workflowWrite,
    name: 'A12 Laufzeitprüfung am bedingten Übergang',
    stages: [stages[0], { ...stages[1], run_completion_policy: runPolicy }],
    transitions: transitions.filter((transition) => !(transition.from_stage_id === 'review' && transition.on === 'accepted')),
    limits: { ...workflowWrite.limits, max_depth: 2 },
  });
  expect(runtimeWorkflowResult.response.status(), JSON.stringify(runtimeWorkflowResult.data)).toBe(201);
  const workflow = runtimeWorkflowResult.data.workflow ?? runtimeWorkflowResult.data;

  const taskResult = await createReadyTask(ownerApi, project.id);
  const taskRead = await ownerApi.get(`/tasks/${taskResult.id}`);
  expect(taskRead.response.status(), JSON.stringify(taskRead.data)).toBe(200);
  const task = taskRead.data;
  const started = await ownerApi.post(`/tasks/${task.id}/workflow-instances`, {
    workflow_id: workflow.id,
    definition_version: workflow.definition_version,
    task_revision: task.version,
  }, { version: task.version });
  expect(started.response.status(), JSON.stringify(started.data)).toBe(202);
  const instanceId = started.data.resource?.id ?? started.data.instance_id;
  const initial = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (item) => item.run_ids.length === 1, 'Der erste Workflow-Run muss über den T3-Adapter gestartet werden.');
  const firstRunId = initial.run_ids[0];
  const reporter = await createReporter(ownerApi, baseURL, project.id);

  try {
    const firstRun = await readUntil(ownerApi, `/runs/${firstRunId}`, (item) => ['running', 'verifying'].includes(item.state), 'Der erste T3-Run muss beobachtbar sein.');
    const reportId = randomUUID();
    await reportRun(reporter.agent, ownerApi, firstRunId, task, reportId);
    await readUntil(ownerApi, `/runs/${firstRunId}`, (item) => item.state === 'succeeded', 'Der erste Run muss mit dem gemeldeten Ergebnis erfolgreich enden.');

    const paused = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (item) => item.state === 'paused', 'Der konfigurierte Übergang muss auf die menschliche Nachweisbestätigung warten.');
    expect(paused.current_stage_id).toBe('implementation');
    expect(paused.run_ids).toEqual([firstRunId]);
    const storedReport = await ownerApi.get(`/runs/${firstRunId}/result-reports/${reportId}`);
    expect(storedReport.response.status(), JSON.stringify(storedReport.data)).toBe(200);
    expect(storedReport.data.evidence_ids).toHaveLength(1);
    const evidenceId = storedReport.data.evidence_ids[0];
    const evidenceRead = await ownerApi.get(`/evidence/${evidenceId}`);
    expect(evidenceRead.response.status(), JSON.stringify(evidenceRead.data)).toBe(200);
    expect(evidenceRead.data).toMatchObject({ review_status: 'reported', kind: 'note', run_id: firstRunId });

    const journalBeforeReview = await qaMocks.t3Journal();
    expect(journalBeforeReview.accepted_launches).toHaveLength(1);
    expect(journalBeforeReview.unexpected).toEqual([]);

    const review = await ownerApi.post(`/evidence/${evidenceId}/review`, {
      decision: 'human_confirmed',
      reason: 'Der Owner hat den gemeldeten Nachweis geprüft und bestätigt.',
    }, { version: evidenceRead.data.version });
    expect(review.response.status(), JSON.stringify(review.data)).toBe(200);
    expect(review.data).toMatchObject({ review_status: 'human_confirmed', reviewed_by: { kind: 'owner' } });
    const stillPaused = await ownerApi.get(`/workflow-instances/${instanceId}`);
    expect(stillPaused.response.status()).toBe(200);
    expect(stillPaused.data.state).toBe('paused');
    expect(stillPaused.data.run_ids).toEqual([firstRunId]);

    const resume = await ownerApi.post(`/workflow-instances/${instanceId}/control`, {
      action: 'resume',
      reason: 'Die erforderliche Nachweisprüfung ist abgeschlossen.',
    }, { version: stillPaused.data.version });
    expect(resume.response.status(), JSON.stringify(resume.data)).toBe(202);
    const advanced = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (item) => item.run_ids.length === 2, 'Nach dem Resume muss genau ein Folgerun angelegt werden.');
    expect(advanced.state).toBe('running');
    expect(advanced.current_stage_id).toBe('review');
    expect(advanced.run_ids).toEqual([firstRunId, expect.any(String)]);
    expect(new Set(advanced.run_ids).size).toBe(2);
    const secondRunId = advanced.run_ids[1];
    const secondRun = await readUntil(ownerApi, `/runs/${secondRunId}`, (item) => ['running', 'verifying'].includes(item.state), 'Der Folgerun muss als Review-Phase am realen T3-Mock ankommen.');
    expect(secondRun.stage).toBe('review');

    const journalAfterResume = await qaMocks.t3Journal();
    expect(journalAfterResume.accepted_launches).toHaveLength(2);
    expect(new Set(journalAfterResume.accepted_launches.map((item) => item.clientRequestId)).size).toBe(2);
    expect(journalAfterResume.unexpected).toEqual([]);

    const secondReportId = randomUUID();
    await reportRun(reporter.agent, ownerApi, secondRunId, task, secondReportId);
    await readUntil(ownerApi, `/runs/${secondRunId}`, (item) => item.state === 'succeeded', 'Der einzelne Review-Folgerun muss sich mit einer Agentmeldung abschließen lassen.');
    const finished = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (item) => item.state === 'succeeded', 'Der Workflow muss nach seiner letzten Phase ohne konfigurierten Folgeübergang abschließen.');
    expect(finished.run_ids).toEqual([firstRunId, secondRunId]);

    const finalJournal = await qaMocks.t3Journal();
    expect(finalJournal.accepted_launches).toHaveLength(2);
    expect(finalJournal.unexpected).toEqual([]);
    recordEvidence(
      'A12/M4: Die Workflow-Graphprüfung weist unmögliche Erstphasenbedingungen zurück; ein gültiger Implementierung→Review→Freigabe-Graph mit Reparaturpfad wird angenommen. Der ausführbare Workflow bleibt bei offenem Nachweis pausiert und startet nach Ownerprüfung und Resume genau einen Folgerun.',
      `Öffentliche Workflow-POSTs wiesen unmögliche Erstphasenbedingungen mit ${invalidFirstStage.data.code} und ${invalidMissingReview.data.code} (HTTP 422) ab und nahmen den gültigen dreiphasigen Graph ${validGraph.id} (HTTP 201) an. Ausführungsworkflow ${instanceId} blieb nach erfolgreichem Run ${firstRunId} in der Phase implementation pausiert und behielt genau einen Run; der T3-Mock hatte einen Launch. Die Owner-API bestätigte Evidence ${evidenceId}, der Browser-gestartete Resume erzeugte genau einen Review-Run ${secondRunId}; der Workflow endete mit zwei eindeutigen Runs und genau zwei T3-Launches.`,
      { t3: finalJournal },
    );
  } finally {
    await reporter.close();
  }
});
