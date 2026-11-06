"""Model: kdo má kdy pauzu, kolik lidí bude v jídelně a v OC.

Všechny pravděpodobnosti jsou ODHADY (laditelné v PARAMS) – rozvrh říká, kdo MŮŽE být volný,
ne kdo kam skutečně půjde. Výstup je proto očekávaný počet lidí, ne přesné číslo.
"""
from __future__ import annotations

import re

T0, T1 = 6 * 60, 19 * 60  # minutová osa 6:00–19:00
N = T1 - T0

PARAMS = {
    "min_gap": 25,            # pauza kratší než tohle = obyčejná přestávka, nikam se nejde
    "lunch_open": (11 * 60 + 15, 14 * 60 + 30),  # Jídelna Hradecká: výdej 11:15–14:30
    "lunch_dwell": 20,        # jak dlouho trvá oběd
    "lunch_spread": 15,       # za jak dlouho po zvonění dorazí do jídelny celá třída (někdo hned, někdo se loudá)
    "lunch_share": {"SŠ": 0.5, "ZŠ": 0.75},      # podíl žáků, co chodí na školní obědy
    "oc_gap": 0.15,           # podíl volných SŠ žáků (co zrovna nejí), co během pauzy vyrazí do OC
    "oc_gap_max_travel": 20,  # dál než 20 min se v pauze do OC nechodí
    "oc_after": 0.10,         # podíl žáků, co po vyučování zajdou do OC
    "oc_after_max_travel": 35,
    "oc_after_dwell": 40,
    "zs_min_grade": 6,        # ZŠ: do OC po škole jen 6.–9. třída, během pauzy vůbec (nesmí odejít)
    "zs_oc_factor": 0.4,
    "class_size": (10, 32),   # odhad velikosti třídy = žáci školy / počet tříd, oříznuto
}


def _busy_array(slots):
    a = [0.0] * N
    for b, e, f in slots:
        for t in range(max(b, T0), min(e, T1)):
            a[t - T0] = max(a[t - T0], f)
    return a


def _gaps(busy, first, last, min_gap):
    """Souvislé úseky uvnitř školního dne, kdy má aspoň část třídy volno. → (start, end, volná část)."""
    out, t = [], first
    while t < last:
        if busy[t - T0] < 1.0:
            s, free = t, 1.0
            while t < last and busy[t - T0] < 1.0:
                free = min(free, 1.0 - busy[t - T0])
                t += 1
            if t - s >= min_gap:
                out.append((s, t, free))
        else:
            t += 1
    return out


def _add(series, start, dwell, n, spread=10):
    """Přidá n lidí, kteří přicházejí rovnoměrně během `spread` minut od `start` a zdrží se `dwell` minut."""
    if n <= 0:
        return
    start, dwell = int(round(start)), int(round(dwell))
    per = n / spread
    for k in range(spread):
        for t in range(start + k, start + k + dwell):
            if T0 <= t < T1:
                series[t - T0] += per


def _grade(name):
    m = re.match(r"\D*(\d)", name)
    return int(m.group(1)) if m else None


