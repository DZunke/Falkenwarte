import { randomUUID } from 'node:crypto';
import { test, expect, createAgentSimulator, recordEvidence } from '../support/fixtures.mjs';

async function configureIntake(ownerApi, project, { expectedInformation = true } = {}) {
  const topic = await ownerApi.createLabel(project.id, {
    key: `topic.qa-${randomUUID().slice(0, 6)}`,
    name: 'Bedienbarkeit',
    color: '#7C97B6',
    kind: 'topic',
    description: 'Verhalten, Darstellung und Filter der Anwendung.',
  });
  const workflowLabel = await ownerApi.createLabel(project.id, {
    key: `workflow.qa-${randomUUID().slice(0, 6)}`,
    name: 'QA-Bearbeitung',
    color: '#C89562',
    kind: 'workflow',
    description: 'Kontrollierter Testablauf für ein überprüfbares Ticket.',
  });
  const secondWorkflowLabel = await ownerApi.createLabel(project.id, {
    key: `workflow.qa-review-${randomUUID().slice(0, 6)}`,
    name: 'QA-Dokumentation',
    color: '#8FA78E',
    kind: 'workflow',
    description: 'Abweichender Testablauf für Dokumentationsänderungen.',
  });

  const createWorkflow = async (name) => {
    const result = await ownerApi.post('/workflows', {
      project_id: project.id,
      name,
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
    expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
    return result.data.workflow ?? result.data;
  };
  const workflow = await createWorkflow('QA-Ticketablauf');
  const secondWorkflow = await createWorkflow('QA-Dokumentationsablauf');

  const routeState = await ownerApi.get(`/projects/${project.id}/routing-rules`);
  expect(routeState.response.status(), JSON.stringify(routeState.data)).toBe(200);
  const routeWrite = await ownerApi.put(`/projects/${project.id}/routing-rules`, {
    rules: [
      { workflow_label_id: workflowLabel.id, workflow_id: workflow.id, workflow_definition_version: workflow.definition_version ?? 1 },
      { workflow_label_id: secondWorkflowLabel.id, workflow_id: secondWorkflow.id, workflow_definition_version: secondWorkflow.definition_version ?? 1 },
    ],
    on_unresolved: 'needs_human_decision',
  }, { version: routeState.data.version });
  expect(routeWrite.response.status(), JSON.stringify(routeWrite.data)).toBe(200);

  const policyState = await ownerApi.get(`/projects/${project.id}/decision-policy`);
  expect(policyState.response.status(), JSON.stringify(policyState.data)).toBe(200);
  const policy = await ownerApi.put(`/projects/${project.id}/decision-policy`, {
    enabled_for_manual: false,
    requirements: expectedInformation ? [{
      field_key: 'expected_behavior',
      description: 'das erwartete Verhalten',
      question_template: 'Welches Verhalten wird stattdessen erwartet?',
      workflow_label_ids: [],
      required: true,
    }] : [],
    minimum_choice_probability: 0.65,
    minimum_choice_confidence: 0.65,
    minimum_choice_margin: 0.15,
    positive_tag_threshold: 0.7,
    missing_field_threshold: 0.7,
    max_clarification_rounds: 3,
  }, { version: policyState.data.version });
  expect(policy.response.status(), JSON.stringify(policy.data)).toBe(200);

  const secretResult = await ownerApi.post('/secret-references', {
    label: 'QA Decisions API',
    value: 'qa-decisions-token',
  });
  expect(secretResult.response.status(), JSON.stringify(secretResult.data)).toBe(201);

  const configurationState = await ownerApi.get('/decision-configuration');
  expect(configurationState.response.status(), JSON.stringify(configurationState.data)).toBe(200);
  const configuration = await ownerApi.put('/decision-configuration', {
    secret_reference_id: secretResult.data.id,
    timeout_ms: 5000,
    max_attempts: 2,
    max_requests_per_hour: 100,
  }, { version: configurationState.data.version });
  expect(configuration.response.status(), JSON.stringify(configuration.data)).toBe(200);

  return { topic, workflowLabels: [workflowLabel, secondWorkflowLabel], workflows: [workflow, secondWorkflow] };
}

async function createAgent(ownerApi, project, capabilities = ['projects.read', 'tasks.read', 'tasks.write', 'tasks.links.write']) {
  const issued = await ownerApi.createTechnicalToken({
    label: `QA Agent ${randomUUID().slice(0, 6)}`,
    projectIds: [project.id],
    capabilities,
  });
  return createAgentSimulator(process.env.FALKENWARTE_BASE_URL ?? 'http://127.0.0.1:8080', issued.token);
}

async function waitForIntake(agent, taskId, expectedOutcomes) {
  const read = async () => agent.call('tasks_intake_get', { task_id: taskId });
  await expect.poll(async () => expectedOutcomes.includes((await read()).structuredContent?.outcome), { timeout: 30_000 }).toBe(true);
  return read();
}

test('A22 A24 A25 A28 technical MCP intake asks and resolves missing information on the same ticket', async ({ ownerApi, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Technischer Eingang wird dauerhaft gespeichert, über Decisions klassifiziert, stellt eine Agentenrückfrage und setzt dasselbe Ticket nach Antwort fort.' });
  const project = await ownerApi.createProject({ name: 'Decisions QA Projekt', color: '#B8914C' });
  const { topic } = await configureIntake(ownerApi, project);
  const simulator = await createAgent(ownerApi, project);
  const { agent } = simulator;
  try {
    await qaMocks.setDecisionsScenario('decisions_missing_information');
    const created = await agent.call('tasks_create', {
      client_request_id: `qa-create-${randomUUID()}`,
      project_id: project.id,
      title: 'Projektfilter bleibt nach dem Wechsel sichtbar',
      description: 'Nach einem Wechsel bleibt der vorherige Filter stehen.',
      task_type: 'bug',
      priority: 'normal',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 1500,
      link_collections: [{
        name: 'Quelle',
        kind: 'source',
        links: [{
          title: 'Ursprüngliches Issue',
          url: 'https://github.com/example/falkenwarte/issues/42',
          kind: 'source_issue',
          relation: 'source',
        }],
      }],
    });
    expect(created.isError, JSON.stringify(created)).toBe(false);
    const initialReceipt = created.structuredContent;
    expect(initialReceipt.task_id).toBeTruthy();
    expect(initialReceipt.intake_id).toBeTruthy();
    const receipt = initialReceipt.outcome === 'needs_information'
      ? created
      : await waitForIntake(agent, initialReceipt.task_id, ['needs_information']);
    expect(receipt.structuredContent.outcome).toBe('needs_information');
    expect(receipt.structuredContent.missing_fields.map((field) => field.field_key)).toContain('expected_behavior');
    expect(receipt.structuredContent.human_attention.required).toBe(false);

    const taskBeforeAnswer = await ownerApi.get(`/tasks/${initialReceipt.task_id}`);
    expect(taskBeforeAnswer.response.status()).toBe(200);
    const links = await agent.call('tasks_links_list', { task_id: initialReceipt.task_id });
    expect(links.isError).toBe(false);
    const collections = links.structuredContent.collections ?? links.structuredContent.items ?? [];
    expect(collections.some((collection) => collection.name === 'Quelle')).toBe(true);
    const sourceCollection = collections.find((collection) => collection.name === 'Quelle');

    const forbiddenLink = await agent.callRaw('tasks_link_register', {
      task_id: initialReceipt.task_id,
      collection_id: sourceCollection.id,
      title: 'Unzulässiges ausführbares Schema',
      url: 'javascript:alert(1)',
      kind: 'other',
      relation: 'references',
      client_request_id: `qa-link-${randomUUID()}`,
      expected_version: taskBeforeAnswer.data.version,
    });
    expect(forbiddenLink.data.error.code).toBe(-32602);

    const linksBeforeCredentialCheck = collections.map((collection) => ({
      id: collection.id,
      linkIds: collection.links.map((link) => link.id),
    }));
    const credentialLink = await agent.call('tasks_link_register', {
      task_id: initialReceipt.task_id,
      collection_id: sourceCollection.id,
      title: 'Referenz mit eingebetteten Zugangsdaten',
      url: 'https://qa-user:qa-password@example.org/private',
      kind: 'other',
      relation: 'references',
      client_request_id: `qa-link-credentials-${randomUUID()}`,
      expected_version: taskBeforeAnswer.data.version,
    });
    expect(credentialLink.isError, JSON.stringify(credentialLink)).toBe(true);
    const linksAfterCredentialCheck = await agent.call('tasks_links_list', { task_id: initialReceipt.task_id });
    expect(linksAfterCredentialCheck.isError).toBe(false);
    expect(linksAfterCredentialCheck.structuredContent.items.map((collection) => ({
      id: collection.id,
      linkIds: collection.links.map((link) => link.id),
    }))).toEqual(linksBeforeCredentialCheck);

    await qaMocks.setDecisionsScenario('decisions_ready');
    const answered = await agent.call('tasks_supply_information', {
      task_id: initialReceipt.task_id,
      expected_version: receipt.structuredContent.task_version,
      client_request_id: `qa-answer-${randomUUID()}`,
      prefer_wait_ms: 1500,
      answers: [{ field_key: 'expected_behavior', value: 'Der Filter wechselt sichtbar zum ausgewählten Projekt.' }],
    });
    expect(answered.isError).toBe(false);
    const finalReceipt = ['ready', 'needs_human_decision'].includes(answered.structuredContent.outcome)
      ? answered
      : await waitForIntake(agent, initialReceipt.task_id, ['ready', 'needs_human_decision']);
    expect(['ready', 'needs_human_decision']).toContain(finalReceipt.structuredContent.outcome);
    expect(finalReceipt.structuredContent.task_id).toBe(initialReceipt.task_id);
    expect(finalReceipt.structuredContent.intake_id).toBe(initialReceipt.intake_id);

    const taskAfterAnswer = await ownerApi.get(`/tasks/${initialReceipt.task_id}`);
    expect(taskAfterAnswer.data.origin).toBe('mcp');
    expect(taskAfterAnswer.data.classification_required).toBe(finalReceipt.structuredContent.outcome !== 'ready');
    expect(taskAfterAnswer.data.label_ids).toContain(topic.id);

    const decisionsJournal = await qaMocks.decisionsJournal();
    expect(decisionsJournal.requests.length).toBeGreaterThanOrEqual(2);
    expect(decisionsJournal.requests.every((entry) => entry.validation_error === null)).toBe(true);
    expect(decisionsJournal.requests.every((entry) => entry.model === 'gpt-6-luna')).toBe(true);

    const manualSpoof = await agent.callRaw('tasks_create', {
      client_request_id: `qa-origin-${randomUUID()}`,
      project_id: project.id,
      title: 'Technischer Eingang behauptet manuelle Herkunft',
      origin: 'manual',
    });
    expect(manualSpoof.data.error.code).toBe(-32602);

    recordEvidence(
      'Ein Agenteneingang wird vor der Klassifikation dauerhaft gespeichert, liefert needs_information mit konkreter Rückfrage und Agentenzuständigkeit, und Ergänzungen klassifizieren denselben Task erneut. Links bleiben passive Referenzen.',
      `MCP legte Ticket ${initialReceipt.task_id} und Intake ${initialReceipt.intake_id} an; Decisions wurde ${decisionsJournal.requests.length} Mal mit gpt-6-luna und validierten nativen Fragen aufgerufen; expected_behavior wurde angefragt und beantwortet; der Task blieb derselbe, erhielt Herkunft mcp und die Topic-ID ${topic.id}. Ein javascript-Link wurde mit -32602 aus dem MCP-Schema zurückgewiesen; ein syntaktisch gültiger HTTPS-Link mit Zugangsdaten wurde als Domainfehler abgelehnt, ohne gespeicherte Links zu ändern; origin=manual wurde zurückgewiesen.`,
    );
  } finally {
    await simulator.close();
  }
});

test('A26 A27 unclear Decisions result keeps an explicit human decision open', async ({ ownerApi, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Mehrdeutige Klassifikation erzeugt eine sichtbare menschliche Entscheidung und vergibt keine automatische Freigabe.' });
  const project = await ownerApi.createProject({ name: 'Mehrdeutige Entscheidung', color: '#C17778' });
  const { topic, workflowLabels } = await configureIntake(ownerApi, project, { expectedInformation: false });
  const simulator = await createAgent(ownerApi, project);
  try {
    await qaMocks.setDecisionsScenario('decisions_ambiguous');
    const result = await simulator.agent.call('tasks_create', {
      client_request_id: `qa-ambiguous-${randomUUID()}`,
      project_id: project.id,
      title: 'Mehrere Arbeitsabläufe passen gleichzeitig',
      description: 'Die Meldung kann eine Bedienungsänderung oder eine Dokumentationsergänzung sein.',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 1500,
    });
    expect(result.isError, JSON.stringify(result)).toBe(false);
    const receipt = ['needs_human_decision'].includes(result.structuredContent.outcome)
      ? result
      : await waitForIntake(simulator.agent, result.structuredContent.task_id, ['needs_human_decision']);
    expect(receipt.structuredContent.outcome).toBe('needs_human_decision');
    expect(receipt.structuredContent.human_attention.required).toBe(true);

    const taskId = receipt.structuredContent.task_id;
    const taskBeforeLabelChange = await ownerApi.get(`/tasks/${taskId}`);
    expect(taskBeforeLabelChange.response.status()).toBe(200);
    const labels = await ownerApi.get(`/projects/${project.id}/labels`);
    expect(labels.response.status()).toBe(200);
    const attention = labels.data.items.find((label) => label.kind === 'attention' && label.active);
    expect(attention, 'The project must expose its system-managed attention label.').toBeTruthy();

    const rejectedAttentionWrite = await ownerApi.put(`/tasks/${taskId}/labels`, {
      label_ids: [attention.id],
      primary_topic_label_id: null,
      reason: 'QA versucht, die Systemaufmerksamkeit manuell zu setzen.',
      routing_application: 'next_instance',
    }, { version: taskBeforeLabelChange.data.version });
    expect(rejectedAttentionWrite.response.status(), JSON.stringify(rejectedAttentionWrite.data)).toBe(403);

    const clearedLabels = await ownerApi.put(`/tasks/${taskId}/labels`, {
      label_ids: [],
      primary_topic_label_id: null,
      reason: 'QA entfernt gewöhnliche Labels, ohne die offene Entscheidung zu beantworten.',
      routing_application: 'next_instance',
    }, { version: taskBeforeLabelChange.data.version });
    expect(clearedLabels.response.status(), JSON.stringify(clearedLabels.data)).toBe(200);
    expect(clearedLabels.data.human_attention.required).toBe(true);
    expect(clearedLabels.data.human_attention.reasons).toContain('routing_ambiguous');

    const explicitDecision = await ownerApi.post(`/tasks/${taskId}/intake/decision`, {
      label_ids: [topic.id],
      primary_topic_label_id: topic.id,
      workflow_label_id: workflowLabels[0].id,
      reason: 'Die Meldung gehört zum kontrollierten QA-Bearbeitungsablauf.',
    }, { version: clearedLabels.data.version });
    expect(explicitDecision.response.status(), JSON.stringify(explicitDecision.data)).toBe(200);
    expect(explicitDecision.data.outcome).toBe('ready');
    expect(explicitDecision.data.human_attention.required).toBe(false);

    const decisionsJournal = await qaMocks.decisionsJournal();
    expect(decisionsJournal.requests.length).toBeGreaterThan(0);
    expect(decisionsJournal.requests[0].validation_error).toBeNull();
    recordEvidence(
      'Mehrdeutige Workflowauswahl fordert eine echte Eigentümerentscheidung und lässt die Agentenmeldung ohne automatische Freigabe bestehen.',
      `Ticket ${taskId} erreichte needs_human_decision mit human_attention.required=true nach einem validierten Decisions-Aufruf. Das Setzen eines systemverwalteten Attentionlabels wurde mit HTTP 403 abgewiesen; das Entfernen aller regulären Labels ließ Grund routing_ambiguous bestehen; erst die explizite Intakeentscheidung führte zu ready und human_attention.required=false.`,
    );
  } finally {
    await simulator.close();
  }
});

test('A26 Decisions refusal, limited retry, and exhausted transport stay distinguishable', async ({ ownerApi, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Ein typisiertes Refusal und dauerhafte Providerstörung bleiben sichtbar; ein kurzzeitiges 429 wird innerhalb des konfigurierten Budgets erneut versucht.' });
  const project = await ownerApi.createProject({ name: 'Decisions Fehlergrenzen', color: '#729E90' });
  const { topic } = await configureIntake(ownerApi, project, { expectedInformation: false });
  const simulator = await createAgent(ownerApi, project);
  const { agent } = simulator;
  const submit = async (title, clientRequestId) => agent.call('tasks_create', {
    client_request_id: clientRequestId,
    project_id: project.id,
    title,
    description: 'Entscheidungsfehler werden als fachlicher Zustand nachverfolgt.',
    suggested_label_ids: [topic.id],
    prefer_wait_ms: 1500,
  });

  try {
    await qaMocks.setDecisionsScenario('decisions_refusal');
    const refusal = await submit('Decisions refusal bleibt offen', `qa-refusal-${randomUUID()}`);
    expect(refusal.isError, JSON.stringify(refusal)).toBe(false);
    const refused = refusal.structuredContent.outcome === 'needs_human_decision'
      ? refusal
      : await waitForIntake(agent, refusal.structuredContent.task_id, ['needs_human_decision']);
    expect(refused.structuredContent.human_attention.required).toBe(true);

    await qaMocks.setDecisionsScenario('decisions_429_then_success');
    const retried = await submit('Ein begrenzter Rate-Limit-Retry gelingt', `qa-retry-${randomUUID()}`);
    expect(retried.isError, JSON.stringify(retried)).toBe(false);
    const ready = retried.structuredContent.outcome === 'ready'
      ? retried
      : await waitForIntake(agent, retried.structuredContent.task_id, ['ready']);
    expect(ready.structuredContent.outcome).toBe('ready');

    await qaMocks.setDecisionsScenario('decisions_transport_exhausted');
    const unavailable = await submit('Dauerhafter Providerfehler bleibt sichtbar', `qa-unavailable-${randomUUID()}`);
    expect(unavailable.isError, JSON.stringify(unavailable)).toBe(false);
    const failed = unavailable.structuredContent.outcome === 'classification_unavailable'
      ? unavailable
      : await waitForIntake(agent, unavailable.structuredContent.task_id, ['classification_unavailable']);
    expect(failed.structuredContent.outcome).toBe('classification_unavailable');
    expect(failed.structuredContent.human_attention.required).toBe(true);

    const journal = await qaMocks.decisionsJournal();
    const refusalCalls = journal.requests.filter((entry) => entry.scenario === 'decisions_refusal');
    const retryCalls = journal.requests.filter((entry) => entry.scenario === 'decisions_429_then_success');
    const exhaustedCalls = journal.requests.filter((entry) => entry.scenario === 'decisions_transport_exhausted');
    expect(refusalCalls.map((entry) => entry.outcome)).toEqual(['http_200']);
    expect(retryCalls.map((entry) => entry.outcome)).toEqual(['http_429', 'http_200']);
    expect(exhaustedCalls.length).toBeGreaterThanOrEqual(2);
    expect(exhaustedCalls.every((entry) => entry.outcome === 'connection_dropped')).toBe(true);

    recordEvidence(
      'Ein typisiertes Refusal führt zu menschlicher Entscheidung, ein HTTP 429 wird innerhalb der konfigurierten Wiederholungen behoben, und ausgeschöpfte Verbindungsversuche enden als classification_unavailable.',
      `Refusal erreichte needs_human_decision; der Rate-Limit-Aufruf wurde in ${retryCalls.length} Versuchen mit HTTP 429 gefolgt von HTTP 200 abgeschlossen und erreichte ready; der Transportfehler wurde ${exhaustedCalls.length} Mal versucht und blieb classification_unavailable. Alle Antworten waren fachliche Intake-Zustände statt JSON-RPC-Fehler.`,
    );
  } finally {
    await simulator.close();
  }
});
