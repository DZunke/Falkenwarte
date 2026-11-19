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

async function configureT3(ownerApi, ownerPage, baseURL, qaMocks, name = 'T3 E2E') {
  const project = await ownerApi.createProject({ name: `${name} Projekt` });
  const created = await ownerApi.post('/connections', {
    name,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;

  await ownerPage.goto('/#/agents');
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
  await ownerPage.getByRole('button', { name: new RegExp(name) }).click();
  const authorizationRequest = ownerPage.waitForRequest((request) => request.url().startsWith(`${qaMocks.t3URL}/authorize?`));
  await Promise.all([
    authorizationRequest,
    ownerPage.getByRole('button', { name: /Bei T3 anmelden/ }).click(),
  ]);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Browser-OAuth muss T3 autorisieren.');

  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: new RegExp(name) }).click();
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect.poll(async () => {
    const check = await ownerApi.get(`/connections/${connection.id}/check`);
    return check.response.status() === 200 ? check.data.status : null;
  }, { timeout: 45_000, message: 'MCP-Handshake und T3-Fähigkeiten müssen erfolgreich sein.' }).toBe('succeeded');
  const readyConnection = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Die T3-Verbindung muss als bereit erscheinen.');

  await ownerPage.getByRole('button', { name: 'Projekte laden' }).click();
  await expect(ownerPage.getByText('QA T3 Project', { exact: true })).toBeVisible();

  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: project.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);

  return { project, connection: readyConnection, binding: binding.data };
}

