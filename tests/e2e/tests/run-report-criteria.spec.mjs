import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

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

function resultArguments(run, taskRevision, reportId, criterionAId, criterionBId, clientRequestId = randomUUID(), expectedVersion = run.version) {
  return {
    run_id: run.id,
    report_id: reportId,
    attempt_no: run.attempt_no,
    task_revision: taskRevision,
    outcome: 'reported_success',
    summary: 'Der Agent ordnet zwei konkrete Nachweise den passenden Akzeptanzkriterien zu.',
    artifacts: [
      {
        kind: 'note',
        label: 'Nachweis für Kriterium A',
        text: 'Der Agent meldet den konkreten Prüfschritt für Kriterium A.',
        criterion_ids: [criterionAId],
      },
      {
        kind: 'note',
        label: 'Nachweis für Kriterium B',
        text: 'Der Agent meldet den konkreten Prüfschritt für Kriterium B.',
        criterion_ids: [criterionBId],
      },
    ],
    client_request_id: clientRequestId,
    expected_version: expectedVersion,
  };
}

test('MCP result reports map evidence to selected criteria and keep human review explicit', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(180_000);
  const project = await ownerApi.createProject({ name: 'Kriterienzuordnung aus Agentenbericht' });
  const connectionResult = await ownerApi.post('/connections', {
    name: 'Kriterienzuordnung T3',
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(connectionResult.response.status(), JSON.stringify(connectionResult.data)).toBe(201);
  const connection = connectionResult.data;

  const callback = new URL('/auth/t3/callback', baseURL).toString();
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, { redirect_uri: callback }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Der Browser-OAuth-Fluss muss T3 autorisieren.');

  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der echte T3-MCP-Handshake muss erfolgreich sein.');
  const checkRecord = await ownerApi.get(`/connections/${connection.id}/check`);
  expect(checkRecord.response.status(), JSON.stringify(checkRecord.data)).toBe(200);
  expect([checkRecord.data.network, checkRecord.data.authentication, checkRecord.data.mcp_handshake, checkRecord.data.capabilities]).toEqual(['ok', 'ok', 'ok', 'ok']);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: (await ownerApi.get(`/projects/${project.id}`)).data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);

  const board = await ownerApi.ensureDefaultBoard(project.id);
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const readyStatus = statuses.data.items.find((status) => status.category === 'ready');
  expect(readyStatus).toBeTruthy();
  const taskResult = await ownerApi.createTask(project.id, {
    title: 'Ordne Agentennachweise selektiv zu',
    status_id: readyStatus.id,
    criteria: [
      { text: 'Erster Prüfschritt ist nachvollziehbar belegt.', is_required: true },
      { text: 'Zweiter Prüfschritt ist nachvollziehbar belegt.', is_required: true },
      { text: 'Dritter Prüfschritt bleibt zunächst offen.', is_required: true },
    ],
  });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  expect(task.criteria).toHaveLength(3);
  const [criterionA, criterionB, criterionOpen] = task.criteria;
  expect(new Set(task.criteria.map((criterion) => criterion.id)).size).toBe(3);

  const foreignTaskResult = await ownerApi.createTask(project.id, {
    title: 'Fremdes Kriterium für die Negativprüfung',
    status_id: readyStatus.id,
    criteria: [{ text: 'Dieses Kriterium gehört zu einem anderen Ticket.', is_required: true }],
  });
  const foreignTask = (await ownerApi.get(`/tasks/${foreignTaskResult.id}`)).data;
  const foreignCriterionId = foreignTask.criteria[0].id;
  expect(task.criteria.map((criterion) => criterion.id)).not.toContain(foreignCriterionId);

  const profileResult = await ownerApi.post('/agent-profiles', {
    name: 'Kriterienzuordnung Rolle',
    icon_key: 'bot',
    role: 'Implementierung',
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Melde nur tatsächlich durchgeführte Prüfungen und ordne jeden Nachweis dem belegten Kriterium zu.',
    enabled: true,
    default_run_completion_policy: {
      require_external_settled: true,
      required_evidence_kinds: [],
      required_criterion_ids: [criterionA.id, criterionB.id],
      require_human_phase_decision: false,
      require_human_confirmed_evidence: false,
    },
    execution_target: { mode: 't3_project_default' },
  });
  expect(profileResult.response.status(), JSON.stringify(profileResult.data)).toBe(201);

  const started = await ownerApi.post(`/tasks/${task.id}/runs`, {
    agent_profile_id: profileResult.data.id,
    stage: 'implementation',
    task_revision: task.version,
  }, { version: task.version });
  expect(started.response.status(), JSON.stringify(started.data)).toBe(202);
  const runId = started.data.run_id ?? started.data.resource?.id;
  expect(runId).toBeTruthy();
  let run = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.state === 'verifying', 'Der T3-Lauf muss für den Agentenbericht bereit sein.');
  expect(run.snapshot.task_revision).toBe(task.version);
  expect(run.snapshot.run_completion_policy.required_criterion_ids).toEqual([criterionA.id, criterionB.id]);

  const t3 = await qaMocks.t3Journal();
  expect(t3.unexpected).toEqual([]);
  expect(t3.accepted_launches).toHaveLength(1);
  const launch = t3.accepted_launches.find((item) => item.payload.message.includes(`Run-ID: ${runId}\n`));
  expect(launch).toBeTruthy();
  for (const criterion of task.criteria) {
    expect(launch.payload.message).toContain(`(ID: ${criterion.id})`);
  }
  expect(launch.payload.message).toContain('artifacts[].criterion_ids');

  const reportToken = await ownerApi.createTechnicalToken({
    label: `Kriterienbericht ${randomUUID().slice(0, 8)}`,
    projectIds: [project.id],
    capabilities: ['runs.report', 'evidence.report'],
  });
  const reporter = await createAgentSimulator(baseURL, reportToken.token);

  try {
    const invalidReportId = randomUUID();
    const invalidReport = await reporter.agent.callRaw('runs_report_result', {
      ...resultArguments(run, task.version, invalidReportId, criterionA.id, criterionB.id),
      artifacts: [
        { kind: 'note', label: 'Gültiger Teil', text: 'Dieser Teil darf bei einem Gesamtfehler nicht gespeichert werden.', criterion_ids: [criterionA.id] },
        { kind: 'note', label: 'Fremdes Kriterium', text: 'Dieses Kriterium gehört zu einem anderen Ticket.', criterion_ids: [foreignCriterionId] },
      ],
    });
    expect(invalidReport.response.status(), JSON.stringify(invalidReport.data)).toBe(200);
    expect(invalidReport.data?.error).toBeUndefined();
    expect(invalidReport.data?.result?.isError, JSON.stringify(invalidReport.data?.result)).toBe(true);
    expect(invalidReport.data?.result?.structuredContent).toMatchObject({ status: 409, code: 'criterion_not_found' });
    const missingReport = await ownerApi.get(`/runs/${runId}/result-reports/${invalidReportId}`);
    expect(missingReport.response.status(), JSON.stringify(missingReport.data)).toBe(404);
    const taskAfterRejection = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(taskAfterRejection.version).toBe(task.version);
    expect(taskAfterRejection.criteria.map((criterion) => criterion.evidence_ids)).toEqual([[], [], []]);
    const evidenceAfterRejection = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidenceAfterRejection.response.status(), JSON.stringify(evidenceAfterRejection.data)).toBe(200);
    expect(evidenceAfterRejection.data.items).toEqual([]);
    const runAfterRejection = (await ownerApi.get(`/runs/${runId}`)).data;
    expect(runAfterRejection.report_ids).toEqual([]);

    const reportId = randomUUID();
    const firstArguments = resultArguments(runAfterRejection, task.version, reportId, criterionA.id, criterionB.id);
    const first = await reporter.agent.call('runs_report_result', firstArguments);
    expect(first.isError, JSON.stringify(first.structuredContent)).toBe(false);

    const afterFirst = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.report_ids?.includes(reportId) && item.state === 'verifying', 'Der gültige Bericht muss zugeordnet werden und wegen ausstehender Ownerbestätigung in Prüfung bleiben.');
    const report = await readUntil(ownerApi, `/runs/${runId}/result-reports/${reportId}`, (item) => item.id === reportId, 'Der Ergebnisbericht muss öffentlich lesbar sein.');
    expect(report).toMatchObject({
      id: reportId,
      run_id: runId,
      task_revision: task.version,
      accepted_for_reconciliation: true,
    });
    expect(report.evidence_ids).toHaveLength(2);
    expect(afterFirst.state).toBe('verifying');

    const taskAfterReport = await readUntil(ownerApi, `/tasks/${task.id}`, (item) => item.criteria[0].state === 'reported' && item.criteria[1].state === 'reported', 'Nur die beiden ausdrücklich zugeordneten Kriterien dürfen als gemeldet erscheinen.');
    expect(taskAfterReport.criteria).toEqual([
      expect.objectContaining({ id: criterionA.id, state: 'reported', evidence_ids: [report.evidence_ids[0]] }),
      expect.objectContaining({ id: criterionB.id, state: 'reported', evidence_ids: [report.evidence_ids[1]] }),
      expect.objectContaining({ id: criterionOpen.id, state: 'pending', evidence_ids: [] }),
    ]);
    const evidencePage = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidencePage.response.status(), JSON.stringify(evidencePage.data)).toBe(200);
    expect(evidencePage.data.items).toHaveLength(2);
    const evidenceA = evidencePage.data.items.find((item) => item.criterion_ids?.includes(criterionA.id));
    const evidenceB = evidencePage.data.items.find((item) => item.criterion_ids?.includes(criterionB.id));
    expect(evidenceA).toMatchObject({ run_id: runId, review_status: 'reported', criterion_ids: [criterionA.id] });
    expect(evidenceB).toMatchObject({ run_id: runId, review_status: 'reported', criterion_ids: [criterionB.id] });
    expect(report.evidence_ids).toEqual(expect.arrayContaining([evidenceA.id, evidenceB.id]));

    const replayRun = (await ownerApi.get(`/runs/${runId}`)).data;
    const replay = await reporter.agent.call('runs_report_result', {
      ...firstArguments,
      client_request_id: randomUUID(),
      expected_version: replayRun.version,
    });
    expect(replay.isError, JSON.stringify(replay.structuredContent)).toBe(false);
    const replayedReport = await ownerApi.get(`/runs/${runId}/result-reports/${reportId}`);
    expect(replayedReport.response.status(), JSON.stringify(replayedReport.data)).toBe(200);
    expect(replayedReport.data.evidence_ids).toEqual(report.evidence_ids);
    const replayedRun = (await ownerApi.get(`/runs/${runId}`)).data;
    expect(replayedRun.report_ids).toEqual([reportId]);
    expect(replayedRun.evidence_ids).toHaveLength(2);
    const taskAfterReplay = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(taskAfterReplay.criteria.map((criterion) => criterion.evidence_ids)).toEqual([
      [evidenceA.id],
      [evidenceB.id],
      [],
    ]);

    const flowPage = await ownerApi.get(`/tasks/${task.id}/flow?limit=10`);
    expect(flowPage.response.status(), JSON.stringify(flowPage.data)).toBe(200);
    expect(flowPage.data.items).toHaveLength(1);
    expect(flowPage.data.items[0].run).toMatchObject({ id: runId, state: 'verifying', attempt_no: run.attempt_no });
    expect(flowPage.data.items[0].run.reports).toEqual([
      expect.objectContaining({
        id: reportId,
        task_revision: task.version,
        accepted_for_reconciliation: true,
        evidence_ids: report.evidence_ids,
      }),
    ]);

    const confirmA = await ownerApi.post(`/tasks/${task.id}/criteria/${criterionA.id}/review`, {
      decision: 'human_confirmed',
      evidence_ids: [evidenceA.id],
      reason: 'Der Eigentümer bestätigt Kriterium A anhand des zugeordneten Agentenberichts.',
    }, { version: taskAfterReplay.version });
    expect(confirmA.response.status(), JSON.stringify(confirmA.data)).toBe(200);
    expect(confirmA.data.criteria).toEqual([
      expect.objectContaining({ id: criterionA.id, state: 'human_confirmed', evidence_ids: [evidenceA.id] }),
      expect.objectContaining({ id: criterionB.id, state: 'reported', evidence_ids: [evidenceB.id] }),
      expect.objectContaining({ id: criterionOpen.id, state: 'pending', evidence_ids: [] }),
    ]);
    const evidenceAfterA = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidenceAfterA.response.status(), JSON.stringify(evidenceAfterA.data)).toBe(200);
    expect(evidenceAfterA.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: evidenceB.id, task_revision: run.snapshot.task_revision, criterion_ids: [criterionB.id] }),
    ]));
    run = (await ownerApi.get(`/runs/${runId}`)).data;
    expect(run.state).toBe('verifying');
    const stillAccepted = await ownerApi.get(`/runs/${runId}/result-reports/${reportId}`);
    expect(stillAccepted.data).toMatchObject({ accepted_for_reconciliation: true, evidence_ids: report.evidence_ids });

    const confirmB = await ownerApi.post(`/tasks/${task.id}/criteria/${criterionB.id}/review`, {
      decision: 'human_confirmed',
      evidence_ids: [evidenceB.id],
      reason: 'Der Eigentümer bestätigt Kriterium B anhand seines weiter gültigen Nachweises.',
    }, { version: confirmA.data.version });
    expect(confirmB.response.status(), JSON.stringify(confirmB.data)).toBe(200);
    expect(confirmB.data.criteria).toEqual([
      expect.objectContaining({ id: criterionA.id, state: 'human_confirmed', evidence_ids: [evidenceA.id] }),
      expect.objectContaining({ id: criterionB.id, state: 'human_confirmed', evidence_ids: [evidenceB.id] }),
      expect.objectContaining({ id: criterionOpen.id, state: 'pending', evidence_ids: [] }),
    ]);
    const finalFlow = await ownerApi.get(`/tasks/${task.id}/flow?limit=10`);
    expect(finalFlow.response.status(), JSON.stringify(finalFlow.data)).toBe(200);
    expect(finalFlow.data.items).toHaveLength(1);
    expect(finalFlow.data.items[0].run.reports).toHaveLength(1);
    expect(finalFlow.data.items[0].run.reports[0]).toMatchObject({ id: reportId, accepted_for_reconciliation: true, evidence_ids: report.evidence_ids });
    const finalRun = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.state === 'succeeded', 'Nach Bestätigung beider Phasenkriterien soll der Lauf abschließen.');
    expect(finalRun.report_ids).toEqual([reportId]);

    const confirmedTask = (await ownerApi.get(`/tasks/${task.id}`)).data;
    const confirmedCriterion = confirmedTask.criteria.find((criterion) => criterion.id === criterionA.id);
    expect(confirmedCriterion).toMatchObject({ state: 'human_confirmed', reviewed_by: { kind: 'owner' } });
    const ownerDecision = {
      reviewed_at: confirmedCriterion.reviewed_at,
      reviewed_by: confirmedCriterion.reviewed_by,
      review_reason: confirmedCriterion.review_reason,
    };
    const repeatedAssignment = await reporter.agent.call('tasks_link_evidence', {
      task_id: task.id,
      criterion_id: criterionA.id,
      evidence_ids: [evidenceA.id],
      client_request_id: randomUUID(),
      expected_version: confirmedTask.version,
    });
    expect(repeatedAssignment.isError, JSON.stringify(repeatedAssignment.structuredContent)).toBe(false);
    expect(repeatedAssignment.structuredContent.version).toBe(confirmedTask.version);
    expect(repeatedAssignment.structuredContent.criteria.find((criterion) => criterion.id === criterionA.id)).toMatchObject({
      state: 'human_confirmed',
      evidence_ids: [evidenceA.id],
      ...ownerDecision,
    });

    const forbiddenEvidence = await reporter.agent.call('evidence_register', {
      task_id: task.id,
      task_revision: confirmedTask.version,
      run_id: null,
      attempt_no: null,
      artifact: { kind: 'note', label: 'Nicht zuordnen', text: 'Diese Meldung darf die bestätigte Nachweismenge nicht ergänzen.' },
      criterion_ids: [criterionA.id],
      client_request_id: randomUUID(),
      expected_version: confirmedTask.version,
    });
    expect(forbiddenEvidence.isError, JSON.stringify(forbiddenEvidence.structuredContent)).toBe(true);
    expect(forbiddenEvidence.structuredContent).toMatchObject({ status: 409, code: 'criterion_already_confirmed' });
    const evidenceAfterForbiddenRegister = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(task.id)}&limit=100`);
    expect(evidenceAfterForbiddenRegister.data.items).toHaveLength(2);

    const agentEvidence = await reporter.agent.call('evidence_register', {
      task_id: task.id,
      task_revision: confirmedTask.version,
      run_id: null,
      attempt_no: null,
      artifact: { kind: 'note', label: 'Zusätzliche Agentennotiz', text: 'Eine Agentennotiz nach der fachlichen Bestätigung.' },
      criterion_ids: [],
      client_request_id: randomUUID(),
      expected_version: confirmedTask.version,
    });
    expect(agentEvidence.isError, JSON.stringify(agentEvidence.structuredContent)).toBe(false);
    expect(agentEvidence.structuredContent).toMatchObject({ task_id: task.id, task_revision: confirmedTask.version, review_status: 'reported' });
    const linkedByAgent = await reporter.agent.call('tasks_link_evidence', {
      task_id: task.id,
      criterion_id: criterionA.id,
      evidence_ids: [agentEvidence.structuredContent.id],
      client_request_id: randomUUID(),
      expected_version: confirmedTask.version,
    });
    expect(linkedByAgent.isError, JSON.stringify(linkedByAgent.structuredContent)).toBe(true);
    expect(linkedByAgent.structuredContent).toMatchObject({ status: 409, code: 'criterion_already_confirmed' });
    expect((await ownerApi.get(`/tasks/${task.id}`)).data.version).toBe(confirmedTask.version);
    const taskAfterAgentLink = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(taskAfterAgentLink.criteria.find((criterion) => criterion.id === criterionA.id)).toMatchObject({
      state: 'human_confirmed',
      evidence_ids: [evidenceA.id],
      ...ownerDecision,
    });
    expect(taskAfterAgentLink.version).toBe(confirmedTask.version);

    const staleTaskResult = await ownerApi.createTask(project.id, {
      title: 'Aufgabe vor dem veralteten Bericht',
      status_id: readyStatus.id,
      criteria: [{ text: 'Das Kriterium aus dem gestarteten Auftrag bleibt historisch.', is_required: true }],
    });
    const staleTask = (await ownerApi.get(`/tasks/${staleTaskResult.id}`)).data;
    const historicalCriterion = staleTask.criteria[0];
    const staleRunStart = await ownerApi.post(`/tasks/${staleTask.id}/runs`, {
      agent_profile_id: profileResult.data.id,
      stage: 'implementation',
      task_revision: staleTask.version,
    }, { version: staleTask.version });
    expect(staleRunStart.response.status(), JSON.stringify(staleRunStart.data)).toBe(202);
    const staleRunId = staleRunStart.data.run_id ?? staleRunStart.data.resource?.id;
    expect(staleRunId).toBeTruthy();
    const staleRun = await readUntil(ownerApi, `/runs/${staleRunId}`, (item) => item.state === 'verifying', 'Der zweite T3-Auftrag muss vor der inhaltlichen Änderung gestartet sein.');
    expect(staleRun.snapshot.criteria).toEqual([expect.objectContaining({ id: historicalCriterion.id })]);

    const revisedStaleTask = await ownerApi.patch(`/tasks/${staleTask.id}`, {
      title: 'Aufgabe nach der inhaltlichen Änderung',
      description: 'Der laufende Auftrag bezieht sich auf den vorherigen Aufgabenstand.',
    }, { version: staleTask.version });
    expect(revisedStaleTask.response.status(), JSON.stringify(revisedStaleTask.data)).toBe(200);
    expect(revisedStaleTask.data.version).toBeGreaterThan(staleTask.version);
    const currentStaleRun = (await ownerApi.get(`/runs/${staleRunId}`)).data;
    expect(currentStaleRun.state).toBe('verifying');
    expect(currentStaleRun.snapshot.task_revision).toBe(staleTask.version);

    const staleReportId = randomUUID();
    const staleReportResult = await reporter.agent.call('runs_report_result', {
      run_id: staleRunId,
      report_id: staleReportId,
      attempt_no: currentStaleRun.attempt_no,
      task_revision: currentStaleRun.snapshot.task_revision,
      outcome: 'reported_success',
      summary: 'Historischer Bericht zum inzwischen geänderten Aufgabenstand.',
      artifacts: [{
        kind: 'note',
        label: 'Historischer Nachweis',
        text: 'Dieser Nachweis bezieht sich auf den Inhalt des eingefrorenen Auftrags.',
        criterion_ids: [historicalCriterion.id],
      }],
      client_request_id: randomUUID(),
      expected_version: currentStaleRun.version,
    });
    expect(staleReportResult.isError, JSON.stringify(staleReportResult.structuredContent)).toBe(false);
    const staleReport = await readUntil(ownerApi, `/runs/${staleRunId}/result-reports/${staleReportId}`, (item) => item.id === staleReportId && item.accepted_for_reconciliation === false, 'Der veraltete Bericht muss als historische Meldung sichtbar bleiben.');
    expect(staleReport).toMatchObject({
      run_id: staleRunId,
      attempt_no: currentStaleRun.attempt_no,
      task_revision: staleTask.version,
      accepted_for_reconciliation: false,
    });
    expect(staleReport.evidence_ids).toHaveLength(1);

    const currentStaleTask = await ownerApi.get(`/tasks/${staleTask.id}`);
    expect(currentStaleTask.response.status(), JSON.stringify(currentStaleTask.data)).toBe(200);
    expect(currentStaleTask.data).toMatchObject({ title: revisedStaleTask.data.title, version: revisedStaleTask.data.version });
    expect(currentStaleTask.data.criteria).toEqual([
      expect.objectContaining({ id: historicalCriterion.id, state: 'pending', evidence_ids: [] }),
    ]);
    const staleEvidence = await ownerApi.get(`/evidence?task_id=${encodeURIComponent(staleTask.id)}&limit=100`);
    expect(staleEvidence.response.status(), JSON.stringify(staleEvidence.data)).toBe(200);
    expect(staleEvidence.data.items).toEqual([
      expect.objectContaining({
        id: staleReport.evidence_ids[0],
        task_revision: staleTask.version,
        criterion_ids: [historicalCriterion.id],
        review_status: 'reported',
      }),
    ]);
    const staleBoard = await ownerApi.get(`/boards/${board.id}/view?limit_per_column=100`);
    expect(staleBoard.response.status(), JSON.stringify(staleBoard.data)).toBe(200);
    const staleCard = staleBoard.data.columns.flatMap((column) => column.items).find((item) => item.id === staleTask.id);
    expect(staleCard).toMatchObject({
      title: revisedStaleTask.data.title,
      criteria: [expect.objectContaining({ id: historicalCriterion.id, state: 'pending', evidence_ids: [] })],
    });
    const staleFlow = await ownerApi.get(`/tasks/${staleTask.id}/flow?limit=10`);
    expect(staleFlow.response.status(), JSON.stringify(staleFlow.data)).toBe(200);
    expect(staleFlow.data.items).toHaveLength(1);
    expect(staleFlow.data.items[0].run.reports).toEqual([
      expect.objectContaining({
        id: staleReportId,
        attempt_no: currentStaleRun.attempt_no,
        task_revision: staleTask.version,
        accepted_for_reconciliation: false,
        evidence_ids: staleReport.evidence_ids,
      }),
    ]);
    const staleRunAfterReport = (await ownerApi.get(`/runs/${staleRunId}`)).data;
    expect(staleRunAfterReport.report_ids).toEqual([]);
    expect(staleRunAfterReport.evidence_ids).toEqual([]);

    const finalJournal = await qaMocks.t3Journal();
    expect(finalJournal.unexpected).toEqual([]);
    expect(finalJournal.accepted_launches).toHaveLength(2);
    recordEvidence(
      'MCP-Berichte ordnen Nachweise ausschließlich den angegebenen Kriterien zu; fremde UUIDs werden atomar abgelehnt und Ownerbestätigung bleibt erforderlich.',
      `Der initiale T3-Auftrag enthielt alle drei tatsächlichen Kriterien-IDs und die Anweisung zu artifacts[].criterion_ids. Ein Bericht mit einem fremden Kriterium erhielt 409 criterion_not_found und legte weder Report noch Evidence an. Der gültige Bericht ${reportId} verknüpfte genau ${report.evidence_ids.length} Nachweise mit Kriterium A/B; Kriterium C blieb offen. Der identische Report-Replay erzeugte keine Duplikate. Nach der expliziten Bestätigung von A blieb der Nachweis für B über den Ticketversionswechsel erreichbar und B wurde anschließend ebenfalls ausdrücklich bestätigt; die Flow-Projektion behielt genau einen akzeptierten Bericht. Eine wiederholte Agentenzuordnung der bereits bestätigten Evidence war ein No-op; neue Zuordnungen über Evidence-Registrierung und Zuordnung erhielten 409 und änderten weder die gebilligte Evidenzliste noch Owner-Auditfelder. Ein nach einer inhaltlichen Ticketänderung gesendeter Bericht mit der gültigen historischen Kriterien-ID blieb im Flow als abgelehnte Historie sichtbar, beeinflusste aber weder aktuelle Kriterien noch Boardkarte; Lauf ${staleRunId} blieb ohne akzeptierten Report oder Evidence-IDs.`,
      { t3: finalJournal },
    );
  } finally {
    await reporter.close();
  }
});
