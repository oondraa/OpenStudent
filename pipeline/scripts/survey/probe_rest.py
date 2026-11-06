"""Druhé kolo: dohledá systém u škol, kde úvodní stránka nic neprozradila."""
import re, urllib.request, concurrent.futures as cf

UA = {"User-Agent": "Mozilla/5.0 (OpenStudent school-survey)"}
PAT = re.compile(r'''(?:href|src)=["']([^"']*(?:bakalar|edupage|skolaonline|rozvrh|timetable|suplov|isas|iskola|sis\.|\.pdf|\.htm)[^"']*)["']''', re.I)


def fetch(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12)
        return r.status, r.geturl(), r.read(600000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:
        return type(e).__name__, url, ""


PAGES = [
    "https://www.gjkt.cz/", "https://gjkt.cz/", "http://www.gjkt.cz/",
    "https://www.sssoghk.cz/", "https://sssoghk.cz/", "http://www.sssoghk.cz/",
    "https://www.zsuprkova.cz/", "https://zsuprkova.cz/", "http://www.zsuprkova.cz/",
    "https://www.sion.cz/stredni-skola/edupage/", "https://www.sion.cz/zakladni-skola/",
    "https://www.stefcova.cz/ZS-Stefcova", "https://www.zssnp.cz/",
    "https://www.habrmanova.cz/rozvrhy", "https://www.zspouchov.cz/Rozvrh-hodin",
    "https://zskukleny.cz/zakladni-skola/vzdelavani/rozvrh-hodin/", "https://zs-malsovalhota.cz/rozvrhy",
    "https://www.vizualskola.cz/studenti/bakalari/", "https://soavoshk.cz/", "https://skolacomenius.cz/",
    "https://www.scioskola.cz/hradec-kralove", "https://skolytalent.cz/", "https://www.skolakrok.cz/",
    "https://erazim.cz/", "https://www.daneta.cz/", "https://www.prointepo.org/", "https://www.specialnihk.cz/",
    "https://zshorakhk.cz/", "https://www.sosasou-vocelova.cz/rozvrh-hodin/", "https://www.oahk.cz/rozvrh/",
    "https://www.hradebni.cz/rozvrh-hodin-a-prestavky", "https://www.ssakhk.cz/", "https://sis.ssakhk.cz/",
]
GUESS = [f"https://{n}.bakalari.cz/Timetable/Public" for n in
         ("gjkt", "sssoghk", "zsuprkova", "stefcova", "zssnp", "habrmanova", "zspouchov", "zskukleny", "vizualskola",
          "soavoshk", "skolacomenius", "zshk", "zsmhhk", "zshorakhk", "sion", "highschool", "specialnihk", "daneta")] + \
        [f"https://bakalari.{d}/Timetable/Public" for d in
         ("gjkt.cz", "sssoghk.cz", "zsuprkova.cz", "stefcova.cz", "zssnp.cz", "habrmanova.cz", "zspouchov.cz",
          "zskukleny.cz", "soavoshk.cz", "zsmhhk.cz", "zshk.cz")] + \
        [f"https://{n}.edupage.org/timetable/" for n in
         ("sion", "zssion", "sionhighschool", "highschool", "gjkt", "sssoghk", "zsuprkova", "stefcova", "zssnp",
          "habrmanova", "zspouchov", "zskukleny", "soavoshk", "skolacomenius", "zsmalsovalhota", "vizualskola")]

with cf.ThreadPoolExecutor(12) as ex:
    pages = list(ex.map(fetch, PAGES))
    guesses = list(ex.map(fetch, GUESS))
for url, (st, final, html) in zip(PAGES, pages):
    hits = sorted(set(PAT.findall(html)))
    hits = [h for h in hits if not re.search(r"wp-(content|includes)|\.css|\.js", h)][:15]
    print(f"== {url} [{st}] -> {final}")
    for h in hits:
        print("    ", h[:130])
print("\n### Odhadnuté adresy")
for url, (st, final, html) in zip(GUESS, guesses):
    if st == 200:
        pub = "selectedClass" in html
        edu = "edupage" in url and "timetable" in final and "login" not in final.lower()
        print(f"  {st} {url} -> {final} {'VEŘEJNÝ' if pub else ''} {'EDU-OK' if edu else ''} len={len(html)}")
