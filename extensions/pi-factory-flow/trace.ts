import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FileEvidence } from "./review.ts";

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export type ReviewTrace = { status: "unavailable"; reason: string } | {
  status: "verified-local"; candidateDigest: string; reviewerVerdict: "needs_human" | "changes_requested";
  reviewerTaskId: string; candidateTaskId: string; requiredRead: true;
};

function jsonFile(path: string, maxBytes = 128 * 1024): any {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error("Unsafe or oversized review trace file");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Corroborates local engine artifacts against the bytes just observed; never attests semantic review or tests. */
export function inspectReviewTrace(cwd: string, runId: string, files: FileEvidence[], baseCommit: string, writerTaskId: string): ReviewTrace {
  const runDir = join(cwd, ".pi", "workflows", runId);
  const run = jsonFile(join(runDir, "run.json"), 1024 * 1024);
  if (run.runId !== runId) throw new Error("Review trace has a mismatched engine ID");
  const candidate = run.tasks?.find((task: any) => task.specId === "candidate.main");
  const reviewer = run.tasks?.find((task: any) => task.specId === "review.main");
  if (!candidate && !reviewer) return { status: "unavailable", reason: "No candidate capture and reviewer stages in this engine run." };
  if (candidate?.status !== "completed" || reviewer?.status !== "completed" ||
    !/^task-[0-9]+$/.test(candidate.taskId) || !/^task-[0-9]+$/.test(reviewer.taskId)) {
    throw new Error("Review trace stages are missing or incomplete");
  }
  for (const directory of [join(runDir, "tasks"), join(runDir, "tasks", candidate.taskId), join(runDir, "tasks", reviewer.taskId)]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe review trace directory");
  }
  const control = jsonFile(join(runDir, "tasks", candidate.taskId, "control.json"));
  const value = control?.value;
  if (control?.schema !== "helper-output-v1" || value?.schema !== "falkenwarte-candidate-bytes-v1" ||
    value.baseCommit !== baseCommit || value.writerTaskId !== writerTaskId || !Array.isArray(value.files) ||
    !/^[a-f0-9]{64}$/.test(value.digest)) throw new Error("Candidate capture does not match this checkout");
  if (sha256(JSON.stringify({ baseCommit, files: value.files })) !== value.digest ||
    value.files.length !== files.length || value.files.some((item: any, index: number) => {
      const observed = files[index];
      if (!observed || item.path !== observed.path || item.state !== observed.state) return true;
      return item.state === "present" && (item.sha256 !== observed.sha256 || item.bytes !== observed.bytes ||
        (typeof item.content === "string" ? sha256(Buffer.from(item.content, "utf8")) !== observed.sha256 :
          !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(item.mime) ||
          item.limitation !== "Raster image is hashed but not visually inspected by this text-only reviewer."));
    })) throw new Error("Candidate capture no longer matches observed file bytes");
  const ledgerPath = join(runDir, "tasks", reviewer.taskId, "read-ledger.jsonl");
  const stat = lstatSync(ledgerPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 64 * 1024) throw new Error("Unsafe reviewer read ledger");
  const entries = readFileSync(ledgerPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  if (!entries.some((entry) => entry.schema === "workflow-artifact-read-v1" && entry.runId === runId &&
    entry.taskId === reviewer.taskId && entry.source === "candidate" && entry.artifact === "control" &&
    entry.path === "$" && entry.truncated === false && Number.isSafeInteger(entry.returnedBytes) && entry.returnedBytes > 0)) {
    throw new Error("Reviewer did not record an untruncated candidate control read");
  }
  const reviewControl = jsonFile(join(runDir, "tasks", reviewer.taskId, "control.json"));
  if (reviewControl?.digest !== value.digest || !["needs_human", "changes_requested"].includes(reviewControl.verdict) ||
    !Array.isArray(reviewControl.filesReviewed) || files.some((file) => !reviewControl.filesReviewed.includes(file.path))) {
    throw new Error("Reviewer output does not reference the observed candidate digest and files");
  }
  return { status: "verified-local", candidateDigest: value.digest, reviewerVerdict: reviewControl.verdict,
    candidateTaskId: candidate.taskId, reviewerTaskId: reviewer.taskId, requiredRead: true };
}
