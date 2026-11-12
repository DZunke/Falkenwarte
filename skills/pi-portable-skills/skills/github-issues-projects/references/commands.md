# GitHub CLI command reference

These examples were checked against `gh` 2.103.0 and the [Issues](https://cli.github.com/manual/gh_issue) and [Projects](https://cli.github.com/manual/gh_project) manuals. Check `gh <subcommand> --help` on other installed versions. Replace placeholders deliberately; the Project owner can differ from the repository owner. The examples do not grant permission to mutate a remote repository.

## Read before a change

```sh
gh --version
gh auth status --active                  # never pass --show-token or paste its output into a repo
gh repo view OWNER/REPO --json nameWithOwner,url
gh issue list --repo OWNER/REPO --state all --limit 100 --json number,title,state,url,labels
gh issue view 42 --repo OWNER/REPO --json number,title,body,state,url,projectItems
gh project view 7 --owner PROJECT_OWNER --format json
gh project field-list 7 --owner PROJECT_OWNER --format json
gh project item-list 7 --owner PROJECT_OWNER --limit 100 --format json
```

`gh issue list` defaults to open issues and a short page: specify state and limit when checking duplicates, but do not claim a truncated listing proves absence. Project commands use `--format json`, not the Issue commands' `--json fields`. The [Projects manual](https://cli.github.com/manual/gh_project) states that a token needs the `project` scope; `gh auth refresh -s project` changes authorization and must be approved by the user. Some hosts or organization policies can still reject access.

## Authorized write examples

Prepare a short body in a temporary file outside this portable profile, or use a quoted heredoc through stdin. After the user approves the target and content:

```sh
gh issue create --repo OWNER/REPO --title "Outcome: example" --body-file /path/to/reviewed-body.md
gh project item-add 7 --owner PROJECT_OWNER --url https://github.com/OWNER/REPO/issues/42 --format json
```

Do not assume `--project` on `gh issue create` refers to the intended owner or number. First compare the Project's existing items and ensure the Issue is not already linked. To change one Project field, inspect its available names/options and the current item before using this *example*:

```sh
gh project item-edit 7 --owner PROJECT_OWNER --url https://github.com/OWNER/REPO/issues/42 --field "Status" --value "In Progress"
```

Status names vary by Project. Newer `gh` versions also accept explicit Project, item, field and option node IDs; prefer the named form only after verifying the installed CLI supports it. Re-read the item with `gh project item-list 7 --owner PROJECT_OWNER --format json` and confirm the resulting status. If the create succeeded but item-add failed, report the new Issue URL and the failed step; do not create the Issue again.

Never use `gh auth status --show-token`, `gh api -H 'Authorization: ...'`, force-push, `gh issue delete`, `gh project delete` or automatic retries of remote mutations in this workflow. The [GitHub Projects API guide](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) documents further GraphQL operations, but use the CLI's purpose-built commands unless a specific authorized task needs the API.
