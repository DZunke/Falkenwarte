import { request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.FALKENWARTE_BASE_URL ?? 'http://127.0.0.1:8080';
const apiPrefix = process.env.FALKENWARTE_API_PREFIX ?? '/api/v1';
const setupToken = process.env.FALKENWARTE_SETUP_TOKEN ?? 'test-setup-token-ONLY-for-isolated-qa';
const password = process.env.FALKENWARTE_QA_OWNER_PASSWORD ?? 'Falkenwarte-Test-Owner-Password-2026!';
const privateDirectory = process.env.FALKENWARTE_PRIVATE_DIR ?? path.join(directory, '../results');
const statePath = path.join(privateDirectory, 'owner-state.json');

export default async function globalSetup() {
  if (!process.env.FALKENWARTE_STACK_CONTROL) await initializeOwner();
}

export async function initializeOwner() {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Accept: 'application/json' } });
  try {
    const health = await context.get('/healthz');
    if (!health.ok()) throw new Error(`Application health check failed with HTTP ${health.status()}.`);

    const bootstrap = await context.get(`${apiPrefix}/bootstrap`);
    if (!bootstrap.ok()) throw new Error(`Bootstrap status check failed with HTTP ${bootstrap.status()}.`);
    const bootstrapState = await bootstrap.json();
    if (bootstrapState.setup_required === true) {
      const origin = new URL(baseURL).origin;
      const setup = await context.post(`${apiPrefix}/bootstrap`, {
        headers: { Origin: origin },
        data: {
          setup_token: setupToken,
          display_name: 'QA Owner',
          password,
          timezone: 'UTC',
        },
      });
      if (setup.status() !== 201) {
        throw new Error(`Owner bootstrap failed with HTTP ${setup.status()}: ${await setup.text()}`);
      }
    } else {
      const login = await context.post(`${apiPrefix}/session`, {
        headers: { Origin: new URL(baseURL).origin },
        data: { password },
      });
      if (!login.ok()) throw new Error(`QA owner login failed with HTTP ${login.status()}: ${await login.text()}`);
    }

    const session = await context.get(`${apiPrefix}/session`);
    if (!session.ok()) throw new Error(`Could not read QA owner session with HTTP ${session.status()}.`);
    const sessionData = await session.json();
    if (sessionData.authenticated !== true || typeof sessionData.csrf_token !== 'string') {
      throw new Error('The application did not return an authenticated QA owner session with a CSRF token.');
    }

    await mkdir(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    await writeFile(path.join(privateDirectory, 'owner-session.json'), JSON.stringify({ csrfToken: sessionData.csrf_token }, null, 2), { mode: 0o600 });
  } finally {
    await context.dispose();
  }
}
