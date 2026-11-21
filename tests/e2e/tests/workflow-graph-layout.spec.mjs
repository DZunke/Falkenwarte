import { randomUUID } from 'node:crypto';
import { expect, recordEvidence, test } from '../support/fixtures.mjs';

const runPolicy = {
  require_external_settled: true,
  required_evidence_kinds: [],
  required_criterion_ids: [],
  require_human_phase_decision: false,
  require_human_confirmed_evidence: false,
};

const longWorkflowName = 'Morgenblatt: lange Redaktionsvorlage für Quellenprüfung, unabhängiges Review und geplante Ausgabe';
const stageNames = [
  'Quellenrecherche mit ausführlicher Belegsammlung für die tägliche Morgenblatt-Ausgabe',
  'Unabhängige redaktionelle Prüfung mit sorgfältigem Faktenabgleich und Quellenhinweisen',
  'Freigabe und Veröffentlichung der fertig geprüften Morgenblatt-Ausgabe',
];
const profileNames = [
  'Morgenblatt Recherche und Quellenpflege für die Tagesausgabe',
  'Morgenblatt Unabhängiges Faktenreview mit Quellenabgleich',
  'Morgenblatt Schlussredaktion und Veröffentlichungsfreigabe',
];
const profileRoles = ['Recherche und Belege', 'Unabhängige Prüfung', 'Schlussredaktion'];
const longRouteLabelName = 'Redaktionelle Überarbeitung nach unabhängigem Faktenreview';

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

async function createBoundProject(ownerApi, ownerPage, baseURL, qaMocks, name) {
  const project = await ownerApi.createProject({ name });
  const board = await ownerApi.ensureDefaultBoard(project.id);
  const connectionResult = await ownerApi.post('/connections', {
    name: `Workflow graph ${randomUUID().slice(0, 8)}`,
    bridge_id: 't3.mcp.v0_1_10',
    canonical_url: qaMocks.t3URL,
  });
  expect(connectionResult.response.status(), JSON.stringify(connectionResult.data)).toBe(201);
  const connection = connectionResult.data;
  const oauth = await ownerApi.post(`/connections/${connection.id}/oauth/start`, {
    redirect_uri: new URL('/auth/t3/callback', baseURL).toString(),
  }, { version: connection.version });
  expect(oauth.response.status(), JSON.stringify(oauth.data)).toBe(200);
  await ownerPage.goto(oauth.data.authorization_url);
  const authorized = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.auth_status === 'valid', 'Die T3-Mockverbindung muss im Browser autorisiert werden.');
  const check = await ownerApi.post(`/connections/${connection.id}/check`, {}, { version: authorized.version });
  expect(check.response.status(), JSON.stringify(check.data)).toBe(202);
  const readyConnection = await readUntil(ownerApi, `/connections/${connection.id}`, (item) => item.health === 'ready' && item.auth_status === 'valid', 'Der T3-Mock muss den Capability-Handshake abschließen.');
  const latestProject = await ownerApi.get(`/projects/${project.id}`);
  expect(latestProject.response.status(), JSON.stringify(latestProject.data)).toBe(200);
  const binding = await ownerApi.put(`/projects/${project.id}/binding`, {
    connection_id: connection.id,
    external_project_id: 'qa-t3-project-1',
    max_active_runs: 1,
  }, { version: latestProject.data.version });
  expect(binding.response.status(), JSON.stringify(binding.data)).toBe(200);
  return { project, board, connection: readyConnection };
}

