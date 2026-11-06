"""Katalog škol v HK: rejstřík MŠMT + zjištěný školní systém + poloha (RÚIAN/ČÚZK).

Zdroje rozvrhů v SOURCES byly zjištěny průzkumem 5. 11. 2026 (scripts/survey/).
public=True  → rozvrh jde stáhnout bez přihlášení (veřejný rozvrh školy)
public=False → systém známe, ale rozvrh je jen po přihlášení → nestahujeme
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from . import http

ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT / "data" / "schools_hk_register.json"
CATALOG = ROOT / "data" / "schools.json"
PLACES = ROOT / "data" / "places.json"

# klíč = doména z e-mailu v rejstříku
SOURCES: dict[str, dict] = {
    # ---------- střední školy ----------
    "bisgymbb.cz":        {"id": "bisgym", "system": "bakalari", "url": "https://bisgymbb.bakalari.cz/bakaweb", "public": True},
    "gybon.cz":           {"id": "gbn", "system": "bakalari", "url": "https://gybon.bakalari.cz", "public": True},
    "gjkt.cz":            {"id": "gjkt", "system": "bakalari", "url": "https://bakalari.gjkt.cz", "public": True},
    "hotelovka.cz":       {"id": "hotelovka", "system": "bakalari", "url": "https://hotelovka.bakalari.cz", "public": True},
    "oahk.cz":            {"id": "oahk", "system": "bakalari", "url": "https://oahk.bakalari.cz", "public": True},
    "soavoshk.cz":        {"id": "soavos", "system": "bakalari", "url": "https://soavoshk.bakalari.cz", "public": True},
    "psjg.cz":            {"id": "psjg", "system": "bakalari", "url": "https://psjg.bakalari.cz/bakaweb", "public": False,
                           "note": "Bakaláři neodpovídají (6. 11. 2026 /bakaweb timeout i login) – zkusit později"},
    "sosasou-vocelova.cz": {"id": "vocelova", "system": "bakalari", "url": "https://vocelova.bakalari.cz", "public": True},
    "sosvet.cz":          {"id": "sosvet", "system": "bakalari", "url": "https://b.sosvet.cz/bakaweb", "public": True},
    "spsstavhk.cz":       {"id": "spsstav", "system": "edupage", "url": "spsstavhk", "public": False,
                           "note": "EduPage bez zveřejněného rozvrhu"},
    "hradebni.cz":        {"id": "hradebni", "system": "bakalari",
                           "url": ["https://bakalari.hradebni.cz", "https://bakalari2.hradebni.cz"], "public": True},
    "hnn.cz":             {"id": "supshnn", "system": "bakalari", "url": "https://bakalari.supshk.cz", "public": True},
    "highschool.cz":      {"id": "sionhs", "system": "edupage", "url": "sionhs", "public": False,
                           "note": "EduPage bez zveřejněného rozvrhu"},
    "ssakhk.cz":          {"id": "kyberna", "system": "kybernais", "url": "https://sis.ssakhk.cz/TimeTable/", "public": True,
                           "note": "vlastní SIS; veřejné obrázky rozvrhu celé školy"},
    "sspphk.cz":          {"id": "sspp", "system": "bakalari", "url": "https://sspphk.bakalari.cz", "public": False},
    "sssoghk.cz":         {"id": "sssog", "system": "?", "public": False, "note": "web školy nedostupný"},
    "vizualskola.cz":     {"id": "vizual", "system": "bakalari", "url": "https://vizualskola.bakalari.cz", "public": False},
    "zshk.cz":            {"id": "szs", "system": "bakalari", "url": "https://ibakalari.zshk.cz", "public": False},
    "neslhk.com":         {"id": "nesl", "system": "bakalari", "url": "https://bakalari.neslhk.com", "public": True},
    "specialnihk.cz":     {"id": "specialni", "system": "?", "public": False},
    "daneta.cz":          {"id": "daneta", "system": "?", "public": False},
    "prointepo.org":      {"id": "prointepo", "system": "?", "public": False},
    # ---------- základní školy ----------
    "zsplotiste.cz":      {"id": "zs-plotiste", "system": "bakalari", "url": "https://bakalari.zsplotiste.eu", "public": True},
    "zssever.cz":         {"id": "zs-sever", "system": "bakalari", "url": "https://bakalari.zssever.cz", "public": True},
    "zsgocarova.cz":      {"id": "zs-gocarova", "system": "bakalari", "url": "https://zsgocarova.bakalari.cz", "public": True},
    "mandyska.cz":        {"id": "zs-mandysova", "system": "bakalari", "url": "https://bakalari.mandyska.cz", "public": True},
    "zsjirasek.cz":       {"id": "zs-jirasek", "system": "bakalari", "url": "https://zsjirasek.bakalari.cz", "public": True},
    "zsuprkova.cz":       {"id": "zs-uprkova", "system": "bakalari", "url": "https://zsuprkova.bakalari.cz", "public": True},
    "zsnovyhk.cz":        {"id": "zs-novyhk", "system": "bakalari", "url": "https://zsnovyhk.bakalari.cz", "public": True},
    "zspouchov.cz":       {"id": "zs-pouchov", "system": "bakalari", "url": "https://bakalari.zspouchov.cz", "public": True},
    "bezrucka.cz":        {"id": "zs-bezrucova", "system": "bakalari", "url": "https://bezrucka.bakalari.cz/bakaweb", "public": True},
    "habrmanova.cz":      {"id": "zs-habrmanova", "system": "bakalari", "url": "https://bakalari.habrmanova.cz/bakaweb", "public": True},
    "zshorakhk.cz":       {"id": "zs-horakove", "system": "bakalari", "url": "https://bakalari.zsmhhk.cz", "public": True},
    "zsstefanikovahk.cz": {"id": "zs-stefanikova", "system": "bakalari", "url": "https://bakalari.zsstefanikovahk.cz", "public": True},
    "skolacomenius.cz":   {"id": "zs-comenius", "system": "edupage", "url": "skolacomenius", "public": True},
    "zssvobodnedvory.cz": {"id": "zs-svobodnedvory", "system": "edupage", "url": "zssvobodnedvory", "public": False,
                           "note": "EduPage má zveřejněný jen rozvrh 2018/19 (zastaralý)"},
    "stefcova.cz":        {"id": "zs-stefcova", "system": "edupage", "url": "stefcova", "public": False, "note": "EduPage bez zveřejněného rozvrhu"},
    "sion.cz":            {"id": "zs-sion", "system": "edupage", "url": "zssion", "public": False, "note": "EduPage bez zveřejněného rozvrhu"},
    "edu-zssnp.cz":       {"id": "zs-snp", "system": "bakalari", "url": "https://bakalari.zssnphk.cz", "public": True},
    "zskukleny.cz":       {"id": "zs-kukleny", "system": "bakalari", "url": "https://zskukleny.bakalari.cz/bakaweb", "public": False},
    "zs-malsovalhota.cz": {"id": "zs-malsovalhota", "system": "?", "public": False, "note": "rozvrh jen na webu školy"},
    "scioskola.cz":       {"id": "zs-scio", "system": "?", "public": False},
    "skolytalent.cz":     {"id": "zs-talent", "system": "?", "public": False, "note": "web školy je napadený (spam)"},
    "skolakrok.cz":       {"id": "zs-krok", "system": "?", "public": False},
    "erazim.cz":          {"id": "zs-erazim", "system": "?", "public": False},
    "ddu-hk.cz":          {"id": "ddu", "system": "-", "public": False, "note": "diagnostický ústav – nesledujeme"},
    "volny.cz":           {"id": "zs-fn", "system": "-", "public": False, "note": "škola při nemocnici – nesledujeme"},
    "seznam.cz":          {"id": "zs-diakonie", "system": "?", "public": False},
}

# Krátké názvy pro dashboard (rejstřík má u ZŠ často jen „Základní škola“)
NICK = {
    "bisgym": "Biskupské gymnázium", "gbn": "Gymnázium B. Němcové", "gjkt": "Gymnázium J. K. Tyla",
    "hotelovka": "Hotelová škola", "oahk": "OA, SOŠ a jazyková škola", "soavos": "OA, SPgŠ a VOŠ",
    "vocelova": "SOŠ a SOU Vocelova", "sosvet": "SOŠ veterinární", "hradebni": "SPŠ, SOŠ a SOU Hradební",
    "supshnn": "SUPŠ hudebních nástrojů a nábytku", "kyberna": "SŠ a VOŠ aplikované kybernetiky",
    "nesl": "VOŠ, SŠ a ZŠ Štefánikova 549", "specialni": "Speciální školy HK", "daneta": "Daneta",
    "prointepo": "PROINTEPO", "psjg": "1. soukromé jazykové gymnázium", "spsstav": "SPŠ stavební",
    "sionhs": "Sion High School", "sspp": "SŠ profesní přípravy", "sssog": "SŠ služeb, obchodu a gastronomie",
    "vizual": "SŠ vizuální tvorby", "szs": "VOŠ a SŠ zdravotnická",
    "zs-plotiste": "Masarykova ZŠ Plotiště", "zs-comenius": "ZŠ Comenius", "zs-sever": "ZŠ Sever",
    "zs-gocarova": "ZŠ Josefa Gočára", "zs-mandysova": "ZŠ Pohádka (Mandysova)", "zs-jirasek": "ZŠ Jiráskovo nám.",
    "zs-uprkova": "ZŠ Úprkova", "zs-novyhk": "ZŠ Nový Hradec Králové", "zs-pouchov": "ZŠ Pouchov",
    "zs-bezrucova": "ZŠ Bezručova", "zs-habrmanova": "ZŠ Habrmanova", "zs-horakove": "ZŠ Milady Horákové",
    "zs-snp": "ZŠ SNP", "zs-stefanikova": "ZŠ Štefánikova", "ddu": "Diagnostický ústav", "zs-scio": "ScioŠkola",
    "zs-erazim": "ZŠ Erazim", "zs-krok": "ZŠ Krok", "zs-sion": "ZŠ Sion", "zs-talent": "ZŠ Talent",
    "zs-fn": "ZŠ při Fakultní nemocnici", "zs-kukleny": "ZŠ Kukleny", "zs-malsovalhota": "ZŠ Malšova Lhota",
    "zs-svobodnedvory": "ZŠ Svobodné Dvory", "zs-stefcova": "ZŠ Štefcova", "zs-diakonie": "ZŠ speciální Diakonie",
}

# Kam se chodí na oběd. own = vlastní jídelna školy (z rejstříku), jinak Jídelna Hradecká,
# pokud je do 15 min pěšky (stravuje žáky krajských, církevních a soukromých SŠ).
HRADECKA_MAX_WALK_MIN = 20

OC = [  # obchodní centra – adresní body RÚIAN (ČÚZK), ověřeno 5. 11. 2026
    {"id": "futurum", "name": "OC Futurum (Brněnská 1825)", "kind": "oc", "lat": 50.19701, "lon": 15.84893},
    {"id": "aupark", "name": "Aupark (Gočárova 1754)", "kind": "oc", "lat": 50.21225, "lon": 15.81245},
    {"id": "atrium", "name": "OC Atrium (Dukelská 1713)", "kind": "oc", "lat": 50.21348, "lon": 15.81852},
]


def walk_min(a: dict, b: dict) -> float:
    """Odhad cesty v minutách. Pěšky: vzdušná vzdálenost × 1,25 (ulice), 80 m/min.
    Nad 15 min pěšky počítáme s MHD: ~8 min čekání/přestup + jízda ~4× rychleji než chůze."""
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    d = 2 * 6371000 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2
                                          + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
    walk = d * 1.25 / 80
    return round(walk if walk <= 15 else min(walk, 8 + walk / 4), 1)


def ruian_point(kod: int) -> tuple[float, float] | None:
    url = ("https://ags.cuzk.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/1/query"
           f"?where=kod%3D{kod}&returnGeometry=true&outSR=4326&f=json")
    try:
        f = json.loads(http.get(url, ttl=365 * 86400))["features"]
    except (http.FetchError, KeyError, ValueError):
        return None
    if not f:
        return None
    g = f[0]["geometry"]
    return round(g["y"], 6), round(g["x"], 6)


def build() -> list[dict]:
    reg = json.loads(REGISTER.read_text(encoding="utf-8"))
    by_org: dict[str, dict] = {}
    canteens = []
    for r in reg:
        if r["druh"] in ("jídelna", "výdejna"):
            canteens.append(r)
            continue
        dom = next((e.split("@")[1].lower().strip(".").replace("..", ".") for e in r["emaily"] if "@" in e), "")
        o = by_org.setdefault(r["redIzo"], {
            "redIzo": r["redIzo"], "name": r["nazev"], "short": r["kratky"], "domain": dom,
            "types": [], "capacity": {}, "ruian": r["ruian"][0] if r["ruian"] else None,
        })
        o["types"].append(r["druh"])
        o["capacity"][r["druh"]] = o["capacity"].get(r["druh"], 0) + r["kapacita"]
        if r["druh"] == "SŠ" and r["ruian"]:
            o["ruian"] = r["ruian"][0]  # pro smíšené organizace bereme budovu SŠ

    own_canteen = {c["redIzo"] for c in canteens if c["druh"] == "jídelna"}
    hradecka = next(c for c in canteens if "Hradecká 1219" in c["nazev"])
    lat, lon = ruian_point(hradecka["ruian"][0]) or (50.1985, 15.8475)
    places = [{"id": "jidelna-hradecka", "name": "Jídelna Hradecká (Hradecká 1219)", "kind": "canteen",
               "lat": lat, "lon": lon, "open": ["11:15", "14:30"], "capacity": hradecka["kapacita"]}] + OC

    out = []
    for o in by_org.values():
        src = SOURCES.get(o["domain"], {"id": o["domain"].split(".")[0] or o["redIzo"], "system": "?", "public": False})
        if o["domain"] == "seznam.cz" and "Diakonie" not in o["name"]:
            src = {"id": "x-" + o["redIzo"], "system": "?", "public": False}
        p = ruian_point(o["ruian"]) if o["ruian"] else None
        s = {**o, **src, "lat": p[0] if p else None, "lon": p[1] if p else None,
             "level": "SŠ" if "SŠ" in o["types"] or "VOŠ" in o["types"] else "ZŠ"}
        s["students_est"] = round(sum(o["capacity"].values()) * 0.85)  # rejstřík má jen max. kapacitu
        if o["redIzo"] in own_canteen:
            s["canteen"] = "own"
        elif p and s["level"] == "SŠ" and walk_min(s, places[0]) <= HRADECKA_MAX_WALK_MIN:
            # Hradecká stravuje žáky krajských/církevních/soukromých škol (vnitřní řád) – městské ZŠ ne
            s["canteen"] = "jidelna-hradecka"
        else:
            s["canteen"] = None
        if p:
            s["walk"] = {pl["id"]: walk_min(s, pl) for pl in places}
        out.append(s)
    out.sort(key=lambda s: (s["level"] != "SŠ", not s["public"], s["name"]))
    CATALOG.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    PLACES.write_text(json.dumps(places, ensure_ascii=False, indent=1), encoding="utf-8")
    return out
