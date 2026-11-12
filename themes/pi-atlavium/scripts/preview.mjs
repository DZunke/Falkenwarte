import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolveColor } from "./colors.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const names = ["atlavium-light", "atlavium"];

function piPackage() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const current = join(agentDir, "install/current-version");
  const candidates = [
    process.env.PI_CODING_AGENT_PACKAGE_DIR,
    join(root, "node_modules/@earendil-works/pi-coding-agent"),
    existsSync(current) && join(agentDir, "install/releases", readFileSync(current, "utf8").trim(), "node_modules/@earendil-works/pi-coding-agent"),
  ];
  const found = candidates.find((candidate) => candidate && existsSync(join(candidate, "dist/core/export-html/index.js")));
  if (!found) throw new Error("Cannot find Pi's installed coding-agent package. Set PI_CODING_AGENT_PACKAGE_DIR to its root.");
  return found;
}

function terminalLines(theme) {
  return [
    theme.bold(theme.fg("accent", " PI  ·  ATLAVIUM ")) + theme.fg("muted", "  theme preview"),
    theme.fg("border", "────────────────────────────────────────────────────────────────────────"),
    theme.bg("userMessageBg", theme.fg("userMessageText", " USER       Review the theme colors and show a code sample.            ")),
    theme.fg("mdHeading", " # Atlavium review") + theme.fg("text", "   Text stays readable on parchment."),
    theme.fg("mdLink", " links") + theme.fg("mdLinkUrl", "  https://example.invalid") + theme.fg("mdCode", "   `const accent = 'gold'`"),
    theme.bg("toolPendingBg", theme.fg("toolTitle", " TOOL       read src/theme.ts                                         ")),
    theme.bg("toolSuccessBg", theme.fg("toolOutput", " SUCCESS    Found color variables.                                     ")),
    theme.bg("toolErrorBg", theme.fg("error", " ERROR      Could not load a missing file.                            ")),
    theme.fg("toolDiffAdded", " + contrast check passed") + theme.fg("toolDiffRemoved", "   - avoid unreadable accents"),
    theme.fg("syntaxKeyword", " const") + theme.fg("syntaxVariable", " accent") + theme.fg("syntaxOperator", " =") + theme.fg("syntaxString", " 'gold'") + theme.fg("syntaxPunctuation", ";"),
    theme.fg("success", " ✓ Success") + theme.fg("warning", "   ! Warning") + theme.fg("error", "   × Error"),
    theme.fg("muted", "muted context") + theme.fg("dim", "   decorative dim text"),
  ];
}

export async function generatePreviews(outputDir = join(root, "previews/generated")) {
  const pi = piPackage();
  const moduleUrl = (relative) => pathToFileURL(join(pi, "dist", relative)).href;
  const { loadThemeFromPath, setRegisteredThemes, setThemeJsonValidator } = await import(moduleUrl("modes/interactive/theme/theme.js"));
  const { validateThemeJson } = await import(moduleUrl("modes/interactive/theme/theme-schema.js"));
  const { ansiLinesToHtml } = await import(moduleUrl("core/export-html/ansi-to-html.js"));
  const { exportFromFile } = await import(moduleUrl("core/export-html/index.js"));
  setThemeJsonValidator(validateThemeJson);

  const themes = names.map((name) => loadThemeFromPath(join(root, "themes", `${name}.json`), "truecolor"));
  setRegisteredThemes(themes);
  mkdirSync(outputDir, { recursive: true });
  for (const theme of themes) {
    const name = theme.name;
    const json = JSON.parse(readFileSync(join(root, "themes", `${name}.json`), "utf8"));
    const lines = terminalLines(theme);
    const foreground = resolveColor(json, "text");
    const background = resolveColor(json, "pageBg");
    const terminalHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${name} terminal preview</title><style>html,body{margin:0;background:${background};color:${foreground}}body{padding:36px;font:16px/1.65 "DejaVu Sans Mono",monospace}.terminal{display:inline-block;min-width:930px;padding:24px;background:${resolveColor(json, "cardBg")};border:1px solid ${resolveColor(json, "border")};border-radius:10px}.ansi-line{white-space:pre}</style><main class="terminal">${ansiLinesToHtml(lines)}</main></html>`;
    writeFileSync(join(outputDir, `${name}-terminal.ansi`), `${lines.join("\n")}\n`);
    writeFileSync(join(outputDir, `${name}-terminal.html`), terminalHtml);
    await exportFromFile(join(root, "fixtures/preview-session.jsonl"), {
      outputPath: join(outputDir, `${name}-export.html`), themeName: name,
    });
  }
  return names.flatMap((name) => [`${name}-terminal.html`, `${name}-export.html`]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--output-dir");
  const outputDir = index >= 0 ? process.argv[index + 1] : undefined;
  if (index >= 0 && !outputDir) throw new Error("--output-dir requires a path");
  const files = await generatePreviews(outputDir && resolve(outputDir));
  console.log(`Generated previews: ${files.join(", ")}`);
}
