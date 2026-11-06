"""Šetrný HTTP klient: jen veřejné stránky, identifikovatelný User-Agent,
max. 1 požadavek za `DELAY` s na jeden server, cache na disku, žádné přihlašování."""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache"
UA = "OpenStudent/0.1 (studentsky projekt, verejne rozvrhy HK; +https://github.com/oondraa)"
DELAY = 1.5
_last: dict[str, float] = {}


class FetchError(RuntimeError):
    pass


def _wait(host: str) -> None:
    t = _last.get(host, 0) + DELAY - time.monotonic()
    if t > 0:
        time.sleep(t)
    _last[host] = time.monotonic()


def get(url: str, *, data: dict | None = None, ttl: float = 6 * 3600, binary: bool = False,
        ctype: str = "application/json; charset=UTF-8"):
    """GET (nebo POST JSON, když je `data`). Výsledek se cachuje `ttl` sekund."""
    key = hashlib.sha1((url + json.dumps(data, sort_keys=True)).encode()).hexdigest()
    path = CACHE / f"{key}.bin"
    if path.exists() and time.time() - path.stat().st_mtime < ttl:
        raw = path.read_bytes()
        return raw if binary else raw.decode("utf-8", "replace")

    url = urllib.parse.quote(url, safe=":/?&=%#+@,;~!$*'()[]")  # mezery/diakritika v odkazech ze školních webů
    host = urllib.parse.urlsplit(url).netloc
    headers = {"User-Agent": UA}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = ctype
    for attempt in range(3):
        _wait(host)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=20) as r:
                if "login" in r.geturl().lower():
                    raise FetchError(f"{url} vyžaduje přihlášení – není veřejné")
                raw = r.read()
                break
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < 2:
                time.sleep(30 * (attempt + 1))  # server říká „zpomal“ → posloucháme
                continue
            raise FetchError(f"{url}: HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt < 2:
                time.sleep(5)
                continue
            raise FetchError(f"{url}: {getattr(e, 'reason', e)}") from e
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return raw if binary else raw.decode("utf-8", "replace")
