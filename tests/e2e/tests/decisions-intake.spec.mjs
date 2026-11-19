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

    const deliveryCollection = await agent.call('tasks_link_collection_create', {
      task_id: initialReceipt.task_id,
      name: 'Ergebnisse',
      kind: 'delivery',
      client_request_id: `qa-delivery-${randomUUID()}`,
      expected_version: taskAfterAnswer.data.version,
    });
    expect(deliveryCollection.isError).toBe(false);
    const githubPullRequest = await agent.call('tasks_link_register', {
      task_id: initialReceipt.task_id,
      collection_id: deliveryCollection.structuredContent.id,
      title: 'GitHub Pull Request 43',
      url: 'https://github.com/example/falkenwarte/pull/43',
      kind: 'pull_request',
      relation: 'delivers',
      client_request_id: `qa-github-pr-${randomUUID()}`,
      expected_version: deliveryCollection.structuredContent.task_version,
    });
    expect(githubPullRequest.isError).toBe(false);
    const gitlabMergeRequest = await agent.call('tasks_link_register', {
      task_id: initialReceipt.task_id,
      collection_id: deliveryCollection.structuredContent.id,
      title: 'GitLab Merge Request 44',
      url: 'https://gitlab.example.org/falkenwarte/app/-/merge_requests/44',
      kind: 'merge_request',
      relation: 'delivers',
      client_request_id: `qa-gitlab-mr-${randomUUID()}`,
      expected_version: githubPullRequest.structuredContent.task_version,
    });
    expect(gitlabMergeRequest.isError).toBe(false);
    const jiraSource = await agent.call('tasks_link_register', {
      task_id: initialReceipt.task_id,
      collection_id: sourceCollection.id,
      title: 'Jira-QA-42',
      url: 'https://jira.example.org/browse/QA-42',
      kind: 'source_issue',
      relation: 'source',
      client_request_id: `qa-jira-${randomUUID()}`,
      expected_version: gitlabMergeRequest.structuredContent.task_version,
    });
    expect(jiraSource.isError).toBe(false);

    const linksAfterRegistration = await agent.call('tasks_links_list', { task_id: initialReceipt.task_id });
    expect(linksAfterRegistration.isError).toBe(false);
    const allLinks = linksAfterRegistration.structuredContent.items.flatMap((collection) => collection.links);
    expect(allLinks.map((link) => link.url)).toEqual(expect.arrayContaining([
      'https://github.com/example/falkenwarte/pull/43',
      'https://gitlab.example.org/falkenwarte/app/-/merge_requests/44',
      'https://jira.example.org/browse/QA-42',
    ]));
    for (const link of allLinks.filter((item) => ['GitHub Pull Request 43', 'GitLab Merge Request 44', 'Jira-QA-42'].includes(item.title))) {
      expect(link.registered_by).toBeTruthy();
      expect(Number.isNaN(Date.parse(link.registered_at))).toBe(false);
    }
    const linkHistory = await ownerApi.get(`/history?resource_type=task&resource_id=${initialReceipt.task_id}&limit=100`);
    expect(linkHistory.response.status()).toBe(200);
    expect(linkHistory.data.items.some((revision) => revision.summary === 'task.link_registered')).toBe(true);

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
      `MCP legte Ticket ${initialReceipt.task_id} und Intake ${initialReceipt.intake_id} an; Decisions wurde ${decisionsJournal.requests.length} Mal mit gpt-6-luna und validierten nativen Fragen aufgerufen; expected_behavior wurde angefragt und beantwortet; der Task blieb derselbe, erhielt Herkunft mcp und die Topic-ID ${topic.id}. Ein javascript-Link wurde mit -32602 aus dem MCP-Schema zurückgewiesen; ein syntaktisch gültiger HTTPS-Link mit Zugangsdaten wurde als Domainfehler abgelehnt, ohne gespeicherte Links zu ändern; GitHub PR, GitLab MR und Jira-Quelle wurden mit Akteur/Zeitstempel historisiert; origin=manual wurde zurückgewiesen.`,
      { decisions: decisionsJournal },
    );
  } finally {
    await simulator.close();
  }
});

