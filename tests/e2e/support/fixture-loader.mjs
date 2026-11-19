import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { setBusinessTime } from './test-clock.mjs';

const seedPath = fileURLToPath(new URL('../../../qa/fixtures/fixture-seed.json', import.meta.url));

async function readSeed() {
  const seed = JSON.parse(await readFile(seedPath, 'utf8'));
  if (seed.format !== 'falkenwarte.qa.seed.v1' || seed.status !== 'active' || seed.production_allowed !== false) {
    throw new Error('The QA fixture seed is invalid or is not explicitly test-only.');
  }
  return seed;
}

async function requireSuccess(result, expectedStatus, operation) {
  expect(result.response.status(), `${operation}: ${JSON.stringify(result.data)}`).toBe(expectedStatus);
  return result.data;
}

export async function loadOwnerFixtureContext(ownerApi) {
  const seed = await readSeed();
  await setBusinessTime(seed.clock.initial);

  const projects = {};
  for (const definition of seed.projects) {
    projects[definition.key] = await ownerApi.createProject({
      slug: definition.slug,
      name: definition.name,
      color: definition.color,
      icon: definition.icon,
    });
  }

  const statuses = {};
  const boards = {};
  for (const definition of seed.projects) {
    const project = projects[definition.key];
    const { response, data } = await ownerApi.get(`/projects/${project.id}/statuses`);
    expect(response.status(), JSON.stringify(data)).toBe(200);
    const byCategory = Object.fromEntries(data.items.map((status) => [status.category, status]));
    expect(Object.keys(byCategory).sort()).toEqual([...seed.expected_status_categories].sort());
    statuses[definition.key] = byCategory;
    boards[definition.key] = await ownerApi.ensureDefaultBoard(project.id);
  }

  const labels = {};
  for (const definition of seed.labels) {
    labels[definition.key] = await ownerApi.createLabel(projects[definition.project_key].id, {
      key: definition.key,
      name: definition.name,
      color: definition.color,
      kind: definition.kind,
      description: definition.description,
    });
  }

  const tasks = {};
  for (const definition of seed.tasks) {
    await setBusinessTime(definition.created_at ?? seed.clock.initial);
    const task = await ownerApi.createTask(projects[definition.project_key].id, {
      title: definition.title,
      description: definition.description,
      priority: definition.priority,
      label_ids: (definition.label_keys ?? []).map((key) => labels[key].id),
    });
    const taskRead = await ownerApi.get(`/tasks/${task.id}`);
    expect(taskRead.response.status(), JSON.stringify(taskRead.data)).toBe(200);
    tasks[definition.key] = taskRead.data;
  }

  for (const step of seed.metric_history) {
    await setBusinessTime(step.at);
    const taskKey = step.task_key ?? 'metric_cycle';
    const metricTask = tasks[taskKey];
    const taskDefinition = seed.tasks.find((definition) => definition.key === taskKey);
    if (!metricTask || !taskDefinition) throw new Error(`The fixture seed does not define metric task ${taskKey}.`);
    const current = await ownerApi.get(`/tasks/${metricTask.id}`);
    expect(current.response.status(), JSON.stringify(current.data)).toBe(200);

    if (step.action === 'move') {
      const status = statuses[taskDefinition.project_key]?.[step.status_category];
      if (!status) throw new Error(`Metric seed references unknown task status: ${step.status_category}`);
      const result = await ownerApi.post(`/tasks/${metricTask.id}/move`, { status_id: status.id }, { version: current.data.version });
      await requireSuccess(result, 200, 'move metric task');
    } else if (step.action === 'block') {
      const body = step.blocked ? { blocked: true, reason: step.reason } : { blocked: false };
      const result = await ownerApi.post(`/tasks/${metricTask.id}/blocker`, body, { version: current.data.version });
      await requireSuccess(result, 200, 'change metric task blocker');
    } else {
      throw new Error(`Unsupported metric seed action: ${step.action}`);
    }
  }
  await setBusinessTime(seed.clock.metric_final);

  return {
    projects,
    statuses,
    boards,
    labels,
    tasks,
    metricWindow: seed.clock.metric_window,
    seed,
  };
}
