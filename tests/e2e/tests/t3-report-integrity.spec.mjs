import { randomUUID } from 'node:crypto';
import { createAgentSimulator, expect, recordEvidence, test } from '../support/fixtures.mjs';

const defaultPolicy = {
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

function reportArguments(run, task, reportId, clientRequestId = randomUUID(), expectedVersion = run.version) {
  return {
    run_id: run.id,
    report_id: reportId,
    attempt_no: run.attempt_no,
    task_revision: task.version,
    outcome: 'reported_success',
    summary: 'Der T3-Agent meldet den eingefrorenen Auftrag abgeschlossen.',
    artifacts: [{ kind: 'note', label: 'Agentmeldung', text: 'Vom Agenten gemeldeter Ergebnisstand; keine unabhängige Codeprüfung.' }],
    client_request_id: clientRequestId,
    expected_version: expectedVersion,
  };
}

test('A12 MCP rejects a wrong attempt and deduplicates the same result report', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const project = await ownerApi.createProject({ name: 'A12 Reportintegrität' });
  const connectionResult = await ownerApi.post('/connections', {
    name: 'A12 Reportintegrität T3',
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(connectionResult.response.status(), JSON.stringify(connectionResult.data)).toBe(201);
  const connection = connectionResult.data;

  const callback = new URL('/auth/t3/callback', baseURL).toString();
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, { redirect_uri: callback }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Der echte Browser-OAuth-Fluss muss T3 autorisieren.');

  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der tatsächliche T3-MCP-Handshake muss erfolgreich sein.');
  const checkRecord = await ownerApi.get(`/connections/${connection.id}/check`);
  expect(checkRecord.response.status(), JSON.stringify(checkRecord.data)).toBe(200);
  expect([checkRecord.data.network, checkRecord.data.authentication, checkRecord.data.mcp_handshake, checkRecord.data.capabilities]).toEqual(['ok', 'ok', 'ok', 'ok']);

  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: project.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);

  const profileResult = await ownerApi.post('/agent-profiles', {
    name: 'A12 Reportintegrität Rolle',
    icon_key: 'bot',
    role: 'Implementierung',
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Melde ausschließlich den Ergebnisstand des Auftrags.',
    enabled: true,
    default_run_completion_policy: defaultPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(profileResult.response.status(), JSON.stringify(profileResult.data)).toBe(201);

  await ownerApi.ensureDefaultBoard(project.id);
  const statuses = await ownerApi.get(`/projects/${project.id}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const readyStatus = statuses.data.items.find((status) => status.category === 'ready');
  expect(readyStatus).toBeTruthy();
  const taskResult = await ownerApi.createTask(project.id, { title: 'A12 Bericht korrekt zuordnen', status_id: readyStatus.id });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const started = await ownerApi.post(`/tasks/${task.id}/runs`, {
    agent_profile_id: profileResult.data.id,
    stage: 'implementation',
    task_revision: task.version,
  }, { version: task.version });
  expect(started.response.status(), JSON.stringify(started.data)).toBe(202);
  const runId = started.data.run_id ?? started.data.resource?.id;
  const run = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.state === 'verifying', 'T3 hat den Lauf beendet; die Agentmeldung muss noch unabhängig zugeordnet werden.');

  const reportToken = await ownerApi.createTechnicalToken({
    label: `A12 report ${randomUUID().slice(0, 8)}`,
    projectIds: [project.id],
    capabilities: ['runs.report'],
  });
  const reporter = await createAgentSimulator(baseURL, reportToken.token);

  try {
    const invalidReportId = randomUUID();
    const wrongAttempt = await reporter.agent.callRaw('runs_report_result', {
      ...reportArguments(run, task, invalidReportId),
      attempt_no: run.attempt_no + 1,
    });
    expect(wrongAttempt.response.status(), JSON.stringify(wrongAttempt.data)).toBe(200);
    expect(wrongAttempt.data?.error).toBeUndefined();
    expect(wrongAttempt.data?.result?.isError, JSON.stringify(wrongAttempt.data?.result)).toBe(true);
    const missingReport = await ownerApi.get(`/runs/${runId}/result-reports/${invalidReportId}`);
    expect(missingReport.response.status(), JSON.stringify(missingReport.data)).toBe(404);
    const afterRejection = (await ownerApi.get(`/runs/${runId}`)).data;
    expect(afterRejection.state).toBe('verifying');
    expect(afterRejection.report_ids).toEqual([]);

    const reportId = randomUUID();
    const firstArguments = reportArguments(run, task, reportId);
    const first = await reporter.agent.call('runs_report_result', firstArguments);
    expect(first.isError, JSON.stringify(first.structuredContent)).toBe(false);
    const afterFirst = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.report_ids?.includes(reportId), 'Der gültige Bericht muss genau diesem Versuch zugeordnet werden.');
    const settled = await readUntil(ownerApi, `/runs/${runId}`, (item) => item.state === 'succeeded', 'Der externe Abschluss und die gültige Agentmeldung werden getrennt abgeglichen.');

    const replay = await reporter.agent.call('runs_report_result', reportArguments(settled, task, reportId, randomUUID(), settled.version));
    expect(replay.isError, JSON.stringify(replay.structuredContent)).toBe(false);
    const storedReport = await ownerApi.get(`/runs/${runId}/result-reports/${reportId}`);
    expect(storedReport.response.status(), JSON.stringify(storedReport.data)).toBe(200);
    expect(storedReport.data.accepted_for_reconciliation).toBe(true);
    expect(storedReport.data.evidence_ids).toHaveLength(1);
    const finalRun = (await ownerApi.get(`/runs/${runId}`)).data;
    expect(finalRun.report_ids).toEqual([reportId]);
    expect(finalRun.evidence_ids).toHaveLength(1);

    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    recordEvidence(
      'A12: Falscher Attempt wird an der MCP-Grenze abgewiesen; eine wiederholte Report-ID legt keinen zweiten Bericht oder Evidenzeintrag an.',
      `Der Agentbericht für Attempt ${run.attempt_no + 1} wurde mit JSON-RPC HTTP 200 und isError:true abgewiesen, ohne Report anzulegen oder Run ${runId} zu verändern. Der gültige Bericht ${reportId} wurde mit einer neuen MCP-Anfrage-ID erneut gesendet; Falkenwarte lieferte denselben Bericht mit genau einem Evidence-Eintrag und report_ids blieb ein Element.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});
