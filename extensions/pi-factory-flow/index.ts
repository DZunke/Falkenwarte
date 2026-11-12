import { Type } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { advance, advanceMatching, bindRun, bindWorkflowRun, compact, display, matchingWorkflowLaunch, phases, recordAgents, recordVerifiedPr, restoreAssignment, rowsFromSubagent, rowsFromNotice, start, terminalRows, type AgentRow, type Assignment, type Phase } from "./flow.ts";
import { inspectWorkflowRun, listRuns, loadRun, projectSettings, reviewDelivery, saveRun, writeHandoff } from "./project.ts";
import { checkLaunchable, inspectFlatRun } from "./launch.ts";
import { buildReviewEvidence } from "./review.ts";
import { buildFinalReview } from "./final.ts";
import { inspectLocalPublication, publishReviewed, type PublishPlan } from "./publish.ts";

const ENTRY = "falkenwarte-factory-flow";

export default function factoryFlow(pi: ExtensionAPI): void {
  if (process.env.PI_SUBAGENT_CHILD || process.env.PI_WORKFLOW_ROLE === "worker") return; // One flow owner: the parent session.
  let task: Assignment | undefined;
  let revision = 0;
  let publicationPlan: PublishPlan | undefined;
  let observer: ReturnType<typeof setInterval> | undefined;
  const observedFinal = new Set<string>();
  let sessionAgents: AgentRow[] = [];
  const calls = new Map<string, { flowId?: string; rows: AgentRow[] }>();
  const workflowCalls = new Map<string, { flowId: string; cwd: string }>();

  const render = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setWidget(ENTRY, task ? compact(task, sessionAgents) : undefined, { placement: "aboveEditor" });
  };
  const save = (ctx: ExtensionContext) => {
    if (task) {
      try { revision = saveRun(ctx.cwd, task, revision).revision; }
      catch (error) {
        // The disk record, not the session projection, wins after a failed write.
        try { const current = loadRun(ctx.cwd, task.id); task = current?.state === "open" ? current.assignment : undefined; revision = current?.revision ?? 0; }
        catch { task = undefined; revision = 0; }
        toggleProgress(Boolean(task));
        render(ctx);
        throw error;
      }
    }
    pi.appendEntry(ENTRY, task);
    render(ctx);
  };
  const toggleProgress = (enabled: boolean) => {
    const active = pi.getActiveTools().filter((name) => !["factory_progress", "factory_launch", "factory_finish"].includes(name));
    pi.setActiveTools(enabled ? [...active, "factory_progress", "factory_launch", "factory_finish"] : active);
  };
  const restore = (ctx: ExtensionContext) => {
    task = undefined;
    revision = 0;
    publicationPlan = undefined;
    sessionAgents = [];
    calls.clear();
    workflowCalls.clear();
    let invalid = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
      task = entry.data == null ? undefined : restoreAssignment(entry.data);
      invalid = entry.data != null && !task;
    }
    if (task) {
      try {
        const current = loadRun(ctx.cwd, task.id);
        if (!current || current.state === "closed") { task = undefined; invalid = true; }
        else { task = current.assignment; revision = current.revision; }
      } catch { task = undefined; invalid = true; }
    }
    toggleProgress(Boolean(task));
    render(ctx);
    if (invalid && ctx.hasUI) ctx.ui.notify("Factory snapshot has no valid open project run; inspect /factory list instead of inferring recovery.", "warning");
  };
  const observe = (rows: AgentRow[], ctx: ExtensionContext, flowId?: string, persist = false) => {
    if (!rows.length) return;
    sessionAgents = recordAgents(sessionAgents, rows);
    if (task && flowId === task.id) {
      const bound = rows.filter((row) => row.runId && task!.boundRunIds.includes(row.runId));
      if (bound.length) task = { ...task, agents: recordAgents(task.agents, bound) };
    }
    if (persist && task && flowId === task.id) {
      try { save(ctx); }
      catch (error) { if (ctx.hasUI) ctx.ui.notify(`Could not save project flow observation: ${String(error)}`, "warning"); }
    } else render(ctx);
  };

  const observeCompleted = (ctx: ExtensionContext) => {
    try {
      if (!existsSync(join(ctx.cwd, ".falkenwarte", "README.md")) || !projectSettings(ctx.cwd).autoStart) return;
      for (const record of listRuns(ctx.cwd).filter((value) => value.state === "open" && value.assignment.engineRunId)) {
        const id = `${record.assignment.id}:v${record.revision}`;
        if (observedFinal.has(id)) continue;
        const engine = inspectFlatRun(ctx.cwd, record.assignment.engineRunId!);
        if (engine.status !== "completed") continue;
        observedFinal.add(id);
        const final = join(ctx.cwd, ".falkenwarte", "reviews", record.assignment.id, `final-v${record.revision}`, "index.html");
        if (existsSync(final)) continue;
        try {
          const { directory } = buildFinalReview(ctx.cwd, record.assignment.id);
          if (ctx.hasUI) ctx.ui.notify(`Factory local review ready for human inspection: ${directory}/index.html. No PR was opened.`, "info");
        } catch (error) { if (ctx.hasUI) ctx.ui.notify(`Factory review blocked for ${record.assignment.id}: ${String(error)}`, "warning"); }
      }
    } catch (error) { if (ctx.hasUI && !observedFinal.has("observer-error")) { observedFinal.add("observer-error"); ctx.ui.notify(`Factory completion observer paused: ${String(error)}`, "warning"); } }
  };
  const startObserver = (ctx: ExtensionContext) => {
    if (observer) clearInterval(observer);
    observer = setInterval(() => observeCompleted(ctx), 5000);
    observer.unref();
    queueMicrotask(() => observeCompleted(ctx));
  };
  pi.on("session_start", (_event, ctx) => { restore(ctx); startObserver(ctx); });
  pi.on("session_tree", (_event, ctx) => { restore(ctx); startObserver(ctx); });
  pi.on("session_shutdown", () => { if (observer) clearInterval(observer); observer = undefined; });
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName === "subagent") calls.set(event.toolCallId, { flowId: task?.id, rows: [] });
    if (event.toolName === "workflow_run" && task && !task.engineRunId && matchingWorkflowLaunch(event.args, task.id)) {
      workflowCalls.set(event.toolCallId, { flowId: task.id, cwd: ctx.cwd });
    }
  });
  pi.on("tool_execution_update", (event, ctx) => {
    if (event.toolName !== "subagent") return;
    const call = calls.get(event.toolCallId);
    if (!call) return;
    const rows = rowsFromSubagent(event.partialResult?.details);
    call.rows = recordAgents(call.rows, rows);
    observe(rows, ctx, call.flowId);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName === "workflow_run") {
      const launch = workflowCalls.get(event.toolCallId);
      workflowCalls.delete(event.toolCallId);
      const details = event.result?.details;
      if (launch && !event.isError && task?.id === launch.flowId && ctx.cwd === launch.cwd && details && typeof details === "object" &&
        'runId' in details && typeof details.runId === "string") {
        try {
          if (projectSettings(ctx.cwd).autoStart) inspectFlatRun(ctx.cwd, details.runId);
          else inspectWorkflowRun(ctx.cwd, details.runId);
          if (listRuns(ctx.cwd).some((run) => run.assignment.id !== task!.id && run.assignment.engineRunId === details.runId)) {
            throw new Error("Execution run already belongs to a different project flow");
          }
          task = bindWorkflowRun(task, details.runId);
          save(ctx);
        } catch (error) { if (ctx.hasUI) ctx.ui.notify(`Could not bind pi-workflow run: ${String(error)}`, "warning"); }
      }
      return;
    }
    if (event.toolName !== "subagent") return;
    const call = calls.get(event.toolCallId);
    calls.delete(event.toolCallId);
    if (!call) return;
    const rows = rowsFromSubagent(event.result?.details, true);
    observe(terminalRows(call.rows, rows, event.isError), ctx, call.flowId, true);
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "custom" || event.message.customType !== "subagent-notify") return;
    observe(rowsFromNotice(event.message.details), ctx, task?.id, true); // Unbound notices are labelled session activity.
  });

  pi.registerCommand("factory", {
    description: "Start or inspect a manually triggered Falkenwarte task flow",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (input.startsWith("start ")) {
        if (task) { ctx.ui.notify("Close the current view with /factory close before starting another; this will not stop agents.", "error"); return; }
        const title = input.slice(6).trim();
        const issue = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(title) ? title : undefined;
        try {
          const settings = projectSettings(ctx.cwd);
          const launch = settings.autoStart ? checkLaunchable(ctx.cwd) : undefined;
          if (settings.autoStart && !pi.getActiveTools().includes("workflow_run")) throw new Error("pi-workflow is not active; cannot automatically start a factory worker");
          task = start(issue ? `Issue #${issue.split("/").at(-1)}` : title, issue);
          if (launch) task = { ...task, launch: { head: launch.head, branch: launch.branch } };
          revision = 0;
          publicationPlan = undefined;
          toggleProgress(true);
          save(ctx);
          pi.sendMessage({ customType: "falkenwarte-factory-context", content: settings.autoStart
            ? `Active Falkenwarte flow ID: ${task.id}. The operator explicitly started an automatic factory assignment in this exact project checkout. Task: ${task.title}.${task.issue ? ` Issue: ${task.issue}. Fetch and verify this Issue against the actual repository before launching; if unavailable, report the blocker rather than inventing requirements.` : ""} Read AGENTS.md, scope the work, then call factory_launch with this exact flow ID and a concrete brief preserving acceptance constraints. Do not call workflow_run directly, stage, commit, push, create/delete/merge worktrees or claim tests/review/PR without receipts. After launch, wait for the exact engine run and call factory_finish with this flow ID. Report the review package path and limitations; do not claim a PR. Stop on a blocker. The upstream worker tool ceiling may include codemode/MCP and is not a sandbox.`
            : `Active Falkenwarte flow ID: ${task.id}. Task: ${task.title}.${task.issue ? ` Issue: ${task.issue}.` : ""} Use factory_progress only for this exact flow ID and report evidence honestly.`, display: false },
            settings.autoStart ? { triggerTurn: true, deliverAs: "followUp" } : { deliverAs: "nextTurn" });
          ctx.ui.notify(`Project flow started (${task.id.slice(0, 8)}); review delivery: ${settings.reviewDelivery}. ${settings.autoStart ? "Waldemar is preparing the exact-project workflow; this is not a completion receipt." : "Manual mode; no worker was launched."}`, "info");
        } catch (error) { if (!revision) { task = undefined; toggleProgress(false); render(ctx); } ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (input === "stop") {
        ctx.ui.notify("/factory cannot stop workers. Use /subagents-stop for active agents; use /factory close only to close this view.", "error");
        return;
      }
      if (input === "close") {
        const closed = task?.id;
        try { if (task) revision = saveRun(ctx.cwd, task, revision, "closed").revision; }
        catch (error) { ctx.ui.notify(`Unable to close project flow: ${String(error)}`, "error"); return; }
        task = undefined;
        revision = 0;
        publicationPlan = undefined;
        toggleProgress(false);
        save(ctx);
        if (closed) pi.sendMessage({ customType: "falkenwarte-factory-context", content: `Falkenwarte flow ${closed} is closed. Do not record further milestones for it.`, display: false }, { deliverAs: "nextTurn" });
        ctx.ui.notify("Flow closed; earlier session entries remain available.", "info");
        return;
      }
      if (input === "list") {
        try {
          const runs = listRuns(ctx.cwd);
          ctx.ui.notify(runs.length ? runs.map((run) => `${run.assignment.id} · ${run.state} · ${run.assignment.phase} · ${run.assignment.title}`).join("\n") : "No project flows recorded.", "info");
        } catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (input.startsWith("reopen ")) {
        if (task) { ctx.ui.notify("Close the current view first; this does not stop workers.", "error"); return; }
        try {
          const record = loadRun(ctx.cwd, input.slice(7).trim());
          if (!record || record.state !== "open") throw new Error("No open project flow with that exact ID");
          task = record.assignment;
          revision = record.revision;
          toggleProgress(true);
          pi.appendEntry(ENTRY, task);
          render(ctx);
          ctx.ui.notify(`Reopened project flow ${task.id}; worker state is unverified.`, "info");
        } catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (input === "handoff" || input.startsWith("handoff ")) {
        try {
          const id = input === "handoff" ? task?.id : input.slice(8).trim();
          if (!id) throw new Error("Use /factory handoff <exact-id> or reopen an active flow first");
          const file = writeHandoff(ctx.cwd, id);
          ctx.ui.notify(`Handoff written: ${file}. It does not attest worker state or complete review.`, "info");
        } catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (input === "review-draft" || input.startsWith("review-draft ")) {
        if (!task) { ctx.ui.notify("Reopen an active project flow before preparing review evidence.", "error"); return; }
        try {
          const images = input === "review-draft" ? [] : input.slice("review-draft ".length).trim().split(/\s+/);
          const { directory } = buildReviewEvidence(ctx.cwd, task.id, images);
          ctx.ui.notify(`Local review draft: ${directory}/index.html. Tests and reviewer access are not attested; no PR was opened.`, "info");
        } catch (error) { ctx.ui.notify(`Review draft blocked: ${String(error)}`, "error"); }
        return;
      }
      if (input === "review-final" || input.startsWith("review-final ")) {
        if (!task) { ctx.ui.notify("Reopen the exact project flow before finalizing its review.", "error"); return; }
        try {
          const images = input === "review-final" ? [] : input.slice("review-final ".length).trim().split(/\s+/);
          const { directory } = buildFinalReview(ctx.cwd, task.id, images);
          ctx.ui.notify(`Host-verified local review package: ${directory}/index.html. Human approval required; no PR was opened.`, "info");
        } catch (error) { ctx.ui.notify(`Final review blocked: ${String(error)}`, "error"); }
        return;
      }
      if (input.startsWith("publish-plan ")) {
        try {
          if (!task) throw new Error("Reopen the exact flow before planning publication");
          const match = /^publish-plan ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) ([A-Za-z0-9._/-]+)$/.exec(input);
          if (!match) throw new Error("Use /factory publish-plan OWNER/REPO DEFAULT-BASE");
          publicationPlan = inspectLocalPublication(ctx.cwd, task.id, match[1], match[2]);
          ctx.ui.notify(`Read-only PR plan for ${publicationPlan.repo}: ${publicationPlan.branch} → ${publicationPlan.base}; flow ${task.id}; ${publicationPlan.files.length} files: ${publicationPlan.files.join(", ")}. Candidate ${publicationPlan.digest}. To authorize a local commit, push and PR, use /factory publish ${publicationPlan.repo} ${publicationPlan.base} --confirm. No worktrees are managed.`, "warning");
        } catch (error) { publicationPlan = undefined; ctx.ui.notify(`Publication plan blocked: ${String(error)}`, "error"); }
        return;
      }
      if (input.startsWith("publish ")) {
        try {
          if (!task) throw new Error("Reopen the exact flow before publication");
          const match = /^publish ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) ([A-Za-z0-9._/-]+) --confirm$/.exec(input);
          if (!match || !publicationPlan || publicationPlan.repo !== match[1] || publicationPlan.base !== match[2]) {
            throw new Error("First inspect /factory publish-plan OWNER/REPO DEFAULT-BASE in this Pi session, then explicitly confirm the matching target");
          }
          const current = inspectLocalPublication(ctx.cwd, task.id, match[1], match[2]);
          if (current.digest !== publicationPlan.digest || current.branch !== publicationPlan.branch ||
            current.finalDirectory !== publicationPlan.finalDirectory || JSON.stringify(current.files) !== JSON.stringify(publicationPlan.files)) {
            throw new Error("Publication plan changed; inspect a new plan before confirming");
          }
          publicationPlan = undefined; // Never auto-retry a partially successful remote operation.
          const { url, commit } = publishReviewed(ctx.cwd, task.id, match[1], match[2]);
          try { task = recordVerifiedPr(task, url, commit); save(ctx); }
          catch (error) { ctx.ui.notify(`PR verified at ${url} (${commit}), but the project flow could not be updated: ${String(error)}. Do not publish again.`, "warning"); return; }
          ctx.ui.notify(`Verified PR: ${url} (commit ${commit}). No worktrees were managed.`, "info");
        } catch (error) { ctx.ui.notify(`Publication blocked or partial; inspect before retrying: ${String(error)}`, "error"); }
        return;
      }
      if (input.startsWith("bind ")) {
        if (!task) { ctx.ui.notify("Start a flow first.", "error"); return; }
        try { task = bindRun(task, input.slice(5).trim(), sessionAgents); save(ctx); ctx.ui.notify("Observed run bound to this flow.", "info"); }
        catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (input.startsWith("advance ")) {
        if (!task) { ctx.ui.notify("Start a flow first.", "error"); return; }
        const match = /^advance (\S+) (.+?)(?: @evidence (\S+))?$/.exec(input);
        if (!match) { ctx.ui.notify("Use /factory advance <phase> <summary> [@evidence <reference>]", "error"); return; }
        try { task = advance(task, match[1] as Phase, match[2], "Operator", match[3]); save(ctx); }
        catch (error) { ctx.ui.notify(String(error), "error"); }
        return;
      }
      if (!task) { ctx.ui.notify("Start with /factory start <task or GitHub Issue URL>, or /factory list and /factory reopen <exact-id>.", "info"); return; }
      if (ctx.mode !== "tui") { ctx.ui.notify(display(task, sessionAgents).join("\n"), "info"); return; }
      const snapshot = task;
      await ctx.ui.custom<void>((_tui, theme, keybindings, done) => ({
        render(width) {
          const entries = snapshot.entries.slice(-10);
          const lines = ["Falkenwarte · Task flow (self-reported)", "", ...display(snapshot, sessionAgents), "",
            `Milestones${snapshot.entries.length > 10 ? ` (latest 10 of ${snapshot.entries.length})` : ""}:`,
            ...entries.map((entry) => `  ${entry.phase} · ${entry.actor}: ${entry.summary}${entry.evidence ? ` [${entry.evidence}]` : ""}`),
            "", "Escape to return to chat"];
          return lines.map((line) => truncateToWidth(theme.fg("text", line), width));
        },
        handleInput(data) { if (keybindings.matches(data, "tui.select.cancel")) done(); },
      }));
    },
  });

  pi.registerTool({
    name: "factory_launch",
    label: "Factory launch",
    defaultActive: false,
    description: "Launch the reviewed flat pi-workflow once for the exact active flow in the operator-provided clean checkout. No worktree management or GitHub publication.",
    parameters: Type.Object({ flowId: Type.String(), brief: Type.String({ minLength: 20, maxLength: 8000 }) }),
    reachesTools: () => ["workflow_run"],
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        if (!task || task.id !== params.flowId || task.engineRunId) throw new Error("Flow ID does not match an unlaunched active assignment");
        if (!projectSettings(ctx.cwd).autoStart) throw new Error("Automatic execution is not enabled for this project");
        const launch = checkLaunchable(ctx.cwd, task.id);
        if (!task.launch || task.launch.head !== launch.head || task.launch.branch !== launch.branch) throw new Error("Checkout HEAD or branch changed after assignment intake");
        if (!ctx.tools.some((tool) => tool.name === "workflow_run")) throw new Error("pi-workflow is not callable in this session");
        const prompt = `Falkenwarte flow ID: ${task.id}\nOperator task: ${task.title}${task.issue ? `\nIssue URL: ${task.issue}` : ""}\nScoped brief:\n${params.brief}\nWork only in the operator-provided checkout; do not create, delete or merge worktrees. Leave code uncommitted; capture review evidence and report failures honestly.`;
        const outcome = await ctx.executeTool("workflow_run", { workflow: "falkenwarte-flat", task: prompt, detach: true }, { signal });
        const detail = outcome.result.details;
        const runId = detail && typeof detail === "object" && 'runId' in detail ? detail.runId : undefined;
        if (outcome.isError || typeof runId !== "string") throw new Error(`pi-workflow did not provide a verified run ID; inspect /workflow status for possible orphaned work. ${outcome.result.content?.filter((part) => part.type === "text").map((part) => part.text).join(" ") ?? ""}`);
        inspectFlatRun(ctx.cwd, runId);
        if (task?.id !== params.flowId) throw new Error(`Flow view changed after engine launch ${runId}; inspect /workflow status`);
        if (!task.engineRunId) { task = bindWorkflowRun(task, runId); save(ctx); }
        if (task.engineRunId !== runId) throw new Error(`Engine run ${runId} could not be bound to this flow; inspect /workflow status`);
        return { content: [{ type: "text", text: `Engine started: ${runId} for flow ${task.id}. This is not completion. Inspect /workflow ${runId} and verify review/test receipts before reporting delivery.` }], details: { runId, flowId: task.id } };
      } catch (error) {
        return { content: [{ type: "text", text: `Factory launch blocked: ${String(error)}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "factory_finish",
    label: "Factory final review",
    defaultActive: false,
    description: "Build the host-checked local final review package for a completed exact engine run. Never commits, publishes or approves code.",
    parameters: Type.Object({ flowId: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        if (!task || task.id !== params.flowId || !task.engineRunId) throw new Error("No bound engine run for the exact active flow");
        const { directory, receipt } = buildFinalReview(ctx.cwd, task.id);
        return { content: [{ type: "text", text: `Final local review package: ${directory}/index.html. ${receipt.checks.length} host-run checks passed. Advisory reviewer evidence matches ${receipt.candidateDigest}. Human approval and PR delivery remain separate.` }], details: { directory, flowId: task.id, checks: receipt.checks.length } };
      } catch (error) { return { content: [{ type: "text", text: `Final review blocked: ${String(error)}` }], isError: true }; }
    },
  });

  pi.registerTool({
    name: "factory_progress",
    label: "Factory progress",
    defaultActive: false,
    description: "Record a self-reported, evidence-backed milestone for the exact active flow ID; never assume tests or reviews passed. Does NOT write GitHub.",
    parameters: Type.Object({ flowId: Type.String(), phase: Type.Union(phases.map((phase) => Type.Literal(phase))), summary: Type.String({ minLength: 1, maxLength: 500 }), evidence: Type.Optional(Type.String({ maxLength: 300 })) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        task = advanceMatching(task, params.flowId, params.phase as Phase, params.summary, params.evidence);
        save(ctx);
        return { content: [{ type: "text", text: `Recorded ${task.phase} for flow ${task.id.slice(0, 8)}: ${params.summary}` }], details: undefined };
      } catch (error) {
        return { content: [{ type: "text", text: String(error) }], details: undefined, isError: true };
      }
    },
  });
}