async function createProfile(ownerApi, ownerPage, baseURL, project, connection, suffix = 'QA') {
  const name = `T3 Rolle ${suffix}`;
  const result = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role: 'Implementierung',
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: 'Berichte Beobachtungen über den Falkenwarte-MCP-Server.',
    enabled: true,
    default_run_completion_policy: defaultPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  const profile = result.data;
  await ownerPage.goto('/#/roles');
  await expect(ownerPage.getByRole('heading', { name: 'Agentrollen' })).toBeVisible();
  await expect(ownerPage.getByText(name, { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('T3-Projektstandard', { exact: true })).toBeVisible();
  return profile;
}

async function createReportingAgent(ownerApi, project, baseURL) {
  const token = await ownerApi.createTechnicalToken({
    label: `T3 Report ${randomUUID().slice(0, 8)}`,
    projectIds: [project.id],
    capabilities: ['runs.report'],
  });
  const simulator = await createAgentSimulator(baseURL, token.token);
  return { token, ...simulator };
}

function reportArguments(run, task, reportId = randomUUID()) {
  return {
    run_id: run.id,
    report_id: reportId,
    attempt_no: run.attempt_no,
    task_revision: task.version,
    outcome: 'reported_success',
    summary: 'Der T3-Agent meldet den eingefrorenen Auftrag abgeschlossen.',
    artifacts: [{ kind: 'note', label: 'Agentmeldung', text: 'Vom Agenten gemeldeter Ergebnisstand; keine unabhängige Codeprüfung.' }],
    client_request_id: randomUUID(),
    expected_version: run.version,
  };
}

async function reportThroughMcp(agent, run, task) {
  const result = await agent.call('runs_report_result', reportArguments(run, task));
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return result.structuredContent;
}

async function requestRun(ownerApi, task, profile, stage = 'implementation') {
  const result = await ownerApi.post(`/tasks/${task.id}/runs`, {
    agent_profile_id: profile.id,
    stage,
    task_revision: task.version,
  }, { version: task.version });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(202);
  return result.data.run_id ?? result.data.resource?.id;
}

test('A09/A10 T3 OAuth and MCP launch replay preserve one immutable dispatch', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'T3 Replay');
  const profile = await createProfile(ownerApi, ownerPage, baseURL, project, connection, 'Replay');
  const taskResult = await ownerApi.createTask(project.id, { title: 'T3 Replay Auftrag' });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const reporter = await createReportingAgent(ownerApi, project, baseURL);

  try {
    await qaMocks.setT3Scenario('lost_reply_after_accept');
    const runId = await requestRun(ownerApi, task, profile);
    const dispatched = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'verifying', 'Der verlorene Launch-Reply muss mit dem gespeicherten Key abgeglichen werden.');
    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    expect(t3.accepted_launches).toHaveLength(1);
    expect(t3.accepted_launches[0].namespace).toBe('oauth-client-A');
    expect(t3.accepted_launches[0].replays).toBeGreaterThanOrEqual(1);
    expect(new Set(t3.journal.filter((entry) => entry.tool === 't3_thread_launch').map((entry) => entry.launch_payload_hash)).size).toBe(1);
    expect(t3.journal.some((entry) => entry.method === 'initialize' && entry.protocol_version === '2025-06-18')).toBe(true);
    expect(dispatched.attempts[0].external_thread_id).toBe(t3.accepted_launches[0].response.threadId);

    await reportThroughMcp(reporter.agent, dispatched, task);
    const completed = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'succeeded', 'T3-Endzustand und Agentmeldung müssen gemeinsam den Phasenabschluss ergeben.');
    expect(completed.report_ids).toHaveLength(1);
    expect(completed.attempts[0].external_thread_id).toBe(dispatched.attempts[0].external_thread_id);
    recordEvidence(
      'A09/A10: Browser-OAuth, MCP-Protokoll, T3-Projektauflösung und ein Launch mit verlorener Antwort.',
      `OAuth-Epoch ${connection.auth_epoch}; der echte MCP-Adapter handelte 2025-06-18 aus, T3 lieferte denselben gespeicherten Thread für den Key-Replay, Payloadhash blieb stabil, Agentmeldung und externer Endzustand führten Run ${runId} zu succeeded.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});

test('A11/A30 early agent report and new OAuth namespace do not create a second launch', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'T3 Übergabe');
  const profile = await createProfile(ownerApi, ownerPage, baseURL, project, connection, 'Übergabe');
  const taskResult = await ownerApi.createTask(project.id, { title: 'Frühe Agentmeldung' });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const reporter = await createReportingAgent(ownerApi, project, baseURL);
  let runId;

  try {
    await qaMocks.setT3Scenario('delayed_launch_reply');
    runId = await requestRun(ownerApi, task, profile);
    await expect.poll(async () => {
      const journal = await qaMocks.t3Journal();
      return journal.journal.some((entry) => entry.tool === 't3_thread_launch' && entry.outcome === 'success');
    }, { timeout: 30_000, message: 'T3 muss den Launch angenommen und die Antwort an der Testbarriere angehalten haben.' }).toBe(true);
    const dispatching = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'dispatching');
    expect(dispatching.attempts[0].external_thread_id).toBeNull();
    await reportThroughMcp(reporter.agent, dispatching, task);
    const reportedEarly = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.report_ids?.length === 1, 'Der MCP-Agentbericht muss vor der Launch-Antwort gespeichert werden.');
    expect(reportedEarly.state).toBe('result_reported');

    await qaMocks.setT3OAuthToken('qa-t3-token-B');
    const callback = new URL('/auth/t3/callback', baseURL).toString();
    const freshAuth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, { redirect_uri: callback }, { version: connection.version });
    expect(freshAuth.response.status(), JSON.stringify(freshAuth.data)).toBe(200);
    await ownerPage.goto(freshAuth.data.authorization_url);
    const reauthorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_epoch === 2 && item.auth_status === 'valid', 'Die frische OAuth-Zustimmung muss eine neue Auth-Epoch speichern.');
    expect(reauthorized.auth_epoch).toBe(2);

    await qaMocks.releaseT3();
    const completed = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'succeeded', 'Die gespeicherte alte T3-Referenz muss nach der neuen Autorisierung beobachtbar bleiben.');
    expect(completed.report_ids).toHaveLength(1);
    expect(completed.attempts[0].external_thread_id).toBeTruthy();
    const t3 = await qaMocks.t3Journal();
    expect(t3.accepted_launches).toHaveLength(1);
    expect(t3.accepted_launches[0].namespace).toBe('oauth-client-A');
    expect(t3.journal.some((entry) => entry.tool === 't3_thread_read' && entry.auth_namespace === 'oauth-client-B')).toBe(true);
    expect(t3.unexpected).toEqual([]);
    recordEvidence(
      'A11/A30: Eine echte Agentmeldung trifft vor der Launch-Antwort ein; neue OAuth-Session darf keinen zweiten T3-Start erzeugen.',
      `Run ${runId} nahm den MCP-Bericht ohne externe Thread-ID an. Nach OAuth-Epoch 2 beobachtete Falkenwarte denselben Thread mit Token-Namespace B; T3 hatte genau einen angenommenen Launch in Namespace A und der Run endete succeeded.`,
      { t3 },
    );
  } finally {
    await qaMocks.releaseT3();
    await reporter.close();
  }
});

test('M4 workflow phase waits for an owner decision and does not close the task', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'Workflow T3');
  const profile = await createProfile(ownerApi, ownerPage, baseURL, project, connection, 'Workflow');
  const workflowResult = await ownerApi.post('/workflows', {
    project_id: project.id,
    name: 'QA Phase mit Freigabe',
    preset_id: 'manual',
    stages: [{
      id: 'implementation',
      kind: 'implementation',
      name: 'Bearbeitung',
      agent_profile_id: profile.id,
      entry_conditions: [],
      run_completion_policy: { ...defaultPolicy, require_human_phase_decision: true },
    }],
    transitions: [],
    limits: { max_repair_rounds: 1, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(workflowResult.response.status(), JSON.stringify(workflowResult.data)).toBe(201);
  const workflow = workflowResult.data.workflow ?? workflowResult.data;
  const taskResult = await ownerApi.createTask(project.id, { title: 'Workflow Phase prüfen' });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const start = await ownerApi.post(`/tasks/${task.id}/workflow-instances`, {
    workflow_id: workflow.id,
    definition_version: workflow.definition_version,
    task_revision: task.version,
  }, { version: task.version });
  expect(start.response.status(), JSON.stringify(start.data)).toBe(202);
  const instanceId = start.data.resource?.id ?? start.data.instance_id;
  const started = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (instance) => instance.run_ids.length === 1, 'Der Workflow muss die eingefrorene erste Phase als Run anlegen.');
  const runId = started.run_ids[0];
  const reporter = await createReportingAgent(ownerApi, project, baseURL);

  try {
    const runBeforeReport = await readUntil(ownerApi, `/runs/${runId}`, (run) => ['running', 'verifying'].includes(run.state));
    await reportThroughMcp(reporter.agent, runBeforeReport, task);
    const awaitingApproval = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'verifying' && run.status_reason?.includes('Eigentümerentscheidung'));
    const approvalRequest = await ownerApi.post(`/runs/${runId}/approvals`, {
      kind: 'completion',
      result_digest: awaitingApproval.result_digest,
      reason: 'Gemeldeten Phasenabschluss prüfen.',
    }, { version: awaitingApproval.version });
    expect(approvalRequest.response.status(), JSON.stringify(approvalRequest.data)).toBe(201);
    const approval = approvalRequest.data;
    const decision = await ownerApi.post(`/approvals/${approval.id}/decision`, {
      decision: 'approved',
      result_digest: awaitingApproval.result_digest,
      reason: 'Gemeldeter Ergebnisstand für diese Phase angenommen.',
    }, { version: approval.version });
    expect(decision.response.status(), JSON.stringify(decision.data)).toBe(200);

    const succeeded = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'succeeded');
    const finishedWorkflow = await readUntil(ownerApi, `/workflow-instances/${instanceId}`, (instance) => instance.state === 'succeeded');
    const unchangedTask = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(succeeded.result_digest).toBe(awaitingApproval.result_digest);
    expect(finishedWorkflow.run_ids).toEqual([runId]);
    expect(unchangedTask.status_category).toBe('ready');
    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    recordEvidence(
      'M4/A12: Phasenabschluss verlangt die passende Agentmeldung und explizite Ownerentscheidung; der Ticketabschluss bleibt getrennt.',
      `Workflowversion ${workflow.definition_version} lief über T3-MCP. Run ${runId} wartete mit unverändertem Ergebnisdigest auf die Ownerfreigabe, wurde danach succeeded und schloss Workflow ${instanceId}; Aufgabe ${task.id} blieb im Status ready.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});