async function createProfile(ownerApi, project, connection, name, role) {
  const result = await ownerApi.post('/agent-profiles', {
    name,
    icon_key: 'bot',
    role,
    connection_id: connection.id,
    allowed_project_ids: [project.id],
    max_parallel_runs: 1,
    prompt_template: `Arbeite ausschließlich in der Phase ${role} und belege deine Aussagen.`,
    enabled: true,
    default_run_completion_policy: runPolicy,
    execution_target: { mode: 't3_project_default' },
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data;
}

async function createWorkflow(ownerApi, projectId, name, stages, transitions) {
  const result = await ownerApi.post('/workflows', {
    project_id: projectId,
    name,
    preset_id: 'manual',
    stages,
    transitions,
    limits: { max_repair_rounds: 2, max_depth: 3, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(result.response.status(), JSON.stringify(result.data)).toBe(201);
  return result.data.workflow ?? result.data;
}

function stagesFor(profiles) {
  return stageNames.map((name, index) => ({
    id: ['research', 'review', 'publish'][index],
    kind: index === 2 ? 'review' : 'agent_run',
    name,
    agent_profile_id: profiles[index].id,
    instructions: `Führe die Aufgabe der Phase ${index + 1} mit Quellenbezug aus.`,
    entry_conditions: index === 0 ? [] : [{ type: 'run_succeeded' }],
    run_completion_policy: runPolicy,
  }));
}

function transitionsFor(routeLabelId, publishLabelId) {
  return [
    { from_stage_id: 'research', to_stage_id: 'review', on: 'accepted', conditions: [] },
    { from_stage_id: 'review', to_stage_id: 'publish', on: 'accepted', conditions: [], route_label_id: publishLabelId },
    { from_stage_id: 'review', to_stage_id: 'research', on: 'accepted', conditions: [] },
    { from_stage_id: 'review', to_stage_id: 'research', on: 'needs_changes', conditions: [], route_label_id: routeLabelId },
  ];
}

function unlabeledStages() {
  return stageNames.map((name, index) => ({
    id: ['research', 'review', 'publish'][index],
    kind: index === 2 ? 'review' : 'agent_run',
    name,
    agent_profile_id: null,
    instructions: `Phase ${index + 1}`,
    entry_conditions: index === 0 ? [] : [{ type: 'run_succeeded' }],
    run_completion_policy: runPolicy,
  }));
}

function unlabeledTransitions() {
  return [
    { from_stage_id: 'research', to_stage_id: 'review', on: 'accepted', conditions: [] },
    { from_stage_id: 'review', to_stage_id: 'publish', on: 'accepted', conditions: [] },
    { from_stage_id: 'review', to_stage_id: 'research', on: 'needs_changes', conditions: [] },
  ];
}

function diamondStagesFor(profiles) {
  return [
    { id: 'start', kind: 'agent_run', name: 'Start', agent_profile_id: profiles[0].id, instructions: 'Beginne den redaktionellen Auftrag.', entry_conditions: [], run_completion_policy: runPolicy },
    { id: 'automatic', kind: 'agent_run', name: 'Automatische Freigabe', agent_profile_id: profiles[1].id, instructions: 'Prüfe die automatische Freigabe.', entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: runPolicy },
    { id: 'human-review', kind: 'review', name: 'Menschliche Prüfung', agent_profile_id: profiles[1].id, instructions: 'Warte auf die menschliche Prüfung.', entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: { ...runPolicy, require_human_phase_decision: true } },
    { id: 'finish', kind: 'agent_run', name: 'Abschluss', agent_profile_id: profiles[2].id, instructions: 'Schließe den Auftrag ab.', entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: runPolicy },
  ];
}

function diamondTransitionsFor(humanReviewLabelId) {
  return [
    { from_stage_id: 'start', to_stage_id: 'automatic', on: 'accepted', conditions: [] },
    { from_stage_id: 'start', to_stage_id: 'human-review', on: 'accepted', conditions: [], route_label_id: humanReviewLabelId },
    { from_stage_id: 'automatic', to_stage_id: 'finish', on: 'accepted', conditions: [] },
    { from_stage_id: 'human-review', to_stage_id: 'finish', on: 'accepted', conditions: [] },
  ];
}

async function openWorkflow(ownerPage, project, workflow) {
  const projectPicker = ownerPage.getByLabel('Projekt', { exact: true });
  await projectPicker.click();
  await ownerPage.getByRole('option', { name: project.name, exact: true }).click();
  const card = ownerPage.getByTestId(`workflow-card-${workflow.id}`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Graph öffnen', exact: true }).click();
  const editor = ownerPage.getByTestId(`workflow-editor-${workflow.id}`);
  await expect(editor).toBeVisible();
  const graph = editor.getByTestId('workflow-editor-graph');
  await expect(graph).toBeVisible();
  return { editor, graph };
}

function assertBoundsInside(child, parent, description) {
  expect(child.x, `${description}: links`).toBeGreaterThanOrEqual(parent.x - 1);
  expect(child.y, `${description}: oben`).toBeGreaterThanOrEqual(parent.y - 1);
  expect(child.x + child.width, `${description}: rechts`).toBeLessThanOrEqual(parent.x + parent.width + 1);
  expect(child.y + child.height, `${description}: unten`).toBeLessThanOrEqual(parent.y + parent.height + 1);
}

function edgeName(from, to, outcome, routeLabel, returnRoute = false) {
  return `${from} → ${to}, ${outcome}, ${routeLabel}${returnRoute ? ', Rückweg' : ''}`;
}

function assertNoOverlap(bounds, description, soft = false) {
  const assertion = soft ? expect.soft : expect;
  for (let leftIndex = 0; leftIndex < bounds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bounds.length; rightIndex += 1) {
      const left = bounds[leftIndex];
      const right = bounds[rightIndex];
      const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
      const rect = ({ name, x, y, width, height }) => `${name} [x=${x.toFixed(1)}, y=${y.toFixed(1)}, w=${width.toFixed(1)}, h=${height.toFixed(1)}]`;
      assertion(overlapX > 1 && overlapY > 1, `${description}: ${rect(left)} und ${rect(right)} dürfen sich nicht überdecken (Überlappung x=${overlapX.toFixed(1)}, y=${overlapY.toFixed(1)}).`).toBe(false);
    }
  }
}

async function assertPageFits(ownerPage, viewport, description) {
  const documentBounds = await ownerPage.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentBounds.scrollWidth, `${description}: keine horizontale Dokumentüberdehnung`).toBeLessThanOrEqual(documentBounds.clientWidth + 1);
  expect(documentBounds.clientWidth).toBeLessThanOrEqual(viewport.width);
}

async function assertNodes(graph, viewport, description) {
  const nodes = graph.locator('[data-testid^="workflow-graph-stage-"]');
  await expect(nodes).toHaveCount(3);
  const bounds = await nodes.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      name: element.getAttribute('aria-label') ?? element.getAttribute('data-testid') ?? 'Workflowphase',
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }));
  expect(bounds.every((item) => item.width > 120 && item.height > 48), `${description}: alle Phasenknoten haben eine bedienbare Hit-Area.`).toBe(true);
  assertNoOverlap(bounds, description);

  for (const [stageIndex, stageId] of ['research', 'review', 'publish'].entries()) {
    const node = graph.getByTestId(`workflow-graph-stage-${stageId}`);
    await expect(node).toHaveRole('button');
    await expect(node).toHaveAttribute('type', 'button');
    await expect(node).toHaveAccessibleName(`Phase auswählen: ${stageNames[stageIndex]}`);
    await expect(node).toHaveAttribute('title', stageNames[stageIndex]);
    expect(await node.evaluate((element) => element.tabIndex), `${description}: Phase ${stageId} ist per Tab erreichbar.`).toBe(0);
    await node.scrollIntoViewIfNeeded();
    await expect(node).toBeVisible();
    await expect(node).toBeInViewport();
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width, `${description}: Phase ${stageId} ist klickbar.`).toBeGreaterThan(120);
    expect(box.height).toBeGreaterThan(48);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
}

async function assertGraphContentsFitPane(graph, expectedStageCount, expectedRouteCount, description) {
  const pane = graph.getByTestId('workflow-editor-graph-pane');
  let lastSnapshot;
  let previousGeometry = '';
  let stableReads = 0;

  await expect.poll(async () => {
    lastSnapshot = await pane.evaluate((element) => {
      const paneBounds = element.getBoundingClientRect();
      const rectOf = (child) => {
        const bounds = child.getBoundingClientRect();
        const left = bounds.left - paneBounds.left;
        const top = bounds.top - paneBounds.top;
        const right = bounds.right - paneBounds.left;
        const bottom = bounds.bottom - paneBounds.top;

        return {
          id: child.getAttribute('data-testid') ?? child.getAttribute('aria-label') ?? child.className,
          x: left,
          y: top,
          width: bounds.width,
          height: bounds.height,
          withinPane: left >= -2 && top >= -2 && right <= paneBounds.width + 2 && bottom <= paneBounds.height + 2,
        };
      };
      const isRendered = (child) => {
        const style = getComputedStyle(child);
        const bounds = child.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      };
      const nodes = [...element.querySelectorAll('[data-testid^="workflow-graph-stage-"]')].filter(isRendered).map(rectOf);
      const routes = [...element.querySelectorAll('.workflow-graph__edge-label [data-testid^="workflow-graph-transition-"]')].filter(isRendered).map(rectOf);

      return {
        paneWidth: paneBounds.width,
        paneHeight: paneBounds.height,
        nodes,
        routes,
        allWithin: [...nodes, ...routes].every((item) => item.withinPane),
      };
    });

    const geometry = [...lastSnapshot.nodes, ...lastSnapshot.routes]
      .map((item) => `${item.id}:${item.x.toFixed(1)},${item.y.toFixed(1)},${item.width.toFixed(1)},${item.height.toFixed(1)}`)
      .join('|');
    if (lastSnapshot.nodes.length === expectedStageCount
      && lastSnapshot.routes.length === expectedRouteCount
      && lastSnapshot.allWithin
      && geometry === previousGeometry) {
      stableReads += 1;
    } else {
      stableReads = 0;
    }
    previousGeometry = geometry;

    return lastSnapshot.nodes.length === expectedStageCount
      && lastSnapshot.routes.length === expectedRouteCount
      && lastSnapshot.allWithin
      && stableReads >= 1;
  }, { timeout: 10_000, message: `${description}: Graph-Fit muss stabil sein und alle Knoten/Routenlabels in der sichtbaren Pane halten.` }).toBe(true);

  expect(lastSnapshot.paneWidth, `${description}: Pane hat eine messbare Breite.`).toBeGreaterThan(0);
  expect(lastSnapshot.paneHeight, `${description}: Pane hat eine messbare Höhe.`).toBeGreaterThan(0);
  expect(lastSnapshot.nodes, `${description}: alle Phasen bleiben innerhalb der Pane.`).toHaveLength(expectedStageCount);
  expect(lastSnapshot.routes, `${description}: alle gerenderten Routenlabels bleiben innerhalb der Pane.`).toHaveLength(expectedRouteCount);
  for (const item of [...lastSnapshot.nodes, ...lastSnapshot.routes]) {
    expect(item.withinPane, `${description}: ${item.id} liegt vollständig in der Pane (mit 2px Rundungstoleranz).`).toBe(true);
  }
}

async function assertFieldsFit(inspector, fieldNames, viewport, description) {
  const controls = [];
  for (const name of fieldNames) {
    const control = inspector.getByLabel(name, { exact: true });
    await expect(control, `${description}: ${name} ist sichtbar`).toBeVisible();
    controls.push(control);
  }

  const measurement = await inspector.evaluate((element, names) => {
    const inspectorBounds = element.getBoundingClientRect();
    const fields = names.map((name) => {
      const label = [...element.querySelectorAll('label')].find((candidate) => candidate.textContent?.trim() === name);
      const control = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
      if (!label || !control || !element.contains(control)) return { name, missing: true };

      const bounds = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return {
        name,
        missing: false,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0,
        x: bounds.left - inspectorBounds.left,
        y: bounds.top - inspectorBounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    });

    return {
      inspector: { x: 0, y: 0, width: inspectorBounds.width, height: inspectorBounds.height },
      fields,
    };
  }, fieldNames);
  const fields = measurement.fields;
  for (const field of fields) {
    expect(field.missing, `${description}: ${field.name} ist über sein Label mit einem Control im Inspector verknüpft.`).toBe(false);
    expect(field.visible, `${description}: ${field.name} ist sichtbar.`).toBe(true);
    expect(field.width, `${description}: ${field.name} ist bedienbar.`).toBeGreaterThan(80);
  }
  assertNoOverlap(fields, description);

  for (const field of fields) assertBoundsInside(field, measurement.inspector, `${description}: ${field.name} bleibt im Inspector`);

  for (const [index, name] of fieldNames.entries()) {
    const control = controls[index];
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await control.focus();
    await expect(control).toBeFocused();
  }
}

async function assertGraphGridColumns(inspector, expectedColumns, description) {
  const grid = inspector.locator('xpath=../..');
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean));
  expect(columns, description).toHaveLength(expectedColumns);
}

