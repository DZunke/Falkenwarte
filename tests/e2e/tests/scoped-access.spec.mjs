import { randomUUID } from 'node:crypto';
import { request as playwrightRequest } from '@playwright/test';
import { test, expect, createAgentSimulator, recordEvidence } from '../support/fixtures.mjs';

const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';

async function configureMissingInformationIntake(ownerApi, project) {
  const suffix = randomUUID().slice(0, 6);
  const topic = await ownerApi.createLabel(project.id, {
    key: `topic.scope-${suffix}`,
    name: 'Projektgrenzen',
    color: '#7C97B6',
    kind: 'topic',
    description: 'QA-Taxonomie für den Zugriffstest.',
  });
  const workflowLabel = await ownerApi.createLabel(project.id, {
    key: `workflow.scope-${suffix}`,
    name: 'Abgrenzung prüfen',
    color: '#C89562',
    kind: 'workflow',
    description: 'Kontrollierter QA-Routingpfad.',
  });
  const workflowResult = await ownerApi.post('/workflows', {
    project_id: project.id,
    name: 'Projektgrenzen QA',
    preset_id: 'manual',
    stages: [{
      id: 'work',
      kind: 'implementation',
      name: 'Bearbeitung',
      agent_profile_id: null,
      entry_conditions: [],
      run_completion_policy: {
        require_external_settled: true,
        required_evidence_kinds: [],
        required_criterion_ids: [],
        require_human_phase_decision: false,
        require_human_confirmed_evidence: false,
      },
    }],
    transitions: [],
    limits: { max_repair_rounds: 1, max_depth: 1, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(workflowResult.response.status(), JSON.stringify(workflowResult.data)).toBe(201);
  const workflow = workflowResult.data.workflow ?? workflowResult.data;

  const routingState = await ownerApi.get(`/projects/${project.id}/routing-rules`);
  expect(routingState.response.status(), JSON.stringify(routingState.data)).toBe(200);
  const routing = await ownerApi.put(`/projects/${project.id}/routing-rules`, {
    rules: [{
      workflow_label_id: workflowLabel.id,
      workflow_id: workflow.id,
      workflow_definition_version: workflow.definition_version ?? 1,
    }],
    on_unresolved: 'needs_human_decision',
  }, { version: routingState.data.version });
  expect(routing.response.status(), JSON.stringify(routing.data)).toBe(200);

  const policyState = await ownerApi.get(`/projects/${project.id}/decision-policy`);
  expect(policyState.response.status(), JSON.stringify(policyState.data)).toBe(200);
  const policy = await ownerApi.put(`/projects/${project.id}/decision-policy`, {
    enabled_for_manual: false,
    requirements: [{
      field_key: 'expected_behavior',
      description: 'das erwartete Verhalten',
      question_template: 'Welches Verhalten wird stattdessen erwartet?',
      workflow_label_ids: [],
      required: true,
    }],
    minimum_choice_probability: 0.65,
    minimum_choice_confidence: 0.65,
    minimum_choice_margin: 0.15,
    positive_tag_threshold: 0.7,
    missing_field_threshold: 0.7,
    max_clarification_rounds: 3,
  }, { version: policyState.data.version });
  expect(policy.response.status(), JSON.stringify(policy.data)).toBe(200);

  const secret = await ownerApi.post('/secret-references', { label: 'QA Decisions A02', value: 'qa-decisions-token' });
  expect(secret.response.status(), JSON.stringify(secret.data)).toBe(201);
  const configurationState = await ownerApi.get('/decision-configuration');
  expect(configurationState.response.status(), JSON.stringify(configurationState.data)).toBe(200);
  const configuration = await ownerApi.put('/decision-configuration', {
    secret_reference_id: secret.data.id,
    timeout_ms: 5000,
    max_attempts: 2,
    max_requests_per_hour: 100,
  }, { version: configurationState.data.version });
  expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);

  return topic;
}

async function createAgent(ownerApi, baseURL, projectId, capabilities) {
  const issued = await ownerApi.createTechnicalToken({
    label: `A02 ${randomUUID().slice(0, 8)}`,
    projectIds: [projectId],
    capabilities,
  });
  const simulator = await createAgentSimulator(baseURL, issued.token);
  const context = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${issued.token}`, Accept: 'application/json' },
  });
  return { ...simulator, context, issued };
}

async function waitForIntake(agent, taskId) {
  await expect.poll(async () => {
    const result = await agent.call('tasks_intake_get', { task_id: taskId });
    return result.structuredContent?.outcome;
  }, { timeout: 30_000 }).toBe('needs_information');
  return agent.call('tasks_intake_get', { task_id: taskId });
}

test('A02 scoped principals cannot read or mutate foreign tasks, intakes, links, history, or live events', async ({ ownerApi, ownerPage, baseURL, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'A principal scoped to project A cannot read or change project B over JSON or MCP. List, history, and live recovery expose only A; the owner retains browser and API access to B and can revoke technical credentials.' });

  const projectA = await ownerApi.createProject({ name: 'A02 Principal Projekt A', color: '#B8914C' });
  const projectB = await ownerApi.createProject({ name: 'A02 Principal Projekt B', color: '#7C97B6' });
  await ownerApi.ensureDefaultBoard(projectB.id);
  const taskA = await ownerApi.createTask(projectA.id, { title: 'A02 erlaubtes Ticket A' });
  const topic = await configureMissingInformationIntake(ownerApi, projectB);
  const cursorState = await ownerApi.get('/live/config');
  expect(cursorState.response.status(), JSON.stringify(cursorState.data)).toBe(200);
  const agentB = await createAgent(ownerApi, baseURL, projectB.id, [
    'projects.read', 'tasks.read', 'tasks.write', 'tasks.links.write',
  ]);
  const agentA = await createAgent(ownerApi, baseURL, projectA.id, [
    'projects.read', 'tasks.read', 'tasks.write', 'tasks.links.write', 'history.read', 'live.read',
  ]);

  try {
    await qaMocks.setDecisionsScenario('decisions_missing_information');
    const created = await agentB.agent.call('tasks_create', {
      client_request_id: `a02-create-${randomUUID()}`,
      project_id: projectB.id,
      title: 'A02 fremdes Intake-Ticket B',
      description: 'Der technische Eingang muss nach konkretem Zielverhalten fragen.',
      task_type: 'bug',
      priority: 'normal',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 1500,
      link_collections: [{
        name: 'B Quellen',
        kind: 'source',
        links: [{
          title: 'B Quellissue',
          url: 'https://example.org/issues/a02-b',
          kind: 'source_issue',
          relation: 'source',
        }],
      }],
    });
    expect(created.isError, JSON.stringify(created)).toBe(false);
    const taskId = created.structuredContent.task_id;
    expect(taskId).toBeTruthy();
    const intake = created.structuredContent.outcome === 'needs_information'
      ? created
      : await waitForIntake(agentB.agent, taskId);
    expect(intake.structuredContent.outcome).toBe('needs_information');
    expect(intake.structuredContent.missing_fields.map((field) => field.field_key)).toContain('expected_behavior');

    const ownerTaskBefore = await ownerApi.get(`/tasks/${taskId}`);
    expect(ownerTaskBefore.response.status()).toBe(200);
    const intakeBefore = await ownerApi.get(`/tasks/${taskId}/intake`);
    expect(intakeBefore.response.status()).toBe(200);
    expect(intakeBefore.data.outcome).toBe('needs_information');
    const collectionCreate = await ownerApi.post(`/tasks/${taskId}/link-collections`, {
      name: 'B Eigentümerreferenzen',
      kind: 'reference',
    }, { version: ownerTaskBefore.data.version });
    expect(collectionCreate.response.status(), JSON.stringify(collectionCreate.data)).toBe(201);
    const collectionId = collectionCreate.data.id;
    const ownerTaskAfterCollection = await ownerApi.get(`/tasks/${taskId}`);
    expect(ownerTaskAfterCollection.response.status()).toBe(200);

    const httpTaskRead = await agentA.context.get(`${apiPrefix}/tasks/${taskId}`);
    expect([403, 404]).toContain(httpTaskRead.status());
    const httpTaskWrite = await agentA.context.patch(`${apiPrefix}/tasks/${taskId}`, {
      data: { title: 'A02 unberechtigter Titelwechsel' },
      headers: {
        'Idempotency-Key': `a02-write-${randomUUID()}`,
        'If-Match': `"${ownerTaskAfterCollection.data.version}"`,
      },
    });
    expect([403, 404]).toContain(httpTaskWrite.status());
    const mcpTaskRead = await agentA.agent.callRaw('tasks_get', { task_id: taskId });
    expect(mcpTaskRead.data?.result?.isError).toBe(true);
    const mcpTaskWrite = await agentA.agent.callRaw('tasks_update', {
      task_id: taskId,
      title: 'A02 unberechtigter MCP-Titelwechsel',
      client_request_id: `a02-mcp-write-${randomUUID()}`,
      expected_version: ownerTaskAfterCollection.data.version,
    });
    expect(mcpTaskWrite.data?.result?.isError).toBe(true);

    const httpIntakeRead = await agentA.context.get(`${apiPrefix}/tasks/${taskId}/intake`);
    expect([403, 404]).toContain(httpIntakeRead.status());
    const httpIntakeAnswer = await agentA.context.post(`${apiPrefix}/tasks/${taskId}/intake/information`, {
      data: {
        answers: [{ field_key: 'expected_behavior', value: 'Nicht autorisierte Antwort.' }],
      },
      headers: {
        'Idempotency-Key': `a02-answer-${randomUUID()}`,
        'If-Match': `"${ownerTaskAfterCollection.data.version}"`,
      },
    });
    expect([403, 404]).toContain(httpIntakeAnswer.status());
    const mcpIntakeRead = await agentA.agent.callRaw('tasks_intake_get', { task_id: taskId });
    expect(mcpIntakeRead.data?.result?.isError).toBe(true);
    const mcpIntakeAnswer = await agentA.agent.callRaw('tasks_supply_information', {
      task_id: taskId,
      client_request_id: `a02-mcp-answer-${randomUUID()}`,
      expected_version: ownerTaskAfterCollection.data.version,
      answers: [{ field_key: 'expected_behavior', value: 'Nicht autorisierte MCP-Antwort.' }],
    });
    expect(mcpIntakeAnswer.data?.result?.isError).toBe(true);

    const httpLinksRead = await agentA.context.get(`${apiPrefix}/tasks/${taskId}/link-collections`);
    expect([403, 404]).toContain(httpLinksRead.status());
    const httpLinksWrite = await agentA.context.post(`${apiPrefix}/tasks/${taskId}/link-collections`, {
      data: { name: 'Nicht autorisierte Collection', kind: 'delivery' },
      headers: {
        'Idempotency-Key': `a02-link-${randomUUID()}`,
        'If-Match': `"${ownerTaskAfterCollection.data.version}"`,
      },
    });
    expect([403, 404]).toContain(httpLinksWrite.status());
    const httpLinksRemove = await agentA.context.delete(`${apiPrefix}/tasks/${taskId}/link-collections/${collectionId}`, {
      headers: {
        'Idempotency-Key': `a02-unlink-${randomUUID()}`,
        'If-Match': `"${ownerTaskAfterCollection.data.version}"`,
      },
    });
    expect([403, 404]).toContain(httpLinksRemove.status());
    const mcpLinksRead = await agentA.agent.callRaw('tasks_links_list', { task_id: taskId });
    expect(mcpLinksRead.data?.result?.isError).toBe(true);
    const mcpLinksWrite = await agentA.agent.callRaw('tasks_link_collection_update', {
      task_id: taskId,
      collection_id: collectionId,
      name: 'Nicht autorisierte Änderung',
      kind: 'reference',
      client_request_id: `a02-mcp-link-${randomUUID()}`,
      expected_version: ownerTaskAfterCollection.data.version,
    });
    expect(mcpLinksWrite.data?.result?.isError).toBe(true);

    const listA = await agentA.context.get(`${apiPrefix}/tasks`);
    expect(listA.status()).toBe(200);
    const listAData = await listA.json();
    expect(listAData.items.map((task) => task.id)).toContain(taskA.id);
    expect(listAData.items.map((task) => task.id)).not.toContain(taskId);
    const listB = await agentA.context.get(`${apiPrefix}/tasks?project_id=${encodeURIComponent(projectB.id)}`);
    expect([403, 404]).toContain(listB.status());
    const mcpListA = await agentA.agent.call('tasks_list', {});
    expect(mcpListA.structuredContent.items.map((task) => task.id)).toContain(taskA.id);
    expect(mcpListA.structuredContent.items.map((task) => task.id)).not.toContain(taskId);
    const mcpListB = await agentA.agent.callRaw('tasks_list', { project_id: projectB.id });
    expect(mcpListB.data?.result?.isError).toBe(true);

    const httpHistoryAll = await agentA.context.get(`${apiPrefix}/history?limit=100`);
    expect(httpHistoryAll.status()).toBe(200);
    const historyAllData = await httpHistoryAll.json();
    expect(historyAllData.items.every((revision) => revision.project_id !== projectB.id)).toBe(true);
    expect(historyAllData.items.some((revision) => revision.resource?.id === taskId)).toBe(false);
    const httpHistoryB = await agentA.context.get(`${apiPrefix}/history?project_id=${encodeURIComponent(projectB.id)}&limit=100`);
    expect([403, 404]).toContain(httpHistoryB.status());
    const mcpHistoryAll = await agentA.agent.call('history_get', { limit: 100 });
    expect(mcpHistoryAll.structuredContent.items.every((revision) => revision.project_id !== projectB.id)).toBe(true);
    expect(mcpHistoryAll.structuredContent.items.some((revision) => revision.resource?.id === taskId)).toBe(false);
    const mcpHistoryB = await agentA.agent.callRaw('history_get', { project_id: projectB.id });
    expect(mcpHistoryB.data?.result?.isError).toBe(true);

    const httpLiveConfig = await agentA.context.get(`${apiPrefix}/live/config`);
    expect(httpLiveConfig.status()).toBe(200);
    const liveConfig = await httpLiveConfig.json();
    expect(liveConfig.topics).toContain(`urn:falkenwarte:project:${projectA.id}`);
    expect(liveConfig.topics).not.toContain(`urn:falkenwarte:project:${projectB.id}`);
    const cursor = encodeURIComponent(cursorState.data.cursor);
    const httpEvents = await agentA.context.get(`${apiPrefix}/events?cursor=${cursor}&limit=100`);
    expect(httpEvents.status()).toBe(200);
    const eventPage = await httpEvents.json();
    expect(JSON.stringify(eventPage)).not.toContain(projectB.id);
    expect(JSON.stringify(eventPage)).not.toContain(taskId);
    const httpEventsB = await agentA.context.get(`${apiPrefix}/events?cursor=${cursor}&project_id=${encodeURIComponent(projectB.id)}&limit=100`);
    expect([403, 404]).toContain(httpEventsB.status());

    const ownerTask = await ownerApi.get(`/tasks/${taskId}`);
    expect(ownerTask.response.status()).toBe(200);
    expect(ownerTask.data.title).toBe('A02 fremdes Intake-Ticket B');
    expect(ownerTask.data.version).toBe(ownerTaskAfterCollection.data.version);
    const ownerIntake = await ownerApi.get(`/tasks/${taskId}/intake`);
    expect(ownerIntake.response.status()).toBe(200);
    expect(ownerIntake.data.outcome).toBe('needs_information');
    expect(JSON.stringify(ownerIntake.data.answers ?? [])).not.toContain('Nicht autorisierte');
    const ownerLinks = await ownerApi.get(`/tasks/${taskId}/link-collections`);
    expect(ownerLinks.response.status()).toBe(200);
    const ownerCollections = ownerLinks.data.collections ?? ownerLinks.data.items ?? [];
    expect(ownerCollections.map((collection) => collection.id)).toContain(collectionId);
    expect(ownerCollections).toHaveLength(2);
    const ownerHistory = await ownerApi.get(`/history?resource_type=task&resource_id=${encodeURIComponent(taskId)}&limit=100`);
    expect(ownerHistory.response.status()).toBe(200);
    expect(ownerHistory.data.items.some((revision) => revision.project_id === projectB.id)).toBe(true);
    const ownerLiveConfig = await ownerApi.get('/live/config');
    expect(ownerLiveConfig.response.status()).toBe(200);
    expect(ownerLiveConfig.data.topics).toContain('urn:falkenwarte:owner');
    const ownerEventsB = await ownerApi.get(`/events?cursor=${cursor}&project_id=${encodeURIComponent(projectB.id)}&limit=100`);
    expect(ownerEventsB.response.status(), JSON.stringify(ownerEventsB.data)).toBe(200);
    expect(ownerEventsB.data.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(ownerEventsB.data)).toContain(taskId);

    const forbiddenRevoke = await agentA.context.delete(`${apiPrefix}/tokens/${agentA.issued.metadata.id}`, {
      headers: {
        'Idempotency-Key': `a02-token-deny-${randomUUID()}`,
        'If-Match': `"${agentA.issued.metadata.version}"`,
      },
    });
    expect(forbiddenRevoke.status()).toBe(403);
    const revoked = await ownerApi.send('DELETE', `/tokens/${agentA.issued.metadata.id}`, undefined, {
      mutation: true,
      version: agentA.issued.metadata.version,
    });
    expect(revoked.response.status(), JSON.stringify(revoked.data)).toBe(200);
    const revokedHttp = await agentA.context.get(`${apiPrefix}/tasks/${taskA.id}`);
    expect(revokedHttp.status()).toBe(401);
    const revokedMcp = await agentA.agent.callRaw('tasks_get', { task_id: taskA.id });
    expect(revokedMcp.response.status()).toBe(401);

    await ownerPage.goto(`/#/project/${projectB.id}/board`);
    await expect(ownerPage.getByRole('heading', { name: projectB.name })).toBeVisible();
    await expect(ownerPage.getByText('A02 fremdes Intake-Ticket B', { exact: true })).toBeVisible();

    recordEvidence(
      'Projekt A darf Ticket, Intake-Antwort und Link-Collections aus Projekt B weder über JSON noch MCP lesen oder verändern. Task- und Historylisten, Live-Topics und Cursor-Recovery geben B nicht aus. Der Eigentümer liest dieselben B-Ressourcen über API und Browser und kann ein technisches Token widerrufen; dessen HTTP- und MCP-Zugriff endet sofort.',
      `Agent A las und änderte B weder über JSON noch MCP: Task, Intake und Linkzugriffe wurden verworfen; Task-Version blieb ${ownerTask.data.version}, Intake blieb needs_information ohne fremde Antworten, und die zwei Eigentümer-Collections blieben erhalten. Ungefilterte Task-/Historylisten enthielten B nicht, direkte B-Listen waren gesperrt, Live-Konfiguration enthielt nur A und Events nach dem vorherigen Cursor enthielten weder Projekt- noch Task-ID B. Der Eigentümer las Task, Intake, Links und History zu B, sah B im Browserboard und las B-Änderungshinweise über den globalen Owner-Zugang. Der Eigentümer widerrief Token ${agentA.issued.metadata.id}; danach erhielten JSON und MCP HTTP 401.`,
    );
  } finally {
    await agentA.close();
    await agentA.context.dispose();
    await agentB.close();
    await agentB.context.dispose();
  }
});
