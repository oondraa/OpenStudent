"""Export dat pro appku (Worker): katalog škol, rozvrhy tříd po týdnech, menza.

out/app/schools.json   – školy pro výběr při registraci (jen 2. stupeň ZŠ, SŠ, VOŠ)
out/app/tt-<id>.json   – rozvrh všech tříd školy: zvonění + týdny {pondělí: {třída: [den]}}
out/app/menza.json     – odhad vytížení jídelen (z menza.py, kopie web/data/menza.json)

scripts/ingest.py to pak nahraje do Workeru (PUT /api/internal/data/<jméno>).
"""
from __future__ import annotations

import json
import shutil
from collections import Counter
from pathlib import Path

from . import catalog, menza, model

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "app"
TT_DIR = ROOT / "data" / "timetables"
LOGOS = ROOT / "web" / "logos"


def hhmm(m: int) -> str:
    return f"{m // 60}:{m % 60:02d}"


def periods_of(weeks: dict) -> list[list[str]]:
    """Zvonění školy = nejčastější (začátek, konec) hodin, bez překryvů. Hodiny mimo zvonění (např. 60min bloky)
    se v appce přiřadí k vyučovací hodině, ve které začínají."""
    cnt = Counter((l["s"], l["e"]) for wk in weeks.values() for days in wk.values() for d in days for l in d["lessons"])
    chosen: list[tuple[int, int]] = []
    for (s, e), n in cnt.most_common():
        if n < 3 or e - s < 30 or e - s > 60:
            continue
        if all(e <= a or s >= b for a, b in chosen):
            chosen.append((s, e))
    return [[hhmm(s), hhmm(e)] for s, e in sorted(chosen)]


def keep_class(level: str, cls: str) -> bool:
    return level != "ZŠ" or (model._grade(cls) or 0) >= 6


def run() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    schools = json.loads(catalog.CATALOG.read_text(encoding="utf-8"))
    logos = json.loads((LOGOS / "index.json").read_text(encoding="utf-8")) if (LOGOS / "index.json").exists() else {}
    listing = []
    for s in schools:
        if s.get("system") == "-":
            continue
        entry = {"id": s["id"], "name": s["name"], "nick": catalog.NICK.get(s["id"]) or s.get("short") or s["name"],
                 "level": s["level"], "system": s.get("system"), "lat": s.get("lat"), "lon": s.get("lon"),
                 "logo": f"/logos/{logos[s['id']]['file']}" if s["id"] in logos else None,
                 "canteen": _canteen(s), "walk": s.get("walk", {}), "supported": False, "classes": []}
        f = TT_DIR / f"{s['id']}.json"
        if s.get("public") and f.exists():
            d = json.loads(f.read_text(encoding="utf-8"))
            weeks = {m: {c: days for c, days in wk.items() if keep_class(s["level"], c)} for m, wk in d.get("weeks", {}).items()}
            if any(weeks.values()):
                classes = sorted({c for wk in weeks.values() for c in wk}, key=_class_key)
                entry.update(supported=True, classes=classes, periods=periods_of(weeks), fetched=d.get("fetched"))
                (OUT / f"tt-{s['id']}.json").write_text(json.dumps(
                    {"school": s["id"], "fetched": d.get("fetched"), "periods": entry["periods"], "weeks": weeks},
                    ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        listing.append(entry)
    listing.sort(key=lambda e: (not e["supported"], e["level"] != "SŠ", e["nick"]))
    (OUT / "schools.json").write_text(json.dumps(listing, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    mz = ROOT / "web" / "data" / "menza.json"
    if mz.exists():
        shutil.copyfile(mz, OUT / "menza.json")
    # loga jako statické soubory appky
    app_logos = ROOT.parent / "public" / "logos"
    app_logos.mkdir(parents=True, exist_ok=True)
    for f in LOGOS.iterdir():
        if f.suffix != ".json" and not f.name.startswith("_"):
            shutil.copyfile(f, app_logos / f.name)
    sup = sum(e["supported"] for e in listing)
    print(f"export: {sup}/{len(listing)} škol s rozvrhem → {OUT.relative_to(ROOT)}")


def _canteen(s: dict) -> dict | None:
    if s.get("canteen") == "own":
        return {"id": f"own:{s['id']}", "strava": menza.STRAVA.get(s["id"]), "name": "Školní jídelna"}
    if s.get("canteen") == "jidelna-hradecka":
        return {"id": "jidelna-hradecka", "strava": menza.STRAVA["jidelna-hradecka"], "name": "Jídelna Hradecká"}
    return None


def _class_key(c: str):
    g = model._grade(c)
    return (g if g is not None else 99, c)
