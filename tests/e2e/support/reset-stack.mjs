import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeOwner } from './global-setup.mjs';

// The runner only signals its dedicated host harness. It never receives the
// Docker socket, a product filesystem, or a privileged application endpoint.
export async function resetStack(directory) {
  const id = randomUUID();
  const request = path.join(directory, id);
  await writeFile(request + '.tmp', id);
  await rename(request + '.tmp', request + '.request');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const outcome = (await readFile(request + '.result', 'utf8')).trim();
      if (outcome !== 'ready') throw new Error('External fixture reset failed. See the test harness log.');
      await initializeOwner();
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(150);
  }
  throw new Error('External fixture reset did not finish.');
}
