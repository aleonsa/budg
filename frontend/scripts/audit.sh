#!/usr/bin/env bash
# npm audit with an allowlist for reviewed-and-accepted advisories.
#
# Some advisories have no patched version available yet, or only apply to a
# runtime we don't use (e.g. react-router's RSC-mode CSRF bypass in a Vite
# SPA).  Each allowlisted entry must record the GHSA ID and a reason.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Allowlist ──────────────────────────────────────────────────────────
# Each line: GHSA_ID|short justification
ALLOWED=(
  "GHSA-qwww-vcr4-c8h2|react-router RSC CSRF bypass — app is a Vite SPA, does not use RSC mode"
)
# ──────────────────────────────────────────────────────────────────────

ALLOWED_GHSAS=$(printf '%s\n' "${ALLOWED[@]}" | cut -d'|' -f1 | paste -sd, -)
audit_json=$(npm audit --json 2>/dev/null || true)

export ALLOWED_GHSAS audit_json
python3 <<'PYEOF'
import json, os, sys

allowed = set(os.environ["ALLOWED_GHSAS"].split(","))
data = json.loads(os.environ["audit_json"])
vulns = data.get("vulnerabilities", {})

to_remove = set()
for name, info in vulns.items():
    via = info.get("via", [])
    if isinstance(via, list):
        for v in via:
            if isinstance(v, dict):
                url = v.get("url", "")
                if any(ghsa in url for ghsa in allowed):
                    to_remove.add(name)
    # Also remove packages whose only via-reference is another removed pkg
    if isinstance(via, list) and via and all(
        isinstance(v, str) and v in to_remove for v in via
    ):
        to_remove.add(name)

remaining = {
    k: v for k, v in vulns.items()
    if k not in to_remove and v.get("severity") in ("high", "critical")
}

if remaining:
    for name, info in remaining.items():
        via = info.get("via", [])
        adv = via[0] if via and isinstance(via[0], dict) else {}
        title = adv.get("title", name)
        url = adv.get("url", "")
        sev = info["severity"].upper()
        print(f"  {sev:8s}  {name}: {title}")
        if url:
            print(f"           {url}")
    print(f"\n❌ {len(remaining)} unallowlisted high+ vulnerability(ies)")
    sys.exit(1)

print(f"✅ npm audit passed ({len(to_remove)} allowlisted advisory excluded)")
PYEOF
