# Security and recovery

Pi configuration is not the same as a portable backup. Your agent directory may contain authentication tokens, provider definitions, session transcripts, extensions installed by other programs and paths that only exist on one machine. The setup never scans that directory for files to copy. It only reads the managed settings, personality sources, declared MCP servers and footer layout when you explicitly run `capture`.

## What is excluded?

Never add `auth.json`, `mcp-auth.json`, OAuth state, model caches, sessions, `.env` files, credentials or private keys to this repository. [`.gitignore`](../.gitignore) blocks common names as an extra precaution, but a differently named secret can still be staged manually. The export guard refuses private-looking field names, recognizable credentials, absolute/tilde paths, and URLs outside the restricted MCP server format. It cannot prove an arbitrary free-text footer field or a relative argument contains no secret. **Review every captured diff before committing or publishing.** Do not run Git with `--all` just because a capture succeeded.

The profile stores the Sentry MCP endpoint, not its login; it stores the `codegraph` executable name, not its machine-specific installation path. The pinned `pi-footer` source is third-party executable extension code: review new commits before changing its pin. Pi installs the pinned code on first startup or `pi update --extensions`, which requires network access and can run package installation steps. Unmanaged packages and Herdr-generated files are not copied.

## If apply reports a conflict

First run `plan`. Compare the named key in your Pi agent directory to its repository profile value. Use `capture --dry-run` to see which profile files would change, then `capture` and inspect the diff if the local choice is correct. Alternatively edit the repository profile deliberately and apply it. `apply --force` overrides managed conflicts; unrelated fields remain untouched. There is no automatic merge of two competing values.

## Recover earlier local files

When `apply` replaces a file, it saves the original in `portable-pi-backups/<timestamp>/` beneath the Pi agent directory, with private file permissions. Backups are not pushed to Git and may include your **local** secrets, so treat that directory as private. For example, to restore the earlier settings, exit Pi, copy the backup named `settings.json` over the agent directory's `settings.json`, and run `plan` again. A later apply sees a local conflict instead of silently restoring the repository version. The script does not perform an automatic rollback if a disk write fails midway; inspect the printed backup directory and restore affected files yourself. New files have no earlier version to restore and can be removed manually after checking what else uses them.

`capture` updates only reviewed profile files under [`config/`](../config/) and [`extensions/pi-footer/`](../extensions/pi-footer/), not the live Pi configuration or Git history. Inspect or revert an unwanted capture with ordinary Git commands before committing; this script never creates commits. Keep these cautions with the bootstrap guide as your setup changes.
