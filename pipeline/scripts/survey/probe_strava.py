"""Které školy / jídelny v HK používají Strava.cz (a s jakým číslem jídelny).

Projde úvodní stránku školy + stránky, jejichž odkaz mluví o jídelně / obědech / stravování
(max. 12 stránek na školu, jen stejná doména), a hledá odkazy na strava.cz s číslem jídelny
(`jidelna=1234`, `zarizeni=1234`). Jen veřejné stránky, šetrně přes openstudent.http (cache).

python scripts/survey/probe_strava.py   → data/raw/strava.json
"""
import json
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from openstudent import http  # noqa: E402
from fetch_logos import SITE_OVERRIDE  # noqa: E402

A = re.compile(r'<a\b[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
FOOD = re.compile(r"(jidel|jídel|obed|oběd|strav|menu|jidlo|jídlo|kantyn|kuchyn)", re.I)
STRAVA = re.compile(r"strava\.cz[^\"'<> ]*?(?:jidelna|zarizeni)=?(\d{3,5})|strava\.cz/[^\"'<> ]*?jidelnicky\?(\d{3,5})", re.I)
SKIP = re.compile(r"\.(pdf|jpe?g|png|gif|svg|docx?|xlsx?|zip|mp4|css|js|ico)(\?|$)|mailto:|tel:|javascript:", re.I)

EXTRA = {  # jídelny, které nejsou součástí školy
    "jidelna-hradecka": ["https://www.jidelnahradecka.cz/"],
}


def scan(start_urls):
    found, seen, uses = {}, set(), False
    queue = list(start_urls)
    host = urllib.parse.urlsplit(start_urls[0]).netloc.removeprefix("www.")
    while queue and len(seen) < 12:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            page = http.get(url, ttl=7 * 86400)
        except Exception:
            continue
        if "strava.cz" in page.lower():
            uses = True
        for m in STRAVA.finditer(page):
            found[m.group(1) or m.group(2)] = url
        for href, text in A.findall(page):
            u = urllib.parse.urljoin(url, href.strip()).split("#")[0]
            if SKIP.search(u) or urllib.parse.urlsplit(u).netloc.removeprefix("www.") != host:
                continue
            if FOOD.search(u) or FOOD.search(re.sub("<[^>]+>", "", text)):
                if u not in seen and u not in queue:
                    queue.insert(0, u)  # stránky o jídle přednostně
    return {"uses_strava": uses or bool(found), "jidelny": found, "pages": len(seen)}


def main():
    out = {}
    schools = json.loads((ROOT / "data" / "schools.json").read_text(encoding="utf-8"))
    targets = [(s["id"], ([SITE_OVERRIDE[s["domain"]]] if s["domain"] in SITE_OVERRIDE else []) + [f"https://www.{s['domain']}/"])
               for s in schools if s.get("system") != "-"] + list(EXTRA.items())
    for sid, urls in targets:
        r = None
        for u in urls:
            r = scan([u])
            if r["pages"]:
                break
        out[sid] = r
        tag = ", ".join(r["jidelny"]) if r["jidelny"] else ("odkaz bez čísla" if r["uses_strava"] else "—")
        print(f"  {sid:18} {tag}")
    (ROOT / "data" / "raw" / "strava.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
