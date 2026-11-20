---
name: falkenwarte-delivery
description: Diagnostiziere Falkenwartes GitHub-Prüfungen, langsame Docker-Builds oder eine stockende Release-Übergabe. Nutze diesen Skill für Änderungen an CI, BuildKit-Caches, Release Please und der GHCR-Publikation.
---

# CI und Releases für Falkenwarte

## Einen fehlgeschlagenen Check zuordnen

Ermittle mit `gh pr checks` den Job und mit `gh run view RUN_ID --json event,headSha,jobs` den geprüften Commit. Beim PR prüft die Pipeline dessen Head, beim Push auf `main` den zusammengeführten Commit. Der Branchschutz verlangt `quality-gate`, das den Erfolg aller sechs vorgelagerten Jobs voraussetzt. PR-Jobs laufen mit Leserechten und Testdiensten. [QA-Workflow](../../../.github/workflows/quality.yml)

Für Commit und PR-Titel gelten Conventional Commits. Signiere eigene Commits mit dem eingerichteten Git-Schlüssel und prüfe die Signatur mit `git verify-commit HEAD`. Welche Titel und Identitätsmerkmale CI prüft, steht im [Delivery-Handbuch](../../../docs/GITHUB_DELIVERY.md) und in der [Commitlint-Konfiguration](../../../qa/delivery/commitlint.config.mjs).

## Wiederholte Downloads oder langsame Builds

Vergleiche die betroffenen Schritte zweier Läufe. Composer speichert Downloads nach `composer.lock`, npm verwendet die Lockdateien in `frontend/` und `qa/delivery/`. Eine erneute Installation im frischen Checkout kann vollständig aus dem Cache erfolgen.

BuildKit verwendet getrennte GitHub-Actions-Caches für App, Browser-Runner und HTTP-Mocks. Prüfe die `cache-from`- und `cache-to`-Scopes und die tatsächlich wiederverwendeten Layer. Beide Browserprüfungen eines Jobs verwenden dieselben Runner- und Mock-Images. Der Build-Job übergibt das App-Image samt `image.id` als Artefakt. E2E lädt dieses Image, prüft die ID und reicht es an `make e2e-run` und `make plugin-upgrade-run` weiter. [Imagebau und Übergabe](../../../.github/workflows/quality.yml) · [Make-Ziele](../../../Makefile)

## Einen Release nachvollziehen

Nach grüner Push-QA auf `main` kann Release Please einen Release-PR vorbereiten. Prüfe bei einem wartenden Release-PR dessen eigene PR-Prüfung und den zusätzlichen QA-Dispatch für seine Head-SHA. `action_required` und ein fachlich fehlgeschlagener Test haben unterschiedliche Ursachen. Der reguläre Feature- und Dokumentationsreview kann unabhängig vom Release-PR erfolgen. [Releaseablauf](../../../docs/GITHUB_DELIVERY.md)

Für eine beauftragte Veröffentlichung gleiche Tag-SHA, erfolgreichen Push-QA-Lauf, Image-ID und Acceptance-Bericht ab. Der Workflow publiziert dasselbe geprüfte Image und hält den Registry-Digest im Release-Manifest fest. Gib als Ergebnis den erreichten Zustand an, etwa „PR geprüft“, „auf main geprüft“ oder „Image veröffentlicht“, jeweils mit dem zugehörigen Nachweis. [Releaseworkflow](../../../.github/workflows/release.yml)
