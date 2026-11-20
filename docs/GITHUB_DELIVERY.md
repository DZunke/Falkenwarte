# GitHub-Prüfungen und Releases

GitHub prüft Pull Requests vor dem Merge. Für die Veröffentlichung übernimmt der Releaseworkflow das Image eines bereits geprüften Commits.

## Lokale Arbeit und Pull Requests

Die lokale Praxis und die Make-Ziele stehen in [Lokal entwickeln und testen](TESTING.md). GitHub führt für Pull Requests gegen `main` den Workflow [quality.yml](../.github/workflows/quality.yml) auf dem exakten Head-Commit aus. Die QA verwendet keine produktiven Zugangsdaten und prüft T3- und Decisions-Verkehr gegen die isolierten Testdienste.

| Job | Prüfung |
|---|---|
| `commit-policy` | Prüft Commit-Identität und Conventional-Commit-Titel. |
| `static-quality` | Composer, Verträge, Architektur, Symfony-Container, PHP-CS-Fixer, PHPStan und Frontend. |
| `docs-quality` | Dokumentationslinks und statischer Handbuchbau. |
| `background-functional` | Gezielte Background-Funktionstests mit dem echten Kernel. |
| `build` | Erstellt und inventarisiert das Linux-App-Image des geprüften Commits. |
| `e2e` | Prüft das Image über Browser-, JSON-HTTP- und MCP-Schnittstellen sowie beim Plugin-Image-Upgrade. |
| `quality-gate` | Besteht nur, wenn alle sechs vorherigen Jobs erfolgreich abgeschlossen sind. |

Der Schutz für `main` verlangt den Statuscheck `quality-gate`. Bei einem manuellen QA-Dispatch wird zusätzlich die erwartete SHA mit dem ausgecheckten Commit verglichen. Der Workflow lädt das App-Image und bereinigte Acceptance-Belege als zeitlich begrenzte Actions-Artefakte hoch.

Pull Requests aus Forks verwenden denselben `pull_request`-Workflow mit Leserechten und ohne produktive Secrets. GitHub kann eine erste Ausführung zur Freigabe zurückhalten. Der Releaseworkflow reagiert ausschließlich auf einen erfolgreichen Push-QA-Lauf aus demselben Repository auf `main` und prüft vor der Veröffentlichung, dass Tag, Commit und QA-Lauf zusammenpassen.

## Maintainer-Releaseablauf

Ein erfolgreicher QA-Lauf nach einem Push auf `main` startet den Releaseworkflow. [Workflowdefinition](../.github/workflows/release.yml) Er bestätigt zuerst, dass der getestete Commit weiterhin `main` ist, und lässt Release Please Änderungen aus den Conventional Commits in einem Release-Pull-Request vorbereiten.

Für diesen Release-Pull-Request startet der Workflow eine weitere QA mit der exakten PR-SHA. GitHub kann den `pull_request`-Lauf zunächst auf `action_required` setzen, wenn der PR durch `GITHUB_TOKEN` erstellt oder aktualisiert wurde. Prüfe die Änderungen und den Head-Commit und gib den angehaltenen Lauf in GitHub frei oder mit `gh api --method POST repos/DZunke/Falkenwarte/actions/runs/RUN_ID/approve`. Der Release-PR benötigt sowohl diese PR-Prüfung als auch das Ergebnis des SHA-Dispatchs.

Nach dem Merge prüft die QA den neuen `main`-Commit. Wenn Release Please den dazugehörigen Tag erstellt, veröffentlicht der Maintainer-Workflow genau das Image aus dem erfolgreichen Push-QA-Lauf, dessen SHA zum Tag passt. Vor dem Push prüft er Image-ID, Versions- und Quellrevision sowie den Acceptance-Bericht.

Der veröffentlichte Release enthält das Manifest mit Commit, Tag, Image-ID und Registry-Digest, das Browser-Acceptance-Archiv und das Softwareinventar. Das Image wird unter `ghcr.io/dzunke/falkenwarte` veröffentlicht. Der verifizierte Digest steht im Manifest.

## Läufe und Nachweise ansehen

```bash
gh pr checks --watch
gh run list --workflow quality.yml
gh run list --workflow release.yml
gh run view RUN_ID --json headSha,status,conclusion,jobs
gh release view
```

Lokale Belege landen unter `var/ci-evidence/`, Actions-Artefakte beim jeweiligen Workflow-Lauf und veröffentlichte Nachweise am Release. Wie diese Ergebnisse aufbewahrt werden, beschreibt der [QA-Einstieg im Repository](../qa/README.md).
