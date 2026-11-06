"""Ověří veřejný rozvrh EduPage přes stejné API, které volá jejich veřejný prohlížeč rozvrhu."""
import json, sys, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (OpenStudent school-survey)", "Content-Type": "application/json; charset=UTF-8"}
SCHOOLS = sys.argv[1:] or ["spsstavhk", "zssvobodnedvory", "sionhs", "zssion", "stefcova", "skolacomenius", "vizualskola"]


def post(url, body):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), headers=UA), timeout=15)
        return r.read().decode("utf-8", "replace")
    except Exception as e:
        return f"ERR {e}"


for s in SCHOOLS:
    base = f"https://{s}.edupage.org/timetable/server"
    v = post(f"{base}/ttviewer.js?__func=getTTViewerData", {"__args": [None, 2026], "__gsh": "00000000"})
    try:
        tts = json.loads(v)["r"]["regular"]["timetables"]
    except Exception:
        print(f"{s:18} ttviewer: {v[:150]!r}")
        continue
    if not tts:
        print(f"{s:18} žádný zveřejněný rozvrh")
        continue
    tt = tts[0]
    d = post(f"{base}/regulartt.js?__func=regularttGetData", {"__args": [None, tt["tt_num"]], "__gsh": "00000000"})
    try:
        tables = {t["id"]: t["data_rows"] for t in json.loads(d)["r"]["dbiAccessorRes"]["tables"]}
        print(f"{s:18} VEŘEJNÝ tt={tt['tt_num']} '{tt.get('text')}' od {tt.get('datefrom')}: tříd={len(tables.get('classes', []))} "
              f"učeben={len(tables.get('classrooms', []))} lekcí={len(tables.get('lessons', []))} "
              f"period={[(p['starttime'], p['endtime']) for p in tables.get('periods', [])][:10]}")
    except Exception:
        print(f"{s:18} data: {d[:200]!r}")