def forecast(schools, timetables, places, weekday, params=PARAMS):
    p = params
    place_series = {pl["id"]: [0.0] * N for pl in places}
    place_by_school = {pl["id"]: {} for pl in places}
    free_series = [0.0] * N
    own_canteens = {}
    arrivals = {}  # jídelna → příchody za minutu (pro frontu v menza.py)
    report = []

    for s in schools:
        tt = timetables.get(s["id"])
        if not tt:
            continue
        lv = s["level"]
        classes = {c: d.get(weekday, d.get(str(weekday), [])) for c, d in tt.items()}
        lo, hi = p["class_size"]
        size = max(lo, min(hi, s["students_est"] / max(1, len(classes))))
        walk = s.get("walk", {})
        canteen = s.get("canteen")
        ocs = sorted((pl for pl in places if pl["kind"] == "oc" and pl["id"] in walk), key=lambda pl: walk[pl["id"]])
        nearest_oc = ocs[0] if ocs else None
        srep = {"id": s["id"], "name": s["short"] or s["name"], "classes": 0, "students": 0, "breaks": []}

        for cname, slots in classes.items():
            slots = [tuple(x) for x in slots]
            if not slots:
                continue
            busy = _busy_array(slots)
            first = min(b for b, _, _ in slots)
            # konec dne = poslední hodina CELÉ třídy (odpolední volitelné/skupinové hodiny jen části třídy neprodlužují den všem)
            full = [e for _, e, f in slots if f >= 1]
            last = max(full) if full else max(e for _, e, _ in slots)
            srep["classes"] += 1
            srep["students"] += size
            grade = _grade(cname)
            zs = lv == "ZŠ"
            lunch_share = p["lunch_share"][lv]
            to_eat = size * lunch_share  # kolik z třídy ještě potřebuje oběd

            for gs, ge, free in _gaps(busy, first, last, p["min_gap"]):
                n_free = size * free
                for t in range(gs, ge):
                    free_series[t - T0] += n_free
                srep["breaks"].append({"class": cname, "from": gs, "to": ge, "students": round(n_free, 1)})

                # --- oběd v pauze
                eaters = 0.0
                if canteen and to_eat > 0:
                    tr = 3 if canteen == "own" else walk.get(canteen, 99)
                    arrive = max(gs + tr, p["lunch_open"][0])
                    if arrive + p["lunch_dwell"] + tr <= ge and arrive + p["lunch_dwell"] <= p["lunch_open"][1]:
                        eaters = min(to_eat, size * free * lunch_share)
                        to_eat -= eaters
                        key = f"own:{s['id']}" if canteen == "own" else canteen
                        _add(arrivals.setdefault(key, [0.0] * N), arrive, 1, eaters, spread=p["lunch_spread"])
                        _arrive_by_school(arrivals, key, s["id"], eaters)
                        if canteen == "own":
                            _add(own_canteens.setdefault(s["id"], [0.0] * N), arrive, p["lunch_dwell"], eaters, spread=p["lunch_spread"])
                        else:
                            _add(place_series[canteen], arrive, p["lunch_dwell"], eaters, spread=p["lunch_spread"])
                            place_by_school[canteen][s["id"]] = place_by_school[canteen].get(s["id"], 0) + eaters

                # --- OC v pauze (jen SŠ – žáci ZŠ školu během dne opustit nesmí)
                if not zs and nearest_oc:
                    tr = walk[nearest_oc["id"]]
                    stay = (ge - gs) - 2 * tr
                    if tr <= p["oc_gap_max_travel"] and stay >= 15:
                        n = (n_free - eaters) * p["oc_gap"] * (1 - tr / (p["oc_gap_max_travel"] + 10))
                        _add(place_series[nearest_oc["id"]], gs + int(tr), int(stay), n, spread=5)
                        place_by_school[nearest_oc["id"]][s["id"]] = place_by_school[nearest_oc["id"]].get(s["id"], 0) + n

            # --- oběd po vyučování (kdo nestihl v pauze a končí do výdeje)
            if canteen and to_eat > 0 and last <= p["lunch_open"][1] - p["lunch_dwell"] and last >= 11 * 60:
                tr = 3 if canteen == "own" else walk.get(canteen, 99)
                arrive = max(last + tr, p["lunch_open"][0])
                key = f"own:{s['id']}" if canteen == "own" else canteen
                _add(arrivals.setdefault(key, [0.0] * N), arrive, 1, to_eat, spread=p["lunch_spread"])
                _arrive_by_school(arrivals, key, s["id"], to_eat)
                if canteen == "own":
                    _add(own_canteens.setdefault(s["id"], [0.0] * N), arrive, p["lunch_dwell"], to_eat, spread=p["lunch_spread"])
                else:
                    _add(place_series[canteen], arrive, p["lunch_dwell"], to_eat, spread=p["lunch_spread"])
                    place_by_school[canteen][s["id"]] = place_by_school[canteen].get(s["id"], 0) + to_eat

            # --- OC po vyučování
            if zs and (grade is None or grade < p["zs_min_grade"]):
                continue
            share = p["oc_after"] * (p["zs_oc_factor"] if zs else 1.0)
            for pl in ocs:
                tr = walk[pl["id"]]
                if tr > p["oc_after_max_travel"]:
                    continue
                # nejbližší OC dostane nejvíc, vzdálenější méně (váha 1/čas cesty)
                w = (1 / max(tr, 3)) / sum(1 / max(walk[o["id"]], 3) for o in ocs if walk[o["id"]] <= p["oc_after_max_travel"])
                n = size * share * w
                _add(place_series[pl["id"]], last + int(tr), p["oc_after_dwell"], n, spread=15)
                place_by_school[pl["id"]][s["id"]] = place_by_school[pl["id"]].get(s["id"], 0) + n

        if srep["classes"]:
            srep["students"] = round(srep["students"])
            report.append(srep)

    def summarize(series):
        bins = [round(sum(series[i:i + 5]) / 5) for i in range(0, N, 5)]
        k = max(range(len(bins)), key=bins.__getitem__)
        return bins, {"time": hhmm(T0 + 5 * k), "count": bins[k]}

    out_places = []
    for pl in places:
        bins, peak = summarize(place_series[pl["id"]])
        out_places.append({**{k: pl[k] for k in ("id", "name", "kind")}, "series": bins, "peak": peak,
                           "busy_from": _busy_window(bins, peak["count"]),
                           "by_school": {k: round(v) for k, v in sorted(place_by_school[pl["id"]].items(), key=lambda kv: -kv[1])}})
    for sid, ser in own_canteens.items():
        bins, peak = summarize(ser)
        out_places.append({"id": f"own:{sid}", "name": f"Jídelna školy {sid}", "kind": "own-canteen",
                           "series": bins, "peak": peak, "busy_from": _busy_window(bins, peak["count"]), "by_school": {}})
    fbins, fpeak = summarize(free_series)
    arr_out = {k: [round(v, 2) for v in ser] for k, ser in arrivals.items() if not k.startswith("_by:")}
    arr_by = {k[4:]: {sid: round(n) for sid, n in sorted(v.items(), key=lambda kv: -kv[1])}
              for k, v in arrivals.items() if k.startswith("_by:")}
    return {"t0": hhmm(T0), "step_min": 5, "places": out_places, "arrivals": arr_out, "arrivals_by_school": arr_by,
            "free_students": {"series": fbins, "peak": fpeak}, "schools": report}


def _arrive_by_school(arrivals, key, sid, n):
    d = arrivals.setdefault("_by:" + key, {})
    d[sid] = d.get(sid, 0) + n


def _busy_window(bins, peak):
    """Od–do, kdy je tam aspoň polovina špičky."""
    if peak <= 0:
        return None
    idx = [i for i, v in enumerate(bins) if v >= peak / 2]
    return [hhmm(T0 + 5 * idx[0]), hhmm(T0 + 5 * idx[-1] + 5)]


def hhmm(m):
    return f"{m // 60}:{m % 60:02d}"
