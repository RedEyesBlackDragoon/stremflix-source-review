"""Query OSV for resolved Maven versions. Sends dependency coordinates only; no device or account data."""
import json
import os
import re
import subprocess
from pathlib import Path

import httpx

root = Path(__file__).parents[2]
gradle = root / "tv" / ("gradlew.bat" if os.name == "nt" else "gradlew")
result = subprocess.run([str(gradle), ":app:dependencies", "--configuration", "debugRuntimeClasspath", "--console=plain"],
                        cwd=root / "tv", capture_output=True, text=True, check=True)
coordinates = {}
for line in result.stdout.splitlines():
    match = re.search(r"([\w.]+):([\w.-]+):([\w.+-]+)(?: -> ([\w.+-]+))?", line)
    if match and not line.rstrip().endswith("(*)"):
        group, name, initial, resolved = match.groups()
        version = resolved or initial
        if version[0].isdigit():
            coordinates[(group + ":" + name, version)] = True
packages = sorted(coordinates)
queries = [{"package": {"ecosystem": "Maven", "name": name}, "version": version} for name, version in packages]
response = httpx.post("https://api.osv.dev/v1/querybatch", json={"queries": queries}, timeout=30)
response.raise_for_status()
entries = [{"package": name, "version": version, "vulnerabilities": result.get("vulns", [])}
           for (name, version), result in zip(packages, response.json()["results"], strict=True)]
report = {"database": "OSV", "scope": "debugRuntimeClasspath Maven coordinates; excludes Android OS and System WebView",
          "queried_packages": len(entries), "affected_packages": sum(bool(e["vulnerabilities"]) for e in entries), "entries": entries}
(root / "docs/household/android-audit.json").write_text(json.dumps(report, indent=2))
print(json.dumps({k: v for k, v in report.items() if k != "entries"}))
raise SystemExit(1 if report["affected_packages"] else 0)
