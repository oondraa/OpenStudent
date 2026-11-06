"""Vytáhne školy v Hradci Králové z rejstříku škol MŠMT (RSSZ, JSON-LD)."""
import json, sys, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "data/raw/rssz-khk.jsonld"
data = json.loads(src.read_text(encoding="utf-8"))

DRUHY = {"B00": "ZŠ", "C00": "SŠ", "E00": "VOŠ", "L11": "jídelna", "L13": "výdejna"}
out = []
for po in data["list"]:
    for s in po.get("skolyAZarizeni", []):
        if s["druh"] not in DRUHY:
            continue
        mista = [m["adresa"] for m in s.get("mistaVyuky", []) if m.get("adresa", {}).get("obec") == "Hradec Králové"]
        if not mista:
            continue
        kap = sum(k.get("nejvyssiPovolenyPocet") or 0 for k in s.get("kapacity", []))
        out.append({
            "redIzo": po["redIzo"], "ico": po.get("ico"), "izo": s["izo"],
            "druh": DRUHY[s["druh"]], "nazev": po["uplnyNazev"], "kratky": po.get("zkracenyNazev"),
            "kapacita": kap, "zrizovatel": po.get("typZrizovatele"), "emaily": po.get("emaily", []),
            "mista": [f'{a.get("ulice") or a.get("castObce")} {a.get("cisloDomovni")}' for a in mista],
            "ruian": [a.get("kodRUIAN") for a in mista],
        })
(ROOT / "data/schools_hk_register.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
c = collections.Counter(o["druh"] for o in out)
print(c)
if "--list" in sys.argv:
    for o in sorted(out, key=lambda o: (o["druh"], o["nazev"])):
        if o["druh"] in ("ZŠ", "SŠ", "VOŠ"):
            print(f'{o["druh"]:4} {o["kapacita"]:5} | {o["nazev"][:95]} | {"; ".join(o["mista"])[:60]} | {",".join(o["emaily"])[:40]}')
