"""Nahraje export pipeline (pipeline/out/app/*.json) do Workeru: PUT /api/internal/data/<jméno>.

    API_URL=https://openstudent.<účet>.workers.dev INGEST_TOKEN=... python scripts/ingest.py
    API_URL=http://localhost:5173 INGEST_TOKEN=dev python scripts/ingest.py     # lokálně (wrangler/vite dev)

Rozvrhy škol jdou jako poslední: Worker po každém porovná třídy a pošle notifikace o změnách.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "pipeline" / "out" / "app"


def main() -> int:
    api = os.environ.get("API_URL", "").rstrip("/")
    token = os.environ.get("INGEST_TOKEN", "")
    if not api or not token:
        print("Nastav API_URL a INGEST_TOKEN.", file=sys.stderr)
        return 2
    files = sorted(OUT.glob("*.json"), key=lambda f: (f.name.startswith("tt-"), f.name))
    failed = 0
    for f in files:
        body = f.read_bytes()
        req = urllib.request.Request(f"{api}/api/internal/data/{f.stem}", data=body, method="PUT",
                                     headers={"authorization": f"Bearer {token}", "content-type": "application/json",
                                              "user-agent": "OpenStudent-pipeline"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                res = json.loads(r.read())
            print(f"  ✓ {f.stem:22} {len(body) / 1024:7.0f} kB  {res.get('hash', '')}")
        except Exception as e:  # jeden soubor nesmí zastavit ostatní
            failed += 1
            print(f"  ✗ {f.stem:22} {e}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
