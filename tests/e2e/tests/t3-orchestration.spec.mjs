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

async function dashboardAttentionCount(ownerApi) {
  const dashboard = await ownerApi.get('/dashboard');
  expect(dashboard.response.status(), JSON.stringify(dashboard.data)).toBe(200);
  const metric = dashboard.data.metrics.find((item) => item.key === 'human_attention');
  expect(metric, 'The dashboard exposes its human-attention KPI.').toBeTruthy();
  return metric.value;
}

async function expectDashboardAttention(ownerApi, ownerPage, expected) {
  expect(await dashboardAttentionCount(ownerApi)).toBe(expected);
  await ownerPage.goto('/#/dashboard');
  const kpi = ownerPage.locator('dl[aria-label="Arbeitsstand"]');
  const attentionValue = kpi.locator('dd').nth(1);
  await expect(attentionValue).toHaveText(String(expected));
}

async function configureT3(ownerApi, ownerPage, baseURL, qaMocks, name = 'T3 E2E') {
  const uniqueName = `${name} ${randomUUID().slice(0, 6)}`;
  const project = await ownerApi.createProject({ name: `${uniqueName} Projekt` });
  const created = await ownerApi.post('/connections', {
    name: uniqueName,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const connection = created.data;

  await ownerPage.goto('/#/agents');
  await expect(ownerPage.getByRole('heading', { name: 'T3-Verbindung' })).toBeVisible();
  await ownerPage.locator('main').getByRole('button', { name: new RegExp(uniqueName) }).click();
  const authorizationRequest = ownerPage.waitForRequest((request) => request.url().startsWith(`${qaMocks.t3URL}/authorize?`));
  await Promise.all([
    authorizationRequest,
    ownerPage.getByRole('button', { name: /Bei T3 anmelden/ }).click(),
  ]);
  await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Browser-OAuth muss T3 autorisieren.');

  await ownerPage.reload();
  await ownerPage.locator('main').getByRole('button', { name: new RegExp(uniqueName) }).click();
  await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect.poll(async () => {
    const check = await ownerApi.get(`/connections/${connection.id}/check`);
    return check.response.status() === 200
      ? [check.data.network, check.data.authentication, check.data.mcp_handshake, check.data.capabilities].join(':')
      : null;
  }, { timeout: 45_000, message: 'MCP-Handshake und T3-Fähigkeiten müssen erfolgreich sein.' }).toBe('ok:ok:ok:ok');
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

async function createProfile(ownerApi, ownerPage, baseURL, project, connection, suffix = 'QA', executionTarget = { mode: 't3_project_default' }, completionPolicy = defaultPolicy) {
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
    default_run_completion_policy: completionPolicy,
    execution_target: executionTarget,
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  const profile = result.data;
  await ownerPage.goto('/#/roles');
  await expect(ownerPage.getByRole('heading', { name: 'Agentrollen' })).toBeVisible();
  await expect(ownerPage.getByText(name, { exact: true })).toBeVisible();
  const profileCard = ownerPage.getByRole('article').filter({ hasText: name });
  await expect(profileCard.getByText(executionTarget.mode === 't3_project_default' ? 'T3-Projektstandard' : `Referenzthread ${executionTarget.reference_thread_id}`, { exact: true })).toBeVisible();
  return profile;
}

async function configureAmbiguousRouting(ownerApi, project, profile) {
  const topic = await ownerApi.createLabel(project.id, {
    key: `topic.t3qa-${randomUUID().slice(0, 6)}`,
    name: 'T3-Abnahme',
    color: '#7C97B6',
    kind: 'topic',
  });
  const workflowLabels = [
    await ownerApi.createLabel(project.id, { key: `workflow.t3qa-a-${randomUUID().slice(0, 6)}`, name: 'T3-Bearbeitung', color: '#C89562', kind: 'workflow' }),
    await ownerApi.createLabel(project.id, { key: `workflow.t3qa-b-${randomUUID().slice(0, 6)}`, name: 'T3-Dokumentation', color: '#8FA78E', kind: 'workflow' }),
  ];
  const workflows = [];
  for (const name of ['T3-Bearbeitungsablauf', 'T3-Dokumentationsablauf']) {
    const created = await ownerApi.post('/workflows', {
      project_id: project.id,
      name,
      preset_id: 'manual',
      stages: [{
        id: 'work',
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
    expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
    workflows.push(created.data.workflow ?? created.data);
  }
  const routing = await ownerApi.get(`/projects/${project.id}/routing-rules`);
  expect(routing.response.status(), JSON.stringify(routing.data)).toBe(200);
  const savedRouting = await ownerApi.put(`/projects/${project.id}/routing-rules`, {
    rules: workflowLabels.map((label, index) => ({
      workflow_label_id: label.id,
      workflow_id: workflows[index].id,
      workflow_definition_version: workflows[index].definition_version ?? 1,
    })),
    on_unresolved: 'needs_human_decision',
  }, { version: routing.data.version });
  expect(savedRouting.response.status(), JSON.stringify(savedRouting.data)).toBe(200);

  const secret = await ownerApi.post('/secret-references', { label: 'T3 A27 Decisions', value: 'qa-decisions-token' });
  expect(secret.response.status(), JSON.stringify(secret.data)).toBe(201);
  const currentConfiguration = await ownerApi.get('/decision-configuration');
  expect(currentConfiguration.response.status(), JSON.stringify(currentConfiguration.data)).toBe(200);
  const configuration = await ownerApi.put('/decision-configuration', {
    secret_reference_id: secret.data.id,
    timeout_ms: 5000,
    max_attempts: 2,
    max_requests_per_hour: 100,
  }, { version: currentConfiguration.data.version });
  expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);
  const currentPolicy = await ownerApi.get(`/projects/${project.id}/decision-policy`);
  expect(currentPolicy.response.status(), JSON.stringify(currentPolicy.data)).toBe(200);
  const policy = await ownerApi.put(`/projects/${project.id}/decision-policy`, {
    enabled_for_manual: false,
    requirements: [],
    minimum_choice_probability: 0.65,
    minimum_choice_confidence: 0.65,
    minimum_choice_margin: 0.15,
    positive_tag_threshold: 0.7,
    missing_field_threshold: 0.7,
    max_clarification_rounds: 3,
  }, { version: currentPolicy.data.version });
  expect(policy.response.status(), JSON.stringify(policy.data)).toBe(200);
  return { topic, workflowLabels, workflows };
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

async function createReadyTask(ownerApi, projectId, title) {
  await ownerApi.ensureDefaultBoard(projectId);
  const statuses = await ownerApi.get(`/projects/${projectId}/statuses`);
  expect(statuses.response.status(), JSON.stringify(statuses.data)).toBe(200);
  const ready = statuses.data.items.find((status) => status.category === 'ready');
  expect(ready, 'A task intended for T3 must start in a runnable ready status.').toBeTruthy();
  return ownerApi.createTask(projectId, { title, status_id: ready.id });
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

async function reportThroughMcp(agent, run, task, ownerApi = null) {
  const args = reportArguments(run, task);
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (ownerApi) {
      const latest = await ownerApi.get(`/runs/${run.id}`);
      expect(latest.response.status(), JSON.stringify(latest.data)).toBe(200);
      args.expected_version = latest.data.version;
    }
    result = await agent.call('runs_report_result', args);
    if (!result.isError || result.structuredContent?.status !== 412 || !ownerApi) break;
  }
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
  const taskResult = await createReadyTask(ownerApi, project.id, 'T3 Replay Auftrag');
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

    await reportThroughMcp(reporter.agent, dispatched, task, ownerApi);
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
  const taskResult = await createReadyTask(ownerApi, project.id, 'Frühe Agentmeldung');
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
    await reportThroughMcp(reporter.agent, dispatching, task, ownerApi);
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
  const taskResult = await createReadyTask(ownerApi, project.id, 'Workflow Phase prüfen');
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
    await reportThroughMcp(reporter.agent, runBeforeReport, task, ownerApi);
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

test('A27 simultaneous routing and approval reasons resolve independently across a stale approval', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(240_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'A27 Aufmerksamkeit');
  const profile = await createProfile(
    ownerApi,
    ownerPage,
    baseURL,
    project,
    connection,
    'A27 Freigabe',
    { mode: 't3_project_default' },
    { ...defaultPolicy, require_human_phase_decision: true },
  );
  const { topic, workflowLabels } = await configureAmbiguousRouting(ownerApi, project, profile);
  const taskResult = await createReadyTask(ownerApi, project.id, 'Mehrere offene Entscheidungen');
  let task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const runId = await requestRun(ownerApi, task, profile);
  const reporter = await createReportingAgent(ownerApi, project, baseURL);

  try {
    const beforeReport = await readUntil(ownerApi, `/runs/${runId}`, (run) => ['running', 'verifying'].includes(run.state));
    await reportThroughMcp(reporter.agent, beforeReport, task, ownerApi);
    const awaitingApproval = await readUntil(ownerApi, `/runs/${runId}`, (run) => ['result_reported', 'verifying', 'succeeded'].includes(run.state) && run.result_digest !== null);
    const oldApprovalResult = await ownerApi.post(`/runs/${runId}/approvals`, {
      kind: 'completion',
      result_digest: awaitingApproval.result_digest,
      reason: 'Die erste gemeldete Revision vor der erneuten Einordnung prüfen.',
    }, { version: awaitingApproval.version });
    expect(oldApprovalResult.response.status(), JSON.stringify(oldApprovalResult.data)).toBe(201);
    const oldApproval = oldApprovalResult.data;
    task = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(task.human_attention.reasons).toContain('approval_pending');
    expect(await dashboardAttentionCount(ownerApi)).toBe(1);

    await qaMocks.setDecisionsScenario('decisions_ambiguous');
    const reclassified = await ownerApi.post(`/tasks/${task.id}/intake/reclassify`, {
      reason: 'Prüfen, ob die erneute Mehrdeutigkeit neben der bestehenden Freigabe sichtbar bleibt.',
    }, { version: task.version });
    expect([200, 202], JSON.stringify(reclassified.data)).toContain(reclassified.response.status());
    task = await readUntil(ownerApi, `/tasks/${task.id}`, (current) => current.human_attention.reasons?.includes('routing_ambiguous'));
    expect(task.human_attention.reasons).toContain('approval_pending');
    expect(task.human_attention.reasons).toContain('routing_ambiguous');
    await expectDashboardAttention(ownerApi, ownerPage, 1);

    const attentionLabels = await ownerApi.get(`/projects/${project.id}/labels`);
    expect(attentionLabels.response.status()).toBe(200);
    const approvalLabel = attentionLabels.data.items.find((label) => label.key === 'attention:approval_pending');
    const routingLabel = attentionLabels.data.items.find((label) => label.key === 'attention:routing_ambiguous');
    expect(approvalLabel?.system_managed).toBe(true);
    expect(routingLabel?.system_managed).toBe(true);
    expect(task.label_ids).toContain(approvalLabel.id);
    expect(task.label_ids).toContain(routingLabel.id);

    const omittedRoutingLabel = await ownerApi.put(`/tasks/${task.id}/labels`, {
      label_ids: task.label_ids.filter((id) => id !== routingLabel.id),
      primary_topic_label_id: task.primary_topic_label_id,
      reason: 'Nur die abgeleitete Routinganzeige aus dem Schreibvorschlag weglassen.',
      routing_application: 'next_instance',
    }, { version: task.version });
    expect(omittedRoutingLabel.response.status(), JSON.stringify(omittedRoutingLabel.data)).toBe(200);
    expect(omittedRoutingLabel.data.human_attention.reasons).toContain('approval_pending');
    expect(omittedRoutingLabel.data.human_attention.reasons).toContain('routing_ambiguous');
    expect(omittedRoutingLabel.data.label_ids).toContain(approvalLabel.id);
    expect(omittedRoutingLabel.data.label_ids).toContain(routingLabel.id);

    const routeDecision = await ownerApi.post(`/tasks/${task.id}/intake/decision`, {
      label_ids: [topic.id],
      primary_topic_label_id: topic.id,
      workflow_label_id: workflowLabels[0].id,
      reason: 'Die Aufgabe gehört zum T3-Bearbeitungsablauf.',
    }, { version: omittedRoutingLabel.data.version });
    expect(routeDecision.response.status(), JSON.stringify(routeDecision.data)).toBe(200);
    expect(routeDecision.data.human_attention.reasons).toEqual(['approval_pending']);
    task = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(task.label_ids).toContain(approvalLabel.id);
    expect(task.label_ids).not.toContain(routingLabel.id);
    expect(await dashboardAttentionCount(ownerApi)).toBe(1);

    const staleApproval = await ownerApi.post(`/approvals/${oldApproval.id}/decision`, {
      decision: 'approved',
      result_digest: awaitingApproval.result_digest,
      reason: 'Die veraltete Revision darf nicht freigegeben werden.',
    }, { version: oldApproval.version });
    expect(staleApproval.response.status(), JSON.stringify(staleApproval.data)).toBe(200);
    expect(staleApproval.data.status).toBe('invalidated');
    task = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(task.human_attention.reasons).toEqual([]);
    expect(await dashboardAttentionCount(ownerApi)).toBe(0);

    const oldRun = (await ownerApi.get(`/runs/${runId}`)).data;
    const cancelled = await ownerApi.post(`/runs/${runId}/cancel`, {
      reason: 'Veralteten T3-Lauf nach der Revisionsänderung beenden.',
    }, { version: oldRun.version });
    expect(cancelled.response.status(), JSON.stringify(cancelled.data)).toBe(202);
    await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'cancelled');

    task = (await ownerApi.get(`/tasks/${task.id}`)).data;
    const freshRunId = await requestRun(ownerApi, task, profile, 'work');
    const freshRun = await readUntil(ownerApi, `/runs/${freshRunId}`, (run) => ['running', 'verifying'].includes(run.state));
    await reportThroughMcp(reporter.agent, freshRun, task, ownerApi);
    const freshResult = await readUntil(ownerApi, `/runs/${freshRunId}`, (run) => ['result_reported', 'verifying', 'succeeded'].includes(run.state) && run.result_digest !== null);
    const freshApprovalResult = await ownerApi.post(`/runs/${freshRunId}/approvals`, {
      kind: 'completion',
      result_digest: freshResult.result_digest,
      reason: 'Die aktuelle Revision nach der Intakeentscheidung prüfen.',
    }, { version: freshResult.version });
    expect(freshApprovalResult.response.status(), JSON.stringify(freshApprovalResult.data)).toBe(201);
    const freshApproval = freshApprovalResult.data;
    expect(await dashboardAttentionCount(ownerApi)).toBe(1);
    const decision = await ownerApi.post(`/approvals/${freshApproval.id}/decision`, {
      decision: 'approved',
      result_digest: freshResult.result_digest,
      reason: 'Die aktuelle T3-Meldung für diese Revision ist freigegeben.',
    }, { version: freshApproval.version });
    expect(decision.response.status(), JSON.stringify(decision.data)).toBe(200);
    expect(decision.data.status).toBe('approved');
    await readUntil(ownerApi, `/runs/${freshRunId}`, (run) => run.state === 'succeeded');
    task = (await ownerApi.get(`/tasks/${task.id}`)).data;
    expect(task.human_attention).toEqual({ required: false, reasons: [] });
    expect(task.label_ids).not.toContain(approvalLabel.id);
    expect(task.label_ids).not.toContain(routingLabel.id);
    await expectDashboardAttention(ownerApi, ownerPage, 0);

    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    recordEvidence(
      'A27: Routingentscheidung und Laufzeitfreigabe bleiben als getrennte Gründe sichtbar; die alte Freigabe ist revisionsgebunden und die neue schließt nur den aktuellen Grund.',
      `Nach der zweiten Intakebewertung bestanden approval_pending und routing_ambiguous gleichzeitig samt beider Systemlabels. Das Auslassen des Routinglabels änderte keinen Grund. Die Ownerentscheidung entfernte routing_ambiguous; die erste Approval für Ergebnisdigest ${awaitingApproval.result_digest} wurde wegen Revisionsabweichung invalidiert. Der frische Run ${freshRunId} mit Ergebnisdigest ${freshResult.result_digest} und passender Revision wurde anschließend ausdrücklich freigegeben und löste approval_pending auf.`,
      { t3 },
    );
  } finally {
    await reporter.close();
  }
});

test('A29 reference threads supply only live T3 routing and block removed or foreign targets', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(240_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'A29 Referenz');
  const matchingReference = await qaMocks.createExternalT3Activity({ externalProjectId: 'qa-t3-project-1' });
  const validProfile = await createProfile(
    ownerApi,
    ownerPage,
    baseURL,
    project,
    connection,
    'A29 gültig',
    { mode: 't3_reference_thread', reference_thread_id: matchingReference.thread_id },
  );
  const validTaskResult = await createReadyTask(ownerApi, project.id, 'T3-Referenzzuordnung übernehmen');
  const validTask = (await ownerApi.get(`/tasks/${validTaskResult.id}`)).data;
  const validReporter = await createReportingAgent(ownerApi, project, baseURL);

  try {
    const validRunId = await requestRun(ownerApi, validTask, validProfile);
    const validRun = await readUntil(ownerApi, `/runs/${validRunId}`, (run) => ['running', 'verifying'].includes(run.state));
    const journalBeforeReport = await qaMocks.t3Journal();
    expect(journalBeforeReport.accepted_launches).toHaveLength(1);
    expect(journalBeforeReport.accepted_launches[0].payload.modelSelection).toEqual({
      instanceId: 'qa-inherited-provider',
      model: 'qa-inherited-model',
    });
    await reportThroughMcp(validReporter.agent, validRun, validTask, ownerApi);
    await readUntil(ownerApi, `/runs/${validRunId}`, (run) => run.state === 'succeeded');

    const foreignProject = await ownerApi.createProject({ name: 'A29 Fremdes T3-Ziel' });
    const foreignBinding = await ownerApi.put(`/projects/${foreignProject.id}/binding`, {
      connection_id: connection.id,
      external_project_id: 'qa-t3-project-1',
      max_active_runs: 1,
    }, { version: foreignProject.version });
    expect(foreignBinding.response.status(), JSON.stringify(foreignBinding.data)).toBe(200);
    const foreignReference = await qaMocks.createExternalT3Activity({ externalProjectId: 'qa-t3-project-foreign' });
    const foreignProfile = await createProfile(
      ownerApi,
      ownerPage,
      baseURL,
      foreignProject,
      connection,
      'A29 fremdes Ziel',
      { mode: 't3_reference_thread', reference_thread_id: foreignReference.thread_id },
    );
    const foreignTaskResult = await createReadyTask(ownerApi, foreignProject.id, 'Fremden T3-Thread blockieren');
    const foreignTask = (await ownerApi.get(`/tasks/${foreignTaskResult.id}`)).data;
    const journalBeforeForeign = await qaMocks.t3Journal();
    const foreignRunId = await requestRun(ownerApi, foreignTask, foreignProfile);
    const foreignRun = await readUntil(ownerApi, `/runs/${foreignRunId}`, (run) => run.state === 'auth_blocked');
    expect(foreignRun.status_reason).toContain('gehört nicht zum gebundenen T3-Projekt');
    expect(foreignRun.snapshot.execution_target.reference_thread_id).toBe(foreignReference.thread_id);
    expect((await ownerApi.get(`/tasks/${foreignTask.id}`)).data.human_attention.reasons).toContain('reference_target_invalid');

    const removedProject = await ownerApi.createProject({ name: 'A29 Entfernte T3-Auswahl' });
    const removedBinding = await ownerApi.put(`/projects/${removedProject.id}/binding`, {
      connection_id: connection.id,
      external_project_id: 'qa-t3-project-1',
      max_active_runs: 1,
    }, { version: removedProject.version });
    expect(removedBinding.response.status(), JSON.stringify(removedBinding.data)).toBe(200);
    const removedReference = await qaMocks.createExternalT3Activity({ externalProjectId: 'qa-t3-project-1' });
    const removedProfile = await createProfile(
      ownerApi,
      ownerPage,
      baseURL,
      removedProject,
      connection,
      'A29 entfernte Auswahl',
      { mode: 't3_reference_thread', reference_thread_id: removedReference.thread_id },
    );
    const removedTaskResult = await createReadyTask(ownerApi, removedProject.id, 'Entfernte T3-Auswahl blockieren');
    const removedTask = (await ownerApi.get(`/tasks/${removedTaskResult.id}`)).data;
    await qaMocks.setT3Scenario('reference_missing_model');
    const journalBeforeRemoved = await qaMocks.t3Journal();
    const removedRunId = await requestRun(ownerApi, removedTask, removedProfile);
    const removedRun = await readUntil(ownerApi, `/runs/${removedRunId}`, (run) => run.state === 'auth_blocked');
    expect(removedRun.status_reason).toContain('keine belegten Provider- und Modellreferenzen');
    expect((await ownerApi.get(`/tasks/${removedTask.id}`)).data.human_attention.reasons).toContain('reference_target_invalid');

    const t3 = await qaMocks.t3Journal();
    expect(t3.unexpected).toEqual([]);
    expect(t3.accepted_launches).toHaveLength(1);
    expect(t3.accepted_launches[0].payload.modelSelection).toEqual({ instanceId: 'qa-inherited-provider', model: 'qa-inherited-model' });
    expect(t3.journal.filter((entry) => entry.tool === 't3_thread_launch')).toHaveLength(1);
    expect(t3.journal.some((entry) => entry.tool === 't3_thread_read' && entry.outcome === 'success')).toBe(true);
    expect(journalBeforeForeign.accepted_launches).toHaveLength(1);
    expect(journalBeforeRemoved.accepted_launches).toHaveLength(1);
    recordEvidence(
      'A29: Die Rolle übernimmt ausschließlich aktuell lesbare T3-Routingfelder. Fremde und entfernte Ausführungsziele blockieren mit sichtbarem Owner-Handlungsbedarf und erzeugen keinen Ersatzlaunch.',
      `Gültiger Referenzthread ${matchingReference.thread_id} lieferte provider/model und der neue Launch enthielt genau diese modelSelection. Ein Referenzthread aus ${foreignReference.external_project_id} sowie ein Thread ohne Routingfelder endeten jeweils auth_blocked mit reference_target_invalid; die T3-Annahmezahl blieb bei einem Launch.`,
      { t3 },
    );
  } finally {
    await validReporter.close();
  }
});

test('A09 unknown T3 capability and run state remain visible failures', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.setTimeout(150_000);
  const { project, connection } = await configureT3(ownerApi, ownerPage, baseURL, qaMocks, 'T3 Fehler');
  const profile = await createProfile(ownerApi, ownerPage, baseURL, project, connection, 'Fehler');
  const taskResult = await createReadyTask(ownerApi, project.id, 'Unbekannten T3 Zustand behandeln');
  const task = (await ownerApi.get(`/tasks/${taskResult.id}`)).data;
  const reporter = await createReportingAgent(ownerApi, project, baseURL);

  try {
    await qaMocks.setT3Scenario('unknown_capability');
    await ownerPage.goto('/#/agents');
    await ownerPage.locator('main').getByRole('button', { name: new RegExp('T3 Fehler') }).click();
    await ownerPage.getByRole('button', { name: 'Verbindung testen' }).click();
    const failedCheck = await readUntil(ownerApi, `/connections/${connection.id}/check`, (check) => check.mcp_handshake === 'failed');
    expect(failedCheck.capabilities).toBe('not_checked');
    expect((await ownerApi.get(`/connections/${connection.id}`)).data.health).toBe('unreachable');

    await qaMocks.setT3Scenario('default');
    const refreshedConnection = (await ownerApi.get(`/connections/${connection.id}`)).data;
    await ownerApi.post(`/connections/${connection.id}/check`, { refresh_capabilities: true }, { version: refreshedConnection.version });
    await expect.poll(async () => {
      const check = (await ownerApi.get(`/connections/${connection.id}/check`)).data;
      return [check?.network, check?.authentication, check?.mcp_handshake, check?.capabilities].join(':');
    }, { timeout: 45_000 }).toBe('ok:ok:ok:ok');

    await qaMocks.setT3Scenario('unknown_run_state');
    const runId = await requestRun(ownerApi, task, profile);
    const unknown = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'reconciling' && run.status_reason?.includes('unbekannten Zustand'));
    expect(unknown.attempts[0].remote_status).toBe('future_unknown_state');
    await qaMocks.setT3Scenario('default');
    await ownerApi.post(`/runs/${runId}/reconcile`, { reason: 'T3-Zustand erneut geprüft.' }, { version: unknown.version });
    const current = await readUntil(ownerApi, `/runs/${runId}`, (run) => run.state === 'verifying');
    await reportThroughMcp(reporter.agent, current, task, ownerApi);
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
