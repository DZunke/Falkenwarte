import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const clockFile = process.env.FALKENWARTE_TEST_CLOCK_FILE;

export async function setBusinessTime(instant) {
  if (!clockFile) {
    throw new Error('The controlled business clock is unavailable; configure FALKENWARTE_TEST_CLOCK_FILE in the E2E runner.');
  }
  if (Number.isNaN(Date.parse(instant))) {
    throw new Error(`Invalid business-clock instant: ${instant}`);
  }

  await mkdir(path.dirname(clockFile), { recursive: true });
  const temporaryFile = `${clockFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify({ now: instant })}\n`, { mode: 0o644 });
  await chmod(temporaryFile, 0o644);
  await rename(temporaryFile, clockFile);
}

export async function clearBusinessTime() {
  if (!clockFile) return;
  try {
    await unlink(clockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
