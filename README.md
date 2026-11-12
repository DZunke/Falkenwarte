# Portable Pi setup

This repository holds the portable part of a personal Pi setup. Install Pi and Node.js 22 or newer yourself, then use the checkout to configure Pi on each machine. The checkout can live anywhere: the setup computes Pi's resource paths when you apply it, rather than recording this machine's home directory in Git.

## What belongs where?

- **Repository profile:** [`config/`](config/) holds reviewed Pi preferences, package declarations, personality sources, MCP server definitions and the footer layout. [`personalities/`](personalities/) holds Waldemar's profile and background plus Brunhilde Nordwald's and Albert Metzler's specialist profiles. Waldemar is selected by default on a new installation; `/personality default` opens the chooser for another profile.
- **Packages:** [`extensions/pi-personalities/`](extensions/pi-personalities/), [`themes/pi-atlavium/`](themes/pi-atlavium/) and [`skills/pi-portable-skills/`](skills/pi-portable-skills/) load directly from this checkout. The skill package installs an exact, locked `agent-browser` CLI and three original DDD/domain-story skills. The footer configuration lives in [`extensions/pi-footer/`](extensions/pi-footer/). The third-party `pi-footer` and `pi-subagents` packages are pinned to a Git commit and an exact npm version; review upstream changes before moving either pin.
- **Machine state:** Pi credentials, OAuth tokens, sessions, generated integrations, installed dependencies and backups stay in the Pi agent directory. They are not copied into this repository.

Pi reads local packages relative to its agent-directory settings file. The script in [`scripts/portable-pi.mjs`](scripts/portable-pi.mjs) writes those relative paths and merges the declared preferences into your existing settings. It leaves unrelated packages and settings alone. If a managed value has changed locally, a later apply refuses to overwrite it unless you deliberately use `--force`.

## First use

From this checkout, with Pi and Node already installed:

```sh
node scripts/portable-pi.mjs plan
node scripts/portable-pi.mjs update
pi
```

`plan` reports planned keys and conflicts without changing files. `update` applies the profile, runs `pi update --extensions`, installs locked local dependencies when present, runs the owned packages' tests and checks their integration with Pi. To change configuration without downloading or testing packages, use `apply` instead. Previous local files are backed up before replacement. These commands **do not update Pi itself**. On Windows, run the same Node commands in PowerShell from the checkout; no Bash or Unix home path is required. See the [bootstrap procedure](docs/bootstrap.md) for verification and rollback.

## Why not automatically synchronize everything?

A Pi agent directory may contain credentials, machine-specific executables and extensions managed by other software. Copying it wholesale into a future GitHub repository would be unsafe. This setup manages only the files and fields described in the [profile reference](docs/portable-profile.md). For example, the existing Herdr-generated extension is owned by Herdr, not by this checkout. Other installed skills still need their own installation on a new machine. The four skills in this checkout travel with it; Chromium may need a separate one-time download.

Local changes return to the checkout only when you invoke `capture`. Inspect the proposed changes first with `capture --dry-run`, then inspect the resulting Git diff and commit manually. There is no automatic pull, push, commit or reverse synchronization. The [update and capture guide](docs/updates-and-capture.md) explains the exact sequence; [security and recovery](docs/security-and-recovery.md) explains the safeguards and their limits.

The [footer guide](docs/footer.md) documents the powerline layout and active-personality indicator. [Subagent integration](extensions/pi-personalities/docs/subagents.md) explains Brunhilde, Albert and identity bindings. Package-specific usage lives in the three package READMEs linked above. To check for newer third-party revisions, run `node scripts/portable-pi.mjs check-updates`; see the [upgrade sequence](docs/updates-and-capture.md) before changing a pin. Tests: `node --test tests/portable-pi.test.mjs`, `cd extensions/pi-personalities && npm test`, `cd themes/pi-atlavium && npm test`, and `cd skills/pi-portable-skills && npm test`.
