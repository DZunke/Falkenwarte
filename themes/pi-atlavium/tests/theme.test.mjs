import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contrast, resolveColor } from "../scripts/colors.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const themes = Object.fromEntries(["atlavium", "atlavium-light"].map((name) =>
  [name, JSON.parse(readFileSync(resolve(root, `themes/${name}.json`), "utf8"))],
));

function requireContrast(theme, foreground, background, minimum = 4.5) {
  const ratio = contrast(resolveColor(theme, foreground), resolveColor(theme, background));
  assert.ok(ratio >= minimum, `${theme.name}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
}

test("Pi package exposes a native light/dark pair and no executable extensions", () => {
  assert.deepEqual(manifest.pi, { themes: ["./themes/atlavium-light.json", "./themes/atlavium.json"] });
  for (const [name, theme] of Object.entries(themes)) {
    assert.equal(theme.name, name);
    assert.equal(theme.$schema, "https://pi.dev/schemas/theme.schema.json");
    assert.equal(theme.appearance, name === "atlavium" ? "dark" : "light");
  }
  assert.deepEqual(Object.keys(themes.atlavium.colors).sort(), Object.keys(themes["atlavium-light"].colors).sort());
});

for (const theme of Object.values(themes)) {
  test(`${theme.name}: all colors resolve and primary UI text meets WCAG AA contrast`, () => {
    for (const token of [...Object.keys(theme.colors), ...Object.keys(theme.export)]) resolveColor(theme, token);

    const panels = ["userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "selectedBg"];
    for (const background of panels) {
      for (const foreground of ["text", "toolOutput", "accent", "mdLink", "muted"]) {
        requireContrast(theme, foreground, background);
      }
    }
    for (const [foreground, background] of [
      ["text", "pageBg"], ["text", "cardBg"], ["text", "infoBg"],
      ["dim", "pageBg"], ["dim", "cardBg"], ["dim", "infoBg"],
      ["userMessageText", "userMessageBg"], ["customMessageText", "customMessageBg"],
      ["customMessageLabel", "customMessageBg"], ["toolTitle", "toolPendingBg"],
      ["success", "toolSuccessBg"], ["error", "toolErrorBg"], ["warning", "toolPendingBg"],
      ["mdHeading", "cardBg"], ["mdQuote", "infoBg"], ["mdCodeBlock", "cardBg"],
      ["toolDiffAdded", "cardBg"], ["toolDiffRemoved", "cardBg"],
    ]) {
      requireContrast(theme, foreground, background);
    }
  });
}
