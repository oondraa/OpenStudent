"""Menza: kolik lidí bude v jídelně, jak dlouhá fronta a kdy je nejlepší jít.

Vstup: příchody na oběd po minutách z model.forecast (kdo kdy může jít jíst podle rozvrhu).
Fronta = jednoduchá simulace: každou minutu přijde a(t) lidí, výdej obslouží `serve` lidí/min.
Čekání = fronta / výdej. Po výdeji člověk jí `lunch_dwell` minut (= „lidí v jídelně“).

Jídelníček: veřejný jídelníček Strava.cz (app.strava.cz/jidelnicky) – jen menu, žádné objednávky
ani osobní údaje. Počty objednaných obědů Strava veřejně neukazuje.
"""
from __future__ import annotations

import datetime as dt
import json
import re

from . import http
from .model import T0, N, PARAMS, hhmm

# Číslo jídelny na Strava.cz (seznam: POST app.strava.cz/api/zarAMesta, ověřeno 6. 11. 2026)
STRAVA = {
    "jidelna-hradecka": "0288",
    "szs": "0597", "hradebni": "2251", "nesl": "3225", "hotelovka": "5024", "vocelova": "5256", "sosvet": "6885",
    "zs-sever": "3560", "zs-stefanikova": "3588", "zs-pouchov": "3589", "zs-snp": "3668", "zs-gocarova": "3669",
    "zs-svobodnedvory": "3801", "zs-habrmanova": "3802", "zs-novyhk": "4245", "zs-kukleny": "4334",
    "zs-plotiste": "4566", "zs-stefcova": "5222", "zs-mandysova": "5223", "zs-horakove": "5224", "zs-uprkova": "5636",
}

# Výdej (lidí za minutu) a otevírací doba – ODHADY, laditelné
CANTEEN = {
    "jidelna-hradecka": {"serve": 22.0, "open": (11 * 60 + 15, 14 * 60 + 30)},  # víc výdejních linek, až 4000 obědů/den
    "own": {"serve": None, "open": (11 * 60 + 15, 14 * 60 + 15)},               # školní jídelna: výdej podle velikosti
}
OWN_SERVE = (4.0, 16.0)   # školní jídelna stihne své strávníky vydat zhruba za 35 min → strávníci/35, oříznuto
NOT_LUNCH = re.compile(r"(snídan|přesn|svač|nápoj|večeř|dopl|MŠ|\bPC\b|celoden|poloden)", re.I)
A, B = 10 * 60 + 45, 15 * 60  # osa menzy


def menu(zarizeni: str, day: dt.date) -> list[dict]:
    """Jídelníček na daný den z veřejného jídelníčku Strava.cz."""
    raw = http.get("https://app.strava.cz/api/jidelnickyPage", data={"cislo": zarizeni, "lang": "CZ"},
                   ttl=12 * 3600, ctype="text/plain;charset=UTF-8")
    d = json.loads(raw)
    want = day.strftime("%d.%m.%Y")
    out = []
    for table in (d.get("meals") or {}).values():
        for m in table:
            if m.get("datum") != want or NOT_LUNCH.search(m.get("druh_popis") or "") or NOT_LUNCH.search(m.get("druh_chod") or ""):
                continue
            name = " ".join((m.get("nazev") or "").split())
            if name:
                out.append({"kind": (m.get("druh_popis") or "").strip(), "name": name,
                            "allergens": [a[0].strip("- ") for a in m.get("alergeny") or [] if re.search(r"\d", a[0])]})
    return out


def simulate(arr: list[float], serve: float, open_: tuple[int, int], dwell: int) -> dict:
    """Fronta po minutách. Vrací řady pro A..B: příchody, fronta, čekání (min), lidí u stolů."""
    q, eating, served_at = 0.0, [0.0] * N, [0.0] * N
    queue, wait = [0.0] * N, [0.0] * N
    for i in range(N):
        t = T0 + i
        q += arr[i]
        if open_[0] <= t < open_[1]:
            s = min(q, serve)
            q -= s
            served_at[i] = s
        queue[i] = q
        wait[i] = q / serve
    for i, s in enumerate(served_at):
        for k in range(i, min(N, i + dwell)):
            eating[k] += s
    sl = slice(A - T0, B - T0)
    return {"arrivals": arr[sl], "queue": queue[sl], "wait": wait[sl], "eating": eating[sl]}


