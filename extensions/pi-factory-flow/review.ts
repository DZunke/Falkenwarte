import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { candidateLocation, inspectWorkflowRun, loadRun, projectDirectory, reviewDelivery } from "./project.ts";
import { inspectReviewTrace, type ReviewTrace } from "./trace.ts";

const MAX_DIFF = 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_IMAGES = 8;
const OMIT = [".pi/workflows/", ".pi/workflow-subagents/", ".falkenwarte/runs/", ".falkenwarte/reviews/"];
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function git(root: string, args: string[], maxBuffer = MAX_DIFF + 8192): Buffer {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root, encoding: "buffer", timeout: 15000, maxBuffer,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" },
  });
  if (result.error || result.status !== 0) throw new Error(`Cannot inspect project Git state (${args[0]}): ${result.error?.message ?? result.stderr?.toString("utf8").slice(0, 300) ?? result.status}`);
  return result.stdout;
}

function text(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Git evidence contains invalid UTF-8"); }
}

function paths(bytes: Buffer): string[] {
  const result = text(bytes).split("\0");
  if (result.at(-1) === "") result.pop();
  return result;
}

function within(root: string, name: string): string {
  if (!name || isAbsolute(name) || /[\\\x00-\x1f\x7f]/.test(name)) throw new Error(`Unsafe review path: ${JSON.stringify(name)}`);
  const path = resolve(root, name);
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`Review path escapes the project: ${JSON.stringify(name)}`);
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Review path contains a symlink: ${name}`);
  }
  return path;
}

function regularBytes(file: string, name: string): Buffer {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_FILE) throw new Error(`Review needs a regular file under ${MAX_FILE} bytes: ${name}`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > MAX_FILE) {
      throw new Error(`Review file changed while being inspected: ${name}`);
    }
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

function picture(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined; // No SVG: local HTML must not execute an attachment.
}

export type FileEvidence = { path: string; state: "present" | "deleted"; bytes?: number; sha256?: string; snapshot?: string };
export type ImageEvidence = { source: string; copied: string; mime: string; sha256: string };
export type ReviewEvidence = {
  schemaVersion: 1; flowId: string; engineRunId: string; engineStatus: string; reviewDelivery: "local" | "pr";
  baseCommit: string; writerTaskId: string; managedWorktree: boolean;
  files: FileEvidence[]; diffSha256: string; diffBytes: number; images: ImageEvidence[];
  reviewTrace: ReviewTrace; limitations: string[];
};

/** Creates an immutable *local draft*, never a PR or a claim of independent semantic review. */
export function buildReviewEvidence(cwd: string, flowId: string, imagePaths: string[] = [], prefix: "bundle" | "final-source" = "bundle"): { directory: string; evidence: ReviewEvidence } {
  const root = realpathSync(resolve(cwd));
  const record = loadRun(root, flowId);
  if (!record || !record.assignment.engineRunId) throw new Error("A project flow with a bound engine run is required");
  const engine = inspectWorkflowRun(root, record.assignment.engineRunId);
  if (engine.status !== "completed") throw new Error(`Execution run is ${engine.status}, not completed`);
  const location = candidateLocation(root, engine.runId);
  const candidate = location.root;
  const gitRoot = text(git(candidate, ["rev-parse", "--show-toplevel"])).trim();
  if (realpathSync(gitRoot) !== candidate) throw new Error("Candidate must be its own worktree root");
  const baseCommit = text(git(candidate, ["rev-parse", "--verify", "HEAD"])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(baseCommit)) throw new Error("Invalid Git base commit");
  if (record.assignment.launch) {
    const branchResult = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10000 });
    const branch = branchResult.status === 1 ? null : branchResult.status === 0 ? branchResult.stdout.trim() : undefined;
    if (baseCommit !== record.assignment.launch.head || branch !== record.assignment.launch.branch) {
      throw new Error("Checkout HEAD or branch changed since the factory assignment started");
    }
  }
  const tracked = paths(git(candidate, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]));
  const untracked = paths(git(candidate, ["ls-files", "--others", "--exclude-standard", "-z", "--"]));
  const names = [...new Set([...tracked, ...untracked])].filter((name) => !OMIT.some((prefix) => name.startsWith(prefix))).sort();
  if (names.length > MAX_FILES) throw new Error(`Review has more than ${MAX_FILES} changed files`);
  const privateName = names.find((name) => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|auth\.json|mcp-auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)|models\.json)$|\.(?:pem|key|p12)$/i.test(name));
  if (privateName) throw new Error(`Sensitive-looking file needs separate review; refusing bundle: ${privateName}`);
  const untrackedNames = new Set(untracked);
  const snapshots = new Map<string, Buffer>();
  let snapshotBytes = 0;
  const files = names.map((name): FileEvidence => {
    const file = within(candidate, name);
    if (!lstatSync(file, { throwIfNoEntry: false })) return { path: name, state: "deleted" };
    const bytes = regularBytes(file, name);
    if (untrackedNames.has(name)) {
      snapshotBytes += bytes.length;
      if (snapshotBytes > 8 * 1024 * 1024) throw new Error("Untracked snapshots exceed 8 MiB; split the assignment");
      snapshots.set(name, bytes);
    }
    return { path: name, state: "present", bytes: bytes.length, sha256: hash(bytes),
      ...(untrackedNames.has(name) ? { snapshot: `untracked/${name}` } : {}) };
  });
  const reviewTrace = inspectReviewTrace(root, engine.runId, files, baseCommit, location.taskId);
  const diff = git(candidate, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--no-renames", "HEAD", "--"]);
  if (diff.length > MAX_DIFF) throw new Error("Git diff exceeds 1 MiB; split the assignment");
  if (!Array.isArray(imagePaths) || imagePaths.length > MAX_IMAGES || new Set(imagePaths).size !== imagePaths.length) {
    throw new Error("Choose at most eight distinct screenshot paths");
  }
  const imageFiles = imagePaths.map((name) => {
    const file = within(candidate, name);
    const bytes = regularBytes(file, name);
    const mime = picture(bytes);
    if (!mime) throw new Error(`Screenshot is not a supported raster image: ${name}`);
    const copied = `${hash(bytes).slice(0, 12)}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    return { bytes, source: name, copied, mime, sha256: hash(bytes) };
  });
  const reviews = join(projectDirectory(root), "reviews");
  if (existsSync(reviews) && (!lstatSync(reviews).isDirectory() || lstatSync(reviews).isSymbolicLink())) throw new Error("Unsafe review directory");
  const flowDir = join(reviews, flowId);
  if (existsSync(flowDir) && (!lstatSync(flowDir).isDirectory() || lstatSync(flowDir).isSymbolicLink())) throw new Error("Unsafe flow review directory");
  mkdirSync(flowDir, { recursive: true, mode: 0o700 });
  const destination = join(flowDir, `${prefix}-v${record.revision}`);
  if (existsSync(destination)) throw new Error("Review evidence bundle already exists for this revision");
  const temporary = join(flowDir, `.bundle-${randomUUID()}.tmp`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    for (const [name, bytes] of snapshots) {
      const destinationFile = within(temporary, `untracked/${name}`);
      mkdirSync(dirname(destinationFile), { recursive: true, mode: 0o700 });
      writeFileSync(destinationFile, bytes, { flag: "wx", mode: 0o600 });
    }
    const images: ImageEvidence[] = imageFiles.map(({ bytes, source, copied, mime, sha256 }) => {
      const directory = join(temporary, "screenshots");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, copied), bytes, { flag: "wx", mode: 0o600 });
      return { source, copied: `screenshots/${copied}`, mime, sha256 };
    });
    const evidence: ReviewEvidence = {
      schemaVersion: 1, flowId, engineRunId: engine.runId, engineStatus: engine.status,
      reviewDelivery: reviewDelivery(root), baseCommit, writerTaskId: location.taskId, managedWorktree: location.managed,
      files, diffSha256: hash(diff), diffBytes: diff.length, images, reviewTrace,
      limitations: ["Engine completion and a reviewer artifact read are not independent code approval.",
        ...(reviewTrace.status === "unavailable" ? [`Reviewer read evidence unavailable: ${reviewTrace.reason}`] : []),
        ...(!location.managed ? ["Implementation used the operator-provided checkout; concurrent edits or commits cannot be attributed to this workflow."] : []), "Test execution and results are not attested by this package.",
        "Untracked files are immutable snapshots in this local bundle, not included in changes.diff; do not publish without review.",
        "Review every local artifact and screenshot for secrets before publishing a PR."],
    };
    writeFileSync(join(temporary, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    writeFileSync(join(temporary, "changes.diff"), diff, { flag: "wx", mode: 0o600 });
    const imageHtml = images.map((img) => `<figure><img src="${encodeURI(img.copied)}" alt="${escapeHtml(img.source)}" style="max-width:100%"><figcaption>${escapeHtml(img.source)} · SHA-256 ${img.sha256}</figcaption></figure>`).join("\n");
    const fileHtml = files.map((file) => {
      const label = escapeHtml(file.path);
      const href = file.snapshot ? file.snapshot.split("/").map(encodeURIComponent).join("/") : file.state === "present" ? "changes.diff" : undefined;
      return `<li>${href ? `<a href="${href}">${label}</a>` : label} — ${file.state}${file.sha256 ? ` · SHA-256 ${file.sha256}` : ""}</li>`;
    }).join("\n");
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Falkenwarte review draft</title><body><main><h1>Review draft — ${escapeHtml(record.assignment.title)}</h1><p>Flow ${flowId} · engine ${engine.runId} (${escapeHtml(engine.status)}) · delivery preference ${evidence.reviewDelivery}</p><p><strong>Not a completed review or published PR.</strong> ${evidence.limitations.map(escapeHtml).join(" ")}</p><p>Local candidate/reviewer trace: ${escapeHtml(reviewTrace.status)}${reviewTrace.status === "verified-local" ? ` · candidate SHA-256 ${reviewTrace.candidateDigest} · advisory verdict ${reviewTrace.reviewerVerdict}` : ""}. This does not attest tests.</p><h2>Observed changes since ${baseCommit}</h2><ul>${fileHtml || "<li>No changed files observed.</li>"}</ul><p><a href="changes.diff">Tracked Git diff</a> · <a href="evidence.json">Machine-readable hashes and limitations</a></p><h2>Supplied screenshots</h2>${imageHtml || "<p>None supplied.</p>"}</main></body></html>\n`;
    writeFileSync(join(temporary, "index.html"), html, { flag: "wx", mode: 0o600 });
    renameSync(temporary, destination);
    return { directory: destination, evidence };
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
}