async function selectStage(ownerPage, graph, stageId, expectedName, expectedProfileName, keyboard = false) {
  const node = graph.getByTestId(`workflow-graph-stage-${stageId}`);
  await expect(node).toHaveRole('button');
  await expect(node).toHaveAccessibleName(`Phase auswählen: ${expectedName}`);
  if (keyboard) {
    await node.focus();
    await expect(node).toBeFocused();
    await node.press('Enter');
  } else {
    await node.click();
  }
  const inspector = ownerPage.getByTestId('workflow-stage-inspector');
  await expect(inspector).toBeVisible();
  const number = stageId === 'research' ? 1 : stageId === 'review' ? 2 : 3;
  await expect(inspector.getByLabel(`Name der Phase ${number}`)).toHaveValue(expectedName);
  await expect(inspector.getByLabel(`Agentrolle für Phase ${number}`)).toContainText(expectedProfileName);
  return inspector;
}

async function selectReturnTransition(ownerPage, graph, transitionIndex = 3, keyboard = false) {
  const transition = graph.getByTestId(`workflow-graph-transition-${transitionIndex}`);
  await expect(transition).toHaveRole('button');
  await expect(transition).toHaveAccessibleName(edgeName(stageNames[1], stageNames[0], 'Änderungen nötig', longRouteLabelName, true));
  if (keyboard) {
    await transition.focus();
    await expect(transition).toBeFocused();
    await transition.press('Enter');
  } else {
    await transition.click();
  }
  const inspector = ownerPage.getByTestId('workflow-transition-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel('Von Phase')).toContainText(stageNames[1]);
  await expect(inspector.getByLabel('Ergebnis')).toContainText('Änderungen nötig');
  await expect(inspector.getByLabel('Zu Phase')).toContainText(stageNames[0]);
  await expect(inspector.getByLabel('Label für diesen Übergang')).toContainText(longRouteLabelName);
  return inspector;
}

async function assertReturnEdgeHitAreas(graph) {
  const standard = graph.getByTestId('workflow-graph-transition-2');
  const labelled = graph.getByTestId('workflow-graph-transition-3');
  await expect(standard).toHaveAccessibleName(edgeName(stageNames[1], stageNames[0], 'Angenommen', 'Standardroute', true));
  await expect(labelled).toHaveAccessibleName(edgeName(stageNames[1], stageNames[0], 'Änderungen nötig', longRouteLabelName, true));
  const standardBounds = await standard.boundingBox();
  const labelledBounds = await labelled.boundingBox();
  expect(standardBounds, 'Die Standardroute hat eine eigene klickbare Hit-Area.').not.toBeNull();
  expect(labelledBounds, 'Die gelabelte Rückroute hat eine eigene klickbare Hit-Area.').not.toBeNull();
  expect(standardBounds.width).toBeGreaterThan(80);
  expect(labelledBounds.width).toBeGreaterThan(80);
  assertNoOverlap([
    { name: 'Standardroute zur Recherche', ...standardBounds },
    { name: 'Gelabelte Rückroute zur Recherche', ...labelledBounds },
  ], 'Gleichpaarige Rückkanten auf breitem Desktop');
}

test('workflow graph stays selectable, readable and within bounds across desktop, tablet and mobile viewports', async ({ ownerApi, ownerPage, baseURL, qaMocks }, testInfo) => {
  test.setTimeout(300_000);
  await qaMocks.setT3Scenario('default');
  const suffix = randomUUID().slice(0, 8);
  const projectName = `Morgenblatt Projekt zur Layoutprüfung mit langem Namen ${suffix}`;
  const { project, connection } = await createBoundProject(ownerApi, ownerPage, baseURL, qaMocks, projectName);
  const profiles = await Promise.all(profileNames.map((name, index) => createProfile(ownerApi, project, connection, `${name} ${suffix}`, profileRoles[index])));
  const routeLabel = await ownerApi.createLabel(project.id, {
    name: longRouteLabelName,
    key: `graph-return-${suffix}`,
    color: '#7A5AB8',
    kind: 'topic',
  });
  const publishLabel = await ownerApi.createLabel(project.id, {
    name: `Zur Veröffentlichung freigegeben ${suffix}`,
    key: `graph-publish-${suffix}`,
    color: '#198754',
    kind: 'topic',
  });
  const humanReviewLabel = await ownerApi.createLabel(project.id, {
    name: `Menschliche Prüfung ${suffix}`,
    key: `graph-human-review-${suffix}`,
    color: '#3157B7',
    kind: 'topic',
  });
  const stages = stagesFor(profiles);
  const transitions = transitionsFor(routeLabel.id, publishLabel.id);
  const workflow = await createWorkflow(ownerApi, project.id, `${longWorkflowName} ${suffix}`, stages, transitions);
  expect(workflow.stages.map((stage) => stage.agent_profile_id)).toEqual(profiles.map((profile) => profile.id));
  expect(workflow.transitions[2]).toMatchObject({ from_stage_id: 'review', to_stage_id: 'research', on: 'accepted' });
  expect(workflow.transitions[3]).toMatchObject({ from_stage_id: 'review', to_stage_id: 'research', on: 'needs_changes', route_label_id: routeLabel.id });
  const diamondStages = diamondStagesFor(profiles);
  const diamondTransitions = diamondTransitionsFor(humanReviewLabel.id);
  const diamondWorkflow = await createWorkflow(ownerApi, project.id, `Redaktioneller Freigabediamant ${suffix}`, diamondStages, diamondTransitions);
  const savedDiamond = await ownerApi.get(`/workflows/${diamondWorkflow.id}`);
  expect(savedDiamond.response.status(), JSON.stringify(savedDiamond.data)).toBe(200);
  expect(savedDiamond.data.stages.map((stage) => ({
    id: stage.id,
    kind: stage.kind,
    name: stage.name,
    agent_profile_id: stage.agent_profile_id,
    instructions: stage.instructions,
    entry_conditions: stage.entry_conditions,
    run_completion_policy: stage.run_completion_policy,
  }))).toEqual(diamondStages.map((stage) => ({
    id: stage.id,
    kind: stage.kind,
    name: stage.name,
    agent_profile_id: stage.agent_profile_id,
    instructions: stage.instructions,
    entry_conditions: stage.entry_conditions,
    run_completion_policy: stage.run_completion_policy,
  })));
  expect(savedDiamond.data.transitions.map((transition) => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.on,
    conditions: transition.conditions,
    route_label_id: transition.route_label_id ?? null,
  }))).toEqual(diamondTransitions.map((transition) => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.on,
    conditions: transition.conditions,
    route_label_id: transition.route_label_id ?? null,
  })));

  const noLabelProject = await ownerApi.createProject({ name: `Morgenblatt Projekt ohne aktive Themenlabels ${suffix}` });
  await ownerApi.ensureDefaultBoard(noLabelProject.id);
  const noLabelCollection = await ownerApi.get(`/projects/${noLabelProject.id}/labels`);
  expect(noLabelCollection.response.status(), JSON.stringify(noLabelCollection.data)).toBe(200);
  expect(noLabelCollection.data.items.filter((label) => label.active && label.kind === 'topic')).toHaveLength(0);
  const noLabelWorkflow = await createWorkflow(ownerApi, noLabelProject.id, `Unbeschriftete Phasenansicht ${suffix}`, unlabeledStages(), unlabeledTransitions());

  await ownerPage.goto('/#/workflows');
  await expect(ownerPage.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  const lightModeAction = ownerPage.getByRole('button', { name: 'Hellmodus aktivieren', exact: true });
  if (await lightModeAction.count()) await lightModeAction.click();
  await expect(ownerPage.getByRole('button', { name: 'Dunkelmodus aktivieren', exact: true })).toBeVisible();
  await expect.poll(() => ownerPage.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
  const { editor, graph } = await openWorkflow(ownerPage, project, workflow);
  await expect(editor.getByLabel('Workflowname')).toHaveValue(workflow.name);

  const viewports = [
    { width: 1588, height: 850, name: 'Desktop' },
    { width: 1024, height: 850, name: 'Mittlere Breite' },
    { width: 390, height: 844, name: 'Mobil' },
  ];
  for (const viewport of viewports) {
    await ownerPage.setViewportSize(viewport);
    await assertPageFits(ownerPage, viewport, viewport.name);
    await graph.scrollIntoViewIfNeeded();
    const graphBox = await graph.boundingBox();
    expect(graphBox).not.toBeNull();
    expect(graphBox.width, `${viewport.name}: der Graph bleibt sichtbar`).toBeGreaterThan(180);
    expect(graphBox.x).toBeGreaterThanOrEqual(-1);
    expect(graphBox.x + graphBox.width).toBeLessThanOrEqual(viewport.width + 1);
    await assertGraphContentsFitPane(graph, 3, 4, `${viewport.name} Ausgangsansicht`);
    await assertNodes(graph, viewport, viewport.name);
    const stageInspector = await selectStage(ownerPage, graph, 'research', stageNames[0], profiles[0].name, viewport.width < 1280);
    if (viewport.width < 1280) {
      const stageHeading = stageInspector.getByTestId('workflow-inspector-heading');
      await expect(stageHeading).toBeFocused();
      await expect(stageHeading).toBeInViewport();
    }
    await assertGraphContentsFitPane(graph, 3, 4, `${viewport.name} Phaseninspector`);
    await assertGraphGridColumns(stageInspector, viewport.width >= 1536 ? 2 : 1, `${viewport.name}: Canvas und Phaseninspector verwenden nur verfügbare Spalten.`);
    await assertFieldsFit(stageInspector, [
      'Name der Phase 1',
      'Art der Phase',
      'Agentrolle für Phase 1',
      'Boardspalte bei Phasenstart für Phase 1',
      'Auftrag für diese Phase',
    ], viewport, `${viewport.name}-Phaseninspector`);

    if (viewport.width === 1588) {
      await assertReturnEdgeHitAreas(graph);
      const standardReturn = graph.getByTestId('workflow-graph-transition-2');
      await standardReturn.click();
      const standardInspector = ownerPage.getByTestId('workflow-transition-inspector');
      await expect(standardInspector).toBeVisible();
      await expect(standardInspector.getByLabel('Von Phase')).toContainText(stageNames[1]);
      await expect(standardInspector.getByLabel('Ergebnis')).toContainText('Angenommen');
      await expect(standardInspector.getByLabel('Zu Phase')).toContainText(stageNames[0]);
      await expect(standardInspector.getByLabel('Label für diesen Übergang')).toContainText('Standardroute');
      await assertGraphContentsFitPane(graph, 3, 4, 'Desktop Standardrouteninspector');
      await assertFieldsFit(standardInspector, ['Von Phase', 'Ergebnis', 'Zu Phase', 'Label für diesen Übergang'], viewport, 'Desktop-Standardrückroute');
      const transitionInspector = await selectReturnTransition(ownerPage, graph, 3, false);
      await assertGraphContentsFitPane(graph, 3, 4, 'Desktop gelabelter Übergangsinspector');
      await assertGraphGridColumns(transitionInspector, 2, 'Der Rückweg öffnet dieselbe Canvas-/Inspector-Aufteilung.');
      await assertFieldsFit(transitionInspector, ['Von Phase', 'Ergebnis', 'Zu Phase', 'Label für diesen Übergang'], viewport, 'Desktop-Rückroute');
      const routeLabelControl = transitionInspector.getByLabel('Label für diesen Übergang', { exact: true });
      await routeLabelControl.click();
      await expect(ownerPage.getByRole('option', { name: longRouteLabelName, exact: true })).toBeVisible();
      await ownerPage.keyboard.press('Escape');
      await testInfo.attach('workflow-graph-desktop-light', { body: await ownerPage.screenshot({ fullPage: true }), contentType: 'image/png' });

      const darkMode = ownerPage.getByRole('button', { name: 'Dunkelmodus aktivieren', exact: true });
      await expect(darkMode).toBeVisible();
      await darkMode.click();
      await expect(ownerPage.getByRole('button', { name: 'Hellmodus aktivieren', exact: true })).toBeVisible();
      await expect.poll(() => ownerPage.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
      await assertPageFits(ownerPage, viewport, 'Dunkles Desktop-Theme');
      const darkInspector = await selectReturnTransition(ownerPage, graph, 3, true);
      await assertGraphContentsFitPane(graph, 3, 4, 'Dunkler Desktop Übergangsinspector');
      await assertFieldsFit(darkInspector, ['Von Phase', 'Ergebnis', 'Zu Phase', 'Label für diesen Übergang'], viewport, 'Dunkle Desktop-Rückroute');
      await testInfo.attach('workflow-graph-desktop-dark', { body: await ownerPage.screenshot({ fullPage: true }), contentType: 'image/png' });
      await darkInspector.getByRole('button', { name: 'Details schließen', exact: true }).click();
      await expect(darkInspector).toHaveCount(0);
    } else {
      const transitionInspector = await selectReturnTransition(ownerPage, graph, 3, true);
      const inspectorHeading = transitionInspector.getByTestId('workflow-inspector-heading');
      await expect(inspectorHeading).toBeFocused();
      await expect(inspectorHeading).toBeInViewport();
      await assertGraphContentsFitPane(graph, 3, 4, `${viewport.name} Übergangsinspector`);
      await assertGraphGridColumns(transitionInspector, 1, `${viewport.name}: Canvas und Inspector stehen in einer Spalte.`);
      await assertFieldsFit(transitionInspector, ['Von Phase', 'Ergebnis', 'Zu Phase', 'Label für diesen Übergang'], viewport, `${viewport.name}-Rückroute`);
      await testInfo.attach(`workflow-graph-${viewport.width}`, { body: await ownerPage.screenshot({ fullPage: true }), contentType: 'image/png' });
      await transitionInspector.getByRole('button', { name: 'Details schließen', exact: true }).click();
      await expect(transitionInspector).toHaveCount(0);
      if (viewport.width === 390) {
        const returnedFocus = graph.getByTestId('workflow-graph-stage-research');
        await expect(returnedFocus).toBeFocused();
        await expect(returnedFocus).toBeInViewport();
      }
    }
  }

  await ownerPage.getByRole('button', { name: 'Zurück zu Vorlagen', exact: true }).click();
  await ownerPage.setViewportSize({ width: 1588, height: 850 });
  const enableLightMode = ownerPage.getByRole('button', { name: 'Hellmodus aktivieren', exact: true });
  if (await enableLightMode.count()) await enableLightMode.click();
  await expect(ownerPage.getByRole('button', { name: 'Dunkelmodus aktivieren', exact: true })).toBeVisible();
  const diamondView = await openWorkflow(ownerPage, project, savedDiamond.data);
  const diamondGraph = diamondView.graph;
  await assertPageFits(ownerPage, { width: 1588, height: 850 }, 'Vier-Phasen-Diamant');
  await assertGraphContentsFitPane(diamondGraph, 4, 4, 'Vier-Phasen-Diamant Ausgangsansicht');
  await expect(diamondGraph.locator('[data-testid^="workflow-graph-stage-"]')).toHaveCount(4);
  const diamondGraphBox = await diamondGraph.boundingBox();
  expect(diamondGraphBox).not.toBeNull();
  expect(diamondGraphBox.width, 'Der breite Graph muss die beiden Freigabewege nebeneinander zeichnen.').toBeGreaterThan(600);
  const diamondNodes = await Promise.all(['start', 'automatic', 'human-review', 'finish'].map(async (id) => {
    const locator = diamondGraph.getByTestId(`workflow-graph-stage-${id}`);
    const box = await locator.boundingBox();
    expect(box, `Die Phase ${id} muss im Graph liegen.`).not.toBeNull();
    await expect(locator).toBeVisible();
    return { id, ...box };
  }));
  const diamondNode = (id) => diamondNodes.find((node) => node.id === id);
  const startBounds = diamondNode('start');
  const automaticBounds = diamondNode('automatic');
  const humanBounds = diamondNode('human-review');
  const finishBounds = diamondNode('finish');
  expect(Math.abs(automaticBounds.x - humanBounds.x), 'Gleichrangige Freigabephasen liegen auf derselben Spalte.').toBeLessThan(4);
  expect(Math.abs(automaticBounds.y - humanBounds.y), 'Automatische und menschliche Prüfung liegen in getrennten Bahnen.').toBeGreaterThan(150);
  expect(startBounds.x + startBounds.width / 2).toBeLessThan(automaticBounds.x + automaticBounds.width / 2);
  expect(finishBounds.x + finishBounds.width / 2).toBeGreaterThan(automaticBounds.x + automaticBounds.width / 2);
  assertNoOverlap([automaticBounds, humanBounds], 'Die beiden Folgephasen des Freigabediamanten');
  await expect(diamondGraph.getByTestId('workflow-graph-transition-0')).toHaveAccessibleName(edgeName('Start', 'Automatische Freigabe', 'Angenommen', 'Standardroute'));
  await expect(diamondGraph.getByTestId('workflow-graph-transition-1')).toHaveAccessibleName(edgeName('Start', 'Menschliche Prüfung', 'Angenommen', humanReviewLabel.name));
  await testInfo.attach('workflow-graph-four-phase-diamond', { body: await ownerPage.screenshot({ fullPage: true }), contentType: 'image/png' });

  const diamondRoutes = [
    { index: 0, from: 'Start', to: 'Automatische Freigabe', label: 'Standardroute' },
    { index: 1, from: 'Start', to: 'Menschliche Prüfung', label: humanReviewLabel.name },
    { index: 2, from: 'Automatische Freigabe', to: 'Abschluss', label: 'Standardroute' },
    { index: 3, from: 'Menschliche Prüfung', to: 'Abschluss', label: 'Standardroute' },
  ];
  for (const route of diamondRoutes) {
    const edge = diamondGraph.getByTestId(`workflow-graph-transition-${route.index}`);
    await expect(edge).toHaveAccessibleName(edgeName(route.from, route.to, 'Angenommen', route.label));
    const hitArea = await edge.boundingBox();
    expect(hitArea, `Route ${route.from} nach ${route.to} muss klickbar sein.`).not.toBeNull();
    expect(hitArea.width).toBeGreaterThan(80);
    await edge.click();
    const inspector = ownerPage.getByTestId('workflow-transition-inspector');
    await expect(inspector).toBeVisible();
    await assertGraphContentsFitPane(diamondGraph, 4, 4, `Diamantinspector ${route.from} nach ${route.to}`);
    await expect(inspector.getByLabel('Von Phase')).toContainText(route.from);
    await expect(inspector.getByLabel('Ergebnis')).toContainText('Angenommen');
    await expect(inspector.getByLabel('Zu Phase')).toContainText(route.to);
    if (route.label === 'Standardroute') await expect(inspector.getByLabel('Label für diesen Übergang')).toContainText('Standardroute');
    else await expect(inspector.getByLabel('Label für diesen Übergang')).toContainText(route.label);
  }
  await ownerPage.getByRole('button', { name: 'Zurück zu Vorlagen', exact: true }).click();

  const noLabelGraph = await openWorkflow(ownerPage, noLabelProject, noLabelWorkflow);
  await ownerPage.setViewportSize({ width: 1588, height: 850 });
  const unlabelledReturn = noLabelGraph.graph.getByTestId('workflow-graph-transition-2');
  await expect(unlabelledReturn).toHaveAccessibleName(edgeName(stageNames[1], stageNames[0], 'Änderungen nötig', 'Standardroute', true));
  await unlabelledReturn.click();
  const noLabelInspector = ownerPage.getByTestId('workflow-transition-inspector');
  await expect(noLabelInspector).toBeVisible();
  await expect(noLabelInspector.getByLabel('Von Phase')).toContainText(stageNames[1]);
  await expect(noLabelInspector.getByLabel('Ergebnis')).toContainText('Änderungen nötig');
  await expect(noLabelInspector.getByLabel('Zu Phase')).toContainText(stageNames[0]);
  await expect(noLabelInspector.getByLabel('Label für diesen Übergang')).toHaveCount(0);
  await assertGraphGridColumns(noLabelInspector, 2, 'Ohne Themenlabels reserviert das Layout nur Canvas und Inspector.');
  await assertFieldsFit(noLabelInspector, ['Von Phase', 'Ergebnis', 'Zu Phase'], { width: 1588, height: 850 }, 'Rückroute ohne Themenlabels');

  const connectButton = noLabelGraph.graph.getByTestId('workflow-graph-connect-mode');
  await connectButton.click();
  await expect(connectButton).toHaveAttribute('aria-pressed', 'true');
  const sourceNode = noLabelGraph.graph.getByTestId('workflow-graph-stage-research');
  await expect(sourceNode).toHaveAccessibleName(`Ausgangsphase wählen: ${stageNames[0]}`);
  await sourceNode.focus();
  await sourceNode.press('Enter');
  await expect(sourceNode).toHaveAccessibleName(`Ausgangsphase ausgewählt: ${stageNames[0]}`);
  const targetNode = noLabelGraph.graph.getByTestId('workflow-graph-stage-publish');
  await expect(targetNode).toHaveAccessibleName(`Zielphase wählen: ${stageNames[2]}`);
  await targetNode.focus();
  await targetNode.press('Enter');
  await expect(connectButton).toHaveAttribute('aria-pressed', 'false');

  const connectedInspector = ownerPage.getByTestId('workflow-transition-inspector');
  await expect(connectedInspector).toBeVisible();
  await assertGraphContentsFitPane(noLabelGraph.graph, 3, 4, 'Per Canvas verbundener Workflow mit geöffnetem Inspector');
  await expect(connectedInspector.getByLabel('Von Phase')).toContainText(stageNames[0]);
  await expect(connectedInspector.getByLabel('Ergebnis')).toContainText('Änderungen nötig');
  await expect(connectedInspector.getByLabel('Zu Phase')).toContainText(stageNames[2]);
  await expect(connectedInspector.getByLabel('Label für diesen Übergang')).toHaveCount(0);

  const beforeGraphSave = await ownerApi.get(`/workflows/${noLabelWorkflow.id}`);
  expect(beforeGraphSave.response.status(), JSON.stringify(beforeGraphSave.data)).toBe(200);
  const invalidSaveResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith(`/workflows/${noLabelWorkflow.id}`));
  await noLabelGraph.editor.getByRole('button', { name: 'Workflowversion speichern', exact: true }).click();
  const invalidSaveResponse = await invalidSaveResponsePromise;
  expect(invalidSaveResponse.status()).toBe(422);
  expect(invalidSaveResponse.request().headers()['if-match']).toBe(`"${beforeGraphSave.data.version}"`);
  expect(invalidSaveResponse.request().postDataJSON().transitions.at(-1)).toMatchObject({
    from_stage_id: 'research',
    to_stage_id: 'publish',
    on: 'needs_changes',
  });
  const invalidSaveProblem = await invalidSaveResponse.json();
  expect(invalidSaveProblem.code).toBe('workflow_condition_future_stage');
  const invalidSaveDetail = 'Die Bedingung „run_succeeded“ kann vor dem Start der Phase „publish“ nur durch ein späteres Phasenergebnis erfüllt werden.';
  expect(invalidSaveProblem.detail).toBe(invalidSaveDetail);
  await expect(noLabelGraph.editor.getByRole('alert').filter({ hasText: invalidSaveDetail })).toHaveText(invalidSaveDetail);

  await noLabelGraph.editor.getByTestId(`workflow-${noLabelWorkflow.id}-transition-${noLabelWorkflow.transitions.length}-remove`).click();
  await expect(noLabelGraph.editor.getByRole('alert').filter({ hasText: invalidSaveDetail })).toHaveCount(0);

  await connectButton.click();
  const validSourceNode = noLabelGraph.graph.getByTestId('workflow-graph-stage-review');
  await expect(validSourceNode).toHaveAccessibleName(`Ausgangsphase wählen: ${stageNames[1]}`);
  await validSourceNode.focus();
  await validSourceNode.press('Enter');
  await expect(validSourceNode).toHaveAccessibleName(`Ausgangsphase ausgewählt: ${stageNames[1]}`);
  const validTargetNode = noLabelGraph.graph.getByTestId('workflow-graph-stage-research');
  await expect(validTargetNode).toHaveAccessibleName(`Zielphase wählen: ${stageNames[0]}`);
  await validTargetNode.focus();
  await validTargetNode.press('Enter');
  await expect(connectButton).toHaveAttribute('aria-pressed', 'false');

  const validConnectedInspector = ownerPage.getByTestId('workflow-transition-inspector');
  await expect(validConnectedInspector.getByLabel('Von Phase')).toContainText(stageNames[1]);
  await expect(validConnectedInspector.getByLabel('Ergebnis')).toContainText('Blockiert');
  await expect(validConnectedInspector.getByLabel('Zu Phase')).toContainText(stageNames[0]);
  await expect(validConnectedInspector.getByLabel('Label für diesen Übergang')).toHaveCount(0);
  await expect(noLabelGraph.editor.getByRole('alert')).toHaveCount(0);

  const saveResponsePromise = ownerPage.waitForResponse((response) => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith(`/workflows/${noLabelWorkflow.id}`));
  await noLabelGraph.editor.getByRole('button', { name: 'Workflowversion speichern', exact: true }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);
  expect(saveResponse.request().headers()['if-match']).toBe(`"${beforeGraphSave.data.version}"`);
  await expect(noLabelGraph.editor).toHaveCount(0);

  const savedGraphWorkflow = await ownerApi.get(`/workflows/${noLabelWorkflow.id}`);
  expect(savedGraphWorkflow.response.status(), JSON.stringify(savedGraphWorkflow.data)).toBe(200);
  expect(savedGraphWorkflow.data.definition_version).toBe(noLabelWorkflow.definition_version + 1);
  expect(savedGraphWorkflow.data.transitions).toHaveLength(noLabelWorkflow.transitions.length + 1);
  for (const transition of noLabelWorkflow.transitions) {
    expect(savedGraphWorkflow.data.transitions).toContainEqual(expect.objectContaining(transition));
  }
  const graphCreatedTransitionIndex = savedGraphWorkflow.data.transitions.findIndex((transition) => transition.from_stage_id === 'research'
    && transition.to_stage_id === 'publish'
    && transition.on === 'needs_changes');
  const validGraphCreatedTransitionIndex = savedGraphWorkflow.data.transitions.findIndex((transition) => transition.from_stage_id === 'review'
    && transition.to_stage_id === 'research'
    && transition.on === 'blocked');
  expect(graphCreatedTransitionIndex).toBe(-1);
  expect(validGraphCreatedTransitionIndex).toBe(noLabelWorkflow.transitions.length);

  const reopenedGraph = await openWorkflow(ownerPage, noLabelProject, savedGraphWorkflow.data);
  const reopenedEdge = reopenedGraph.graph.getByTestId(`workflow-graph-transition-${validGraphCreatedTransitionIndex}`);
  await expect(reopenedEdge).toHaveAccessibleName(edgeName(stageNames[1], stageNames[0], 'Blockiert', 'Standardroute', true));
  await reopenedEdge.click();
  const reopenedInspector = ownerPage.getByTestId('workflow-transition-inspector');
  await expect(reopenedInspector).toBeVisible();
  await assertGraphContentsFitPane(reopenedGraph.graph, 3, 4, 'Gespeicherte Canvas-Verbindung nach erneutem Öffnen');
  await expect(reopenedInspector.getByLabel('Von Phase')).toContainText(stageNames[1]);
  await expect(reopenedInspector.getByLabel('Ergebnis')).toContainText('Blockiert');
  await expect(reopenedInspector.getByLabel('Zu Phase')).toContainText(stageNames[0]);
  await expect(reopenedInspector.getByLabel('Label für diesen Übergang')).toHaveCount(0);

  const t3 = await qaMocks.t3Journal();
  expect(t3.accepted_launches).toHaveLength(0);
  recordEvidence(
    'Der Workflowgraph bleibt mit langen Phasen- und Labelnamen auf Desktop, mittlerer Breite und Mobilgeräten bedienbar.',
    `Ein versionierter Drei-Phasen-Workflow mit drei verschiedenen Agentrollen und gelabelten Routen wurde aus der öffentlichen API im Graph geöffnet. Knoten und Rückkanten ließen sich mit Maus und Tastatur auswählen; Phasen- und Übergangscontrols hatten messbare, nicht überlappende DOM-Hit-Areas. Die Checks liefen bei 1588×850, 1024×850 und 390×844 im hellen und dunklen Theme. In einem zweiten Projekt ohne aktive Themenlabels lehnte die API eine unmögliche needs_changes-Route zu einer Phase mit run_succeeded-Startregel mit HTTP 422 ab; die konkrete Bedingung erschien im Formular. Nach Entfernen dieses ungültigen Weges wurde per Tastatur eine gültige Blockiert-Route zurück zur Phase ohne Startregel angelegt, gespeichert und nach erneutem Öffnen wiedergefunden; die bisherigen Routen blieben erhalten. Der T3-Mock hat keinen Lauf angenommen.`,
    { t3 },
  );
});