def best_windows(sim: dict, open_: tuple[int, int], width: int = 15) -> list[dict]:
    """Nejlepší (a nejhorší) časy příchodu: průměrné čekání + tlačenice u stolů v okně `width` min."""
    peak_eat = max(sim["eating"]) or 1
    scores = []
    for t in range(max(open_[0], A), min(open_[1] - 20, B - width) + 1, 5):
        i = t - A
        w = sum(sim["wait"][i:i + 5]) / 5
        crowd = sum(sim["eating"][i:i + width]) / width / peak_eat
        scores.append({"from": hhmm(t), "to": hhmm(t + width), "t": t, "wait": round(w, 1),
                       "crowd": round(crowd, 2), "score": round(w + 4 * crowd, 2)})
    return sorted(scores, key=lambda x: x["score"])


def build(res: dict, schools: list[dict], places: list[dict], day: dt.date, nick: dict) -> dict:
    by_id = {s["id"]: s for s in schools}
    out = []
    for key, arr in res["arrivals"].items():
        own = key.startswith("own:")
        sid = key[4:] if own else None
        cfg = CANTEEN["own" if own else key] if (own or key in CANTEEN) else CANTEEN["own"]
        if own:
            name = f"Jídelna – {nick.get(sid) or by_id[sid]['short']}"
        else:
            name = next((p["name"] for p in places if p["id"] == key), key)
        total = sum(arr)
        serve = cfg["serve"] or max(OWN_SERVE[0], min(OWN_SERVE[1], total / 35))
        sim = simulate(arr, serve, cfg["open"], PARAMS["lunch_dwell"])
        if total < 5:
            continue
        ranked = best_windows(sim, cfg["open"])
        zid = STRAVA.get(sid if own else key)
        try:
            food = menu(zid, day) if zid else []
        except Exception as e:  # menu je bonus, jídelna se zobrazí i bez něj
            food, zid = [{"kind": "", "name": f"jídelníček se nepodařilo načíst ({str(e)[:60]})", "allergens": []}], zid
        pk = max(range(len(sim["eating"])), key=sim["eating"].__getitem__)
        pw = max(range(len(sim["wait"])), key=sim["wait"].__getitem__)
        out.append({
            "id": key, "name": name, "own_school": sid, "open": [hhmm(cfg["open"][0]), hhmm(cfg["open"][1])],
            "serve_per_min": round(serve, 1), "strava": zid, "diners": round(total),
            "peak_eating": {"time": hhmm(A + pk), "count": round(sim["eating"][pk])},
            "peak_wait": {"time": hhmm(A + pw), "min": round(sim["wait"][pw], 1)},
            "best": ranked[:3], "worst": sorted(ranked, key=lambda x: -x["score"])[:2],
            "by_school": {k: v for k, v in res.get("arrivals_by_school", {}).get(key, {}).items() if v >= 1},
            "series": {k: [round(v, 1) for v in s] for k, s in sim.items()},
            "menu": food,
        })
    out.sort(key=lambda c: (c["own_school"] is not None, -c["diners"]))
    return {"date": day.isoformat(), "axis_from": hhmm(A), "axis_to": hhmm(B), "lunch_dwell": PARAMS["lunch_dwell"],
            "canteens": out}


def typical(per_weekday: dict[int, dict], schools: list[dict]) -> dict[str, list[dict]]:
    """Obvyklý pondělí … pátek pro každou jídelnu (týž model, jen jiný den v týdnu). Bez jídelníčku."""
    out: dict[str, list[dict]] = {}
    for wd, res in sorted(per_weekday.items()):
        for key, arr in res["arrivals"].items():
            own = key.startswith("own:")
            cfg = CANTEEN["own" if own else key] if (own or key in CANTEEN) else CANTEEN["own"]
            total = sum(arr)
            if total < 5:
                continue
            serve = cfg["serve"] or max(OWN_SERVE[0], min(OWN_SERVE[1], total / 35))
            sim = simulate(arr, serve, cfg["open"], PARAMS["lunch_dwell"])
            pw = max(range(len(sim["wait"])), key=sim["wait"].__getitem__)
            out.setdefault(key, []).append({
                "weekday": wd + 1, "axis_from": hhmm(A), "axis_to": hhmm(B),
                "open": [hhmm(cfg["open"][0]), hhmm(cfg["open"][1])],
                "series": {"wait": [round(v, 1) for v in sim["wait"]], "eating": [round(v, 1) for v in sim["eating"]]},
                "best": best_windows(sim, cfg["open"])[:3],
                "peak_wait": {"time": hhmm(A + pw), "min": round(sim["wait"][pw], 1)},
            })
    return out
