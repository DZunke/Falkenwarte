import { randomUUID } from "node:crypto";

export const phases = ["idea", "planning", "implementation", "review", "result", "pr"] as const;
export type Phase = typeof phases[number];
export type Entry = { phase: Phase; actor: string; summary: string; at: string; evidence?: string };
export type AgentRow = { agent: string; status: string; runId?: string; index?: number };
export type Assignment = { id: string; title: string; issue?: string; phase: Phase; entries: Entry[]; boundRunIds: string[]; agents: AgentRow[]; engineRunId?: string; launch?: { head: string; branch: string | null }; published?: { url: string; commit: string } };

const safe = (value: string, max: number) => Boolean(value.trim()) && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const issuePattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/[1-9]\d*$/;

export function start(title: string, issue?: string): Assignment {
  const name = title.trim();
  if (!safe(name, 200)) throw new Error("Task title must be 1–200 printable characters");
  if (issue && !issuePattern.test(issue)) throw new Error("Use a valid GitHub Issue URL");
  return { id: randomUUID(), title: name, ...(issue ? { issue } : {}), phase: "idea", entries: [], boundRunIds: [], agents: [] };
}

export function advance(task: Assignment, phase: Phase, summary: string, actor = "Orchestrator", evidence?: string): Assignment {
  if (!phases.includes(phase)) throw new Error("Unknown phase");
  if (!safe(summary, 500)) throw new Error("Summary must be 1–500 printable characters");
  if (phase === "pr") throw new Error("PR phase requires a verified publication receipt, not a self-reported milestone");
  if (phase === "result" && !evidence) throw new Error("Result needs an evidence reference");
  if (evidence && !safe(evidence, 300)) throw new Error("Evidence must be a printable reference under 300 characters");
  const from = phases.indexOf(task.phase);
  const to = phases.indexOf(phase);
  if (to !== from && to !== from + 1 && !(task.phase === "review" && phase === "implementation")) {
    throw new Error("Advance one phase at a time, or return from review to implementation");
  }
  return { ...task, phase, entries: [...task.entries, { phase, actor, summary: summary.trim(), at: new Date().toISOString(), ...(evidence ? { evidence } : {}) }] };
}

export function recordVerifiedPr(task: Assignment, url: string, commit: string): Assignment {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(url) || !/^[a-f0-9]{40,64}$/.test(commit) || task.published) {
    throw new Error("A unique verified GitHub PR URL and commit are required");
  }
  return { ...task, phase: "pr", published: { url, commit }, entries: [...task.entries,
    { phase: "pr", actor: "Verified GitHub publication", summary: `PR head matches ${commit.slice(0, 12)}`, evidence: url, at: new Date().toISOString() }] };
}

export function advanceMatching(task: Assignment | undefined, flowId: string, phase: Phase, summary: string, evidence?: string): Assignment {
  if (!task || flowId !== task.id) throw new Error("No matching active flow. Inspect /factory and use its current flow ID.");
  return advance(task, phase, summary, "Orchestrator", evidence);
}

export function restoreAssignment(value: unknown): Assignment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = value as Partial<Assignment>;
  if (typeof task.id !== "string" || !/^[0-9a-f-]{36}$/.test(task.id) || typeof task.title !== "string" ||
    !safe(task.title, 200) || !phases.includes(task.phase as Phase) || !Array.isArray(task.entries) ||
    !Array.isArray(task.agents) || !Array.isArray(task.boundRunIds) ||
    (task.engineRunId !== undefined && (typeof task.engineRunId !== "string" || !/^workflow_[a-z0-9_]+$/.test(task.engineRunId))) ||
    (task.published !== undefined && (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(task.published?.url ?? "") ||
      !/^[a-f0-9]{40,64}$/.test(task.published?.commit ?? ""))) ||
    (task.launch !== undefined && (!/^[a-f0-9]{40,64}$/.test(task.launch?.head ?? "") ||
      !(task.launch.branch === null || (typeof task.launch.branch === "string" && safe(task.launch.branch, 100))))) ||
    !task.entries.every((entry) => entry && phases.includes(entry.phase) && typeof entry.actor === "string" && typeof entry.summary === "string") ||
    !task.boundRunIds.every((id) => typeof id === "string") ||
    !task.agents.every((row) => row && typeof row.agent === "string" && typeof row.status === "string")) return undefined;
  return task as Assignment;
}

export function rowsFromSubagent(details: unknown, terminal = false): AgentRow[] {
  if (!details || typeof details !== "object" || !("results" in details) || !Array.isArray(details.results)) return [];
  const parentRunId = "runId" in details && typeof details.runId === "string" ? details.runId : undefined;
  return details.results.flatMap((result: unknown) => {
    if (!result || typeof result !== "object" || !("agent" in result) || typeof result.agent !== "string") return [];
    const progress = "progress" in result && result.progress && typeof result.progress === "object" && "status" in result.progress && typeof result.progress.status === "string" ? result.progress.status : undefined;
    const execution = "execution" in result && result.execution && typeof result.execution === "object" && "status" in result.execution && typeof result.execution.status === "string" ? result.execution.status : undefined;
    const exit = "exitCode" in result && typeof result.exitCode === "number" ? result.exitCode : undefined;
    const status = terminal ? execution ?? (exit === undefined ? "unknown" : exit === 0 ? "completed" : "failed") : progress ?? execution ?? "unknown";
    const runId = "runId" in result && typeof result.runId === "string" ? result.runId : parentRunId;
    const index = "index" in result && Number.isSafeInteger(result.index) && result.index >= 0 ? result.index : undefined;
    return [{ agent: result.agent, status, ...(runId ? { runId } : {}), ...(index !== undefined ? { index } : {}) }];
  });
}

