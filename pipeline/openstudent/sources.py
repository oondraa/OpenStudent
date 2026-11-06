"""Stahování VEŘEJNÝCH rozvrhů celé školy a převod do jednotného formátu.

Jednotný formát:  {třída: {den 0-4: [(začátek_min, konec_min, obsazenost 0-1), ...]}}
obsazenost = jaká část třídy má v tu dobu výuku (1 = celá, 0.5 = jedna polovina při dělení).

Ukládá se jen třída / čas / obsazenost. Jména učitelů, témata hodin ani poznámky se neukládají.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
from collections import defaultdict

from . import http

Lessons = dict[str, dict[int, list[tuple[int, int, float]]]]


# ------------------------------------------------------------------ Bakaláři
def bakalari(base: str, week: str = "Actual") -> Lessons:
    """week: Actual (tento týden vč. suplování) | Next | Permanent (stálý rozvrh)."""
    page = http.get(f"{base}/Timetable/Public", ttl=7 * 86400)
    sel = re.search(r'id="selectedClass".*?</select>', page, re.S)
    if not sel:
        raise http.FetchError(f"{base}: veřejný rozvrh není zapnutý")
    classes = [(i, n.strip()) for i, n in re.findall(r'<option[^>]*value="([^"]+)"[^>]*>\s*([^<]+?)\s*<', sel.group(0)) if i.strip()]
    out: Lessons = {}
    for cid, name in classes:
        html = http.get(f"{base}/Timetable/Public/{week}/Class/{cid}", ttl=6 * 3600)
        i = html.find("const timetableData = ")
        if i < 0:
            continue
        data, _ = json.JSONDecoder().raw_decode(html[i + len("const timetableData = "):])
        days = {}
        for di, day in enumerate((data.get("Days") or [])[:5]):
            if day.get("DayOff"):
                days[di] = []
                continue
            slots = []
            for h in day.get("Hours") or []:
                if h.get("Type") != "atoms" or h.get("InfoRemoved"):
                    continue
                atoms = [a for a in (h.get("Atoms") or []) if a.get("SubjectAbbrev") or a.get("SubjectText")]
                if not atoms:
                    continue
                whole = any(not a.get("GroupsNames") for a in atoms)
                busy = 1.0 if whole or len(atoms) >= 2 else 0.5
                slots.append((h["BeginTimeValue"], h["EndTimeValue"], busy))
            days[di] = sorted(slots)
        out[name] = days
    return out


# ------------------------------------------------------------------ EduPage
def edupage(sub: str, year: int | None = None) -> Lessons:
    base = f"https://{sub}.edupage.org/timetable/server"
    year = year or (dt.date.today().year if dt.date.today().month >= 8 else dt.date.today().year - 1)
    v = json.loads(http.get(f"{base}/ttviewer.js?__func=getTTViewerData",
                            data={"__args": [None, year], "__gsh": "00000000"}, ttl=86400))
    tts = v["r"]["regular"]["timetables"]
    today = dt.date.today().isoformat()
    tts = [t for t in tts if t.get("datefrom", "") <= today] or tts
    if not tts:
        raise http.FetchError(f"{sub}: EduPage nemá zveřejněný rozvrh")
    tt = max(tts, key=lambda t: t.get("datefrom", ""))
    d = json.loads(http.get(f"{base}/regulartt.js?__func=regularttGetData",
                            data={"__args": [None, tt["tt_num"]], "__gsh": "00000000"}, ttl=86400))
    T = {t["id"]: {r["id"]: r for r in t["data_rows"]} for t in d["r"]["dbiAccessorRes"]["tables"]}

    def mins(s):
        h, m = s.split(":")
        return int(h) * 60 + int(m)

    periods = {p["period"]: (mins(p["starttime"]), mins(p["endtime"])) for p in T["periods"].values()}
    order = sorted(periods)
    groups, divisions = T.get("groups", {}), T.get("divisions", {})
    busy = defaultdict(set)  # (classid, day, period) -> set(groupid)
    for c in T.get("cards", {}).values():
        les = T["lessons"].get(c.get("lessonid"))
        if not les or not c.get("period") or not c.get("days"):
            continue
        dur = int(les.get("durationperiods") or 1)
        start = order.index(c["period"]) if c["period"] in order else None
        if start is None:
            continue
        for di, flag in enumerate(c["days"][:5]):
            if flag != "1":
                continue
            for p in order[start:start + dur]:
                for cl in les.get("classids", []):
                    for g in les.get("groupids", []):
                        if groups.get(g, {}).get("classid") == cl:
                            busy[(cl, di, p)].add(g)

    def fraction(cl, gs):
        if any(groups[g].get("entireclass") for g in gs if g in groups):
            return 1.0
        best = 0.0
        for dv in divisions.values():
            if dv.get("classid") != cl or not dv.get("groupids"):
                continue
            best = max(best, len(set(dv["groupids"]) & gs) / len(dv["groupids"]))
        return best or 0.5

    out: Lessons = {}
    for cid, cl in T["classes"].items():
        days = {di: [] for di in range(5)}
        for (c, di, p), gs in busy.items():
            if c == cid:
                days[di].append((*periods[p], fraction(cid, gs)))
        out[cl["name"]] = {k: sorted(v) for k, v in days.items()}
    return out


# ------------------------------------------------------------------ Kyberna (KybernaIS)
KYBERNA_TIMES = [(420, 465), (470, 515), (525, 570), (585, 630), (645, 690), (705, 750),
                 (765, 810), (825, 870), (885, 930), (945, 990), (1005, 1050), (1065, 1110)]


def kyberna(base: str = "https://sis.ssakhk.cz/TimeTable/") -> Lessons:
    """Veřejné obrázky rozvrhu celé školy (PO1.jpg … PA1.jpg). Řádek = třída, sloupec = hodina.
    Obsazenost se pozná z tmavých pixelů v buňce; OCR jen na popisky řádků (je-li Tesseract)."""
    from PIL import Image

    out: Lessons = {}
    for di, code in enumerate(["PO1", "UT1", "ST1", "CT1", "PA1"]):
        try:
            img = Image.open(io.BytesIO(http.get(f"{base}{code}.jpg", ttl=3 * 3600, binary=True))).convert("L")
        except http.FetchError:
            continue
        w, h = img.size
        px = img.load()
        # vodorovné čáry přes celou mřížku (≥ 80 % šířky) → hranice řádků (tříd)
        span = range(45, min(w, 1100))
        lines = [y for y in range(90, h - 2) if sum(px[x, y] < 120 for x in span) > 0.8 * len(span)]
        rows = [y for i, y in enumerate(lines) if i == 0 or y - lines[i - 1] > 3]
        x0, cw = 40, 90  # mřížka hodin: čára na x=40, každá hodina 90 px (3 podsloupce pro skupiny)
        for r0, r1 in zip(rows, rows[1:]):
            if not 30 <= r1 - r0 <= 60:
                continue
            label_box = img.crop((2, r0 + 2, 38, r1 - 1))
            if min(label_box.getdata()) > 120:  # prázdný řádek bez popisku → konec tříd
                continue
            label = _ocr_label(label_box) or f"řádek{r0}"
            if re.fullmatch(r"\d", label):  # tenké „I“ OCR ztrácí (I2 → „2“); jiné popisky mají široké písmeno
                label = "I" + label
            slots = []
            for col, (b, e) in enumerate(KYBERNA_TIMES):
                cx = x0 + col * cw
                if cx + cw > w:
                    break
                ys_ = range(r0 + 3, r1 - 3)
                dark = 0
                for x in range(cx + 3, cx + cw - 3):
                    col_dark = sum(px[x, y] < 130 for y in ys_)
                    if col_dark < 0.7 * len(ys_):  # svislé čáry podsloupců přeskočit
                        dark += col_dark
                if dark > 25:  # i krátký text „MAT/TI/B13“ má > 60 tmavých pixelů, šum JPEG < 10
                    slots.append((b, e, 1.0))
            out.setdefault(label, {})[di] = slots
    return out


def _ocr_label(crop) -> str:
    """Popisek řádku (G1, T2, I4…) přes Tesseract CLI. Bez Tesseractu vrátí ''."""
    import os, shutil, subprocess, tempfile
    exe = shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if not os.path.exists(exe) and not shutil.which("tesseract"):
        return ""
    crop = crop.resize((crop.width * 4, crop.height * 4)).point(lambda p: 0 if p < 150 else 255)
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        crop.save(path)
        r = subprocess.run([exe, path, "stdout", "--psm", "7", "-c",
                            "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
                           capture_output=True, text=True, timeout=20)
        return r.stdout.strip().replace(" ", "")
    except (OSError, subprocess.SubprocessError):
        return ""
    finally:
        os.unlink(path)


def fetch(school: dict, week: str = "Actual") -> Lessons:
    if school["system"] == "bakalari":
        urls = school["url"] if isinstance(school["url"], list) else [school["url"]]
        out: Lessons = {}
        for u in urls:
            out.update(bakalari(u, week))
        return out
    if school["system"] == "edupage":
        return edupage(school["url"])
    if school["system"] == "kybernais":
        return kyberna(school["url"])
    raise http.FetchError(f"{school['id']}: systém {school['system']} nepodporujeme")
