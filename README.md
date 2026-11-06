# OpenŠtudent

**Školní appka pro všechny školy v Hradci Králové.** Rozvrh tvojí třídy se suplováním, obědy a vytížení menzy,
volné učebny, kdo kdy končí, testy sdílené se třídou a SideQuesty po Hradci. Stejný princip jako
[OpenSISAKHK](https://github.com/oondraa/OpenSISAKHK) pro Kybernu, jen pro celé město: místo školního přihlášení se
zaregistruješ libovolným e-mailem a vybereš si školu a třídu.

> Ve vývoji. Neoficiální projekt, není spojený s žádnou školou.

## Jak to funguje

- **Data jsou veřejná.** Rozvrhy bereme jen z toho, co školy samy zveřejňují bez přihlášení (veřejný rozvrh
  Bakalářů, EduPage, KybernaIS). Jídelníčky z veřejných jídelníčků Strava.cz. Seznam škol z rejstříku MŠMT.
- **Přihlášení e-mailem.** Žádné heslo: na e-mail přijde 6místný kód. Server si pamatuje jen e-mail, školu, třídu
  a případně tvoje skupiny.
- **Pipeline** (`pipeline/`, Python) jednou za noc stáhne rozvrhy všech škol, spočítá odhad vytížení jídelen a
  nahraje data do Workeru.
- **Appka** (`src/`, Cloudflare Worker + React PWA) z nich ukáže rozvrh tvé třídy a pošle notifikaci, když škola
  rozvrh změní.

## Vývoj

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply openstudent --local
npm run dev

cd pipeline && python -m openstudent run    # katalog → rozvrhy → menza → export pro appku
```

Podrobnosti o pipeline jsou v [pipeline/README.md](pipeline/README.md).
