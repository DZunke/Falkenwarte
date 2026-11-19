import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { noStore, pathOf, readJson, sendJson, startServer } from './http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(path.join(root, 'fixtures/decisions/intake-responses.json'), 'utf8'));
const requestFixture = JSON.parse(await readFile(path.join(root, 'fixtures/decisions/intake-request.json'), 'utf8'));
const variants = new Map(fixture.variants.map((variant) => [variant.id, variant]));
const expectedQuestions = new Map(requestFixture.request.body.questions.map((question) => [question.name, question.type]));
const token = process.env.DECISIONS_MOCK_BEARER ?? 'qa-decisions-token';

let scenario = process.env.DECISIONS_MOCK_SCENARIO ?? 'decisions_ready';
let attempts = 0;
let journal = [];
let releaseDelayed = false;
let waitingForRelease = [];

function reset(nextScenario = 'decisions_ready') {
  if (!variants.has(nextScenario)) throw new Error(`Unknown Decisions scenario: ${nextScenario}`);
  scenario = nextScenario;
  attempts = 0;
  journal = [];
  releaseDelayed = false;
  waitingForRelease = [];
}

function validateRequest(requestBody) {
  if (requestBody?.model !== 'gpt-6-luna') return 'Expected model gpt-6-luna.';
  if (!Array.isArray(requestBody.questions) || requestBody.questions.length === 0) return 'Expected a non-empty native questions array.';
  for (const question of requestBody.questions) {
    const expectedType = expectedQuestions.get(question?.name)
      ?? (question?.name === 'workflow' || question?.name === 'primary_topic' ? 'choice' : null)
      ?? (question?.name?.startsWith('tag.') || question?.name?.startsWith('missing.') ? 'predicate' : null)
      ?? (question?.name === 'priority' ? 'score' : null);
    if (expectedType !== question?.type) {
      return `Unexpected question name or type: ${String(question?.name)} (${String(question?.type)}).`;
    }
  }
  const input = requestBody.input;
  if (!Array.isArray(input) || input[0]?.type !== 'message' || input[0]?.content?.[0]?.type !== 'input_json') {
    return 'Expected the native structured JSON input form.';
  }
  return null;
}

function responseFor(variantId, requestBody) {
  const variant = variants.get(variantId);
  const fixtureResponse = variant?.response;
  if (!fixtureResponse?.body?.answers) return fixtureResponse;

  const answers = requestBody.questions.map((question) => {
    if (question.type === 'choice') {
      const choices = question.choices ?? [];
      const eligible = choices.filter((choice) => choice.value !== 'unknown');
      const selected = eligible[0]?.value ?? 'unknown';
      const second = eligible[1]?.value;
      if (variantId === 'decisions_ambiguous' && question.name === 'workflow' && second) {
        return {
          type: 'choice', name: question.name, choice: selected, confidence: 0.52,
          probabilities: [{ value: selected, probability: 0.52 }, { value: second, probability: 0.48 }],
        };
      }
      return {
        type: 'choice', name: question.name, choice: selected, confidence: 0.98,
        probabilities: [{ value: selected, probability: 0.98 }, { value: 'unknown', probability: 0.02 }],
      };
    }
    if (question.type === 'predicate') {
      const isMissingField = question.name.startsWith('missing.');
      return { type: 'predicate', name: question.name, probability: isMissingField && variantId === 'decisions_missing_information' ? 0.99 : 0.01 };
    }
    if (question.type === 'score') {
      return { type: 'score', name: question.name, score: question.levels?.[0]?.value ?? question.levels?.[0] ?? 'normal' };
    }
    return { type: question.type, name: question.name };
  });

  if (variantId === 'decisions_refusal') {
    const index = answers.findIndex((answer) => answer.name === 'workflow');
    if (index >= 0) answers[index] = { type: 'refusal', name: 'workflow' };
  }

  return {
    ...fixtureResponse,
    body: {
      ...fixtureResponse.body,
      model: requestBody.model,
      answers,
    },
  };
}

