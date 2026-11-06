"""Projde úvodní stránky webů škol a hledá, jaký školní systém / rozvrh používají.

Jen čte veřejné úvodní stránky (1 požadavek na web), nic nepřihlašuje.
"""
import json, re, urllib.request, concurrent.futures as cf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
schools = json.loads((ROOT / "data/schools_hk_register.json").read_text(encoding="utf-8"))
UA = {"User-Agent": "Mozilla/5.0 (OpenStudent school-survey)"}
SKIP = {"seznam.cz", "volny.cz", "gmail.com", "email.cz", "centrum.cz"}
PAT = re.compile(r'''(?:href|src)=["']([^"']*(?:bakalar|edupage|skolaonline|rozvrh|timetable|suplov|isas|iskola|klasifikace|sis\.)[^"']*)["']''', re.I)


def fetch(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12)
        return r.geturl(), r.read(600000).decode("utf-8", "replace")
    except Exception as e:
        return f"ERR {type(e).__name__}", ""


def probe(dom):
    final = None
    for url in (f"https://www.{dom}/", f"https://{dom}/", f"http://www.{dom}/"):
        final, html = fetch(url)
        if html:
            return dom, final, sorted(set(PAT.findall(html)))[:25]
    return dom, final, []


doms = sorted({e.split("@")[1].lower().strip(".").replace("..", ".")
               for s in schools if s["druh"] in ("ZŠ", "SŠ", "VOŠ") for e in s["emaily"] if "@" in e} - SKIP)
with cf.ThreadPoolExecutor(12) as ex:
    res = list(ex.map(probe, doms))
out = {d: {"final": f, "hits": h} for d, f, h in res}
(ROOT / "data/raw/probe_homepages.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
for d, f, h in res:
    print(f"== {d} -> {f}")
    for x in h:
        print("    ", x[:120])
