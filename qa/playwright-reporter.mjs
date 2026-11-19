import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repository, 'qa/results.json');

export default class FalkenwarteEvidenceReporter {
  results = [];

  onTestEnd(test, result) {
    const title = test.titlePath().filter(Boolean).join(' › ');
    const annotations = [...test.annotations, ...(result.annotations ?? [])];
    const acceptanceIds = new Set([
      ...annotations.filter((annotation) => annotation.type === 'acceptance').flatMap((annotation) => annotation.description.split(/[ ,]+/)),
      ...(title.match(/\bA\d{2}\b/g) ?? []),
    ]);
    if (acceptanceIds.size === 0) return;

    const expected = annotations.find((annotation) => annotation.type === 'expected')?.description ?? null;
    const observed = [...new Set(annotations.filter((annotation) => annotation.type === 'observed').map((annotation) => annotation.description))];
    if (observed.length === 0 && result.error?.message) observed.push(`Abweichung beobachtet: ${result.error.message}`);
    for (const acceptanceId of acceptanceIds) {
      this.results.push({
        acceptance_id: acceptanceId,
        title,
        status: result.status,
        expected_outcome: expected,
        observed_outcome: observed,
        duration_ms: result.duration,
        error: result.error?.message ?? null,
        retry: result.retry,
      });
    }
  }

  async onEnd(result) {
    let fixtureVersion = 'unavailable';
    try {
      const scenarios = JSON.parse(await readFile(path.join(repository, 'qa/scenarios.json'), 'utf8'));
      fixtureVersion = scenarios.format;
    } catch {
      // Keep the evidence record readable when the fixture catalog cannot be loaded.
    }
    let baseCommit = null;
    let worktreeDirty = null;
    try {
      baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
      worktreeDirty = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim().length > 0;
    } catch {
      // The report may also be generated outside a Git checkout.
    }

    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify({
      format: 'falkenwarte.acceptance-evidence.v1',
      generated_at: new Date().toISOString(),
      overall_status: result.status,
      commit: process.env.FALKENWARTE_TEST_COMMIT ?? process.env.GITHUB_SHA ?? null,
      base_commit: baseCommit,
      worktree_dirty: worktreeDirty,
      image: process.env.FALKENWARTE_IMAGE_REF ?? null,
      fixture_version: fixtureVersion,
      browser: 'chromium',
      base_url: process.env.FALKENWARTE_BASE_URL ?? 'http://127.0.0.1:8080',
      cases: this.results,
    }, null, 2)}\n`);
  }
}