test('workflow graph keeps ten dense routes selectable through pointer and keyboard', async ({ ownerApi, ownerPage }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8);
  const project = await ownerApi.createProject({ name: `Dense Graph QA ${suffix}` });
  await ownerApi.ensureDefaultBoard(project.id);
  const alternativeLabel = await ownerApi.createLabel(project.id, {
    name: `Alternative ${suffix}`,
    key: `dense-alt-${suffix}`,
    color: '#5277B8',
    kind: 'topic',
  });
  const riskLabel = await ownerApi.createLabel(project.id, {
    name: `Risiko ${suffix}`,
    key: `dense-risk-${suffix}`,
    color: '#B85A52',
    kind: 'topic',
  });
  const stages = [
    { id: 'phase-1', kind: 'agent_run', name: 'Start', agent_profile_id: null, instructions: 'QA-Startphase.', entry_conditions: [], run_completion_policy: runPolicy },
    { id: 'phase-2', kind: 'agent_run', name: 'Bearbeitung', agent_profile_id: null, instructions: 'QA-Bearbeitungsphase.', entry_conditions: [], run_completion_policy: runPolicy },
    { id: 'phase-3', kind: 'agent_run', name: 'Prüfung', agent_profile_id: null, instructions: 'QA-Prüfphase.', entry_conditions: [], run_completion_policy: runPolicy },
    { id: 'phase-4', kind: 'review', name: 'Abschluss', agent_profile_id: null, instructions: 'QA-Abschlussphase.', entry_conditions: [], run_completion_policy: runPolicy },
  ];
  const transitions = [
    { from_stage_id: 'phase-1', to_stage_id: 'phase-2', on: 'accepted', conditions: [] },
    { from_stage_id: 'phase-1', to_stage_id: 'phase-3', on: 'accepted', conditions: [], route_label_id: alternativeLabel.id },
    { from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'accepted', conditions: [] },
    { from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'accepted', conditions: [], route_label_id: riskLabel.id },
    { from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'blocked', conditions: [] },
    { from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'failed', conditions: [] },
    { from_stage_id: 'phase-2', to_stage_id: 'phase-3', on: 'needs_changes', conditions: [] },
    { from_stage_id: 'phase-3', to_stage_id: 'phase-4', on: 'accepted', conditions: [] },
    { from_stage_id: 'phase-3', to_stage_id: 'phase-2', on: 'needs_changes', conditions: [] },
    { from_stage_id: 'phase-4', to_stage_id: 'phase-2', on: 'needs_changes', conditions: [] },
  ];
  const created = await ownerApi.post('/workflows', {
    project_id: project.id,
    name: `Dense route graph ${suffix}`,
    preset_id: 'manual',
    stages,
    transitions,
    limits: { max_repair_rounds: 1, max_depth: 6, max_parallel_runs: 1, max_total_seconds: 3600 },
    enabled: true,
  });
  expect(created.response.status(), JSON.stringify(created.data)).toBe(201);
  const workflow = created.data.workflow ?? created.data;
  const storedWorkflow = await ownerApi.get(`/workflows/${workflow.id}`);
  expect(storedWorkflow.response.status(), JSON.stringify(storedWorkflow.data)).toBe(200);
  expect(storedWorkflow.data.stages.map((stage) => stage.id)).toEqual(stages.map((stage) => stage.id));
  expect(storedWorkflow.data.transitions).toHaveLength(10);
  const normalizedTransitions = storedWorkflow.data.transitions.map((transition) => ({
    ...transition,
    route_label_id: transition.route_label_id ?? null,
  }));
  expect(normalizedTransitions.slice(2, 6)).toEqual([
    expect.objectContaining({ from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'accepted', route_label_id: null }),
    expect.objectContaining({ from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'accepted', route_label_id: riskLabel.id }),
    expect.objectContaining({ from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'blocked', route_label_id: null }),
    expect.objectContaining({ from_stage_id: 'phase-2', to_stage_id: 'phase-4', on: 'failed', route_label_id: null }),
  ]);

  const routes = [
    { index: 0, from: 'Start', to: 'Bearbeitung', outcome: 'Angenommen', label: 'Standardroute' },
    { index: 1, from: 'Start', to: 'Prüfung', outcome: 'Angenommen', label: alternativeLabel.name },
    { index: 2, from: 'Bearbeitung', to: 'Abschluss', outcome: 'Angenommen', label: 'Standardroute', bundle: true },
    { index: 3, from: 'Bearbeitung', to: 'Abschluss', outcome: 'Angenommen', label: riskLabel.name, bundle: true },
    { index: 4, from: 'Bearbeitung', to: 'Abschluss', outcome: 'Blockiert', label: 'Standardroute', bundle: true },
    { index: 5, from: 'Bearbeitung', to: 'Abschluss', outcome: 'Fehlgeschlagen', label: 'Standardroute', bundle: true },
    { index: 6, from: 'Bearbeitung', to: 'Prüfung', outcome: 'Änderungen nötig', label: 'Standardroute' },
    { index: 7, from: 'Prüfung', to: 'Abschluss', outcome: 'Angenommen', label: 'Standardroute' },
    { index: 8, from: 'Prüfung', to: 'Bearbeitung', outcome: 'Änderungen nötig', label: 'Standardroute', returnRoute: true },
    { index: 9, from: 'Abschluss', to: 'Bearbeitung', outcome: 'Änderungen nötig', label: 'Standardroute', returnRoute: true },
  ];
  const bundleTestId = 'workflow-graph-route-bundle-1-3';
  const bundle = ownerPage.getByTestId(bundleTestId);
  const inspector = ownerPage.getByTestId('workflow-transition-inspector');

  const assertDenseGraphFitsPane = async (graph, description) => {
    const pane = graph.getByTestId('workflow-editor-graph-pane');
    let snapshot;
    let previousGeometry = '';
    let stableReads = 0;
    await expect.poll(async () => {
      snapshot = await pane.evaluate((element) => {
        const paneBounds = element.getBoundingClientRect();
        const measure = (child) => {
          const bounds = child.getBoundingClientRect();
          const x = bounds.left - paneBounds.left;
          const y = bounds.top - paneBounds.top;
          return {
            name: child.getAttribute('aria-label') ?? child.getAttribute('data-testid') ?? 'Graph control',
            x,
            y,
            width: bounds.width,
            height: bounds.height,
            withinPane: x >= -2 && y >= -2 && bounds.right - paneBounds.left <= paneBounds.width + 2 && bounds.bottom - paneBounds.top <= paneBounds.height + 2,
          };
        };
        const visible = (child) => {
          const style = getComputedStyle(child);
          const bounds = child.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
        };
        const nodes = [...element.querySelectorAll('[data-testid^="workflow-graph-stage-"]')].filter(visible).map(measure);
        const routeSelector = '.workflow-graph__edge-label [data-testid^="workflow-graph-transition-"], .workflow-graph__edge-label [data-testid^="workflow-graph-route-bundle-"]';
        const routeControls = [...element.querySelectorAll(routeSelector)].filter(visible).map(measure);
        return { pane: { width: paneBounds.width, height: paneBounds.height }, nodes, routeControls };
      });
      const geometry = [...snapshot.nodes, ...snapshot.routeControls]
        .map((item) => `${item.name}:${item.x.toFixed(1)},${item.y.toFixed(1)},${item.width.toFixed(1)},${item.height.toFixed(1)}`)
        .join('|');
      stableReads = snapshot.nodes.length === 4 && snapshot.routeControls.length === 7 && geometry === previousGeometry ? stableReads + 1 : 0;
      previousGeometry = geometry;
      return snapshot.pane.width > 0 && snapshot.pane.height > 0
        && snapshot.nodes.length === 4
        && snapshot.routeControls.length === 7
        && [...snapshot.nodes, ...snapshot.routeControls].every((item) => item.withinPane)
        && stableReads >= 1;
    }, { timeout: 10_000, message: `${description}: vier Phasen und sieben sichtbare Routecontrols müssen stabil in der Graphpane liegen.` }).toBe(true);

    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.routeControls).toHaveLength(7);
    expect([...snapshot.nodes, ...snapshot.routeControls].every((item) => item.withinPane), `${description}: alle Controls liegen vollständig in der Graphpane.`).toBe(true);
    assertNoOverlap([...snapshot.nodes, ...snapshot.routeControls], `${description}: Phasen, direkte Routen und Bündelwahl überdecken sich nicht`, true);
  };

  const assertSelectedRoute = async (route, viewport, description) => {
    await expect(inspector).toBeVisible();
    await expect(inspector.getByLabel('Von Phase')).toContainText(route.from);
    await expect(inspector.getByLabel('Ergebnis')).toContainText(route.outcome);
    await expect(inspector.getByLabel('Zu Phase')).toContainText(route.to);
    await expect(inspector.getByLabel('Label für diesen Übergang')).toContainText(route.label);
    if (viewport.width >= 1536) {
      await assertGraphGridColumns(inspector, 2, `${description}: Desktop-Canvas und Inspector bleiben nebeneinander.`);
      await assertFieldsFit(inspector, ['Von Phase', 'Ergebnis', 'Zu Phase', 'Label für diesen Übergang'], viewport, description);
    } else {
      const heading = inspector.getByTestId('workflow-inspector-heading');
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      await assertGraphGridColumns(inspector, 1, `${description}: Mobil stehen Graph und Inspector untereinander.`);
    }
    const paneBounds = await ownerPage.getByTestId('workflow-editor-graph-pane').boundingBox();
    const inspectorBounds = await inspector.boundingBox();
    expect(paneBounds).not.toBeNull();
    expect(inspectorBounds).not.toBeNull();
    assertNoOverlap([
      { name: 'Graphpane', ...paneBounds },
      { name: 'Übergangsinspector', ...inspectorBounds },
    ], `${description}: Inspector und Graphpane überdecken sich nicht`);
  };

  const assertMobileGraphPanelAndInspectorStack = async (description) => {
    let snapshot;
    let previousGeometry = '';
    let stableReads = 0;
    await expect.poll(async () => {
      snapshot = await ownerPage.evaluate(() => {
        const graph = document.querySelector('[data-testid="workflow-editor-graph"]');
        const graphPanel = graph?.parentElement;
        const inspector = document.querySelector('[data-testid="workflow-transition-inspector"]');
        const measure = (element) => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          };
        };
        return { graph: measure(graphPanel), inspector: measure(inspector) };
      });
      if (!snapshot.graph || !snapshot.inspector || !snapshot.graph.visible || !snapshot.inspector.visible) return false;
      const geometry = [snapshot.graph, snapshot.inspector]
        .map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)},${item.width.toFixed(1)},${item.height.toFixed(1)}`)
        .join('|');
      stableReads = geometry === previousGeometry ? stableReads + 1 : 0;
      previousGeometry = geometry;
      return stableReads >= 1;
    }, { timeout: 10_000, message: `${description}: Graphpanel und Inspector müssen synchron messbar und stabil sein.` }).toBe(true);
    assertNoOverlap([
      { name: 'Graphpanel', ...snapshot.graph },
      { name: 'Übergangsinspector', ...snapshot.inspector },
    ], `${description}: Graphpanel und Inspector überdecken sich nicht`);
  };

  await ownerPage.setViewportSize({ width: 1588, height: 850 });
  await ownerPage.goto('/#/workflows');
  await expect(ownerPage.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  const { editor, graph } = await openWorkflow(ownerPage, project, workflow);
  await expect(graph.locator('[data-testid^="workflow-graph-stage-"]')).toHaveCount(4);
  await expect(bundle).toHaveRole('button');
  await expect(bundle).toBeVisible();
  await expect(bundle).toHaveAccessibleName('4 Ergebnisrouten zwischen Bearbeitung und Abschluss anzeigen');
  await expect(bundle).toContainText('4 Routen');
  await expect(graph.locator('.workflow-graph__edge-label [data-testid^="workflow-graph-transition-"]:visible')).toHaveCount(6);
  await assertDenseGraphFitsPane(graph, 'Dense Graph Desktop Ausgangsansicht');

  for (const route of routes) {
    if (route.bundle) {
      await bundle.click();
      await expect(ownerPage.locator('[data-testid^="workflow-graph-route-bundle-item-1-3-"]')).toHaveCount(4);
      const option = ownerPage.getByTestId(`workflow-graph-route-bundle-item-1-3-${route.index}`);
      await expect(option).toBeVisible();
      await expect(option).toHaveAccessibleName(new RegExp(`${route.from} → ${route.to}.*${route.outcome}.*${route.label}`));
      await option.click();
    } else {
      const edge = graph.getByTestId(`workflow-graph-transition-${route.index}`);
      await expect(edge).toHaveRole('button');
      await expect(edge).toHaveAccessibleName(edgeName(route.from, route.to, route.outcome, route.label, route.returnRoute));
      const hitArea = await edge.boundingBox();
      expect(hitArea, `Route ${route.index} muss per Pointer bedienbar sein.`).not.toBeNull();
      expect(hitArea.width).toBeGreaterThan(0);
      expect(hitArea.height).toBeGreaterThan(0);
      await edge.click();
    }
    await assertSelectedRoute(route, { width: 1588, height: 850 }, `Pointerroute ${route.index}`);
    await assertDenseGraphFitsPane(graph, `Dense Graph Desktop nach Route ${route.index}`);
  }

  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toBeVisible();
  await assertPageFits(ownerPage, { width: 390, height: 844 }, 'Dense Graph Mobile');

  const navigationTab = graph.getByTestId('workflow-graph-mobile-view-navigation');
  const diagramTab = graph.getByTestId('workflow-graph-mobile-view-graph');
  const navigation = graph.getByTestId('workflow-graph-mobile-navigation');
  const navigationContent = navigation.getByTestId('workflow-mobile-navigation-content');
  await expect(navigationTab).toHaveAttribute('aria-pressed', 'true');
  await expect(diagramTab).toHaveAttribute('aria-pressed', 'false');
  await expect(navigation).toBeVisible();
  await expect(navigationContent).toBeVisible();
  await expect(navigationContent.locator('ol > li[data-testid^="workflow-mobile-stage-"]')).toHaveCount(4);

  const mobileNavigationControls = [];
  for (const [index, stage] of stages.entries()) {
    const card = navigationContent.getByTestId(`workflow-mobile-stage-${stage.id}`);
    const phaseName = card.getByTestId(`workflow-mobile-stage-select-${stage.id}`);
    const role = card.locator('p').filter({ hasText: 'Rolle:' });
    await expect(phaseName).toHaveText(stage.name);
    await expect(card).toContainText(index === 3 ? 'Reviewphase' : 'Arbeitsphase');
    await expect(role).toContainText('Keine Agentrolle');
    const fontSizes = await Promise.all([
      phaseName.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      role.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ]);
    expect(fontSizes[0], `Die Phase ${stage.name} ist auf Mobil gut lesbar.`).toBeGreaterThanOrEqual(16);
    expect(fontSizes[1], `Die Rolleninformation für ${stage.name} ist auf Mobil gut lesbar.`).toBeGreaterThanOrEqual(14);
    mobileNavigationControls.push({ name: `Phase ${stage.name}`, locator: phaseName });
    mobileNavigationControls.push({ name: `Rolle ${stage.name}`, locator: role });
  }
  await expect(navigationContent.getByTestId('workflow-mobile-route-0')).toContainText('Bearbeitung');
  await expect(navigationContent.getByTestId('workflow-mobile-route-0')).toContainText('Standardroute');
  await expect(navigationContent.getByTestId('workflow-mobile-route-0')).toContainText('Angenommen');
  for (const route of routes) {
    mobileNavigationControls.push({ name: `Route ${route.index}`, locator: navigationContent.getByTestId(`workflow-mobile-route-${route.index}`) });
  }
  const mobileControlBounds = [];
  for (const control of mobileNavigationControls) {
    const bounds = await control.locator.boundingBox();
    expect(bounds, `${control.name} hat eine messbare mobile Trefferfläche.`).not.toBeNull();
    mobileControlBounds.push({ name: control.name, ...bounds });
  }
  assertNoOverlap(mobileControlBounds, 'Mobile Phasen-, Rollen- und Routeninformationen überdecken sich nicht.');

  const mobileRoute = navigationContent.getByTestId('workflow-mobile-route-0');
  await mobileRoute.scrollIntoViewIfNeeded();
  await mobileRoute.click();
  await expect(mobileRoute).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel('Von Phase')).toContainText(routes[0].from);
  await expect(inspector.getByLabel('Ergebnis')).toContainText(routes[0].outcome);
  await expect(inspector.getByLabel('Zu Phase')).toContainText(routes[0].to);
  await expect(inspector.getByLabel('Label für diesen Übergang')).toContainText(routes[0].label);
  await expect(inspector.getByTestId('workflow-inspector-heading')).toBeFocused();
  await expect(inspector.getByTestId('workflow-inspector-heading')).toBeInViewport();
  await assertGraphGridColumns(inspector, 1, 'Mobile Navigationroute zeigt den Inspector unter der Phase-/Routenansicht.');
  await assertMobileGraphPanelAndInspectorStack('Mobile Phasen-/Routenansicht und Inspector');
  await inspector.getByRole('button', { name: 'Details schließen', exact: true }).click();
  await expect(inspector).toHaveCount(0);
  await expect(navigationTab).toHaveAttribute('aria-pressed', 'true');

  await diagramTab.click();
  await expect(diagramTab).toHaveAttribute('aria-pressed', 'true');
  await expect(navigationTab).toHaveAttribute('aria-pressed', 'false');
  await assertDenseGraphFitsPane(graph, 'Dense Graph Mobile Ausgangsansicht');

  for (const route of routes) {
    if (route.bundle) {
      await bundle.scrollIntoViewIfNeeded();
      await bundle.focus();
      await expect(bundle).toBeFocused();
      await bundle.press('Enter');
      await expect(ownerPage.locator('[data-testid^="workflow-graph-route-bundle-item-1-3-"]')).toHaveCount(4);
      const firstOption = ownerPage.getByTestId('workflow-graph-route-bundle-item-1-3-2');
      const option = ownerPage.getByTestId(`workflow-graph-route-bundle-item-1-3-${route.index}`);
      await expect(firstOption).toBeVisible();
      await expect(firstOption).toBeFocused();
      for (let step = 2; step < route.index; step += 1) await ownerPage.keyboard.press('ArrowDown');
      await expect(option).toBeFocused();
      await ownerPage.keyboard.press('Enter');
    } else {
      const edge = graph.getByTestId(`workflow-graph-transition-${route.index}`);
      await edge.scrollIntoViewIfNeeded();
      await edge.focus();
      await expect(edge).toBeFocused();
      await edge.press(route.index === 0 ? 'Space' : 'Enter');
    }
    await assertSelectedRoute(route, { width: 390, height: 844 }, `Keyboardroute ${route.index}`);
    await assertDenseGraphFitsPane(graph, `Dense Graph Mobile nach Route ${route.index}`);
    if (route.index < routes.length - 1) {
      await inspector.getByRole('button', { name: 'Details schließen', exact: true }).click();
      await expect(inspector).toHaveCount(0);
      await graph.scrollIntoViewIfNeeded();
    }
  }

  await expect(editor).toBeVisible();
  await navigationTab.click();
  await expect(navigationTab).toHaveAttribute('aria-pressed', 'true');
  await expect(diagramTab).toHaveAttribute('aria-pressed', 'false');
  await expect(navigationContent.getByTestId('workflow-mobile-route-9')).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector.getByLabel('Von Phase')).toContainText(routes[9].from);
  await expect(inspector.getByLabel('Ergebnis')).toContainText(routes[9].outcome);
  await expect(inspector.getByLabel('Zu Phase')).toContainText(routes[9].to);
  await expect(inspector.getByLabel('Label für diesen Übergang')).toContainText(routes[9].label);
  recordEvidence(
    'Der Workfloweditor hält vier Phasen und zehn dichte Routen auf Desktop und Mobil bedienbar.',
    `Ein isoliertes QA-Projekt enthielt vier Phasen und zehn Übergänge. Vier gebündelte Routen von Bearbeitung nach Abschluss (Angenommen Standardroute, Angenommen Risiko, Blockiert und Fehlgeschlagen) sowie die sechs übrigen Routen wurden am 1588×850-Desktop per Pointer und bei 390×844 per Tastatur ausgewählt. Die mobile Ansicht zeigte Phasennamen und Rollen lesbar ohne überlappende Routecontrols; eine Routenauswahl öffnete den passenden Inspector. Der Wechsel zum Diagramm und zurück behielt die ausgewählte Route bei. Jeder Inspector zeigte Quelle, Ergebnis, Ziel und Route; alle sichtbaren Phasen-, Routen- und Bündelcontrols blieben innerhalb der Graphpane und überdeckten weder einander noch den Inspector. Es wurde kein Workflowlauf gestartet.`,
    {},
  );
});
