# Falkenwarte auf GitHub ausliefern

Das Repository `DZunke/Falkenwarte` enthält den Anwendungscode, die Abnahmesuite und den Releaseprozess. In der privaten Installation laufen die Verwaltung von Tickets und die T3-Aufträge mit den dort eingerichteten Zugängen. GitHub-Zugangsdaten werden ausschließlich während der Entwicklung und für die Veröffentlichung des Falkenwarte-Images benötigt.

## Änderungen prüfen und mergen

Ein Pull Request gegen `main` benennt im Titel die Änderung als Conventional Commit und nennt im Text die betroffenen Anforderungen, Betriebsfolgen und tatsächlichen Prüfergebnisse. Der Titel wird beim Squash-Merge zum Commit-Titel. Die Branchregel verlangt den aktuellen Stand von `main`, aufgelöste Diskussionen und den erfolgreichen Check `quality-gate`. Sie gilt auch für Repository-Administratoren.

Die QA verwendet die Commit-ID des PR-Heads. Der Build erzeugt das Linux-App-Image und übergibt dessen lokale Image-ID und das gespeicherte Image an den E2E-Job. Vor dem Start von Playwright prüft dieser die geladene ID. Das Testnetz startet die Anwendung, die beiden externen Mockdienste und den Chromium-Runner. Entwickler können einen fehlerhaften Test über die Commit-ID und die Fall-ID wiederfinden. Änderungen des PR-Titels lösen die Titelprüfung erneut aus.

| Check | Prüfgegenstand |
|---|---|
| `commit-policy` | Commit-ID und PR-Titel mit commitlint |
| `static-quality` | Composer, Anwendungskonfiguration, Architekturgrenzen, Verträge, Formatierung, PHPStan und generierter TypeScript-Client |
| `docs-quality` | Markdown-Verweise und statischer HTML-Build |
| `background-functional` | Wiederzustellung an einen unterbrochenen Messenger-Worker |
| `build` | Linux-App-Image aus dem geprüften Quellstand |
| `e2e` | Öffentliche Browser-, HTTP- und MCP-Abläufe gegen das gebaute Image |
| `quality-gate` | Alle sechs Check-Ergebnisse müssen `success` lauten |

Zur Abnahme der Branchregel lässt sich derselbe Workflow mit `probe=fail-e2e` oder `probe=skip-e2e` auf einer Prüfbranch starten. Der erforderliche Gesamtstatus muss in beiden Fällen fehlschlagen. Der Dispatch verlangt die erwartete SHA und prüft sie nach dem Checkout. Siehe [QA-Workflow](../.github/workflows/quality.yml).

## Release-PR und Image

Nach erfolgreicher QA eines Pushs auf `main` prüft der Releasejob, ob der getestete Commit weiterhin der aktuelle Branchstand ist. Release Please wertet die Conventional Commits aus und pflegt `version.txt`, den Changelog und das Versionsmanifest in einem eigenen Pull Request. Die Ausgangsversion für die erste Auswertung ist 0.1.0. Der Bootstrap-Commit ist in der Release-Please-Konfiguration festgeschrieben.

Für dieses Repository wird der im Konzept vorgesehene explizite Dispatch mit dem kurzlebigen `GITHUB_TOKEN` verwendet. Der Releasejob ermittelt Branch und SHA des von Release Please zurückgegebenen PRs über die GitHub-API und startet darauf denselben QA-Workflow. Das API-Recht zur Erstellung von Pull Requests durch GitHub Actions ist in den Repository-Einstellungen aktiviert. Die QA läuft mit Leserechten. Schreibrechte für Releases, Pakete und PRs liegen bei den jeweiligen vertrauenswürdigen Hauptbranchjobs.

Der Merge des geprüften Release-PRs löst auf `main` einen weiteren vollständigen QA-Lauf aus. Meldet Release Please danach `release_created`, lädt die Veröffentlichung das Image aus genau diesem Lauf. Sie prüft den Tag-Commit, die Image-ID und das OCI-Label `org.opencontainers.image.revision`, bevor sie den Versionstag in GHCR veröffentlicht. Die Datei `image-manifest.json` an der GitHub-Release enthält Commit, Tag, Image-ID und Registry-Digest. Der Betreiber kann diesen Digest für die Aktualisierung seiner Installation übernehmen. Siehe [Release-Workflow](../.github/workflows/release.yml) und [Release-Konfiguration](../release-please-config.json).

## Rechte und Artefakte

Die QA führt PR-Code ohne produktive Secrets aus. Die verwendeten Actions sind auf vollständige Commit-IDs fixiert. Das App-Image und dessen ID bleiben als kurzlebiges QA-Artefakt verfügbar. Zur Fehleranalyse enthält der Lauf die konkreten Assertion-Ergebnisse. Zugangstokens, Browser-Sitzungsdateien und rohe Netzwerkmitschnitte gehören ausschließlich in den isolierten lokalen Testlauf.

Die Fork-PR-Verifikation ist auf ausdrückliche Nutzerentscheidung vertagt und bleibt unverifiziert; bis zu einer erneuten Freigabe ist sie eine dokumentierte M6-Ausnahme und keine aktive Abnahmebedingung.

Die übrigen Lieferkettenabnahmen bleiben erforderlich, bis echte GitHub-Läufe samt Ergebnis dokumentiert sind: regulärer PR-Lauf mit Branchregel, Release-PR mit exaktem SHA-Dispatch, absichtlich fehlgeschlagene und übersprungene E2E-Probe sowie der Release-Check.

## Bedienbefehle

```bash
gh pr checks --watch
gh run list --workflow quality.yml
gh run list --workflow release.yml
gh release view
```

Den tatsächlichen Prüf- und Veröffentlichungsstand dokumentiert der [Abnahmenachweis](TRACEABILITY.md).
