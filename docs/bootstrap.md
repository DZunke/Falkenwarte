# Bootstrap a machine

Use this procedure after Pi and Node.js 22 or newer are already available (the pinned browser CLI requires Node >=22). Pi uses the default agent directory at `~/.pi/agent`, or the directory selected by `PI_CODING_AGENT_DIR`. The script follows that same choice; pass `--agent-dir DIR` to target another directory deliberately.

## Apply the checkout

1. Clone or copy the repository to any path. Work from its root; it does not need to live in your home directory.
2. Run `node scripts/portable-pi.mjs plan`. If it reports conflicts, inspect the existing Pi settings before doing anything else. A first run also treats an existing, different managed value as a conflict.
3. Run `node scripts/portable-pi.mjs update`. This applies managed configuration, installs the pinned third-party packages through Pi, and tests the owned packages and extension integration. It does not install Pi, change credentials, or create a Git commit.
4. Run `pi` to load the three checkout packages and select `atlavium-light/atlavium`. Run `pi list` to check the configured packages. In Pi, run `/personality list`, `/skills`, `/footer` and `/subagents-doctor` to inspect the extensions. The doctor should discover three `pi-personalities` package agents; see [subagent integration](../extensions/pi-personalities/docs/subagents.md) to call Brunhilde or Albert. The [portable skills package](../skills/pi-portable-skills/README.md) includes the pinned browser CLI; if its Chromium runtime is absent, install that separately with `node skills/pi-portable-skills/scripts/browser.mjs install`. Waldemar is selected on first start without a flag; `/personality default` opens the persistent personality chooser, and `pi --personality <name>` remains a one-process override.

On Windows, use PowerShell commands such as `node .\scripts\portable-pi.mjs plan` and `node .\scripts\portable-pi.mjs update`. The script uses Node's native path handling; Windows behavior is covered by path-level tests but has not been exercised with a Windows Pi installation. Pi's package cache needs network access for a first installation of the Git-pinned footer, the npm-pinned subagents package and the locked browser CLI dependency. Starting Pi offline can leave that extension unavailable until a later update.

Use `node scripts/portable-pi.mjs apply` instead when you only want to write configuration and postpone package installation or tests until later. `update` does not upgrade the Pi executable or advance pinned revisions; see [updating the profile](updates-and-capture.md). To check the executable separately, run `pi update --self` when its installer supports it.

## What if Pi is already customized?

`plan` names managed values that differ; it never prints their contents, because existing settings could contain secrets. Compare your local file with the relevant file under [`config/`](../config/) yourself. Use `capture --dry-run` and `capture` to adopt safe local edits into the profile, edit the profile to keep your desired changes, or use `apply --force` to replace managed values intentionally. `--force` does not delete unrelated settings, MCP servers, package declarations or local personality sources.

After applying to an active session, use Pi's `/reload`. If your configured provider or model is not available on the new machine, sign in using Pi's normal login flow or change `defaultProvider` and `defaultModel` in [`config/settings.json`](../config/settings.json) before applying. Secrets are never provided by this repository.

For rollbacks and file safety, see [security and recovery](security-and-recovery.md). If your configuration evolves, keep this guide and the profile definitions in step.
