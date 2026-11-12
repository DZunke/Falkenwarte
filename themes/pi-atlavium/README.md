# pi-atlavium

`pi-atlavium` packages matching light and dark Atlavium palettes as standalone Pi themes. Both use parchment surfaces and restrained gold accents; the dark variant keeps its leather-dark foundation. The package has no executable extension code: Pi loads the JSON themes directly, independently of any personality, agent, or Waldemar package.

## Install and select

```sh
pi install /absolute/path/to/pi-extensions/themes/pi-atlavium
```

Select the **atlavium-light/atlavium** automatic pair in Pi's `/settings` → **Theme**, or set `"theme": "atlavium-light/atlavium"` in `~/.pi/agent/settings.json`. Pi picks the light variant for light terminals and the dark variant for dark terminals, including when the terminal changes appearance. For one launch, use `pi --use-theme atlavium-light/atlavium`; `pi --use-theme atlavium` keeps dark mode regardless of terminal appearance. Run `/reload` after adding or editing packaged themes.

The package contains [`themes/atlavium-light.json`](themes/atlavium-light.json) and [`themes/atlavium.json`](themes/atlavium.json). The dark palette originated in the former Waldemar package; a few text colors were brightened after contrast and export-preview checks. Other themes can coexist, but loading another package with the same theme names causes a collision.

See [palette and maintenance](docs/palette.md) for color decisions and contrast checks, and [visual previews](docs/previews.md) for terminal and Pi HTML-export screenshots. Run `npm test` for palette checks and `npm run visual:test` for four screenshot regressions. Choose another theme before removing the package so your saved selection still resolves.