function rowKey(row: AgentRow): string {
  return `${row.runId ?? "unknown"}:${row.index ?? "unknown"}:${row.agent}`;
}

export function recordAgents(current: AgentRow[], rows: AgentRow[]): AgentRow[] {
  const agents = new Map(current.map((row) => [rowKey(row), row]));
  for (const row of rows) {
    if (safe(row.agent, 90) && safe(row.status, 40) && (!row.runId || safe(row.runId, 128))) agents.set(rowKey(row), row);
  }
  return [...agents.values()].slice(-12);
}

export function rowsFromNotice(details: unknown): AgentRow[] {
  if (!details || typeof details !== "object" || !("runs" in details) || !Array.isArray(details.runs)) return [];
  return details.runs.flatMap((run: unknown) => {
    if (!run || typeof run !== "object") return [];
    if ("childRuns" in run && Array.isArray(run.childRuns) && run.childRuns.length) {
      return run.childRuns.flatMap((child: unknown) => {
        if (!child || typeof child !== "object" || !("agent" in child) || typeof child.agent !== "string" || !("status" in child) || typeof child.status !== "string") return [];
        return [{ agent: child.agent, status: child.status, ...("runId" in child && typeof child.runId === "string" ? { runId: child.runId } : {}) }];
      });
    }
    return "agent" in run && typeof run.agent === "string" && "status" in run && typeof run.status === "string"
      ? [{ agent: run.agent, status: run.status, ...("runId" in run && typeof run.runId === "string" ? { runId: run.runId } : {}) }] : [];
  });
}

export function terminalRows(previous: AgentRow[], final: AgentRow[], isError: boolean): AgentRow[] {
  const unresolved = previous.filter((row) => !final.some((last) => last.runId === row.runId && last.index === row.index && last.agent === row.agent))
    .map((row) => ({ ...row, status: isError ? "failed/unknown" : "unknown" }));
  return [...final, ...unresolved];
}

export function matchingWorkflowLaunch(args: unknown, flowId: string): boolean {
  return Boolean(args && typeof args === "object" && 'workflow' in args && typeof args.workflow === "string" &&
    args.workflow.trim() && 'task' in args && typeof args.task === "string" &&
    args.task.startsWith(`Falkenwarte flow ID: ${flowId}\n`));
}

export function bindWorkflowRun(task: Assignment, runId: string): Assignment {
  if (!/^workflow_[a-z0-9_]+$/.test(runId) || (task.engineRunId && task.engineRunId !== runId)) {
    throw new Error("A flow can bind only one exact pi-workflow run ID");
  }
  return { ...task, engineRunId: runId };
}

export function bindRun(task: Assignment, runId: string, observed: AgentRow[]): Assignment {
  if (!safe(runId, 128) || !observed.some((row) => row.runId === runId)) throw new Error("Only an observed run ID can be bound");
  return { ...task, boundRunIds: [...new Set([...task.boundRunIds, runId])], agents: recordAgents(task.agents, observed.filter((row) => row.runId === runId)) };
}

export function display(task: Assignment, sessionAgents: AgentRow[] = []): string[] {
  const position = phases.indexOf(task.phase);
  const stages = phases.map((phase, i) => `${i < position ? "·" : i === position ? "●" : "○"} ${phase}`);
  const latest = task.entries.at(-1);
  return [
    `Falkenwarte · ${task.title}${task.issue ? ` · ${task.issue}` : ""} · flow ${task.id.slice(0, 8)}`,
    `self-reported: ${stages.join(" → ")}`,
    ...(task.engineRunId ? [`  execution: pi-workflow ${task.engineRunId} (inspect /workflow ${task.engineRunId})`] : []),
    ...(task.published ? [`  verified PR: ${task.published.url} · ${task.published.commit.slice(0, 12)}`] : []),
    ...task.agents.map((row) => `  task agent: ${row.agent} · ${row.status}${row.runId ? ` · ${row.runId}${row.index !== undefined ? `#${row.index}` : ""}` : ""}`),
    ...sessionAgents.filter((row) => !row.runId || !task.boundRunIds.includes(row.runId)).slice(-2).map((row) => `  session activity (unlinked): ${row.agent} · ${row.status}${row.runId ? ` · ${row.runId}` : ""}`),
    ...(latest ? [`  ${latest.actor}: ${latest.summary}${latest.evidence ? ` [${latest.evidence}]` : ""}`] : ["  Awaiting first milestone summary"]),
  ];
}

export function compact(task: Assignment, sessionAgents: AgentRow[] = []): string[] {
  const lines = display(task, sessionAgents);
  return [...lines.slice(0, 2), ...lines.slice(2, -1).slice(-2), lines.at(-1)!];
}