function sendFixture(response, item) {
  sendJson(response, item.status, item.body ?? null, item.headers ?? {});
}

async function decisionRequest(request, response) {
  attempts += 1;
  noStore(response);
  const requestBody = await readJson(request);
  const invalid = validateRequest(requestBody);
  const item = {
    sequence: journal.length + 1,
    method: request.method,
    path: pathOf(request),
    model: requestBody?.model ?? null,
    question_names: Array.isArray(requestBody?.questions) ? requestBody.questions.map((question) => question?.name) : [],
    question_types: Array.isArray(requestBody?.questions) ? requestBody.questions.map((question) => question?.type) : [],
    taxonomy_version: requestBody?.input?.[0]?.content?.[0]?.data?.taxonomy_version ?? null,
    authorization_present: Boolean(request.headers.authorization),
    scenario,
    validation_error: invalid,
  };
  journal.push(item);

  if (request.method !== 'POST' || pathOf(request) !== '/v1/decisions') {
    item.outcome = 'unexpected_request';
    return sendJson(response, 404, { error: { type: 'not_found', message: 'Unexpected Decisions request path.' } });
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    item.outcome = 'unauthorized';
    return sendJson(response, 401, { error: { type: 'authentication_error', message: 'Fixture bearer token required.' } });
  }
  if (invalid) {
    item.outcome = 'invalid_request';
    return sendJson(response, 422, { error: { type: 'invalid_request_error', message: invalid } });
  }

  const variant = variants.get(scenario);
  if (variant.sequence) {
    const sequenceItem = variant.sequence[Math.min(attempts - 1, variant.sequence.length - 1)];
    item.outcome = `http_${sequenceItem.status}`;
    if (sequenceItem.status === 200) return sendFixture(response, { ...sequenceItem, body: responseFor('decisions_ready', requestBody).body });
    return sendFixture(response, sequenceItem);
  }
  if (variant.transport === 'timeout_before_response') {
    item.outcome = 'connection_dropped';
    response.destroy();
    return;
  }
  if (variant.release_barrier && !releaseDelayed) {
    item.outcome = 'held_at_barrier';
    await new Promise((resolve) => waitingForRelease.push(resolve));
  }
  const responseFixture = responseFor(scenario, requestBody);
  if (!responseFixture) {
    item.outcome = 'invalid_fixture';
    return sendJson(response, 500, { error: { type: 'mock_configuration_error', message: 'Scenario has no response.' } });
  }
  item.outcome = `http_${responseFixture.status}`;
  sendFixture(response, responseFixture);
}

startServer(Number(process.env.PORT ?? 4310), async (request, response) => {
  const pathname = pathOf(request);
  if (pathname === '/__qa/health' && request.method === 'GET') {
    return sendJson(response, 200, { service: 'decisions-mock', scenario, attempts });
  }
  if (pathname === '/__qa/reset' && request.method === 'POST') {
    const body = await readJson(request);
    try {
      reset(body?.scenario ?? 'decisions_ready');
      return sendJson(response, 200, { reset: true, scenario });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }
  if (pathname === '/__qa/scenario' && request.method === 'POST') {
    const body = await readJson(request);
    const nextScenario = body?.scenario;
    if (!variants.has(nextScenario)) return sendJson(response, 400, { error: `Unknown Decisions scenario: ${nextScenario}`, available: [...variants.keys()] });
    scenario = nextScenario;
    attempts = 0;
    releaseDelayed = false;
    waitingForRelease = [];
    return sendJson(response, 200, { scenario });
  }
  if (pathname === '/__qa/release' && request.method === 'POST') {
    releaseDelayed = true;
    for (const resolve of waitingForRelease) resolve();
    waitingForRelease = [];
    return sendJson(response, 200, { released: true });
  }
  if (pathname === '/__qa/journal' && request.method === 'GET') {
    return sendJson(response, 200, { scenario, attempts, requests: journal });
  }
  if (pathname === '/v1/decisions') return decisionRequest(request, response);
  return sendJson(response, 404, { error: { type: 'not_found', message: 'Unknown mock path.' } });
});
