# Visual previews and regression checks

The preview fixture shows a user message, headings, links, code, a tool result, and terminal status colors without accessing a real Pi session or making a model request. [`../fixtures/preview-session.jsonl`](../fixtures/preview-session.jsonl) contains fixed test content and timestamps so the screenshots do not depend on your conversation history.

## Generate previews

From `themes/pi-atlavium/`, run:

```sh
npm run preview
```

For each variant, `previews/generated/` receives a `*-terminal.ansi` file, a browser-viewable `*-terminal.html`, and a `*-export.html`. [`../scripts/preview.mjs`](../scripts/preview.mjs) renders terminal color samples with Pi's own `Theme` ANSI methods and ANSI-to-HTML converter. It builds HTML exports with Pi's `exportFromFile()` and the fixed session fixture, so the export pages use Pi's actual HTML template and theme variables. The terminal page is a deterministic ANSI sample, **not** a screenshot of Pi's entire interactive TUI.

The script locates the installed Pi package from `node_modules`, the managed Pi installation, or `PI_CODING_AGENT_PACKAGE_DIR`. It requires a local Pi installation but does not call a provider.

## Compare screenshots

```sh
npm run visual:test
```

This command regenerates the preview pages, uses `agent-browser` to capture all four at a fixed 1280×900 viewport, and compares the PNG files byte-for-byte with [`../previews/baselines/`](../previews/baselines/). New screenshots are saved in ignored `previews/current/`. The two HTML-export screenshots cover the whole rendered page; terminal screenshots use the fixed viewport.

The checked-in references are [light terminal](../previews/baselines/atlavium-light-terminal.png), [light export](../previews/baselines/atlavium-light-export.png), [dark terminal](../previews/baselines/atlavium-terminal.png), and [dark export](../previews/baselines/atlavium-export.png). Open them side by side with `previews/current/` when a comparison fails. Update them only when the new appearance is intentional:

```sh
npm run visual:update
npm run visual:test
```

`agent-browser` (or a binary selected through `AGENT_BROWSER_BIN`) and its Chromium installation are required for screenshot checks, not for the theme package itself. Pixel-exact snapshots can also change when Chromium, fonts, Pi's HTML template, or the operating system changes; pin those dependencies in CI and review baseline updates. Contrast tests in `npm test` remain independent of the browser.

Keep preview samples representative when you add new theme roles, and do not substitute private sessions for the checked-in fixture.
