"""python -m openstudent catalog | fetch | forecast | run"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

from . import catalog, export, http, menza, model, sources

ROOT = Path(__file__).resolve().parents[1]
TT_DIR = ROOT / "data" / "timetables"
OUT = ROOT / "web" / "data"


def cmd_catalog(_):
    out = catalog.build()
    pub = [s for s in out if s["public"]]
    print(f"{len(out)} škol, {len(pub)} s veřejným rozvrhem → {catalog.CATALOG.relative_to(ROOT)}")


def cmd_fetch(a):
    """Stáhne tento i příští týden (Bakaláři vč. suplování). Ukládá detail pro appku a sloty pro model."""
    schools = json.loads(catalog.CATALOG.read_text(encoding="utf-8"))
    TT_DIR.mkdir(parents=True, exist_ok=True)
    weeks = [a.week] if a.week else ["Actual", "Next"]
    model_week = "Actual" if dt.date.today().weekday() < 5 else "Next"
    only = set(a.only.split(",")) if a.only else None
    st_path = TT_DIR / "_status.json"
    status = json.loads(st_path.read_text(encoding="utf-8")) if st_path.exists() else {}
    for s in schools:
        if not s["public"] or (only and s["id"] not in only):
            continue
        t = time.time()
        try:
            got = {}
            for w in weeks:
                monday = (dt.date.today() - dt.timedelta(days=dt.date.today().weekday())
                          + dt.timedelta(days=7 if w == "Next" else 0)).isoformat()
                got[monday] = (w, sources.fetch(s, w))
            cur = next((d for w, d in got.values() if w == model_week), next(iter(got.values()))[1])
            (TT_DIR / f"{s['id']}.json").write_text(json.dumps(
                {"school": s["id"], "fetched": dt.datetime.now().isoformat(timespec="seconds"),
                 "weeks": {m: d for m, (_, d) in got.items()},
                 "lessons": sources.slots_from_detail(cur)}, ensure_ascii=False), encoding="utf-8")
            status[s["id"]] = {"ok": True, "classes": len(cur), "at": dt.datetime.now().isoformat(timespec="seconds")}
            print(f"  ✓ {s['id']:16} {len(cur):3} tříd · {len(got)} týdny  ({time.time() - t:.0f} s)")
        except Exception as e:  # jedna rozbitá škola nesmí zastavit ostatní
            status[s["id"]] = {**status.get(s["id"], {}), "ok": False, "error": str(e)[:200]}
            print(f"  ✗ {s['id']:16} {e}", file=sys.stderr)
    st_path.write_text(json.dumps(status, ensure_ascii=False, indent=1), encoding="utf-8")


def _second_stage_only(schools, tts):
    """Sledujeme jen 2. stupeň ZŠ (6.–9. třída), SŠ a VOŠ. U ZŠ zahodí třídy 1.–5. a úměrně
    sníží odhad počtu žáků (rejstřík má kapacitu celé ZŠ). Mění `tts` na místě."""
    out = []
    for s in schools:
        tt = tts.get(s["id"])
        if s["level"] == "ZŠ":
            if tt:
                kept = {c: d for c, d in tt.items() if (model._grade(c) or 0) >= 6}
                s = {**s, "students_est": round(s["students_est"] * len(kept) / max(1, len(tt)))}
                tts[s["id"]] = kept
            else:
                s = {**s, "students_est": round(s["students_est"] * 4 / 9)}  # 2. stupeň ≈ 4 z 9 ročníků
        out.append(s)
    return out


def cmd_forecast(a):
    day = dt.date.fromisoformat(a.date) if a.date else dt.date.today()
    if day.weekday() >= 5:
        day += dt.timedelta(days=7 - day.weekday())
    schools = json.loads(catalog.CATALOG.read_text(encoding="utf-8"))
    places = json.loads(catalog.PLACES.read_text(encoding="utf-8"))
    tts = {}
    for f in TT_DIR.glob("*.json"):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        tts[d["school"]] = {c: {int(k): v for k, v in days.items()} for c, days in d["lessons"].items()}
    schools = _second_stage_only(schools, tts)
    res = model.forecast(schools, tts, places, day.weekday())
    total = sum(s["students_est"] for s in schools)
    covered = sum(s["students_est"] for s in schools if s["id"] in tts)
    res.update({"date": day.isoformat(), "generated": dt.datetime.now().isoformat(timespec="seconds"),
                "coverage": {"schools": len(tts), "schools_total": len(schools),
                             "students": covered, "students_total": total},
                "params": {k: v for k, v in model.PARAMS.items()},
                "school_list": [{k: s.get(k) for k in ("id", "short", "level", "system", "public", "note",
                                                        "students_est", "canteen", "lat", "lon")} for s in schools]})
    logos_idx = OUT.parent / "logos" / "index.json"
    logos = json.loads(logos_idx.read_text(encoding="utf-8")) if logos_idx.exists() else {}
    for s in res["school_list"]:
        s["nick"] = catalog.NICK.get(s["id"])
        s["logo"] = f"logos/{logos[s['id']]['file']}" if s["id"] in logos else None
    OUT.mkdir(parents=True, exist_ok=True)
    mz = menza.build(res, schools, places, day, catalog.NICK)
    mz["generated"] = res["generated"]
    per_wd = {wd: (res if wd == day.weekday() else model.forecast(schools, tts, places, wd)) for wd in range(5)}
    typ = menza.typical(per_wd, schools)
    for c in mz["canteens"]:
        c["typical"] = typ.get(c["id"], [])
    (OUT / "menza.json").write_text(json.dumps(mz, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    res.pop("arrivals", None), res.pop("arrivals_by_school", None)
    (OUT / "forecast.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    # všechny rozvrhy pro prohlížeč (web/rozvrhy.html)
    by_id = {s["id"]: s for s in schools}
    export = {"generated": res["generated"], "min_gap": model.PARAMS["min_gap"], "schools": [
        {"id": sid, "name": catalog.NICK.get(sid) or by_id[sid]["short"] or by_id[sid]["name"], "level": by_id[sid]["level"],
         "logo": f"logos/{logos[sid]['file']}" if sid in logos else None,
         "lat": by_id[sid].get("lat"), "lon": by_id[sid].get("lon"), "walk": by_id[sid].get("walk", {}),
         "system": by_id[sid]["system"], "students_est": by_id[sid]["students_est"],
         "class_size": round(max(model.PARAMS["class_size"][0], min(model.PARAMS["class_size"][1],
                                 by_id[sid]["students_est"] / max(1, len(tt))))),
         "classes": {c: {str(k): v for k, v in days.items()} for c, days in tt.items()}}
        for sid, tt in sorted(tts.items(), key=lambda kv: (by_id[kv[0]]["level"] != "SŠ", by_id[kv[0]]["short"] or ""))
        if sid in by_id]}
    (OUT / "timetables.json").write_text(json.dumps(export, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    names = ["Po", "Út", "St", "Čt", "Pá"]
    print(f"\n{names[day.weekday()]} {day:%d. %m. %Y} – pokrytí: {len(tts)}/{len(schools)} škol, "
          f"~{covered}/{total} žáků")
    fp = res["free_students"]["peak"]
    print(f"Nejvíc žáků v delší pauze (≥{model.PARAMS['min_gap']} min) najednou: ~{fp['count']} v {fp['time']}")
    for pl in res["places"]:
        if pl["kind"] == "own-canteen":
            continue
        if not pl["busy_from"]:
            print(f"  {pl['name']:36} nikdo")
            continue
        pk, (od, do) = pl["peak"], pl["busy_from"]
        top = ", ".join(f"{k} {v}" for k, v in list(pl["by_school"].items())[:4])
        print(f"  {pl['name']:36} špička ~{pk['count']:4} lidí v {pk['time']:>5}  (rušno {od}–{do})  [{top}]")


def main():
    for st in (sys.stdout, sys.stderr):  # Windows konzole (cp1250) neumí „≥“ ani „→“
        st.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="openstudent")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog")
    f = sub.add_parser("fetch")
    f.add_argument("--week", choices=["Actual", "Next", "Permanent"])
    f.add_argument("--only", help="čárkou oddělená id škol")
    fc = sub.add_parser("forecast")
    fc.add_argument("--date", help="YYYY-MM-DD (výchozí dnes)")
    sub.add_parser("export")
    r = sub.add_parser("run")
    r.add_argument("--date")
    a = ap.parse_args()
    if a.cmd == "catalog":
        cmd_catalog(a)
    elif a.cmd == "fetch":
        cmd_fetch(a)
    elif a.cmd == "forecast":
        cmd_forecast(a)
    elif a.cmd == "export":
        export.run()
    else:
        cmd_catalog(a)
        cmd_fetch(argparse.Namespace(week=None, only=None))
        cmd_forecast(a)
        export.run()


if __name__ == "__main__":
    main()
