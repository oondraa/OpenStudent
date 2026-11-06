# OpenŠtudent

**Kdo má v Hradci Králové kdy volno.** Princip z OpenSISAKHK (volné učebny / posilovna z rozvrhu celé školy)
rozšířený na všechny školy v HK: z veřejných rozvrhů všech tříd se spočítá

- kolik žáků má **zrovna delší pauzu** (typicky polední),
- kolik lidí čekat v **Jídelně Hradecká** (Hradecká 1219, výdej 11:15–14:30, kapacita 4000 obědů) a kdy je špička,
- jestli a kolik studentů bude v **OC Futurum, Aupark a Atrium** a kdy jich bude nejvíc,
- odkud (ze kterých škol) ti lidé jsou.

## Spuštění

```bash
set PYTHONPATH=src            # PowerShell: $env:PYTHONPATH="src"
python -m openstudent run     # katalog → stažení rozvrhů → předpověď na dnešek
python -m openstudent forecast --date 2026-11-10    # jiný den (stejný týden)
python -m http.server -d web 8000                  # pak otevři http://localhost:8000
```

Jednotlivě: `catalog` (seznam škol + poloha), `fetch [--only gbn,kyberna] [--week Actual|Next|Permanent]`,
`forecast`. Potřeba je jen Python 3.11 a Pillow; Tesseract je volitelný (popisky tříd u Kyberny).

## Odkud jsou data

| Co | Zdroj |
|---|---|
| Seznam škol, kapacity, jídelny | Rejstřík škol MŠMT, open data (`data/raw/rssz-khk.jsonld`) |
| Poloha škol a OC | Adresní body RÚIAN (ČÚZK) |
| Rozvrhy | Veřejný rozvrh Bakalářů (`/Timetable/Public`), veřejný rozvrh EduPage, veřejné obrázky rozvrhu KybernaIS |
| Jídelna Hradecká | jidelnahradecka.cz (výdejní doba), vnitřní řád |

Průzkum, jaký systém která škola má, je v `scripts/survey/` a výsledek v `data/schools.json`.

## Bezpečné a slušné stahování

- **Jen to, co škola sama zveřejnila bez přihlášení.** Žádné přihlašování, žádné cizí účty. Kde Bakaláři
  přesměrují na login, škola je označená jako neveřejná a nestahuje se.
- **Šetrně:** max. 1 požadavek za 1,5 s na server, cache 6 h, při 429/503 se čeká. Celé HK ≈ 600 tříd ≈ 15 min,
  stačí jednou denně (ideálně v noci, kdy školy dopíšou suplování).
- **Žádné osobní údaje:** ukládá se jen třída / čas / jaká část třídy má výuku. Jména učitelů, témata hodin
  a poznámky se zahazují hned po stažení. O žácích nic – počty jsou odhad z kapacity v rejstříku.
- Identifikovatelný User-Agent, aby školy věděly, kdo se ptá.

## Co model umí a neumí

Rozvrh přesně říká, **kdo může** být volný. Kam lidé reálně půjdou, je odhad – parametry jsou v
`src/openstudent/model.py` (`PARAMS`): podíl obědvajících, podíl, co jde do OC v pauze / po škole, max. dojezd.
Ber čísla jako „kolik lidí čekat“, ne jako sčítání. Dá se to zpřesnit kalibrací (např. počet vydaných obědů
z jídelny, ruční počítání v OC).

Nepokryté školy (rozvrh jen po přihlášení nebo neznámý systém) se nepočítají – pokrytí je vidět v dashboardu.
Největší díry: SŠ služeb, obchodu a gastronomie (~1000 žáků, web nedostupný), SZŠ Komenského (Bakaláři jen
s přihlášením), SPŠ stavební a Sion (EduPage bez zveřejněného rozvrhu).
