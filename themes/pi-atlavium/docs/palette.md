# Palette and maintenance

Atlavium has two source files: [`atlavium-light.json`](../themes/atlavium-light.json) for light terminals and [`atlavium.json`](../themes/atlavium.json) for dark terminals. Pi uses semantic color roles, so both files define the same `colors` keys. Shared values live under `vars`; `export` controls backgrounds in Pi's HTML session exports.

## What should you change?

For a warmer accent, adjust `vars.gold` in the variant you want to tune, then check any related values such as `darkGold` or `amber`. `colors.accent`, `mdLink`, and some syntax roles reference those variables. For surfaces, change `userMessageBg`, `customMessageBg`, and the `tool*Bg` roles deliberately: each has foreground text that must remain readable. Do not add arbitrary top-level keys such as `description`; Pi validates themes against its strict [theme schema](https://pi.dev/schemas/theme.schema.json). The installed Pi `docs/themes.md` covers other supported color formats and terminal behavior.

The dark file began as the Atlavium palette from the old Waldemar package. Its `mediumGray`, `ruby`, and `dimGray` values were brightened slightly after contrast checks and inspection of Pi's HTML export. The light file uses darker ink and gold on pale parchment; it is not an inverted copy. Both variants identify their intended `appearance` explicitly.

## How are colors checked?

Run `npm test` in the package directory. The tests check package registration, matching role sets, color references, and at least **4.5:1** contrast for primary text, muted text, accent/link text, user and tool messages, status colors, diff colors, and export text on the panels where those roles appear. Dim text is checked on the main export backgrounds; tinted tool-success panels are not treated as general-purpose dim-text surfaces. These checks use hex sRGB values and do not replace a full accessibility review in every terminal renderer.

After changing colors, run `npm run preview` and inspect the generated pages in `previews/generated/`. Then run `npm run visual:test`; if screenshots differ, inspect them before updating the baselines as described in [visual previews](previews.md). Pi needs `/reload` to pick up changed package themes. A terminal's truecolor support can still change how the palette looks outside the browser preview.

To roll back, select Pi's `system` theme (or remove the saved `theme` setting) before removing `pi-atlavium` from your Pi packages. The old Waldemar repository remains a historical source; loading it alongside this package would give Pi duplicate `atlavium` names unless one copy is excluded. Keep both palette files and their tests in step when changing semantic roles.
