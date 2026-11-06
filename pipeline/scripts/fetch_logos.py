"""Stáhne logo každé školy z jejího veřejného webu → web/logos/<id>.<ext> + web/logos/index.json.

Pořadí kandidátů: <img> s „logo“ v src/class/id/alt (přednostně v hlavičce) → inline <svg> s „logo“
→ apple-touch-icon → favicon (rel=icon, největší). Šetrně přes openstudent.http (cache, 1,5 s/server).
Ruční přepsání: LOGO_OVERRIDE (id → URL obrázku).

python scripts/fetch_logos.py [--only gbn,kyberna]
"""
import html
import json
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from openstudent import http  # noqa: E402

OUT = ROOT / "web" / "logos"
SCHOOLS = ROOT / "data" / "schools.json"

SITE_OVERRIDE = {  # weby, které nejsou www.<doména z e-mailu>
    "hnn.cz": "https://www.supshk.cz/",
    "edu-zssnp.cz": "https://www.zssnphk.cz/",
    "zshorakhk.cz": "https://www.zsmhhk.cz/",
    "ssakhk.cz": "https://www.ssakhk.cz/",
    "neslhk.com": "https://www.neslhk.com/",
}
LOGO_OVERRIDE: dict[str, str] = {  # zkontrolováno očima 6. 11. 2026
    "gbn": "https://www.gybon.cz/wp-content/uploads/2015/01/logo.png",  # v <img> je jen banner OPVK
    "sionhs": "https://www.sion.cz/stredni-skola/wp-content/themes/sion/dist/images/favicon/apple-touch-icon.png",
}

IMG = re.compile(r"<img\b[^>]*>", re.I)
ATTR = re.compile(r'([\w:-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')')
LINK = re.compile(r"<link\b[^>]*>", re.I)
SVG = re.compile(r"<svg\b[^>]*>.*?</svg>", re.I | re.S)
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/gif": "gif",
       "image/webp": "webp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico"}


def attrs(tag):
    return {m.group(1).lower(): html.unescape(m.group(3) if m.group(3) is not None else m.group(4) or "")
            for m in ATTR.finditer(tag)}


def candidates(page, base):
    head_end = max(page.lower().find("</header>"), 0) or len(page) // 3
    out = []
    for m in IMG.finditer(page):
        a = attrs(m.group(0))
        src = a.get("src") or a.get("data-src") or a.get("data-lazy-src") or ""
        if not src or src.startswith("data:"):
            continue
        hay = " ".join([src, a.get("class", ""), a.get("id", ""), a.get("alt", "")]).lower()
        if "logo" not in hay or any(w in hay for w in ("partner", "sponzor", "eu-", "msmt", "facebook", "instagram", "erasmus", "esf")):
            continue
        score = 100 + (50 if m.start() < head_end else 0) + (20 if "logo" in src.lower().rsplit("/", 1)[-1] else 0)
        out.append((score - m.start() / 1e6, urllib.parse.urljoin(base, src)))
    for m in SVG.finditer(page[:head_end + 20000]):
        if "logo" in m.group(0)[:400].lower():
            out.append((90, "inline-svg:" + m.group(0)))
            break
    for m in LINK.finditer(page):
        a = attrs(m.group(0))
        rel, href = a.get("rel", "").lower(), a.get("href")
        if not href:
            continue
        size = max([int(x) for x in re.findall(r"(\d+)x\d+", a.get("sizes", ""))] or [0])
        if "apple-touch-icon" in rel:
            out.append((60 + size / 100, urllib.parse.urljoin(base, href)))
        elif "icon" in rel:
            out.append((40 + size / 100, urllib.parse.urljoin(base, href)))
    out.append((10, urllib.parse.urljoin(base, "/favicon.ico")))
    return [u for _, u in sorted(out, key=lambda x: -x[0])]


def sniff(raw):
    if raw[:8] == b"\x89PNG\r\n\x1a\n": return "png"
    if raw[:3] == b"\xff\xd8\xff": return "jpg"
    if raw[:4] == b"GIF8": return "gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP": return "webp"
    if raw[:4] == b"\x00\x00\x01\x00": return "ico"
    if b"<svg" in raw[:2000].lower(): return "svg"
    return None


def main():
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "index.json"
    index = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {}
    for s in json.loads(SCHOOLS.read_text(encoding="utf-8")):
        if only and s["id"] not in only or s.get("system") == "-":
            continue
        dom = s.get("domain") or ""
        sites = ([SITE_OVERRIDE[dom]] if dom in SITE_OVERRIDE else []) + [f"https://www.{dom}/", f"https://{dom}/"]
        page, base = None, None
        for site in sites:
            try:
                page, base = http.get(site, ttl=7 * 86400), site
                break
            except Exception as e:
                err = e
        if page is None:
            print(f"  ✗ {s['id']:18} web: {err}")
            continue
        cands = ([LOGO_OVERRIDE[s["id"]]] if s["id"] in LOGO_OVERRIDE else []) + candidates(page, base)
        for url in cands[:6]:
            try:
                if url.startswith("inline-svg:"):
                    raw = url[len("inline-svg:"):].encode()
                    url = base + "#inline-svg"
                else:
                    raw = http.get(url, ttl=30 * 86400, binary=True)
            except Exception:
                continue
            ext = sniff(raw)
            if not ext or len(raw) < 200:
                continue
            for old in OUT.glob(f"{s['id']}.*"):
                if old.suffix != ".json":
                    old.unlink()
            (OUT / f"{s['id']}.{ext}").write_bytes(raw)
            index[s["id"]] = {"file": f"{s['id']}.{ext}", "source": url}
            print(f"  ✓ {s['id']:18} {ext:4} {url[:90]}")
            break
        else:
            print(f"  ✗ {s['id']:18} logo nenalezeno")
    idx_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