test('A26 unclear Decisions result keeps an explicit human decision open', async ({ ownerApi, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Überholte Intake-Gründe werden beim neuen Assessment geschlossen; ein offener Attention-Grund bleibt trotz Labelentfernung bestehen und wird nur durch die konkrete Entscheidung aufgelöst.' });
  const project = await ownerApi.createProject({ name: 'Mehrdeutige Entscheidung', color: '#C17778' });
  const { topic, workflowLabels } = await configureIntake(ownerApi, project, { expectedInformation: false });
  const simulator = await createAgent(ownerApi, project);
  try {
    await qaMocks.setDecisionsScenario('decisions_transport_exhausted');
    const result = await simulator.agent.call('tasks_create', {
      client_request_id: `qa-ambiguous-${randomUUID()}`,
      project_id: project.id,
      title: 'Mehrere Arbeitsabläufe passen gleichzeitig',
      description: 'Die Meldung kann eine Bedienungsänderung oder eine Dokumentationsergänzung sein.',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 1500,
    });
    expect(result.isError, JSON.stringify(result)).toBe(false);
    const unavailable = ['classification_unavailable'].includes(result.structuredContent.outcome)
      ? result
      : await waitForIntake(simulator.agent, result.structuredContent.task_id, ['classification_unavailable']);
    expect(unavailable.structuredContent.outcome).toBe('classification_unavailable');
    expect(unavailable.structuredContent.human_attention.required).toBe(true);

    const taskId = unavailable.structuredContent.task_id;
    const failedTask = await ownerApi.get(`/tasks/${taskId}`);
    expect(failedTask.response.status()).toBe(200);
    await qaMocks.setDecisionsScenario('decisions_ambiguous');
    const reclassified = await ownerApi.post(`/tasks/${taskId}/intake/reclassify`, {
      reason: 'Neues Assessment nach dem früheren Providerfehler.',
    }, { version: failedTask.data.version });
    expect([200, 202], JSON.stringify(reclassified.data)).toContain(reclassified.response.status());
    const receipt = await waitForIntake(simulator.agent, taskId, ['needs_human_decision']);
    expect(receipt.structuredContent.outcome).toBe('needs_human_decision');
    expect(receipt.structuredContent.human_attention.required).toBe(true);

    const taskBeforeLabelChange = await ownerApi.get(`/tasks/${taskId}`);
    expect(taskBeforeLabelChange.response.status()).toBe(200);
    expect(taskBeforeLabelChange.data.human_attention.reasons).toEqual(['routing_ambiguous']);
    const labels = await ownerApi.get(`/projects/${project.id}/labels`);
    expect(labels.response.status()).toBe(200);
    const attention = labels.data.items.find((label) => label.key === 'attention:routing_ambiguous');
    expect(attention, 'The stable system label must be visible in the project label list.').toMatchObject({
      kind: 'attention',
      active: true,
      system_managed: true,
    });
    expect(taskBeforeLabelChange.data.label_ids).toContain(attention.id);
    const supersededAttention = labels.data.items.find((label) => label.key === 'attention:classification_unavailable');
    expect(taskBeforeLabelChange.data.label_ids).not.toContain(supersededAttention.id);

    const editedAttention = await ownerApi.patch(`/projects/${project.id}/labels/${attention.id}`, {
      name: 'Workflow wählen · QA',
      color: '#A34545',
    }, { version: attention.version });
    expect(editedAttention.response.status(), JSON.stringify(editedAttention.data)).toBe(200);
    expect(editedAttention.data.id).toBe(attention.id);
    expect(editedAttention.data.version).toBe(attention.version + 1);
    const staleAttentionEdit = await ownerApi.patch(`/projects/${project.id}/labels/${attention.id}`, {
      color: '#E4B85F',
    }, { version: attention.version });
    expect(staleAttentionEdit.response.status(), JSON.stringify(staleAttentionEdit.data)).toBe(412);
    expect(staleAttentionEdit.data.code).toBe('version_conflict');
    const deactivateAttention = await ownerApi.patch(`/projects/${project.id}/labels/${attention.id}`, {
      active: false,
    }, { version: editedAttention.data.version });
    expect(deactivateAttention.response.status(), JSON.stringify(deactivateAttention.data)).toBe(409);
    expect(deactivateAttention.data.code).toBe('system_label_immutable');

    const clearedLabels = await ownerApi.put(`/tasks/${taskId}/labels`, {
      label_ids: taskBeforeLabelChange.data.label_ids.filter((labelId) => labelId !== attention.id),
      primary_topic_label_id: taskBeforeLabelChange.data.primary_topic_label_id,
      reason: 'QA entfernt ausschließlich das abgeleitete Attentionlabel, ohne die offene Entscheidung zu beantworten.',
      routing_application: 'next_instance',
    }, { version: taskBeforeLabelChange.data.version });
    expect(clearedLabels.response.status(), JSON.stringify(clearedLabels.data)).toBe(200);
    expect(clearedLabels.data.human_attention.required).toBe(true);
    expect(clearedLabels.data.human_attention.reasons).toContain('routing_ambiguous');
    expect(clearedLabels.data.human_attention.reasons).not.toContain('classification_unavailable');
    expect(clearedLabels.data.label_ids).toContain(attention.id);

    const explicitDecision = await ownerApi.post(`/tasks/${taskId}/intake/decision`, {
      label_ids: [topic.id],
      primary_topic_label_id: topic.id,
      workflow_label_id: workflowLabels[0].id,
      reason: 'Die Meldung gehört zum kontrollierten QA-Bearbeitungsablauf.',
    }, { version: clearedLabels.data.version });
    expect(explicitDecision.response.status(), JSON.stringify(explicitDecision.data)).toBe(200);
    expect(explicitDecision.data.outcome).toBe('ready');
    expect(explicitDecision.data.human_attention.required).toBe(false);
    expect(explicitDecision.data.human_attention.reasons).toEqual([]);
    const settledTask = await ownerApi.get(`/tasks/${taskId}`);
    expect(settledTask.response.status(), JSON.stringify(settledTask.data)).toBe(200);
    expect(settledTask.data.human_attention).toEqual({ required: false, reasons: [] });
    expect(settledTask.data.label_ids).not.toContain(attention.id);

    const decisionsJournal = await qaMocks.decisionsJournal();
    expect(decisionsJournal.requests.length).toBeGreaterThanOrEqual(3);
    expect(decisionsJournal.requests.every((entry) => entry.validation_error === null)).toBe(true);
    recordEvidence(
      'Mehrdeutige Klassifikation zeigt ein systemverwaltetes Attentionlabel. Die Entfernung dieses Labels kann den fachlichen Grund nicht verbergen; erst die passende Eigentümerentscheidung schließt ihn. Gründe aus früheren Intake-Generationen werden beim neuen Assessment nicht weiter angezeigt.',
      `Ticket ${taskId} erreichte zuerst classification_unavailable und nach einem neuen validierten Decisions-Assessment needs_human_decision. Der frühere Intake-Grund wurde durch die neue Assessment-Generation geschlossen; nur routing_ambiguous blieb offen und dessen systemverwaltetes Label war auf Projekt- und Ticketebene sichtbar. Name und Farbe ließen sich bei stabiler Label-ID aktualisieren; ein veralteter Versionsschreibversuch erhielt 412 version_conflict, die Deaktivierung 409 system_label_immutable. Ein Owner-Schreibvorgang, der nur das Attentionlabel aus der Labelzuordnung entfernte, erhielt Grund und Label. Erst tasks_intake_decide führte zu ready, human_attention.required=false und entfernte die abgeleitete Ticketzuordnung.`,
      { decisions: decisionsJournal },
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

    const malformedResults = [];
    for (const scenario of ['decisions_invalid_answer_type', 'decisions_partial_answers', 'decisions_unknown_answer']) {
      await qaMocks.setDecisionsScenario(scenario);
      const malformed = await submit(`Ungültige Decisions-Antwort ${scenario}`, `qa-malformed-${scenario}-${randomUUID()}`);
      expect(malformed.isError, JSON.stringify(malformed)).toBe(false);
      const unavailableResult = malformed.structuredContent.outcome === 'classification_unavailable'
        ? malformed
        : await waitForIntake(agent, malformed.structuredContent.task_id, ['classification_unavailable']);
      expect(unavailableResult.structuredContent.outcome).toBe('classification_unavailable');
      expect(unavailableResult.structuredContent.human_attention.required).toBe(true);
      expect(unavailableResult.structuredContent.classification_id).toBeTruthy();

      const classification = await ownerApi.get(`/tasks/${malformed.structuredContent.task_id}/classifications/${unavailableResult.structuredContent.classification_id}`);
      expect(classification.response.status(), JSON.stringify(classification.data)).toBe(200);
      expect(classification.data).toMatchObject({
        outcome: 'classification_unavailable',
        applied: false,
        answers: [],
      });
      const unchangedTask = await ownerApi.get(`/tasks/${malformed.structuredContent.task_id}`);
      expect(unchangedTask.response.status()).toBe(200);
      expect(unchangedTask.data).toMatchObject({
        intake_outcome: 'classification_unavailable',
        primary_topic_label_id: null,
        workflow_label_id: null,
        classification_id: classification.data.id,
      });
      expect(unchangedTask.data.label_ids).not.toContain(topic.id);
      malformedResults.push({ scenario, classificationId: classification.data.id });
    }

    const journal = await qaMocks.decisionsJournal();
    const refusalCalls = journal.requests.filter((entry) => entry.scenario === 'decisions_refusal');
    const retryCalls = journal.requests.filter((entry) => entry.scenario === 'decisions_429_then_success');
    const exhaustedCalls = journal.requests.filter((entry) => entry.scenario === 'decisions_transport_exhausted');
    const malformedCalls = journal.requests.filter((entry) => ['decisions_invalid_answer_type', 'decisions_partial_answers', 'decisions_unknown_answer'].includes(entry.scenario));
    expect(refusalCalls.map((entry) => entry.outcome)).toEqual(['http_200']);
    expect(retryCalls.map((entry) => entry.outcome)).toEqual(['http_429', 'http_200']);
    expect(exhaustedCalls.length).toBeGreaterThanOrEqual(2);
    expect(exhaustedCalls.every((entry) => entry.outcome === 'connection_dropped')).toBe(true);
    expect(malformedCalls).toHaveLength(3);
    expect(malformedCalls.every((entry) => entry.outcome === 'http_200' && entry.validation_error === null)).toBe(true);

    recordEvidence(
      'Typisiertes Refusal, HTTP 429, ausgeschöpfter Transport und nicht verwendbare Decisions-Daten bleiben als getrennte fachliche Zustände sichtbar.',
      `Refusal erreichte needs_human_decision; der Rate-Limit-Aufruf wurde in ${retryCalls.length} Versuchen mit HTTP 429 gefolgt von HTTP 200 abgeschlossen und erreichte ready; der Transportfehler wurde ${exhaustedCalls.length} Mal versucht und blieb classification_unavailable. Antworttyp, Antwortanzahl und unbekannte Frage-ID endeten über jeweils einen HTTP-200-Aufruf als classification_unavailable ohne angewandte Teilantwort (${malformedResults.map((result) => `${result.scenario}: ${result.classificationId}`).join(', ')}). Alle Fälle blieben fachliche Intake-Zustände statt JSON-RPC-Fehler.`,
      { decisions: journal },
    );
  } finally {
    await simulator.close();
  }
});

test('A33 stale Decisions response cannot overwrite a newer ticket revision', async ({ ownerApi, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Eine verspätete Decisions-Antwort wird als überholt protokolliert und überschreibt weder die neuere Ticketrevision noch deren erneute Klassifikation.' });
  const project = await ownerApi.createProject({ name: 'Veraltete Klassifikation', color: '#887AA8' });
  const { topic } = await configureIntake(ownerApi, project, { expectedInformation: false });
  const simulator = await createAgent(ownerApi, project);
  try {
    await qaMocks.setDecisionsScenario('decisions_delayed');
    const created = await simulator.agent.call('tasks_create', {
      client_request_id: `qa-stale-${randomUUID()}`,
      project_id: project.id,
      title: 'Klassifikation beginnt mit altem Tickettext',
      description: 'Die Klassifikation wartet auf eine kontrolliert verzögerte Antwort.',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 0,
    });
    expect(created.isError, JSON.stringify(created)).toBe(false);
    const initialReceipt = created.structuredContent;
    expect(initialReceipt.task_id).toBeTruthy();
    expect(initialReceipt.action_id).toBeTruthy();

    await expect.poll(async () => (await qaMocks.decisionsJournal()).requests.length, { timeout: 10_000 }).toBe(1);
    const heldJournal = await qaMocks.decisionsJournal();
    expect(heldJournal.requests[0].outcome).toBe('held_at_barrier');
    const beforeChange = await ownerApi.get(`/tasks/${initialReceipt.task_id}`);
    expect(beforeChange.response.status()).toBe(200);
    const revised = await ownerApi.patch(`/tasks/${initialReceipt.task_id}`, {
      title: 'Klassifikation bezieht sich auf den neuen Tickettext',
    }, { version: beforeChange.data.version });
    expect(revised.response.status(), JSON.stringify(revised.data)).toBe(200);
    await qaMocks.releaseDecisions();

    const finalReceipt = await waitForIntake(simulator.agent, initialReceipt.task_id, ['ready']);
    expect(finalReceipt.structuredContent.outcome).toBe('ready');
    const finalTask = await ownerApi.get(`/tasks/${initialReceipt.task_id}`);
    expect(finalTask.data.title).toBe('Klassifikation bezieht sich auf den neuen Tickettext');
    expect(finalTask.data.label_ids).toContain(topic.id);

    const actionHistory = await ownerApi.get(`/history?action_id=${encodeURIComponent(initialReceipt.action_id)}&limit=100`);
    expect(actionHistory.response.status(), JSON.stringify(actionHistory.data)).toBe(200);
    const classificationIds = [...new Set(actionHistory.data.items
      .filter((revision) => revision.resource?.resource_type === 'classification')
      .map((revision) => revision.resource.id))];
    expect(classificationIds.length).toBeGreaterThanOrEqual(2);
    const records = await Promise.all(classificationIds.map(async (classificationId) => {
      const result = await ownerApi.get(`/tasks/${initialReceipt.task_id}/classifications/${classificationId}`);
      expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
      return result.data;
    }));
    const staleRecord = records.find((record) => record.task_revision === beforeChange.data.version);
    const appliedRecord = records.find((record) => record.task_revision === revised.data.version);
    expect(staleRecord, 'The outdated provider answer must remain inspectable.').toBeTruthy();
    expect(staleRecord.applied).toBe(false);
    expect(appliedRecord).toBeTruthy();
    expect(appliedRecord.applied).toBe(true);
    expect(appliedRecord.outcome).toBe('ready');

    const decisionsJournal = await qaMocks.decisionsJournal();
    expect(decisionsJournal.requests.length).toBeGreaterThanOrEqual(2);
    expect(decisionsJournal.requests.every((entry) => entry.validation_error === null)).toBe(true);
    recordEvidence(
      'Eine verspätete Antwort bleibt unapplied; ein neuer fachlicher Versuch klassifiziert ausschließlich die aktuellste Ticketrevision.',
      `Die erste Klassifikation für Revision ${beforeChange.data.version} blieb applied=false. Nach der Eigentümeränderung auf Revision ${revised.data.version} wurde ein neuer gültiger Decisions-Aufruf ausgeführt und erreichte ready mit applied=true. Tickettext und Topiclabel der aktuellen Revision blieben erhalten; beide Klassifikationen sind über die öffentliche History und Classification-API prüfbar.`,
      { decisions: { ...decisionsJournal, barrier_observed: heldJournal.requests[0].outcome === 'held_at_barrier' } },
    );
  } finally {
    await simulator.close();
  }
});

test('A33 stale Decisions response cannot overwrite newer taxonomy or routing versions', async ({ ownerApi, qaMocks }) => {
  test.info().annotations.push({ type: 'expected', description: 'Eine verspätete Antwort bleibt auch nach Änderungen an Labeltaxonomie und Workflowroute unverändert unapplied; ein neuer fachlicher Versuch verwendet beide aktuellen Versionen.' });
  const project = await ownerApi.createProject({ name: 'Veraltete Taxonomie und Route', color: '#887AA8' });
  const { topic, workflows } = await configureIntake(ownerApi, project, { expectedInformation: false });
  const simulator = await createAgent(ownerApi, project);
  try {
    const labelsBefore = await ownerApi.get(`/projects/${project.id}/labels`);
    expect(labelsBefore.response.status()).toBe(200);
    const routingBefore = await ownerApi.get(`/projects/${project.id}/routing-rules`);
    expect(routingBefore.response.status()).toBe(200);
    const initialTaxonomyVersion = labelsBefore.data.taxonomy_version;
    const initialRoutingVersion = routingBefore.data.version;

    await qaMocks.setDecisionsScenario('decisions_delayed');
    const created = await simulator.agent.call('tasks_create', {
      client_request_id: `qa-taxonomy-stale-${randomUUID()}`,
      project_id: project.id,
      title: 'Taxonomie und Route bleiben am Snapshot gebunden',
      description: 'Eine noch ausstehende Bewertung darf keine geänderte Label- oder Routendefinition überschreiben.',
      suggested_label_ids: [topic.id],
      prefer_wait_ms: 0,
    });
    expect(created.isError, JSON.stringify(created)).toBe(false);
    const initialReceipt = created.structuredContent;
    expect(initialReceipt.task_id).toBeTruthy();
    expect(initialReceipt.action_id).toBeTruthy();
    const taskBeforeChange = await ownerApi.get(`/tasks/${initialReceipt.task_id}`);
    expect(taskBeforeChange.response.status()).toBe(200);

    await expect.poll(async () => {
      const journal = await qaMocks.decisionsJournal();
      return journal.requests.filter((entry) => entry.scenario === 'decisions_delayed' && entry.outcome === 'held_at_barrier').length;
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    const heldJournal = await qaMocks.decisionsJournal();
    expect(heldJournal.requests.some((entry) => entry.outcome === 'held_at_barrier' && entry.taxonomy_version === initialTaxonomyVersion)).toBe(true);

    const changedTopic = await ownerApi.patch(`/projects/${project.id}/labels/${topic.id}`, {
      description: 'Taxonomiesnapshot nach Eingang geändert.',
    }, { version: topic.version });
    expect(changedTopic.response.status(), JSON.stringify(changedTopic.data)).toBe(200);
    const labelsAfter = await ownerApi.get(`/projects/${project.id}/labels`);
    expect(labelsAfter.response.status()).toBe(200);
    expect(labelsAfter.data.taxonomy_version).toBe(initialTaxonomyVersion + 1);

    const swappedRules = routingBefore.data.rules.map((rule) => {
      const nextWorkflow = rule.workflow_id === workflows[0].id ? workflows[1] : workflows[0];
      return { ...rule, workflow_id: nextWorkflow.id, workflow_definition_version: nextWorkflow.definition_version ?? 1 };
    });
    const changedRouting = await ownerApi.put(`/projects/${project.id}/routing-rules`, {
      rules: swappedRules,
      on_unresolved: routingBefore.data.on_unresolved,
    }, { version: routingBefore.data.version });
    expect(changedRouting.response.status(), JSON.stringify(changedRouting.data)).toBe(200);
    expect(changedRouting.data.version).toBe(initialRoutingVersion + 1);

    await qaMocks.releaseDecisions();
    const completed = await waitForIntake(simulator.agent, initialReceipt.task_id, ['ready']);
    expect(completed.structuredContent.outcome).toBe('ready');
    const finalIntake = await ownerApi.get(`/tasks/${initialReceipt.task_id}/intake`);
    expect(finalIntake.response.status()).toBe(200);
    expect(finalIntake.data.taxonomy_version).toBe(labelsAfter.data.taxonomy_version);
    expect(finalIntake.data.routing_rules_version).toBe(changedRouting.data.version);
    const finalTask = await ownerApi.get(`/tasks/${initialReceipt.task_id}`);
    expect(finalTask.response.status()).toBe(200);
    expect(finalTask.data.title).toBe(taskBeforeChange.data.title);
    expect(finalTask.data.description).toBe(taskBeforeChange.data.description);
    expect(finalTask.data.label_ids).toContain(topic.id);

    const history = await ownerApi.get(`/history?action_id=${encodeURIComponent(initialReceipt.action_id)}&limit=100`);
    expect(history.response.status(), JSON.stringify(history.data)).toBe(200);
    const classificationIds = [...new Set(history.data.items
      .filter((revision) => revision.resource?.resource_type === 'classification')
      .map((revision) => revision.resource.id))];
    const records = await Promise.all(classificationIds.map(async (classificationId) => {
      const result = await ownerApi.get(`/tasks/${initialReceipt.task_id}/classifications/${classificationId}`);
      expect(result.response.status(), JSON.stringify(result.data)).toBe(200);
      return result.data;
    }));
    const staleRecord = records.find((record) => record.taxonomy_version === initialTaxonomyVersion && record.routing_rules_version === initialRoutingVersion);
    const appliedRecord = records.find((record) => record.taxonomy_version === labelsAfter.data.taxonomy_version && record.routing_rules_version === changedRouting.data.version);
    expect(staleRecord, 'The old taxonomy and routing snapshot must remain inspectable.').toBeTruthy();
    expect(staleRecord.task_revision).toBe(taskBeforeChange.data.version);
    expect(staleRecord.applied).toBe(false);
    expect(appliedRecord).toBeTruthy();
    expect(appliedRecord.applied).toBe(true);
    expect(appliedRecord.outcome).toBe('ready');

    const decisionsJournal = await qaMocks.decisionsJournal();
    expect(decisionsJournal.requests.length).toBeGreaterThanOrEqual(2);
    expect(decisionsJournal.requests.every((entry) => entry.validation_error === null)).toBe(true);
    recordEvidence(
      'Eine verspätete Antwort wird anhand der eingefrorenen Label- und Routingversion als überholt gespeichert; die erneute Bewertung wendet nur den aktuellen Snapshot an.',
      `Während die Antwort auf Ticketrevision ${taskBeforeChange.data.version} wartete, stieg die Taxonomie von v${initialTaxonomyVersion} auf v${labelsAfter.data.taxonomy_version} und die Route von v${initialRoutingVersion} auf v${changedRouting.data.version}. Der alte Klassifikationsnachweis blieb unapplied, der neue nutzte beide aktuellen Versionen und erreichte ready mit applied=true; Tickettext und Beschreibung blieben unverändert.`,
      { decisions: { ...decisionsJournal, barrier_observed: heldJournal.requests.some((entry) => entry.outcome === 'held_at_barrier') } },
    );
  } finally {
    await simulator.close();
  }
});
