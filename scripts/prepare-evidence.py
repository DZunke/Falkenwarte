"""Prepare the public test report. Raw browser resources stay in the isolated stack."""
import html
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile, BadZipFile

raw = Path(sys.argv[1])
out = Path(sys.argv[2])
report = json.loads((out / "acceptance.json").read_text())
diagnostics = []
for trace in sorted(raw.rglob("trace.zip")):
    steps = []
    try:
        with ZipFile(trace) as archive:
            for member in archive.namelist():
                if not member.endswith(".trace"):
                    continue
                for line in archive.read(member).splitlines():
                    event = json.loads(line)
                    phase = event.get("type")
                    if phase not in {"before", "after"}:
                        continue
                    # No DOM, headers, query strings, arguments, returned values, titles, or exception messages.
                    method = str(event.get("method", ""))
                    steps.append({
                        "phase": phase,
                        "method": method if re.fullmatch(r"[a-zA-Z]{1,64}", method) else None,
                        "time": event.get("startTime" if phase == "before" else "endTime"),
                        "failed": "error" in event,
                    })
    except (BadZipFile, ValueError):
        continue
    if steps:
        diagnostics.append(steps)
if diagnostics:
    (out / "trace-timings.json").write_text(json.dumps(diagnostics, indent=2))

rows = []
for case in report["cases"]:
    status = case["status"]
    if status != "passed":
        case["observed_outcome"] = []
    case.pop("error", None)
    escape = html.escape
    observation = " ".join(case["observed_outcome"])
    rows.append(f'<tr><td>{escape(case["acceptance_id"])}</td><td>{escape(case["title"])}</td>'
                f'<td>{escape(status)}</td><td>{escape(observation)}</td></tr>')
(out / "acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
(out / "index.html").write_text(
    '<!doctype html><html lang="de"><meta charset="utf-8"><title>Falkenwarte · Browserabnahme</title>'
    '<style>body{max-width:95rem;margin:3rem auto;padding:0 2rem;font:1rem/1.5 system-ui;color:#17392c}'
    'td,th{padding:.65rem;border-bottom:1px solid #b4c8bd;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}</style>'
    '<h1>Falkenwarte · Browserabnahme</h1><p>Revision <code>' + html.escape(report.get("commit") or "") +
    '</code><br>Image <code>' + html.escape(report.get("image") or "") + '</code></p>'
    '<table><thead><tr><th>Fall</th><th>Szenario</th><th>Ergebnis</th><th>Beobachtung</th></tr></thead><tbody>' +
    ''.join(rows) + '</tbody></table></html>'
)
