"""Důkladný průzkum škol, u kterých nemáme veřejný rozvrh.

Projde web školy do hloubky 2 (max ~40 stránek, jen stejná doména, přednostně odkazy
o rozvrhu / žácích / rodičích / IS), sesbírá všechny odkazy na školní systémy a každý
nalezený systém ověří (veřejný rozvrh Bakalářů / EduPage). Jen veřejné stránky, šetrně.

python scripts/survey/deep_probe.py            → data/raw/deep_probe.json
"""
import json
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from openstudent import http  # noqa: E402

SYS = re.compile(r"(bakalar|edupage\.org|skolaonline|iskola|isas|klasifikace|timetable|rozvrh|suplov|komens)", re.I)
PRIO = re.compile(r"(rozvrh|suplov|zak|zac|rodic|student|bakal|edupage|online|informacni|system|zakovsk|klasifik|uzitecne|odkaz|skola)", re.I)
SKIP = re.compile(r"\.(pdf|jpe?g|png|gif|svg|docx?|xlsx?|zip|mp4|css|js|ico)(\?|$)|mailto:|tel:|javascript:|#", re.I)

EXTRA_SITES = {  # weby, které nejsou z e-mailu v rejstříku poznat
    "zs-diakonie": ["https://specialniskolahradeckralove.diakonie.cz/"],
    "sionhs": ["https://www.sion.cz/stredni-skola/"],
    "zs-sion": ["https://www.sion.cz/zakladni-skola/"],
    "kyberna": [],
}


def links(base, html):
    out = []
    for href, text in re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.S | re.I):
        u = urllib.parse.urljoin(base, href.strip())
        out.append((u, re.sub(r"<[^>]+>|\s+", " ", text).strip()[:60]))
    return out


def crawl(start, limit=40):
    host = urllib.parse.urlsplit(start).netloc.removeprefix("www.")
    seen, queue, found, pages = set(), [(start, 0)], {}, []
    while queue and len(pages) < limit:
        queue.sort(key=lambda x: (x[1], not PRIO.search(x[0])))
        url, depth = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            html = http.get(url, ttl=7 * 86400)
        except Exception as e:  # noqa: BLE001
            if not pages:
                return {"error": str(e)}, []
            continue
        pages.append(url)
        for u, t in links(url, html):
            h = urllib.parse.urlsplit(u).netloc.removeprefix("www.")
            if SYS.search(u) or SYS.search(t):
                if h != host or SYS.search(u):
                    found.setdefault(u, t)
            if h == host and depth < 2 and not SKIP.search(u) and u not in seen:
                if depth == 0 or PRIO.search(u) or PRIO.search(t):
                    queue.append((u.split("#")[0], depth + 1))
        # i iframy a skripty (vložené rozvrhy)
        for u in re.findall(r'<iframe[^>]+src=["\']([^"\']+)', html, re.I):
            found.setdefault(urllib.parse.urljoin(url, u), "iframe")
    return found, pages


def bakalari_base(u):
    m = re.match(r"(https?://[^/]+(?:/bakaweb)?)", u, re.I)
    return m.group(1) if m else None


def verify(found):
    res = {}
    bases = {bakalari_base(u) for u in found if "bakal" in u.lower()}
    for b in filter(None, bases):
        try:
            page = http.get(f"{b}/Timetable/Public", ttl=86400)
            n = len(re.findall(r"<option", (re.search(r'id="selectedClass".*?</select>', page, re.S) or [""])[0]))
            res[b] = {"system": "bakalari", "public": n > 0, "classes": max(0, n - 1)}
        except http.FetchError as e:
            res[b] = {"system": "bakalari", "public": False, "error": str(e)[:120]}
    for sub in {re.search(r"//([\w-]+)\.edupage\.org", u).group(1) for u in found if ".edupage.org" in u}:
        try:
            v = json.loads(http.get(f"https://{sub}.edupage.org/timetable/server/ttviewer.js?__func=getTTViewerData",
                                    data={"__args": [None, 2026], "__gsh": "00000000"}, ttl=86400))
            tts = v["r"]["regular"]["timetables"]
            res[sub + ".edupage.org"] = {"system": "edupage", "public": bool(tts),
                                         "timetables": [t.get("text") for t in tts]}
        except (http.FetchError, KeyError, ValueError) as e:
            res[sub + ".edupage.org"] = {"system": "edupage", "public": False, "error": str(e)[:120]}
    if any("skolaonline" in u.lower() for u in found):
        res["skolaonline"] = {"system": "skolaonline", "public": False, "note": "Škola OnLine – rozvrh jen po přihlášení"}
    return res


def main():
    schools = json.loads((ROOT / "data/schools.json").read_text(encoding="utf-8"))
    out = {}
    for s in schools:
        if s["public"] and s["id"] != "kyberna":
            continue
        if s["id"] == "kyberna":
            continue
        starts = EXTRA_SITES.get(s["id"]) or [f"https://www.{s['domain']}/", f"https://{s['domain']}/", f"http://www.{s['domain']}/"]
        found, pages, err = {}, [], None
        for st in starts:
            f, p = crawl(st)
            if "error" in f:
                err = f["error"]
                continue
            found, pages, err = f, p, None
            break
        try:
            ver = verify(found) if found else {}
        except Exception as e:  # noqa: BLE001 – průzkum nesmí spadnout kvůli jedné škole
            ver = {"error": {"public": False, "error": str(e)[:120]}}
        out[s["id"]] = {"name": s["short"], "domain": s["domain"], "pages_checked": len(pages), "error": err,
                        "links": dict(list(found.items())[:40]), "verified": ver}
        flag = "VEŘEJNÝ " if any(v.get("public") for v in ver.values()) else ""
        print(flush=True)
        print(f"== {s['id']:18} stránek={len(pages):3} {flag}{err or ''}")
        for k, v in ver.items():
            print(f"     {k}: {v}")
    (ROOT / "data/raw/deep_probe.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
