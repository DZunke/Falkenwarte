import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadRun, projectSettings } from "./project.ts";
import { buildReviewEvidence, type ReviewEvidence } from "./review.ts";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export type CheckReceipt = { argv: string[]; exitCode: number; startedAt: string; durationMs: number; stdoutSha256: string; stderrSha256: string; stdoutBytes: number; stderrBytes: number };
export type FinalReceipt = { schemaVersion: 1; flowId: string; engineRunId: string; candidateDigest: string; baseCommit: string;
  checks: CheckReceipt[]; verdict: "ready_for_human_review"; limitations: string[] };

/** A host-run, project-owned local review package; neither model reports nor engine status stand in for tests. */
export function buildFinalReview(cwd: string, flowId: string, screenshots: string[] = []): { directory: string; receipt: FinalReceipt } {
  const root = resolve(cwd);
  const record = loadRun(root, flowId);
  if (!record || !record.assignment.engineRunId) throw new Error("A bound project engine run is required");
  const settings = projectSettings(root);
  if (!settings.checks.length) throw new Error("Final review requires versioned verification.commands in .falkenwarte/settings.json");
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", ".falkenwarte/settings.json"], { cwd: root, encoding: "utf8", timeout: 10000 });
  const unchanged = spawnSync("git", ["diff", "--quiet", "HEAD", "--", ".falkenwarte/settings.json"], { cwd: root, timeout: 10000 });
  if (tracked.status !== 0 || unchanged.status !== 0 || tracked.error || unchanged.error) throw new Error("Test command settings must be tracked and unchanged from HEAD");
  const initial = buildReviewEvidence(root, flowId, screenshots, "final-source");
  if (initial.evidence.reviewTrace.status !== "verified-local") {
    throw new Error("Final review requires a verified candidate/reviewer trace");
  }
  const receipts: CheckReceipt[] = [];
  for (const argv of settings.checks) {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const result = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "buffer", shell: false,
      timeout: 120000, maxBuffer: 256 * 1024, env: { ...process.env, PI_FALKENWARTE_VERIFY: "1" } });
    const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
    const exitCode = result.status ?? -1;
    receipts.push({ argv: [...argv], exitCode, startedAt, durationMs: Date.now() - start,
      stdoutSha256: hash(stdout), stderrSha256: hash(stderr), stdoutBytes: stdout.length, stderrBytes: stderr.length });
    if (result.error || exitCode !== 0) throw new Error(`Verification command ${receipts.length}/${settings.checks.length} failed (${result.error?.message ?? exitCode}); no final package created. Output was not published.`);
  }
  const after = buildReviewEvidence(root, flowId, screenshots, "final-check");
  const same = (a: ReviewEvidence, b: ReviewEvidence) => a.baseCommit === b.baseCommit && a.diffSha256 === b.diffSha256 &&
    JSON.stringify(a.files) === JSON.stringify(b.files) && JSON.stringify(a.images) === JSON.stringify(b.images) &&
    a.reviewTrace.status === "verified-local" && b.reviewTrace.status === "verified-local" &&
    a.reviewTrace.candidateDigest === b.reviewTrace.candidateDigest;
  if (!same(initial.evidence, after.evidence)) throw new Error("Candidate bytes, Git diff or screenshots changed during verification; no final package created");
  const trace = after.evidence.reviewTrace;
  if (trace.status !== "verified-local") throw new Error("Reviewer trace is unavailable");
  const receipt: FinalReceipt = { schemaVersion: 1, flowId, engineRunId: record.assignment.engineRunId,
    candidateDigest: trace.candidateDigest, baseCommit: after.evidence.baseCommit, checks: receipts,
    verdict: "ready_for_human_review", limitations: [
      "Checks ran in the operator-provided checkout, not a sandbox; their output bytes are hashed but omitted to avoid publishing secrets.",
      "The reviewer verdict is advisory; raster images are hashed, not visually approved. Human approval is still required; no commit, push, merge or PR was made.",
      "Concurrent edits, earlier commits and ignored files cannot be attributed to this workflow.",
    ] };
  const parent = dirname(initial.directory);
  const destination = join(parent, `final-v${record.revision}`);
  if (existsSync(destination)) throw new Error("Final package already exists for this flow revision");
  const temporary = join(parent, `.final-${randomUUID()}.tmp`);
  try {
    cpSync(after.directory, temporary, { recursive: true, errorOnExist: true, force: false });
    writeFileSync(join(temporary, "checks.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const original = readFileSync(join(temporary, "index.html"), "utf8");
    const summary = `<section><h2>Host-run verification</h2><p>${receipts.length} configured checks passed against the unchanged candidate and Git diff. Advisory review: ${trace.reviewerVerdict}. <strong>Ready for human review, not approved or published.</strong></p><p><a href="checks.json">Command and output-hash receipts</a></p></section>`;
    writeFileSync(join(temporary, "index.html"), original.replace("</main>", `${summary}</main>`));
    renameSync(temporary, destination);
    return { directory: destination, receipt };
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
}
