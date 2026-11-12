# Update and capture changes

There are two directions here, and neither is automatic. `apply` moves reviewed repository values into Pi; `capture` moves selected local changes back into the checkout for your review. A Git pull updates the checkout separately and is always your choice.

## Apply a later checkout revision

After reviewing changes from Git or another copy of the repository:

```sh
node scripts/portable-pi.mjs plan
node scripts/portable-pi.mjs update
```

`update` first applies the checked-out profile, runs `pi install` for each exact remote pin (including packages not yet cached), then runs `pi update --extensions`. Pinned Git commits and exact npm versions remain pinned; this command does not fetch unreviewed newer footer or subagent revisions. If you change a managed preference locally between applications, `plan` reports a conflict and `update` stops. Choose between capturing the local value and deliberately running `update --force`. The force option overrides conflicts, not the package pinning policy. Pi itself is never upgraded by these commands.

## Bring local customization into Git

For example, after changing Pi's editor padding with `/settings` or saving a new `/footer` layout:

```sh
node scripts/portable-pi.mjs capture --dry-run
node scripts/portable-pi.mjs capture
# When this checkout is a Git repository:
git diff -- config/ personalities/ extensions/pi-footer/
git status --short
# Stage and commit only what you approve.
```

`capture` writes only reviewed profile fields: keys already in `config/settings.json`, the declared MCP servers, the pinned third-party package sources, personality source paths and a default personality declared inside this checkout, and the footer JSON. The personality Markdown is already read from the checkout and does not need copying. Other packages, third-party skills and local extensions are left alone; a count of unmanaged packages is printed. A dry run only lists changed profile files, not values. For a new standard Pi setting, explicitly add it with `capture --setting NAME`, or edit `config/settings.json` yourself. Inspect both the diff and the values before committing, especially free-text footer widgets.

## Change a third-party version deliberately

Run `node scripts/portable-pi.mjs check-updates` to compare every configured Git source to its upstream HEAD and every exact npm version to the registry's latest version. This is read-only and needs Git or npm plus network access. Review the upstream diff and release notes before advancing a pin: for the current [wobondar/pi-footer](https://github.com/wobondar/pi-footer) source, compare its pinned commit with the proposed SHA, then run `node scripts/portable-pi.mjs pin pi-footer <reviewed-40-character-SHA>`. For the pinned `pi-subagents` npm package pass the exact reviewed version to `pin pi-subagents <version>` instead. `pin` verifies the proposed revision still equals the current upstream candidate and changes only [`config/packages.json`](../config/packages.json); it never installs or commits anything. Then run `plan`, `update`, and `pi list`. `update` applies the new pin, invokes `pi update --extensions`, installs locked runtime dependencies for local packages when declared, runs each local package's `test`/`smoke` scripts, and starts Pi in offline RPC mode to check that `/personality`, `/skills`, `/footer`, `/falkenwarte-usage`, `/factory` and pi-subagents still load. The local `agent-browser` npm dependency is pinned in [`skills/pi-portable-skills/package-lock.json`](../skills/pi-portable-skills/package-lock.json); review that lockfile and the upstream release separately before updating it. If a test fails, stop and inspect the local backup and profile before proceeding. To add a completely new package, add its exact pinned source to `remote` and review it before applying. `capture` can record a changed pin for an existing managed package, but never discovers new packages silently.

If a capture refuses a secret, path or unsupported MCP configuration, remove the private value from the proposed profile rather than weakening the guard. For more detail see [profile ownership](portable-profile.md) and [security and recovery](security-and-recovery.md). Keep this workflow up to date when Pi's settings format changes.
