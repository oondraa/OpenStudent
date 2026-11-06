"""Stahování VEŘEJNÝCH rozvrhů celé školy a převod do jednotného formátu.

Jednotný formát pro model:  {třída: {den 0-4: [(začátek_min, konec_min, obsazenost 0-1), ...]}}
obsazenost = jaká část třídy má v tu dobu výuku (1 = celá, 0.5 = jedna polovina při dělení).

Detail pro appku (Detail): {třída: [den: {"date", "off", "lessons": [Hodina]}]}, Hodina =
{s, e, subj, name, room, group, teacher, change}. change: "" | "sub" (suplování) | "add" (přidáno) |
"room" (změna učebny) | "cancel" (odpadá). Ukládá se jen zkratka učitele (je ve veřejném rozvrhu),
celá jména, témata hodin, poznámky ani texty změn (obsahují celá jména) se zahazují.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
from collections import defaultdict

from . import http

Lessons = dict[str, dict[int, list[tuple[int, int, float]]]]
Detail = dict[str, list[dict]]
CHANGE = {"Substitution": "sub", "Added": "add", "RoomChanged": "room", "Removed": "cancel", "Canceled": "cancel",
          "Cancelled": "cancel", "Absent": "cancel"}


def slots_from_detail(detail: Detail) -> Lessons:
    """Detail → formát modelu (kdo kdy sedí ve škole). Odpadlé hodiny se nepočítají."""
    out: Lessons = {}
    for cls, days in detail.items():
        out[cls] = {}
        for di, day in enumerate(days[:5]):
            by_time: dict[tuple[int, int], list[dict]] = defaultdict(list)
            for l in day["lessons"]:
                if l["change"] != "cancel":
                    by_time[(l["s"], l["e"])].append(l)
            out[cls][di] = sorted((s, e, 1.0 if any(not l["group"] for l in ls) or len(ls) >= 2 else 0.5)
                                  for (s, e), ls in by_time.items())
    return out


def _date(ddmm: str, monday: dt.date | None) -> str | None:
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.", ddmm or "")
    if not m:
        return None
    ref = monday or dt.date.today()
    best = None
    for y in (ref.year - 1, ref.year, ref.year + 1):
        try:
            d = dt.date(y, int(m.group(2)), int(m.group(1)))
        except ValueError:
            continue
        if best is None or abs((d - ref).days) < abs((best - ref).days):
            best = d
    return best.isoformat() if best else None


# ------------------------------------------------------------------ Bakaláři
def bakalari(base: str, week: str = "Actual") -> Detail:
    """week: Actual (tento týden vč. suplování) | Next | Permanent (stálý rozvrh)."""
    page = http.get(f"{base}/Timetable/Public", ttl=7 * 86400)
    sel = re.search(r'id="selectedClass".*?</select>', page, re.S)
    if not sel:
        raise http.FetchError(f"{base}: veřejný rozvrh není zapnutý")
    classes = [(i, n.strip()) for i, n in re.findall(r'<option[^>]*value="([^"]+)"[^>]*>\s*([^<]+?)\s*<', sel.group(0)) if i.strip()]
    monday = dt.date.today() - dt.timedelta(days=dt.date.today().weekday()) + dt.timedelta(days=7 if week == "Next" else 0)
    out: Detail = {}
    for cid, name in classes:
        html = http.get(f"{base}/Timetable/Public/{week}/Class/{cid}", ttl=6 * 3600)
        i = html.find("const timetableData = ")
        if i < 0:
            continue
        data, _ = json.JSONDecoder().raw_decode(html[i + len("const timetableData = "):])
        days = []
        for di, day in enumerate((data.get("Days") or [])[:5]):
            date = _date(day.get("Date"), monday) if week != "Permanent" else None
            if day.get("DayOff"):
                days.append({"date": date, "off": True, "lessons": []})
                continue
            lessons = []
            for h in day.get("Hours") or []:
                if h.get("Type") != "atoms":
                    continue
                for a in h.get("Atoms") or []:
                    subj = (a.get("SubjectAbbrev") or "").strip()
                    try:
                        code = json.loads(a.get("TooltipDetails") or "{}").get("infoChangeCode") or ""
                    except ValueError:
                        code = ""
                    change = CHANGE.get(code, "sub" if a.get("HasChanged") else "")
                    if h.get("InfoRemoved") or (not subj and change):
                        change = "cancel"
                    if not subj and change != "cancel":
                        continue
                    lessons.append({"s": h["BeginTimeValue"], "e": h["EndTimeValue"], "subj": subj,
                                    "name": " ".join((a.get("SubjectText") or subj).split()),
                                    "room": (a.get("Room") or "").strip(), "group": (a.get("GroupsNames") or "").strip(),
                                    "teacher": (a.get("Teacher") or "").strip(), "change": change})
            days.append({"date": date, "off": False, "lessons": sorted(lessons, key=lambda l: (l["s"], l["group"]))})
        out[name] = days
    return out


# ------------------------------------------------------------------ EduPage
def _monday(week: str) -> dt.date:
    return dt.date.today() - dt.timedelta(days=dt.date.today().weekday()) + dt.timedelta(days=7 if week == "Next" else 0)


def edupage(sub: str, week: str = "Actual", year: int | None = None) -> Detail:
    """Veřejný stálý rozvrh EduPage (suplování EduPage veřejně nedává)."""
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
    order = sorted(periods, key=lambda p: periods[p][0])
    groups = T.get("groups", {})
    short = lambda table, i: (T.get(table, {}).get(i, {}).get("short") or "").strip()
    monday = _monday(week)
    out: Detail = {cl["name"]: [{"date": (monday + dt.timedelta(days=di)).isoformat(), "off": False, "lessons": []}
                                for di in range(5)] for cl in T["classes"].values()}
    names = {cid: cl["name"] for cid, cl in T["classes"].items()}
    for c in T.get("cards", {}).values():
        les = T["lessons"].get(c.get("lessonid"))
        if not les or not c.get("period") or not c.get("days") or c["period"] not in order:
            continue
        dur = int(les.get("durationperiods") or 1)
        ps = order[order.index(c["period"]):order.index(c["period"]) + dur]
        s, e = periods[ps[0]][0], periods[ps[-1]][1]
        subj_row = T.get("subjects", {}).get(les.get("subjectid"), {})
        room = ", ".join(filter(None, (short("classrooms", r) for r in c.get("classroomids") or [])))
        teacher = ", ".join(filter(None, (short("teachers", t) for t in les.get("teacherids") or [])))
        for di, flag in enumerate(c["days"][:5]):
            if flag != "1":
                continue
            for cl in les.get("classids", []):
                if cl not in names:
                    continue
                gs = [groups[g] for g in les.get("groupids", []) if g in groups and groups[g].get("classid") == cl]
                group = "" if not gs or any(g.get("entireclass") for g in gs) else ", ".join(g.get("name", "") for g in gs)
                out[names[cl]][di]["lessons"].append({
                    "s": s, "e": e, "subj": (subj_row.get("short") or "").strip(),
                    "name": (subj_row.get("name") or subj_row.get("short") or "").strip(),
                    "room": room, "group": group, "teacher": teacher, "change": ""})
    for days in out.values():
        for day in days:
            day["lessons"].sort(key=lambda l: (l["s"], l["group"]))
    return out


# ------------------------------------------------------------------ Kyberna (KybernaIS)
KYBERNA_TIMES = [(420, 465), (470, 515), (525, 570), (585, 630), (645, 690), (705, 750),
                 (765, 810), (825, 870), (885, 930), (945, 990), (1005, 1050), (1065, 1110)]


def kyberna(base: str = "https://sis.ssakhk.cz/TimeTable/", week: str = "Actual") -> Detail:
    """Veřejné obrázky rozvrhu celé školy (PO1.jpg … PA1.jpg). Řádek = třída, sloupec = hodina.
    Obsazenost se pozná z tmavých pixelů v buňce; OCR jen na popisky řádků (je-li Tesseract)."""
    from PIL import Image

    out: Detail = {}
    monday = _monday(week)
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
                    slots.append({"s": b, "e": e, "subj": "", "name": "", "room": "", "group": "", "teacher": "", "change": ""})
            days = out.setdefault(label, [{"date": (monday + dt.timedelta(days=k)).isoformat(), "off": False, "lessons": []}
                                          for k in range(5)])
            days[di]["lessons"] = slots
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


def fetch(school: dict, week: str = "Actual") -> Detail:
    if school["system"] == "bakalari":
        urls = school["url"] if isinstance(school["url"], list) else [school["url"]]
        out: Detail = {}
        for u in urls:
            out.update(bakalari(u, week))
        return out
    if school["system"] == "edupage":
        return edupage(school["url"], week)
    if school["system"] == "kybernais":
        return kyberna(school["url"], week)
    raise http.FetchError(f"{school['id']}: systém {school['system']} nepodporujeme")