test('A09 unknown T3 capability and run state remain visible failures', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'T3 Fehler');
  const profile = await createProfile(ownerApi, ownerPage, baseURL, project, connection, 'Fehler');
  const taskResult = await ownerApi.createTask(project.id, { title: 'Unbekannten T3 Zustand behandeln' });
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const reporter = await createReportingAgent(ownerApi, project, baseURL);

  try {
    await qaMocks.setT3Scenario('unknown_capability');
    await ownerPage.goto('/#/agents');
    await ownerPage.getByRole('button', { name: new RegExp('T3 Fehler') }).click();
    await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
    const failedCheck = await readUntil(ownerApi, `/connections/${connection.id}/check`, (check) => check.status === 'failed');
    expect(failedCheck.capabilities).toBe('not_checked');
    expect((await ownerApi.get(`/connections/${connection.id}`)).data.health).toBe('unreachable');

    await qaMocks.setT3Scenario('default');
    const refreshedConnection = (await ownerApi.get(`/connections/${connection.id}`)).data;
    await ownerApi.post(`/connections/${connection.id}/check`, { refresh_capabilities: true }, { version: refreshedConnection.version });
    await expect.poll(async () => (await ownerApi.get(`/connections/${connection.id}/check`)).data?.status, { timeout: 45_000 }).toBe('succeeded');

    await qaMocks.setT3Scenario('unknown_run_state');
    const runId = await requestRun(ownerApi, task, profile);
    const unknown = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'reconciling' && run.status_reason?.includes('unbekannten Zustand'));
    expect(unknown.attempts[0].remote_status).toBe('future_unknown_state');
    await qaMocks.setT3Scenario('default');
    await ownerApi.post(`/runs/${runId}/reconcile`, { reason: 'T3-Zustand erneut geprüft.' }, { version: unknown.version });
    const current = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'verifying');
    await reportThroughMcp(reporter.agent, current, task);
    await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'succeeded');
    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    expect(t3.journal.some((entry) => entry.outcome === 'tool_error')).toBe(true);
    recordEvidence(
      'A09/A30: T3 `isError:true` und unbekannter nativer Run-Zustand werden nicht als Erfolg gewertet.',
      `Fähigkeitsprüfung blieb failed/unreachable; unbekannter Zustand ${unknown.attempts[0].remote_status} führte in reconciling. Erst nach erneuter T3-Beobachtung und Agentmeldung wurde Run ${runId} succeeded.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});
