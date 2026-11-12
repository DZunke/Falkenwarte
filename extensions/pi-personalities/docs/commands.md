# Commands and shell selection

The configured default applies to each new main Pi session; child sessions do not inherit it. Set it once through the picker or a named command; use a flag or environment variable for a temporary process override:

```sh
pi --personality reviewer
PI_PERSONALITY=reviewer pi
```

`export PI_PERSONALITY=reviewer` overrides the saved default in subsequent Pi processes launched from that shell and their child processes; `unset PI_PERSONALITY` restores the saved default. `pi --personality off` disables a personality for that process even when a default or environment variable exists. A command inside Pi cannot change its parent shell.

| Command | Effect |
| --- | --- |
| `/personality` or `/personality list` | Show available profiles and the active name. |
| `/personality use reviewer` | Select a profile for the current Pi session. `/personality reviewer` is shorthand. |
| `/personality default` | Choose the persistent default from an interactive list of available personalities. |
| `/personality default reviewer` | Save reviewer as the default for future sessions and activate it now. |
| `/personality off` | Disable the active profile in this session. |
| `/personality import /path/to/reviewer.md` | Copy a reviewed file to your Pi personality directory without replacing an existing name. Relative paths resolve from Pi's working directory. |
| `/personality reload` | Rescan the library and sources; clear the selection if its file disappeared. |
| `/skills` | Show skills that are both discovered and active for the selected personality; report allowed names not installed here. |

For example, after adding a source to `personalities.json`, run `/personality reload`, inspect `/personality list`, then use `/personality default reviewer` if every new session should use it. The default is saved in the Pi agent directory's `personalities.json`; its `sources` and unrelated fields are retained. `/personality use` and `/personality off` affect only the current session. A fresh main session uses the priority `--personality` > `PI_PERSONALITY` > saved default. A pi-subagents child does not inherit either the saved default or the shell selection: its explicit child identity (if fixed) wins; otherwise `--personality` or an `extensionBindings` selection may choose a non-Waldemar identity. Each selection replaces the previous personality section rather than stacking prompts; `/skills` and the next model run use the new role's `skills.allow`/`skills.deny` rules immediately. See [skill selection and its limits](format-and-sources.md).

An unknown CLI or environment override does **not** fall back to a different profile; Pi reports it and leaves the process without an active personality. An invalid or unavailable saved default is warned about and not activated. Invalid source files are skipped and reported. `/personality reload` is necessary after file edits because prompts are cached in memory for the current session.

See [the file format and source configuration](format-and-sources.md) to add roles, or [subagent integration](subagents.md) for child sessions. If selection behavior changes, update this command reference with it.
