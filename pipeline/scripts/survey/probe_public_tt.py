"""Ověří, zda je u Bakalářů / EduPage veřejně dostupný rozvrh (bez přihlášení).

Na každou instanci 1 požadavek. Jen veřejné stránky.
"""
import json, re, sys, urllib.request, concurrent.futures as cf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (OpenStudent school-survey)"}

BAKALARI = [
    "https://bezrucka.bakalari.cz/bakaweb", "https://bisgymbb.bakalari.cz/bakaweb", "https://gybon.bakalari.cz",
    "https://bakalari.supshk.cz", "https://hotelovka.bakalari.cz", "https://bakalari.hradebni.cz",
    "https://bakalari2.hradebni.cz", "https://bakalari.mandyska.cz", "https://bakalari.neslhk.com",
    "https://oahk.bakalari.cz", "https://psjg.bakalari.cz/bakaweb", "https://vocelova.bakalari.cz",
    "https://b.sosvet.cz/bakaweb", "https://sspphk.bakalari.cz", "https://zsgocarova.bakalari.cz",
    "https://ibakalari.zshk.cz", "https://bakalari.zsmhhk.cz", "https://zsjirasek.bakalari.cz",
    "https://zsnovyhk.bakalari.cz", "https://bakalari.zsplotiste.eu", "https://bakalari.zssever.cz",
    "https://bakalari.zsstefanikovahk.cz",
] + sys.argv[1:]
EDUPAGE = ["https://spsstavhk.edupage.org", "https://zssvobodnedvory.edupage.org"]


def fetch(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15)
        return r.status, r.geturl(), r.read(800000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:
        return type(e).__name__, url, ""


def bak(base):
    st, final, html = fetch(base + "/Timetable/Public")
    # seznam tříd je v <select id="selectedClass"> ... <option value="XX">1.A</option>
    m = re.search(r'id="selectedClass".*?</select>', html, re.S)
    classes = re.findall(r'<option[^>]*value="([^"]+)"[^>]*>\s*([^<]+?)\s*<', m.group(0)) if m else []
    rooms = re.search(r'id="selectedRoom".*?</select>', html, re.S)
    nrooms = len(re.findall(r"<option", rooms.group(0))) if rooms else 0
    login = "login" in final.lower()
    return {"base": base, "status": st, "final": final, "public": bool(classes), "login_redirect": login,
            "classes": [c[1] for c in classes if c[0].strip()], "class_ids": [c[0] for c in classes if c[0].strip()],
            "rooms": nrooms}


def edu(base):
    st, final, html = fetch(base + "/timetable/")
    return {"base": base, "status": st, "final": final, "has_tt_page": "timetable" in final and st == 200,
            "login_redirect": "login" in final.lower()}


with cf.ThreadPoolExecutor(8) as ex:
    b = list(ex.map(bak, BAKALARI))
    e = list(ex.map(edu, EDUPAGE))
(ROOT / "data/raw/probe_public_tt.json").write_text(json.dumps({"bakalari": b, "edupage": e}, ensure_ascii=False, indent=1), encoding="utf-8")
for r in b:
    print(f'{"VEŘEJNÝ" if r["public"] else "-------"} {r["status"]} {r["base"]:45} tříd={len(r["classes"]):3} učeben={r["rooms"]:3} {"(login)" if r["login_redirect"] else ""} {" ".join(r["classes"][:6])}')
for r in e:
    print("EDUPAGE", r)
