# An Falkenwarte entwickeln

Öffne den Falkenwarte-Checkout als Arbeitsprojekt. Codex findet die Entwicklungsskills unter `.agents/skills/`, Claude Code liest dieselben Dateien über `.claude/skills/`. In einem neuen Projektthread kannst du den passenden Skill auch direkt aufrufen, etwa mit `$falkenwarte-qa` in Codex oder `/falkenwarte-qa` in Claude Code. Andere Agents können die verlinkten Dateien direkt lesen.

| Wenn du in Falkenwarte … | Verwende |
| --- | --- |
| eine Fachregel, einen Symfony-Service oder einen öffentlichen API-Vertrag änderst | [falkenwarte-feature](.agents/skills/falkenwarte-feature/SKILL.md) |
| am Board, an der Ticketansicht oder an der mobilen Navigation arbeitest | [falkenwarte-frontend](.agents/skills/falkenwarte-frontend/SKILL.md) |
| herausfinden willst, warum ein technischer Eingang wartet, ein T3-Start wiederholt wird oder dem Review eine Übergabe fehlt | [falkenwarte-orchestration](.agents/skills/falkenwarte-orchestration/SKILL.md) |
| einen Fehler reproduzierst, den passenden Test auswählst oder ohne Provider-Zugang im Browser prüfst | [falkenwarte-qa](.agents/skills/falkenwarte-qa/SKILL.md) |
| eine Bedienhandlung, einen Fachbegriff oder eine Architekturentscheidung dokumentierst | [falkenwarte-handbook](.agents/skills/falkenwarte-handbook/SKILL.md) |
| einen GitHub-Check, Docker-Buildcache oder die Übergabe des geprüften Images an ein Release bearbeitest | [falkenwarte-delivery](.agents/skills/falkenwarte-delivery/SKILL.md) |

Ein von Falkenwarte beauftragter Agent erhält für sein eigenes Arbeitsprojekt den Skill `falkenwarte`. Die App stellt ihn unter **Agents & T3** zum Download bereit. [Agent-Skill im Zielprojekt installieren](docs/user/AGENT_SKILL.md)

Bei einer Abnahme der ursprünglichen Meilensteine M0 bis M6 prüfe jeden Meilenstein gegen `.notes/falkenwarte-concept/`. Der [Handbuch-Skill](.agents/skills/falkenwarte-handbook/SKILL.md) verweist auf die historischen Quellen für Checkouts ohne lokale Notizen.

## Markdown bearbeiten

Schreibe jeden Prosaabsatz in Markdown auf eine Quellzeile und trenne Absätze durch eine Leerzeile. Erhalte die strukturellen Zeilenumbrüche in Listen, Tabellen, Frontmatter, Codeblöcken und bei ausdrücklichen Markdown-Zeilenumbrüchen. `make docs` prüft die Quellen und baut das Handbuch.
